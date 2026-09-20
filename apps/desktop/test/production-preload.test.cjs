const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const test = require('node:test');
const { createAppPreloadApi } = require('../../../packages/app-host/src/index.cjs');
const { preloadBundle } = require('../scripts/prepare-preload.cjs');

test('the shipped preload is generated from the same factory used by the shared host tests', async () => {
  assert.equal(fs.readFileSync(path.join(__dirname, '../preload.cjs'), 'utf8'), preloadBundle());
  const calls = [], received = [];
  const events = new EventEmitter();
  const shared = createAppPreloadApi({ ipcRenderer: { invoke: (...args) => { calls.push(args); }, on: events.on.bind(events), removeListener: events.removeListener.bind(events) } });
  shared.openGitHubLibrary('https://github.com/owner/repo/tree/main/models');
  assert.deepEqual(calls[0][1].args, [{ url: 'https://github.com/owner/repo/tree/main/models' }]);
  shared.onAppCommand(command => received.push(command));
  events.emit('live2pet:command', {}, 'undo');
  events.emit('live2pet:command', {}, 'redo');
  assert.deepEqual(received, ['undo', 'redo']);
});

function loadProductionBridge() {
  const calls = [];
  const events = new EventEmitter();
  let api;
  const electron = {
    contextBridge: { exposeInMainWorld(name, value) { assert.equal(name, 'live2pet'); api = value; } },
    ipcRenderer: {
      invoke(channel, envelope) { calls.push([channel, JSON.parse(JSON.stringify(envelope))]); return Promise.resolve({ protocolVersion: 1, ok: true, result: {} }); },
      on: events.on.bind(events), removeListener: events.removeListener.bind(events),
    },
    webUtils: { getPathForFile: file => { if (!file.path) throw new Error('not a native file'); return file.path; } },
  };
  // This executes exactly the file Electron loads, with its restricted require.
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../preload.cjs'), 'utf8'), {
    require(name) { assert.equal(name, 'electron', 'preload must not import workspace/Node modules'); return electron; },
  });
  assert.ok(Object.isFrozen(api));
  return { api, calls, events };
}

test('production preload exposes only narrow project, model, runtime, build and install operations', async () => {
  const { api, calls } = loadProductionBridge();
  const operations = [
    ['openGitHubLibrary', ['https://github.com/owner/repo/tree/main/models'], [{ url: 'https://github.com/owner/repo/tree/main/models' }]],
    ['openProject', [{ documentId: 'project_1234' }]],
    ['saveProject', [{ documentId: 'project_1234', project: { name: 'Fixture' }, saveAs: true }]],
    ['configureRuntime', [{ inputPath: '/local/runtime.js' }]],
    ['clearRuntimeSettings', [{ fingerprint: 'a'.repeat(64) }]],
    ['buildProject', [{ project: { projectId: 'fixture' }, targets: ['clawd'] }]],
    ['getBuildArtifact', ['artifact_1234', 1024], [{ artifactId: 'artifact_1234', offset: 1024 }]],
    ['saveBuildArtifact', ['artifact_1234'], [{ artifactId: 'artifact_1234' }]],
    ['installArtifact', [{ artifactId: 'artifact_1234', target: 'clawd', confirmInstall: true }]],
  ];
  for (const [method, args, expected = args] of operations) {
    await api[method](...args);
    assert.deepEqual(calls.at(-1), ['live2pet:app', { protocolVersion: 1, method, args: expected }]);
  }
  for (const [method, expected] of [['openPreview', 'open'], ['controlPreview', 'control'], ['setPreviewVisualSettings', 'setVisualSettings']]) {
    await api[method]({ projectId: 'fixture' });
    assert.deepEqual(calls.at(-1), ['live2pet:preview', { protocolVersion: 1, method: expected, input: { projectId: 'fixture' } }]);
  }
  assert.equal(api.getFilePath({ path: '/local/model.pck' }), '/local/model.pck');
  assert.equal(api.getFilePath({}), null);
  for (const key of ['invoke', 'send', 'ipcRenderer', 'require', 'fs', 'shell', 'exec', 'on', 'getSkillStatus', 'installSkill', 'startMapperSession', 'rendererCommand']) assert.equal(api[key], undefined);
});

test('production preload filters events, retains build ownership and unsubscribes idempotently', () => {
  const { api, events } = loadProductionBridge();
  const commands = [], progress = [], previews = [], downloads = [];
  const unsubscribe = [api.onAppCommand(value => commands.push(value)), api.onBuildProgress(value => progress.push(value)), api.onPreviewStatus(value => previews.push(value)), api.onLibraryDownloadProgress(value => downloads.push(value))];
  for (const command of ['undo', 'redo', 'save', 'arbitrary-command']) events.emit('live2pet:command', { sender: 'hidden' }, command);
  assert.deepEqual(commands, ['undo', 'redo', 'save']);
  const valid = { protocolVersion: 1, buildId: 'build_1234', sequence: 1, target: 'clawd', stage: 'capture', status: 'started', requestId: 'request_1234', projectId: 'fixture', snapshotFingerprint: 'a'.repeat(64) };
  events.emit('live2pet:build-progress', {}, { ...valid, path: '/private/model', arbitrary: true });
  for (const invalid of [null, { ...valid, protocolVersion: 2 }, { ...valid, sequence: 0 }, { ...valid, stage: '' }]) events.emit('live2pet:build-progress', {}, invalid);
  assert.deepEqual(JSON.parse(JSON.stringify(progress)), [valid]);
  events.emit('live2pet:preview-status', {}, { schemaVersion: 2, state: 'ready' });
  events.emit('live2pet:preview-status', {}, { schemaVersion: 1, state: 'ready' });
  assert.equal(previews.length, 1);
  events.emit('live2pet:library-download-progress', {}, { protocolVersion: 1, downloadId: 'download_1234', sequence: 1, libraryId: 'library_1234', stage: 'downloading', total: 1, completed: 0, downloaded: 0, cached: 0, failed: 0, percent: 0 });
  events.emit('live2pet:library-download-progress', {}, { protocolVersion: 2 });
  assert.equal(downloads.length, 1);
  for (const cancel of unsubscribe) { cancel(); cancel(); }
  assert.equal(events.eventNames().length, 0);
});
