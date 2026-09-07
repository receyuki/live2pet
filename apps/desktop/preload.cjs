const { contextBridge, ipcRenderer, webUtils } = require('electron');

// Sandboxed preload scripts can require Electron's built-ins, but cannot load
// arbitrary workspace modules. Keep this bridge intentionally tiny and in
// sync with createAppPreloadApi() in packages/app-host/src/index.cjs.
const APP_IPC_CHANNEL = 'live2pet:app';
const APP_BUILD_PROGRESS_CHANNEL = 'live2pet:build-progress';
const APP_COMMAND_CHANNEL = 'live2pet:command';
const APP_COMMANDS = new Set(['new', 'open', 'save', 'settings', 'build', 'setup', 'undo', 'redo']);
const PREVIEW_IPC_CHANNEL = 'live2pet:preview';
const PREVIEW_STATUS_CHANNEL = 'live2pet:preview-status';
const APP_IPC_PROTOCOL_VERSION = 1;
const BUILD_PROGRESS_FIELDS = [
  'target', 'stage', 'status', 'motionId', 'name', 'width', 'height', 'samples', 'duration',
  'total', 'completed', 'index', 'frameCount', 'concurrency', 'percent', 'fraction', 'message',
  'error',
  'motions', 'assets', 'states', 'reactions', 'rows', 'cells', 'occupiedCells',
  'transparentCells', 'cache', 'cacheHits', 'cacheMisses', 'ready', 'missingStates',
  'missingReactions', 'format', 'byteLength', 'packageByteLength', 'previewReady',
];
const invoke = (method, ...args) => ipcRenderer.invoke(APP_IPC_CHANNEL, {
  protocolVersion: APP_IPC_PROTOCOL_VERSION,
  method,
  args,
});
const invokePreview = (method, input) => ipcRenderer.invoke(PREVIEW_IPC_CHANNEL, {
  protocolVersion: APP_IPC_PROTOCOL_VERSION,
  method,
  ...(input === undefined ? {} : { input }),
});
const normalizeBuildProgressPayload = (payload) => {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  if (payload.protocolVersion !== APP_IPC_PROTOCOL_VERSION || typeof payload.buildId !== 'string' || !payload.buildId.trim() || !Number.isInteger(payload.sequence) || payload.sequence < 1) return null;
  if (typeof payload.stage !== 'string' || !payload.stage.trim() || typeof payload.status !== 'string' || !payload.status.trim()) return null;
  const normalized = { protocolVersion: APP_IPC_PROTOCOL_VERSION, buildId: payload.buildId.slice(0, 128), sequence: payload.sequence, stage: payload.stage.trim().slice(0, 64), status: payload.status.trim().slice(0, 64) };
  for (const key of BUILD_PROGRESS_FIELDS) {
    if (!Object.hasOwn(payload, key)) continue;
    const value = payload[key];
    if (typeof value === 'string' && value.length <= 256 && !/^(?:\/|[A-Za-z]:[\\/]|\\\\)/.test(value)) normalized[key] = value;
    else if (typeof value === 'number' && Number.isFinite(value)) normalized[key] = value;
    else if (typeof value === 'boolean') normalized[key] = value;
    else if (Array.isArray(value) && value.length <= 64 && value.every((item) => (typeof item === 'string' && item.length <= 256 && !/^(?:\/|[A-Za-z]:[\\/]|\\\\)/.test(item)) || (typeof item === 'number' && Number.isFinite(item)) || typeof item === 'boolean')) normalized[key] = [...value];
  }
  return normalized;
};
const onBuildProgress = (listener) => {
  if (typeof listener !== 'function') throw new TypeError('onBuildProgress requires a function listener.');
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
const onAppCommand = (listener) => {
  if (typeof listener !== 'function') throw new TypeError('onAppCommand requires a function listener.');
  const handler = (_event, command) => {
    if (APP_COMMANDS.has(command)) listener(command);
  };
  ipcRenderer.on(APP_COMMAND_CHANNEL, handler);
  let active = true;
  return () => {
    if (!active) return;
    active = false;
    ipcRenderer.removeListener(APP_COMMAND_CHANNEL, handler);
  };
};
const getFilePath = (file) => {
  if (!webUtils || typeof webUtils.getPathForFile !== 'function') return null;
  try {
    const value = webUtils.getPathForFile(file);
    return typeof value === 'string' && value ? value : null;
  } catch {
    return null;
  }
};
const onPreviewStatus = (listener) => {
  if (typeof listener !== 'function') throw new TypeError('onPreviewStatus requires a function listener.');
  const handler = (_event, payload) => {
    if (!payload || typeof payload !== 'object' || payload.schemaVersion !== 1 || !['idle', 'opening', 'ready', 'failed'].includes(payload.state)) return;
    listener(Object.freeze(payload));
  };
  ipcRenderer.on(PREVIEW_STATUS_CHANNEL, handler);
  let active = true;
  return () => {
    if (!active) return;
    active = false;
    ipcRenderer.removeListener(PREVIEW_STATUS_CHANNEL, handler);
  };
};

contextBridge.exposeInMainWorld('live2pet', Object.freeze({
  getVersion: () => invoke('getVersion'),
  getRecentProjects: () => invoke('getRecentProjects'),
  openProject: (input = {}) => invoke('openProject', input),
  saveProject: (input) => invoke('saveProject', input),
  openSourceLibrary: () => invoke('openSourceLibrary'),
  openGitHubLibrary: (url) => invoke('openGitHubLibrary', { url }),
  inspectLibrarySource: (input) => invoke('inspectLibrarySource', input),
  getSourceLibraryCacheStatus: () => invoke('getSourceLibraryCacheStatus'),
  configureSourceLibraryCache: (maxBytes) => invoke('configureSourceLibraryCache', { maxBytes }),
  clearSourceLibraryCache: () => invoke('clearSourceLibraryCache', { confirmClear: true }),
  onAppCommand,
  inspectSource: (input) => invoke('inspectSource', input),
  relinkSource: (input) => invoke('relinkSource', input),
  acknowledgeSourceReview: (input) => invoke('acknowledgeSourceReview', input),
  getRuntimeSettings: () => invoke('getRuntimeSettings'),
  configureRuntime: (input) => invoke('configureRuntime', input),
  clearRuntimeSettings: (input) => input === undefined ? invoke('clearRuntimeSettings') : invoke('clearRuntimeSettings', input),
  getSpinePackStatus: () => invoke('getSpinePackStatus'),
  installSpinePack: (runtimeLine) => invoke('installSpinePack', { confirmInstall: true, runtimeLine }),
  removeSpinePack: (runtimeLine) => invoke('removeSpinePack', { runtimeLine }),
  getCaptureCacheStatus: (input) => invoke('getCaptureCacheStatus', input),
  putCaptureCache: (input) => invoke('putCaptureCache', input),
  getBuildCacheStatus: () => invoke('getBuildCacheStatus'),
  clearBuildCache: (input) => invoke('clearBuildCache', input),
  getFilePath,
  buildProject: (input) => invoke('buildProject', input),
  cancelBuild: (buildId) => invoke('cancelBuild', { buildId }),
  onBuildProgress,
  getBuildArtifact: (artifactId, offset = 0) => invoke('getBuildArtifact', { artifactId, offset }),
  getOutputSettings: () => invoke('getOutputSettings'),
  configureOutputSettings: (input) => invoke('configureOutputSettings', input),
  saveBuildArtifact: (artifactId) => invoke('saveBuildArtifact', { artifactId }),
  chooseInstallRoot: (target) => invoke('chooseInstallRoot', { target }),
  getTargetInstallations: () => invoke('getTargetInstallations'),
  configureTargetInstallation: (input) => invoke('configureTargetInstallation', input),
  installArtifact: (request) => invoke('installArtifact', request),
  openPreview: (input) => invokePreview('open', input),
  layoutPreview: (input) => invokePreview('layout', input),
  playPreview: (input) => invokePreview('play', input),
  setPreviewExpression: (input) => invokePreview('setExpression', input),
  getPreviewVisualElements: () => invokePreview('getVisualElements'),
  getPreviewVisualElementThumbnail: (input) => invokePreview('getVisualElementThumbnail', input),
  scanPreviewVisualElements: (input) => invokePreview('scanVisualElements', input),
  setPreviewVisualSettings: (input) => invokePreview('setVisualSettings', input),
  controlPreview: (input) => invokePreview('control', input),
  closePreview: () => invokePreview('close'),
  getPreviewStatus: () => invokePreview('getStatus'),
  onPreviewStatus,
}));
