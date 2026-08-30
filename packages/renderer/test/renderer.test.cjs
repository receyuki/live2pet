const assert = require('node:assert/strict');
const test = require('node:test');

const {
  CONTRACT_METHODS,
  RENDERER_IPC_CHANNEL,
  RendererContractError,
  PixiLive2dAdapter,
  SyntheticRenderer,
  assertRenderer,
  createRendererCsp,
  createRendererCspMeta,
  createRendererIpcRouter,
  createRendererPreloadApi,
  createRendererWindowOptions,
  normalizePixiSource,
  pixiSourceFromManifest,
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

test('renderer host helpers enforce sandbox defaults, CSP, and a narrow IPC surface', async () => {
  const options = createRendererWindowOptions({ preload: '/app/renderer-preload.cjs', width: 320, height: 240 });
  assert.equal(options.webPreferences.nodeIntegration, false);
  assert.equal(options.webPreferences.contextIsolation, true);
  assert.equal(options.webPreferences.sandbox, true);
  assert.match(createRendererCsp({ scriptNonce: 'nonce_123' }), /default-src 'none'/);
  assert.match(createRendererCsp({ scriptNonce: 'nonce_123' }), /script-src 'self' 'nonce-nonce_123'/);
  assert.doesNotMatch(createRendererCsp(), /unsafe-eval|file:/);
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
