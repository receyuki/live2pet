const assert = require('node:assert/strict');
const test = require('node:test');

const {
  ClawdValidationError,
  assertValidClawdMapping,
  createClawdTarget,
  validateClawdMapping,
} = require('../src/index.cjs');

function directMapping() {
  return {
    sleepMode: 'direct',
    states: {
      idle: 'motion:idle',
      thinking: 'motion:thinking',
      working: 'motion:working',
      sleeping: 'fallback:idle',
      attention: 'motion:attention',
    },
    reactions: { drag: 'motion:drag' },
  };
}

test('validates direct sleep, required states, fallback, and reactions', () => {
  const result = validateClawdMapping(directMapping());
  assert.equal(result.ok, true);
  assert.equal(result.sleepMode, 'direct');
  assert.equal(result.errors.length, 0);
  assert.ok(result.warnings.some((warning) => warning.code === 'OPTIONAL_STATE_UNMAPPED'));
  assert.deepEqual(createClawdTarget(directMapping()).sleepSequence, { mode: 'direct' });
});

test('requires all four transition Motions in full sleep mode', () => {
  const result = validateClawdMapping({
    ...directMapping(),
    sleepMode: 'full',
    states: { ...directMapping().states, yawning: 'motion:yawning', dozing: 'motion:dozing' },
  });
  assert.equal(result.ok, false);
  assert.deepEqual(result.errors.filter((error) => error.code === 'FULL_SLEEP_STATE_UNMAPPED').map((error) => error.slot), ['collapsing', 'waking']);
});

test('rejects fallback cycles, invalid fallback slots, and reaction fallbacks', () => {
  const result = validateClawdMapping({
    ...directMapping(),
    states: { ...directMapping().states, idle: 'fallback:thinking', thinking: 'fallback:idle', juggling: 'fallback:idle' },
    reactions: { drag: 'fallback:idle' },
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.code === 'FALLBACK_CYCLE'));
  assert.ok(result.errors.some((error) => error.code === 'FALLBACK_NOT_ALLOWED'));
  assert.ok(result.errors.some((error) => error.code === 'REACTION_FALLBACK_NOT_ALLOWED'));
});

test('assertion exposes typed errors and a target-compatible shape', () => {
  assert.throws(
    () => assertValidClawdMapping({ states: { idle: 'motion:idle' } }),
    (error) => error instanceof ClawdValidationError && error.code === 'INVALID_CLAWD_MAPPING' && Array.isArray(error.details.errors),
  );
  const target = createClawdTarget(directMapping());
  assert.equal(target.profile, 'clawd');
  assert.equal(target.contractVersion, 1);
  assert.equal(target.states.idle, 'motion:idle');
  assert.equal(target.reactions.drag, 'motion:drag');
});
