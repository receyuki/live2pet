const assert = require('node:assert/strict');
const test = require('node:test');

const { BUILD_PROGRESS_WEIGHTS, progressPercent } = require('../../mapper/build-progress.js');

test('weights long-running capture and encode work instead of dividing stages equally', () => {
  assert.equal(Object.values(BUILD_PROGRESS_WEIGHTS.clawd).reduce((sum, value) => sum + value, 0), 100);
  assert.equal(Object.values(BUILD_PROGRESS_WEIGHTS.codex).reduce((sum, value) => sum + value, 0), 100);
  assert.equal(progressPercent('clawd', 'capture', 0), 0);
  assert.equal(progressPercent('clawd', 'capture', 0.5), 25);
  assert.equal(progressPercent('clawd', 'capture', 1), 50);
  assert.equal(progressPercent('clawd', 'encode', 0.5), 70);
  assert.equal(progressPercent('clawd', 'transfer', 1), 100);
});

test('progress remains monotonic at every Clawd stage boundary', () => {
  const stages = ['capture', 'validate', 'encode', 'manifest', 'preview', 'package', 'report', 'transfer'];
  const samples = stages.flatMap((stage) => [0, 0.25, 0.5, 0.75, 1].map((fraction) => progressPercent('clawd', stage, fraction)));
  assert.deepEqual(samples, [...samples].sort((left, right) => left - right));
});
