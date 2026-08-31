const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const test = require('node:test');

const { createProject } = require('../../project/src/index.cjs');
const { CacheStore } = require('../../package-build/src/cache.cjs');
const { buildProjectTargets } = require('../../package-build/src/index.cjs');
const { inspectSourcePackage } = require('../../source-inspector/src/index.cjs');

const {
  APP_BUILD_ARTIFACT_CHUNK_BYTES,
  APP_BUILD_PROGRESS_CHANNEL,
  APP_IPC_CHANNEL,
  APP_IPC_METHODS,
  AppHostError,
  createAppIpcRouter,
  createAppPreloadApi,
  createAppWindowOptions,
  normalizeInspectRequest,
  normalizeRuntimeRequest,
  normalizeInstallRequest,
  normalizeBuildProgressEvent,
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
  assert.equal(APP_IPC_METHODS.includes('installArtifact'), true);
  assert.equal(APP_IPC_METHODS.includes('inspectSource'), true);
  assert.deepEqual(normalizeInspectRequest({ inputPath: '/tmp/source', projectId: 'fixture' }), { inputPath: '/tmp/source', projectId: 'fixture' });
  assert.throws(() => normalizeInspectRequest({ inputPath: '/tmp/source', shell: true }), (error) => error instanceof AppHostError && error.code === 'INVALID_INSPECT_REQUEST');
  assert.deepEqual(normalizeRuntimeRequest({ inputPath: '/tmp/live2d.min.js' }), { inputPath: '/tmp/live2d.min.js' });
  assert.throws(() => normalizeRuntimeRequest({ inputPath: '/tmp/runtime', shell: true }), (error) => error instanceof AppHostError && error.code === 'INVALID_RUNTIME_REQUEST');
  assert.deepEqual(normalizeInstallRequest({ artifactId: 'artifact', target: 'codex-pet', confirmInstall: true }), { artifactId: 'artifact', target: 'codex-pet', conflict: 'cancel', confirmInstall: true });
  assert.throws(() => normalizeInstallRequest({ artifactId: 'artifact', target: 'codex-pet' }), (error) => error instanceof AppHostError && error.code === 'INSTALL_AUTHORIZATION_REQUIRED');
});

test('routes runtime settings without exposing the selected path and marks changes restart-required', async () => {
  const calls = [];
  const available = {
    schemaVersion: 1,
    configured: true,
    runtimeName: 'live2d.min.js',
    sourceType: 'file',
    runtimeKind: 'legacy-cubism2',
    cubismGenerations: [2],
    fingerprint: 'a'.repeat(64),
    restartRequired: true,
    available: true,
  };
  const router = createAppIpcRouter({
    runtimeSettingsService: {
      get: async () => available,
      configure: async (input) => { calls.push(input); return available; },
      clear: async () => ({ schemaVersion: 1, configured: false, restartRequired: false }),
    },
  });
  const current = await router({ protocolVersion: 1, method: 'getRuntimeSettings', args: [] });
  assert.deepEqual(current.result, available);
  const configured = await router({ protocolVersion: 1, method: 'configureRuntime', args: [{ inputPath: '/Users/RY/Downloads/live2d.min.js' }] });
  assert.equal(configured.ok, true);
  assert.deepEqual(configured.progress, [{ stage: 'runtime', status: 'completed' }]);
  assert.deepEqual(calls, [{ inputPath: '/Users/RY/Downloads/live2d.min.js' }]);
  assert.equal(JSON.stringify(configured).includes('/Users/RY/Downloads'), false);
  const cleared = await router({ protocolVersion: 1, method: 'clearRuntimeSettings', args: [] });
  assert.deepEqual(cleared.result, { schemaVersion: 1, configured: false, restartRequired: false });
  const malformed = await router({ protocolVersion: 1, method: 'configureRuntime', args: [{ inputPath: '/tmp/runtime', extra: true }] });
  assert.equal(malformed.ok, false);
  assert.equal(malformed.error.code, 'INVALID_RUNTIME_REQUEST');
});

test('rejects runtime services that return raw paths or incomplete metadata', async () => {
  const incomplete = createAppIpcRouter({ runtimeSettingsService: { get: async () => ({}), configure: async () => ({}), clear: async () => ({}) } });
  const incompleteResponse = await incomplete({ protocolVersion: 1, method: 'getRuntimeSettings', args: [] });
  assert.equal(incompleteResponse.ok, false);
  assert.equal(incompleteResponse.error.code, 'INVALID_RUNTIME_RESULT');
  const router = createAppIpcRouter({ runtimeSettingsService: { get: async () => ({ schemaVersion: 1, configured: true, restartRequired: true, runtimePath: '/tmp/runtime' }), configure: async () => ({}), clear: async () => ({ schemaVersion: 1, configured: false, restartRequired: false }) } });
  const response = await router({ protocolVersion: 1, method: 'getRuntimeSettings', args: [] });
  assert.equal(response.ok, false);
  assert.equal(response.error.code, 'INVALID_RUNTIME_RESULT');
});

test('routes the same normalized synthetic Source Package manifest as the CLI and caches App-side PCK extraction', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'live2pet-app-inspect-'));
  fs.mkdirSync(path.join(root, 'hero', 'motions'), { recursive: true });
  fs.writeFileSync(path.join(root, 'hero', 'hero.model3.json'), JSON.stringify({
    Version: 3,
    FileReferences: {
      Moc: 'hero.moc3',
      Textures: ['hero.png'],
      Motions: { Main: [{ File: 'motions/idle.motion3.json', Name: 'Idle' }] },
    },
  }));
  fs.writeFileSync(path.join(root, 'hero', 'hero.moc3'), Buffer.from('moc-fixture'));
  fs.writeFileSync(path.join(root, 'hero', 'hero.png'), Buffer.from('png-fixture'));
  fs.writeFileSync(path.join(root, 'hero', 'motions', 'idle.motion3.json'), JSON.stringify({ Meta: { Duration: 1 } }));
  const cache = new CacheStore({ rootDir: fs.mkdtempSync(path.join(os.tmpdir(), 'live2pet-app-cache-')), maxBytes: 1024 * 1024 });
  const router = createAppIpcRouter({
    sourceInspectionService: ({ inputPath, projectId }) => inspectSourcePackage(inputPath, { cache, projectId }),
  });
  const appResponse = await router({ protocolVersion: 1, method: 'inspectSource', args: [{ inputPath: root, projectId: 'app-inspect' }] });
  assert.equal(appResponse.ok, true);
  assert.deepEqual(appResponse.warnings, appResponse.result.warnings);
  const cliPath = path.join(__dirname, '../../cli/bin/live2pet.cjs');
  const cliResponse = JSON.parse(execFileSync(process.execPath, [cliPath, 'inspect', '--input', root], { encoding: 'utf8' }));
  assert.equal(cliResponse.ok, true);
  assert.deepEqual(appResponse.result, cliResponse.result);
  assert.equal(JSON.stringify(appResponse).includes(root), false);
  assert.equal(cache.status({ projectId: 'app-inspect' }).entryCount, 1);
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
  assert.equal(artifact.result.offset, 0);
  assert.equal(artifact.result.nextOffset, 3);
  assert.equal(artifact.result.done, true);
  const missingArtifact = await router({ protocolVersion: 1, method: 'getBuildArtifact', args: [{ artifactId: 'missing' }] });
  assert.equal(missingArtifact.ok, false);
  assert.equal(missingArtifact.error.code, 'BUILD_ARTIFACT_NOT_FOUND');
  await router({ protocolVersion: 1, method: 'closeMapperSession', args: [] });
  const afterClose = await router({ protocolVersion: 1, method: 'getBuildArtifact', args: [{ artifactId: response.result.artifacts[0].artifactId }] });
  assert.equal(afterClose.ok, false);
  assert.equal(afterClose.error.code, 'BUILD_ARTIFACT_NOT_FOUND');
  assert.deepEqual({ project: calls[0].project, targets: calls[0].targets, inputsByTarget: calls[0].inputsByTarget }, input);
});

test('returns large build artifacts through bounded sequential IPC chunks', async () => {
  const bytes = Uint8Array.from({ length: (3 * 1024 * 1024) + 17 }, (_, index) => index % 251);
  const router = createAppIpcRouter({
    buildProjectService: async () => ({
      buildContractVersion: 1,
      projectId: 'chunked-artifact',
      targets: ['clawd'],
      warnings: [],
      builds: {
        clawd: {
          target: 'clawd',
          artifactName: 'chunked-artifact-clawd-1.0.0.zip',
          package: { format: 'zip', byteLength: bytes.byteLength, files: ['theme.json'], buffer: bytes },
        },
      },
    }),
  });
  const built = await router({ protocolVersion: 1, method: 'buildProject', args: [{ project: { projectId: 'chunked-artifact' }, targets: ['clawd'] }] });
  assert.equal(built.ok, true);
  const artifactId = built.result.artifacts[0].artifactId;
  const chunks = [];
  let offset = 0;
  let done = false;
  while (!done) {
    const response = await router({ protocolVersion: 1, method: 'getBuildArtifact', args: [{ artifactId, offset }] });
    assert.equal(response.ok, true);
    assert.equal(response.result.offset, offset);
    assert.ok(response.result.bytes.byteLength <= APP_BUILD_ARTIFACT_CHUNK_BYTES);
    assert.ok(response.result.nextOffset > offset);
    chunks.push(response.result.bytes);
    offset = response.result.nextOffset;
    done = response.result.done;
  }
  assert.equal(offset, bytes.byteLength);
  assert.deepEqual(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))), Buffer.from(bytes));
  assert.deepEqual(chunks.map((chunk) => chunk.byteLength), [APP_BUILD_ARTIFACT_CHUNK_BYTES, APP_BUILD_ARTIFACT_CHUNK_BYTES, APP_BUILD_ARTIFACT_CHUNK_BYTES, 17]);

  const eof = await router({ protocolVersion: 1, method: 'getBuildArtifact', args: [{ artifactId, offset: bytes.byteLength }] });
  assert.equal(eof.ok, true);
  assert.equal(eof.result.bytes.byteLength, 0);
  assert.equal(eof.result.nextOffset, bytes.byteLength);
  assert.equal(eof.result.done, true);

  for (const invalidOffset of [-1, 0.5, '0', bytes.byteLength + 1]) {
    const invalid = await router({ protocolVersion: 1, method: 'getBuildArtifact', args: [{ artifactId, offset: invalidOffset }] });
    assert.equal(invalid.ok, false);
    assert.equal(invalid.error.code, 'INVALID_BUILD_ARTIFACT_REQUEST');
  }
});

test('forwards safe, sequenced build progress to the App listener without leaking arbitrary values', async () => {
  const events = [];
  const router = createAppIpcRouter({
    onBuildProgress: (event) => events.push(event),
    buildProjectService: async (input) => {
      input.onProgress({ target: 'codex-pet', stage: 'preview', status: 'completed', total: 3, completed: 1, index: 2, frameCount: 6, concurrency: 2, message: 'preview ready', path: '/private/source', bytes: Uint8Array.from([1, 2, 3]) });
      input.onProgress({ target: 'codex-pet', stage: 'package', status: 'started', byteLength: 42 });
      input.onProgress({ target: 'codex-pet', stage: 'package', status: 'completed', packageByteLength: 42 });
      return { projectId: 'app-progress', targets: ['codex-pet'], builds: {} };
    },
  });
  const response = await router({ protocolVersion: 1, method: 'buildProject', args: [{ project: { projectId: 'app-progress' }, targets: ['codex-pet'] }] });
  assert.equal(response.ok, true);
  assert.equal(response.progress.length, 3);
  assert.equal(events.length, 3);
  assert.equal(normalizeBuildProgressEvent({ stage: 'preview', status: 'completed' }).stage, 'preview');
  assert.equal(events[0].protocolVersion, 1);
  assert.equal(typeof events[0].buildId, 'string');
  assert.equal(events[0].buildId, events[1].buildId);
  assert.deepEqual(events.map((event) => event.sequence), [1, 2, 3]);
  assert.equal(Object.hasOwn(events[0], 'path'), false);
  assert.equal(Object.hasOwn(events[0], 'bytes'), false);
  assert.deepEqual(
    Object.fromEntries(['total', 'completed', 'index', 'frameCount', 'concurrency', 'message'].map((key) => [key, events[0][key]])),
    { total: 3, completed: 1, index: 2, frameCount: 6, concurrency: 2, message: 'preview ready' },
  );
  assert.equal(events[2].packageByteLength, 42);
});

test('rejects malformed or unavailable App Package Build requests with typed errors', async () => {
  const withoutService = createAppIpcRouter({ mapperHostFactory: async () => fakeHost() });
  const unavailable = await withoutService({ protocolVersion: 1, method: 'buildProject', args: [{ project: {} }] });
  assert.equal(unavailable.ok, false);
  assert.equal(unavailable.error.code, 'APP_BUILD_UNAVAILABLE');
  const installUnavailable = await withoutService({ protocolVersion: 1, method: 'installArtifact', args: [{ artifactId: 'artifact', target: 'codex-pet', confirmInstall: true }] });
  assert.equal(installUnavailable.ok, false);
  assert.equal(installUnavailable.error.code, 'APP_INSTALL_UNAVAILABLE');
  const inspectionUnavailable = await withoutService({ protocolVersion: 1, method: 'inspectSource', args: [{ inputPath: '/tmp/source' }] });
  assert.equal(inspectionUnavailable.ok, false);
  assert.equal(inspectionUnavailable.error.code, 'APP_INSPECTION_UNAVAILABLE');

  const router = createAppIpcRouter({ mapperHostFactory: async () => fakeHost(), buildProjectService: async () => ({}) });
  const malformed = await router({ protocolVersion: 1, method: 'buildProject', args: [{ project: {}, renderer: 'not-allowed' }] });
  assert.equal(malformed.ok, false);
  assert.equal(malformed.error.code, 'INVALID_BUILD_REQUEST');
  const malformedInspection = await createAppIpcRouter({ sourceInspectionService: async () => ({}) })({ protocolVersion: 1, method: 'inspectSource', args: [{ inputPath: '/tmp/source', extra: true }] });
  assert.equal(malformedInspection.ok, false);
  assert.equal(malformedInspection.error.code, 'INVALID_INSPECT_REQUEST');
});

test('routes a real synthetic Codex build through the App seam and returns a downloadable artifact handle', async () => {
  const project = createProject({
    projectId: 'app-real-build',
    name: 'App real build',
    source: { kind: 'synthetic', name: 'synthetic-source', fingerprint: 'b'.repeat(64) },
    targets: { 'codex-pet': { profile: 'codex-pet', mappings: Object.fromEntries(['idle', 'running-right', 'running-left', 'waving', 'jumping', 'failed', 'waiting', 'running', 'review'].map((id) => [id, 'motion:fixture'])) } },
  });
  const rgba = new Uint8Array(192 * 208 * 4);
  for (let index = 3; index < rgba.length; index += 4) rgba[index] = 255;
  const rowFrames = (count) => Array.from({ length: count }, (_, index) => ({ id: `fixture-${index}`, index, time: count > 1 ? index / (count - 1) : 0, visualChange: index === 0 || index === count - 1 ? 0 : 1, bounds: { x: 0, y: 0, width: 1, height: 1 }, width: 192, height: 208, rgba }));
  const candidatesByRow = Object.fromEntries([['idle', 6], ['running-right', 8], ['running-left', 8], ['waving', 4], ['jumping', 5], ['failed', 8], ['waiting', 6], ['running', 6], ['review', 6]].map(([id, count]) => [id, rowFrames(count)]));
  const router = createAppIpcRouter({ mapperHostFactory: async () => fakeHost(), buildProjectService: buildProjectTargets });
  const response = await router({
    protocolVersion: 1,
    method: 'buildProject',
    args: [{
      project,
      targets: ['codex-pet'],
      inputsByTarget: { 'codex-pet': { candidatesByRow } },
      metadataByTarget: { 'codex-pet': { id: 'app-real-build', displayName: 'App real build', description: 'Synthetic App integration build.', version: '1.0.0' } },
      optionsByTarget: { 'codex-pet': { package: true, quality: 76 } },
    }],
  });
  assert.equal(response.ok, true);
  assert.equal(response.result.targets[0], 'codex-pet');
  assert.equal(response.result.builds['codex-pet'].validation.ok, true);
  assert.equal(response.result.builds['codex-pet'].package.buffer, undefined);
  assert.equal(response.result.artifacts.length, 1);
  const artifact = await router({ protocolVersion: 1, method: 'getBuildArtifact', args: [{ artifactId: response.result.artifacts[0].artifactId }] });
  assert.equal(artifact.ok, true);
  assert.ok(artifact.result.bytes.byteLength > 0);
  assert.equal(artifact.result.filename, 'app-real-build-codex-pet-1.0.0.zip');
});

test('routes a real synthetic Clawd build through the App seam and returns a downloadable theme artifact', async () => {
  const project = createProject({
    projectId: 'app-real-clawd-build',
    name: 'App real Clawd build',
    source: { kind: 'synthetic', name: 'synthetic-source', fingerprint: 'c'.repeat(64) },
    targets: {
      clawd: {
        profile: 'clawd',
        mappings: {
          idle: 'motion:fixture-idle',
          thinking: 'motion:fixture-thinking',
          working: 'motion:fixture-working',
          sleeping: 'fallback:idle',
          attention: 'motion:fixture-attention',
        },
        reactions: { drag: 'motion:fixture-attention' },
        options: { sleepMode: 'direct' },
      },
    },
  });
  const frameSet = (seed) => ({
    frames: [0, 1].map((index) => ({
      id: `${seed}-${index}`,
      width: 2,
      height: 2,
      rgba: Uint8Array.from([seed.length, index, 0, 255, seed.length, index, 1, 255, seed.length, index, 2, 255, seed.length, index, 3, 255]),
    })),
    fps: 10,
  });
  const router = createAppIpcRouter({ mapperHostFactory: async () => fakeHost(), buildProjectService: buildProjectTargets });
  const response = await router({
    protocolVersion: 1,
    method: 'buildProject',
    args: [{
      project,
      targets: ['clawd'],
      inputsByTarget: { clawd: { framesByMotion: { 'fixture-idle': frameSet('idle'), 'fixture-thinking': frameSet('thinking'), 'fixture-working': frameSet('working'), 'fixture-attention': frameSet('attention') } } },
      metadataByTarget: { clawd: { id: 'app-real-clawd-build', name: 'App real Clawd build', description: 'Synthetic App Clawd integration build.', version: '1.0.0' } },
      optionsByTarget: { clawd: { package: true, render: { preset: 'compact' } } },
    }],
  });
  assert.equal(response.ok, true);
  assert.equal(response.result.targets[0], 'clawd');
  assert.equal(response.result.builds.clawd.validation.ok, true);
  assert.equal(response.result.builds.clawd.package.buffer, undefined);
  assert.equal(response.result.builds.clawd.manifest.states.sleeping.fallbackTo, 'idle');
  assert.equal(response.result.artifacts.length, 1);
  const artifact = await router({ protocolVersion: 1, method: 'getBuildArtifact', args: [{ artifactId: response.result.artifacts[0].artifactId }] });
  assert.equal(artifact.ok, true);
  assert.ok(artifact.result.bytes.byteLength > 0);
  assert.equal(artifact.result.filename, 'app-real-clawd-build-clawd-1.0.0.zip');
});

test('installs only a current artifact after explicit confirmation and redacts target paths', async () => {
  const calls = [];
  const router = createAppIpcRouter({
    mapperHostFactory: async () => fakeHost(),
    buildProjectService: async () => ({
      buildContractVersion: 1,
      projectId: 'app-install',
      targets: ['codex-pet'],
      warnings: [],
      builds: {
        'codex-pet': {
          target: 'codex-pet',
          package: { artifactName: 'app-install-codex-pet-1.0.0.zip', byteLength: 3, files: ['pet.json'], buffer: Uint8Array.from([1, 2, 3]) },
        },
      },
    }),
    installPackageService: async (input) => {
      calls.push(input);
      input.onProgress({ stage: 'commit', status: 'completed', target: input.target });
      if (input.conflict === 'cancel') {
        const error = new Error('An installation already exists.');
        error.code = 'INSTALL_CONFLICT';
        error.details = { path: '/Users/private/Library/Application Support/live2pet' };
        throw error;
      }
      return { protocolVersion: 1, target: input.target, packageId: 'app-install', conflict: input.conflict, files: ['pet.json'], byteLength: 3, path: '/Users/private/Library/Application Support/live2pet/app-install' };
    },
  });
  const built = await router({ protocolVersion: 1, method: 'buildProject', args: [{ project: { projectId: 'app-install' }, targets: ['codex-pet'] }] });
  const artifactId = built.result.artifacts[0].artifactId;
  const unauthorized = await router({ protocolVersion: 1, method: 'installArtifact', args: [{ artifactId, target: 'codex-pet', conflict: 'upgrade' }] });
  assert.equal(unauthorized.ok, false);
  assert.equal(unauthorized.error.code, 'INSTALL_AUTHORIZATION_REQUIRED');
  const conflict = await router({ protocolVersion: 1, method: 'installArtifact', args: [{ artifactId, target: 'codex-pet', conflict: 'cancel', confirmInstall: true }] });
  assert.equal(conflict.ok, false);
  assert.equal(conflict.error.code, 'INSTALL_CONFLICT');
  assert.equal(conflict.error.details.path, '<redacted-path>');
  const installed = await router({ protocolVersion: 1, method: 'installArtifact', args: [{ artifactId, target: 'codex-pet', conflict: 'upgrade', confirmInstall: true }] });
  assert.equal(installed.ok, true);
  assert.equal(installed.result.path, '<platform-default-target-root>');
  assert.equal(installed.result.packageId, 'app-install');
  assert.deepEqual(installed.progress, [{ stage: 'commit', status: 'completed', target: 'codex-pet' }]);
  assert.deepEqual(calls.map((input) => ({ target: input.target, conflict: input.conflict, bytes: [...input.packageBytes] })), [
    { target: 'codex-pet', conflict: 'cancel', bytes: [1, 2, 3] },
    { target: 'codex-pet', conflict: 'upgrade', bytes: [1, 2, 3] },
  ]);
  const mismatch = await router({ protocolVersion: 1, method: 'installArtifact', args: [{ artifactId, target: 'clawd', confirmInstall: true }] });
  assert.equal(mismatch.ok, false);
  assert.equal(mismatch.error.code, 'INSTALL_TARGET_MISMATCH');
});

test('retains the latest artifact for an unrelated target across builds', async () => {
  const router = createAppIpcRouter({
    mapperHostFactory: async () => fakeHost(),
    buildProjectService: async (input) => {
      const target = input.targets[0];
      return {
        projectId: 'app-multi-target',
        targets: [target],
        builds: {
          [target]: {
            target,
            package: { artifactName: `${target}.zip`, byteLength: 1, files: ['manifest.json'], buffer: Uint8Array.from([target.length]) },
          },
        },
      };
    },
  });
  const codex = await router({ protocolVersion: 1, method: 'buildProject', args: [{ project: {}, targets: ['codex-pet'] }] });
  const codexId = codex.result.artifacts[0].artifactId;
  const clawd = await router({ protocolVersion: 1, method: 'buildProject', args: [{ project: {}, targets: ['clawd'] }] });
  const clawdId = clawd.result.artifacts[0].artifactId;
  assert.equal((await router({ protocolVersion: 1, method: 'getBuildArtifact', args: [{ artifactId: codexId }] })).ok, true);
  assert.equal((await router({ protocolVersion: 1, method: 'getBuildArtifact', args: [{ artifactId: clawdId }] })).ok, true);
  const rebuiltCodex = await router({ protocolVersion: 1, method: 'buildProject', args: [{ project: {}, targets: ['codex-pet'] }] });
  assert.equal((await router({ protocolVersion: 1, method: 'getBuildArtifact', args: [{ artifactId: codexId }] })).error.code, 'BUILD_ARTIFACT_NOT_FOUND');
  assert.equal((await router({ protocolVersion: 1, method: 'getBuildArtifact', args: [{ artifactId: clawdId }] })).ok, true);
  assert.notEqual(rebuiltCodex.result.artifacts[0].artifactId, codexId);
});

test('preload exposes only typed methods and the window options keep Electron sandbox defaults', async () => {
  const calls = [];
  const api = createAppPreloadApi({ ipcRenderer: { invoke: async (...args) => (calls.push(args), { ok: true }) } });
  await api.getVersion();
  await api.startMapperSession({});
  await api.buildProject({ project: { projectId: 'app-fixture' } });
  await api.getBuildArtifact('fixture-artifact');
  await api.getBuildArtifact('fixture-artifact', 1024);
  await api.installArtifact({ artifactId: 'fixture-artifact', target: 'codex-pet', confirmInstall: true });
  await api.inspectSource({ inputPath: '/tmp/source' });
  await api.getRuntimeSettings();
  await api.configureRuntime({ inputPath: '/tmp/live2d.min.js' });
  await api.clearRuntimeSettings();
  assert.equal(calls[0][0], APP_IPC_CHANNEL);
  assert.deepEqual(calls[0][1], { protocolVersion: 1, method: 'getVersion', args: [] });
  assert.deepEqual(calls[1][1], { protocolVersion: 1, method: 'startMapperSession', args: [{}] });
  assert.deepEqual(calls[2][1], { protocolVersion: 1, method: 'buildProject', args: [{ project: { projectId: 'app-fixture' } }] });
  assert.deepEqual(calls[3][1], { protocolVersion: 1, method: 'getBuildArtifact', args: [{ artifactId: 'fixture-artifact', offset: 0 }] });
  assert.deepEqual(calls[4][1], { protocolVersion: 1, method: 'getBuildArtifact', args: [{ artifactId: 'fixture-artifact', offset: 1024 }] });
  assert.deepEqual(calls[5][1], { protocolVersion: 1, method: 'installArtifact', args: [{ artifactId: 'fixture-artifact', target: 'codex-pet', confirmInstall: true }] });
  assert.deepEqual(calls[6][1], { protocolVersion: 1, method: 'inspectSource', args: [{ inputPath: '/tmp/source' }] });
  assert.deepEqual(calls[7][1], { protocolVersion: 1, method: 'getRuntimeSettings', args: [] });
  assert.deepEqual(calls[8][1], { protocolVersion: 1, method: 'configureRuntime', args: [{ inputPath: '/tmp/live2d.min.js' }] });
  assert.deepEqual(calls[9][1], { protocolVersion: 1, method: 'clearRuntimeSettings', args: [] });
  assert.equal(Object.hasOwn(api, 'ipcRenderer'), false);
  const options = createAppWindowOptions({ preload: '/app/preload.cjs' });
  assert.equal(options.webPreferences.nodeIntegration, false);
  assert.equal(options.webPreferences.contextIsolation, true);
  assert.equal(options.webPreferences.sandbox, true);
  assert.equal(options.webPreferences.webviewTag, false);
});

test('preload onBuildProgress subscribes with a safe payload and supports idempotent cancellation', () => {
  const listeners = new Map();
  const removed = [];
  const api = createAppPreloadApi({
    ipcRenderer: {
      invoke: async () => ({ ok: true }),
      on: (channel, listener) => listeners.set(channel, listener),
      removeListener: (channel, listener) => { removed.push([channel, listener]); if (listeners.get(channel) === listener) listeners.delete(channel); },
    },
  });
  const received = [];
  const unsubscribe = api.onBuildProgress((event) => received.push(event));
  assert.equal(typeof unsubscribe, 'function');
  const handler = listeners.get(APP_BUILD_PROGRESS_CHANNEL);
  handler({ sender: 'hidden' }, { protocolVersion: 1, buildId: 'build-1', sequence: 1, stage: 'preview', status: 'completed', target: 'codex-pet', secret: 'drop-me', path: '/private/source' });
  handler({}, { protocolVersion: 2, buildId: 'build-1', sequence: 2, stage: 'package', status: 'started' });
  assert.equal(received.length, 1);
  assert.deepEqual(received[0], { protocolVersion: 1, buildId: 'build-1', sequence: 1, stage: 'preview', status: 'completed', target: 'codex-pet' });
  unsubscribe();
  unsubscribe();
  assert.equal(removed.length, 1);
  assert.equal(removed[0][0], APP_BUILD_PROGRESS_CHANNEL);
});

test('requires safe App window dimensions and a preload path', () => {
  assert.throws(() => createAppWindowOptions({ width: 100 }), (error) => error instanceof AppHostError && error.code === 'INVALID_APP_WINDOW');
  assert.throws(() => createAppWindowOptions({ preload: 'app://preload', height: 200 }), (error) => error instanceof AppHostError && error.code === 'INVALID_APP_WINDOW');
});
