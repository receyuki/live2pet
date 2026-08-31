const { contextBridge, ipcRenderer } = require('electron');

// Sandboxed preload scripts can require Electron's built-ins, but cannot load
// arbitrary workspace modules. Keep this bridge intentionally tiny and in
// sync with createAppPreloadApi() in packages/app-host/src/index.cjs.
const APP_IPC_CHANNEL = 'live2pet:app';
const APP_IPC_PROTOCOL_VERSION = 1;
const invoke = (method, ...args) => ipcRenderer.invoke(APP_IPC_CHANNEL, {
  protocolVersion: APP_IPC_PROTOCOL_VERSION,
  method,
  args,
});

contextBridge.exposeInMainWorld('live2pet', Object.freeze({
  getVersion: () => invoke('getVersion'),
  startMapperSession: (options) => invoke('startMapperSession', options),
  getMapperProject: () => invoke('getMapperProject'),
  updateMapperProject: (project) => invoke('updateMapperProject', project),
  buildProject: (input) => invoke('buildProject', input),
  getBuildArtifact: (artifactId) => invoke('getBuildArtifact', { artifactId }),
  installArtifact: (request) => invoke('installArtifact', request),
  closeMapperSession: () => invoke('closeMapperSession'),
}));
