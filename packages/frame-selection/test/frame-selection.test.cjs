const assert = require('node:assert/strict');
const test = require('node:test');

const {
  FrameSelectionError,
  dedupeCandidates,
  selectMotionFrames,
} = require('../src/index.cjs');

function candidates() {
  return [
    { id: 'start', time: 0, visualChange: 0, bounds: { x: 0.2, y: 0.1, width: 0.5, height: 0.8 } },
    { id: 'near-start', time: 0.1, visualChange: 0.002, bounds: { x: 0.201, y: 0.1, width: 0.5, height: 0.8 } },
    { id: 'turn', time: 0.2, visualChange: 0.85, bounds: { x: 0.4, y: 0.1, width: 0.5, height: 0.8 } },
    { id: 'settle', time: 0.4, visualChange: 0.05, bounds: { x: 0.41, y: 0.1, width: 0.5, height: 0.8 } },
    { id: 'peak', time: 0.6, visualChange: 0.95, bounds: { x: 0.1, y: 0.05, width: 0.65, height: 0.9 } },
    { id: 'end', time: 1, visualChange: 0.1, bounds: { x: 0.2, y: 0.1, width: 0.5, height: 0.8 } },
  ];
}

test('removes near duplicates while preserving endpoints', () => {
  const result = dedupeCandidates(candidates());
  assert.deepEqual(result.map((frame) => frame.id), ['start', 'turn', 'settle', 'peak', 'end']);
});

test('selects ordered frames deterministically and preserves motion extrema', () => {
  const first = selectMotionFrames(candidates(), 4);
  const second = selectMotionFrames(candidates(), 4);
  assert.deepEqual(first.indices, second.indices);
  assert.equal(first.frames[0].id, 'start');
  assert.equal(first.frames.at(-1).id, 'end');
  assert.ok(first.frames.some((frame) => frame.id === 'turn' || frame.id === 'peak'));
  assert.deepEqual(first.frames.map((frame) => frame.time), [...first.frames].map((frame) => frame.time).sort((a, b) => a - b));
});

test('returns all available candidates when the requested count is larger', () => {
  const result = selectMotionFrames(candidates(), 20);
  assert.equal(result.frames.length, 5);
  assert.equal(result.deduplicatedCount, 5);
});

test('keeps a fixed target count when de-duplication would underflow', () => {
  const input = Array.from({ length: 8 }, (_, index) => ({
    id: `candidate-${index}`,
    time: index / 10,
    visualChange: index === 1 ? 0.001 : 0.2,
  }));
  const result = selectMotionFrames(input, 8);
  assert.equal(result.candidateCount, 8);
  assert.equal(result.frames.length, 8);
  assert.deepEqual(result.indices, Array.from({ length: 8 }, (_, index) => index));
});

test('rejects invalid candidate data and frame counts with typed errors', () => {
  assert.throws(
    () => selectMotionFrames([], 2),
    (error) => error instanceof FrameSelectionError && error.code === 'NO_FRAME_CANDIDATES',
  );
  assert.throws(
    () => selectMotionFrames([{ time: 0 }], 0),
    (error) => error instanceof FrameSelectionError && error.code === 'INVALID_FRAME_COUNT',
  );
  assert.throws(
    () => selectMotionFrames([{ time: -1 }], 1),
    (error) => error instanceof FrameSelectionError && error.code === 'INVALID_FRAME_CANDIDATE',
  );
});
