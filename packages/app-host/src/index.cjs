const crypto = require('node:crypto');

const { MapperSessionError, startMapperSessionHost } = require('../../mapper-session/src/index.cjs');
const { installPackage } = require('../../installation/src/index.cjs');

const APP_IPC_PROTOCOL_VERSION = 1;
const APP_IPC_CHANNEL = 'live2pet:app';
const APP_BUILD_PROGRESS_CHANNEL = 'live2pet:build-progress';
const BUILD_PROGRESS_FIELDS = Object.freeze([
  'target',
  'stage',
  'status',
  'motionId',
  'name',
  'width',
  'height',
  'samples',
  'duration',
  'total',
  'completed',
  'index',
  'frameCount',
  'concurrency',
  'percent',
  'fraction',
  'message',
  'error',
  'motions',
  'assets',
  'states',
  'reactions',
  'rows',
  'cells',
  'occupiedCells',
  'transparentCells',
  'cache',
  'cacheHits',
  'cacheMisses',
  'ready',
  'missingStates',
  'missingReactions',
  'format',
  'byteLength',
  'packageByteLength',
  'previewReady',
]);
const APP_IPC_METHODS = Object.freeze([
  'getVersion',
  'startMapperSession',
  'getMapperProject',
  'updateMapperProject',
  'buildProject',
  'getBuildArtifact',
  'installArtifact',
  'closeMapperSession',
]);

class AppHostError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'AppHostError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details = {}) {
  throw new AppHostError(code, message, details);
}

function isRecord(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function sanitizeBuildProgressValue(value, depth = 0) {
  if (typeof value === 'string') {
    if (/^(?:\/|[A-Za-z]:[\\/]|\\\\)/.test(value)) return '<redacted-path>';
    return value.slice(0, 256);
  }
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'boolean') return value;
  if (depth >= 1 || !Array.isArray(value) || value.length > 64) return undefined;
  const normalized = value.map((item) => sanitizeBuildProgressValue(item, depth + 1));
  return normalized.every((item) => item !== undefined) ? normalized : undefined;
}

/**
 * Keep build progress binary-free, bounded, and independent from arbitrary
 * values supplied by a build service before crossing the App boundary.
 */
function normalizeBuildProgressEvent(event) {
  if (!isRecord(event)) return null;
  const normalized = {};
  for (const key of BUILD_PROGRESS_FIELDS) {
    if (!Object.hasOwn(event, key)) continue;
    const value = sanitizeBuildProgressValue(event[key]);
    if (value !== undefined) normalized[key] = value;
  }
  if (typeof normalized.stage !== 'string' || !normalized.stage.trim()) return null;
  if (typeof normalized.status !== 'string' || !normalized.status.trim()) return null;
  normalized.stage = normalized.stage.trim().slice(0, 64);
  normalized.status = normalized.status.trim().slice(0, 64);
  return normalized;
}

function normalizeBuildProgressPayload(payload) {
  if (!isRecord(payload)) return null;
  if (payload.protocolVersion !== APP_IPC_PROTOCOL_VERSION || typeof payload.buildId !== 'string' || !payload.buildId.trim() || !Number.isInteger(payload.sequence) || payload.sequence < 1) return null;
  const event = normalizeBuildProgressEvent(payload);
  if (!event) return null;
  return { protocolVersion: APP_IPC_PROTOCOL_VERSION, buildId: payload.buildId.trim().slice(0, 128), sequence: payload.sequence, ...event };
}

function normalizeBuildRequest(value) {
  if (!isRecord(value)) fail('INVALID_BUILD_REQUEST', 'App Package Build input must be an object.');
  const allowed = new Set(['project', 'inputsByTarget', 'targets', 'metadataByTarget', 'optionsByTarget']);
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length) fail('INVALID_BUILD_REQUEST', `App Package Build input contains unsupported fields: ${unknown.join(', ')}.`);
  if (!isRecord(value.project)) fail('INVALID_BUILD_REQUEST', 'App Package Build input requires a project object.');
  if (value.inputsByTarget !== undefined && !isRecord(value.inputsByTarget)) fail('INVALID_BUILD_REQUEST', 'inputsByTarget must be an object keyed by Target Profile.');
  if (value.targets !== undefined && (!Array.isArray(value.targets) || value.targets.some((target) => typeof target !== 'string' || !target.trim()))) fail('INVALID_BUILD_REQUEST', 'targets must be an array of non-empty Target Profile ids.');
  if (value.metadataByTarget !== undefined && !isRecord(value.metadataByTarget)) fail('INVALID_BUILD_REQUEST', 'metadataByTarget must be an object keyed by Target Profile.');
  if (value.optionsByTarget !== undefined && !isRecord(value.optionsByTarget)) fail('INVALID_BUILD_REQUEST', 'optionsByTarget must be an object keyed by Target Profile.');
  return {
    project: value.project,
    inputsByTarget: value.inputsByTarget || {},
    ...(value.targets ? { targets: [...value.targets] } : {}),
    metadataByTarget: value.metadataByTarget || {},
    optionsByTarget: value.optionsByTarget || {},
  };
}

function normalizeInstallRequest(value) {
  if (!isRecord(value)) fail('INVALID_INSTALL_REQUEST', 'App installation input must be an object.');
  const allowed = new Set(['artifactId', 'target', 'conflict', 'confirmInstall']);
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length) fail('INVALID_INSTALL_REQUEST', `App installation input contains unsupported fields: ${unknown.join(', ')}.`);
  if (typeof value.artifactId !== 'string' || !value.artifactId.trim()) fail('INVALID_INSTALL_REQUEST', 'App installation input requires an artifactId.');
  if (!['clawd', 'codex-pet'].includes(value.target)) fail('INVALID_INSTALL_REQUEST', 'App installation target must be clawd or codex-pet.');
  if (value.conflict !== undefined && !['cancel', 'upgrade', 'side-by-side'].includes(value.conflict)) fail('INVALID_INSTALL_REQUEST', 'App installation conflict must be cancel, upgrade, or side-by-side.');
  if (value.confirmInstall !== true) fail('INSTALL_AUTHORIZATION_REQUIRED', 'Installing a package requires explicit confirmation.');
  return {
    artifactId: value.artifactId.trim(),
    target: value.target,
    conflict: value.conflict || 'cancel',
    confirmInstall: true,
  };
}

function summarizeBuild(build = {}) {
  const packageInfo = build.package ? {
    format: build.package.format,
    byteLength: build.package.byteLength,
    files: Array.isArray(build.package.files) ? [...build.package.files] : [],
    ...(build.package.artifactName ? { artifactName: build.package.artifactName } : {}),
  } : null;
  const atlas = build.atlas && typeof build.atlas === 'object' ? Object.fromEntries(Object.entries(build.atlas).filter(([key, value]) => key !== 'rgba' && !ArrayBuffer.isView(value) && !(value instanceof ArrayBuffer))) : undefined;
  return {
    ...(build.buildContractVersion !== undefined ? { buildContractVersion: build.buildContractVersion } : {}),
    target: build.target,
    ...(build.targetContractVersion !== undefined ? { targetContractVersion: build.targetContractVersion } : {}),
    ...(build.themeId ? { themeId: build.themeId } : {}),
    ...(build.artifactName ? { artifactName: build.artifactName } : {}),
    manifest: build.manifest || null,
    assets: Array.isArray(build.assets) ? build.assets : [],
    validation: build.validation || null,
    encoding: build.encoding || null,
    provenance: build.provenance || null,
    preview: build.preview || null,
    cache: build.cache || null,
    report: build.report || null,
    ...(atlas ? { atlas } : {}),
    package: packageInfo,
  };
}

function summarizeBuildTargets(built = {}) {
  return {
    ...(built.buildContractVersion !== undefined ? { buildContractVersion: built.buildContractVersion } : {}),
    projectId: built.projectId,
    targets: Array.isArray(built.targets) ? [...built.targets] : [],
    builds: Object.fromEntries(Object.entries(built.builds || {}).map(([target, build]) => [target, summarizeBuild(build)])),
    warnings: Array.isArray(built.warnings) ? built.warnings : [],
  };
}

function collectBuildArtifacts(built = {}) {
  const artifacts = [];
  for (const [target, build] of Object.entries(built.builds || {})) {
    const value = build && build.package && build.package.buffer;
    if (!value || !(Buffer.isBuffer(value) || value instanceof Uint8Array || value instanceof ArrayBuffer)) continue;
    const bytes = Buffer.from(value);
    if (!bytes.length) continue;
    artifacts.push({
      artifactId: crypto.randomUUID(),
      target,
      filename: build.package.artifactName || build.artifactName || `${target}.zip`,
      byteLength: bytes.byteLength,
      bytes,
    });
  }
  return artifacts;
}

function summarizeInstall(result = {}) {
  return {
    protocolVersion: result.protocolVersion,
    target: result.target,
    packageId: result.packageId,
    conflict: result.conflict,
    files: Array.isArray(result.files) ? [...result.files] : [],
    byteLength: result.byteLength,
    path: '<platform-default-target-root>',
  };
}

function normalizeRequest(request) {
  if (!request || typeof request !== 'object' || Array.isArray(request)) fail('INVALID_APP_REQUEST', 'App IPC request must be an object.');
  if (request.protocolVersion !== APP_IPC_PROTOCOL_VERSION) fail('UNSUPPORTED_APP_PROTOCOL', 'App IPC protocol version is not supported.');
  if (!APP_IPC_METHODS.includes(request.method)) fail('UNKNOWN_APP_METHOD', `App method is not allowed: ${String(request.method)}.`);
  const args = request.args == null ? [] : request.args;
  if (!Array.isArray(args) || args.length > 4) fail('INVALID_APP_REQUEST', 'App IPC args must be an array with at most four items.');
  return { protocolVersion: APP_IPC_PROTOCOL_VERSION, method: request.method, args };
}

function typedError(error) {
  const redactedKeys = new Set(['path', 'targetRoot', 'destination']);
  const details = error && error.details && typeof error.details === 'object'
    ? Object.fromEntries(Object.entries(error.details).map(([key, value]) => [key, redactedKeys.has(key) ? '<redacted-path>' : value]))
    : undefined;
  return {
    code: error && error.code ? error.code : 'APP_COMMAND_FAILED',
    message: error && error.message ? error.message : String(error),
    ...(details ? { details } : {}),
  };
}

function createAppIpcRouter({ mapperHostFactory = startMapperSessionHost, buildProjectService = null, installPackageService = null, onBuildProgress = null, appVersion = '0.1.0' } = {}) {
  if (typeof mapperHostFactory !== 'function') fail('INVALID_APP_ROUTER', 'mapperHostFactory must be a function.');
  if (buildProjectService !== null && typeof buildProjectService !== 'function') fail('INVALID_APP_ROUTER', 'buildProjectService must be a function when provided.');
  if (installPackageService !== null && typeof installPackageService !== 'function') fail('INVALID_APP_ROUTER', 'installPackageService must be a function when provided.');
  if (onBuildProgress !== null && typeof onBuildProgress !== 'function') fail('INVALID_APP_ROUTER', 'onBuildProgress must be a function when provided.');
  if (typeof appVersion !== 'string' || !appVersion.trim()) fail('INVALID_APP_ROUTER', 'appVersion must be a non-empty string.');
  let activeHost = null;
  let activeClient = null;
  let buildArtifacts = new Map();

  const closeActive = async () => {
    if (!activeHost) {
      buildArtifacts = new Map();
      return { closed: false };
    }
    const host = activeHost;
    activeHost = null;
    activeClient = null;
    buildArtifacts = new Map();
    await host.close();
    return { closed: true, sessionId: host.sessionId };
  };

  return async (request) => {
    try {
      const normalized = normalizeRequest(request);
      if (normalized.method === 'getVersion') return { protocolVersion: APP_IPC_PROTOCOL_VERSION, ok: true, result: { appVersion, protocolVersion: APP_IPC_PROTOCOL_VERSION, methods: [...APP_IPC_METHODS] } };
      if (normalized.method === 'startMapperSession') {
        if (activeHost) fail('MAPPER_SESSION_ACTIVE', 'A Mapper Session is already active. Close it before starting another session.');
        const [options = {}] = normalized.args;
        if (!options || typeof options !== 'object' || Array.isArray(options)) fail('INVALID_MAPPER_SESSION_OPTIONS', 'Mapper Session options must be an object.');
        const host = await mapperHostFactory(options);
        if (!host || typeof host.getLaunchDescriptor !== 'function' || typeof host.getClient !== 'function' || typeof host.close !== 'function') fail('INVALID_MAPPER_HOST', 'Mapper host must expose a launch descriptor, client, and close method.');
        activeHost = host;
        activeClient = host.getClient();
        return { protocolVersion: APP_IPC_PROTOCOL_VERSION, ok: true, result: host.getLaunchDescriptor() };
      }
      if (normalized.method === 'getMapperProject') {
        if (!activeClient) fail('MAPPER_SESSION_REQUIRED', 'Start a Mapper Session before reading its project.');
        return { protocolVersion: APP_IPC_PROTOCOL_VERSION, ok: true, result: await activeClient.getProject() };
      }
      if (normalized.method === 'updateMapperProject') {
        if (!activeClient) fail('MAPPER_SESSION_REQUIRED', 'Start a Mapper Session before updating its project.');
        const [project] = normalized.args;
        return { protocolVersion: APP_IPC_PROTOCOL_VERSION, ok: true, result: await activeClient.updateProject(project) };
      }
      if (normalized.method === 'buildProject') {
        if (!buildProjectService) fail('APP_BUILD_UNAVAILABLE', 'The App Package Build service is not configured.');
        const input = normalizeBuildRequest(normalized.args[0]);
        const buildTargets = input.targets || ['clawd', 'codex-pet'];
        for (const [artifactId, artifact] of buildArtifacts) {
          if (buildTargets.includes(artifact.target)) buildArtifacts.delete(artifactId);
        }
        const progress = [];
        const buildId = crypto.randomUUID();
        let sequence = 0;
        const emitBuildProgress = (event) => {
          const safeEvent = normalizeBuildProgressEvent(event);
          if (!safeEvent) return;
          progress.push(safeEvent);
          if (onBuildProgress) {
            try {
              onBuildProgress({ protocolVersion: APP_IPC_PROTOCOL_VERSION, buildId, sequence: ++sequence, ...safeEvent });
            } catch {
              // Progress delivery is best-effort and must never fail a build.
            }
          }
        };
        const built = await buildProjectService({ ...input, onProgress: emitBuildProgress });
        const artifacts = collectBuildArtifacts(built);
        for (const artifact of artifacts) {
          for (const [artifactId, previous] of buildArtifacts) {
            if (previous.target === artifact.target) buildArtifacts.delete(artifactId);
          }
          buildArtifacts.set(artifact.artifactId, artifact);
        }
        return {
          protocolVersion: APP_IPC_PROTOCOL_VERSION,
          ok: true,
          progress,
          result: {
            ...summarizeBuildTargets(built),
            artifacts: artifacts.map(({ bytes, ...metadata }) => metadata),
          },
        };
      }
      if (normalized.method === 'getBuildArtifact') {
        const [request = {}] = normalized.args;
        if (!isRecord(request) || typeof request.artifactId !== 'string' || !request.artifactId.trim()) fail('INVALID_BUILD_ARTIFACT_REQUEST', 'getBuildArtifact requires an artifactId.');
        const artifact = buildArtifacts.get(request.artifactId);
        if (!artifact) fail('BUILD_ARTIFACT_NOT_FOUND', 'The requested build artifact is no longer available. Build the project again.');
        return { protocolVersion: APP_IPC_PROTOCOL_VERSION, ok: true, result: { artifactId: artifact.artifactId, target: artifact.target, filename: artifact.filename, byteLength: artifact.byteLength, bytes: new Uint8Array(artifact.bytes) } };
      }
      if (normalized.method === 'installArtifact') {
        if (!installPackageService) fail('APP_INSTALL_UNAVAILABLE', 'The App installation service is not configured.');
        const input = normalizeInstallRequest(normalized.args[0]);
        const artifact = buildArtifacts.get(input.artifactId);
        if (!artifact) fail('BUILD_ARTIFACT_NOT_FOUND', 'The requested build artifact is no longer available. Build the project again.');
        if (artifact.target !== input.target) fail('INSTALL_TARGET_MISMATCH', 'The selected artifact does not belong to the requested Target Profile.');
        const progress = [];
        const installed = await installPackageService({
          target: artifact.target,
          packageBytes: artifact.bytes,
          conflict: input.conflict,
          onProgress: (event) => progress.push(event),
        });
        return { protocolVersion: APP_IPC_PROTOCOL_VERSION, ok: true, progress, result: summarizeInstall(installed) };
      }
      if (normalized.method === 'closeMapperSession') return { protocolVersion: APP_IPC_PROTOCOL_VERSION, ok: true, result: await closeActive() };
      fail('UNKNOWN_APP_METHOD', `App method is not allowed: ${normalized.method}.`);
    } catch (error) {
      return { protocolVersion: APP_IPC_PROTOCOL_VERSION, ok: false, error: typedError(error) };
    }
  };
}

function createAppPreloadApi({ ipcRenderer, channel = APP_IPC_CHANNEL } = {}) {
  if (!ipcRenderer || typeof ipcRenderer.invoke !== 'function') fail('INVALID_APP_PRELOAD', 'App preload API requires ipcRenderer.invoke.');
  if (typeof channel !== 'string' || !channel.trim()) fail('INVALID_APP_PRELOAD', 'App IPC channel must be a non-empty string.');
  const invoke = (method, ...args) => ipcRenderer.invoke(channel, { protocolVersion: APP_IPC_PROTOCOL_VERSION, method, args });
  const onBuildProgress = (listener) => {
    if (typeof listener !== 'function') throw new TypeError('onBuildProgress requires a function listener.');
    if (typeof ipcRenderer.on !== 'function' || typeof ipcRenderer.removeListener !== 'function') throw new TypeError('onBuildProgress requires Electron event listener support.');
    const handler = (_event, payload) => {
      const normalized = normalizeBuildProgressPayload(payload);
      if (normalized) listener(Object.freeze(normalized));
    };
    ipcRenderer.on(APP_BUILD_PROGRESS_CHANNEL, handler);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      ipcRenderer.removeListener(APP_BUILD_PROGRESS_CHANNEL, handler);
    };
  };
  return Object.freeze({
    getVersion: () => invoke('getVersion'),
    startMapperSession: (options) => invoke('startMapperSession', options),
    getMapperProject: () => invoke('getMapperProject'),
    updateMapperProject: (project) => invoke('updateMapperProject', project),
    buildProject: (input) => invoke('buildProject', input),
    onBuildProgress,
    getBuildArtifact: (artifactId) => invoke('getBuildArtifact', { artifactId }),
    installArtifact: (request) => invoke('installArtifact', request),
    closeMapperSession: () => invoke('closeMapperSession'),
  });
}

function createAppWindowOptions({ preload, width = 1280, height = 860, show = false } = {}) {
  if (typeof preload !== 'string' || !preload.trim()) fail('INVALID_APP_WINDOW', 'A preload path is required for the App window.');
  if (!Number.isInteger(width) || width < 480 || width > 4096 || !Number.isInteger(height) || height < 360 || height > 4096) fail('INVALID_APP_WINDOW', 'App window dimensions must be within 480–4096 by 360–4096.');
  if (typeof show !== 'boolean') fail('INVALID_APP_WINDOW', 'App window show must be boolean.');
  return {
    width,
    height,
    show,
    backgroundColor: '#0f172a',
    webPreferences: {
      preload,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
    },
  };
}

module.exports = {
  APP_BUILD_PROGRESS_CHANNEL,
  APP_IPC_CHANNEL,
  APP_IPC_METHODS,
  APP_IPC_PROTOCOL_VERSION,
  AppHostError,
  MapperSessionError,
  createAppIpcRouter,
  createAppPreloadApi,
  createAppWindowOptions,
  normalizeRequest,
  normalizeBuildRequest,
  normalizeInstallRequest,
  normalizeBuildProgressEvent,
  normalizeBuildProgressPayload,
  summarizeBuild,
  summarizeBuildTargets,
  summarizeInstall,
  collectBuildArtifacts,
};
