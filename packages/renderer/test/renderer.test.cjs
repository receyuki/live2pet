const assert = require('node:assert/strict');
const test = require('node:test');

const {
  CONTRACT_METHODS,
  RendererContractError,
  SyntheticRenderer,
  assertRenderer,
  sampleMotionCandidates,
} = require('../src/index.cjs');

function source() {
  return {
    motions: [
      { id: 'Base:idle', name: 'Idle', duration: 2 },
      { id: 'Base:wave', name: 'Wave', duration: 1.25 },
    ],
    expressions: [{ id: 'smile', name: 'Smile' }],
  };
}

test('synthetic renderer implements the shared playback contract', async () => {
  const renderer = new SyntheticRenderer();
  assertRenderer(renderer);
  assert.equal(CONTRACT_METHODS.length, 13);

  const loaded = await renderer.load(source());
  assert.deepEqual(loaded, { contractVersion: 1, motionCount: 2, expressionCount: 1 });
  await renderer.playMotion('Base:wave', { loop: false, speed: 2 });
  renderer.setExpression('smile');
  let state = renderer.step(0.4);
  assert.equal(state.motionId, 'Base:wave');
  assert.equal(state.expressionId, 'smile');
  assert.equal(state.time, 0.8);
  state = renderer.step(0.5);
  assert.equal(state.time, 1.25);
  assert.equal(state.playing, false);
  renderer.setExpression(null);
  assert.equal(renderer.getState().expressionId, null);
});

test('looping and restart are deterministic', async () => {
  const renderer = new SyntheticRenderer();
  await renderer.load(source());
  await renderer.playMotion('Base:idle', { loop: true, speed: 1 });
  assert.equal(renderer.step(2.5).time, 0.5);
  assert.equal(renderer.restart().time, 0);
  renderer.pause();
  assert.equal(renderer.step(1).time, 0);
  assert.equal(renderer.resume().playing, true);
});

test('bounds cover the sampled motion and RGBA capture is transparent outside the synthetic figure', async () => {
  const renderer = new SyntheticRenderer();
  await renderer.load(source());
  const bounds = renderer.getBounds({ motionId: 'Base:wave', samples: 17 });
  assert.equal(bounds.normalized, true);
  assert.ok(bounds.x >= 0 && bounds.y >= 0);
  assert.ok(bounds.x + bounds.width <= 1 && bounds.y + bounds.height <= 1);

  const first = renderer.captureRgba({ width: 64, height: 48, motionId: 'Base:wave', time: 0.5 });
  const second = renderer.captureRgba({ width: 64, height: 48, motionId: 'Base:wave', time: 0.5 });
  assert.equal(first.rgba.length, 64 * 48 * 4);
  assert.deepEqual(first.rgba, second.rgba);
  assert.ok(first.rgba.some((value, index) => index % 4 === 3 && value > 0));
  assert.ok(first.rgba.some((value, index) => index % 4 === 3 && value === 0));
});

test('contract and source errors are typed', async () => {
  assert.throws(
    () => assertRenderer({}),
    (error) => error instanceof RendererContractError && error.code === 'INCOMPLETE_RENDERER',
  );
  const renderer = new SyntheticRenderer();
  await assert.rejects(
    () => renderer.load({ motions: [{ id: '' }] }),
    (error) => error instanceof RendererContractError && error.code === 'INVALID_RENDER_SOURCE',
  );
  await assert.rejects(
    () => renderer.load({ motions: [{ id: 'idle', duration: 2 }] }).then(() => renderer.playMotion('missing')),
    (error) => error instanceof RendererContractError && error.code === 'MOTION_NOT_FOUND',
  );
});

test('samples deterministic RGBA motion candidates for downstream selection', async () => {
  const renderer = new SyntheticRenderer();
  await renderer.load({ motions: [{ id: 'sample', duration: 1 }] });
  const first = await sampleMotionCandidates(renderer, { motionId: 'sample', duration: 1, samples: 5, width: 32, height: 32 });
  const second = await sampleMotionCandidates(renderer, { motionId: 'sample', duration: 1, samples: 5, width: 32, height: 32 });
  assert.deepEqual(first.candidates.map((candidate) => ({ id: candidate.id, time: candidate.time, bounds: candidate.bounds, visualChange: candidate.visualChange, boundsDelta: candidate.boundsDelta })), second.candidates.map((candidate) => ({ id: candidate.id, time: candidate.time, bounds: candidate.bounds, visualChange: candidate.visualChange, boundsDelta: candidate.boundsDelta })));
  assert.deepEqual(first.candidates.map((candidate) => candidate.time), [0, 0.25, 0.5, 0.75, 1]);
  assert.equal(first.candidates[0].visualChange, 0);
  assert.equal(first.candidates[0].boundsDelta, 0);
  assert.equal(first.candidates[0].rgba.length, 32 * 32 * 4);
  assert.ok(first.candidates.some((candidate) => candidate.visualChange > 0));
  assert.ok(first.candidates.every((candidate) => candidate.bounds && candidate.bounds.width > 0 && candidate.bounds.height > 0));
});

test('rejects invalid motion sampling inputs', async () => {
  const renderer = new SyntheticRenderer();
  await renderer.load({ motions: [{ id: 'sample', duration: 1 }] });
  await assert.rejects(
    () => sampleMotionCandidates(renderer, { motionId: 'sample', duration: 1, samples: 0 }),
    (error) => error instanceof RendererContractError && error.code === 'INVALID_RENDER_SIZE',
  );
  await assert.rejects(
    () => sampleMotionCandidates(renderer, { motionId: 'missing', duration: 1, samples: 1 }),
    (error) => error instanceof RendererContractError && error.code === 'MOTION_NOT_FOUND',
  );
});
