const { MapperSessionError, startMapperSessionHost } = require('../../mapper-session/src/index.cjs');

const APP_IPC_PROTOCOL_VERSION = 1;
const APP_IPC_CHANNEL = 'live2pet:app';
const APP_IPC_METHODS = Object.freeze([
  'getVersion',
  'startMapperSession',
  'getMapperProject',
  'updateMapperProject',
  'buildProject',
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

function normalizeRequest(request) {
  if (!request || typeof request !== 'object' || Array.isArray(request)) fail('INVALID_APP_REQUEST', 'App IPC request must be an object.');
  if (request.protocolVersion !== APP_IPC_PROTOCOL_VERSION) fail('UNSUPPORTED_APP_PROTOCOL', 'App IPC protocol version is not supported.');
  if (!APP_IPC_METHODS.includes(request.method)) fail('UNKNOWN_APP_METHOD', `App method is not allowed: ${String(request.method)}.`);
  const args = request.args == null ? [] : request.args;
  if (!Array.isArray(args) || args.length > 4) fail('INVALID_APP_REQUEST', 'App IPC args must be an array with at most four items.');
  return { protocolVersion: APP_IPC_PROTOCOL_VERSION, method: request.method, args };
}

function typedError(error) {
  return {
    code: error && error.code ? error.code : 'APP_COMMAND_FAILED',
    message: error && error.message ? error.message : String(error),
    ...(error && error.details && typeof error.details === 'object' ? { details: error.details } : {}),
  };
}

function createAppIpcRouter({ mapperHostFactory = startMapperSessionHost, buildProjectService = null, appVersion = '0.1.0' } = {}) {
  if (typeof mapperHostFactory !== 'function') fail('INVALID_APP_ROUTER', 'mapperHostFactory must be a function.');
  if (buildProjectService !== null && typeof buildProjectService !== 'function') fail('INVALID_APP_ROUTER', 'buildProjectService must be a function when provided.');
  if (typeof appVersion !== 'string' || !appVersion.trim()) fail('INVALID_APP_ROUTER', 'appVersion must be a non-empty string.');
  let activeHost = null;
  let activeClient = null;

  const closeActive = async () => {
    if (!activeHost) return { closed: false };
    const host = activeHost;
    activeHost = null;
    activeClient = null;
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
        const progress = [];
        const built = await buildProjectService({ ...input, onProgress: (event) => progress.push(event) });
        return { protocolVersion: APP_IPC_PROTOCOL_VERSION, ok: true, progress, result: summarizeBuildTargets(built) };
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
  return Object.freeze({
    getVersion: () => invoke('getVersion'),
    startMapperSession: (options) => invoke('startMapperSession', options),
    getMapperProject: () => invoke('getMapperProject'),
    updateMapperProject: (project) => invoke('updateMapperProject', project),
    buildProject: (input) => invoke('buildProject', input),
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
  summarizeBuild,
  summarizeBuildTargets,
};
