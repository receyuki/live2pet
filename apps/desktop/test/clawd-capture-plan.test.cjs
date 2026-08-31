const assert = require('node:assert/strict');
const test = require('node:test');

const {
  CLAWD_RENDER_PRESETS,
  createClawdCapturePlan,
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
