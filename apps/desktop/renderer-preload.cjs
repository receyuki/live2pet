const { contextBridge } = require('electron');

// The renderer realm is controlled by the main-process host through fixed
// page functions. It receives no general IPC, Node, filesystem, or process
// capability; this marker is only useful for a future renderer-side status
// surface and keeps the preload intentionally capability-free today.
contextBridge.exposeInMainWorld('__live2petRenderer', Object.freeze({ protocolVersion: 1 }));
