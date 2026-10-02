const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createProject } = require('@live2pet/project');
const { SyntheticRenderer } = require('@live2pet/renderer');
const { CacheStore, buildProjectTargets } = require('@live2pet/package-build');
const { createHostedBuildService } = require('../hosted-build-service.cjs');
const { createPlannedBuildService } = require('../planned-build-service.cjs');
const { createAnimationExportService, normalizeAnimationRender } = require('../animation-export-service.cjs');
const sharp = require('node:module').createRequire(require.resolve('@live2pet/package-build'))('sharp');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'live2pet-animation-export-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const cache = new CacheStore({ rootDir: root, maxBytes: 8 * 1024 * 1024 });
  const context = { runtimeVersion: 'b'.repeat(64), rendererVersion: 'synthetic-v1', targetVersion: '1', encoderVersion: 'sharp-test' };
  const project = createProject({ projectId: 'animations', name: 'Animations', source: { kind: 'standard-directory', name: 'fixture', fingerprint: 'a'.repeat(64) } });
  let captures = 0;
  let acquisitions = 0;
  const hosted = createHostedBuildService({ buildProject: buildProjectTargets, previewSession: { withRenderer: async (_input, operation) => {
    acquisitions++;
    const renderer = new SyntheticRenderer();
    await renderer.load({ motions: [{ id: 'idle', duration: 0.2 }, { id: 'wave', duration: 0.2 }] });
    renderer.setVisualSettings = async () => {};
    const capture = renderer.captureRgba.bind(renderer);
    renderer.captureRgba = options => { captures++; return capture(options); };
    return operation(renderer);
  } } });
  const options = { getCache: () => cache, resolveContext: async () => context };
  return { project, context, cache, render: { preset: 'compact', width: 32, height: 32, fps: 10, quality: 76 }, exportAnimations: createAnimationExportService({ ...options, withRenderer: hosted.withRenderer }), build: createPlannedBuildService({ ...options, buildProject: hosted }), captures: () => captures, acquisitions: () => acquisitions };
}

test('source review remains required before standalone export', async t => {
  const f = fixture(t);
  f.project.sourceReview = { required: true, affectedRecipeIds: [] };
  await assert.rejects(f.exportAnimations({ project: f.project, motionIds: ['idle'], render: f.render, onAnimation() {} }), { code: 'SOURCE_REVIEW_REQUIRED' });
  assert.equal(f.captures(), 0);
});

test('exports without mappings; same-spec Clawd build reuses encoded animation without capture', async t => {
  const f = fixture(t);
  let bytes;
  const exported = await f.exportAnimations({ project: f.project, motionIds: ['idle'], render: f.render, onAnimation: asset => { bytes = asset.buffer; } });
  assert.equal(exported.animations.length, 1);
  assert.equal(exported.failures.length, 0);
  assert.ok(bytes.length > 0);
  assert.equal(f.captures(), 2);
  f.project.targets.clawd = { renderPreset: 'compact', options: { sleepMode: 'direct' }, mappings: { idle: 'motion:idle', thinking: 'motion:idle', working: 'motion:idle', sleeping: 'motion:idle' } };
  const built = await f.build({ project: f.project, targets: ['clawd'], inputsByTarget: { clawd: { render: f.render } }, optionsByTarget: { clawd: { package: true } } });
  assert.equal(built.builds.clawd.cache.hits, 1);
  assert.equal(f.captures(), 2);
  assert.equal(f.acquisitions(), 1);
});

test('quality and loop changes reuse raw frames; fps and visibility invalidate capture', async t => {
  const f = fixture(t);
  const run = render => f.exportAnimations({ project: f.project, motionIds: ['idle'], render, onAnimation() {} });
  await run(f.render);
  const changedQuality = await run({ ...f.render, quality: 50 });
  assert.equal(changedQuality.failures.length, 0);
  assert.equal(changedQuality.cache.hits, 0);
  assert.equal(f.captures(), 2);
  await run({ ...f.render, loop: false });
  assert.equal(f.captures(), 2);
  await run({ ...f.render, fps: 20 });
  assert.equal(f.captures(), 6);
  f.project.visualSettings = { hiddenElementIds: ['background'] };
  await run(f.render);
  assert.equal(f.captures(), 8);
});

test('preset label does not invalidate identical effective specifications', async t => {
  const f = fixture(t);
  await f.exportAnimations({ project: f.project, motionIds: ['idle'], render: f.render, onAnimation() {} });
  const next = await f.exportAnimations({ project: f.project, motionIds: ['idle'], render: { ...f.render, preset: 'high' }, onAnimation() {} });
  assert.equal(next.cache.hits, 1);
  assert.equal(f.acquisitions(), 1);
});

test('batch reports per-motion failures and keeps successful outputs', async t => {
  const f = fixture(t);
  const result = await f.exportAnimations({ project: f.project, motionIds: ['unknown', 'idle'], render: f.render, onAnimation: () => ({ path: '/chosen/idle.webp' }) });
  assert.equal(result.failures[0].code, 'UNKNOWN_MOTION');
  assert.equal(result.animations[0].path, '/chosen/idle.webp');
});

test('cancellation prevents publishing cached output', async t => {
  const f = fixture(t);
  await f.exportAnimations({ project: f.project, motionIds: ['idle'], render: f.render, onAnimation() {} });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(f.exportAnimations({ project: f.project, motionIds: ['idle'], render: f.render, signal: controller.signal, onAnimation() { assert.fail('must not publish'); } }), { code: 'BUILD_CANCELLED' });
});

test('runtime change before output prevents publishing or caching stale captures', async t => {
  const f = fixture(t);
  let resolves = 0;
  const service = createAnimationExportService({ getCache: () => f.cache, resolveContext: async () => ({ ...f.context, runtimeVersion: (++resolves > 1 ? 'c' : 'b').repeat(64) }), withRenderer: async (_input, operation) => {
    const renderer = new SyntheticRenderer();
    await renderer.load({ motions: [{ id: 'idle', duration: 0.2 }] });
    return operation(renderer);
  } });
  await assert.rejects(service({ project: f.project, motionIds: ['idle'], render: f.render, onAnimation() { assert.fail('must not publish'); } }), { code: 'BUILD_INPUT_CHANGED' });
});

test('Clawd build animations are reusable by export without mapping requirements', async t => {
  const f = fixture(t);
  f.project.targets.clawd = { renderPreset: 'compact', options: { sleepMode: 'direct' }, mappings: { idle: 'motion:idle', thinking: 'motion:idle', working: 'motion:idle', sleeping: 'motion:idle' } };
  await f.build({ project: f.project, targets: ['clawd'], inputsByTarget: { clawd: { render: f.render } }, optionsByTarget: { clawd: { package: true } } });
  const acquisitions = f.acquisitions();
  f.project.targets = {};
  const result = await f.exportAnimations({ project: f.project, motionIds: ['idle'], render: f.render, onAnimation() {} });
  assert.equal(result.cache.hits, 1);
  assert.equal(f.acquisitions(), acquisitions);
});

test('WebP to APNG reuses raw frames; APNG to Clawd reuses encoded frames', async t => {
  const f = fixture(t);
  await f.exportAnimations({ project: f.project, motionIds: ['idle'], render: f.render, onAnimation() {} });
  const apng = await f.exportAnimations({ project: f.project, motionIds: ['idle'], render: { ...f.render, format: 'apng' }, onAnimation(asset) { assert.equal(asset.format, 'apng'); } });
  assert.equal(apng.failures.length, 0);
  assert.equal(f.captures(), 2);
  f.project.targets.clawd = { renderPreset: 'compact', options: { sleepMode: 'direct' }, mappings: { idle: 'motion:idle', thinking: 'motion:idle', working: 'motion:idle', sleeping: 'motion:idle' } };
  const acquisitions = f.acquisitions();
  const built = await f.build({ project: f.project, targets: ['clawd'], inputsByTarget: { clawd: { render: f.render } }, optionsByTarget: { clawd: { package: true, format: 'apng' } } });
  assert.equal(built.builds.clawd.cache.hits, 1);
  assert.equal(built.builds.clawd.encoding.format, 'apng');
  assert.equal(f.acquisitions(), acquisitions);
});

test('validates output dimensions and encoding options before renderer work', () => {
  assert.equal(normalizeAnimationRender().width, 768);
  for (const render of [{ width: 2049 }, { fps: 61 }, { quality: 0 }, { loop: 1 }, { lossless: 1 }, { durations: {} }]) assert.throws(() => normalizeAnimationRender(render));
});

test('encoded WebP metadata preserves dimensions, frame timing, alpha, and loop choice', async t => {
  const f = fixture(t);
  for (const loop of [true, false]) {
    let bytes;
    const result = await f.exportAnimations({ project: f.project, motionIds: ['idle'], render: { ...f.render, width: 64, height: 48, fps: 20, lossless: true, loop }, onAnimation(asset) { bytes = asset.buffer; } });
    assert.equal(result.failures.length, 0);
    const metadata = await sharp(bytes, { animated: true }).metadata();
    assert.equal(metadata.width, 64);
    assert.equal(metadata.pageHeight, 48);
    assert.equal(metadata.pages, 4);
    assert.equal(metadata.hasAlpha, true);
    assert.deepEqual(metadata.delay, [50, 50, 50, 50]);
    assert.equal(metadata.loop, loop ? 0 : 1);
  }
});

test('animation renderer leases queue behind pet captures and queued cancellation does not acquire', async () => {
  let release;
  let entered;
  const started = new Promise(resolve => { entered = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  let acquisitions = 0;
  const hosted = createHostedBuildService({ previewSession: { withRenderer: async (_input, operation) => { acquisitions++; return operation({}); } }, buildProject: async input => input.inputsByTarget.clawd.withCaptureRenderer(async () => { entered(); await gate; }) });
  const project = { projectId: 'queued', source: { fingerprint: 'a'.repeat(64) } };
  const build = hosted({ project, targets: ['clawd'] });
  await started;
  const events = [];
  const controller = new AbortController();
  const exporting = hosted.withRenderer({ project, signal: controller.signal, onProgress: event => events.push(event) }, () => assert.fail('cancelled export acquired renderer'));
  controller.abort();
  await assert.rejects(exporting, { code: 'BUILD_CANCELLED' });
  assert.equal(events[0].stage, 'queue');
  release();
  await build;
  await hosted.withRenderer({ project }, () => {});
  assert.equal(acquisitions, 2);
});
