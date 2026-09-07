const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const test = require('node:test');
const { createElectronWebContentsPage } = require('@live2pet/renderer');

const {
  PreviewSessionError,
  createPreviewSessionService,
  normalizeBounds,
} = require('../preview-session-service.cjs');

const FINGERPRINT = 'a'.repeat(64);

function manifest(overrides = {}) {
  return {
    source: { kind: 'standard-directory', fingerprint: FINGERPRINT, modelConfig: 'character.model3.json' },
    model: { cubism: 4 },
    motions: [{ id: 'Idle:0', group: 'Idle', index: 0, name: 'Idle', duration: 1 }],
    expressions: [{ id: 'smile', name: 'Smile' }],
    ...overrides,
  };
}

function fixture({ source = null, runtime = { runtimePath: '/private/runtime/Live2DCubismCore.js' }, loadError = null, spine = false } = {}) {
  const calls = [];
  const statuses = [];
  const webContents = new EventEmitter();
  webContents.closed = false;
  webContents.isDestroyed = () => webContents.closed;
  webContents.close = () => { webContents.closed = true; webContents.emit('destroyed'); };
  const view = {
    webContents,
    bounds: null,
    visible: null,
    setBounds(next) { this.bounds = next; calls.push(['bounds', next]); },
    setVisible(next) { this.visible = next; calls.push(['visible', next]); },
  };
  const ownerWindow = {
    contentView: {
      children: [],
      addChildView(child) { this.children.push(child); calls.push(['add']); },
      removeChildView(child) { this.children = this.children.filter((item) => item !== child); calls.push(['remove']); },
    },
  };
  const playback = { loaded: true, motionId: null, expressionId: null, playing: false, loop: true, speed: 1 };
  const adapter = {
    async load(rendererSource) { calls.push(['adapter.load', rendererSource]); },
    async unload() { calls.push(['adapter.unload']); },
    async playMotion(motionId, options) { Object.assign(playback, { motionId, playing: true, loop: options.loop, speed: options.speed }); calls.push(['play', motionId, options]); },
    async setExpression(expressionId) { playback.expressionId = expressionId; calls.push(['expression', expressionId]); },
    async pause() { playback.playing = false; calls.push(['pause']); },
    async resume() { playback.playing = true; calls.push(['resume']); },
    async restart() { playback.playing = true; calls.push(['restart']); },
    async resize(width, height) { calls.push(['resize', width, height]); },
    getState() { return { ...playback }; },
    getMotions() { return spine ? [{ id: 'idle', group: 'animations', index: 0, name: 'idle', duration: 1 }] : resolvedSource.manifest.motions; },
    getVisualElements() { return [{ id: 'BG', name: 'Background', kind: 'part' }]; },
    async getVisualElementThumbnail(id) { calls.push(['thumbnail', id]); return { id, dataUrl: null }; },
    async scanVisualElements(motionId) { calls.push(['scan', motionId]); playback.playing = false; playback.time = 0; return { motionId, candidates: [] }; },
    async readState() { return { ...playback }; },
    async setVisualSettings(settings) { calls.push(['visualSettings', settings]); },
  };
  const server = {
    baseUrl: 'http://127.0.0.1:3210',
    previewUrl: 'http://127.0.0.1:3210/preview',
    async close() { calls.push(['server.close']); },
  };
  const resolvedSource = source || { inputPath: '/private/models/character', sourceFingerprint: FINGERPRINT, manifest: spine ? manifest({
    source: { kind: 'spine-directory', fingerprint: FINGERPRINT, modelConfig: 'hero.json' },
    model: { format: 'spine', runtimeLine: '4.3', modelFile: 'hero.json', atlasFile: 'hero.atlas', textures: ['hero.png'] },
    motions: [], expressions: [], visualElements: [],
  }) : manifest() };
  const service = createPreviewSessionService({
    ownerWindow,
    createView: async (input) => { calls.push(['createView', input]); return view; },
    resolveSource: async (input) => { calls.push(['resolveSource', input]); return resolvedSource; },
    resolveRuntime: async (generation) => { calls.push(['resolveRuntime', generation]); return runtime; },
    resolveSpinePack: async (line) => { calls.push(['resolveSpinePack', line]); return { scriptPath: '/private/spine/spine-player.js', stylePath: '/private/spine/spine-player.css' }; },
    parsePck: async (...args) => { calls.push(['parsePck', ...args]); return { buffers: new Map([['model.json', Buffer.from('{}')]]) }; },
    createAssetServer: async (input) => { calls.push(['server', input]); return server; },
    createPage: async (input) => { calls.push(['page', input]); return { evaluate() {} }; },
    createAdapter: async (input) => { calls.push(['adapter', input]); return adapter; },
    createSpineAdapter: async (input) => { calls.push(['spineAdapter', input]); return adapter; },
    createRendererSource: async (inputManifest, options) => { calls.push(['rendererSource', inputManifest, options]); return { modelUrl: `${options.baseUrl}/character.model3.json`, cubismVersion: 4, motions: inputManifest.motions, expressions: inputManifest.expressions }; },
    createSpineRendererSource: async (inputManifest, options) => { calls.push(['spineRendererSource', inputManifest, options]); return { format: 'spine', runtimeLine: '4.3', skeletonUrl: `${options.baseUrl}/hero.json`, atlasUrl: `${options.baseUrl}/hero.atlas`, motions: inputManifest.motions, slots: inputManifest.visualElements }; },
    loadPage: async (input) => { calls.push(['loadPage', input.url]); if (loadError) throw loadError; },
    vendorPaths: { pixi: '/vendor/pixi.js', unsafeEval: '/vendor/unsafe-eval.js', live2dAdapter: '/vendor/adapter.js' },
    onStatus: (status) => statuses.push(status),
  });
  return { adapter, calls, ownerWindow, playback, server, service, statuses, view, webContents };
}

test('normalizes preview bounds to safe integer limits', () => {
  assert.deepEqual(normalizeBounds({ x: -10, y: 2.6, width: 12, height: 9000 }), { x: 0, y: 3, width: 64, height: 4096 });
  assert.deepEqual(normalizeBounds({ x: 'bad', y: Infinity, width: NaN, height: null }), { x: 0, y: 0, width: 64, height: 64 });
  assert.throws(() => normalizeBounds(null), (error) => error instanceof PreviewSessionError && error.code === 'INVALID_PREVIEW_BOUNDS');
});

test('opens Spine in its isolated renderer pack without resolving a Cubism runtime', async () => {
  const { calls, service } = fixture({ spine: true });
  const result = await service.open({ projectId: 'project-1', sourceFingerprint: FINGERPRINT, bounds: { x: 0, y: 0, width: 512, height: 512 } });
  assert.equal(result.state, 'ready');
  assert.deepEqual(result.catalog.motions.map((motion) => motion.id), ['idle']);
  assert.equal(calls.some(([name]) => name === 'resolveRuntime'), false);
  assert.deepEqual(calls.find(([name]) => name === 'resolveSpinePack'), ['resolveSpinePack', '4.3']);
  assert.deepEqual(calls.find(([name]) => name === 'server')[1].spineAssets, { script: '/private/spine/spine-player.js', style: '/private/spine/spine-player.css' });
  assert.equal(calls.some(([name]) => name === 'spineAdapter'), true);
  assert.equal(calls.some(([name]) => name === 'spineRendererSource'), true);
  await service.close();
});

test('opens with project visibility and serializes manual visibility edits', async () => {
  const { service, calls } = fixture();
  await service.open({ projectId: 'project-1', sourceFingerprint: FINGERPRINT, bounds: { x: 0, y: 0, width: 512, height: 512 }, visualSettings: { hiddenElementIds: ['BG'] } });
  assert.deepEqual(await service.getVisualElements(), [{ id: 'BG', name: 'Background', kind: 'part' }]);
  assert.deepEqual(await service.getVisualElementThumbnail({ id: 'BG' }), { id: 'BG', dataUrl: null });
  assert.deepEqual(await service.scanVisualElements({ motionId: 'Idle:0' }), { motionId: 'Idle:0', candidates: [] });
  assert.deepEqual(calls.find(([name]) => name === 'scan'), ['scan', 'Idle:0']);
  assert.throws(() => service.getVisualElementThumbnail({ id: '' }), { code: 'INVALID_VISUAL_SETTINGS' });
  assert.deepEqual(calls.find(([name]) => name === 'visualSettings')[1], { hiddenElementIds: ['BG'] });
  await service.setVisualSettings({ hiddenElementIds: [] });
  assert.deepEqual(calls.filter(([name]) => name === 'visualSettings').at(-1)[1], { hiddenElementIds: [] });
  assert.throws(() => service.setVisualSettings({ hiddenElementIds: [42] }), { code: 'INVALID_VISUAL_SETTINGS' });
  assert.equal(service.getStatus().state, 'ready');
  await service.close();
});

test('opens a directory Source in an attached view and exposes playback controls', async () => {
  const { calls, ownerWindow, service, view, webContents } = fixture();
  const opened = await service.open({ projectId: 'project-1', sourceFingerprint: FINGERPRINT.toUpperCase(), bounds: { x: 12, y: 18, width: 800.4, height: 600.6 } });

  assert.equal(opened.state, 'ready');
  assert.equal(opened.sourceFingerprint, FINGERPRINT);
  assert.deepEqual(opened.bounds, { x: 12, y: 18, width: 800, height: 601 });
  assert.equal(ownerWindow.contentView.children[0], view);
  const serverInput = calls.find(([name]) => name === 'server')[1];
  assert.equal(serverInput.sourceRoot, '/private/models/character');
  assert.equal(serverInput.runtimePath, '/private/runtime/Live2DCubismCore.js');
  assert.deepEqual(serverInput.previewAssets, { pixi: '/vendor/pixi.js', unsafeEval: '/vendor/unsafe-eval.js', live2dAdapter: '/vendor/adapter.js' });
  assert.deepEqual(calls.find(([name]) => name === 'resolveSource')[1], { projectId: 'project-1', sourceFingerprint: FINGERPRINT });
  assert.equal(calls.find(([name]) => name === 'resolveRuntime')[1], 4);
  assert.equal(calls.find(([name]) => name === 'loadPage')[1], 'http://127.0.0.1:3210/preview');
  assert.equal(calls.find(([name]) => name === 'adapter')[1].playbackMode, 'realtime');
  let blockedNavigation = false;
  webContents.emit('will-navigate', { preventDefault: () => { blockedNavigation = true; } }, 'https://example.com/');
  assert.equal(blockedNavigation, true);

  await service.play({ motionId: 'Idle:0', loop: false, speed: 1.5 });
  await service.setExpression({ expressionId: 'smile' });
  await service.control({ action: 'pause' });
  assert.deepEqual(service.getStatus().playback, { loaded: true, motionId: 'Idle:0', expressionId: 'smile', playing: false, loop: false, speed: 1.5 });
  await service.control({ action: 'resume' });
  await service.control({ action: 'restart' });
  await service.setExpression({ expressionId: null });
  const laidOut = await service.layout({ visible: false, bounds: { x: 5, y: 7, width: 700, height: 500 } });
  assert.equal(laidOut.visible, false);
  assert.deepEqual(view.bounds, { x: 5, y: 7, width: 700, height: 500 });
  assert.ok(calls.some(([name, width, height]) => name === 'resize' && width === 700 && height === 500));
  assert.equal(view.visible, false);
  assert.equal((await service.layout({ visible: true })).visible, true);

  const closed = await service.close();
  assert.equal(closed.state, 'idle');
  assert.equal(ownerWindow.contentView.children.length, 0);
  assert.equal(webContents.closed, true);
  assert.ok(calls.some(([name]) => name === 'adapter.unload'));
  assert.ok(calls.some(([name]) => name === 'server.close'));
});

test('parses a PCK into buffers instead of exposing its file path to the server', async () => {
  const pckManifest = manifest({ source: { kind: 'pck', fingerprint: FINGERPRINT, modelConfig: 'model.json' }, model: { cubism: 2 } });
  const { calls, service } = fixture({ source: { inputPath: '/private/models/character.pck', sourceFingerprint: FINGERPRINT, manifest: pckManifest } });
  await service.open({ projectId: 'pck-project', sourceFingerprint: FINGERPRINT, bounds: { x: 0, y: 0, width: 512, height: 512 } });

  assert.equal(calls.find(([name]) => name === 'parsePck')[1], '/private/models/character.pck');
  const serverInput = calls.find(([name]) => name === 'server')[1];
  assert.ok(serverInput.sourceBuffers instanceof Map);
  assert.equal(Object.hasOwn(serverInput, 'sourceRoot'), false);
  assert.equal(calls.find(([name]) => name === 'resolveRuntime')[1], 2);
  await service.close();
});

test('rejects a mismatched Source identity before opening renderer resources', async () => {
  const { calls, service } = fixture({ source: { inputPath: '/private/models/character', sourceFingerprint: 'b'.repeat(64), manifest: manifest({ source: { kind: 'standard-directory', fingerprint: 'b'.repeat(64), modelConfig: 'model.json' } }) } });
  await assert.rejects(
    service.open({ projectId: 'project-1', sourceFingerprint: FINGERPRINT, bounds: { x: 0, y: 0, width: 512, height: 512 } }),
    (error) => error instanceof PreviewSessionError && error.code === 'PREVIEW_SOURCE_MISMATCH',
  );
  assert.equal(service.getStatus().state, 'failed');
  assert.equal(calls.some(([name]) => name === 'server'), false);
});

test('reports missing registered Source and saved runtime with failed cleanup states', async () => {
  const missingSource = fixture({ source: {} });
  await assert.rejects(
    missingSource.service.withRenderer({ projectId: 'project-1', sourceFingerprint: FINGERPRINT }, async () => null),
    (error) => error.code === 'PREVIEW_SOURCE_NOT_FOUND',
  );
  assert.equal(missingSource.service.getStatus().state, 'failed');
  assert.equal(missingSource.ownerWindow.contentView.children.length, 0);

  const missingRuntime = fixture({ runtime: null });
  await assert.rejects(
    missingRuntime.service.withRenderer({ projectId: 'project-1', sourceFingerprint: FINGERPRINT }, async () => null),
    (error) => error.code === 'PREVIEW_RUNTIME_UNAVAILABLE',
  );
  assert.equal(missingRuntime.service.getStatus().state, 'failed');
  assert.equal(missingRuntime.ownerWindow.contentView.children.length, 0);
});

test('redacts local paths from open failures and tears down partial resources', async () => {
  const { calls, service, webContents } = fixture({ loadError: new Error('Could not load /Users/RY/private/model.json') });
  await assert.rejects(
    service.open({ projectId: 'project-1', sourceFingerprint: FINGERPRINT, bounds: { x: 0, y: 0, width: 512, height: 512 } }),
    (error) => error.code === 'PREVIEW_OPEN_FAILED' && error.message.includes('<redacted-path>') && !error.message.includes('/Users/RY'),
  );
  const status = service.getStatus();
  assert.equal(status.state, 'failed');
  assert.equal(status.visible, false);
  assert.equal(JSON.stringify(status).includes('/Users/RY'), false);
  assert.equal(webContents.closed, true);
  assert.ok(calls.some(([name]) => name === 'server.close'));
});

test('turns a WebContentsView process failure into a failed, cleaned-up session', async () => {
  const { calls, ownerWindow, service, statuses, webContents } = fixture();
  await service.open({ projectId: 'project-1', sourceFingerprint: FINGERPRINT, bounds: { x: 0, y: 0, width: 512, height: 512 } });
  webContents.emit('render-process-gone', {}, { reason: 'crashed' });
  await new Promise((resolve) => setImmediate(resolve));

  const status = service.getStatus();
  assert.equal(status.state, 'failed');
  assert.equal(status.error.code, 'PREVIEW_PROCESS_GONE');
  assert.equal(ownerWindow.contentView.children.length, 0);
  assert.equal(webContents.closed, true);
  assert.ok(calls.some(([name]) => name === 'server.close'));
  assert.equal(statuses.at(-1).state, 'failed');
});

test('validates control input without destroying a ready session', async () => {
  const { service } = fixture();
  await service.open({ projectId: 'project-1', sourceFingerprint: FINGERPRINT, bounds: { x: 0, y: 0, width: 512, height: 512 } });
  await assert.rejects(service.play({ motionId: 'Idle:0', speed: 99 }), (error) => error.code === 'INVALID_PREVIEW_REQUEST');
  await assert.rejects(service.control({ action: 'seek' }), (error) => error.code === 'INVALID_PREVIEW_CONTROL');
  assert.equal(service.getStatus().state, 'ready');
  await service.close();
});

test('a dead renderer does not block failure notification waiting for unload JavaScript', async () => {
  const { adapter, service, statuses, webContents } = fixture();
  await service.open({ projectId: 'project-1', sourceFingerprint: FINGERPRINT, bounds: { x: 0, y: 0, width: 512, height: 512 } });
  let unloadCalled = false;
  adapter.unload = () => { unloadCalled = true; return new Promise(() => {}); };
  webContents.emit('render-process-gone', {}, { reason: 'crashed' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(statuses.at(-1).state, 'failed', 'UI must receive the failure even when the dead page cannot execute unload');
  assert.equal(webContents.closed, true);
  assert.equal(unloadCalled, false);
  await service.close();
  assert.equal(service.getStatus().state, 'idle');
});

test('renderer crash settles an in-flight status poll so Retry is not queued forever', async () => {
  const { adapter, service, statuses, webContents } = fixture();
  await service.open({ projectId: 'project-1', sourceFingerprint: FINGERPRINT, bounds: { x: 0, y: 0, width: 512, height: 512 } });
  webContents.executeJavaScript = () => new Promise(() => {});
  const page = createElectronWebContentsPage({ webContents });
  adapter.readState = () => page.evaluate(() => ({}));
  adapter.unload = () => page.evaluate(() => null);
  const polling = service.readStatus().catch((error) => error);
  await new Promise((resolve) => setImmediate(resolve));
  webContents.emit('render-process-gone', {}, { reason: 'crashed' });
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(statuses.at(-1).state, 'failed', 'failed status must reach the UI while executeJavaScript is unresolved');
  assert.equal((await polling).code, 'PREVIEW_PROCESS_GONE');
  delete adapter.readState;
  delete adapter.unload;
  webContents.closed = false;
  const retry = await service.open({ projectId: 'project-1', sourceFingerprint: FINGERPRINT, bounds: { x: 0, y: 0, width: 512, height: 512 } });
  assert.equal(retry.state, 'ready');
  await service.close();
});

test('withRenderer reuses a matching session, hides it, and serializes preview commands', async () => {
  const { adapter, calls, service, view } = fixture();
  await service.open({ projectId: 'project-1', sourceFingerprint: FINGERPRINT, bounds: { x: 0, y: 0, width: 512, height: 512 } });
  let releaseCapture;
  const capture = service.withRenderer({ projectId: 'project-1', sourceFingerprint: FINGERPRINT }, async (renderer) => {
    assert.equal(renderer, adapter);
    await new Promise((resolve) => { releaseCapture = resolve; });
    calls.push(['capture.done']);
  });
  const play = service.play({ motionId: 'Idle:0' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(view.visible, false);
  assert.equal(calls.some(([name]) => name === 'play'), false);
  releaseCapture();
  await capture;
  await play;
  assert.ok(calls.findIndex(([name]) => name === 'capture.done') < calls.findIndex(([name]) => name === 'play'));
  assert.equal(calls.filter(([name]) => name === 'createView').length, 1);
});

test('withRenderer opens a new matching session hidden and leaves it ready for reuse', async () => {
  const { adapter, service, view } = fixture();
  const result = await service.withRenderer({ projectId: 'project-1', sourceFingerprint: FINGERPRINT, bounds: { x: 2, y: 3, width: 600, height: 500 } }, async (renderer) => renderer === adapter);
  assert.equal(result, true);
  assert.equal(view.visible, false);
  assert.deepEqual(service.getStatus(), { schemaVersion: 1, state: 'ready', projectId: 'project-1', sourceFingerprint: FINGERPRINT, visible: false, bounds: { x: 2, y: 3, width: 600, height: 500 }, playback: { loaded: true, motionId: null, expressionId: null, playing: false, loop: true, speed: 1 } });
});
