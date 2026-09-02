const { RendererContractError } = require('./errors.cjs');

const DEFAULT_OPTIONS = Object.freeze({
  canvasSelector: '#live2pet-stage',
  width: 512,
  height: 512,
  padding: 24,
  motionPriority: 3,
  playbackMode: 'manual',
});

function fail(code, message, details = {}) {
  throw new RendererContractError(code, message, details);
}

function finiteNumber(value, label, { min = -Infinity, max = Infinity } = {}) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) fail('INVALID_RENDERER_ARGUMENT', `${label} must be a finite number between ${min} and ${max}.`);
  return number;
}

function positiveInteger(value, label, max = 4096) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1 || number > max) fail('INVALID_RENDER_SIZE', `${label} must be an integer between 1 and ${max}.`);
  return number;
}

function nonEmptyString(value, label) {
  if (typeof value !== 'string' || !value.trim()) fail('INVALID_RENDER_SOURCE', `${label} must be a non-empty string.`);
  return value;
}

function normalizeMotion(motion, index) {
  if (!motion || typeof motion !== 'object') fail('INVALID_RENDER_SOURCE', `Motion ${index} must be an object.`);
  const id = nonEmptyString(motion.id, `Motion ${index} id`);
  if (typeof motion.group !== 'string' || motion.group.length > 256) fail('INVALID_RENDER_SOURCE', `Motion ${id} group must be a string of at most 256 characters.`);
  const group = motion.group;
  const motionIndex = Number(motion.index);
  if (!Number.isInteger(motionIndex) || motionIndex < 0 || motionIndex > 100000) fail('INVALID_RENDER_SOURCE', `Motion ${id} index must be a non-negative integer.`);
  const duration = finiteNumber(motion.duration == null ? 0 : motion.duration, `Motion ${id} duration`, { min: 0, max: 3600 });
  return {
    id,
    name: typeof motion.name === 'string' && motion.name ? motion.name : id,
    group,
    index: motionIndex,
    duration,
  };
}

function normalizePixiSource(source) {
  if (!source || typeof source !== 'object') fail('INVALID_RENDER_SOURCE', 'Pixi Live2D source must be an object.');
  const modelUrl = nonEmptyString(source.modelUrl, 'modelUrl');
  const cubismVersion = Number(source.cubismVersion == null ? 4 : source.cubismVersion);
  if (![2, 3, 4, 5].includes(cubismVersion)) fail('INVALID_RENDER_SOURCE', 'cubismVersion must be 2, 3, 4, or 5.');
  if (!Array.isArray(source.motions)) fail('INVALID_RENDER_SOURCE', 'Pixi Live2D source must contain a motions array.');
  const motions = source.motions.map(normalizeMotion);
  const ids = new Set();
  for (const motion of motions) {
    if (ids.has(motion.id)) fail('INVALID_RENDER_SOURCE', `Motion ids must be unique: ${motion.id}.`);
    ids.add(motion.id);
  }
  const expressions = Array.isArray(source.expressions)
    ? source.expressions.map((expression, index) => {
      if (!expression || typeof expression !== 'object') fail('INVALID_RENDER_SOURCE', `Expression ${index} must be an object.`);
      const id = nonEmptyString(expression.id, `Expression ${index} id`);
      const name = typeof expression.name === 'string' && expression.name ? expression.name : id;
      const runtimeId = (typeof expression.runtimeId === 'string' && expression.runtimeId)
        || (Number.isInteger(expression.runtimeId) && expression.runtimeId >= 0 ? expression.runtimeId : name);
      return { id, name, runtimeId };
    })
    : [];
  return { modelUrl, cubismVersion, motions, expressions };
}

function encodeRelativeUrl(relativePath) {
  return String(relativePath).split('/').map((segment) => encodeURIComponent(segment)).join('/');
}

function pixiSourceFromManifest(manifest, { baseUrl = '' } = {}) {
  if (!manifest || typeof manifest !== 'object') fail('INVALID_RENDER_SOURCE', 'A normalized Source Package manifest is required.');
  const modelConfig = manifest.source && manifest.source.modelConfig;
  nonEmptyString(modelConfig, 'manifest.source.modelConfig');
  const prefix = typeof baseUrl === 'string' ? baseUrl.replace(/\/+$/, '') : '';
  return normalizePixiSource({
    modelUrl: `${prefix}/${encodeRelativeUrl(modelConfig)}`,
    cubismVersion: manifest.model && manifest.model.cubism,
    motions: Array.isArray(manifest.motions) ? manifest.motions.map((motion) => ({
      id: motion.id,
      name: motion.name,
      group: motion.group,
      index: motion.index,
      duration: motion.duration == null ? 0 : motion.duration,
    })) : [],
    expressions: Array.isArray(manifest.expressions) ? manifest.expressions.map((expression) => ({
      id: expression.id,
      name: expression.name,
      runtimeId: Number(manifest.model && manifest.model.cubism) === 2 && Number.isInteger(expression.index) ? expression.index : (expression.runtimeId || expression.name),
    })) : [],
  });
}

function cloneState(state) {
  return state ? { ...state } : {
    contractVersion: 1,
    loaded: false,
    motionId: null,
    expressionId: null,
    time: 0,
    playing: false,
    loop: true,
    speed: 1,
  };
}

function pageLoad(source, options) {
  return (async () => {
    if (!window.PIXI || !window.PIXI.live2d || !window.PIXI.live2d.Live2DModel) throw new Error('PIXI.live2d.Live2DModel is not available. Load Pixi, pixi-live2d-display, and the user-provided Cubism runtime before loading a model.');
    const previous = window.__live2petPixiLive2D;
    if (previous && typeof previous.dispose === 'function') await previous.dispose();

    let canvas = document.querySelector(options.canvasSelector);
    let createdCanvas = false;
    if (!canvas) {
      canvas = document.createElement('canvas');
      canvas.id = options.canvasSelector.startsWith('#') ? options.canvasSelector.slice(1) : 'live2pet-stage';
      document.body.appendChild(canvas);
      createdCanvas = true;
    }
    canvas.style.background = 'transparent';
    canvas.style.display = 'block';
    const app = new window.PIXI.Application({
      view: canvas,
      width: options.width,
      height: options.height,
      backgroundAlpha: 0,
      antialias: true,
      autoStart: false,
      sharedTicker: false,
      preserveDrawingBuffer: true,
      resolution: 1,
    });
    app.stop();
    const model = await window.PIXI.live2d.Live2DModel.from(source.modelUrl, {
      autoUpdate: false,
      autoHitTest: false,
    });
    app.stage.addChild(model);

    const fit = () => {
      const bounds = model.getLocalBounds();
      if (!bounds || !Number.isFinite(bounds.width) || !Number.isFinite(bounds.height) || bounds.width <= 0 || bounds.height <= 0) throw new Error('Loaded model has no measurable bounds.');
      const usableWidth = Math.max(1, app.renderer.width - options.padding * 2);
      const usableHeight = Math.max(1, app.renderer.height - options.padding * 2);
      const scale = Math.min(usableWidth / bounds.width, usableHeight / bounds.height);
      model.scale.set(scale);
      model.x = (app.renderer.width - bounds.width * scale) / 2 - bounds.x * scale;
      model.y = (app.renderer.height - bounds.height * scale) / 2 - bounds.y * scale;
    };
    const render = () => app.renderer.render(app.stage);
    const state = {
      contractVersion: 1,
      loaded: true,
      motionId: source.motions[0] ? source.motions[0].id : null,
      expressionId: null,
      time: 0,
      playing: false,
      loop: true,
      speed: 1,
    };
    const realtime = options.playbackMode === 'realtime';
    const advance = (deltaSeconds) => {
      if (!state.motionId || !state.playing) return;
      const motion = source.motions.find((item) => item.id === state.motionId);
      const scaledDelta = deltaSeconds * state.speed;
      const next = state.time + scaledDelta;
      const duration = motion.duration;
      const motionDelta = duration > 0 && !state.loop
        ? Math.min(scaledDelta, Math.max(0, duration - state.time))
        : scaledDelta;
      model.update(motionDelta * 1000);
      if (duration === 0) {
        state.time = 0;
        state.playing = state.loop;
      } else if (next < duration) {
        state.time = next;
      } else if (state.loop) {
        state.time = next % duration;
      } else {
        state.time = duration;
        state.playing = false;
      }
    };
    const tickerUpdate = () => {
      advance(app.ticker.deltaMS / 1000);
      if (!state.playing) app.stop();
    };
    const syncTicker = () => {
      if (realtime && state.playing) app.start();
      else app.stop();
    };
    if (realtime) app.ticker.add(tickerUpdate);
    fit();
    render();

    const runtime = {
      app,
      canvas,
      createdCanvas,
      model,
      source,
      state,
      options,
      realtime,
      advance,
      tickerUpdate,
      syncTicker,
      fit,
      render,
      dispose: async () => {
        try {
          app.stop();
          if (realtime) app.ticker.remove(tickerUpdate);
          app.destroy(true, { children: true, texture: true, baseTexture: true });
        } finally {
          if (createdCanvas && canvas.parentNode) canvas.parentNode.removeChild(canvas);
          if (window.__live2petPixiLive2D === runtime) delete window.__live2petPixiLive2D;
        }
      },
    };
    window.__live2petPixiLive2D = runtime;
    return { state: { ...state }, width: app.renderer.width, height: app.renderer.height };
  })();
}

function pageUnload() {
  return (async () => {
    const runtime = window.__live2petPixiLive2D;
    if (runtime && typeof runtime.dispose === 'function') await runtime.dispose();
    return { loaded: false };
  })();
}

function pageResize(width, height) {
  const runtime = window.__live2petPixiLive2D;
  if (!runtime) throw new Error('Renderer is not loaded.');
  runtime.app.renderer.resize(width, height);
  runtime.fit();
  runtime.render();
  return { width: runtime.app.renderer.width, height: runtime.app.renderer.height };
}

function pagePlayMotion(motionId, loop, speed, start, priority) {
  return (async () => {
    const runtime = window.__live2petPixiLive2D;
    if (!runtime) throw new Error('Renderer is not loaded.');
    const motion = runtime.source.motions.find((item) => item.id === motionId);
    if (!motion) throw new Error(`Motion is not available: ${motionId}`);
    runtime.state.loop = loop;
    runtime.state.speed = speed;
    runtime.state.motionId = motion.id;
    runtime.state.time = start;
    runtime.state.playing = true;
    await runtime.model.motion(motion.group, motion.index, priority);
    if (start > 0) runtime.model.update(start * 1000 * speed);
    else runtime.model.update(1);
    runtime.render();
    runtime.syncTicker();
    return { ...runtime.state };
  })();
}

function pageSetPlayback(loop, speed) {
  const runtime = window.__live2petPixiLive2D;
  if (!runtime) throw new Error('Renderer is not loaded.');
  if (loop !== undefined) runtime.state.loop = loop;
  if (speed !== undefined) runtime.state.speed = speed;
  return { ...runtime.state };
}

function pagePause() {
  const runtime = window.__live2petPixiLive2D;
  if (!runtime) throw new Error('Renderer is not loaded.');
  runtime.state.playing = false;
  runtime.syncTicker();
  return { ...runtime.state };
}

function pageResume() {
  const runtime = window.__live2petPixiLive2D;
  if (!runtime || !runtime.state.motionId) throw new Error('There is no Motion available to resume.');
  runtime.state.playing = true;
  runtime.syncTicker();
  return { ...runtime.state };
}

function pageRestart(priority) {
  const runtime = window.__live2petPixiLive2D;
  if (!runtime || !runtime.state.motionId) throw new Error('There is no Motion available to restart.');
  const motion = runtime.source.motions.find((item) => item.id === runtime.state.motionId);
  runtime.state.time = 0;
  runtime.state.playing = true;
  return runtime.model.motion(motion.group, motion.index, priority).then(() => {
    runtime.model.update(1);
    runtime.render();
    runtime.syncTicker();
    return { ...runtime.state };
  });
}

function pageSetExpression(id) {
  return (async () => {
    const runtime = window.__live2petPixiLive2D;
    if (!runtime) throw new Error('Renderer is not loaded.');
    if (id == null) {
      const manager = runtime.model.internalModel && runtime.model.internalModel.expressionManager;
      if (manager && typeof manager.stopAllExpressions === 'function') manager.stopAllExpressions();
      runtime.state.expressionId = null;
      runtime.render();
      return null;
    }
    if (typeof runtime.model.expression !== 'function') throw new Error('This model runtime does not expose Expression playback.');
    await runtime.model.expression(id);
    runtime.state.expressionId = id;
    runtime.render();
    return id;
  })();
}

function pageStep(deltaSeconds) {
  const runtime = window.__live2petPixiLive2D;
  if (!runtime) throw new Error('Renderer is not loaded.');
  if (!runtime.state.motionId || !runtime.state.playing) return { ...runtime.state };
  const resumeRealtime = runtime.realtime && runtime.app.ticker.started;
  runtime.app.stop();
  runtime.advance(deltaSeconds);
  runtime.render();
  if (resumeRealtime && runtime.state.playing) runtime.app.start();
  return { ...runtime.state };
}

function pageBounds(motionId) {
  const runtime = window.__live2petPixiLive2D;
  if (!runtime) throw new Error('Renderer is not loaded.');
  if (!runtime.source.motions.some((item) => item.id === motionId)) throw new Error(`Motion is not available: ${motionId}`);
  const bounds = runtime.model.getBounds();
  const width = runtime.app.renderer.width;
  const height = runtime.app.renderer.height;
  return {
    motionId,
    samples: 1,
    x: bounds.x / width,
    y: bounds.y / height,
    width: bounds.width / width,
    height: bounds.height / height,
    normalized: true,
  };
}

function pageCapture(motionId, time, width, height, priority) {
  return (async () => {
    const runtime = window.__live2petPixiLive2D;
    if (!runtime) throw new Error('Renderer is not loaded.');
    const motion = runtime.source.motions.find((item) => item.id === motionId);
    if (!motion) throw new Error(`Motion is not available: ${motionId}`);
    const resumeRealtime = runtime.realtime && runtime.app.ticker.started;
    runtime.app.stop();
    try {
      const captureTime = Math.min(Math.max(0, time), motion.duration);
      await runtime.model.motion(motion.group, motion.index, priority);
      runtime.state.motionId = motion.id;
      runtime.state.time = captureTime;
      runtime.state.playing = true;
      if (width !== runtime.app.renderer.width || height !== runtime.app.renderer.height) {
        runtime.app.renderer.resize(width, height);
        runtime.fit();
      }
      runtime.model.update(Math.max(1, captureTime * 1000 * runtime.state.speed));
      runtime.render();
      const extractor = runtime.app.renderer.extract || (runtime.app.renderer.plugins && runtime.app.renderer.plugins.extract);
      if (!extractor || typeof extractor.pixels !== 'function') throw new Error('Pixi Extract plugin is unavailable; RGBA capture cannot proceed.');
      const frame = new window.PIXI.Rectangle(0, 0, width, height);
      const pixels = extractor.pixels(runtime.app.stage, frame);
      return { width, height, motionId: motion.id, time: captureTime, rgba: Array.from(pixels) };
    } finally {
      if (resumeRealtime && runtime.state.playing) runtime.app.start();
    }
  })();
}

class PixiLive2dAdapter {
  constructor({ page, ...options } = {}) {
    if (!page || typeof page.evaluate !== 'function') fail('INVALID_RENDERER_HOST', 'PixiLive2dAdapter requires a browser page with an evaluate(function, ...args) method.');
    this.page = page;
    this.options = {
      ...DEFAULT_OPTIONS,
      ...options,
      width: positiveInteger(options.width == null ? DEFAULT_OPTIONS.width : options.width, 'Renderer width'),
      height: positiveInteger(options.height == null ? DEFAULT_OPTIONS.height : options.height, 'Renderer height'),
      padding: finiteNumber(options.padding == null ? DEFAULT_OPTIONS.padding : options.padding, 'Renderer padding', { min: 0, max: 4096 }),
      motionPriority: Number.isInteger(options.motionPriority == null ? DEFAULT_OPTIONS.motionPriority : options.motionPriority) ? Number(options.motionPriority == null ? DEFAULT_OPTIONS.motionPriority : options.motionPriority) : DEFAULT_OPTIONS.motionPriority,
      playbackMode: options.playbackMode == null ? DEFAULT_OPTIONS.playbackMode : options.playbackMode,
    };
    if (!['manual', 'realtime'].includes(this.options.playbackMode)) fail('INVALID_RENDERER_ARGUMENT', 'playbackMode must be manual or realtime.');
    this.source = null;
    this.state = cloneState();
  }

  async evaluate(fn, ...args) {
    try {
      return await this.page.evaluate(fn, ...args);
    } catch (error) {
      if (error instanceof RendererContractError) throw error;
      throw new RendererContractError('RENDERER_PAGE_ERROR', error && error.message ? error.message : String(error));
    }
  }

  requireLoaded() {
    if (!this.source || !this.state.loaded) fail('RENDERER_NOT_LOADED', 'Load a Source Package before using the Pixi Live2D renderer.');
  }

  motion(id) {
    const motion = this.source.motions.find((item) => item.id === id);
    if (!motion) fail('MOTION_NOT_FOUND', `Motion is not available in the loaded Source Package: ${id}`);
    return motion;
  }

  async load(source) {
    const normalized = normalizePixiSource(source);
    const result = await this.evaluate(pageLoad, normalized, this.options);
    this.source = normalized;
    this.state = cloneState(result && result.state);
    this.state.loaded = true;
    return { contractVersion: 1, motionCount: normalized.motions.length, expressionCount: normalized.expressions.length };
  }

  async unload() {
    if (this.source) await this.evaluate(pageUnload);
    this.source = null;
    this.state = cloneState();
  }

  async playMotion(id, { loop = this.state.loop, speed = this.state.speed, start = 0 } = {}) {
    this.requireLoaded();
    const motion = this.motion(id);
    if (typeof loop !== 'boolean') fail('INVALID_RENDERER_ARGUMENT', 'loop must be a boolean.');
    const playbackSpeed = finiteNumber(speed, 'Playback speed', { min: 0.05, max: 8 });
    const startTime = finiteNumber(start, 'Motion start time', { min: 0, max: Math.max(0, motion.duration) });
    this.state.loop = loop;
    this.state.speed = playbackSpeed;
    this.state = cloneState(await this.evaluate(pagePlayMotion, id, loop, playbackSpeed, startTime, this.options.motionPriority));
    return this.getState();
  }

  async pause() {
    this.requireLoaded();
    this.state = cloneState(await this.evaluate(pagePause));
    return this.getState();
  }

  async resume() {
    this.requireLoaded();
    if (!this.state.motionId) fail('RENDERER_NOT_PLAYING', 'There is no Motion available to resume.');
    this.state = cloneState(await this.evaluate(pageResume));
    return this.getState();
  }

  async restart() {
    this.requireLoaded();
    if (!this.state.motionId) fail('RENDERER_NOT_PLAYING', 'There is no Motion available to restart.');
    this.state = cloneState(await this.evaluate(pageRestart, this.options.motionPriority));
    return this.getState();
  }

  async setLoop(loop) {
    if (typeof loop !== 'boolean') fail('INVALID_RENDERER_ARGUMENT', 'loop must be a boolean.');
    this.state.loop = loop;
    if (this.source) this.state = cloneState(await this.evaluate(pageSetPlayback, loop, undefined));
    return this.state.loop;
  }

  async setSpeed(speed) {
    const playbackSpeed = finiteNumber(speed, 'Playback speed', { min: 0.05, max: 8 });
    this.state.speed = playbackSpeed;
    if (this.source) this.state = cloneState(await this.evaluate(pageSetPlayback, undefined, playbackSpeed));
    return this.state.speed;
  }

  async setExpression(id) {
    this.requireLoaded();
    const expression = id == null ? null : this.source.expressions.find((item) => item.id === id);
    if (id != null && !expression) fail('EXPRESSION_NOT_FOUND', `Expression is not available in the loaded Source Package: ${id}`);
    await this.evaluate(pageSetExpression, expression ? expression.runtimeId : null);
    this.state.expressionId = id == null ? null : expression.id;
    return this.state.expressionId;
  }

  async resize(width, height) {
    this.requireLoaded();
    const targetWidth = positiveInteger(width, 'Renderer width');
    const targetHeight = positiveInteger(height, 'Renderer height');
    const result = await this.evaluate(pageResize, targetWidth, targetHeight);
    this.options.width = targetWidth;
    this.options.height = targetHeight;
    return result;
  }

  async step(deltaSeconds) {
    const delta = finiteNumber(deltaSeconds, 'Step duration', { min: 0, max: 3600 });
    this.requireLoaded();
    this.state = cloneState(await this.evaluate(pageStep, delta));
    return this.getState();
  }

  getState() {
    return cloneState(this.state);
  }

  async getBounds({ motionId = this.state.motionId } = {}) {
    this.requireLoaded();
    this.motion(motionId);
    return this.evaluate(pageBounds, motionId);
  }

  async captureRgba({ width = this.options.width, height = this.options.height, motionId = this.state.motionId, time = this.state.time } = {}) {
    this.requireLoaded();
    const targetWidth = positiveInteger(width, 'Capture width');
    const targetHeight = positiveInteger(height, 'Capture height');
    const motion = this.motion(motionId);
    const captureTime = finiteNumber(time, 'Capture time', { min: 0, max: Math.max(0, motion.duration) });
    const capture = await this.evaluate(pageCapture, motionId, captureTime, targetWidth, targetHeight, this.options.motionPriority);
    if (!capture || capture.width !== targetWidth || capture.height !== targetHeight || !Array.isArray(capture.rgba) || capture.rgba.length !== targetWidth * targetHeight * 4) fail('INVALID_RENDER_CAPTURE', `Pixi renderer returned an invalid RGBA capture for ${motionId}.`);
    this.state.motionId = motion.id;
    this.state.time = captureTime;
    this.state.playing = true;
    return { contractVersion: 1, width: targetWidth, height: targetHeight, motionId: motion.id, time: captureTime, rgba: Uint8Array.from(capture.rgba) };
  }
}

/**
 * Cubism 2 is deliberately exposed as a separate adapter boundary. It reuses
 * the temporary Pixi host mechanics, but refuses modern Source Packages so a
 * future legacy engine can replace it without changing the application
 * renderer contract.
 */
class LegacyPixiLive2dAdapter extends PixiLive2dAdapter {
  async load(source) {
    if (!source || Number(source.cubismVersion) !== 2) fail('LEGACY_SOURCE_REQUIRED', 'The Cubism 2 adapter accepts only Cubism 2 Source Packages.');
    return super.load(source);
  }
}

function selectPixiLive2dAdapter(cubismVersion) {
  const version = Number(cubismVersion);
  if (version === 2) return { kind: 'legacy-cubism2', Adapter: LegacyPixiLive2dAdapter };
  if ([3, 4, 5].includes(version)) return { kind: 'modern-cubism', Adapter: PixiLive2dAdapter };
  fail('UNSUPPORTED_CUBISM_VERSION', `No Pixi Live2D adapter is registered for Cubism generation ${String(cubismVersion)}.`, { cubismVersion });
}

/**
 * Select the replaceable adapter from the inspected Source Package rather
 * than guessing from Motion or file names. Callers that do not provide a
 * source must pass the inspected generation as `cubismVersion`.
 */
function createPixiLive2dAdapter({ source, cubismVersion, ...options } = {}) {
  const version = source && typeof source === 'object' ? source.cubismVersion : cubismVersion;
  const { Adapter } = selectPixiLive2dAdapter(version);
  return new Adapter(options);
}

module.exports = {
  DEFAULT_OPTIONS,
  LegacyPixiLive2dAdapter,
  PixiLive2dAdapter,
  createPixiLive2dAdapter,
  normalizePixiSource,
  pixiSourceFromManifest,
  selectPixiLive2dAdapter,
  pageBounds,
  pageCapture,
  pageLoad,
  pagePause,
  pagePlayMotion,
  pageRestart,
  pageResize,
  pageResume,
  pageSetExpression,
  pageSetPlayback,
  pageStep,
  pageUnload,
};
