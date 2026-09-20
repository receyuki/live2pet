// Opt-in local acceptance. Inputs and generated artifacts never enter the repo.
// Playwright is supplied by the caller, as for accept-desktop.cjs.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { performance } = require('node:perf_hooks');

// Executed inside the App renderer by Playwright.
async function readArtifactChunk({ artifactId, offset }) {
  const response = await window.live2pet.getBuildArtifact(artifactId, offset);
  if (!response.ok) throw new Error(response.error.message);
  // Avoid Playwright's per-number serialization for multi-MiB arrays.
  const bytes = response.result.bytes;
  let binary = '';
  for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
  return { nextOffset: response.result.nextOffset, base64: btoa(binary) };
}

// Executed inside the App renderer; cancellation uses the same preload as the UI.
async function cancelDuringCapture(input) {
  let requestedAt;
  let cancellation;
  const unsubscribe = window.live2pet.onBuildProgress(event => {
    if (input.requestId && event.requestId !== input.requestId) return;
    if (cancellation || event.stage !== 'render' || event.status !== 'frame-completed') return;
    requestedAt = performance.now();
    cancellation = window.live2pet.cancelBuild(event.buildId)
      .then(response => ({ response }), error => ({ error }));
  });
  try {
    const response = await window.live2pet.buildProject(input);
    const settledAt = performance.now();
    const acknowledgement = await cancellation;
    if (acknowledgement?.error) throw acknowledgement.error;
    if (response.ok || response.error?.code !== 'BUILD_CANCELLED'
      || !acknowledgement?.response.ok || acknowledgement.response.result.cancelled !== true) {
      throw new Error('Capture cancellation was not observed and acknowledged.');
    }
    return { cancelled: true, responseMs: settledAt - requestedAt };
  } finally { unsubscribe(); }
}

function summarizeProgress(events, requestId) {
  if (requestId) events = events.filter(event => event.requestId === requestId);
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
    encodedAtlases: events.filter(e => e.target === 'codex-pet' && e.stage === 'encode' && e.status === 'completed' && !(e.cacheHits > 0)).length,
    queuedEvents: events.filter(e => e.stage === 'queue' && e.status === 'queued').length,
  };
}

async function inspectPackage(bytes) {
  const { ZipReader, Uint8ArrayReader, Uint8ArrayWriter } = require('@zip.js/zip.js');
  const sharp = require('sharp');
  const reader = new ZipReader(new Uint8ArrayReader(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)));
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

function verifySpineBenchmarkMotions(preview, inspection, motions) {
  assert.equal(preview.state, 'ready', 'Spine benchmark preview did not become ready.');
  const catalog = preview.catalog?.motions ?? inspection.motions;
  for (const id of motions) assert.ok(catalog.some(motion => motion.id === id), 'Benchmark Motion is absent from the source catalog.');
}

async function run() {
  const { _electron } = require('playwright');
  const inputPath = process.env.LIVE2PET_BENCH_PROJECT;
  const runtime = process.env.LIVE2PET_BENCH_RUNTIME;
  const spinePackRoot = process.env.LIVE2PET_BENCH_SPINE_PACK_ROOT;
  const spineRuntimeLine = process.env.LIVE2PET_BENCH_SPINE_RUNTIME_LINE;
  assert.equal(Boolean(spinePackRoot), Boolean(spineRuntimeLine), 'Provide both Spine pack root and runtime line.');
  const motions = JSON.parse(process.env.LIVE2PET_BENCH_MOTIONS || '[]');
  const repetitions = Number(process.env.LIVE2PET_BENCH_REPETITIONS || 3);
  const allScenarios = ['cold', 'warm', 'metadata-only', 'one-motion-changed', 'sequential-target', 'cancel-retry'];
  const requestedScenarios = process.env.LIVE2PET_BENCH_SCENARIOS?.split(',') || allScenarios;
  assert.ok(requestedScenarios.length && requestedScenarios.every(scenario => allScenarios.includes(scenario)), 'Unknown benchmark scenario.');
  const scenarios = allScenarios.filter(scenario => requestedScenarios.includes(scenario));
  assert.ok(scenarios.includes('cold') || !scenarios.some(scenario => ['warm', 'metadata-only'].includes(scenario)), 'Warm parity scenarios require a cold reference.');
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
    completed: false, expectedRuns: repetitions * scenarios.length,
    platform: process.platform, arch: process.arch, preset: 'balanced',
    method: 'Monotonic wall time around public Desktop build IPC. Electron process-group working sets sampled every 500 ms (KiB); sampled peak, not a guaranteed absolute peak. Artifact download/decoding is outside the timed interval. Stage intervals overlap and are not additive. No model names, Motion ids, or input paths in this report.',
    runs,
  };
  const writeReport = () => fs.writeFileSync(path.join(output, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  console.log(`Benchmark output: ${output}`);
  try {
    if (spinePackRoot) {
      const { resolveSpinePack } = require('../../../packages/spine-pack/src/index.cjs');
      const installed = resolveSpinePack(spinePackRoot, spineRuntimeLine);
      const stagedRoot = path.join(profile, 'renderer-packs');
      fs.cpSync(installed.directory, path.join(stagedRoot, path.basename(installed.directory)), { recursive: true });
      resolveSpinePack(stagedRoot, spineRuntimeLine);
    }
    const packaged = process.env.LIVE2PET_APP_EXECUTABLE;
    app = await _electron.launch({ executablePath: packaged || require('electron'), args: [...(packaged ? [] : [desktop]), `--user-data-dir=${profile}`], timeout: 30000 });
    app.process().once('exit', (code, signal) => console.log(`Benchmark App exited: ${code ?? signal}`));
    assert.equal(fs.realpathSync(await app.evaluate(({ app }) => app.getPath('userData'))), fs.realpathSync(profile), 'Never run a benchmark against the normal App profile.');
    const page = await app.firstWindow();
    page.on('crash', () => console.error('Benchmark main page crashed.'));
    page.on('close', () => console.log('Benchmark main page closed.'));
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
    if (spinePackRoot) {
      const preview = await invoke('openPreview', { projectId: project.projectId, sourceFingerprint: project.source.fingerprint, bounds: { x: 0, y: 0, width: 768, height: 768 }, visible: false });
      verifySpineBenchmarkMotions(preview, linked.inspection, motions);
      await invoke('closePreview');
    }
    // This modifies only the in-memory test snapshot, never the input file.
    project.name = 'Benchmark';
    project.recipes = [];
    project.targets.clawd = { profile: 'clawd', renderPreset: 'balanced', mappings: { idle: `motion:${motions[0]}`, thinking: `motion:${motions[1]}`, working: `motion:${motions[2]}`, sleeping: `motion:${motions[0]}` }, reactions: {}, options: {} };
    project.targets['codex-pet'] = { profile: 'codex-pet', renderPreset: 'balanced', mappings: Object.fromEntries(['idle', 'running-right', 'running-left', 'waving', 'jumping', 'failed', 'waiting', 'running', 'review'].map((id, i) => [id, `motion:${motions[i % 3]}`])), reactions: {}, options: {} };
    for (let repetition = 1; repetition <= repetitions; repetition++) {
      await invoke('clearBuildCache', { confirmClear: true });
      for (const scenario of scenarios) {
        await invoke('closePreview');
        // Force native work so cancellation cannot silently exercise a cache hit.
        if (scenario === 'cancel-retry') await invoke('clearBuildCache', { confirmClear: true });
        const current = structuredClone(project);
        if (scenario === 'metadata-only') current.name = 'Renamed benchmark';
        if (scenario === 'one-motion-changed') current.targets.clawd.mappings.thinking = `motion:${motions[3]}`;
        const target = scenario === 'sequential-target' ? 'codex-pet' : 'clawd';
        const buildInput = { project: current, requestId: crypto.randomUUID(), projectId: current.projectId, snapshotFingerprint: crypto.createHash('sha256').update(JSON.stringify(current)).digest('hex'), targets: [target], optionsByTarget: { [target]: { package: true, ...(target === 'codex-pet' ? { spriteVersionNumber: 2 } : {}) } } };
        let cancellation;
        if (scenario === 'cancel-retry') cancellation = await page.evaluate(cancelDuringCapture, { ...buildInput, requestId: crypto.randomUUID() });
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
            .then(value => { peakWorkingSetKiB = Math.max(peakWorkingSetKiB, value); memorySamples++; }).catch(() => { /* App failure is reported by the build invocation. */ }).finally(() => { pendingSample = null; });
        };
        sample();
        const timer = setInterval(sample, 500);
        const started = performance.now();
        console.log(`Run ${repetition}: ${scenario}`);
        let built;
        let totalMs;
        try {
          built = await invoke('buildProject', buildInput);
          totalMs = performance.now() - started;
        } finally { clearInterval(timer); if (pendingSample) await pendingSample; }
        const events = await page.evaluate(() => { window.__benchmarkUnsubscribe(); return window.__benchmarkEvents; });
        const build = built.builds[target];
        assert.equal(build.validation.ok, true);
        console.log(JSON.stringify({ repetition, scenario, totalMs, cache: build.cache, state: 'built; inspecting artifact' }));
        const artifact = built.artifacts[0];
        const chunks = [];
        for (let offset = 0; offset < artifact.byteLength;) {
          const chunk = await page.evaluate(readArtifactChunk, { artifactId: artifact.artifactId, offset });
          chunks.push(Buffer.from(chunk.base64, 'base64')); offset = chunk.nextOffset;
        }
        const bytes = Buffer.concat(chunks);
        fs.writeFileSync(path.join(output, `${repetition}-${scenario}.zip`), bytes, { mode: 0o600 });
        const images = await inspectPackage(bytes);
        const entry = { repetition, scenario, target, totalMs, peakWorkingSetKiB, memorySamples, cache: build.cache, packageBytes: artifact.byteLength, artifactTransferredBytes: bytes.length, artifactChunks: chunks.length, timings: build.report?.timings, desktopTimings: build.report?.desktopTimings, ...(cancellation ? { cancellation } : {}), ...summarizeProgress(events, buildInput.requestId), images };
        runs.push(entry); writeReport();
        console.log(JSON.stringify({ repetition, scenario, totalMs, peakWorkingSetKiB, capturedFrames: entry.capturedFrames, cache: entry.cache }));
        if (['warm', 'metadata-only', 'cancel-retry'].includes(scenario) && scenarios.includes('cold')) {
          assert.deepEqual(images, runs.find(run => run.repetition === repetition && run.scenario === 'cold').images, 'Warm and renamed packages must preserve all encoded pixels, timing and alpha.');
        }
      }
    }
    report.completed = true;
  } finally {
    writeReport();
    if (app) await app.close();
    // Only this invocation's isolated profile is disposable. Retain the small
    // redacted report and generated packages for local comparisons.
    fs.rmSync(profile, { recursive: true, force: true });
  }
}

if (require.main === module) run().catch(error => { console.error(`${error.code || 'BENCHMARK_FAILED'}: ${error.message}`); process.exitCode = 1; });
module.exports = { summarizeProgress, inspectPackage, readArtifactChunk, cancelDuringCapture, verifySpineBenchmarkMotions };
