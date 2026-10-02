const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createAppIpcRouter, createAppPreloadApi, createAnimationOutputService } = require('../src/index.cjs');
const request = (method, ...args) => ({ protocolVersion: 1, method, args });

test('export resolves default format before opening output picker and honors explicit format', async () => {
  let format = 'apng';
  const received = [];
  const router = createAppIpcRouter({
    packageOutputService: { get: async () => ({ animationFormat: format }), configure: async () => {}, save: async () => {} },
    animationOutputService: { prepare: async () => { format = 'webp'; return { directoryId: 'chosen' }; } },
    animationExportService: async input => { received.push(input.render.format); return { failures: [] }; },
  });
  assert.equal((await router(request('exportAnimations', { requestId: 'export-123', project: {}, motionIds: ['idle'], render: {} }))).ok, true);
  assert.equal((await router(request('exportAnimations', { requestId: 'export-124', project: {}, motionIds: ['idle'], render: { format: 'apng' } }))).ok, true);
  assert.deepEqual(received, ['apng', 'apng']);
  assert.equal((await router(request('configureOutputSettings', { action: 'set-animation-format', format: 'apng' }))).ok, true);
  assert.equal((await router(request('configureOutputSettings', { action: 'set-animation-format', format: 'gif' }))).ok, false);
  assert.equal((await router(request('configureOutputSettings', { action: 'choose-folder', format: 'apng' }))).ok, false);
});

test('animation output only opens selected directories and preserves existing filenames', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'live2pet-export-'));
  try {
    const service = createAnimationOutputService({ getSettings: async () => ({ mode: 'folder', folder: root, folderState: 'ready' }), pickFolder: async () => root, openPath: async value => { assert.equal(value, root); return ''; } });
    await assert.rejects(service.open(root));
    const output = await service.prepare({ project: {}, motionIds: ['idle'] });
    const animation = { motionId: '../idle', format: 'webp', buffer: Buffer.from('webp') };
    const first = await service.write(output.directoryId, animation);
    const second = await service.write(output.directoryId, animation);
    assert.notEqual(first.filename, second.filename);
    assert.equal((await fs.readFile(path.join(root, first.filename))).toString(), 'webp');
    assert.equal((await service.open(output.directoryId)).opened, true);
    assert.equal((await service.write(output.directoryId, { ...animation, format: 'apng' })).filename.endsWith('.apng'), true);
    await assert.rejects(service.write(output.directoryId, { ...animation, format: 'exe' }));
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('animation export routes progress and keeps completed files on cancellation', async () => {
  let entered;
  const ready = new Promise(resolve => { entered = resolve; });
  const events = [];
  const router = createAppIpcRouter({
    animationOutputService: { prepare: async () => ({ directoryId: 'chosen', directoryPath: '/chosen' }), write: async value => ({ filename: 'idle.webp' }) },
    onAnimationExportProgress: event => events.push(event),
    animationExportService: async ({ signal, onProgress, onAnimation }) => {
      onProgress({ stage: 'capture', status: 'running', percent: 1, privatePath: '/secret' });
      await onAnimation({ motionId: 'idle' });
      entered();
      await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }));
      throw Object.assign(new Error('cancelled'), { code: 'BUILD_CANCELLED' });
    },
  });
  const pending = router(request('exportAnimations', { requestId: 'export-123', project: {}, render: {}, motionIds: ['idle'] }));
  await ready;
  assert.equal((await router(request('cancelAnimationExport', { requestId: 'export-123' }))).result.cancelled, true);
  const response = await pending;
  assert.equal(response.result.cancelled, true);
  assert.equal(response.result.files.length, 1);
  assert.equal(events[0].requestId, 'export-123');
  assert.equal(events[0].privatePath, undefined);
  assert.equal((await router(request('exportAnimations', { requestId: 'export-123', project: {}, render: {}, motionIds: ['idle'], outputPath: '/untrusted' }))).ok, false);
});

test('animation preload validates progress and exposes token-based output actions', async () => {
  const callbacks = new Map();
  const calls = [];
  const api = createAppPreloadApi({ ipcRenderer: { invoke: async (_channel, value) => calls.push(value), on: (channel, callback) => callbacks.set(channel, callback), removeListener: channel => callbacks.delete(channel) } });
  const events = [];
  const unsubscribe = api.onAnimationExportProgress(value => events.push(value));
  callbacks.get('live2pet:animation-export-progress')(null, { protocolVersion: 1, requestId: 'export-123', sequence: 1, stage: 'capture', status: 'running', percent: 10 });
  assert.equal(events[0].requestId, 'export-123');
  assert.equal(events[0].buildId, undefined);
  await api.openAnimationExportDirectory('chosen');
  assert.deepEqual(calls[0].args, [{ directoryId: 'chosen' }]);
  unsubscribe();
  assert.equal(callbacks.size, 0);
});
