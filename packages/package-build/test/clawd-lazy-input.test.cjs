const assert = require('node:assert/strict');
const test = require('node:test');
const { buildClawdTheme } = require('../src/index.cjs');

const mapping = {
  sleepMode: 'direct',
  states: { idle: 'motion:idle', thinking: 'motion:thinking', working: 'motion:idle', sleeping: 'fallback:idle', error: 'motion:thinking', attention: 'motion:idle' },
  reactions: { drag: 'motion:thinking' },
};
function frames(motionId) {
  return { fps: 10, frames: [0, 1].map(index => ({ width: 2, height: 2, rgba: Buffer.from(Array.from({ length: 16 }, (_, byte) => byte % 4 === 3 ? 255 : (motionId.length * 20 + index * 50 + byte) % 255)) })) };
}

test('lazy Motion capture produces the same encoded assets and stable order as eager capture', async () => {
  const eagerAssets = {};
  const lazyAssets = {};
  const eager = await buildClawdTheme({ mapping, framesByMotion: { idle: frames('idle'), thinking: frames('thinking') } }, {
    onEncodedAsset: (id, asset) => { eagerAssets[id] = asset; },
  });
  const active = new Set();
  const lazy = await buildClawdTheme({ mapping, async withFrameSet(id, consume) {
    active.add(id);
    try { return await consume(frames(id)); } finally { active.delete(id); }
  } }, { async onEncodedAsset(id, asset) {
    await new Promise(resolve => setImmediate(resolve));
    assert.ok(active.has(id), 'capture reservation remains held through asynchronous encoded asset storage');
    lazyAssets[id] = asset;
  } });
  assert.deepEqual(lazyAssets, eagerAssets);
  assert.deepEqual(lazy.assets, eager.assets);
  assert.deepEqual(lazy.manifest, eager.manifest);
  assert.equal(active.size, 0);
});

test('verified encoded assets bypass lazy capture and count as cache hits', async () => {
  const encodedByMotion = {};
  await buildClawdTheme({ mapping, framesByMotion: { idle: frames('idle'), thinking: frames('thinking') } }, {
    onEncodedAsset: (id, asset) => { encodedByMotion[id] = asset; },
  });
  const result = await buildClawdTheme({ mapping, encodedByMotion, withFrameSet() {
    assert.fail('verified encoded assets must not request raw frames');
  } });
  assert.deepEqual(result.cache, { enabled: true, hits: 2, misses: 0 });
  assert.equal(result.validation.ok, true);
});

test('lazy capture releases reservations after normalization failure and cancellation', async () => {
  for (const cancel of [false, true]) {
    const controller = new AbortController();
    let active = 0;
    let released = 0;
    await assert.rejects(buildClawdTheme({ mapping, async withFrameSet(id, consume) {
      active += 1;
      try {
        if (cancel) controller.abort();
        return await consume(cancel ? frames(id) : { frames: [] });
      } finally {
        active -= 1;
        released += 1;
      }
    } }, { encodingConcurrency: 1, signal: controller.signal }), error => error.code === (cancel ? 'BUILD_CANCELLED' : 'INVALID_CLAWD_FRAME_SET'));
    assert.equal(active, 0);
    assert.equal(released, 1);
  }
});

test('lazy capture waits for active workers to release when encoded asset storage fails', async () => {
  let active = 0;
  await assert.rejects(buildClawdTheme({ mapping, async withFrameSet(id, consume) {
    active += 1;
    try { return await consume(frames(id)); } finally { active -= 1; }
  } }, { async onEncodedAsset() {
    await new Promise(resolve => setImmediate(resolve));
    throw new Error('storage failed');
  } }), /storage failed/);
  assert.equal(active, 0);
});
