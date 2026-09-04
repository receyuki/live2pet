const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { CacheStore } = require('../../../packages/package-build/src/cache.cjs');
const { digestVisualSettings } = require('../../../packages/project/src/index.cjs');
const { createCaptureCacheService } = require('../capture-cache-service.cjs');

function recipe(overrides = {}) {
  return { motionId: 'idle', duration: 1.2, width: 2, height: 2, frameCount: 2, fps: 24, ...overrides };
}

function frames() {
  return {
    frames: [0, 1].map((index) => ({ id: `idle-${index}`, index, time: index, width: 2, height: 2, rgba: Uint8Array.from([index, 0, 0, 255, index, 1, 0, 255, index, 2, 0, 255, index, 3, 0, 255]) })),
    delay: [500, 700],
    loop: 0,
    quality: 82,
    alphaQuality: 100,
    lossless: false,
  };
}

function setup() {
  const cache = new CacheStore({ rootDir: fs.mkdtempSync(path.join(os.tmpdir(), 'live2pet-capture-cache-')), maxBytes: 1024 * 1024 });
  const service = createCaptureCacheService({
    cache,
    getRuntimeForGeneration: async () => ({ descriptor: { fingerprint: 'a'.repeat(64) } }),
  });
  return { cache, service };
}

test('oversized capture entries are optional and do not prevent later writes', async () => {
  const { cache, service } = setup();
  const context = { sourceFingerprint: 'b'.repeat(64), cubismVersion: 3, target: 'clawd', renderPreset: 'balanced' };
  cache.maxBytes = 1;
  const skipped = await service.write(context, recipe(), { motionId: 'idle', ...frames() });
  assert.equal(skipped.stored, false);
  assert.equal(skipped.reason, 'entry-too-large');
  assert.equal(await service.read(context, recipe()), null);
  cache.maxBytes = 1024 * 1024;
  assert.equal((await service.write(context, recipe(), { motionId: 'idle', ...frames() })).stored, true);
});

test('capture cache reports misses, stores validated frames, and returns hits', async () => {
  const { service } = setup();
  const context = { sourceFingerprint: 'b'.repeat(64), cubismVersion: 3, target: 'clawd', renderPreset: 'balanced' };
  const request = { ...context, motions: [recipe()] };
  const before = await service.status(request);
  assert.equal(before.entries[0].hit, false);
  const stored = await service.write(context, recipe(), { motionId: 'idle', ...frames() });
  assert.equal(stored.stored, true);
  const after = await service.status(request);
  assert.equal(after.entries[0].hit, true);
  assert.equal(after.entries[0].key, stored.key);
  const loaded = await service.read(context, recipe());
  assert.equal(loaded.key, stored.key);
  assert.deepEqual(Array.from(loaded.frameSet.frames[1].rgba), Array.from(frames().frames[1].rgba));
  const encoded = await service.readEncodedMany(context, [recipe()]);
  assert.equal(encoded.idle.key, stored.key);
  assert.equal(encoded.idle.frameSet.frames[0].rgba, undefined);
  assert.equal(encoded.idle.frameSet.rgbaChunks.length, 1);
  assert.ok(encoded.idle.frameSet.rgbaChunks[0].rgbaDeflate.byteLength > 0);
});

test('capture cache exposes aggregate storage and clears all entries without leaking metadata', async () => {
  const { cache, service } = setup();
  const context = { sourceFingerprint: '1'.repeat(64), cubismVersion: 4, target: 'clawd', renderPreset: 'balanced' };
  const recipes = [recipe({ motionId: 'idle' }), recipe({ motionId: 'working' })];
  await service.writeMany(context, recipes.map((item) => ({ recipe: item, frameSet: { motionId: item.motionId, ...frames() } })));

  const expected = cache.status();
  assert.deepEqual(await service.overview(), {
    schemaVersion: 1,
    maxBytes: 1024 * 1024,
    byteLength: expected.byteLength,
    entryCount: 2,
  });
  assert.equal(JSON.stringify(await service.overview()).includes('entries'), false);

  assert.deepEqual(await service.clearAll(), {
    removedEntries: 2,
    removedBytes: expected.byteLength,
    schemaVersion: 1,
    maxBytes: 1024 * 1024,
    byteLength: 0,
    entryCount: 0,
  });
  assert.equal(cache.status().entryCount, 0);
});

test('capture does not reuse frames recorded before physics settling', async () => {
  const { cache, service } = setup();
  const old = createCaptureCacheService({ cache, rendererVersion: 'pixi-live2d-capture-v5', getRuntimeForGeneration: async () => ({ descriptor: { fingerprint: 'a'.repeat(64) } }) });
  for (const hiddenElementIds of [[], ['BG']]) {
    const context = { sourceFingerprint: 'b'.repeat(64), cubismVersion: 4, target: 'clawd', renderPreset: 'balanced', visualSettings: { hiddenElementIds } };
    await old.write(context, recipe(), { motionId: 'idle', ...frames() });
    assert.equal((await old.status({ ...context, motions: [recipe()] })).entries[0].hit, true);
    assert.equal((await service.status({ ...context, motions: [recipe()] })).entries[0].hit, false);
  }
});

test('capture cache identities isolate source, target, preset, and motion recipes', async () => {
  const { service } = setup();
  const base = { sourceFingerprint: 'c'.repeat(64), cubismVersion: 4, target: 'clawd', renderPreset: 'balanced' };
  const first = await service.write(base, recipe(), { motionId: 'idle', ...frames() });
  const differentSource = await service.status({ ...base, sourceFingerprint: 'd'.repeat(64), motions: [recipe()] });
  const differentPreset = await service.status({ ...base, renderPreset: 'high', motions: [recipe()] });
  const differentMotion = await service.status({ ...base, motions: [recipe({ motionId: 'working' })] });
  assert.equal(first.stored, true);
  assert.equal(differentSource.entries[0].hit, false);
  assert.equal(differentPreset.entries[0].hit, false);
  assert.equal(differentMotion.entries[0].hit, false);
});

test('capture cache identities isolate Animation Recipe Expressions', async () => {
  const { service } = setup();
  const base = { sourceFingerprint: 'a'.repeat(64), cubismVersion: 4, target: 'clawd', renderPreset: 'balanced' };
  const smile = recipe({ expressionId: 'smile' });
  const baseRecipe = recipe({ expressionId: null });
  await service.write(base, smile, { motionId: 'idle', expressionId: 'smile', ...frames() });
  const smileHit = await service.status({ ...base, motions: [smile] });
  const baseMiss = await service.status({ ...base, motions: [baseRecipe] });
  assert.equal(smileHit.entries[0].hit, true);
  assert.equal(baseMiss.entries[0].hit, false);
});

test('capture cache identities include canonical Visual Settings and preserve the empty-set key', async () => {
  const { service } = setup();
  const base = { sourceFingerprint: 'a'.repeat(64), cubismVersion: 4, target: 'clawd', renderPreset: 'balanced' };
  const hidden = { hiddenElementIds: ['Background', 'Background'] };
  const hiddenRecipe = recipe();
  await service.write({ ...base, visualSettings: hidden }, hiddenRecipe, { motionId: 'idle', ...frames() });

  const sameSettings = await service.status({ ...base, visualSettings: { hiddenElementIds: ['Background'] }, motions: [hiddenRecipe] });
  const emptySettings = await service.status({ ...base, visualSettings: { hiddenElementIds: [] }, motions: [hiddenRecipe] });
  const contextOnlyDigest = await service.status({ ...base, visualSettingsDigest: digestVisualSettings(hidden), motions: [hiddenRecipe] });

  assert.equal(sameSettings.entries[0].hit, true);
  assert.equal(emptySettings.entries[0].hit, false);
  assert.equal(contextOnlyDigest.entries[0].hit, true);
});

test('capture cache batches runtime resolution for a multi-motion build', async () => {
  const cache = new CacheStore({ rootDir: fs.mkdtempSync(path.join(os.tmpdir(), 'live2pet-capture-cache-batch-')), maxBytes: 1024 * 1024 });
  let runtimeLoads = 0;
  const service = createCaptureCacheService({
    cache,
    getRuntimeForGeneration: async () => {
      runtimeLoads += 1;
      return { descriptor: { fingerprint: 'e'.repeat(64) } };
    },
  });
  const context = { sourceFingerprint: 'f'.repeat(64), cubismVersion: 4, target: 'clawd', renderPreset: 'compact' };
  const recipes = [recipe({ motionId: 'idle' }), recipe({ motionId: 'working' })];
  const stored = await service.writeMany(context, recipes.map((item) => ({ recipe: item, frameSet: { motionId: item.motionId, ...frames() } })));
  assert.equal(stored.length, 2);
  const loaded = await service.readMany(context, recipes);
  assert.equal(loaded.idle.key !== undefined, true);
  assert.equal(loaded.working.key !== undefined, true);
  assert.equal(runtimeLoads, 2);
});

test('capture cache fails open when the saved runtime cannot be read', async () => {
  const cache = new CacheStore({ rootDir: fs.mkdtempSync(path.join(os.tmpdir(), 'live2pet-capture-cache-runtime-error-')), maxBytes: 1024 * 1024 });
  const service = createCaptureCacheService({
    cache,
    getRuntimeForGeneration: async () => { throw new Error('stale runtime settings'); },
  });
  const result = await service.status({ sourceFingerprint: 'a'.repeat(64), cubismVersion: 4, target: 'clawd', renderPreset: 'balanced', motions: [recipe()] });
  assert.equal(result.runtimeAvailable, false);
  assert.equal(result.entries[0].hit, false);
  assert.equal(await service.write({ sourceFingerprint: 'a'.repeat(64), cubismVersion: 4, target: 'clawd', renderPreset: 'balanced' }, recipe(), { motionId: 'idle', ...frames() }).then((value) => value.reason), 'runtime-unavailable');
});
