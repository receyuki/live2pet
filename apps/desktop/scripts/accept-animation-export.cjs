// Opt-in native acceptance; all model-derived output stays outside the repository.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { createProject } = require('@live2pet/project');
const sharp = require('sharp');
const UPNG = require('node:module').createRequire(require.resolve('@live2pet/package-build'))('upng-js');

async function run() {
  const { _electron } = require('playwright');
  const source = process.env.LIVE2PET_EXPORT_SOURCE;
  const runtime = process.env.LIVE2PET_EXPORT_RUNTIME;
  assert.ok(source && runtime && path.isAbsolute(source) && path.isAbsolute(runtime), 'Provide absolute LIVE2PET_EXPORT_SOURCE and LIVE2PET_EXPORT_RUNTIME.');
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'live2pet-animation-acceptance-'));
  const profile = path.join(output, 'profile');
  const fixture = path.join(output, 'acceptance.l2p');
  console.log(`Acceptance output: ${output}`);
  const app = await _electron.launch({ executablePath: require('electron'), args: [path.resolve(__dirname, '..'), `--user-data-dir=${profile}`], timeout: 30000 });
  try {
    assert.equal(fs.realpathSync(await app.evaluate(({ app }) => app.getPath('userData'))), fs.realpathSync(profile));
    const page = await app.firstWindow();
    page.on('dialog', dialog => { void dialog.accept().catch(() => {}); });
    await page.waitForFunction(() => Boolean(window.live2pet));
    const invoke = async (method, input) => {
      const response = await page.evaluate(({ method, input }) => window.live2pet[method](input), { method, input });
      assert.equal(response.ok, true, JSON.stringify(response.error));
      return response.result;
    };
    await invoke('configureRuntime', { inputPath: runtime });
    const inspection = await invoke('inspectSource', { inputPath: source, projectId: 'animation-acceptance' });
    let project = createProject({ projectId: 'animation-acceptance', name: 'Animation acceptance', source: { kind: inspection.source.kind, name: inspection.source.name, path: source, modelConfig: inspection.source.modelConfig, fingerprint: inspection.source.fingerprint } });
    // Resolve the selected-model identity through the same migration path as
    // reopening an existing project, rather than mixing package/model hashes.
    project = (await invoke('relinkSource', { project, inputPath: source })).project;
    const motion = inspection.motions.filter(item => item.duration > 0).sort((a, b) => a.duration - b.duration)[0] ?? inspection.motions[0];
    assert.ok(motion, 'Source has no motions.');
    await app.evaluate(({ dialog }, { output, fixture }) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [output] });
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: fixture });
    }, { output, fixture });
    await invoke('configureOutputSettings', { action: 'choose-folder' });
    const spec = { preset: 'compact', width: 256, height: 256, fps: 30, quality: 76, lossless: false, loop: true };
    await page.evaluate(() => { window.__exports = []; window.live2pet.onAnimationExportProgress(event => window.__exports.push(event)); });
    const result = await invoke('exportAnimations', { requestId: randomUUID(), project, motionIds: [motion.id], expressionId: null, render: spec });
    assert.equal(result.files.length, 1);
    assert.deepEqual(result.failures, []);
    const metadata = await sharp(path.join(result.directoryPath, result.files[0].filename), { animated: true }).metadata();
    assert.equal(metadata.width, 256);
    assert.equal(metadata.pageHeight, 256);
    assert.equal(metadata.hasAlpha, true);
    assert.ok(metadata.pages > 1);
    assert.ok(metadata.delay.every(delay => delay >= 33 && delay <= 34));
    const events = await page.evaluate(() => window.__exports);
    assert.ok(events.some(event => event.stage === 'render'));
    const warm = await invoke('exportAnimations', { requestId: randomUUID(), project, motionIds: [motion.id], expressionId: null, render: spec });
    assert.equal(warm.cache.hits, 1);
    assert.notEqual(warm.files[0].filename, result.files[0].filename);
    project.targets.clawd = { profile: 'clawd', renderPreset: 'compact', mappings: Object.fromEntries(['idle', 'thinking', 'working', 'sleeping'].map(slot => [slot, `motion:${motion.id}`])), reactions: {}, options: { sleepMode: 'direct', renderOverrides: { width: 256, height: 256, fps: 30, quality: 76 } } };
    await page.evaluate(() => { window.__builds = []; window.live2pet.onBuildProgress(event => window.__builds.push(event)); });
    const build = await invoke('buildProject', { project, targets: ['clawd'], optionsByTarget: { clawd: { package: true } } });
    assert.ok(build.artifacts?.length || build.builds?.clawd?.artifact, 'Expected pet package artifact.');
    assert.equal((await page.evaluate(() => window.__builds)).filter(event => event.stage === 'render' && event.status === 'frame-completed').length, 0);
    console.log('Native WebP export, timing, non-overwrite and export-to-Clawd cache checks passed.');
    // The setting, rather than an explicit request override, controls both
    // standalone export and Clawd; switching format must retain raw captures.
    await invoke('configureOutputSettings', { action: 'set-animation-format', format: 'apng' });
    await page.evaluate(() => { window.__exports = []; window.__builds = []; });
    const apng = await invoke('exportAnimations', { requestId: randomUUID(), project, motionIds: [motion.id], expressionId: null, render: spec });
    assert.equal(apng.files.length, 1);
    assert.deepEqual(apng.failures, []);
    assert.ok(apng.files[0].filename.endsWith('.apng'));
    const apngBytes = fs.readFileSync(path.join(apng.directoryPath, apng.files[0].filename));
    const decoded = UPNG.decode(apngBytes.buffer.slice(apngBytes.byteOffset, apngBytes.byteOffset + apngBytes.byteLength));
    assert.equal(decoded.width, 256);
    assert.equal(decoded.height, 256);
    assert.equal(decoded.tabs.acTL.num_frames, metadata.pages);
    assert.equal(decoded.tabs.acTL.num_plays, 0);
    assert.deepEqual(decoded.frames.map(frame => frame.delay), metadata.delay);
    const apngFrames = UPNG.toRGBA8(decoded);
    assert.equal(apngFrames.length, metadata.pages);
    const firstRgba = new Uint8Array(apngFrames[0]);
    assert.ok(firstRgba.some((value, index) => index % 4 === 3 && value === 0), 'APNG lost transparent background.');
    assert.ok(firstRgba.some((value, index) => index % 4 === 3 && value > 0), 'APNG has no visible model pixels.');
    const apngEvents = await page.evaluate(() => window.__exports);
    assert.ok(apngEvents.some(event => event.stage === 'render' && event.cache === 'hit'), 'APNG must reuse WebP capture frames.');
    assert.equal(apngEvents.filter(event => event.stage === 'render' && event.status === 'frame-completed').length, 0);
    const apngBuild = await invoke('buildProject', { project, targets: ['clawd'], optionsByTarget: { clawd: { package: true } } });
    assert.equal(apngBuild.builds.clawd.encoding.format, 'apng');
    assert.equal(apngBuild.builds.clawd.cache.hits, 1);
    assert.equal((await page.evaluate(() => window.__builds)).filter(event => event.stage === 'render' && event.status === 'frame-completed').length, 0);
    console.log('Native APNG transparency, timing, WebP-frame reuse, and APNG-to-Clawd encoded reuse passed.');
    await invoke('saveProject', { project, saveAs: true });
    await app.evaluate(({ dialog }, fixture) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [fixture] }); }, fixture);
    await page.evaluate(() => { localStorage.setItem('live2pet.desktop.setup-completed', 'true'); localStorage.setItem('live2pet.desktop.locale', 'en'); localStorage.setItem('live2pet.desktop.onboarding', JSON.stringify({ schemaVersion: 1, tourVersion: 1, status: 'skipped', completedStages: [] })); });
    await page.reload();
    await page.getByRole('button', { name: 'Open project', exact: true }).click();
    await page.getByRole('button', { name: 'Map', exact: true }).click();
    await page.getByRole('button', { name: 'Export animation', exact: true }).click();
    await page.getByRole('dialog').waitFor();
    await page.getByRole('dialog').getByText('APNG · lossless (larger files)', { exact: true }).waitFor();
    const box = await page.getByRole('dialog').boundingBox();
    assert.ok(box && box.y >= 0 && box.height < (await page.evaluate(() => innerHeight)));
    await page.screenshot({ path: path.join(output, 'export-dialog.png') });
    console.log(JSON.stringify({ ok: true, width: metadata.width, height: metadata.pageHeight, frames: metadata.pages, transparent: metadata.hasAlpha, cacheHit: warm.cache.hits, apngFrames: apngFrames.length, apngRawCacheHit: true, apngClawdCacheHits: apngBuild.builds.clawd.cache.hits, petCaptureFrames: 0, uiDialog: true }));
  } finally { await app.close(); }
}
if (require.main === module) run().catch(error => { console.error(error); process.exitCode = 1; });
