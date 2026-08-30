const { contextBridge, ipcRenderer } = require('electron');

const { createAppPreloadApi } = require('../../packages/app-host/src/index.cjs');

contextBridge.exposeInMainWorld('live2pet', createAppPreloadApi({ ipcRenderer }));
