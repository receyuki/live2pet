const { contextBridge, ipcRenderer } = require('electron');

// Sandboxed preload scripts can require Electron's built-ins, but cannot load
// arbitrary workspace modules. Keep this bridge intentionally tiny and in
// sync with createAppPreloadApi() in packages/app-host/src/index.cjs.
const APP_IPC_CHANNEL = 'live2pet:app';
const APP_BUILD_PROGRESS_CHANNEL = 'live2pet:build-progress';
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

contextBridge.exposeInMainWorld('live2pet', Object.freeze({
  getVersion: () => invoke('getVersion'),
  inspectSource: (input) => invoke('inspectSource', input),
  startMapperSession: (options) => invoke('startMapperSession', options),
  getMapperProject: () => invoke('getMapperProject'),
  updateMapperProject: (project) => invoke('updateMapperProject', project),
  buildProject: (input) => invoke('buildProject', input),
  onBuildProgress,
  getBuildArtifact: (artifactId, offset = 0) => invoke('getBuildArtifact', { artifactId, offset }),
  installArtifact: (request) => invoke('installArtifact', request),
  closeMapperSession: () => invoke('closeMapperSession'),
}));
