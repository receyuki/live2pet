const assert = require('node:assert/strict');
const test = require('node:test');

const { HostedBuildError, createHostedBuildService } = require('../hosted-build-service.cjs');

const FINGERPRINT = 'a'.repeat(64);
const project = () => ({ projectId: 'project-1', source: { fingerprint: FINGERPRINT } });

test('injects one hosted renderer into targets that lack captured inputs', async () => {
  const renderer = { captureRgba() {} };
  let received;
  const service = createHostedBuildService({
    previewSession: {
      withRenderer: async (identity, operation) => {
        assert.deepEqual(identity, { projectId: 'project-1', sourceFingerprint: FINGERPRINT, bounds: { x: 0, y: 0, width: 768, height: 768 } });
        return operation(renderer);
      },
    },
    buildProject: async (input) => { received = input; return { ok: true }; },
  });
  assert.deepEqual(await service({ project: project(), targets: ['clawd', 'codex-pet'], inputsByTarget: { clawd: { renderPreset: 'high' } } }), { ok: true });
  assert.equal(received.inputsByTarget.clawd.renderer, renderer);
  assert.equal(received.inputsByTarget['codex-pet'].renderer, renderer);
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
  assert.equal(result.inputsByTarget['codex-pet'].renderer, renderer);
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
    buildProject: async () => 'recovered',
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
    buildProject: async (input) => {
      order.push(`start:${input.marker}`);
      if (input.marker === 'first') await new Promise((resolve) => { releaseFirst = resolve; });
      order.push(`end:${input.marker}`);
      return input.marker;
    },
  });
  const first = service({ marker: 'first', project: project(), targets: ['clawd'] });
  const second = service({ marker: 'second', project: project(), targets: ['clawd'] });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(order, ['start:first']);
  releaseFirst();
  assert.deepEqual(await Promise.all([first, second]), ['first', 'second']);
  assert.deepEqual(order, ['start:first', 'end:first', 'start:second', 'end:second']);
});
