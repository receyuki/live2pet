const assert = require('node:assert/strict');
const test = require('node:test');

const {
  CAPTURE_CHUNK_MAX_BYTES,
  CLAWD_RENDER_PRESETS,
  createCaptureChunkPlan,
  createClawdCapturePlan,
  createFixedStepPlan,
  resolveClawdEncodingConcurrency,
} = require('../../mapper/clawd-capture-plan.js');
const { TARGET_RENDER_PRESETS } = require('../../../packages/package-build/src/index.cjs');

test('Clawd capture plans honor the advertised preset frame rates', () => {
  const cases = [
    ['compact', 6, 108, 18],
    ['balanced', 8, 192, 24],
    ['high', 8, 240, 30],
  ];

  for (const [preset, duration, frameCount, fps] of cases) {
    const plan = createClawdCapturePlan(preset, duration);
    assert.equal(plan.frameCount, frameCount);
    assert.equal(plan.settings.fps, fps);
    assert.equal(plan.delays.length, frameCount);
    assert.equal(plan.delays.reduce((total, delay) => total + delay, 0), duration * 1000);
    assert.ok(plan.delays.every((delay) => Number.isInteger(delay) && delay > 0));
  }
});

test('capture plans use deterministic fixed steps and bounded RGBA chunks', () => {
  const fixed = createFixedStepPlan(1.2, 6);
  assert.equal(fixed.durationMs, 1200);
  assert.deepEqual(fixed.times, [0, 0.24, 0.48, 0.72, 0.96, 1.2]);
  const chunks = createCaptureChunkPlan(768, 768, 29);
  assert.equal(chunks.length, 5);
  assert.equal(chunks[0].startFrame, 0);
  assert.equal(chunks[0].frameCount, 7);
  assert.equal(chunks.at(-1).startFrame + chunks.at(-1).frameCount, 29);
  assert.ok(chunks.every((chunk) => chunk.byteLength <= CAPTURE_CHUNK_MAX_BYTES));
  assert.throws(() => createCaptureChunkPlan(4096, 4096, 1), /single capture frame exceeds/i);
});

test('Clawd capture plans clamp invalid durations and keep preset metadata immutable', () => {
  assert.equal(createClawdCapturePlan('balanced', 0).durationSeconds, 1.2);
  assert.equal(createClawdCapturePlan('balanced', 99).durationSeconds, 8);
  assert.equal(createClawdCapturePlan('unknown', 2).preset, 'balanced');
  assert.equal(Object.isFrozen(CLAWD_RENDER_PRESETS), true);
  assert.equal(Object.isFrozen(CLAWD_RENDER_PRESETS.high), true);
});

test('Mapper capture presets stay aligned with Package Build and bound memory-heavy encoding', () => {
  assert.deepEqual(CLAWD_RENDER_PRESETS, TARGET_RENDER_PRESETS.clawd);
  assert.equal(resolveClawdEncodingConcurrency('compact'), 2);
  assert.equal(resolveClawdEncodingConcurrency('balanced'), 1);
  assert.equal(resolveClawdEncodingConcurrency('high'), 1);
  assert.equal(resolveClawdEncodingConcurrency('unknown'), 1);
});
