const assert = require('node:assert/strict');
const test = require('node:test');

const { HostedBuildError, createHostedBuildService } = require('../hosted-build-service.cjs');

const FINGERPRINT = 'a'.repeat(64);
const project = () => ({ projectId: 'project-1', source: { fingerprint: FINGERPRINT } });

test('another capture proceeds while a completed capture is being encoded', async () => {
  const { SyntheticRenderer } = require('../../../packages/renderer/src/index.cjs');
  const { createProject } = require('../../../packages/project/src/index.cjs');
  const { buildProjectTargets } = require('../../../packages/package-build/src/index.cjs');
  let active = 0, peak = 0, opens = 0;
  let releaseEncode, encodingStarted;
  const encodingGate = new Promise(resolve => { releaseEncode = resolve; });
  const started = new Promise(resolve => { encodingStarted = resolve; });
  const service = createHostedBuildService({
    previewSession: { withRenderer: async (_identity, operation) => {
      active++; opens++; peak = Math.max(peak, active);
      const renderer = new SyntheticRenderer();
      await renderer.load({ motions: [{ id: 'idle', duration: 0.1 }] });
      try { return await operation(renderer); } finally { active--; }
    } },
    buildProject: buildProjectTargets,
  });
  const source = createProject({ projectId: 'lease', name: 'Lease', source: { kind: 'standard-directory', name: 'fixture', fingerprint: FINGERPRINT }, targets: {
    clawd: { mappings: { idle: 'motion:idle', thinking: 'motion:idle', working: 'motion:idle', sleeping: 'motion:idle' } },
  } });
  const input = { project: source, targets: ['clawd'], inputsByTarget: { clawd: { render: { preset: 'compact', width: 128, height: 128, samples: 2 } } }, optionsByTarget: { clawd: { package: true } } };
  const first = service({ ...input, optionsByTarget: { clawd: { package: true, onEncodedAsset: async () => { encodingStarted(); await encodingGate; } } } });
  try {
    await started;
    assert.equal(active, 0, 'encoding must not retain the capture lease');
    const second = await service(input);
    assert.equal(second.builds.clawd.validation.ok, true);
    assert.equal(opens, 2);
    assert.equal(peak, 1);
  } finally { releaseEncode(); await first; }
});

test('supplies capture-scoped renderer access to targets that lack captured inputs', async () => {
  const renderer = { captureRgba() {} };
  let received;
  const service = createHostedBuildService({
    previewSession: {
      withRenderer: async (identity, operation) => {
        assert.deepEqual(identity, { projectId: 'project-1', sourceFingerprint: FINGERPRINT, bounds: { x: 0, y: 0, width: 768, height: 768 }, fresh: true });
        return operation(renderer);
      },
    },
    buildProject: async (input) => {
      received = input;
      for (const target of input.targets) await input.inputsByTarget[target].withCaptureRenderer(value => assert.equal(value, renderer));
      return { ok: true };
    },
  });
  assert.deepEqual(await service({ project: project(), targets: ['clawd', 'codex-pet'], inputsByTarget: { clawd: { renderPreset: 'high' } } }), { ok: true });
  assert.equal(received.inputsByTarget.clawd.renderer, undefined);
  assert.equal(received.inputsByTarget['codex-pet'].renderer, undefined);
  assert.equal(received.inputsByTarget.clawd.renderPreset, 'high');
});

test('does not open a hosted renderer or overwrite existing captured inputs', async () => {
  let rendererRequests = 0;
  const captured = { framesByMotion: { idle: {} } };
  const codexCaptured = { candidatesByRow: { idle: [] } };
  const input = { project: project(), targets: ['clawd', 'codex-pet'], inputsByTarget: { clawd: captured, 'codex-pet': codexCaptured } };
  const service = createHostedBuildService({
    previewSession: { withRenderer: async () => { rendererRequests += 1; } },
    buildProject: async (received) => { assert.equal(received, input); return 'legacy'; },
  });
  assert.equal(await service(input), 'legacy');
  assert.equal(rendererRequests, 0);
});

test('preserves captured input for one target while injecting another', async () => {
  const renderer = { captureRgba() {} };
  const captured = { framesByMotion: { idle: {} } };
  const service = createHostedBuildService({
    previewSession: { withRenderer: async (_identity, operation) => operation(renderer) },
    buildProject: async (input) => input,
  });
  const result = await service({ project: project(), targets: ['clawd', 'codex-pet'], inputsByTarget: { clawd: captured } });
  assert.equal(result.inputsByTarget.clawd, captured);
  await result.inputsByTarget['codex-pet'].withCaptureRenderer(value => assert.equal(value, renderer));
});

test('reports missing source/runtime errors without paths and keeps the capture queue usable', async () => {
  let attempt = 0;
  const service = createHostedBuildService({
    previewSession: {
      withRenderer: async (_identity, operation) => {
        attempt += 1;
        if (attempt === 1) throw Object.assign(new Error('Missing runtime at /Users/RY/runtime/core.js'), { code: 'PREVIEW_RUNTIME_UNAVAILABLE' });
        return operation({ captureRgba() {} });
      },
    },
    buildProject: async input => input.inputsByTarget.clawd.withCaptureRenderer(() => 'recovered'),
  });
  await assert.rejects(service({ project: project(), targets: ['clawd'] }), (error) => error instanceof HostedBuildError && error.code === 'PREVIEW_RUNTIME_UNAVAILABLE' && error.message.includes('<redacted-path>') && !error.message.includes('/Users/RY'));
  assert.equal(await service({ project: project(), targets: ['clawd'] }), 'recovered');
  await assert.rejects(service({ project: { projectId: 'project-1', source: {} }, targets: ['clawd'] }), (error) => error.code === 'HOSTED_BUILD_SOURCE_REQUIRED');
});

test('serializes hosted renderer capture builds', async () => {
  const order = [];
  let releaseFirst;
  const service = createHostedBuildService({
    previewSession: {
      withRenderer: async (_identity, operation) => operation({ captureRgba() {} }),
    },
    buildProject: async (input) => input.inputsByTarget.clawd.withCaptureRenderer(async () => {
      order.push(`start:${input.marker}`);
      if (input.marker === 'first') await new Promise((resolve) => { releaseFirst = resolve; });
      order.push(`end:${input.marker}`);
      return input.marker;
    }),
  });
  const first = service({ marker: 'first', project: project(), targets: ['clawd'] });
  const second = service({ marker: 'second', project: project(), targets: ['clawd'] });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(order, ['start:first']);
  releaseFirst();
  assert.deepEqual(await Promise.all([first, second]), ['first', 'second']);
  assert.deepEqual(order, ['start:first', 'end:first', 'start:second', 'end:second']);
});

test('reports only submitted targets as queued, then preparing when the renderer is acquired', async () => {
  let release;
  const firstEvents = [], secondEvents = [];
  const service = createHostedBuildService({ previewSession: { withRenderer: async (_, operation) => operation({}) }, buildProject: async input => input.inputsByTarget[input.targets[0]].withCaptureRenderer(async () => { if (input.targets[0] === 'clawd') await new Promise(resolve => { release = resolve; }); return input.targets[0]; }) });
  const first = service({ project: project(), targets: ['clawd'], onProgress: event => firstEvents.push(event) });
  const second = service({ project: project(), targets: ['codex-pet'], onProgress: event => secondEvents.push(event) });
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(firstEvents.every(event => event.target === 'clawd'));
  assert.equal(secondEvents[0]?.stage, 'queue');
  assert.equal(secondEvents[0]?.status, 'queued');
  release();
  await Promise.all([first, second]);
  assert.ok(secondEvents.some(event => event.stage === 'prepare' && event.target === 'codex-pet'));
});

test('cancels a queued request immediately without opening its renderer or breaking later builds', async () => {
  let release;
  const entered = [];
  const service = createHostedBuildService({ previewSession: { withRenderer: async (_, operation) => operation({}) }, buildProject: async input => input.inputsByTarget[input.targets[0]].withCaptureRenderer(async () => { entered.push(input.marker); if (input.marker === 'first') await new Promise(resolve => { release = resolve; }); return input.marker; }) });
  const first = service({ project: project(), targets: ['clawd'], marker: 'first' });
  const controller = new AbortController();
  const second = service({ project: project(), targets: ['codex-pet'], marker: 'cancelled', signal: controller.signal });
  await new Promise(resolve => setImmediate(resolve));
  controller.abort();
  await assert.rejects(second, error => error.code === 'BUILD_CANCELLED');
  assert.deepEqual(entered, ['first']);
  release();
  await first;
  assert.equal(await service({ project: project(), targets: ['codex-pet'], marker: 'third' }), 'third');
  assert.deepEqual(entered, ['first', 'third']);
});

test('cancellation settles promptly but retains capture ownership until native work unwinds', async () => {
  let release;
  const entered = [];
  let active = 0, peak = 0;
  const service = createHostedBuildService({
    previewSession: { withRenderer: async (_input, operation) => {
      active++; peak = Math.max(peak, active);
      try { return await operation({}); } finally { active--; }
    } },
    buildProject: input => input.inputsByTarget.clawd.withCaptureRenderer(async () => {
      entered.push(input.marker);
      if (input.marker === 'first') await new Promise(resolve => { release = resolve; });
      return input.marker;
    }),
  });
  const controller = new AbortController();
  const first = service({ project: project(), targets: ['clawd'], marker: 'first', signal: controller.signal });
  await new Promise(resolve => setImmediate(resolve));
  controller.abort();
  await assert.rejects(first, { code: 'BUILD_CANCELLED' });
  const retry = service({ project: project(), targets: ['clawd'], marker: 'retry' });
  try {
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(active, 1);
    assert.deepEqual(entered, ['first']);
  } finally { release(); }
  assert.equal(await retry, 'retry');
  assert.equal(active, 0);
  assert.equal(peak, 1);
});
