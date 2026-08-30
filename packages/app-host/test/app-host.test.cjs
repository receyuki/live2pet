const assert = require('node:assert/strict');
const test = require('node:test');

const {
  APP_IPC_CHANNEL,
  APP_IPC_METHODS,
  AppHostError,
  createAppIpcRouter,
  createAppPreloadApi,
  createAppWindowOptions,
  normalizeRequest,
} = require('../src/index.cjs');

function fakeHost() {
  let closed = false;
  const project = { projectId: 'app-fixture', name: 'App fixture' };
  return {
    protocolVersion: 1,
    sessionId: 'session-fixture',
    getLaunchDescriptor: () => ({ protocolVersion: 1, sessionId: 'session-fixture', origin: 'http://127.0.0.1:45123', expiresAt: '2030-01-01T00:00:00.000Z', mapperUrl: 'file:///mapper.html#live2pet=bootstrap' }),
    getClient: () => ({ getProject: async () => ({ protocolVersion: 1, ok: true, project }), updateProject: async (next) => ({ protocolVersion: 1, ok: true, project: Object.assign(project, next) }) }),
    close: async () => { closed = true; },
    get wasClosed() { return closed; },
  };
}

test('normalizes only versioned, allowlisted App IPC requests', () => {
  assert.deepEqual(normalizeRequest({ protocolVersion: 1, method: 'getVersion', args: [] }), { protocolVersion: 1, method: 'getVersion', args: [] });
  assert.throws(() => normalizeRequest({ protocolVersion: 1, method: 'shell', args: [] }), (error) => error instanceof AppHostError && error.code === 'UNKNOWN_APP_METHOD');
  assert.equal(APP_IPC_METHODS.includes('startMapperSession'), true);
});

test('routes a single Mapper Session without exposing its client or token in the launch descriptor', async () => {
  const host = fakeHost();
  const router = createAppIpcRouter({ mapperHostFactory: async () => host, appVersion: '0.1.0-test' });
  const version = await router({ protocolVersion: 1, method: 'getVersion', args: [] });
  assert.equal(version.result.appVersion, '0.1.0-test');
  const started = await router({ protocolVersion: 1, method: 'startMapperSession', args: [{ project: { projectId: 'app-fixture' } }] });
  assert.equal(started.ok, true);
  assert.equal(Object.hasOwn(started.result, 'token'), false);
  assert.equal((await router({ protocolVersion: 1, method: 'getMapperProject', args: [] })).result.project.projectId, 'app-fixture');
  assert.equal((await router({ protocolVersion: 1, method: 'updateMapperProject', args: [{ name: 'Updated' }] })).result.project.name, 'Updated');
  const duplicate = await router({ protocolVersion: 1, method: 'startMapperSession', args: [{}] });
  assert.equal(duplicate.error.code, 'MAPPER_SESSION_ACTIVE');
  const closed = await router({ protocolVersion: 1, method: 'closeMapperSession', args: [] });
  assert.equal(closed.result.closed, true);
  assert.equal(host.wasClosed, true);
});

test('preload exposes only typed methods and the window options keep Electron sandbox defaults', async () => {
  const calls = [];
  const api = createAppPreloadApi({ ipcRenderer: { invoke: async (...args) => (calls.push(args), { ok: true }) } });
  await api.getVersion();
  await api.startMapperSession({});
  assert.equal(calls[0][0], APP_IPC_CHANNEL);
  assert.deepEqual(calls[0][1], { protocolVersion: 1, method: 'getVersion', args: [] });
  assert.deepEqual(calls[1][1], { protocolVersion: 1, method: 'startMapperSession', args: [{}] });
  assert.equal(Object.hasOwn(api, 'ipcRenderer'), false);
  const options = createAppWindowOptions({ preload: '/app/preload.cjs' });
  assert.equal(options.webPreferences.nodeIntegration, false);
  assert.equal(options.webPreferences.contextIsolation, true);
  assert.equal(options.webPreferences.sandbox, true);
  assert.equal(options.webPreferences.webviewTag, false);
});

test('requires safe App window dimensions and a preload path', () => {
  assert.throws(() => createAppWindowOptions({ width: 100 }), (error) => error instanceof AppHostError && error.code === 'INVALID_APP_WINDOW');
  assert.throws(() => createAppWindowOptions({ preload: 'app://preload', height: 200 }), (error) => error instanceof AppHostError && error.code === 'INVALID_APP_WINDOW');
});
