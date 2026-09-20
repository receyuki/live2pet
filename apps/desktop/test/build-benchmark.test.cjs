const assert = require('node:assert/strict');
const test = require('node:test');
const vm = require('node:vm');
const { summarizeProgress, readArtifactChunk, inspectPackage, cancelDuringCapture } = require('../scripts/benchmark-project-build.cjs');

test('benchmark cancels actual capture through the preload and the same host immediately builds a retry', async () => {
  const { EventEmitter } = require('node:events');
  const { createAppIpcRouter, createAppPreloadApi, APP_BUILD_PROGRESS_CHANNEL } = require('../../../packages/app-host/src/index.cjs');
  const { createProject } = require('../../../packages/project/src/index.cjs');
  const { SyntheticRenderer } = require('../../../packages/renderer/src/index.cjs');
  const { buildProjectTargets } = require('../../../packages/package-build/src/index.cjs');
  const renderer = new SyntheticRenderer();
  await renderer.load({ motions: [{ id: 'private-motion', duration: 0.1 }] });
  const bus = new EventEmitter();
  const router = createAppIpcRouter({
    onBuildProgress: event => bus.emit(APP_BUILD_PROGRESS_CHANNEL, {}, event),
    buildProjectService: input => buildProjectTargets({ ...input, inputsByTarget: { clawd: { ...input.inputsByTarget.clawd, renderer } } }),
  });
  bus.invoke = (_channel, request) => router(request);
  const api = createAppPreloadApi({ ipcRenderer: bus });
  const project = createProject({ projectId: 'cancel-benchmark', name: 'Test', source: { kind: 'standard-directory', name: 'fixture', fingerprint: 'a'.repeat(64) }, targets: {
    clawd: { mappings: { idle: 'motion:private-motion', thinking: 'motion:private-motion', working: 'motion:private-motion', sleeping: 'motion:private-motion' } },
  } });
  const input = { project, targets: ['clawd'], inputsByTarget: { clawd: { render: { preset: 'compact', width: 128, height: 128, samples: 2 } } }, optionsByTarget: { clawd: { package: true } } };
  Object.assign(input, { requestId: 'benchmark-cancel', projectId: project.projectId, snapshotFingerprint: require('node:crypto').createHash('sha256').update(JSON.stringify(project)).digest('hex') });
  const run = vm.runInNewContext(`(${cancelDuringCapture.toString()})`, { window: { live2pet: api }, performance });
  const cancelled = await run(input);
  assert.equal(cancelled.cancelled, true);
  assert.ok(cancelled.responseMs >= 0);
  assert.equal(bus.listenerCount(APP_BUILD_PROGRESS_CHANNEL), 0);
  const retry = await api.buildProject({ ...input, requestId: 'benchmark-retry' });
  assert.equal(retry.ok, true);
  assert.equal(retry.result.builds.clawd.validation.ok, true);
  assert.ok(retry.result.artifacts[0].byteLength > 0);
});

test('benchmark inspects a Node Buffer ZIP without treating its view as a split archive', async () => {
  const { ZipWriter, Uint8ArrayWriter, Uint8ArrayReader } = require('@zip.js/zip.js');
  const sharp = require('sharp');
  const writer = new ZipWriter(new Uint8ArrayWriter());
  const webp = await sharp({ create: { width: 2, height: 2, channels: 4, background: '#ff000080' } }).webp().toBuffer();
  await writer.add('fixture.webp', new Uint8ArrayReader(webp));
  const archive = Buffer.from(await writer.close());
  const [image] = await inspectPackage(archive);
  assert.equal(image.width, 2);
  assert.equal(image.hasAlpha, true);
  assert.equal(image.samples[0].visiblePixels, 4);
});

test('benchmark downloads binary chunks through the public preload argument contract', async () => {
  const bytes = Uint8Array.from({ length: 70000 }, (_, index) => index % 256);
  const read = vm.runInNewContext(`(${readArtifactChunk.toString()})`, {
    btoa,
    window: { live2pet: { getBuildArtifact: async (artifactId, offset) => {
      assert.equal(artifactId, 'artifact-1');
      assert.equal(offset, 4096);
      return { ok: true, result: { bytes, nextOffset: 4096 + bytes.length } };
    } } },
  });
  const result = await read({ artifactId: 'artifact-1', offset: 4096 });
  assert.equal(result.nextOffset, 74096);
  assert.deepEqual(Buffer.from(result.base64, 'base64'), Buffer.from(bytes));
});

test('benchmark reports overlapping intervals separately and omits private Motion names', () => {
  const summary = summarizeProgress([
    { target: 'clawd', stage: 'encode', status: 'started', at: 100 },
    { target: 'clawd', stage: 'encode', status: 'motion-started', motionId: 'private-motion', at: 110 },
    { target: 'clawd', stage: 'encode', status: 'motion-completed', motionId: 'private-motion', cache: 'miss', at: 150 },
    { target: 'clawd', stage: 'encode', status: 'completed', at: 160 },
  ]);
  assert.deepEqual(summary.stageIntervals.map(interval => [interval.scope, interval.startMs, interval.endMs]), [
    ['motion', 10, 50], ['target', 0, 60],
  ]);
  assert.equal(summary.encodedAnimations, 1);
  assert.equal(JSON.stringify(summary).includes('private-motion'), false);
});

test('benchmark counts newly encoded Codex atlases separately from cached atlases', () => {
  const result = summarizeProgress([
    { target: 'codex-pet', stage: 'encode', status: 'completed', cacheHits: 0, cacheMisses: 1, at: 10 },
    { target: 'codex-pet', stage: 'encode', status: 'completed', cacheHits: 1, cacheMisses: 0, at: 20 },
  ]);
  assert.equal(result.encodedAtlases, 1);
  assert.equal(result.encodedAnimations, 0);
});

test('benchmark retry measurements exclude late progress from a cancelled request', () => {
  const result = summarizeProgress([
    { requestId: 'cancelled', target: 'clawd', stage: 'render', status: 'frame-completed', at: 10 },
    { requestId: 'retry', target: 'clawd', stage: 'render', status: 'started', at: 20 },
    { requestId: 'retry', target: 'clawd', stage: 'render', status: 'frame-completed', at: 30 },
    { requestId: 'retry', target: 'clawd', stage: 'render', status: 'completed', at: 40 },
  ], 'retry');
  assert.equal(result.capturedFrames, 1);
  assert.deepEqual(result.stageIntervals.map(value => [value.startMs, value.endMs]), [[0, 20]]);
});
test('benchmark accepts inspected Spine JSON and hydrated binary catalogs, but rejects failed preview', () => {
  const { verifySpineBenchmarkMotions } = require('../scripts/benchmark-project-build.cjs');
  const inspection = { motions: [{ id: 'idle' }] };
  verifySpineBenchmarkMotions({ state: 'ready' }, inspection, ['idle']);
  verifySpineBenchmarkMotions({ state: 'ready', catalog: inspection }, { motions: [] }, ['idle']);
  assert.throws(() => verifySpineBenchmarkMotions({ state: 'failed' }, inspection, ['idle']), /preview/);
  assert.throws(() => verifySpineBenchmarkMotions({ state: 'ready' }, inspection, ['missing']), /Motion/);
});
