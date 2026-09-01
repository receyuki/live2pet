const { RendererContractError } = require('./errors.cjs');
const { normalizePixiSource } = require('./pixi-live2d-adapter.cjs');

const OFFICIAL_FRAMEWORK_GLOBAL = '__live2petCubismWebFramework';
const OFFICIAL_FRAMEWORK_METHODS = Object.freeze([
  'unload',
  'playMotion',
  'pause',
  'resume',
  'restart',
  'setLoop',
  'setSpeed',
  'setExpression',
  'step',
  'getState',
  'getBounds',
  'captureRgba',
]);

const DEFAULT_OPTIONS = Object.freeze({
  canvasSelector: '#live2pet-stage',
  width: 512,
  height: 512,
  padding: 24,
  frameworkGlobal: OFFICIAL_FRAMEWORK_GLOBAL,
});

function fail(code, message, details = {}) {
  throw new RendererContractError(code, message, details);
}

function positiveInteger(value, label, max = 4096) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1 || number > max) fail('INVALID_RENDER_SIZE', `${label} must be an integer between 1 and ${max}.`);
  return number;
}

function finiteNumber(value, label, { min = -Infinity, max = Infinity } = {}) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) fail('INVALID_RENDERER_ARGUMENT', `${label} must be a finite number between ${min} and ${max}.`);
  return number;
}

function cloneState(state) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) return {
    contractVersion: 1,
    loaded: false,
    motionId: null,
    expressionId: null,
    time: 0,
    playing: false,
    loop: true,
    speed: 1,
  };
  return { ...state };
}

function validGlobalName(value) {
  return typeof value === 'string' && /^(?:[A-Za-z_$][\w$]*)(?:\.(?:[A-Za-z_$][\w$]*))*$/.test(value);
}

function pageOfficialLoad(source, options, globalName) {
  return (async () => {
    const requiredMethods = ['unload', 'playMotion', 'pause', 'resume', 'restart', 'setLoop', 'setSpeed', 'setExpression', 'step', 'getState', 'getBounds', 'captureRgba'];
    const bridge = globalName.split('.').reduce((current, key) => current && current[key], window);
    if (!bridge || typeof bridge.createRenderer !== 'function') {
      const error = new Error(`Official Cubism Web Framework bridge ${globalName} is not available. Load a user-provided Framework bundle before loading a model.`);
      error.code = 'OFFICIAL_FRAMEWORK_UNAVAILABLE';
      throw error;
    }
    const previous = window.__live2petOfficialCubism;
    if (previous && typeof previous.dispose === 'function') await previous.dispose();
    let canvas = document.querySelector(options.canvasSelector);
    let createdCanvas = false;
    if (!canvas) {
      canvas = document.createElement('canvas');
      canvas.id = options.canvasSelector.startsWith('#') ? options.canvasSelector.slice(1) : 'live2pet-stage';
      document.body.appendChild(canvas);
      createdCanvas = true;
    }
    canvas.width = options.width;
    canvas.height = options.height;
    canvas.style.background = 'transparent';
    canvas.style.display = 'block';
    const renderer = await bridge.createRenderer({ canvas, source, options: { ...options } });
    if (!renderer || typeof renderer !== 'object') {
      const error = new Error('The official Cubism Web Framework bridge did not return a renderer object.');
      error.code = 'OFFICIAL_FRAMEWORK_CONTRACT_INVALID';
      throw error;
    }
    const missing = requiredMethods.filter((method) => typeof renderer[method] !== 'function');
    if (missing.length) {
      const error = new Error(`The official Cubism Web Framework bridge is missing methods: ${missing.join(', ')}.`);
      error.code = 'OFFICIAL_FRAMEWORK_CONTRACT_INVALID';
      throw error;
    }
    const state = typeof renderer.getState === 'function' ? await renderer.getState() : null;
    const runtime = {
      bridge,
      renderer,
      canvas,
      createdCanvas,
      source,
      options,
      state: state && typeof state === 'object' ? state : { contractVersion: 1, loaded: true, motionId: source.motions[0]?.id || null, expressionId: null, time: 0, playing: false, loop: true, speed: 1 },
      dispose: async () => {
        try {
          if (runtime.renderer && typeof runtime.renderer.unload === 'function') await runtime.renderer.unload();
          if (runtime.bridge && typeof runtime.bridge.disposeRenderer === 'function') await runtime.bridge.disposeRenderer(runtime.renderer);
        } finally {
          if (runtime.createdCanvas && runtime.canvas.parentNode) runtime.canvas.parentNode.removeChild(runtime.canvas);
          if (window.__live2petOfficialCubism === runtime) delete window.__live2petOfficialCubism;
        }
      },
    };
    window.__live2petOfficialCubism = runtime;
    return { state: { ...runtime.state }, width: canvas.width, height: canvas.height };
  })();
}

function pageOfficialUnload() {
  return (async () => {
    const runtime = window.__live2petOfficialCubism;
    if (runtime && typeof runtime.dispose === 'function') await runtime.dispose();
    return { loaded: false };
  })();
}

function pageOfficialInvoke(method, args) {
  return (async () => {
    const allowedMethods = ['unload', 'playMotion', 'pause', 'resume', 'restart', 'setLoop', 'setSpeed', 'setExpression', 'step', 'getState', 'getBounds', 'captureRgba'];
    const runtime = window.__live2petOfficialCubism;
    if (!runtime || !runtime.renderer) throw new Error('Official Cubism Web Framework renderer is not loaded.');
    if (!Array.isArray(args) || !allowedMethods.includes(method)) throw new Error(`Official renderer method is not allowed: ${String(method)}.`);
    const result = await runtime.renderer[method](...(args || []));
    if (method === 'captureRgba' && result && result.rgba && ArrayBuffer.isView(result.rgba)) return { ...result, rgba: Array.from(result.rgba) };
    if (method === 'getState' && result && typeof result === 'object') runtime.state = result;
    else if (result && typeof result === 'object' && Object.hasOwn(result, 'loaded')) runtime.state = result;
    return result;
  })();
}

class OfficialCubismWebFrameworkAdapter {
  constructor({ page, ...options } = {}) {
    if (!page || typeof page.evaluate !== 'function') fail('INVALID_RENDERER_HOST', 'OfficialCubismWebFrameworkAdapter requires a browser page with an evaluate(function, ...args) method.');
    if (options.frameworkGlobal !== undefined && !validGlobalName(options.frameworkGlobal)) fail('INVALID_RENDERER_ARGUMENT', 'frameworkGlobal must be a dot-separated JavaScript global name.');
    this.page = page;
    this.options = {
      ...DEFAULT_OPTIONS,
      ...options,
      width: positiveInteger(options.width == null ? DEFAULT_OPTIONS.width : options.width, 'Renderer width'),
      height: positiveInteger(options.height == null ? DEFAULT_OPTIONS.height : options.height, 'Renderer height'),
      padding: finiteNumber(options.padding == null ? DEFAULT_OPTIONS.padding : options.padding, 'Renderer padding', { min: 0, max: 4096 }),
      frameworkGlobal: options.frameworkGlobal || DEFAULT_OPTIONS.frameworkGlobal,
    };
    this.source = null;
    this.state = cloneState();
  }

  async evaluate(fn, ...args) {
    try {
      return await this.page.evaluate(fn, ...args);
    } catch (error) {
      if (error instanceof RendererContractError) throw error;
      const code = typeof error?.code === 'string' && /^OFFICIAL_FRAMEWORK_/.test(error.code) ? error.code : 'RENDERER_PAGE_ERROR';
      throw new RendererContractError(code, error && error.message ? error.message : String(error));
    }
  }

  requireLoaded() {
    if (!this.source || !this.state.loaded) fail('RENDERER_NOT_LOADED', 'Load a Source Package before using the official Cubism Web Framework renderer.');
  }

  motion(id) {
    const motion = this.source.motions.find((item) => item.id === id);
    if (!motion) fail('MOTION_NOT_FOUND', `Motion is not available in the loaded Source Package: ${id}`);
    return motion;
  }

  async load(source) {
    const normalized = normalizePixiSource(source);
    if (![3, 4, 5].includes(normalized.cubismVersion)) fail('MODERN_SOURCE_REQUIRED', 'The official Cubism Web Framework adapter accepts only Cubism 3, 4, or 5 Source Packages.');
    const result = await this.evaluate(pageOfficialLoad, normalized, this.options, this.options.frameworkGlobal);
    this.source = normalized;
    this.state = cloneState(result && result.state);
    this.state.loaded = true;
    return { contractVersion: 1, motionCount: normalized.motions.length, expressionCount: normalized.expressions.length };
  }

  async unload() {
    if (this.source) await this.evaluate(pageOfficialUnload);
    this.source = null;
    this.state = cloneState();
  }

  async invoke(method, args = []) {
    this.requireLoaded();
    const result = await this.evaluate(pageOfficialInvoke, method, args);
    if (method === 'getState' || (result && typeof result === 'object' && Object.hasOwn(result, 'loaded'))) this.state = cloneState(result);
    return result;
  }

  async playMotion(id, { loop = this.state.loop, speed = this.state.speed, start = 0 } = {}) {
    this.requireLoaded();
    const motion = this.motion(id);
    if (typeof loop !== 'boolean') fail('INVALID_RENDERER_ARGUMENT', 'loop must be a boolean.');
    const playbackSpeed = finiteNumber(speed, 'Playback speed', { min: 0.05, max: 8 });
    const startTime = finiteNumber(start, 'Motion start time', { min: 0, max: Math.max(0, motion.duration) });
    const result = await this.invoke('playMotion', [id, { loop, speed: playbackSpeed, start: startTime }]);
    this.state = cloneState(result && result.loaded !== undefined ? result : { ...this.state, motionId: id, loop, speed: playbackSpeed, time: startTime, playing: true });
    return this.getState();
  }

  async pause() { const result = await this.invoke('pause'); this.state = cloneState(result && result.loaded !== undefined ? result : { ...this.state, playing: false }); return this.getState(); }
  async resume() { this.requireLoaded(); if (!this.state.motionId) fail('RENDERER_NOT_PLAYING', 'There is no Motion available to resume.'); const result = await this.invoke('resume'); this.state = cloneState(result && result.loaded !== undefined ? result : { ...this.state, playing: true }); return this.getState(); }
  async restart() { this.requireLoaded(); if (!this.state.motionId) fail('RENDERER_NOT_PLAYING', 'There is no Motion available to restart.'); const result = await this.invoke('restart'); this.state = cloneState(result && result.loaded !== undefined ? result : { ...this.state, time: 0, playing: true }); return this.getState(); }
  async setLoop(loop) { if (typeof loop !== 'boolean') fail('INVALID_RENDERER_ARGUMENT', 'loop must be a boolean.'); this.requireLoaded(); const result = await this.invoke('setLoop', [loop]); this.state.loop = loop; if (result && result.loaded !== undefined) this.state = cloneState(result); return this.state.loop; }
  async setSpeed(speed) { const playbackSpeed = finiteNumber(speed, 'Playback speed', { min: 0.05, max: 8 }); this.requireLoaded(); const result = await this.invoke('setSpeed', [playbackSpeed]); this.state.speed = playbackSpeed; if (result && result.loaded !== undefined) this.state = cloneState(result); return this.state.speed; }
  async setExpression(id) { this.requireLoaded(); if (id != null && !this.source.expressions.some((expression) => expression.id === id)) fail('EXPRESSION_NOT_FOUND', `Expression is not available in the loaded Source Package: ${id}`); const result = await this.invoke('setExpression', [id]); this.state.expressionId = id == null ? null : id; if (result && result.loaded !== undefined) this.state = cloneState(result); return this.state.expressionId; }
  async step(deltaSeconds) { const delta = finiteNumber(deltaSeconds, 'Step duration', { min: 0, max: 3600 }); const result = await this.invoke('step', [delta]); if (result && result.loaded !== undefined) this.state = cloneState(result); return this.getState(); }
  getState() { return cloneState(this.state); }
  async getBounds({ motionId = this.state.motionId } = {}) { this.requireLoaded(); this.motion(motionId); return this.invoke('getBounds', [{ motionId }]); }
  async captureRgba({ width = this.options.width, height = this.options.height, motionId = this.state.motionId, time = this.state.time } = {}) {
    this.requireLoaded();
    const targetWidth = positiveInteger(width, 'Capture width');
    const targetHeight = positiveInteger(height, 'Capture height');
    const motion = this.motion(motionId);
    const captureTime = finiteNumber(time, 'Capture time', { min: 0, max: Math.max(0, motion.duration) });
    const capture = await this.invoke('captureRgba', [{ width: targetWidth, height: targetHeight, motionId, time: captureTime }]);
    if (!capture || capture.width !== targetWidth || capture.height !== targetHeight || !Array.isArray(capture.rgba) || capture.rgba.length !== targetWidth * targetHeight * 4) fail('INVALID_RENDER_CAPTURE', `Official Cubism Web Framework renderer returned an invalid RGBA capture for ${motionId}.`);
    this.state.motionId = motion.id;
    this.state.time = captureTime;
    this.state.playing = true;
    return { contractVersion: 1, width: targetWidth, height: targetHeight, motionId: motion.id, time: captureTime, rgba: Uint8Array.from(capture.rgba) };
  }
}

module.exports = {
  DEFAULT_OPTIONS,
  OFFICIAL_FRAMEWORK_GLOBAL,
  OFFICIAL_FRAMEWORK_METHODS,
  OfficialCubismWebFrameworkAdapter,
  pageOfficialInvoke,
  pageOfficialLoad,
  pageOfficialUnload,
};
