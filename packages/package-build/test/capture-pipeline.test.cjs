const assert = require('node:assert/strict');
const test = require('node:test');
const { buildProjectTargets } = require('../src/index.cjs');
const { SyntheticRenderer } = require('../../renderer/src/index.cjs');
const { createProject } = require('../../project/src/index.cjs');

const motions = ['idle', 'think', 'work', 'sleep'];
function project() {
  return createProject({ projectId: 'pipeline', name: 'Pipeline', source: { kind: 'standard-directory', name: 'fixture', fingerprint: 'a'.repeat(64) }, targets: {
    clawd: { mappings: Object.fromEntries(['idle', 'thinking', 'working', 'sleeping'].map((state, i) => [state, `motion:${motions[i]}`])) },
  } });
}

test('Clawd encodes before all Motions are captured and bounds resident raw Motion sets', async () => {
  const renderer = new SyntheticRenderer();
  await renderer.load({ motions: motions.map(id => ({ id, duration: 0.1 })) });
  const captured = new Set();
  let encoded = 0;
  const built = await buildProjectTargets({ project: project(), targets: ['clawd'],
    inputsByTarget: { clawd: { renderer, render: { preset: 'compact', width: 128, height: 128, samples: 2 } } },
    onProgress: event => { if (event.stage === 'render' && event.status === 'started') captured.add(event.motionId); },
    optionsByTarget: { clawd: { package: true, onEncodedAsset: async () => {
      if (encoded++ === 0) assert.ok(captured.size < 4, 'the first encode must not wait for the whole source to be captured');
    } } },
  });
  assert.equal(encoded, 4);
  assert.equal(built.builds.clawd.validation.ok, true);
  assert.ok(built.builds.clawd.timings.pipeline.peakResidentMotions <= 2);
  assert.equal(built.builds.clawd.timings.pipeline.reservedBytes, 0);
});

test('oversized Motions run alone without changing encoded pixels or animation timing', async () => {
  const renderer = new SyntheticRenderer();
  await renderer.load({ motions: motions.map(id => ({ id, duration: 0.1 })) });
  const input = { project: project(), targets: ['clawd'], inputsByTarget: { clawd: { renderer, render: { preset: 'compact', width: 128, height: 128, samples: 2 } } } };
  const normalPixels = {};
  const boundedPixels = {};
  const normal = await buildProjectTargets({ ...input, optionsByTarget: { clawd: { onEncodedAsset: (id, asset) => { normalPixels[id] = asset.buffer; } } } });
  const bounded = await buildProjectTargets({ ...input, optionsByTarget: { clawd: {
    captureBudgetBytes: 1, onEncodedAsset: (id, asset) => { boundedPixels[id] = asset.buffer; },
  } } });
  assert.deepEqual(boundedPixels, normalPixels);
  assert.deepEqual(bounded.builds.clawd.assets, normal.builds.clawd.assets);
  assert.equal(bounded.builds.clawd.timings.pipeline.peakResidentMotions, 1);
  assert.equal(bounded.builds.clawd.timings.pipeline.oversizedMotions, 4);
  assert.equal(bounded.builds.clawd.report.timings.pipeline.reservedBytes, 0);
});

test('cancellation and encode storage failure drain capture and allow an immediate retry', { timeout: 10000 }, async () => {
  const renderer = new SyntheticRenderer();
  await renderer.load({ motions: motions.map(id => ({ id, duration: 0.1 })) });
  for (const cancel of [true, false]) {
    const controller = new AbortController();
    let active = false;
    let encoded = 0;
    const withCaptureRenderer = async operation => {
      active = true;
      try { return await operation(renderer); } finally { active = false; }
    };
    const input = { project: project(), targets: ['clawd'], inputsByTarget: { clawd: { withCaptureRenderer, render: { preset: 'compact', width: 128, height: 128, samples: 2 } } } };
    await assert.rejects(buildProjectTargets({ ...input, signal: controller.signal, optionsByTarget: { clawd: {
      captureBudgetBytes: 1, onEncodedAsset: async () => {
        encoded++;
        if (cancel) controller.abort();
        else throw new Error('encoded storage failed');
      },
    } } }), error => cancel ? error.code === 'BUILD_CANCELLED' : /encoded storage failed/.test(error.message));
    assert.equal(active, false);
    assert.equal(encoded, 1);
    const retried = await buildProjectTargets(input);
    assert.equal(retried.builds.clawd.validation.ok, true);
    assert.equal(retried.builds.clawd.timings.pipeline.reservedBytes, 0);
  }
});

test('renderer acquisition and capture failures reject without publishing a package or leaking the shared budget', { timeout: 10000 }, async () => {
  const renderer = new SyntheticRenderer();
  await renderer.load({ motions: motions.map(id => ({ id, duration: 0.1 })) });
  const render = { preset: 'compact', width: 128, height: 128, samples: 2 };
  await assert.rejects(buildProjectTargets({ project: project(), targets: ['clawd'], inputsByTarget: { clawd: {
    render, withCaptureRenderer: async () => { throw new Error('runtime acquisition failed'); },
  } } }), /runtime acquisition failed/);
  await assert.rejects(buildProjectTargets({ project: project(), targets: ['clawd'], inputsByTarget: { clawd: {
    renderer, render: { ...render, durations: { work: -1 } },
  } } }), error => error.code === 'INVALID_MOTION_DURATION');
  const retried = await buildProjectTargets({ project: project(), targets: ['clawd'], inputsByTarget: { clawd: { renderer, render } } });
  assert.equal(retried.builds.clawd.validation.ok, true);
  assert.equal(retried.builds.clawd.timings.pipeline.reservedBytes, 0);
});

test('invalid capture budgets have a stable public error code', async () => {
  const renderer = new SyntheticRenderer();
  await renderer.load({ motions: motions.map(id => ({ id, duration: 0.1 })) });
  await assert.rejects(buildProjectTargets({ project: project(), targets: ['clawd'],
    inputsByTarget: { clawd: { renderer } }, optionsByTarget: { clawd: { captureBudgetBytes: 0 } },
  }), error => error.code === 'INVALID_CAPTURE_BUDGET');
});

test('concurrent builds share a two-Motion admission ceiling', { timeout: 10000 }, async () => {
  let active = 0;
  let peak = 0;
  const builds = await Promise.all([0, 1, 2].map(async () => {
    const renderer = new SyntheticRenderer();
    await renderer.load({ motions: motions.map(id => ({ id, duration: 0.1 })) });
    return buildProjectTargets({ project: project(), targets: ['clawd'],
      inputsByTarget: { clawd: { renderer, render: { preset: 'compact', width: 128, height: 128, samples: 2 } } },
      onProgress: event => {
        if (event.stage === 'render' && event.status === 'started') peak = Math.max(peak, ++active);
      },
      optionsByTarget: { clawd: { onEncodedAsset: async () => {
        await new Promise(resolve => setImmediate(resolve));
        active--;
      } } },
    });
  }));
  assert.equal(peak, 2);
  assert.equal(active, 0);
  for (const build of builds) {
    assert.equal(build.builds.clawd.validation.ok, true);
    assert.equal(build.builds.clawd.timings.pipeline.reservedBytes, 0);
  }
});
