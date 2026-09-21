const assert = require('node:assert/strict');
const test = require('node:test');
const { SyntheticRenderer, sampleMotionCandidates } = require('../src/index.cjs');

test('candidate sampling uses bounded consecutive capture batches with identical frames and progress', async () => {
  const renderer = new SyntheticRenderer();
  await renderer.load({ motions: [{ id: 'idle', duration: 1 }] });
  const options = { motionId: 'idle', duration: 1, samples: 9, width: 16, height: 16, includeEndpoint: false };
  const fallback = await sampleMotionCandidates(renderer, options);
  const batches = [];
  renderer.captureRgbaBatch = async ({ times, ...frame }) => {
    batches.push(times);
    return times.map(time => renderer.captureRgba({ ...frame, time }));
  };
  const progress = [];
  const batched = await sampleMotionCandidates(renderer, { ...options, onFrame: event => progress.push(event.completed) });
  assert.deepEqual(batches, [[0, 1 / 9, 2 / 9, 3 / 9], [4 / 9, 5 / 9, 6 / 9, 7 / 9], [8 / 9]]);
  assert.deepEqual(batched.candidates, fallback.candidates);
  assert.deepEqual(progress, [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.equal(batched.metrics.captureRequests, 3);
  assert.equal(batched.metrics.captureBatchCalls, 3);
});

test('sampling limits batches to one MiB and continues from short latency-limited batches', async () => {
  const renderer = new SyntheticRenderer();
  await renderer.load({ motions: [{ id: 'idle', duration: 1 }] });
  const batches = [];
  renderer.captureRgbaBatch = async ({ times, ...frame }) => {
    batches.push(times);
    return [renderer.captureRgba({ ...frame, time: times[0] })];
  };
  const result = await sampleMotionCandidates(renderer, { motionId: 'idle', duration: 1, samples: 3, width: 512, height: 256 });
  assert.deepEqual(batches, [[0, 0.5], [0.5, 1], [1]]);
  assert.deepEqual(result.candidates.map(frame => frame.time), [0, 0.5, 1]);
});

test('large frames use original single-frame capture without singleton batch overhead', async () => {
  const renderer = new SyntheticRenderer();
  await renderer.load({ motions: [{ id: 'idle', duration: 1 }] });
  renderer.captureRgbaBatch = () => assert.fail('large-frame capture must bypass batching');
  const captured = await sampleMotionCandidates(renderer, { motionId: 'idle', duration: 1, samples: 2, width: 1024, height: 1024 });
  assert.equal(captured.candidates.length, 2);
  assert.equal(captured.metrics.captureRequests, 2);
  assert.equal(captured.metrics.captureBatchCalls, 0);
});

test('batch opt-out and nonbinary capability use the existing single-frame fallback', async () => {
  const renderer = new SyntheticRenderer();
  await renderer.load({ motions: [{ id: 'idle', duration: 1 }] });
  renderer.captureRgbaBatch = () => assert.fail('batch capture must not be called');
  const options = { motionId: 'idle', duration: 1, samples: 3, width: 2, height: 2 };
  await sampleMotionCandidates(renderer, { ...options, captureBatch: false });
  renderer.supportsCaptureBatch = false;
  await sampleMotionCandidates(renderer, options);
});

test('batch cancellation and failure restore Expressions without reporting unconsumed frames', async () => {
  const renderer = new SyntheticRenderer();
  await renderer.load({ motions: [{ id: 'idle', duration: 1 }], expressions: [{ id: 'smile' }] });
  await renderer.setExpression('smile');
  const options = { motionId: 'idle', expressionId: null, duration: 1, samples: 5, width: 2, height: 2 };
  const controller = new AbortController();
  renderer.captureRgbaBatch = async ({ times, ...frame }) => {
    controller.abort();
    return times.map(time => renderer.captureRgba({ ...frame, time }));
  };
  await assert.rejects(sampleMotionCandidates(renderer, { ...options, signal: controller.signal, onFrame: () => assert.fail('cancelled batch must not report progress') }), { code: 'BUILD_CANCELLED' });
  assert.equal(renderer.getState().expressionId, 'smile');
  renderer.captureRgbaBatch = async () => { throw new Error('renderer failed'); };
  await assert.rejects(sampleMotionCandidates(renderer, options), /renderer failed/);
  assert.equal(renderer.getState().expressionId, 'smile');
  renderer.captureRgbaBatch = async () => [];
  await assert.rejects(sampleMotionCandidates(renderer, options), { code: 'INVALID_RENDER_CAPTURE' });
});

test('unscored animation sampling preserves pixels, bounds and timestamps for full-motion exports', async () => {
  const renderer = new SyntheticRenderer();
  await renderer.load({ motions: [{ id: 'idle', duration: 1 }] });
  const options = { motionId: 'idle', duration: 1, samples: 5, width: 16, height: 16 };
  const scored = await sampleMotionCandidates(renderer, options);
  assert.ok(scored.candidates.some(frame => frame.visualChange > 0));
  const unscored = await sampleMotionCandidates(renderer, { ...options, candidateScoring: false });
  assert.deepEqual(unscored.candidates, scored.candidates.map(({ visualChange, boundsDelta, ...frame }) => frame));
});
