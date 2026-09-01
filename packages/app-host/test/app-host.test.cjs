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
  RENDERER_PREVIEW_COMMANDS,
  AppHostError,
  createAppIpcRouter,
  createAppPreloadApi,
  createAppWindowOptions,
  normalizeCaptureCacheStatusRequest,
  normalizeInspectRequest,
  normalizeRuntimeRequest,
  normalizeSkillInstallRequest,
  normalizeRendererPreviewStartRequest,
  normalizeRendererLoadRequest,
  normalizeRendererCommandRequest,
  normalizeRendererSessionRequest,
  normalizeInstallRequest,
  normalizeInstallRootRequest,
  normalizeBuildProgressEvent,
  normalizeCancelBuildRequest,
  normalizeRequest,
  summarizeSkillStatus,
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
  assert.equal(APP_IPC_METHODS.includes('cancelBuild'), true);
  assert.equal(APP_IPC_METHODS.includes('getBuildArtifact'), true);
  assert.equal(APP_IPC_METHODS.includes('installArtifact'), true);
  assert.equal(APP_IPC_METHODS.includes('chooseInstallRoot'), true);
  assert.equal(APP_IPC_METHODS.includes('inspectSource'), true);
  assert.equal(APP_IPC_METHODS.includes('getSkillStatus'), true);
  assert.equal(APP_IPC_METHODS.includes('installSkill'), true);
  assert.equal(APP_IPC_METHODS.includes('startRendererPreview'), true);
  assert.deepEqual(RENDERER_PREVIEW_COMMANDS, ['playMotion', 'pause', 'resume', 'restart', 'setLoop', 'setSpeed', 'setExpression', 'step', 'getState', 'getBounds']);
  assert.deepEqual(normalizeInspectRequest({ inputPath: '/tmp/source', projectId: 'fixture' }), { inputPath: '/tmp/source', projectId: 'fixture' });
  assert.throws(() => normalizeInspectRequest({ inputPath: '/tmp/source', shell: true }), (error) => error instanceof AppHostError && error.code === 'INVALID_INSPECT_REQUEST');
  assert.deepEqual(normalizeRuntimeRequest({ inputPath: '/tmp/live2d.min.js' }), { inputPath: '/tmp/live2d.min.js' });
  assert.throws(() => normalizeRuntimeRequest({ inputPath: '/tmp/runtime', shell: true }), (error) => error instanceof AppHostError && error.code === 'INVALID_RUNTIME_REQUEST');
  assert.deepEqual(normalizeSkillInstallRequest({ confirmInstall: true }), { confirmInstall: true, overwrite: false });
  assert.deepEqual(normalizeSkillInstallRequest({ confirmInstall: true, overwrite: true }), { confirmInstall: true, overwrite: true });
  assert.throws(() => normalizeSkillInstallRequest({ overwrite: true }), (error) => error instanceof AppHostError && error.code === 'INSTALL_AUTHORIZATION_REQUIRED');
  assert.throws(() => normalizeSkillInstallRequest({ confirmInstall: true, path: '/tmp' }), (error) => error instanceof AppHostError && error.code === 'INVALID_SKILL_INSTALL_REQUEST');
  assert.deepEqual(normalizeCaptureCacheStatusRequest({ sourceFingerprint: 'a'.repeat(64), cubismVersion: 3, target: 'clawd', renderPreset: 'balanced', motions: [{ motionId: 'idle', duration: 1.2, width: 768, height: 768, frameCount: 29, fps: 24 }] }), { sourceFingerprint: 'a'.repeat(64), cubismVersion: 3, target: 'clawd', renderPreset: 'balanced', motions: [{ motionId: 'idle', expressionId: null, duration: 1.2, width: 768, height: 768, frameCount: 29, fps: 24 }] });
  assert.throws(() => normalizeCaptureCacheStatusRequest({ sourceFingerprint: 'not-a-digest', cubismVersion: 3, target: 'clawd', renderPreset: 'balanced', motions: [] }), (error) => error instanceof AppHostError && error.code === 'INVALID_CAPTURE_CACHE_REQUEST');
  assert.deepEqual(normalizeRendererPreviewStartRequest({ sourceRoot: '/tmp/source', cubismVersion: 2 }), { sourceRoot: '/tmp/source', cubismVersion: 2, width: 512, height: 512, show: true });
  assert.deepEqual(normalizeRendererPreviewStartRequest({ sourceRoot: '/tmp/source', cubismVersion: 4, modernAdapter: 'official', frameworkPath: '/tmp/live2pet-framework.js', frameworkGlobal: 'Live2Pet.bridge' }), { sourceRoot: '/tmp/source', cubismVersion: 4, width: 512, height: 512, show: true, modernAdapter: 'official', frameworkPath: '/tmp/live2pet-framework.js', frameworkGlobal: 'Live2Pet.bridge' });
  assert.throws(() => normalizeRendererPreviewStartRequest({ sourceRoot: '/tmp/source', cubismVersion: 4, modernAdapter: 'official' }), (error) => error instanceof AppHostError && error.code === 'OFFICIAL_FRAMEWORK_REQUIRED');
  assert.throws(() => normalizeRendererPreviewStartRequest({ sourceRoot: '/tmp/source', cubismVersion: 2, modernAdapter: 'official', frameworkPath: '/tmp/live2pet-framework.js' }), (error) => error instanceof AppHostError && error.code === 'INVALID_RENDERER_PREVIEW_REQUEST');
  assert.deepEqual(normalizeRendererLoadRequest({ sessionId: 'renderer-session', modelConfig: 'model.json', cubismVersion: 2, motions: [{ id: 'idle:0', group: 'idle', index: 0, duration: 1 }] }), { sessionId: 'renderer-session', source: { modelConfig: 'model.json', cubismVersion: 2, motions: [{ id: 'idle:0', name: 'idle:0', group: 'idle', index: 0, duration: 1 }], expressions: [] } });
  assert.deepEqual(normalizeRendererCommandRequest({ sessionId: 'renderer-session', method: 'playMotion', args: ['idle:0', { loop: true }] }), { sessionId: 'renderer-session', method: 'playMotion', args: ['idle:0', { loop: true }] });
  assert.deepEqual(normalizeRendererSessionRequest(undefined, { optional: true }), {});
  assert.throws(() => normalizeRendererCommandRequest({ sessionId: 'renderer-session', method: 'captureRgba', args: [] }), (error) => error instanceof AppHostError && error.code === 'INVALID_RENDERER_COMMAND');
  assert.deepEqual(normalizeInstallRequest({ artifactId: 'artifact', target: 'codex-pet', confirmInstall: true }), { artifactId: 'artifact', target: 'codex-pet', conflict: 'cancel', confirmInstall: true });
  assert.deepEqual(normalizeInstallRequest({ artifactId: 'artifact', target: 'codex-pet', locationId: '01234567-89ab-cdef-0123-456789abcdef', confirmInstall: true }), { artifactId: 'artifact', target: 'codex-pet', conflict: 'cancel', locationId: '01234567-89ab-cdef-0123-456789abcdef', confirmInstall: true });
  assert.deepEqual(normalizeInstallRootRequest({ target: 'clawd' }), { target: 'clawd' });
  assert.throws(() => normalizeInstallRootRequest({ target: 'codex-pet', path: '/tmp' }), (error) => error instanceof AppHostError && error.code === 'INVALID_INSTALL_ROOT_REQUEST');
  assert.throws(() => normalizeInstallRequest({ artifactId: 'artifact', target: 'codex-pet' }), (error) => error instanceof AppHostError && error.code === 'INSTALL_AUTHORIZATION_REQUIRED');
  assert.deepEqual(normalizeCancelBuildRequest({ buildId: 'build_1234' }), { buildId: 'build_1234' });
  assert.throws(() => normalizeCancelBuildRequest({ buildId: 'short' }), (error) => error instanceof AppHostError && error.code === 'INVALID_BUILD_CANCEL_REQUEST');
  assert.throws(() => normalizeCancelBuildRequest({ buildId: 'build_1234', extra: true }), (error) => error instanceof AppHostError && error.code === 'INVALID_BUILD_CANCEL_REQUEST');
});

test('routes a multi-runtime library without exposing App storage paths', async () => {
  const calls = [];
  const available = {
    schemaVersion: 2,
    configured: true,
    restartRequired: false,
    runtimes: [
      { runtimeName: 'live2d.min.js', sourceType: 'file', runtimeKind: 'legacy-cubism2', cubismGenerations: [2], fingerprint: 'a'.repeat(64), available: true },
      { runtimeName: 'live2dcubismcore.min.js', sourceType: 'file', runtimeKind: 'modern-cubism-core', cubismGenerations: [3, 4, 5], fingerprint: 'b'.repeat(64), available: true },
    ],
  };
  const router = createAppIpcRouter({
    runtimeSettingsService: {
      get: async () => available,
      configure: async (input) => { calls.push(input); return available; },
      clear: async () => ({ schemaVersion: 2, configured: false, restartRequired: false, runtimes: [] }),
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
  assert.deepEqual(cleared.result, { schemaVersion: 2, configured: false, restartRequired: false, runtimes: [] });
  const malformed = await router({ protocolVersion: 1, method: 'configureRuntime', args: [{ inputPath: '/tmp/runtime', extra: true }] });
  assert.equal(malformed.ok, false);
  assert.equal(malformed.error.code, 'INVALID_RUNTIME_REQUEST');
});

test('rejects runtime services that return raw paths or incomplete metadata', async () => {
  const incomplete = createAppIpcRouter({ runtimeSettingsService: { get: async () => ({}), configure: async () => ({}), clear: async () => ({}) } });
  const incompleteResponse = await incomplete({ protocolVersion: 1, method: 'getRuntimeSettings', args: [] });
  assert.equal(incompleteResponse.ok, false);
  assert.equal(incompleteResponse.error.code, 'INVALID_RUNTIME_RESULT');
  const router = createAppIpcRouter({ runtimeSettingsService: { get: async () => ({ schemaVersion: 2, configured: true, restartRequired: false, runtimes: [{ runtimePath: '/tmp/runtime' }] }), configure: async () => ({}), clear: async () => ({ schemaVersion: 2, configured: false, restartRequired: false, runtimes: [] }) } });
  const response = await router({ protocolVersion: 1, method: 'getRuntimeSettings', args: [] });
  assert.equal(response.ok, false);
  assert.equal(response.error.code, 'INVALID_RUNTIME_RESULT');
});

test('routes skill status and explicit installation without exposing skill paths', async () => {
  const calls = [];
  const skillStatus = {
    skillId: 'live2pet',
    path: '/Users/private/.codex/skills/live2pet',
    upToDate: false,
    source: { available: true, valid: true, path: '/workspace/skills/live2pet', files: ['SKILL.md', 'agents/openai.yaml'], byteLength: 42, sha256: 'a'.repeat(64) },
    installed: { exists: true, valid: true, path: '/Users/private/.codex/skills/live2pet', files: ['SKILL.md'], byteLength: 20, sha256: 'b'.repeat(64) },
  };
  const router = createAppIpcRouter({
    skillService: {
      get: async () => skillStatus,
      install: async (input) => {
        calls.push(input);
        input.onProgress({ stage: 'stage', status: 'completed', files: 2, path: '/private/skill' });
        input.onProgress({ stage: 'commit', status: 'completed', upgraded: true });
        return { skillId: 'live2pet', path: '/Users/private/.codex/skills/live2pet', files: ['SKILL.md', 'agents/openai.yaml'], byteLength: 42, sha256: 'a'.repeat(64), upgraded: true };
      },
    },
  });
  const current = await router({ protocolVersion: 1, method: 'getSkillStatus', args: [] });
  assert.equal(current.ok, true);
  assert.deepEqual(current.result, {
    schemaVersion: 1,
    skillId: 'live2pet',
    upToDate: false,
    source: { available: true, valid: true, fileCount: 2, byteLength: 42, sha256: 'a'.repeat(64) },
    installed: { exists: true, valid: true, fileCount: 1, byteLength: 20, sha256: 'b'.repeat(64) },
  });
  assert.equal(JSON.stringify(current).includes('/Users/private'), false);
  const unauthorized = await router({ protocolVersion: 1, method: 'installSkill', args: [{ overwrite: true }] });
  assert.equal(unauthorized.ok, false);
  assert.equal(unauthorized.error.code, 'INSTALL_AUTHORIZATION_REQUIRED');
  const installed = await router({ protocolVersion: 1, method: 'installSkill', args: [{ confirmInstall: true, overwrite: true }] });
  assert.equal(installed.ok, true);
  assert.deepEqual(installed.progress, [
    { stage: 'stage', status: 'completed', files: 2 },
    { stage: 'commit', status: 'completed', upgraded: true },
    { stage: 'skill', status: 'completed' },
  ]);
  assert.deepEqual(installed.result, { schemaVersion: 1, skillId: 'live2pet', fileCount: 2, byteLength: 42, sha256: 'a'.repeat(64), upgraded: true });
  assert.equal(JSON.stringify(installed).includes('/Users/private'), false);
  assert.equal(calls.length, 1);
  assert.deepEqual({ confirmInstall: calls[0].confirmInstall, overwrite: calls[0].overwrite }, { confirmInstall: true, overwrite: true });
  assert.equal(typeof calls[0].onProgress, 'function');
  assert.deepEqual(summarizeSkillStatus(skillStatus).source, current.result.source);
  const invalidArgs = await router({ protocolVersion: 1, method: 'getSkillStatus', args: [{}] });
  assert.equal(invalidArgs.ok, false);
  assert.equal(invalidArgs.error.code, 'INVALID_SKILL_REQUEST');
  const unavailableRouter = createAppIpcRouter({ skillService: { get: async () => ({ skillId: 'live2pet', upToDate: false, source: { available: false, valid: false, error: { code: 'SKILL_NOT_FOUND', message: 'Missing /Users/private/skills/live2pet' } }, installed: { exists: false, valid: false, files: [], byteLength: 0, sha256: null } }), install: async () => ({}) } });
  const unavailable = await unavailableRouter({ protocolVersion: 1, method: 'getSkillStatus', args: [] });
  assert.equal(unavailable.ok, true);
  assert.deepEqual(unavailable.result.source, { available: false, valid: false, fileCount: 0, byteLength: 0, sha256: null, error: { code: 'SKILL_NOT_FOUND', message: 'Missing <redacted-path>' } });
});

test('routes bounded capture cache status without exposing local paths', async () => {
  const calls = [];
  const router = createAppIpcRouter({
    captureCacheService: {
      status: async (input) => {
        calls.push(input);
        return { schemaVersion: 1, target: input.target, renderPreset: input.renderPreset, runtimeAvailable: true, entries: [{ motionId: input.motions[0].motionId, key: 'b'.repeat(64), hit: true, byteLength: 1234 }] };
      },
    },
  });
  const response = await router({ protocolVersion: 1, method: 'getCaptureCacheStatus', args: [{ sourceFingerprint: 'a'.repeat(64), cubismVersion: 4, target: 'clawd', renderPreset: 'balanced', motions: [{ motionId: 'idle', expressionId: 'smile', duration: 1.2, width: 768, height: 768, frameCount: 29, fps: 24 }] }] });
  assert.equal(response.ok, true);
  assert.deepEqual(response.result.entries[0], { motionId: 'idle', key: 'b'.repeat(64), hit: true, byteLength: 1234 });
  assert.equal(JSON.stringify(response).includes('/Users/'), false);
  assert.equal(calls[0].motions[0].motionId, 'idle');
  assert.equal(calls[0].motions[0].expressionId, 'smile');
  const unavailable = await createAppIpcRouter()({ protocolVersion: 1, method: 'getCaptureCacheStatus', args: [{ sourceFingerprint: 'a'.repeat(64), cubismVersion: 4, target: 'clawd', renderPreset: 'balanced', motions: [{ motionId: 'idle', duration: 1.2, width: 768, height: 768, frameCount: 29, fps: 24 }] }] });
  assert.equal(unavailable.ok, false);
  assert.equal(unavailable.error.code, 'APP_CAPTURE_CACHE_UNAVAILABLE');
});

test('persists one completed capture through the bounded cache IPC seam', async () => {
  const calls = [];
  const router = createAppIpcRouter({
    captureCacheService: {
      status: async () => ({ schemaVersion: 1, target: 'clawd', renderPreset: 'balanced', runtimeAvailable: true, entries: [] }),
      write: async (context, recipe, frameSet) => {
        calls.push({ context, recipe, frameSet });
        return { stored: true, key: 'c'.repeat(64), byteLength: 321 };
      },
    },
  });
  const request = {
    sourceFingerprint: 'a'.repeat(64), cubismVersion: 4, target: 'clawd', renderPreset: 'balanced',
    recipe: { motionId: 'idle', expressionId: null, duration: 1.2, width: 2, height: 2, frameCount: 1, fps: 24 },
    frameSet: {
      motionId: 'idle', expressionId: null,
      frames: [{ id: 'idle-0', width: 2, height: 2 }],
      rgbaChunks: [{ width: 2, height: 2, startFrame: 0, frameCount: 1, compression: 'deflate-stack-v1', rgbaDeflate: Uint8Array.from([1, 2, 3]) }],
      delay: [42],
    },
  };
  const response = await router({ protocolVersion: 1, method: 'putCaptureCache', args: [request] });
  assert.equal(response.ok, true);
  assert.deepEqual(response.result, { stored: true, key: 'c'.repeat(64), byteLength: 321 });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].context.sourceFingerprint, 'a'.repeat(64));
  assert.equal(calls[0].recipe.motionId, 'idle');
  assert.equal(calls[0].frameSet.rgbaChunks[0].rgbaDeflate.byteLength, 3);
});

test('routes an isolated renderer preview without exposing source paths or binary commands', async () => {
  const calls = [];
  const rendererPreviewService = {
    start: async (input) => { calls.push(['start', input]); return { protocolVersion: 1, sessionId: 'renderer-session', kind: 'legacy-cubism2', cubismVersion: 2, status: { state: 'ready', generation: 1, hasWindow: true, hasRenderer: true } }; },
    loadSource: async (input) => { calls.push(['loadSource', input]); return { protocolVersion: 1, sessionId: input.sessionId, result: { contractVersion: 1, motionCount: input.source.motions.length, expressionCount: 0 } }; },
    command: async (input) => { calls.push(['command', input]); return { protocolVersion: 1, sessionId: input.sessionId, result: input.method === 'getState' ? { loaded: true, motionId: 'idle:0', time: 0 } : true }; },
    status: async () => ({ protocolVersion: 1, active: true, sessionId: 'renderer-session', kind: 'legacy-cubism2', cubismVersion: 2, status: { state: 'ready', generation: 1, hasWindow: true, hasRenderer: true } }),
    restart: async (input) => { calls.push(['restart', input]); return { protocolVersion: 1, sessionId: input.sessionId, status: { state: 'ready', generation: 2, hasWindow: true, hasRenderer: true } }; },
    close: async (input) => { calls.push(['close', input]); return { protocolVersion: 1, closed: true, sessionId: input.sessionId || 'renderer-session' }; },
  };
  const router = createAppIpcRouter({ rendererPreviewService });
  const started = await router({ protocolVersion: 1, method: 'startRendererPreview', args: [{ sourceRoot: '/Users/RY/Downloads/model', cubismVersion: 2 }] });
  assert.equal(started.ok, true);
  assert.equal(started.result.sessionId, 'renderer-session');
  assert.equal(JSON.stringify(started).includes('/Users/RY/Downloads'), false);
  const loaded = await router({ protocolVersion: 1, method: 'loadRendererSource', args: [{ sessionId: 'renderer-session', modelConfig: 'model.json', cubismVersion: 2, motions: [{ id: 'idle:0', group: 'idle', index: 0, duration: 1 }], expressions: [] }] });
  assert.equal(loaded.ok, true);
  const state = await router({ protocolVersion: 1, method: 'rendererCommand', args: [{ sessionId: 'renderer-session', method: 'getState', args: [] }] });
  assert.deepEqual(state.result.result, { loaded: true, motionId: 'idle:0', time: 0 });
  const status = await router({ protocolVersion: 1, method: 'getRendererPreviewStatus', args: [] });
  assert.equal(status.result.active, true);
  const restarted = await router({ protocolVersion: 1, method: 'restartRendererPreview', args: [{ sessionId: 'renderer-session' }] });
  assert.equal(restarted.result.status.generation, 2);
  const closed = await router({ protocolVersion: 1, method: 'closeRendererPreview', args: [] });
  assert.equal(closed.result.closed, true);
  assert.deepEqual(calls.map(([method]) => method), ['start', 'loadSource', 'command', 'restart', 'close']);
});

test('keeps renderer preview IPC unavailable until the Desktop service is explicitly wired', async () => {
  const router = createAppIpcRouter();
  const response = await router({ protocolVersion: 1, method: 'startRendererPreview', args: [{ sourceRoot: '/tmp/source', cubismVersion: 2 }] });
  assert.equal(response.ok, false);
  assert.equal(response.error.code, 'APP_RENDERER_PREVIEW_UNAVAILABLE');
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

test('cancels an active build by opaque id and preserves the previous artifact', async () => {
  const events = [];
  let buildCount = 0;
  let entered;
  const enteredPromise = new Promise((resolve) => { entered = resolve; });
  const router = createAppIpcRouter({
    onBuildProgress: (event) => {
      events.push(event);
      if (event.stage === 'validate') entered();
    },
    buildProjectService: async (input) => {
      buildCount += 1;
      if (buildCount === 1) {
        return {
          projectId: 'cancel-fixture',
          targets: ['clawd'],
          builds: {
            clawd: {
              target: 'clawd',
              package: { artifactName: 'cancel-fixture.zip', byteLength: 3, files: ['theme.json'], buffer: Uint8Array.from([1, 2, 3]) },
            },
          },
        };
      }
      input.onProgress({ target: 'clawd', stage: 'validate', status: 'started' });
      await new Promise((resolve, reject) => {
        input.signal.addEventListener('abort', () => reject(Object.assign(new Error('cancelled'), { code: 'BUILD_CANCELLED' })), { once: true });
      });
      return { projectId: 'cancel-fixture', targets: ['clawd'], builds: {} };
    },
  });
  const first = await router({ protocolVersion: 1, method: 'buildProject', args: [{ project: { projectId: 'cancel-fixture' }, targets: ['clawd'] }] });
  assert.equal(first.ok, true);
  const previousArtifactId = first.result.artifacts[0].artifactId;

  const pending = router({ protocolVersion: 1, method: 'buildProject', args: [{ project: { projectId: 'cancel-fixture' }, targets: ['clawd'] }] });
  await enteredPromise;
  const buildId = events.at(-1).buildId;
  assert.match(buildId, /^[A-Za-z0-9_-]{8,128}$/);
  const cancelled = await router({ protocolVersion: 1, method: 'cancelBuild', args: [{ buildId }] });
  assert.deepEqual(cancelled.result, { buildId, cancelled: true, active: true });
  const result = await pending;
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'BUILD_CANCELLED');
  assert.equal((await router({ protocolVersion: 1, method: 'getBuildArtifact', args: [{ artifactId: previousArtifactId }] })).ok, true);
  const stale = await router({ protocolVersion: 1, method: 'cancelBuild', args: [{ buildId }] });
  assert.deepEqual(stale.result, { buildId, cancelled: false, active: false });
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

test('keeps a native install-folder choice behind an opaque location id', async () => {
  const calls = [];
  const router = createAppIpcRouter({
    installRootPickerService: async (input) => {
      assert.deepEqual(input, { target: 'codex-pet' });
      return { path: '/Users/private/Downloads/live2pet-pets' };
    },
    buildProjectService: async () => ({
      projectId: 'app-selected-root',
      targets: ['codex-pet'],
      builds: { 'codex-pet': { target: 'codex-pet', package: { artifactName: 'selected-root.zip', byteLength: 1, files: ['pet.json'], buffer: Uint8Array.from([7]) } } },
    }),
    installPackageService: async (input) => {
      calls.push(input);
      return { protocolVersion: 1, target: input.target, packageId: 'selected-root', conflict: 'none', files: ['pet.json'], byteLength: 1, path: input.targetRoot };
    },
  });
  const chosen = await router({ protocolVersion: 1, method: 'chooseInstallRoot', args: [{ target: 'codex-pet' }] });
  assert.equal(chosen.ok, true);
  assert.equal(chosen.result.target, 'codex-pet');
  assert.equal(chosen.result.cancelled, false);
  assert.match(chosen.result.locationId, /^[0-9a-f-]{36}$/);
  assert.equal(JSON.stringify(chosen).includes('/Users/private'), false);
  const built = await router({ protocolVersion: 1, method: 'buildProject', args: [{ project: { projectId: 'app-selected-root' }, targets: ['codex-pet'] }] });
  const artifactId = built.result.artifacts[0].artifactId;
  const installed = await router({ protocolVersion: 1, method: 'installArtifact', args: [{ artifactId, target: 'codex-pet', locationId: chosen.result.locationId, confirmInstall: true }] });
  assert.equal(installed.ok, true);
  assert.equal(installed.result.path, '<selected-install-root>');
  assert.equal(calls[0].targetRoot, '/Users/private/Downloads/live2pet-pets');
  await router({ protocolVersion: 1, method: 'closeMapperSession', args: [] });
  const expired = await router({ protocolVersion: 1, method: 'installArtifact', args: [{ artifactId, target: 'codex-pet', locationId: chosen.result.locationId, confirmInstall: true }] });
  assert.equal(expired.ok, false);
  assert.equal(expired.error.code, 'BUILD_ARTIFACT_NOT_FOUND');
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
  const api = createAppPreloadApi({
    ipcRenderer: { invoke: async (...args) => (calls.push(args), { ok: true }) },
    getFilePath: () => '/tmp/source/model3.json',
  });
  assert.equal(api.getFilePath({ name: 'model3.json' }), '/tmp/source/model3.json');
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
  await api.startRendererPreview({ sourceRoot: '/tmp/source', cubismVersion: 2 });
  await api.loadRendererSource({ sessionId: 'renderer-session', modelConfig: 'model.json', cubismVersion: 2, motions: [] });
  await api.rendererCommand({ sessionId: 'renderer-session', method: 'getState', args: [] });
  await api.getRendererPreviewStatus();
  await api.restartRendererPreview('renderer-session');
  await api.closeRendererPreview('renderer-session');
  await api.chooseInstallRoot('clawd');
  await api.getSkillStatus();
  await api.installSkill({ confirmInstall: true, overwrite: true });
  await api.cancelBuild('build_1234');
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
  assert.deepEqual(calls[10][1], { protocolVersion: 1, method: 'startRendererPreview', args: [{ sourceRoot: '/tmp/source', cubismVersion: 2 }] });
  assert.deepEqual(calls[11][1], { protocolVersion: 1, method: 'loadRendererSource', args: [{ sessionId: 'renderer-session', modelConfig: 'model.json', cubismVersion: 2, motions: [] }] });
  assert.deepEqual(calls[12][1], { protocolVersion: 1, method: 'rendererCommand', args: [{ sessionId: 'renderer-session', method: 'getState', args: [] }] });
  assert.deepEqual(calls[13][1], { protocolVersion: 1, method: 'getRendererPreviewStatus', args: [] });
  assert.deepEqual(calls[14][1], { protocolVersion: 1, method: 'restartRendererPreview', args: [{ sessionId: 'renderer-session' }] });
  assert.deepEqual(calls[15][1], { protocolVersion: 1, method: 'closeRendererPreview', args: [{ sessionId: 'renderer-session' }] });
  assert.deepEqual(calls[16][1], { protocolVersion: 1, method: 'chooseInstallRoot', args: [{ target: 'clawd' }] });
  assert.deepEqual(calls[17][1], { protocolVersion: 1, method: 'getSkillStatus', args: [] });
  assert.deepEqual(calls[18][1], { protocolVersion: 1, method: 'installSkill', args: [{ confirmInstall: true, overwrite: true }] });
  assert.deepEqual(calls[19][1], { protocolVersion: 1, method: 'cancelBuild', args: [{ buildId: 'build_1234' }] });
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
