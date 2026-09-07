const { RendererContractError } = require('./errors.cjs');
const { normalizeVisualSettings } = require('./visual-settings.cjs');

const DEFAULT_OPTIONS = Object.freeze({ width: 512, height: 512, padding: 0.08, playbackMode: 'manual', loadTimeoutMs: 15000 });
const SUPPORTED_SPINE_RUNTIME_LINES = Object.freeze(['4.0', '4.1', '4.2', '4.3']);

function fail(code, message, details = {}) { throw new RendererContractError(code, message, details); }
function finite(value, label, minimum, maximum) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < minimum || number > maximum) fail('INVALID_RENDERER_ARGUMENT', `${label} must be between ${minimum} and ${maximum}.`);
  return number;
}
function integer(value, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1 || number > 4096) fail('INVALID_RENDER_SIZE', `${label} must be an integer between 1 and 4096.`);
  return number;
}
function encodeRelativeUrl(value) { return String(value).split('/').map(encodeURIComponent).join('/'); }
function supportsSpineRuntime(value) { return SUPPORTED_SPINE_RUNTIME_LINES.includes(String(value)); }

function spineSourceFromManifest(manifest, { baseUrl = '' } = {}) {
  if (!manifest || manifest.model?.format !== 'spine' || !supportsSpineRuntime(manifest.model?.runtimeLine)) fail('INVALID_RENDER_SOURCE', 'A supported Spine 4.x manifest is required.');
  const prefix = String(baseUrl).replace(/\/+$/, '');
  return {
    format: 'spine',
    runtimeLine: manifest.model.runtimeLine,
    binary: manifest.model.binary === true,
    skeletonUrl: `${prefix}/${encodeRelativeUrl(manifest.model.modelFile)}`,
    atlasUrl: `${prefix}/${encodeRelativeUrl(manifest.model.atlasFile)}`,
    motions: manifest.motions.map((motion) => ({ id: motion.id, name: motion.name || motion.id, duration: Number(motion.duration) || 0 })),
    slots: (manifest.visualElements || []).map((slot) => ({ ...slot })),
  };
}

function pageLoad(source, options) {
  return new Promise((resolve, reject) => {
    if (!window.spine?.SpinePlayer) return reject(new Error('The optional Spine Player runtime is not loaded.'));
    const previous = window.__live2petSpine;
    if (previous?.player) previous.player.dispose();
    document.body.innerHTML = '<div id="live2pet-spine-stage"></div>';
    const container = document.getElementById('live2pet-spine-stage');
    Object.assign(container.style, { width: `${options.width}px`, height: `${options.height}px`, overflow: 'hidden', background: 'transparent' });
    const state = { contractVersion: 1, loaded: false, motionId: source.motions[0]?.id || null, expressionId: null, time: 0, playing: false, loop: true, speed: 1 };
    const runtime = {
      player: null, source, state, hidden: [], options, container,
      applyHidden() {
        const hidden = new Set(this.hidden);
        for (const slot of this.player.skeleton.slots) if (hidden.has(`slot:${slot.data.name}`)) {
          if (source.runtimeLine === '4.3') slot.pose.setAttachment(null);
          else slot.setAttachment(null);
        }
      },
      motion(id = this.state.motionId) { return this.player.skeleton.data.findAnimation(id); },
      track() { const state = this.player.animationState; return source.runtimeLine === '4.3' ? state.getTrack(0) : state.getCurrent(0); },
      pose(time) {
        const animation = this.motion();
        if (source.runtimeLine === '4.3') this.player.skeleton.setupPose();
        else this.player.skeleton.setToSetupPose();
        if (animation) animation.apply(this.player.skeleton, time, time, this.state.loop, [], 1, 1, false, false, false);
        this.applyHidden();
        this.player.skeleton.updateWorldTransform(2);
      },
      slotBounds(slotId) {
        const slotName = slotId?.startsWith('slot:') ? slotId.slice(5) : slotId;
        const hidden = [...this.hidden];
        this.hidden = this.player.skeleton.slots.filter((slot) => slot.data.name !== slotName).map((slot) => `slot:${slot.data.name}`);
        this.pose(this.state.time);
        const result = this.readBounds();
        this.hidden = hidden;
        this.pose(this.state.time);
        return result;
      },
      readBounds() {
        const offset = new window.spine.Vector2(), size = new window.spine.Vector2();
        const renderer = this.player.sceneRenderer.skeletonRenderer;
        this.player.skeleton.getBounds(offset, size, [0, 0], renderer.getSkeletonClipping ? renderer.getSkeletonClipping() : renderer.clipper);
        return Number.isFinite(size.x) && Number.isFinite(size.y) && size.x > 0 && size.y > 0 ? { x: offset.x, y: offset.y, width: size.x, height: size.y } : null;
      },
      fit(motionId) {
        const motion = this.source.motions.find((item) => item.id === motionId);
        if (!motion) throw new Error(`Animation is not available: ${motionId}`);
        let left = Infinity, bottom = Infinity, right = -Infinity, top = -Infinity;
        const samples = 32;
        for (let index = 0; index < samples; index += 1) {
          this.pose(motion.duration * (samples === 1 ? 0 : index / (samples - 1)));
          const bounds = this.readBounds();
          if (!bounds) continue;
          left = Math.min(left, bounds.x); bottom = Math.min(bottom, bounds.y); right = Math.max(right, bounds.x + bounds.width); top = Math.max(top, bounds.y + bounds.height);
        }
        if (!Number.isFinite(left)) {
          this.pose(this.state.time);
          return { motionId, samples, x: 0, y: 0, width: 0, height: 0, normalized: false, empty: true };
        }
        const width = right - left, height = top - bottom, padX = width * this.options.padding, padY = height * this.options.padding;
        this.player.previousViewport = null;
        this.player.currentViewport = { x: left, y: bottom, width, height, padLeft: padX, padRight: padX, padTop: padY, padBottom: padY, clip: false };
        this.pose(this.state.time);
        return { motionId, samples, x: left, y: bottom, width, height, normalized: false };
      },
      draw() {
        const paused = this.player.paused;
        this.player.paused = true;
        try { this.player.drawFrame(false); } finally { this.player.paused = paused; }
      },
      startRendering() {
        if (!this.player.stopRequestAnimationFrame) return;
        if (this.player.startRendering) this.player.startRendering();
        else { this.player.stopRequestAnimationFrame = false; this.player.drawFrame(); }
      },
    };
    window.__live2petSpine = runtime;
    let settled = false;
    let loadPoll = null;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(loadTimer);
      if (loadPoll !== null) window.clearInterval(loadPoll);
      callback(value);
    };
    const loadTimer = window.setTimeout(() => {
      finish(reject, new Error(`Spine Player did not finish loading within ${options.loadTimeoutMs} ms.`));
    }, options.loadTimeoutMs);
    runtime.player = new window.spine.SpinePlayer(container, {
      ...(source.runtimeLine === '4.3'
        ? { skeleton: source.skeletonUrl, atlas: source.atlasUrl }
        : { [source.binary ? 'binaryUrl' : 'jsonUrl']: source.skeletonUrl, atlasUrl: source.atlasUrl }),
      animation: source.motions[0]?.id,
      showControls: false,
      showLoading: false,
      alpha: true,
      preserveDrawingBuffer: true,
      backgroundColor: '#00000000',
      viewport: { transitionTime: 0, padLeft: 0, padRight: 0, padTop: 0, padBottom: 0 },
      updateWorldTransform(player) { runtime.applyHidden(); player.skeleton.updateWorldTransform(2); },
      update() { runtime.applyHidden(); },
      frame(_player, delta) {
        if (!runtime.state.playing) return;
        const motion = runtime.source.motions.find((item) => item.id === runtime.state.motionId);
        runtime.state.time += delta;
        if (motion?.duration > 0 && runtime.state.time >= motion.duration) {
          if (runtime.state.loop) runtime.state.time %= motion.duration;
          else { runtime.state.time = motion.duration; runtime.state.playing = false; runtime.player.pause(); }
        }
      },
      success(player) {
        runtime.player = player;
        if (!runtime.source.motions.length) runtime.source.motions = player.skeleton.data.animations.map((animation) => ({ id: animation.name, name: animation.name, duration: animation.duration }));
        if (!runtime.source.motions.length) return finish(reject, new Error('Spine skeleton contains no animations.'));
        runtime.state.motionId = runtime.source.motions[0].id;
        player.setAnimation(runtime.state.motionId, true);
        runtime.state.loaded = true;
        runtime.fit(runtime.state.motionId);
        if (options.playbackMode === 'manual') { player.pause(); player.stopRendering(); runtime.draw(); }
        finish(resolve, {
          state: { ...runtime.state },
          motions: runtime.source.motions.map((motion) => ({ ...motion })),
          slots: player.skeleton.slots.map((slot) => ({ id: `slot:${slot.data.name}`, name: slot.data.name, kind: 'slot' })),
        });
      },
      error(_player, message) { finish(reject, new Error(message || 'Spine Player failed to load the skeleton.')); },
    });
    // Spine Player completes asset initialization from requestAnimationFrame.
    // Electron may suspend that callback for the hidden view used by library
    // thumbnails, so explicitly advance a frame once every asset is ready.
    if (!settled) loadPoll = window.setInterval(() => {
      if (runtime.player?.skeleton || !runtime.player?.assetManager?.isLoadingComplete()) return;
      try { runtime.player.drawFrame(false); } catch (error) { finish(reject, error); }
    }, 25);
  });
}

function pageUnload() { const runtime = window.__live2petSpine; runtime?.player?.dispose(); delete window.__live2petSpine; document.body.innerHTML = ''; return { loaded: false }; }
function pageState() { const runtime = window.__live2petSpine; if (!runtime) throw new Error('Renderer is not loaded.'); return { ...runtime.state }; }
function pagePlay(id, loop, speed, start) { const runtime = window.__live2petSpine; const motion = runtime.source.motions.find((item) => item.id === id); if (!motion) throw new Error(`Animation is not available: ${id}`); runtime.player.setAnimation(id, loop); const entry = runtime.track(); if (entry) entry.trackTime = start; runtime.state = { ...runtime.state, motionId: id, loop, speed, time: start, playing: true }; runtime.player.speed = speed; runtime.player.paused = false; runtime.pose(start); runtime.fit(id); runtime.draw(); if (runtime.options.playbackMode === 'realtime') runtime.startRendering(); return { ...runtime.state }; }
function pagePause() { const runtime = window.__live2petSpine; runtime.state.playing = false; runtime.player.pause(); return { ...runtime.state }; }
function pageResume() { const runtime = window.__live2petSpine; runtime.state.playing = true; runtime.player.speed = runtime.state.speed; runtime.player.play(); return { ...runtime.state }; }
function pageRestart() { const runtime = window.__live2petSpine; const id = runtime.state.motionId; runtime.player.setAnimation(id, runtime.state.loop); runtime.state.time = 0; runtime.state.playing = true; runtime.player.speed = runtime.state.speed; runtime.player.paused = false; runtime.pose(0); runtime.fit(id); runtime.draw(); if (runtime.options.playbackMode === 'realtime') runtime.startRendering(); return { ...runtime.state }; }
function pagePlayback(loop, speed) { const runtime = window.__live2petSpine; if (loop !== null) { runtime.state.loop = loop; const entry = runtime.track(); if (entry) entry.loop = loop; } if (speed !== null) { runtime.state.speed = speed; runtime.player.speed = speed; } return { ...runtime.state }; }
function pageSeek(time) { const runtime = window.__live2petSpine; runtime.state.time = time; runtime.pose(time); runtime.draw(); return { ...runtime.state }; }
function pageStep(delta) { const runtime = window.__live2petSpine; if (!runtime.state.playing) return { ...runtime.state }; const motion = runtime.source.motions.find((item) => item.id === runtime.state.motionId); let next = runtime.state.time + delta * runtime.state.speed; if (motion.duration > 0 && next >= motion.duration) { if (runtime.state.loop) next %= motion.duration; else { next = motion.duration; runtime.state.playing = false; } } runtime.state.time = next; runtime.pose(next); runtime.draw(); return { ...runtime.state }; }
function pageResize(width, height) { const runtime = window.__live2petSpine; runtime.container.style.width = `${width}px`; runtime.container.style.height = `${height}px`; runtime.draw(); return { width, height }; }
function pageBounds(id) { const runtime = window.__live2petSpine; return runtime.fit(id); }
function pageVisualElements() { const runtime = window.__live2petSpine; return runtime.player.skeleton.slots.map((slot) => ({ id: `slot:${slot.data.name}`, name: slot.data.name, kind: 'slot' })); }
function pageVisualSettings(settings) { const runtime = window.__live2petSpine; runtime.hidden = [...settings.hiddenElementIds]; runtime.pose(runtime.state.time); const bounds = runtime.readBounds(); if (bounds) runtime.fit(runtime.state.motionId); runtime.draw(); return { hiddenElementIds: [...runtime.hidden] }; }
function pageThumbnail(id) { const runtime = window.__live2petSpine; const saved = [...runtime.hidden]; runtime.hidden = runtime.player.skeleton.slots.filter((slot) => `slot:${slot.data.name}` !== id).map((slot) => `slot:${slot.data.name}`); runtime.pose(runtime.state.time); try { if (!runtime.readBounds()) return { id, dataUrl: null }; runtime.fit(runtime.state.motionId); runtime.draw(); return { id, dataUrl: runtime.player.canvas.toDataURL('image/png') }; } finally { runtime.hidden = saved; runtime.pose(runtime.state.time); if (runtime.readBounds()) runtime.fit(runtime.state.motionId); runtime.draw(); } }
function pageScan(id) { const runtime = window.__live2petSpine; const saved = [...runtime.hidden]; if (runtime.state.motionId !== id) { runtime.player.setAnimation(id, runtime.state.loop); runtime.state.motionId = id; runtime.state.time = 0; } runtime.pose(runtime.state.time); const full = runtime.readBounds(); const fullArea = Math.max(1, (full?.width || 0) * (full?.height || 0)); const elements = runtime.player.skeleton.slots.map((slot) => ({ id: `slot:${slot.data.name}` })); const candidates = elements.map((element) => { const bounds = runtime.slotBounds(element.id); return { id: element.id, dataUrl: null, time: runtime.state.time, areaRatio: bounds ? Math.min(1, bounds.width * bounds.height / fullArea) : 0 }; }).filter((item) => item.areaRatio >= 0.15).sort((a, b) => b.areaRatio - a.areaRatio).slice(0, 8); runtime.hidden = saved; runtime.pose(runtime.state.time); runtime.draw(); return { motionId: id, candidates }; }
function pageCapture(id, time, width, height, binary) { const runtime = window.__live2petSpine; const canvas = runtime.player.canvas; const previousWidth = canvas.style.width, previousHeight = canvas.style.height; const dpr = window.devicePixelRatio || 1; canvas.style.width = `${width / dpr}px`; canvas.style.height = `${height / dpr}px`; try { if (runtime.state.motionId !== id) { runtime.player.setAnimation(id, runtime.state.loop); runtime.state.motionId = id; runtime.fit(id); } runtime.state.time = time; runtime.pose(time); runtime.draw(); const gl = runtime.player.context.gl; const pixels = new Uint8Array(width * height * 4); gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels); const stride = width * 4, row = new Uint8Array(stride); for (let y = 0; y < Math.floor(height / 2); y += 1) { const top = y * stride, bottom = (height - y - 1) * stride; row.set(pixels.subarray(top, top + stride)); pixels.copyWithin(top, bottom, bottom + stride); pixels.set(row, bottom); } return { width, height, motionId: id, time, rgba: binary ? pixels : Array.from(pixels) }; } finally { canvas.style.width = previousWidth; canvas.style.height = previousHeight; runtime.draw(); } }

class SpinePlayerAdapter {
  constructor({ page, ...options } = {}) {
    if (!page?.evaluate) fail('INVALID_RENDERER_HOST', 'SpinePlayerAdapter requires an isolated browser page.');
    this.page = page;
    this.options = { ...DEFAULT_OPTIONS, ...options, width: integer(options.width ?? DEFAULT_OPTIONS.width, 'Renderer width'), height: integer(options.height ?? DEFAULT_OPTIONS.height, 'Renderer height'), padding: finite(options.padding ?? DEFAULT_OPTIONS.padding, 'Renderer padding', 0, 0.5), loadTimeoutMs: finite(options.loadTimeoutMs ?? DEFAULT_OPTIONS.loadTimeoutMs, 'Spine load timeout', 1000, 120000) };
    this.source = null; this.state = { loaded: false, motionId: null, expressionId: null, time: 0, playing: false, loop: true, speed: 1 }; this.visualElements = [];
  }
  async evaluate(fn, ...args) { try { return await this.page.evaluate(fn, ...args); } catch (error) { if (error instanceof RendererContractError) throw error; fail('RENDERER_PAGE_ERROR', error?.message || String(error)); } }
  requireLoaded() { if (!this.source || !this.state.loaded) fail('RENDERER_NOT_LOADED', 'Load a Spine Source Package before using the renderer.'); }
  motion(id) { const motion = this.source?.motions.find((item) => item.id === id); if (!motion) fail('MOTION_NOT_FOUND', `Animation is not available: ${id}`); return motion; }
  async load(source) { if (source?.format !== 'spine' || !supportsSpineRuntime(source.runtimeLine) || !Array.isArray(source.motions)) fail('INVALID_RENDER_SOURCE', 'A supported Spine 4.x renderer source is required.'); const loaded = await this.evaluate(pageLoad, source, this.options); this.state = loaded.state; this.source = { ...source, motions: loaded.motions }; this.visualElements = loaded.slots; return { contractVersion: 1, motionCount: this.source.motions.length, expressionCount: 0 }; }
  async unload() { if (this.source) await this.evaluate(pageUnload); this.source = null; this.visualElements = []; this.state = { loaded: false, motionId: null, expressionId: null, time: 0, playing: false, loop: true, speed: 1 }; }
  getVisualElements() { this.requireLoaded(); return this.visualElements.map((item) => ({ ...item })); }
  getMotions() { this.requireLoaded(); return this.source.motions.map((item) => ({ ...item })); }
  async getVisualElementThumbnail(id) { this.requireLoaded(); if (!this.visualElements.some((item) => item.id === id)) fail('VISUAL_ELEMENT_NOT_FOUND', 'Spine Slot is not available.'); return this.evaluate(pageThumbnail, id); }
  async scanVisualElements(id) { this.motion(id); return this.evaluate(pageScan, id); }
  async setVisualSettings(settings) { this.requireLoaded(); return this.evaluate(pageVisualSettings, normalizeVisualSettings(settings)); }
  async playMotion(id, { loop = true, speed = 1, start = 0 } = {}) { const motion = this.motion(id); this.state = await this.evaluate(pagePlay, id, Boolean(loop), finite(speed, 'Playback speed', 0.05, 8), finite(start, 'Animation start', 0, Math.max(0, motion.duration))); return this.getState(); }
  async pause() { this.requireLoaded(); this.state = await this.evaluate(pagePause); return this.getState(); }
  async resume() { this.requireLoaded(); this.state = await this.evaluate(pageResume); return this.getState(); }
  async restart() { this.requireLoaded(); this.state = await this.evaluate(pageRestart); return this.getState(); }
  async setLoop(value) { if (typeof value !== 'boolean') fail('INVALID_RENDERER_ARGUMENT', 'Loop must be a boolean.'); this.state.loop = value; if (this.source) this.state = await this.evaluate(pagePlayback, this.state.loop, null); return this.state.loop; }
  async setSpeed(value) { this.state.speed = finite(value, 'Playback speed', 0.05, 8); if (this.source) this.state = await this.evaluate(pagePlayback, null, this.state.speed); return this.state.speed; }
  async setExpression(id) { if (id != null) fail('EXPRESSION_NOT_FOUND', 'Spine V1 uses the default Skin and does not expose Expressions.'); return null; }
  async resize(width, height) { this.requireLoaded(); this.options.width = integer(width, 'Renderer width'); this.options.height = integer(height, 'Renderer height'); return this.evaluate(pageResize, this.options.width, this.options.height); }
  async step(delta) { this.requireLoaded(); this.state = await this.evaluate(pageStep, finite(delta, 'Step duration', 0, 3600)); return this.getState(); }
  getState() { return { ...this.state }; }
  async readState() { this.requireLoaded(); this.state = await this.evaluate(pageState); return this.getState(); }
  async seek(time) { const state = await this.readState(); this.state = await this.evaluate(pageSeek, finite(time, 'Animation seek time', 0, this.motion(state.motionId).duration)); return this.getState(); }
  async getBounds({ motionId = this.state.motionId } = {}) { this.motion(motionId); return this.evaluate(pageBounds, motionId); }
  async captureRgba({ width = this.options.width, height = this.options.height, motionId = this.state.motionId, time = this.state.time } = {}) { const motion = this.motion(motionId); const targetWidth = integer(width, 'Capture width'), targetHeight = integer(height, 'Capture height'), captureTime = finite(time, 'Capture time', 0, Math.max(0, motion.duration)); const capture = await this.evaluate(pageCapture, motionId, captureTime, targetWidth, targetHeight, this.page.supportsBinaryResults === true); const rgba = ArrayBuffer.isView(capture?.rgba) ? new Uint8Array(capture.rgba.buffer, capture.rgba.byteOffset, capture.rgba.byteLength) : Array.isArray(capture?.rgba) ? Uint8Array.from(capture.rgba) : null; if (!rgba || rgba.byteLength !== targetWidth * targetHeight * 4) fail('INVALID_RENDER_CAPTURE', 'Spine renderer returned an invalid RGBA capture.'); this.state.motionId = motionId; this.state.time = captureTime; return { contractVersion: 1, width: targetWidth, height: targetHeight, motionId, time: captureTime, rgba }; }
}

module.exports = { SUPPORTED_SPINE_RUNTIME_LINES, SpinePlayerAdapter, spineSourceFromManifest, supportsSpineRuntime };
