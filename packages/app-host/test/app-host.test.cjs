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
  assert.equal(APP_IPC_METHODS.includes('buildProject'), true);
  assert.equal(APP_IPC_METHODS.includes('getBuildArtifact'), true);
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

test('routes Package Build through the injected shared service and strips binary payloads from IPC results', async () => {
  const calls = [];
  const router = createAppIpcRouter({
    mapperHostFactory: async () => fakeHost(),
    buildProjectService: async (input) => {
      calls.push(input);
      input.onProgress({ target: 'codex-pet', stage: 'preview', status: 'completed' });
      return {
        buildContractVersion: 1,
        projectId: 'app-fixture',
        targets: ['codex-pet'],
        warnings: [],
        builds: {
          'codex-pet': {
            buildContractVersion: 1,
            target: 'codex-pet',
            artifactName: 'app-fixture-codex-pet-1.0.0.zip',
            manifest: { target: 'codex-pet' },
            assets: [{ file: 'spritesheet.webp', byteLength: 12 }],
            validation: { ok: true },
            preview: { ready: true },
            atlas: { width: 1536, height: 1872, rgba: Uint8Array.from([0, 1, 2]) },
            spritesheet: Uint8Array.from([3, 4, 5]),
            package: { format: 'zip', byteLength: 42, files: ['pet.json', 'spritesheet.webp'], buffer: Uint8Array.from([6, 7, 8]) },
          },
        },
      };
    },
  });
  const input = { project: { projectId: 'app-fixture' }, targets: ['codex-pet'], inputsByTarget: { 'codex-pet': {} } };
  const response = await router({ protocolVersion: 1, method: 'buildProject', args: [input] });
  assert.equal(response.ok, true);
  assert.deepEqual(response.progress, [{ target: 'codex-pet', stage: 'preview', status: 'completed' }]);
  assert.equal(response.result.builds['codex-pet'].package.buffer, undefined);
  assert.equal(response.result.builds['codex-pet'].spritesheet, undefined);
  assert.equal(response.result.builds['codex-pet'].atlas.rgba, undefined);
  assert.deepEqual(response.result.builds['codex-pet'].package.files, ['pet.json', 'spritesheet.webp']);
  assert.equal(response.result.artifacts.length, 1);
  assert.equal(response.result.artifacts[0].byteLength, 3);
  assert.equal(response.result.artifacts[0].filename, 'app-fixture-codex-pet-1.0.0.zip');
  const artifact = await router({ protocolVersion: 1, method: 'getBuildArtifact', args: [{ artifactId: response.result.artifacts[0].artifactId }] });
  assert.equal(artifact.ok, true);
  assert.deepEqual([...artifact.result.bytes], [6, 7, 8]);
  assert.equal(artifact.result.byteLength, 3);
  const missingArtifact = await router({ protocolVersion: 1, method: 'getBuildArtifact', args: [{ artifactId: 'missing' }] });
  assert.equal(missingArtifact.ok, false);
  assert.equal(missingArtifact.error.code, 'BUILD_ARTIFACT_NOT_FOUND');
  await router({ protocolVersion: 1, method: 'closeMapperSession', args: [] });
  const afterClose = await router({ protocolVersion: 1, method: 'getBuildArtifact', args: [{ artifactId: response.result.artifacts[0].artifactId }] });
  assert.equal(afterClose.ok, false);
  assert.equal(afterClose.error.code, 'BUILD_ARTIFACT_NOT_FOUND');
  assert.deepEqual({ project: calls[0].project, targets: calls[0].targets, inputsByTarget: calls[0].inputsByTarget }, input);
});

test('rejects malformed or unavailable App Package Build requests with typed errors', async () => {
  const withoutService = createAppIpcRouter({ mapperHostFactory: async () => fakeHost() });
  const unavailable = await withoutService({ protocolVersion: 1, method: 'buildProject', args: [{ project: {} }] });
  assert.equal(unavailable.ok, false);
  assert.equal(unavailable.error.code, 'APP_BUILD_UNAVAILABLE');

  const router = createAppIpcRouter({ mapperHostFactory: async () => fakeHost(), buildProjectService: async () => ({}) });
  const malformed = await router({ protocolVersion: 1, method: 'buildProject', args: [{ project: {}, renderer: 'not-allowed' }] });
  assert.equal(malformed.ok, false);
  assert.equal(malformed.error.code, 'INVALID_BUILD_REQUEST');
});

test('preload exposes only typed methods and the window options keep Electron sandbox defaults', async () => {
  const calls = [];
  const api = createAppPreloadApi({ ipcRenderer: { invoke: async (...args) => (calls.push(args), { ok: true }) } });
  await api.getVersion();
  await api.startMapperSession({});
  await api.buildProject({ project: { projectId: 'app-fixture' } });
  await api.getBuildArtifact('fixture-artifact');
  assert.equal(calls[0][0], APP_IPC_CHANNEL);
  assert.deepEqual(calls[0][1], { protocolVersion: 1, method: 'getVersion', args: [] });
  assert.deepEqual(calls[1][1], { protocolVersion: 1, method: 'startMapperSession', args: [{}] });
  assert.deepEqual(calls[2][1], { protocolVersion: 1, method: 'buildProject', args: [{ project: { projectId: 'app-fixture' } }] });
  assert.deepEqual(calls[3][1], { protocolVersion: 1, method: 'getBuildArtifact', args: [{ artifactId: 'fixture-artifact' }] });
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
