// Opt-in local acceptance. Inputs and generated artifacts never enter the repo.
// Playwright is supplied by the caller, as for accept-desktop.cjs.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { performance } = require('node:perf_hooks');

function summarizeProgress(events) {
  const stageIntervals = [];
  const starts = new Map();
  const origin = events[0]?.at || 0;
  for (const event of events) {
    const key = `${event.target}:${event.stage}:${event.motionId || ''}`;
    if (event.status === 'started' || event.status === 'motion-started') starts.set(key, event.at);
    if ((event.status === 'completed' || event.status === 'motion-completed') && starts.has(key)) {
      stageIntervals.push({ target: event.target, stage: event.stage, scope: event.motionId ? 'motion' : 'target', startMs: starts.get(key) - origin, endMs: event.at - origin });
      starts.delete(key);
    }
  }
  return {
    // Stage intervals may overlap; never add them to derive wall time.
    stageIntervals,
    capturedFrames: events.filter(e => e.stage === 'render' && e.status === 'frame-completed').length,
    encodedAnimations: events.filter(e => e.stage === 'encode' && e.status === 'motion-completed' && e.cache !== 'hit').length,
    queuedEvents: events.filter(e => e.stage === 'queue' && e.status === 'queued').length,
  };
}

async function inspectPackage(bytes) {
  const { ZipReader, Uint8ArrayReader, Uint8ArrayWriter } = require('@zip.js/zip.js');
  const sharp = require('sharp');
  const reader = new ZipReader(new Uint8ArrayReader(bytes));
  try {
    const images = [];
    for (const entry of await reader.getEntries()) {
      if (entry.directory || !entry.filename.endsWith('.webp')) continue;
      const image = Buffer.from(await entry.getData(new Uint8ArrayWriter()));
      const metadata = await sharp(image, { animated: true }).metadata();
      const samples = [];
      for (const page of [...new Set([0, Math.floor((metadata.pages || 1) / 2), (metadata.pages || 1) - 1])]) {
        const { data, info } = await sharp(image, { page, pages: 1 }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
        let visiblePixels = 0;
        for (let i = 3; i < data.length; i += 4) if (data[i]) visiblePixels++;
        samples.push({ page, width: info.width, height: info.height, visiblePixels, rgbaSha256: crypto.createHash('sha256').update(data).digest('hex') });
      }
      images.push({ bytes: image.length, sha256: crypto.createHash('sha256').update(image).digest('hex'), width: metadata.width, height: metadata.pageHeight || metadata.height, pages: metadata.pages || 1, delays: metadata.delay || [], hasAlpha: metadata.hasAlpha, samples });
    }
    return images;
  } finally { await reader.close(); }
}

async function run() {
  const { _electron } = require('playwright');
  const inputPath = process.env.LIVE2PET_BENCH_PROJECT;
  const runtime = process.env.LIVE2PET_BENCH_RUNTIME;
  const motions = JSON.parse(process.env.LIVE2PET_BENCH_MOTIONS || '[]');
  const repetitions = Number(process.env.LIVE2PET_BENCH_REPETITIONS || 3);
  assert.ok(inputPath && path.isAbsolute(inputPath), 'Provide LIVE2PET_BENCH_PROJECT as an absolute project path.');
  assert.ok(motions.length === 4 && motions.every(id => typeof id === 'string' && id), 'Provide four inspected Motion ids through LIVE2PET_BENCH_MOTIONS (JSON array).');
  assert.ok(Number.isInteger(repetitions) && repetitions >= 1 && repetitions <= 10);
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'live2pet-project-benchmark-'));
  const profile = path.join(output, 'profile');
  const desktop = path.resolve(__dirname, '..');
  let app;
  const runs = [];
  const report = {
    schemaVersion: 1, revision: process.env.LIVE2PET_BENCH_REVISION || 'working-tree',
    platform: process.platform, arch: process.arch, preset: 'balanced',
    method: 'Monotonic wall time around public Desktop build IPC. Electron process-group working sets sampled every 500 ms (KiB); sampled peak, not a guaranteed absolute peak. Artifact download/decoding is outside the timed interval. Stage intervals overlap and are not additive. No model names, Motion ids, or input paths in this report.',
    runs,
  };
  const writeReport = () => fs.writeFileSync(path.join(output, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  console.log(`Benchmark output: ${output}`);
  try {
    const packaged = process.env.LIVE2PET_APP_EXECUTABLE;
    app = await _electron.launch({ executablePath: packaged || require('electron'), args: [...(packaged ? [] : [desktop]), `--user-data-dir=${profile}`], timeout: 30000 });
    const page = await app.firstWindow();
    await page.waitForFunction(() => Boolean(window.live2pet));
    const invoke = async (method, input) => {
      const response = await page.evaluate(({ method, input }) => input === undefined ? window.live2pet[method]() : window.live2pet[method](input), { method, input });
      if (!response.ok) throw Object.assign(new Error(response.error.message), { code: response.error.code });
      return response.result;
    };
    if (runtime) await invoke('configureRuntime', { inputPath: runtime });
    let project = (await invoke('openProject', { inputPath })).project;
    const linked = await invoke('relinkSource', { project, inputPath: project.source.path });
    project = linked.project;
    // This modifies only the in-memory test snapshot, never the input file.
    project.name = 'Benchmark';
    project.recipes = [];
    project.targets.clawd = { profile: 'clawd', renderPreset: 'balanced', mappings: { idle: `motion:${motions[0]}`, thinking: `motion:${motions[1]}`, working: `motion:${motions[2]}`, sleeping: `motion:${motions[0]}` }, reactions: {}, options: {} };
    project.targets['codex-pet'] = { profile: 'codex-pet', renderPreset: 'balanced', mappings: Object.fromEntries(['idle', 'running-right', 'running-left', 'waving', 'jumping', 'failed', 'waiting', 'running', 'review'].map((id, i) => [id, `motion:${motions[i % 3]}`])), reactions: {}, options: {} };
    for (let repetition = 1; repetition <= repetitions; repetition++) {
      await invoke('clearBuildCache', { confirmClear: true });
      for (const scenario of ['cold', 'warm', 'metadata-only', 'one-motion-changed', 'sequential-target']) {
        await invoke('closePreview');
        const current = structuredClone(project);
        if (scenario === 'metadata-only') current.name = 'Renamed benchmark';
        if (scenario === 'one-motion-changed') current.targets.clawd.mappings.thinking = `motion:${motions[3]}`;
        const target = scenario === 'sequential-target' ? 'codex-pet' : 'clawd';
        await page.evaluate(() => {
          window.__benchmarkEvents = [];
          window.__benchmarkUnsubscribe = window.live2pet.onBuildProgress(event => window.__benchmarkEvents.push({ ...event, at: performance.now() }));
        });
        let peakWorkingSetKiB = 0;
        let memorySamples = 0;
        let pendingSample = null;
        const sample = () => {
          if (pendingSample) return;
          pendingSample = app.evaluate(({ app }) => app.getAppMetrics().reduce((sum, item) => sum + (item.memory.workingSetSize || 0), 0))
            .then(value => { peakWorkingSetKiB = Math.max(peakWorkingSetKiB, value); memorySamples++; }).finally(() => { pendingSample = null; });
        };
        sample();
        const timer = setInterval(sample, 500);
        const started = performance.now();
        console.log(`Run ${repetition}: ${scenario}`);
        let built;
        let totalMs;
        try {
          built = await invoke('buildProject', { project: current, targets: [target], optionsByTarget: { [target]: { package: true, ...(target === 'codex-pet' ? { spriteVersionNumber: 2 } : {}) } } });
          totalMs = performance.now() - started;
        } finally { clearInterval(timer); if (pendingSample) await pendingSample; }
        const events = await page.evaluate(() => { window.__benchmarkUnsubscribe(); return window.__benchmarkEvents; });
        const build = built.builds[target];
        assert.equal(build.validation.ok, true);
        const artifact = built.artifacts[0];
        const chunks = [];
        for (let offset = 0; offset < artifact.byteLength;) {
          const chunk = await page.evaluate(async ({ artifactId, offset }) => {
            const response = await window.live2pet.getBuildArtifact({ artifactId, offset });
            if (!response.ok) throw new Error(response.error.message);
            return { ...response.result, bytes: Array.from(response.result.bytes) };
          }, { artifactId: artifact.artifactId, offset });
          chunks.push(Buffer.from(chunk.bytes)); offset = chunk.nextOffset;
        }
        const bytes = Buffer.concat(chunks);
        fs.writeFileSync(path.join(output, `${repetition}-${scenario}.zip`), bytes, { mode: 0o600 });
        const images = await inspectPackage(bytes);
        const entry = { repetition, scenario, target, totalMs, peakWorkingSetKiB, memorySamples, cache: build.cache, packageBytes: artifact.byteLength, ...summarizeProgress(events), images };
        runs.push(entry); writeReport();
        console.log(JSON.stringify({ repetition, scenario, totalMs, peakWorkingSetKiB, capturedFrames: entry.capturedFrames, cache: entry.cache }));
        if (['warm', 'metadata-only'].includes(scenario)) {
          assert.deepEqual(images, runs.find(run => run.repetition === repetition && run.scenario === 'cold').images, 'Warm and renamed packages must preserve all encoded pixels, timing and alpha.');
        }
      }
    }
  } finally {
    writeReport();
    if (app) await app.close();
    // Only this invocation's isolated profile is disposable. Retain the small
    // redacted report and generated packages for local comparisons.
    fs.rmSync(profile, { recursive: true, force: true });
  }
}

if (require.main === module) run().catch(error => { console.error(`${error.code || 'BENCHMARK_FAILED'}: ${error.message}`); process.exitCode = 1; });
module.exports = { summarizeProgress, inspectPackage };
