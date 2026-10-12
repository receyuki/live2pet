const { SpinePlayerAdapter } = require('./spine-player-adapter.cjs');
const { RendererContractError } = require('./errors.cjs');

function usesLegacySpine(source) {
  return source?.format === 'spine' && (['2.1', '3.5', '3.6', '3.7'].includes(source.runtimeLine) || source.runtimeLine === '3.8' && source.spineVersion === '3.8.75');
}

/** Serialized into a dedicated renderer realm; all executable assets come from the verified pack. */
async function pageLegacySpineLoad(source, options) {
  const PIXI = window.PIXI;
  if (!PIXI?.Application) throw new Error('The optional legacy Spine Pixi runtime is not loaded.');
  const previous = window.__live2petSpine;
  if (previous?.player) previous.dispose();
  document.body.innerHTML = '<div id="live2pet-spine-stage"></div>';
  const container = document.getElementById('live2pet-spine-stage');
  Object.assign(container.style, { width: `${options.width}px`, height: `${options.height}px`, overflow: 'hidden', background: 'transparent' });
  const canvas = document.createElement('canvas');
  container.appendChild(canvas);
  const app = new PIXI.Application({ view: canvas, width: options.width, height: options.height, resolution: 1, backgroundAlpha: 0, antialias: true, preserveDrawingBuffer: true, autoStart: false });
  const textures = new Set(), warnings = [], declaredSizes = new Map();
  const filters = new Map();
  const controller = new AbortController();
  const loadTimer = window.setTimeout(() => controller.abort(), options.loadTimeoutMs);
  let scene, disposed = false;
  const state = { contractVersion: 1, loaded: false, motionId: null, expressionId: null, time: 0, playing: false, loop: true, speed: 1 };
  const runtime = {
    player: null, source, options, container, state, hidden: [], active: options.playbackMode === 'realtime', frame: null,
    dispose() {
      disposed = true;
      if (this.frame !== null) window.cancelAnimationFrame(this.frame);
      this.frame = null;
      controller.abort();
      app.destroy(false, { children: true, texture: true, baseTexture: true });
      for (const texture of textures) if (!texture.destroyed) texture.destroy();
    },
    applyHidden() {
      const hidden = new Set(this.hidden);
      for (const slot of scene.skeleton.slots) if (hidden.has(`slot:${slot.data.name}`)) slot.setAttachment(null);
    },
    motion(id = this.state.motionId) { return scene.skeleton.data.animations.find(animation => animation.name === id); },
    track() { return scene.state.getCurrent?.(0) || scene.state.tracks?.[0]; },
    pose(time) {
      scene.state.clearTracks();
      scene.skeleton.setToSetupPose();
      this.player.setAnimation(this.state.motionId, this.state.loop);
      scene.update(time);
      this.applyHidden();
    },
    readBounds() {
      const bounds = scene.getLocalBounds();
      return [bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite) && bounds.width > 0 && bounds.height > 0
        ? { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height } : null;
    },
    slotBounds(id) {
      const saved = this.hidden;
      this.hidden = scene.skeleton.slots.filter(slot => `slot:${slot.data.name}` !== id).map(slot => `slot:${slot.data.name}`);
      this.pose(this.state.time);
      const bounds = this.readBounds();
      this.hidden = saved;
      this.pose(this.state.time);
      return bounds;
    },
    fit(id) {
      const motion = this.motion(id);
      if (!motion) throw new Error(`Animation is not available: ${id}`);
      const previousId = this.state.motionId;
      this.state.motionId = id;
      let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
      for (let sample = 0; sample < 32; sample++) {
        this.pose(motion.duration * sample / 31);
        const bounds = this.readBounds();
        if (!bounds) continue;
        left = Math.min(left, bounds.x); top = Math.min(top, bounds.y);
        right = Math.max(right, bounds.x + bounds.width); bottom = Math.max(bottom, bounds.y + bounds.height);
      }
      this.state.motionId = previousId;
      this.pose(this.state.time);
      if (!Number.isFinite(left)) return { motionId: id, samples: 32, x: 0, y: 0, width: 0, height: 0, normalized: false, empty: true };
      const bounds = { x: left, y: top, width: right - left, height: bottom - top };
      this.player.currentViewport = bounds;
      return { motionId: id, samples: 32, ...bounds, normalized: false };
    },
    draw() {
      const dpr = window.devicePixelRatio || 1;
      const width = Math.max(1, Math.round((parseFloat(canvas.style.width) || parseFloat(container.style.width)) * dpr));
      const height = Math.max(1, Math.round((parseFloat(canvas.style.height) || parseFloat(container.style.height)) * dpr));
      if (canvas.width !== width || canvas.height !== height) app.renderer.resize(width, height);
      const bounds = this.player.currentViewport;
      if (bounds) {
        const scale = Math.min(width / (bounds.width * (1 + 2 * options.padding)), height / (bounds.height * (1 + 2 * options.padding)));
        scene.scale.set(scale);
        scene.position.set((width - bounds.width * scale) / 2 - bounds.x * scale, (height - bounds.height * scale) / 2 - bounds.y * scale);
      }
      app.renderer.render(app.stage);
    },
    syncPlayback() {
      if (this.frame !== null) window.cancelAnimationFrame(this.frame);
      this.frame = null;
      if (!this.active || options.playbackMode !== 'realtime' || !this.state.playing || disposed) return;
      let previous = performance.now();
      const tick = now => {
        this.frame = null;
        this.state.time += (now - previous) / 1000 * this.state.speed;
        previous = now;
        const duration = this.motion()?.duration;
        if (duration > 0 && this.state.time >= duration) {
          if (this.state.loop) this.state.time %= duration;
          else { this.state.time = duration; this.state.playing = false; }
        }
        this.pose(this.state.time); this.draw();
        if (this.state.playing && !disposed) this.frame = window.requestAnimationFrame(tick);
      };
      this.frame = window.requestAnimationFrame(tick);
    },
  };
  window.__live2petSpine = runtime;
  const image = async name => {
    const texture = PIXI.BaseTexture.from(new URL(name, source.atlasUrl).href, filters.get(name));
    textures.add(texture);
    if (!texture.valid) await new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error('Spine texture did not finish loading.')), options.loadTimeoutMs);
      const done = error => { window.clearTimeout(timer); texture.off('loaded', loaded); texture.off('error', failed); error ? reject(error) : resolve(); };
      const loaded = () => done(), failed = () => done(new Error(`Spine texture could not be loaded: ${name}`));
      texture.once('loaded', loaded); texture.once('error', failed);
    });
    const size = declaredSizes.get(name);
    if (size && size.width >= texture.width && size.height >= texture.height && size.width - texture.width <= 16 && size.height - texture.height <= 16 && size.width * size.height <= 4096 ** 2 && (size.width !== texture.width || size.height !== texture.height)) {
      const padded = document.createElement('canvas'); padded.width = size.width; padded.height = size.height;
      padded.getContext('2d').drawImage(texture.resource.source, 0, 0);
      texture.destroy();
      const replacement = PIXI.BaseTexture.from(padded, filters.get(name)); textures.add(replacement); return replacement;
    }
    if (size && size.width > 0 && size.height > 0 && size.width <= 32768 && size.height <= 32768 && (size.width !== texture.width || size.height !== texture.height)) {
      // Logical atlas coordinates change; the GPU keeps the original downscaled pixels.
      texture.setSize(size.width, size.height);
    }
    return texture;
  };
  try {
    const [skeletonResponse, atlasResponse] = await Promise.all([fetch(source.skeletonUrl, { signal: controller.signal }), fetch(source.atlasUrl, { signal: controller.signal })]);
    if (!skeletonResponse.ok || !atlasResponse.ok) throw new Error('Spine skeleton or atlas could not be loaded.');
    const atlasText = await atlasResponse.text();
    let page = '', header = false, nextPage = true;
    for (const line of atlasText.split(/\r?\n/)) {
      const value = line.trim();
      if (!value) { nextPage = true; continue; }
      if (nextPage) { page = value; header = true; nextPage = false; continue; }
      if (!value.includes(':')) { header = false; continue; }
      const size = header && /^size:\s*(\d+)\s*,\s*(\d+)$/.exec(value);
      if (size && +size[1] > 0 && +size[2] > 0 && +size[1] <= 32768 && +size[2] <= 32768) declaredSizes.set(page, { width: +size[1], height: +size[2] });
      const filter = header && /^filter:\s*(\w+)\s*,\s*(\w+)$/.exec(value);
      if (filter) filters.set(page, { mipmap: filter[1].startsWith('MipMap') ? PIXI.MIPMAP_MODES.POW2 : PIXI.MIPMAP_MODES.OFF, scaleMode: filter[2] === 'Nearest' ? PIXI.SCALE_MODES.NEAREST : PIXI.SCALE_MODES.LINEAR });
    }
    const bytes = source.binary ? await skeletonResponse.arrayBuffer() : null;
    if (bytes?.byteLength > (source.runtimeLine === '2.1' ? 8 : 64) * 1024 * 1024) throw new Error('Spine skeleton exceeds the decoder resource limit.');
    let json = bytes ? null : await skeletonResponse.json();
    if (source.runtimeLine === '2.1') {
      if (typeof window.ryLegacySpineFactory !== 'function') throw new Error('The optional Spine 2.1 runtime is not loaded.');
      const namespace = { ...PIXI, loaders: { Loader: { addPixiMiddleware() {} } }, loader: { use() {} }, mesh: { Mesh: Object.assign(PIXI.SimpleMesh, { DRAW_MODES: PIXI.DRAW_MODES }) } };
      const api = window.ryLegacySpineFactory(namespace);
      const atlas = await new Promise((resolve, reject) => {
        let value;
        value = new api.SpineRuntime.Atlas(atlasText, (name, callback) => { image(name).then(callback, reject); }, () => resolve(value));
      });
      if (bytes) {
        if (!source.legacyDecoderUrl) throw new Error('The verified Spine 2.1 decoder is not available.');
        const decoder = new URL(source.legacyDecoderUrl, window.location.href);
        const verifiedDecoder = new URL('vendor/spine-decoder.js', new URL('.', window.location.href));
        if (decoder.href !== verifiedDecoder.href) throw new Error('The Spine decoder must come from the verified renderer asset server.');
        const worker = new Worker(decoder.href);
        try {
          json = await new Promise((resolve, reject) => {
            const timer = window.setTimeout(() => reject(new Error('Spine 2.1 binary decoding timed out.')), Math.min(10000, options.loadTimeoutMs));
            worker.onmessage = event => { window.clearTimeout(timer); event.data.error ? reject(new Error(event.data.error)) : resolve(event.data.json); };
            worker.onerror = () => { window.clearTimeout(timer); reject(new Error('Spine 2.1 binary decoding failed.')); };
            worker.postMessage(bytes, [bytes]);
          });
        } finally { worker.terminate(); }
      }
      if (!json || !Array.isArray(json.bones) || json.bones.length > 2000 || !Array.isArray(json.slots) || json.slots.length > 2000 || Object.keys(json.skins || {}).length > 256 || Object.keys(json.animations || {}).length > 200) throw new Error('Spine 2.1 decoded model exceeds the supported limits.');
      const data = new api.SpineRuntime.SkeletonJsonParser(new api.SpineRuntime.AtlasAttachmentParser(atlas)).readSkeletonData(json);
      scene = new api.Spine(data);
      const update = scene.update.bind(scene);
      scene.update = delta => {
        update(delta);
        for (const slot of scene.skeleton.slots) if (slot.currentMesh && slot.attachment) {
          slot.currentMesh.blendMode = slot.blendMode ?? PIXI.BLEND_MODES.NORMAL;
          slot.currentMesh.tint = PIXI.utils.rgb2hex([(slot.r ?? 1) * (slot.attachment.r ?? 1), (slot.g ?? 1) * (slot.attachment.g ?? 1), (slot.b ?? 1) * (slot.attachment.b ?? 1)]);
          slot.currentMesh.alpha = slot.attachment.a ?? 1;
        }
      };
    } else {
      const { base, runtime: api } = window.live2petLegacySpine || {};
      if (!base?.TextureAtlas || !api?.Spine) throw new Error('The optional legacy Spine runtime is not loaded.');
      const atlas = await new Promise((resolve, reject) => new base.TextureAtlas(atlasText, (name, callback) => { image(name).then(callback, reject); }, resolve));
      const loader = new api.AtlasAttachmentLoader(atlas);
      const deprecated = source.spineVersion === '3.8.75';
      if (source.runtimeLine === '3.5') warnings.push({ code: 'SPINE_JSON_COMPAT', message: 'Spine 3.5 JSON uses a verified compatibility reader; original version and resources are unchanged.' });
      if (deprecated) {
        warnings.push({ code: 'SPINE_LEGACY_EXPORT', message: 'Spine 3.8.75 uses a compatibility reader for this deprecated export.' });
        const missing = new Set();
        for (const method of ['newRegionAttachment', 'newMeshAttachment']) {
          const create = loader[method].bind(loader);
          loader[method] = (skin, name, path) => {
            if (atlas.findRegion(path)) return create(skin, name, path);
            if (!missing.has(path)) warnings.push({ code: 'SPINE_ATTACHMENT_MISSING', message: `Spine atlas attachment is missing: ${path}`, details: { path } });
            missing.add(path); return null;
          };
        }
      }
      const originalRead = base.BinaryInput.prototype.readStringRef, report = console.error;
      let data;
      try {
        // The pinned 3.6 parser uses a newer shared BinaryInput, but 3.6 stores inline strings.
        if (source.runtimeLine === '3.6') base.BinaryInput.prototype.readStringRef = base.BinaryInput.prototype.readString;
        if (deprecated) console.error = (...args) => { if (!(args.length === 1 && args[0] === 'Unsupported skeleton data, 3.8.75 is deprecated, please export with a newer version of Spine.')) report(...args); };
        data = bytes ? new api.SkeletonBinary(loader).readSkeletonData(new Uint8Array(bytes)) : new api.SkeletonJson(loader).readSkeletonData(json);
      } finally { base.BinaryInput.prototype.readStringRef = originalRead; console.error = report; }
      scene = new api.Spine(data);
    }
    scene.autoUpdate = false; scene.localDelayLimit = 0;
    app.stage.addChild(scene);
    if (source.initialSkin) { scene.skeleton.setSkinByName(source.initialSkin); scene.skeleton.setSlotsToSetupPose(); }
    const transform = scene.skeleton.updateWorldTransform.bind(scene.skeleton);
    scene.skeleton.updateWorldTransform = (...args) => { runtime.applyHidden(); return transform(...args); };
    runtime.source = { ...source, motions: scene.skeleton.data.animations.map(animation => ({ id: animation.name, name: animation.name, duration: animation.duration })) };
    if (!runtime.source.motions.length) throw new Error('Spine skeleton contains no animations.');
    if (runtime.source.motions.length > 200 || runtime.source.motions.some(motion => !motion.id || motion.id.length > 160 || !Number.isFinite(motion.duration) || motion.duration < 0)) throw new Error('Spine animation controls exceed the supported limits.');
    runtime.state.motionId = runtime.source.motions[0].id;
    runtime.player = {
      canvas, context: { gl: app.renderer.gl }, skeleton: scene.skeleton, animationState: scene.state, currentViewport: null,
      setAnimation(id, loop) { if (source.runtimeLine === '2.1') scene.state.setAnimationByName(0, id, loop); else scene.state.setAnimation(0, id, loop); },
      pause() {}, stopRendering() {}, dispose() { runtime.dispose(); }, drawFrame() { runtime.draw(); },
    };
    runtime.pose(0); runtime.fit(runtime.state.motionId); runtime.draw(); runtime.state.loaded = true;
    return { state: { ...runtime.state }, motions: runtime.source.motions, slots: scene.skeleton.slots.map(slot => ({ id: `slot:${slot.data.name}`, name: slot.data.name, kind: 'slot' })), warnings };
  } catch (error) { runtime.dispose(); delete window.__live2petSpine; throw error; }
  finally { window.clearTimeout(loadTimer); }
}

class LegacySpineAdapter extends SpinePlayerAdapter {
  async load(source) {
    if (source?.runtimeLine === '3.5' && source.binary) throw new RendererContractError('UNSUPPORTED_SPINE_FORMAT', 'Spine 3.5 compatibility supports JSON skeletons only.');
    if (!usesLegacySpine(source) || !Array.isArray(source.motions)) throw new RendererContractError('INVALID_RENDER_SOURCE', 'A supported legacy Spine renderer source is required.');
    const loaded = await this.evaluate(pageLegacySpineLoad, source, this.options);
    this.state = loaded.state; this.source = { ...source, motions: loaded.motions }; this.visualElements = loaded.slots; this.warnings = loaded.warnings;
    return { contractVersion: 1, motionCount: this.source.motions.length, expressionCount: 0, warnings: this.getWarnings() };
  }
  getWarnings() { return (this.warnings || []).map(warning => ({ ...warning })); }
  async unload() { await super.unload(); this.warnings = []; }
}

module.exports = { LegacySpineAdapter, usesLegacySpine, pageLegacySpineLoad };
