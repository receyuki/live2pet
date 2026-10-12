const assert = require('node:assert/strict');
const test = require('node:test');
const { LegacySpineAdapter, SpinePlayerAdapter, selectRendererAdapter, spineSourceFromManifest } = require('../src/index.cjs');

function realm() {
  const calls = { destroy: 0, workers: [], frames: new Map(), updateTimes: [], skins: [] };
  let frameId = 0;
  const bones = [{ name: 'root' }];
  const data = { animations: [{ name: 'idle', duration: 2 }], bones };
  class Scene {
    constructor() {
      const slots = ['body', 'background'].map(name => ({ data: { name }, attachment: {}, setAttachment(value) { this.attachment = value; } }));
      this.skeleton = { data, slots, setToSetupPose() { for (const slot of slots) slot.attachment = {}; }, setSkinByName(name) { calls.skins.push(name); }, setSlotsToSetupPose() {}, updateWorldTransform() {} };
      this.state = { tracks: [], clearTracks() { this.tracks = []; }, setAnimation(_track, name, loop) { this.tracks[0] = { animation: name, loop }; }, setAnimationByName(track, name, loop) { this.setAnimation(track, name, loop); }, getCurrent() { return this.tracks[0]; } };
      this.scale = this.position = { set() {} };
    }
    update(time) { calls.updateTimes.push(time); this.skeleton.updateWorldTransform(); }
    getLocalBounds() { return this.skeleton.slots.some(slot => slot.attachment) ? { x: 0, y: 0, width: 50, height: 100 } : { x: 0, y: 0, width: 0, height: 0 }; }
  }
  class TextureAtlas {
    constructor(_text, _load, ready) { queueMicrotask(() => ready(this)); }
    findRegion(path) { return path !== 'missing-background'; }
  }
  class Loader {
    constructor(atlas) { this.atlas = atlas; }
    newRegionAttachment(_skin, _name, path) { if (!this.atlas.findRegion(path)) throw new Error('Missing attachment'); return {}; }
    newMeshAttachment(...args) { return this.newRegionAttachment(...args); }
  }
  class Reader {
    constructor(loader) { this.loader = loader; }
    readSkeletonData(json) { if (json?.missing) this.loader.newRegionAttachment({}, 'bg', 'missing-background'); return data; }
  }
  class BinaryInput {}
  BinaryInput.prototype.readStringRef = function reference() {};
  BinaryInput.prototype.readString = function inline() {};
  const elements = [];
  const document = { body: { innerHTML: '' }, getElementById() { return { style: {}, appendChild() {} }; }, createElement(name) {
    const element = { style: {}, width: 16, height: 16, appendChild() {}, toDataURL() { return 'data:image/png;base64,AA=='; }, getContext() { return { drawImage() {} }; } };
    elements.push({ name, element }); return element;
  } };
  const window = { location: { href: 'http://127.0.0.1:1234/preview', origin: 'http://127.0.0.1:1234' }, devicePixelRatio: 1, setTimeout, clearTimeout,
    requestAnimationFrame(fn) { const id = ++frameId; calls.frames.set(id, fn); return id; }, cancelAnimationFrame(id) { calls.frames.delete(id); },
    PIXI: { Application: class {
      constructor(options) { this.stage = { addChild() {} }; this.renderer = { gl: { RGBA: 1, UNSIGNED_BYTE: 2, readPixels(_x, _y, width, height, _type, _format, bytes) { bytes.fill(255); } }, render() {}, resize(w, h) { options.view.width = w; options.view.height = h; } }; }
      destroy() { calls.destroy++; }
    }, BaseTexture: { from() { return { valid: true, width: 50, height: 100, destroy() { this.destroyed = true; } }; } }, SimpleMesh: class {}, DRAW_MODES: {} },
    live2petLegacySpine: { base: { TextureAtlas, BinaryInput }, runtime: { AtlasAttachmentLoader: Loader, SkeletonBinary: Reader, SkeletonJson: Reader, Spine: Scene } },
    ryLegacySpineFactory() { return { SpineRuntime: { Atlas: TextureAtlas, AtlasAttachmentParser: Loader, SkeletonJsonParser: Reader }, Spine: Scene }; },
  };
  const json = { bones, slots: [{ name: 'body' }], skins: {}, animations: { idle: {} } };
  const fetch = async url => ({ ok: true, async text() { return 'page.png\nsize: 50, 100\n\n'; }, async json() { return { ...json, missing: url.includes('missing') }; }, async arrayBuffer() { return new Uint8Array([1, 2]).buffer; } });
  class Worker {
    constructor(url) { this.url = url; calls.workers.push(this); }
    postMessage() { queueMicrotask(() => this.onmessage({ data: { json } })); }
    terminate() { this.terminated = true; }
  }
  return { window, document, fetch, Worker, calls, elements, BinaryInput };
}

async function withRealm(callback) {
  const context = realm();
  const originals = Object.fromEntries(['window', 'document', 'fetch', 'Worker'].map(key => [key, global[key]]));
  Object.assign(global, context);
  try { await callback(context); } finally { Object.assign(global, originals); }
}

function source(line = '3.6', version = `${line}.0`) { return { format: 'spine', runtimeLine: line, spineVersion: version, binary: false, skeletonUrl: 'http://127.0.0.1:1234/hero.json', atlasUrl: 'http://127.0.0.1:1234/hero.atlas', motions: [], initialSkin: 'default' }; }
function renderer(options = {}) { return new LegacySpineAdapter({ page: { supportsBinaryResults: true, evaluate(fn, ...args) { return fn(...args); } }, width: 16, height: 16, ...options }); }

test('renderer selection preserves explicit version boundaries and 3.8.75 compatibility', () => {
  for (const line of ['2.1', '3.6']) assert.equal(selectRendererAdapter(source(line)).Adapter, LegacySpineAdapter);
  assert.equal(selectRendererAdapter(source('3.8', '3.8.75')).Adapter, LegacySpineAdapter);
  assert.equal(selectRendererAdapter(source('3.8', '3.8.84')).Adapter, SpinePlayerAdapter);
  assert.throws(() => selectRendererAdapter(source('3.7')), { code: 'UNSUPPORTED_SPINE_VERSION' });
  const converted = spineSourceFromManifest({ model: { format: 'spine', runtimeLine: '3.8', spineVersion: '3.8.75', modelFile: 'hero.skel', atlasFile: 'hero.atlas' }, motions: [] });
  assert.equal(converted.spineVersion, '3.8.75');
});

test('legacy renderer reuses playback, seeking, visibility, capture and cleanup contract', async () => withRealm(async context => {
  const ref = context.BinaryInput.prototype.readStringRef;
  const adapter = renderer();
  await adapter.load(source());
  assert.equal(context.BinaryInput.prototype.readStringRef, ref);
  assert.deepEqual(context.calls.skins, ['default']);
  assert.equal(adapter.getMotions()[0].duration, 2);
  await adapter.playMotion('idle', { loop: false, speed: 2 });
  assert.equal((await adapter.step(.5)).time, 1);
  assert.equal((await adapter.seek(.3)).time, .3);
  await adapter.setVisualSettings({ hiddenElementIds: ['slot:background'] });
  assert.equal(context.window.__live2petSpine.player.skeleton.slots[1].attachment, null);
  await adapter.pause();
  assert.equal((await adapter.step(.5)).time, .3);
  await adapter.resume();
  await adapter.restart();
  const capture = await adapter.captureRgba({ width: 8, height: 8, time: .5 });
  assert.equal(capture.rgba.byteLength, 256);
  assert.equal(context.window.__live2petSpine.player.skeleton.slots[1].attachment, null);
  assert.ok(await adapter.getVisualElementThumbnail('slot:body'));
  await adapter.unload();
  assert.equal(context.calls.destroy, 1);
  assert.equal(context.window.__live2petSpine, undefined);
}));

test('3.8.75 missing attachments generate explicit warnings, not blanket error suppression', async () => withRealm(async context => {
  const adapter = renderer();
  const loaded = await adapter.load({ ...source('3.8', '3.8.75'), skeletonUrl: 'http://127.0.0.1:1234/missing.json' });
  assert.deepEqual(loaded.warnings.map(warning => warning.code), ['SPINE_LEGACY_EXPORT', 'SPINE_ATTACHMENT_MISSING']);
  assert.equal(loaded.warnings[1].details.path, 'missing-background');
  await adapter.unload();
}));

test('2.1 binary decoding uses a verified same-origin worker and terminates after success', async () => withRealm(async context => {
  const adapter = renderer();
  await adapter.load({ ...source('2.1'), binary: true, legacyDecoderUrl: '/vendor/spine-decoder.js' });
  assert.equal(context.calls.workers[0].url, 'http://127.0.0.1:1234/vendor/spine-decoder.js');
  assert.equal(context.calls.workers[0].terminated, true);
  await adapter.unload();
}));

test('legacy binary decoder rejects foreign scripts and releases a failed realm', async () => withRealm(async context => {
  const adapter = renderer();
  await assert.rejects(adapter.load({ ...source('2.1'), binary: true, legacyDecoderUrl: 'https://example.com/model.js' }), /verified renderer asset server/);
  assert.equal(context.calls.workers.length, 0);
  assert.equal(context.calls.destroy, 1);
  assert.equal(context.window.__live2petSpine, undefined);
}));

test('2.1 binary decoding retains the private asset-server session token', async () => withRealm(async context => {
  context.window.location.href = 'http://127.0.0.1:1234/private-session/preview';
  const adapter = renderer();
  await adapter.load({ ...source('2.1'), binary: true, legacyDecoderUrl: '/private-session/vendor/spine-decoder.js' });
  assert.equal(context.calls.workers[0].url, 'http://127.0.0.1:1234/private-session/vendor/spine-decoder.js');
  await adapter.unload();
}));

test('legacy worker timeout terminates decoding and releases its renderer', async () => withRealm(async context => {
  context.window.setTimeout = (fn, ms) => setTimeout(fn, Math.min(ms, 20));
  context.Worker.prototype.postMessage = function () {};
  const adapter = renderer({ loadTimeoutMs: 1000 });
  await assert.rejects(adapter.load({ ...source('2.1'), binary: true, legacyDecoderUrl: '/vendor/spine-decoder.js' }), /timed out/);
  assert.equal(context.calls.workers[0].terminated, true);
  assert.equal(context.calls.destroy, 1);
  assert.equal(context.window.__live2petSpine, undefined);
}));

test('legacy worker cannot execute a model-supplied same-origin script', async () => withRealm(async context => {
  await assert.rejects(renderer().load({ ...source('2.1'), binary: true, legacyDecoderUrl: '/model/script.js' }), /verified renderer asset server/);
  assert.equal(context.calls.workers.length, 0);
}));

test('official 3.8 retains declared Mesh atlas dimensions and uses premultiplied GPU uploads', async () => withRealm(async context => {
  let image = { width: 1024, height: 512 }, uploads = 0, atlasImage, playerOptions, blend;
  const gl = { UNPACK_PREMULTIPLY_ALPHA_WEBGL: 1, ONE: 2, ONE_MINUS_SRC_ALPHA: 3,
    getParameter() { return false; }, pixelStorei(_key, value) { this.unpack = value; },
    blendFuncSeparate(...values) { blend = values; }, getExtension() { return null; } };
  const texture = { context: { gl }, getImage() { return image; }, update() { uploads++; assert.equal(gl.unpack, true); }, useMipMaps: false };
  class Atlas { constructor(_text, loader) { atlasImage = loader('page.png').getImage(); } }
  class Player {
    constructor(_container, options) {
      playerOptions = options;
      new context.window.spine.TextureAtlas('', () => texture);
      this.canvas = { style: {} }; this.context = { gl };
      this.assetManager = { dispose() {} }; this.sceneRenderer = { skeletonRenderer: {}, dispose() {} };
      this.skeleton = { data: { animations: [{ name: 'idle', duration: 1 }], findAnimation() { return { apply() {} }; } }, slots: [], setToSetupPose() {}, updateWorldTransform() {}, getBounds(offset, size) { offset.x = offset.y = 0; size.x = size.y = 1; } };
      this.animationState = { getCurrent() { return {}; } };
      options.success(this);
    }
    setAnimation() {} pause() {} stopRendering() {} drawFrame() {}
  }
  context.window.spine = { SpinePlayer: Player, TextureAtlas: Atlas, Vector2: class {}, webgl: { GLTexture: { DISABLE_UNPACK_PREMULTIPLIED_ALPHA_WEBGL: true } } };
  global.fetch = async () => ({ ok: true, async text() { return 'page.png\nsize: 2048, 1024\nformat: RGBA8888\nregion\n size: 16, 16\n'; } });
  const adapter = new SpinePlayerAdapter({ page: { evaluate(fn, ...args) { return fn(...args); } } });
  await adapter.load({ ...source('3.8', '3.8.84'), initialSkin: undefined, motions: [{ id: 'idle', duration: 1 }] });
  assert.equal(uploads, 1);
  assert.deepEqual(atlasImage, { width: 2048, height: 1024, pma: false });
  assert.equal(texture.getImage().width, 2048);
  assert.equal(context.window.spine.TextureAtlas, Atlas);
  assert.equal(context.window.spine.webgl.GLTexture.DISABLE_UNPACK_PREMULTIPLIED_ALPHA_WEBGL, true);
  assert.equal(playerOptions.premultipliedAlpha, true);
  gl.blendFunc(10, 11);
  assert.deepEqual(blend, [10, 11, gl.ONE, gl.ONE_MINUS_SRC_ALPHA]);
  await adapter.unload();
  assert.equal(texture.getImage(), image);
}));
