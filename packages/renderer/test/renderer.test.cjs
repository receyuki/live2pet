const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  CONTRACT_METHODS,
  DEFAULT_OPTIONS,
  RENDERER_IPC_CHANNEL,
  RendererContractError,
  LegacyPixiLive2dAdapter,
  PixiLive2dAdapter,
  createPixiLive2dAdapter,
  createRendererAdapter,
  SyntheticRenderer,
  assertRenderer,
  createRendererCsp,
  createRendererCspMeta,
  createElectronWebContentsPage,
  createRendererIpcRouter,
  createRendererPreloadApi,
  createRendererRealmHost,
  RENDERER_REALM_STATES,
  createRendererWindowOptions,
  createRendererAssetServer,
  safeRelativePath,
  normalizePixiSource,
  pageCapture,
  pageLoad,
  pagePause,
  pagePlayMotion,
  pageResume,
  pageStep,
  pageUnload,
  pixiSourceFromManifest,
  selectPixiLive2dAdapter,
  selectRendererAdapter,
  sampleMotionCandidates,
} = require('../src/index.cjs');

function source() {
  return {
    motions: [
      { id: 'Base:idle', name: 'Idle', duration: 2 },
      { id: 'Base:wave', name: 'Wave', duration: 1.25 },
    ],
    expressions: [{ id: 'smile', name: 'Smile', runtimeId: 'smile_runtime' }],
  };
}

function pixiSource() {
  return {
    modelUrl: '/source/saint-louis.model3.json',
    cubismVersion: 4,
    motions: [
      { id: 'Base:idle', name: 'Idle', group: 'Base', index: 0, duration: 2 },
      { id: 'Base:wave', name: 'Wave', group: 'Base', index: 1, duration: 1.25 },
    ],
    expressions: [{ id: 'smile', name: 'Smile', runtimeId: 'smile_runtime' }],
  };
}

class FakePixiPage {
  constructor() {
    this.calls = [];
  }

  async evaluate(fn, ...args) {
    this.calls.push({ name: fn.name, args });
    const state = {
      contractVersion: 1,
      loaded: true,
      motionId: 'Base:idle',
      expressionId: null,
      time: 0,
      playing: false,
      loop: true,
      speed: 1,
    };
    if (fn.name === 'pageLoad') return { state, width: 512, height: 512 };
    if (fn.name === 'pagePlayMotion') return { ...state, motionId: args[0], time: args[3], playing: true, loop: args[1], speed: args[2] };
    if (fn.name === 'pagePause') return { ...state, playing: false };
    if (fn.name === 'pageResume') return { ...state, playing: true };
    if (fn.name === 'pageRestart') return { ...state, playing: true };
    if (fn.name === 'pageSetPlayback') return { ...state, loop: args[0] === undefined ? state.loop : args[0], speed: args[1] === undefined ? state.speed : args[1] };
    if (fn.name === 'pageSetExpression') return args[0];
    if (fn.name === 'pageStep') return { ...state, motionId: 'Base:wave', time: args[0], playing: true };
    if (fn.name === 'pageBounds') return { motionId: args[0], samples: 1, x: 0.1, y: 0.05, width: 0.8, height: 0.9, normalized: true };
    if (fn.name === 'pageCapture') return { width: args[2], height: args[3], motionId: args[0], time: args[1], rgba: new Array(args[2] * args[3] * 4).fill(255) };
    return { loaded: false };
  }
}

test('synthetic renderer implements the shared playback contract', async () => {
  const renderer = new SyntheticRenderer();
  assertRenderer(renderer);
  assert.equal(CONTRACT_METHODS.length, 13);

  const loaded = await renderer.load(source());
  assert.deepEqual(loaded, { contractVersion: 1, motionCount: 2, expressionCount: 1 });
  await renderer.playMotion('Base:wave', { loop: false, speed: 2 });
  renderer.setExpression('smile');
  let state = renderer.step(0.4);
  assert.equal(state.motionId, 'Base:wave');
  assert.equal(state.expressionId, 'smile');
  assert.equal(state.time, 0.8);
  state = renderer.step(0.5);
  assert.equal(state.time, 1.25);
  assert.equal(state.playing, false);
  renderer.setExpression(null);
  assert.equal(renderer.getState().expressionId, null);
});

test('looping and restart are deterministic', async () => {
  const renderer = new SyntheticRenderer();
  await renderer.load(source());
  await renderer.playMotion('Base:idle', { loop: true, speed: 1 });
  assert.equal(renderer.step(2.5).time, 0.5);
  assert.equal(renderer.restart().time, 0);
  renderer.pause();
  assert.equal(renderer.step(1).time, 0);
  assert.equal(renderer.resume().playing, true);
});

test('bounds cover the sampled motion and RGBA capture is transparent outside the synthetic figure', async () => {
  const renderer = new SyntheticRenderer();
  await renderer.load(source());
  const bounds = renderer.getBounds({ motionId: 'Base:wave', samples: 17 });
  assert.equal(bounds.normalized, true);
  assert.ok(bounds.x >= 0 && bounds.y >= 0);
  assert.ok(bounds.x + bounds.width <= 1 && bounds.y + bounds.height <= 1);

  const first = renderer.captureRgba({ width: 64, height: 48, motionId: 'Base:wave', time: 0.5 });
  const second = renderer.captureRgba({ width: 64, height: 48, motionId: 'Base:wave', time: 0.5 });
  assert.equal(first.rgba.length, 64 * 48 * 4);
  assert.deepEqual(first.rgba, second.rgba);
  assert.ok(first.rgba.some((value, index) => index % 4 === 3 && value > 0));
  assert.ok(first.rgba.some((value, index) => index % 4 === 3 && value === 0));
});

test('contract and source errors are typed', async () => {
  assert.throws(
    () => assertRenderer({}),
    (error) => error instanceof RendererContractError && error.code === 'INCOMPLETE_RENDERER',
  );
  const renderer = new SyntheticRenderer();
  await assert.rejects(
    () => renderer.load({ motions: [{ id: '' }] }),
    (error) => error instanceof RendererContractError && error.code === 'INVALID_RENDER_SOURCE',
  );
  await assert.rejects(
    () => renderer.load({ motions: [{ id: 'idle', duration: 2 }] }).then(() => renderer.playMotion('missing')),
    (error) => error instanceof RendererContractError && error.code === 'MOTION_NOT_FOUND',
  );
});

test('samples deterministic RGBA motion candidates for downstream selection', async () => {
  const renderer = new SyntheticRenderer();
  await renderer.load({ motions: [{ id: 'sample', duration: 1 }] });
  const first = await sampleMotionCandidates(renderer, { motionId: 'sample', duration: 1, samples: 5, width: 32, height: 32 });
  const second = await sampleMotionCandidates(renderer, { motionId: 'sample', duration: 1, samples: 5, width: 32, height: 32 });
  assert.deepEqual(first.candidates.map((candidate) => ({ id: candidate.id, time: candidate.time, bounds: candidate.bounds, visualChange: candidate.visualChange, boundsDelta: candidate.boundsDelta })), second.candidates.map((candidate) => ({ id: candidate.id, time: candidate.time, bounds: candidate.bounds, visualChange: candidate.visualChange, boundsDelta: candidate.boundsDelta })));
  assert.deepEqual(first.candidates.map((candidate) => candidate.time), [0, 0.25, 0.5, 0.75, 1]);
  assert.equal(first.candidates[0].visualChange, 0);
  assert.equal(first.candidates[0].boundsDelta, 0);
  assert.equal(first.candidates[0].rgba.length, 32 * 32 * 4);
  assert.ok(first.candidates.some((candidate) => candidate.visualChange > 0));
  assert.ok(first.candidates.every((candidate) => candidate.bounds && candidate.bounds.width > 0 && candidate.bounds.height > 0));
});

test('samples an Animation Recipe Expression and restores the previous preview Expression', async () => {
  const renderer = new SyntheticRenderer();
  await renderer.load({ motions: [{ id: 'sample', duration: 1 }], expressions: [{ id: 'base', name: 'Base' }, { id: 'smile', name: 'Smile' }] });
  await renderer.setExpression('smile');
  const result = await sampleMotionCandidates(renderer, { motionId: 'sample', expressionId: null, duration: 1, samples: 2, width: 16, height: 16 });
  assert.equal(result.expressionId, null);
  assert.equal(renderer.getState().expressionId, 'smile');
  const withExpression = await sampleMotionCandidates(renderer, { motionId: 'sample', expressionId: 'base', duration: 1, samples: 2, width: 16, height: 16 });
  assert.equal(withExpression.expressionId, 'base');
  assert.equal(renderer.getState().expressionId, 'smile');
});

test('rejects invalid motion sampling inputs', async () => {
  const renderer = new SyntheticRenderer();
  await renderer.load({ motions: [{ id: 'sample', duration: 1 }] });
  await assert.rejects(
    () => sampleMotionCandidates(renderer, { motionId: 'sample', duration: 1, samples: 0 }),
    (error) => error instanceof RendererContractError && error.code === 'INVALID_RENDER_SIZE',
  );
  await assert.rejects(
    () => sampleMotionCandidates(renderer, { motionId: 'missing', duration: 1, samples: 1 }),
    (error) => error instanceof RendererContractError && error.code === 'MOTION_NOT_FOUND',
  );
});

test('normalizes and validates the browser-facing Pixi source shape', () => {
  const normalized = normalizePixiSource(pixiSource());
  assert.equal(normalized.modelUrl, '/source/saint-louis.model3.json');
  assert.equal(normalized.motions[1].group, 'Base');
  assert.equal(normalizePixiSource({ ...pixiSource(), motions: [{ ...pixiSource().motions[0], group: '' }] }).motions[0].group, '');
  assert.throws(
    () => normalizePixiSource({ ...pixiSource(), motions: [{ ...pixiSource().motions[0], id: pixiSource().motions[0].id }, { ...pixiSource().motions[1], id: pixiSource().motions[0].id }] }),
    (error) => error instanceof RendererContractError && error.code === 'INVALID_RENDER_SOURCE',
  );
});

test('converts a normalized inspection manifest into a browser source descriptor', () => {
  const source = pixiSourceFromManifest({
    source: { modelConfig: 'characters/Saint Louis.model3.json' },
    model: { cubism: 4 },
    motions: [{ id: 'Base:idle', name: 'Idle', group: 'Base', index: 0, duration: null }],
    expressions: [{ id: '0', name: 'Smile' }],
  }, { baseUrl: 'http://127.0.0.1:4171/source' });
  assert.equal(source.modelUrl, 'http://127.0.0.1:4171/source/characters/Saint%20Louis.model3.json');
  assert.equal(source.motions[0].duration, 0);
  assert.equal(source.expressions[0].name, 'Smile');
  assert.equal(source.expressions[0].runtimeId, 'Smile');
});

test('Pixi Live2D adapter bridges the shared contract without bundling a runtime', async () => {
  const page = new FakePixiPage();
  const renderer = new PixiLive2dAdapter({ page, width: 320, height: 240, padding: 12 });
  assert.throws(
    () => new PixiLive2dAdapter(),
    (error) => error instanceof RendererContractError && error.code === 'INVALID_RENDERER_HOST',
  );
  assert.throws(
    () => new PixiLive2dAdapter({ page, playbackMode: 'automatic' }),
    (error) => error instanceof RendererContractError && error.code === 'INVALID_RENDERER_ARGUMENT',
  );
  const loaded = await renderer.load(pixiSource());
  assert.deepEqual(loaded, { contractVersion: 1, motionCount: 2, expressionCount: 1 });
  await renderer.playMotion('Base:wave', { loop: false, speed: 2, start: 0.25 });
  await renderer.setExpression('smile');
  assert.equal(page.calls.find((call) => call.name === 'pageSetExpression').args[0], 'smile_runtime');
  const capture = await renderer.captureRgba({ width: 8, height: 4, motionId: 'Base:wave', time: 0.5 });
  assert.ok(capture.rgba instanceof Uint8Array);
  assert.equal(capture.rgba.length, 8 * 4 * 4);
  assert.equal((await renderer.getBounds({ motionId: 'Base:wave' })).normalized, true);
  await renderer.pause();
  assert.equal(renderer.getState().playing, false);
  await renderer.unload();
  assert.equal(renderer.getState().loaded, false);
  assert.ok(page.calls.some((call) => call.name === 'pageLoad'));
  assert.ok(page.calls.some((call) => call.name === 'pageCapture'));
});

test('Pixi realtime playback owns the ticker while manual stepping and capture stay deterministic', async () => {
  const previousWindow = global.window;
  const previousDocument = global.document;
  const updates = [];
  let captureObservedTicker = null;
  const ticker = {
    callbacks: [],
    deltaMS: 0,
    started: false,
    add(callback) { this.callbacks.push(callback); },
    remove(callback) { this.callbacks = this.callbacks.filter((item) => item !== callback); },
    tick(deltaMS) {
      if (!this.started) return;
      this.deltaMS = deltaMS;
      for (const callback of this.callbacks) callback();
    },
  };
  const model = {
    scale: { set() {} },
    x: 0,
    y: 0,
    getLocalBounds: () => ({ x: 0, y: 0, width: 100, height: 200 }),
    motion: async () => undefined,
    update: (deltaMilliseconds) => updates.push(deltaMilliseconds),
  };
  class Application {
    constructor(options) {
      this.ticker = ticker;
      this.stage = { addChild() {} };
      this.renderer = {
        width: options.width,
        height: options.height,
        render() {},
        resize: (width, height) => {
          this.renderer.width = width;
          this.renderer.height = height;
        },
        extract: {
          pixels: () => {
            captureObservedTicker = ticker.started;
            return new Uint8Array(this.renderer.width * this.renderer.height * 4);
          },
        },
      };
    }
    start() { this.ticker.started = true; }
    stop() { this.ticker.started = false; }
    destroy() { this.destroyed = true; }
  }
  const canvas = { style: {}, parentNode: null };
  global.window = {
    PIXI: {
      Application,
      Rectangle: class Rectangle {},
      live2d: { Live2DModel: { from: async () => model } },
    },
  };
  global.document = {
    body: { appendChild() {} },
    createElement: () => canvas,
    querySelector: () => canvas,
  };

  try {
    await pageLoad(pixiSource(), { ...DEFAULT_OPTIONS, width: 8, height: 4, playbackMode: 'realtime' });
    assert.equal(ticker.started, false);
    await pagePlayMotion('Base:wave', false, 2, 0, 3);
    assert.equal(ticker.started, true);
    ticker.tick(16);
    assert.equal(updates.at(-1), 32);

    pagePause();
    assert.equal(ticker.started, false);
    pageResume();
    assert.equal(ticker.started, true);

    const stepped = pageStep(0.25);
    assert.equal(stepped.time, 0.532);
    assert.equal(updates.at(-1), 500);
    assert.equal(ticker.started, true);

    const capture = await pageCapture('Base:wave', 0.5, 8, 4, 3);
    assert.equal(capture.time, 0.5);
    assert.equal(updates.at(-1), 1000);
    assert.equal(captureObservedTicker, false);
    assert.equal(ticker.started, true);

    await pageUnload();
    assert.equal(ticker.started, false);
    assert.equal(ticker.callbacks.length, 0);

    await pageLoad(pixiSource(), { ...DEFAULT_OPTIONS, width: 8, height: 4 });
    await pagePlayMotion('Base:wave', true, 1, 0, 3);
    assert.equal(ticker.started, false);
    assert.equal(pageStep(0.25).time, 0.25);
    await pageUnload();
  } finally {
    global.window = previousWindow;
    global.document = previousDocument;
  }
});

test('Cubism 2 adapter keeps the legacy boundary explicit and preserves expression indexes', async () => {
  const page = new FakePixiPage();
  const renderer = new LegacyPixiLive2dAdapter({ page });
  await assert.rejects(
    () => renderer.load(pixiSource()),
    (error) => error instanceof RendererContractError && error.code === 'LEGACY_SOURCE_REQUIRED',
  );
  const source = pixiSourceFromManifest({
    source: { modelConfig: 'model.json' },
    model: { cubism: 2 },
    motions: [{ id: 'idle:0', name: 'Idle', group: 'idle', index: 0, duration: 1 }],
    expressions: [{ id: '0', index: 0, name: 'angry' }],
  });
  assert.equal(source.expressions[0].runtimeId, 0);
  await renderer.load(source);
  await renderer.setExpression('0');
  assert.equal(page.calls.find((call) => call.name === 'pageSetExpression').args[0], 0);
});

test('adapter selection follows the inspected Cubism generation', () => {
  assert.equal(selectPixiLive2dAdapter(2).kind, 'legacy-cubism2');
  assert.equal(selectPixiLive2dAdapter(3).kind, 'modern-cubism');
  assert.equal(selectPixiLive2dAdapter(5).Adapter, PixiLive2dAdapter);
  assert.throws(
    () => selectPixiLive2dAdapter(1),
    (error) => error instanceof RendererContractError && error.code === 'UNSUPPORTED_CUBISM_VERSION',
  );
  const legacy = createPixiLive2dAdapter({ source: { cubismVersion: 2 }, page: new FakePixiPage() });
  const modern = createPixiLive2dAdapter({ cubismVersion: 4, page: new FakePixiPage() });
  assert.ok(legacy instanceof LegacyPixiLive2dAdapter);
  assert.ok(modern instanceof PixiLive2dAdapter);
  assert.equal(selectRendererAdapter(4).kind, 'modern-cubism');
  assert.equal(selectRendererAdapter(4).Adapter, PixiLive2dAdapter);
  assert.equal(selectRendererAdapter(2).kind, 'legacy-cubism2');
  assert.equal(selectRendererAdapter(2).Adapter, LegacyPixiLive2dAdapter);
  assert.equal(selectRendererAdapter(5).kind, 'modern-cubism');
  assert.throws(
    () => selectRendererAdapter(6),
    (error) => error instanceof RendererContractError && error.code === 'UNSUPPORTED_CUBISM_VERSION',
  );
  assert.ok(createRendererAdapter({ cubismVersion: 4, page: new FakePixiPage() }) instanceof PixiLive2dAdapter);
});

test('renderer host helpers enforce sandbox defaults, CSP, and a narrow IPC surface', async () => {
  const options = createRendererWindowOptions({ preload: '/app/renderer-preload.cjs', width: 320, height: 240 });
  assert.equal(options.webPreferences.nodeIntegration, false);
  assert.equal(options.webPreferences.contextIsolation, true);
  assert.equal(options.webPreferences.sandbox, true);
  assert.match(createRendererCsp({ scriptNonce: 'nonce_123' }), /default-src 'none'/);
  assert.match(createRendererCsp({ scriptNonce: 'nonce_123' }), /script-src 'self' 'nonce-nonce_123'/);
  assert.doesNotMatch(createRendererCsp(), /unsafe-eval|file:/);
  assert.match(createRendererCsp(), /connect-src 'self' blob:/);
  assert.match(createRendererCspMeta(), /^<meta http-equiv="Content-Security-Policy"/);
  assert.throws(
    () => createRendererWindowOptions({ preload: '/app/preload.cjs', width: 0 }),
    (error) => error instanceof RendererContractError && error.code === 'INVALID_RENDERER_WINDOW',
  );
  assert.throws(
    () => createRendererCsp({ scriptNonce: 'not safe!' }),
    (error) => error instanceof RendererContractError && error.code === 'INVALID_RENDERER_CSP',
  );

  const renderer = new SyntheticRenderer();
  const route = createRendererIpcRouter({ renderer });
  const success = await route({ protocolVersion: 1, method: 'load', args: [source()] });
  assert.equal(success.ok, true);
  const failure = await route({ protocolVersion: 1, method: 'unknown', args: [] });
  assert.equal(failure.ok, false);
  assert.equal(failure.error.code, 'UNKNOWN_RENDERER_METHOD');
  const leakingRenderer = Object.create(renderer);
  leakingRenderer.getState = async () => { throw new Error('failed at /Users/RY/private/model.model3.json'); };
  const redacted = await createRendererIpcRouter({ renderer: leakingRenderer })({ protocolVersion: 1, method: 'getState', args: [] });
  assert.equal(redacted.error.message, 'failed at <redacted-path>');
  const ipcCalls = [];
  const api = createRendererPreloadApi({ ipcRenderer: { invoke: async (...args) => (ipcCalls.push(args), { ok: true }) } });
  await api.playMotion('Base:idle');
  assert.equal(ipcCalls[0][0], RENDERER_IPC_CHANNEL);
  assert.deepEqual(ipcCalls[0][1], { protocolVersion: 1, method: 'playMotion', args: ['Base:idle'] });
});

test('renderer asset server exposes only the selected source root and runtime file', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'live2pet-renderer-assets-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'live2pet-renderer-outside-'));
  fs.mkdirSync(path.join(root, 'motions'));
  fs.writeFileSync(path.join(root, 'model3.json'), '{}');
  fs.writeFileSync(path.join(root, 'motions', 'idle.motion3.json'), '{}');
  const runtimePath = path.join(outside, 'live2dcubismcore.min.js');
  fs.writeFileSync(runtimePath, 'runtime');
  assert.equal(safeRelativePath(root, 'motions/idle.motion3.json'), path.join(root, 'motions', 'idle.motion3.json'));
  assert.equal(safeRelativePath(root, '../escape.txt'), null);
  await assert.rejects(
    () => createRendererAssetServer({ sourceRoot: root, runtimePath, host: '0.0.0.0' }),
    (error) => error instanceof RendererContractError && error.code === 'NON_LOOPBACK_BINDING',
  );
  const server = await createRendererAssetServer({ sourceRoot: root, runtimePath });
  try {
    const model = await fetch(`${server.modelUrl('model3.json')}`);
    assert.equal(model.status, 200);
    assert.equal(await model.text(), '{}');
    const runtime = await fetch(server.runtimeUrl);
    assert.equal(runtime.status, 200);
    assert.equal(await runtime.text(), 'runtime');
    const traversal = await fetch(`${server.baseUrl}/model/${encodeURIComponent('../outside.txt')}`);
    assert.equal(traversal.status, 404);
    const arbitrary = await fetch(`${server.baseUrl}/runtime/${encodeURIComponent('other.js')}`);
    assert.equal(arbitrary.status, 404);
    const health = await fetch(`${server.baseUrl}/health`);
    assert.deepEqual(await health.json(), { ok: true, protocolVersion: 1 });
  } finally {
    await server.close();
  }
});

test('renderer realm host destroys a failed window and recreates a fresh realm', async () => {
  const windows = [];
  let rendererUnloads = 0;
  let loadCount = 0;
  function createWindow() {
    const current = new EventEmitter();
    current.webContents = new EventEmitter();
    current.destroyed = false;
    current.isDestroyed = () => current.destroyed;
    current.destroy = () => {
      current.destroyed = true;
      current.emit('closed');
    };
    windows.push(current);
    return current;
  }
  const host = createRendererRealmHost({
    createWindow,
    loadWindow: async () => { loadCount += 1; },
    createRenderer: async () => {
      const renderer = new SyntheticRenderer();
      const unload = renderer.unload.bind(renderer);
      renderer.unload = async () => { rendererUnloads += 1; return unload(); };
      renderer.playMotion = async () => { throw new Error('model crashed while playing'); };
      return renderer;
    },
    windowOptions: { width: 320, height: 240 },
  });
  assert.equal(host.getStatus().state, RENDERER_REALM_STATES.idle);
  await host.start();
  assert.equal(host.getStatus().state, RENDERER_REALM_STATES.ready);
  await host.invoke('load', source());
  await assert.rejects(
    () => host.invoke('playMotion', 'missing'),
    (error) => error instanceof RendererContractError && error.code === 'RENDERER_REALM_FAILED',
  );
  assert.equal(host.getStatus().state, RENDERER_REALM_STATES.failed);
  assert.equal(host.getStatus().hasWindow, false);
  assert.equal(windows[0].destroyed, true);
  assert.equal(rendererUnloads, 1);

  await host.restart();
  assert.equal(host.getStatus().state, RENDERER_REALM_STATES.ready);
  assert.equal(host.getStatus().generation, 2);
  assert.equal(loadCount, 2);
  assert.notEqual(windows[0], windows[1]);
  await host.close();
  assert.equal(host.getStatus().state, RENDERER_REALM_STATES.closed);
  assert.equal(windows[1].destroyed, true);
  assert.equal(rendererUnloads, 2);
});

test('renderer realm host treats an isolated process exit as a recoverable failure', async () => {
  const window = new EventEmitter();
  window.webContents = new EventEmitter();
  window.destroyed = false;
  window.isDestroyed = () => window.destroyed;
  window.destroy = () => { window.destroyed = true; window.emit('closed'); };
  const host = createRendererRealmHost({
    createWindow: () => window,
    createRenderer: () => new SyntheticRenderer(),
  });
  await host.start();
  window.webContents.emit('render-process-gone', {}, { reason: 'crashed' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(host.getStatus().state, RENDERER_REALM_STATES.failed);
  assert.equal(host.getStatus().error.code, 'RENDERER_PROCESS_GONE');
  assert.equal(window.destroyed, true);
});

test('renderer realm host keeps typed user command errors inside a healthy realm', async () => {
  const window = new EventEmitter();
  window.webContents = new EventEmitter();
  window.destroyed = false;
  window.isDestroyed = () => window.destroyed;
  window.destroy = () => { window.destroyed = true; window.emit('closed'); };
  const host = createRendererRealmHost({ createWindow: () => window, createRenderer: () => new SyntheticRenderer() });
  await host.start();
  await host.invoke('load', source());
  await assert.rejects(
    () => host.invoke('playMotion', 'missing'),
    (error) => error instanceof RendererContractError && error.code === 'MOTION_NOT_FOUND',
  );
  assert.equal(host.getStatus().state, RENDERER_REALM_STATES.ready);
  assert.equal(window.destroyed, false);
  await host.close();
});

test('Electron webContents page serializes only fixed function calls and JSON arguments', async () => {
  const calls = [];
  const page = createElectronWebContentsPage({
    webContents: {
      executeJavaScript: async (sourceText, userGesture) => {
        calls.push({ sourceText, userGesture });
        return { ok: true };
      },
    },
  });
  const result = await page.evaluate(function fixedEvaluation(value) { return value; }, 'hello', 3);
  assert.deepEqual(result, { ok: true });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].userGesture, true);
  assert.match(calls[0].sourceText, /fixedEvaluation/);
  assert.match(calls[0].sourceText, /"hello"/);
  assert.throws(
    () => createElectronWebContentsPage({ webContents: {} }),
    (error) => error instanceof RendererContractError && error.code === 'INVALID_RENDERER_HOST',
  );
});
