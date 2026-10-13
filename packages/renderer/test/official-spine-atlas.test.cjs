const assert = require('node:assert/strict');
const test = require('node:test');
const { SpinePlayerAdapter } = require('../src/spine-player-adapter.cjs');

async function withRealm({ line = '4.1', atlas = 'page.png\nsize: 32, 32\n\n', regions = ['body'], queries = [], failLoad = false, atlasCount = 1 } = {}, callback) {
  const previous = Object.fromEntries(['window', 'document', 'fetch'].map(key => [key, global[key]]));
  const calls = { uploads: 0, disposed: 0, options: null, atlas: null, textures: [] };
  const gl = {
    UNPACK_PREMULTIPLY_ALPHA_WEBGL: 1, ONE: 2, ONE_MINUS_SRC_ALPHA: 3,
    unpack: false, getParameter() { return this.unpack; }, pixelStorei(_key, value) { this.unpack = value; }, blendFuncSeparate() {}, getExtension() { return null; },
  };
  const textures = new Map();
  const texture = name => {
    if (!textures.has(name)) {
      const image = { width: 16, height: 16 };
      const value = { context: { gl }, getImage() { return image; }, update() { calls.uploads++; assert.equal(gl.unpack, true); }, useMipMaps: false };
      calls.textures.push({ value, getImage: value.getImage, update: value.update }); textures.set(name, value);
    }
    return textures.get(name);
  };
  class Atlas {
    constructor(_text, loader) {
      this.regions = regions.map(name => ({ name }));
      // Represent the runtime's page loader without changing its region semantics.
      for (const name of ['page.png', ...(atlas.includes('second.png') ? ['second.png'] : [])]) loader(name);
      calls.atlas = this;
    }
    findRegion(name) { return this.regions.find(region => region.name === name) || null; }
  }
  const originalFind = Atlas.prototype.findRegion;
  class Player {
    constructor(_container, options) {
      calls.options = options;
      this.context = { gl }; this.canvas = { style: {} };
      this.assetManager = { isLoadingComplete() { return false; }, dispose() { calls.disposed++; } };
      this.sceneRenderer = { skeletonRenderer: {}, dispose() {} };
      this.skeleton = { data: { findAnimation() { return { apply() {} }; }, animations: [{ name: 'idle', duration: 1 }] }, slots: [], setToSetupPose() {}, setupPose() {}, updateWorldTransform() {}, getBounds(offset, size) { offset.x = offset.y = 0; size.x = size.y = 1; } };
      this.animationState = { getCurrent() { return {}; }, getTrack() { return {}; } };
      queueMicrotask(() => {
        try {
          for (let index = 0; index < atlasCount; index++) {
            const instance = new global.window.spine.TextureAtlas(atlas, texture);
            for (const name of queries) if (!instance.findRegion(name)) throw new Error(`Region not found in atlas: ${name}`);
          }
          if (failLoad) throw new Error('Synthetic skeleton parse failed.');
          options.success(this);
        } catch (error) { options.error(this, error.message); }
      });
    }
    setAnimation() {} pause() {} stopRendering() {} drawFrame() {}
    dispose() { calls.disposed++; }
  }
  global.window = { spine: { SpinePlayer: Player, TextureAtlas: Atlas, Vector2: class {}, webgl: { GLTexture: { DISABLE_UNPACK_PREMULTIPLIED_ALPHA_WEBGL: true } } }, setTimeout, clearTimeout, setInterval, clearInterval, cancelAnimationFrame() {} };
  global.document = { body: { innerHTML: '' }, getElementById() { return { style: {} }; } };
  global.fetch = async () => ({ ok: true, async text() { return atlas; } });
  const adapter = new SpinePlayerAdapter({ page: { evaluate(fn, ...args) { return fn(...args); } } });
  const source = { format: 'spine', runtimeLine: line, spineVersion: `${line}.84`, skeletonUrl: '/model/hero.json', atlasUrl: '/model/hero.atlas', motions: [{ id: 'idle', duration: 1 }] };
  try { await callback({ adapter, source, calls, Atlas, originalFind }); }
  finally { if (adapter.source) await adapter.unload(); Object.assign(global, previous); }
}

for (const line of ['4.0', '4.1', '4.2', '4.3']) {
  test(`official ${line} explicitly uses straight blending for an unmarked atlas`, async () => withRealm({ line }, async ({ adapter, source, calls }) => {
    await adapter.load(source);
    assert.equal(calls.options.premultipliedAlpha, false, 'Player defaults to PMA unless the adapter explicitly selects straight alpha.');
  }));
  test(`official ${line} explicitly uses PMA blending for a marked atlas`, async () => withRealm({ line, atlas: 'page.png\nsize: 32, 32\npma: true\n\n' }, async ({ adapter, source, calls }) => {
    await adapter.load(source);
    assert.equal(calls.options.premultipliedAlpha, true);
    assert.equal(calls.uploads, 0, 'An already premultiplied image must not be premultiplied again.');
  }));
}

test('official 4.x rejects mixed-PMA pages with an actionable error instead of a single wrong blend mode', async () => withRealm({ atlas: 'page.png\nsize: 32, 32\npma: true\n\nsecond.png\nsize: 32, 32\npma: false\n\n' }, async ({ adapter, source, calls }) => {
  await assert.rejects(adapter.load(source), /mixed.*premultiplied.*re-export/i);
  assert.equal(calls.options, null, 'Reject before creating a Player or uploading textures.');
}));

test('official PMA detection is independent of page-size metadata and header order', async () => {
  for (const atlas of ['page.png\npma: true\n\n', 'page.png\npma: true\nsize: 32, 32\n\n']) await withRealm({ atlas }, async ({ adapter, source, calls }) => {
    await adapter.load(source);
    assert.equal(calls.options.premultipliedAlpha, true);
  });
});

test('official 3.8 exact region lookup wins over ambiguous trimmed candidates', async () => withRealm({ line: '3.8', regions: ['body', ' body', 'body '], queries: ['body'] }, async ({ adapter, source, calls }) => {
  await adapter.load(source);
  assert.equal(calls.atlas.findRegion('body').name, 'body');
  assert.deepEqual(adapter.getWarnings(), []);
}));

test('official 3.8 uniquely trimmed regions warn once per requested name', async () => withRealm({ line: '3.8', queries: ['body ', 'body ', ' body'], atlasCount: 2 }, async ({ adapter, source, calls }) => {
  const loaded = await adapter.load(source);
  assert.equal(calls.atlas.findRegion('body ').name, 'body');
  assert.equal(loaded.warnings.length, 2);
  assert.ok(loaded.warnings.every(warning => warning.code === 'SPINE_ATLAS_REGION_TRIMMED'));
  assert.deepEqual(loaded.warnings[0].details, { requested: 'body ', matched: 'body' });
  assert.equal(adapter.getWarnings().length, 2);
}));

for (const [label, regions, requested] of [['ambiguous', [' body', 'body '], 'body'], ['case mismatch', ['body'], 'Body'], ['missing', ['body'], 'arm']]) {
  test(`official 3.8 ${label} regions remain errors and restore scoped patches`, async () => withRealm({ line: '3.8', regions, queries: [requested] }, async ({ adapter, source, calls, Atlas, originalFind }) => {
    await assert.rejects(adapter.load(source), /atlas|region/i);
    assert.equal(global.window.spine.TextureAtlas, Atlas);
    assert.equal(calls.atlas.findRegion, originalFind);
    for (const entry of calls.textures) {
      assert.equal(entry.value.getImage, entry.getImage);
      assert.equal(entry.value.update, entry.update);
    }
    assert.equal(global.window.__live2petSpine, undefined);
  }));
}

test('official 3.8 normalizes only straight pages in a mixed atlas and restores hooks on unload', async () => withRealm({ line: '3.8', atlas: 'page.png\nsize: 32, 32\npma: true\n\nsecond.png\nsize: 32, 32\n\n' }, async ({ adapter, source, calls, originalFind }) => {
  await adapter.load(source);
  assert.equal(calls.options.premultipliedAlpha, true);
  assert.equal(calls.uploads, 1, 'Only the unmarked straight image should be GPU premultiplied.');
  assert.equal(calls.textures[1].value.getImage().width, 32);
  await adapter.unload();
  assert.equal(calls.atlas.findRegion, originalFind);
  for (const entry of calls.textures) {
    assert.equal(entry.value.getImage, entry.getImage);
    assert.equal(entry.value.update, entry.update);
  }
}));
