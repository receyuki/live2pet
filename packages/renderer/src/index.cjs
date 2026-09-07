const { RendererContractError } = require('./errors.cjs');
const { normalizeVisualSettings } = require('./visual-settings.cjs');

const CONTRACT_VERSION = 1;
const CONTRACT_METHODS = [
  'load',
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
  'getVisualElements',
  'getVisualElementThumbnail',
  'scanVisualElements',
  'setVisualSettings',
];

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

function assertRenderer(renderer) {
  if (!renderer || typeof renderer !== 'object') fail('INVALID_RENDERER', 'Renderer must be an object implementing the renderer contract.');
  const missing = CONTRACT_METHODS.filter((method) => typeof renderer[method] !== 'function');
  if (missing.length) fail('INCOMPLETE_RENDERER', `Renderer is missing contract methods: ${missing.join(', ')}.`);
  return renderer;
}

function alphaBounds(rgba, width, height) {
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    if (rgba[(y * width + x) * 4 + 3] === 0) continue;
    left = Math.min(left, x);
    top = Math.min(top, y);
    right = Math.max(right, x);
    bottom = Math.max(bottom, y);
  }
  if (right < left || bottom < top) return null;
  return { x: left / width, y: top / height, width: (right - left + 1) / width, height: (bottom - top + 1) / height };
}

function rgbaDifference(previous, current) {
  if (!previous) return 0;
  if (!current || previous.length !== current.length || !previous.length) return 1;
  let difference = 0;
  for (let index = 0; index < previous.length; index += 1) difference += Math.abs(previous[index] - current[index]);
  return Math.min(1, difference / (previous.length * 255));
}

function boundsDifference(previous, current) {
  if (!previous) return 0;
  if (!current) return 1;
  return Math.min(1, (
    Math.abs(previous.x - current.x)
    + Math.abs(previous.y - current.y)
    + Math.abs(previous.width - current.width)
    + Math.abs(previous.height - current.height)
  ) / 4);
}

async function sampleMotionCandidates(renderer, options = {}) {
  assertRenderer(renderer);
  const motionId = typeof options.motionId === 'string' && options.motionId ? options.motionId : null;
  if (!motionId) fail('INVALID_RENDERER_ARGUMENT', 'motionId is required when sampling a Motion.');
  const duration = finiteNumber(options.duration, 'Motion duration', { min: 0, max: 3600 });
  const samples = positiveInteger(options.samples == null ? 32 : options.samples, 'Motion sample count', 4096);
  const width = positiveInteger(options.width == null ? 256 : options.width, 'Sample width');
  const height = positiveInteger(options.height == null ? 256 : options.height, 'Sample height');
  const hasExpression = Object.prototype.hasOwnProperty.call(options, 'expressionId');
  const previousExpressionId = hasExpression && typeof renderer.getState === 'function' ? renderer.getState().expressionId : null;
  if (hasExpression) await renderer.setExpression(options.expressionId == null ? null : options.expressionId);
  const candidates = [];
  let previousRgba = null;
  let previousBounds = null;
  try {
    for (let index = 0; index < samples; index += 1) {
      if (options.signal?.aborted) fail('BUILD_CANCELLED', 'Package Build was cancelled.');
      const time = duration * (samples === 1 ? 0 : index / (options.includeEndpoint === false ? samples : samples - 1));
      const capture = await renderer.captureRgba({ width, height, motionId, time });
      if (!capture || capture.width !== width || capture.height !== height || !ArrayBuffer.isView(capture.rgba) || capture.rgba.byteLength !== width * height * 4) fail('INVALID_RENDER_CAPTURE', `Renderer returned an invalid RGBA capture for ${motionId} at sample ${index}.`);
      const rgba = new Uint8Array(capture.rgba.buffer, capture.rgba.byteOffset, capture.rgba.byteLength);
      const bounds = alphaBounds(rgba, width, height);
      candidates.push({ id: `${motionId}#${index}`, time, bounds, visualChange: rgbaDifference(previousRgba, rgba), boundsDelta: boundsDifference(previousBounds, bounds), width, height, rgba: new Uint8Array(rgba) });
      previousRgba = rgba;
      previousBounds = bounds;
      options.onFrame?.({ completed: index + 1, total: samples });
    }
  } finally {
    if (hasExpression) await renderer.setExpression(previousExpressionId);
  }
  return { contractVersion: CONTRACT_VERSION, motionId, expressionId: hasExpression ? (options.expressionId == null ? null : options.expressionId) : previousExpressionId, duration, samples, width, height, candidates };
}

function stableSeed(value) {
  let seed = 2166136261;
  for (const character of String(value || 'motion')) seed = Math.imul(seed ^ character.charCodeAt(0), 16777619);
  return seed >>> 0;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function normalizeMotion(motion, index) {
  if (!motion || typeof motion !== 'object' || typeof motion.id !== 'string' || !motion.id) fail('INVALID_RENDER_SOURCE', `Motion ${index} must have a non-empty id.`);
  const duration = motion.duration == null ? 1 : finiteNumber(motion.duration, `Motion ${motion.id} duration`, { min: 0, max: 3600 });
  return { id: motion.id, name: typeof motion.name === 'string' && motion.name ? motion.name : motion.id, duration };
}

class SyntheticRenderer {
  constructor() {
    this.loaded = false;
    this.motions = [];
    this.expressions = [];
    this.activeMotionId = null;
    this.activeExpressionId = null;
    this.time = 0;
    this.playing = false;
    this.loop = true;
    this.speed = 1;
  }

  async load(source) {
    if (!source || typeof source !== 'object' || !Array.isArray(source.motions)) fail('INVALID_RENDER_SOURCE', 'Renderer source must contain a motions array.');
    this.motions = source.motions.map(normalizeMotion);
    this.expressions = Array.isArray(source.expressions) ? source.expressions.filter((expression) => expression && typeof expression.id === 'string').map((expression) => ({ id: expression.id, name: expression.name || expression.id })) : [];
    this.loaded = true;
    this.activeMotionId = this.motions[0]?.id || null;
    this.activeExpressionId = null;
    this.time = 0;
    this.playing = false;
    return { contractVersion: CONTRACT_VERSION, motionCount: this.motions.length, expressionCount: this.expressions.length };
  }

  async unload() {
    this.loaded = false;
    this.motions = [];
    this.expressions = [];
    this.activeMotionId = null;
    this.activeExpressionId = null;
    this.time = 0;
    this.playing = false;
  }

  getVisualElements() { return []; }

  getVisualElementThumbnail() { fail('VISUAL_ELEMENT_NOT_FOUND', 'Synthetic source has no separable Visual Elements.'); }
  scanVisualElements() { fail('UNSUPPORTED_VISUAL_SCAN', 'Synthetic source has no separable Visual Elements.'); }

  setVisualSettings(settings) {
    if (normalizeVisualSettings(settings).hiddenElementIds.length) fail('UNSUPPORTED_VISUAL_SETTINGS', 'Synthetic source has no separable Visual Elements.');
    return { hiddenElementIds: [] };
  }

  motion(id) {
    const motion = this.motions.find((item) => item.id === id);
    if (!motion) fail('MOTION_NOT_FOUND', `Motion is not available in the loaded Source Package: ${id}`);
    return motion;
  }

  expression(id) {
    const expression = this.expressions.find((item) => item.id === id);
    if (!expression) fail('EXPRESSION_NOT_FOUND', `Expression is not available in the loaded Source Package: ${id}`);
    return expression;
  }

  async playMotion(id, { loop = this.loop, speed = this.speed, start = 0 } = {}) {
    if (!this.loaded) fail('RENDERER_NOT_LOADED', 'Load a Source Package before playing a Motion.');
    const motion = this.motion(id);
    this.setLoop(loop);
    this.setSpeed(speed);
    this.time = clamp(finiteNumber(start, 'Motion start time', { min: 0, max: Math.max(0, motion.duration) }), 0, motion.duration);
    this.activeMotionId = motion.id;
    this.playing = true;
    return this.getState();
  }

  pause() {
    this.playing = false;
    return this.getState();
  }

  resume() {
    if (!this.loaded || !this.activeMotionId) fail('RENDERER_NOT_PLAYING', 'There is no Motion available to resume.');
    this.playing = true;
    return this.getState();
  }

  restart() {
    if (!this.loaded || !this.activeMotionId) fail('RENDERER_NOT_PLAYING', 'There is no Motion available to restart.');
    this.time = 0;
    this.playing = true;
    return this.getState();
  }

  setLoop(loop) {
    if (typeof loop !== 'boolean') fail('INVALID_RENDERER_ARGUMENT', 'loop must be a boolean.');
    this.loop = loop;
    return this.loop;
  }

  setSpeed(speed) {
    this.speed = finiteNumber(speed, 'Playback speed', { min: 0.05, max: 8 });
    return this.speed;
  }

  setExpression(id) {
    if (id == null) {
      this.activeExpressionId = null;
      return null;
    }
    this.activeExpressionId = this.expression(id).id;
    return this.activeExpressionId;
  }

  step(deltaSeconds) {
    const delta = finiteNumber(deltaSeconds, 'Step duration', { min: 0, max: 3600 });
    if (!this.loaded || !this.activeMotionId || !this.playing) return this.getState();
    const motion = this.motion(this.activeMotionId);
    const next = this.time + delta * this.speed;
    if (motion.duration === 0) {
      this.time = 0;
      this.playing = this.loop;
    } else if (next < motion.duration) {
      this.time = next;
    } else if (this.loop) {
      this.time = next % motion.duration;
    } else {
      this.time = motion.duration;
      this.playing = false;
    }
    return this.getState();
  }

  getState() {
    return {
      contractVersion: CONTRACT_VERSION,
      loaded: this.loaded,
      motionId: this.activeMotionId,
      expressionId: this.activeExpressionId,
      time: this.time,
      playing: this.playing,
      loop: this.loop,
      speed: this.speed,
    };
  }

  boundsAt(motionId, time) {
    const motion = this.motion(motionId);
    const seed = stableSeed(motion.id);
    const progress = motion.duration > 0 ? clamp(time / motion.duration, 0, 1) : 0;
    const width = 0.46 + (seed % 17) / 100;
    const height = 0.84 + ((seed >>> 5) % 13) / 100;
    const sway = Math.sin(progress * Math.PI * 2) * (0.025 + ((seed >>> 9) % 9) / 1000);
    return { x: 0.5 - width / 2 + sway, y: 0.98 - height, width, height };
  }

  getBounds({ motionId = this.activeMotionId, samples = 32 } = {}) {
    if (!this.loaded || !motionId) fail('RENDERER_NOT_LOADED', 'Load and select a Motion before measuring bounds.');
    const motion = this.motion(motionId);
    const count = positiveInteger(samples, 'Bounds sample count', 4096);
    const frames = [];
    for (let index = 0; index < count; index += 1) frames.push(this.boundsAt(motion.id, motion.duration * (count === 1 ? 0 : index / (count - 1))));
    const left = Math.min(...frames.map((frame) => frame.x));
    const top = Math.min(...frames.map((frame) => frame.y));
    const right = Math.max(...frames.map((frame) => frame.x + frame.width));
    const bottom = Math.max(...frames.map((frame) => frame.y + frame.height));
    return { motionId: motion.id, samples: count, x: left, y: top, width: right - left, height: bottom - top, normalized: true };
  }

  captureRgba({ width = 256, height = 256, motionId = this.activeMotionId, time = this.time } = {}) {
    const targetWidth = positiveInteger(width, 'Capture width');
    const targetHeight = positiveInteger(height, 'Capture height');
    if (!this.loaded || !motionId) fail('RENDERER_NOT_LOADED', 'Load and select a Motion before capturing RGBA.');
    const motion = this.motion(motionId);
    const captureTime = clamp(finiteNumber(time, 'Capture time', { min: 0, max: Math.max(0, motion.duration) }), 0, motion.duration);
    const bounds = this.boundsAt(motion.id, captureTime);
    const seed = stableSeed(motion.id);
    const data = new Uint8Array(targetWidth * targetHeight * 4);
    const color = [80 + (seed & 63), 110 + ((seed >>> 6) & 63), 170 + ((seed >>> 12) & 63)];
    const drawEllipse = (centerX, centerY, radiusX, radiusY, alpha = 236) => {
      const minX = Math.max(0, Math.floor((centerX - radiusX) * targetWidth));
      const maxX = Math.min(targetWidth - 1, Math.ceil((centerX + radiusX) * targetWidth));
      const minY = Math.max(0, Math.floor((centerY - radiusY) * targetHeight));
      const maxY = Math.min(targetHeight - 1, Math.ceil((centerY + radiusY) * targetHeight));
      for (let y = minY; y <= maxY; y += 1) for (let x = minX; x <= maxX; x += 1) {
        const dx = (x / targetWidth + 0.5 / targetWidth - centerX) / radiusX;
        const dy = (y / targetHeight + 0.5 / targetHeight - centerY) / radiusY;
        if (dx * dx + dy * dy <= 1) {
          const offset = (y * targetWidth + x) * 4;
          data[offset] = color[0];
          data[offset + 1] = color[1];
          data[offset + 2] = color[2];
          data[offset + 3] = alpha;
        }
      }
    };
    const centerX = bounds.x + bounds.width / 2;
    const bodyY = bounds.y + bounds.height * 0.59;
    drawEllipse(centerX, bodyY, bounds.width * 0.39, bounds.height * 0.41);
    drawEllipse(centerX, bounds.y + bounds.height * 0.2, bounds.width * 0.3, bounds.height * 0.22);
    drawEllipse(centerX - bounds.width * 0.42, bodyY - bounds.height * 0.02, bounds.width * 0.12, bounds.height * 0.25);
    drawEllipse(centerX + bounds.width * 0.42, bodyY - bounds.height * 0.02, bounds.width * 0.12, bounds.height * 0.25);
    return { contractVersion: CONTRACT_VERSION, width: targetWidth, height: targetHeight, motionId: motion.id, time: captureTime, rgba: data };
  }
}

module.exports = {
  CONTRACT_METHODS,
  CONTRACT_VERSION,
  RendererContractError,
  SyntheticRenderer,
  alphaBounds,
  assertRenderer,
  sampleMotionCandidates,
  ...require('./pixi-live2d-adapter.cjs'),
  ...require('./renderer-selection.cjs'),
  ...require('./host.cjs'),
  ...require('./asset-server.cjs'),
  ...require('./visual-settings.cjs'),
  ...require('./spine-player-adapter.cjs'),
};
