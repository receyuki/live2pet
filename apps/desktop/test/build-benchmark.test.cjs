const assert = require('node:assert/strict');
const test = require('node:test');
const { summarizeProgress } = require('../scripts/benchmark-project-build.cjs');

test('benchmark reports overlapping intervals separately and omits private Motion names', () => {
  const summary = summarizeProgress([
    { target: 'clawd', stage: 'encode', status: 'started', at: 100 },
    { target: 'clawd', stage: 'encode', status: 'motion-started', motionId: 'private-motion', at: 110 },
    { target: 'clawd', stage: 'encode', status: 'motion-completed', motionId: 'private-motion', cache: 'miss', at: 150 },
    { target: 'clawd', stage: 'encode', status: 'completed', at: 160 },
  ]);
  assert.deepEqual(summary.stageIntervals.map(interval => [interval.scope, interval.startMs, interval.endMs]), [
    ['motion', 10, 50], ['target', 0, 60],
  ]);
  assert.equal(summary.encodedAnimations, 1);
  assert.equal(JSON.stringify(summary).includes('private-motion'), false);
});
