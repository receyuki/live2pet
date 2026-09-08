const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { app, BrowserWindow, dialog, ipcMain, Menu, protocol, screen, shell, WebContentsView } = require('electron');
const { createRuntimeHelpWindowHandler } = require('./runtime-help.cjs');
const { createTargetInstallationService } = require('./target-installation-service.cjs');
const { createPackageOutputService } = require('./package-output-service.cjs');
const { createSourceLibraryService } = require('./source-library-service.cjs');
const { createUpdateService } = require('./update-service.cjs');

const {
  APP_COMMAND_CHANNEL,
  APP_BUILD_PROGRESS_CHANNEL,
  APP_LIBRARY_DOWNLOAD_PROGRESS_CHANNEL,
  APP_IPC_CHANNEL,
  createAppIpcRouter,
  createAppWindowOptions,
} = require('@live2pet/app-host');
const {
  createProjectWorkspaceService,
  createProjectSourceService,
  createWindowStateWriter,
  loadWindowBounds,
} = require('./project-workspace-service.cjs');
const { CacheStore, SHARP_ENCODER_VERSION, buildProjectTargets } = require('@live2pet/package-build');
const { installPackage } = require('@live2pet/installation');
const { discoverSourcePackages, inspectSourcePackage } = require('@live2pet/source-inspector');
const { getSpinePackStatus, installSpinePack, removeSpinePack, resolveSpinePack } = require('@live2pet/spine-pack');
const { createPreviewSessionService } = require('./preview-session-service.cjs');
const { createCaptureCacheService } = require('./capture-cache-service.cjs');
const { createCaptureCacheBuildService } = require('./capture-cache-build.cjs');
const { createHostedBuildService } = require('./hosted-build-service.cjs');
const { RUNTIME_PROTOCOL_SCHEME, createRuntimeProtocolHandler } = require('./runtime-protocol.cjs');
const {
  clearRuntimeSettings,
  loadRuntimeForGeneration,
  loadRuntimeSettings,
  redactRuntimeSettings,
  saveRuntimeSettings,
} = require('@live2pet/runtime');

const DEVELOPMENT_RENDERER_PATH = path.resolve(__dirname, 'renderer-dist/index.html');
const PACKAGED_RENDERER_PATH = path.join(process.resourcesPath, 'renderer-dist', 'index.html');
const SOURCE_CACHE_LIMIT = 1024 * 1024 * 1024;
const CAPTURE_CACHE_LIMIT = 1024 * 1024 * 1024;
const ENCODED_CACHE_TARGET_VERSION = '1';
const ENCODED_CACHE_ENCODER_VERSION = SHARP_ENCODER_VERSION;
const APP_BUNDLE_SMOKE_ARGUMENT = '--live2pet-smoke-test';
const APP_NAME = 'Live2Pet';
const PREVIEW_IPC_CHANNEL = 'live2pet:preview';
const PREVIEW_STATUS_CHANNEL = 'live2pet:preview-status';
const PREVIEW_METHODS = new Set(['open', 'layout', 'play', 'setExpression', 'control', 'close', 'getStatus', 'getVisualElements', 'getVisualElementThumbnail', 'scanVisualElements', 'setVisualSettings']);
const APP_DEV_ICON_PATH = path.resolve(__dirname, 'assets', 'icon.png');
let mainWindow = null;
let route = null;
let sourceCache = null;
let runtimeSettingsFile = null;
let captureCacheStore = null;
let captureCacheService = null;
let previewSession = null;
let mainRendererRecoveryInProgress = false;
let projectWorkspaceService = null;
let projectSourceService = null;
let sourceLibraryService = null;
const sourceRegistry = new Map();

protocol.registerSchemesAsPrivileged([{
  scheme: RUNTIME_PROTOCOL_SCHEME,
  privileges: { standard: true, secure: true },
}]);

app.setName(APP_NAME);

function appDocumentPath() {
  return app.isPackaged ? PACKAGED_RENDERER_PATH : DEVELOPMENT_RENDERER_PATH;
}

function sourceInspectionService({ inputPath, projectId, modelConfig } = {}) {
  if (!sourceCache) {
    sourceCache = new CacheStore({
      rootDir: path.join(app.getPath('userData'), 'cache', 'source-inspection'),
      maxBytes: SOURCE_CACHE_LIMIT,
    });
  }
  const manifest = inspectSourcePackage(inputPath, { cache: sourceCache, projectId, modelConfig });
  if (projectId) {
    sourceRegistry.delete(projectId);
    sourceRegistry.set(projectId, { inputPath, modelConfig, sourceFingerprint: manifest.source.fingerprint, manifest });
    while (sourceRegistry.size > 8) sourceRegistry.delete(sourceRegistry.keys().next().value);
  }
  return manifest;
}

function runtimeSettingsPath() {
  if (!runtimeSettingsFile) runtimeSettingsFile = path.join(app.getPath('userData'), 'settings', 'runtime.json');
  return runtimeSettingsFile;
}

const runtimeSettingsService = Object.freeze({
  get: async () => redactRuntimeSettings(await loadRuntimeSettings(runtimeSettingsPath())),
  configure: async ({ inputPath } = {}) => {
    if (previewSession) await previewSession.close();
    return redactRuntimeSettings(await saveRuntimeSettings(runtimeSettingsPath(), inputPath));
  },
  clear: async (fingerprint) => {
    if (previewSession) await previewSession.close();
    return redactRuntimeSettings(await clearRuntimeSettings(runtimeSettingsPath(), fingerprint));
  },
});

function spinePackRoot() {
  return path.join(app.getPath('userData'), 'renderer-packs');
}

const spinePackService = Object.freeze({
  get: async () => getSpinePackStatus(spinePackRoot()),
  install: async ({ confirmInstall, runtimeLine }) => {
    await installSpinePack(spinePackRoot(), { confirmInstall, runtimeLine });
    return getSpinePackStatus(spinePackRoot());
  },
  remove: async (runtimeLine) => {
    if (previewSession) await previewSession.close();
    removeSpinePack(spinePackRoot(), runtimeLine);
    return getSpinePackStatus(spinePackRoot());
  },
  resolve: (runtimeLine) => resolveSpinePack(spinePackRoot(), runtimeLine),
});

function previewVendorPaths(cubismVersion) {
  const vendorRoot = app.isPackaged
    ? path.join(process.resourcesPath, 'mapper-dist', 'vendor')
    : path.resolve(__dirname, 'mapper-dist', 'vendor');
  return {
    pixi: path.join(vendorRoot, 'pixi.min.js'),
    unsafeEval: path.join(vendorRoot, 'unsafe-eval.min.js'),
    live2dAdapter: path.join(vendorRoot, Number(cubismVersion) === 2 ? 'cubism2.min.js' : 'cubism4.min.js'),
  };
}

function createPreviewView() {
  const view = new WebContentsView({
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      backgroundThrottling: false,
    },
  });
  view.setBackgroundColor('#00000000');
  view.setBorderRadius(12);
  view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  view.webContents.on('will-attach-webview', (event) => event.preventDefault());
  return view;
}

async function routePreviewRequest(request) {
  try {
    if (!request || typeof request !== 'object' || Array.isArray(request) || request.protocolVersion !== 1 || !PREVIEW_METHODS.has(request.method)) {
      throw Object.assign(new Error('Preview request is not supported.'), { code: 'INVALID_PREVIEW_REQUEST' });
    }
    if (!previewSession) throw Object.assign(new Error('Preview session is not available.'), { code: 'PREVIEW_UNAVAILABLE' });
    const input = request.input === undefined ? {} : request.input;
    if (request.method === 'getStatus') return { protocolVersion: 1, ok: true, result: await previewSession.readStatus() };
    const result = request.method === 'close' || request.method === 'getStatus'
      ? await previewSession[request.method]()
      : await previewSession[request.method](input);
    return { protocolVersion: 1, ok: true, result };
  } catch (error) {
    return { protocolVersion: 1, ok: false, error: { code: error.code || 'PREVIEW_COMMAND_FAILED', message: String(error.message || error).replace(/(?:[A-Za-z]:[\\/]|\/(?:Users|home|private|tmp)\/)[^\s'"`]+/g, '<redacted-path>') } };
  }
}

function getCaptureCacheStore() {
  if (!captureCacheStore) {
    captureCacheStore = new CacheStore({
      rootDir: path.join(app.getPath('userData'), 'cache', 'captures'),
      maxBytes: CAPTURE_CACHE_LIMIT,
    });
  }
  return captureCacheStore;
}

function getCaptureCacheService() {
  if (!captureCacheService) {
    captureCacheService = createCaptureCacheService({
      cache: getCaptureCacheStore(),
      getRuntimeForGeneration: (cubismVersion) => loadRuntimeForGeneration(runtimeSettingsPath(), cubismVersion),
    });
  }
  return captureCacheService;
}

const buildProjectWithCaptureCache = createCaptureCacheBuildService({
  buildProjectTargets,
  getCaptureCacheService,
  getEncodedCache: getCaptureCacheStore,
  resolveEncodedCacheContext: async ({ plan }) => {
    const runtime = await loadRuntimeForGeneration(runtimeSettingsPath(), Number(plan.cubismVersion));
    return {
      runtimeVersion: runtime.descriptor.fingerprint,
      rendererVersion: getCaptureCacheService().rendererVersion,
      targetVersion: ENCODED_CACHE_TARGET_VERSION,
      encoderVersion: ENCODED_CACHE_ENCODER_VERSION,
    };
  },
});

const buildProjectWithHostedRenderer = createHostedBuildService({
  previewSession: {
    withRenderer: (...args) => {
      if (!previewSession) throw Object.assign(new Error('The preview renderer session is not available.'), { code: 'PREVIEW_UNAVAILABLE' });
      return previewSession.withRenderer(...args);
    },
  },
  buildProject: buildProjectWithCaptureCache,
});

let targetInstallationService;
function getTargetInstallationService() {
  if (!targetInstallationService) targetInstallationService = createTargetInstallationService({
    settingsPath: path.join(app.getPath('userData'), 'installation', 'settings.json'),
    pick: async ({ target, kind, defaultPath }) => {
      const title = kind === 'application' ? `Choose ${target === 'clawd' ? 'Clawd on Desk' : 'Codex'} App` : `Choose ${target === 'clawd' ? 'Clawd themes' : 'Codex pets'} folder`;
      const result = await dialog.showOpenDialog(mainWindow, { title, defaultPath, properties: kind === 'application' ? ['openFile'] : ['openDirectory', 'createDirectory'], ...(kind === 'application' ? { filters: [{ name: 'macOS application', extensions: ['app'] }] } : {}) });
      return result.canceled ? null : result.filePaths?.[0];
    },
  });
  return targetInstallationService;
}

let packageOutputService;
function getPackageOutputService() {
  if (!packageOutputService) packageOutputService = createPackageOutputService({
    settingsPath: path.join(app.getPath('userData'), 'output', 'settings.json'),
    pickFolder: async ({ defaultPath }) => {
      const result = await dialog.showOpenDialog(mainWindow, { title: 'Choose package output folder', defaultPath, properties: ['openDirectory', 'createDirectory'] });
      return result.canceled ? null : result.filePaths?.[0];
    },
    pickSavePath: async ({ defaultPath }) => {
      const result = await dialog.showSaveDialog(mainWindow, { title: 'Save Pet Package', defaultPath, filters: [{ name: 'Pet Package ZIP', extensions: ['zip'] }], properties: ['createDirectory', 'showOverwriteConfirmation'] });
      return result.canceled ? null : result.filePath;
    },
  });
  return packageOutputService;
}

async function chooseInstallRoot({ target } = {}) {
  if (!mainWindow || mainWindow.isDestroyed()) throw new Error('The Live2Pet window is not available for folder selection.');
  const service = getTargetInstallationService();
  const result = await service.configure({ target, action: 'choose-root' });
  if (result.cancelled) return result;
  return { path: (await service.get()).targets.find(record => record.target === target).root.path };
}

function projectWorkspaceStatePath() {
  return path.join(app.getPath('userData'), 'workspace', 'recent-projects.json');
}

function windowStatePath() {
  return path.join(app.getPath('userData'), 'window', 'main-window.json');
}

function getProjectWorkspaceService() {
  if (!projectWorkspaceService) {
    projectWorkspaceService = createProjectWorkspaceService({
      stateFile: projectWorkspaceStatePath(),
      showOpenDialog: (options) => dialog.showOpenDialog(mainWindow, options),
      showSaveDialog: (options) => dialog.showSaveDialog(mainWindow, options),
    });
  }
  return projectWorkspaceService;
}

function getProjectSourceService() {
  if (!projectSourceService) {
    projectSourceService = createProjectSourceService({
      inspectSource: sourceInspectionService,
      sourceRegistry,
    });
  }
  return projectSourceService;
}

function getSourceLibraryService() {
  if (!sourceLibraryService) {
    sourceLibraryService = createSourceLibraryService({
      showOpenDialog: (options) => dialog.showOpenDialog(mainWindow, options),
      discoverSources: discoverSourcePackages,
      inspectSource: sourceInspectionService,
      renderThumbnail: (candidate) => require('./library-thumbnail-renderer.cjs').createLibraryThumbnailRenderer({
        ownerWindow: mainWindow, createView: createPreviewView,
        resolveRuntime: (version) => loadRuntimeForGeneration(runtimeSettingsPath(), version),
        resolveSpinePack: (line) => spinePackService.resolve(line), vendorPaths: previewVendorPaths,
      })(candidate),
      getProtectedSourcePaths: () => [...sourceRegistry.values()].map((source) => source.inputPath),
      githubCacheRoot: path.join(app.getPath('userData'), 'cache', 'github-models'),
      cacheSettingsFile: path.join(app.getPath('userData'), 'settings', 'github-model-cache.json'),
      maxDepth: 2,
    });
  }
  return sourceLibraryService;
}

function sendAppCommand(command) {
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return;
  mainWindow.webContents.send(APP_COMMAND_CHANNEL, command);
}

function installApplicationMenu() {
  const template = [
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
    {
      label: 'File',
      submenu: [
        { label: 'New Project', accelerator: 'CommandOrControl+N', click: () => sendAppCommand('new') },
        { label: 'Open', accelerator: 'CommandOrControl+O', click: () => sendAppCommand('open') },
        { label: 'Save', accelerator: 'CommandOrControl+S', click: () => sendAppCommand('save') },
        { type: 'separator' },
        { label: 'Settings', accelerator: 'CommandOrControl+,', click: () => sendAppCommand('settings') },
        ...(process.platform === 'darwin' ? [] : [{ type: 'separator' }, { role: 'quit' }]),
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { label: 'Undo', accelerator: 'CommandOrControl+Z', click: () => sendAppCommand('undo') },
        { label: 'Redo', accelerator: process.platform === 'darwin' ? 'CommandOrControl+Shift+Z' : 'CommandOrControl+Y', click: () => sendAppCommand('redo') },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    { label: 'Build', submenu: [{ label: 'Build', click: () => sendAppCommand('build') }] },
    { label: 'Help', role: 'help', submenu: [{ label: 'Setup Assistant', click: () => sendAppCommand('setup') }] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function registerIpc() {
  route = createAppIpcRouter({
    projectWorkspaceService: getProjectWorkspaceService(),
    projectSourceService: getProjectSourceService(),
    sourceInspectionService,
    sourceLibraryService: getSourceLibraryService(),
    runtimeSettingsService,
    spinePackService,
    captureCacheService: getCaptureCacheService(),
    buildProjectService: buildProjectWithHostedRenderer,
    installPackageService: installPackage,
    installRootPickerService: chooseInstallRoot,
    targetInstallationService: getTargetInstallationService(),
    packageOutputService: getPackageOutputService(),
    updateService: createUpdateService({ currentVersion: app.getVersion(), openExternal: (url) => shell.openExternal(url) }),
    onBuildProgress: (event) => {
      if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return;
      try { mainWindow.webContents.send(APP_BUILD_PROGRESS_CHANNEL, event); } catch {}
    },
    onLibraryDownloadProgress: (event) => {
      if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return;
      try { mainWindow.webContents.send(APP_LIBRARY_DOWNLOAD_PROGRESS_CHANNEL, event); } catch {}
    },
    appVersion: app.getVersion(),
  });
  ipcMain.handle(APP_IPC_CHANNEL, (event, request) => {
    if (!mainWindow || event.sender !== mainWindow.webContents) return { protocolVersion: 1, ok: false, error: { code: 'APP_SENDER_NOT_ALLOWED', message: 'The App IPC sender is not allowed.' } };
    return route(request);
  });
  ipcMain.handle(PREVIEW_IPC_CHANNEL, (event, request) => {
    if (!mainWindow || event.sender !== mainWindow.webContents) return { protocolVersion: 1, ok: false, error: { code: 'APP_SENDER_NOT_ALLOWED', message: 'The App IPC sender is not allowed.' } };
    return routePreviewRequest(request);
  });
}

async function closeActiveSession() {
  if (previewSession) await previewSession.close();
  if (route && typeof route.close === 'function') await route.close();
}

async function createMainWindow() {
  const preload = path.join(__dirname, 'preload.cjs');
  const documentPath = appDocumentPath();
  const restoredBounds = loadWindowBounds(windowStatePath(), screen.getAllDisplays(), { minWidth: 900, minHeight: 640 });
  const windowOptions = createAppWindowOptions({
    preload,
    width: restoredBounds?.width || 1540,
    height: restoredBounds?.height || 960,
    show: false,
  });
  Object.assign(windowOptions, {
    minWidth: 900,
    minHeight: 640,
    ...(restoredBounds ? { x: restoredBounds.x, y: restoredBounds.y } : {}),
  });
  if (process.platform === 'darwin') {
    Object.assign(windowOptions, {
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: { x: 18, y: 19 },
    });
  }
  mainWindow = new BrowserWindow(windowOptions);
  const windowStateWriter = createWindowStateWriter({
    stateFile: windowStatePath(),
    getBounds: () => mainWindow && !mainWindow.isDestroyed() && !mainWindow.isMaximized() && !mainWindow.isFullScreen() ? mainWindow.getBounds() : null,
  });
  mainWindow.on('resize', windowStateWriter.schedule);
  mainWindow.on('move', windowStateWriter.schedule);
  mainWindow.on('close', windowStateWriter.flush);
  previewSession = createPreviewSessionService({
    ownerWindow: mainWindow,
    createView: createPreviewView,
    resolveSource: ({ projectId, sourceFingerprint }) => {
      const record = sourceRegistry.get(projectId);
      return record && record.sourceFingerprint === sourceFingerprint ? record : null;
    },
    resolveRuntime: (cubismVersion) => loadRuntimeForGeneration(runtimeSettingsPath(), cubismVersion),
    resolveSpinePack: (runtimeLine) => spinePackService.resolve(runtimeLine),
    vendorPaths: previewVendorPaths,
    onStatus: (status) => {
      if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return;
      try { mainWindow.webContents.send(PREVIEW_STATUS_CHANNEL, status); } catch {}
    },
  });
  mainWindow.webContents.setWindowOpenHandler(createRuntimeHelpWindowHandler((url) => shell.openExternal(url)));
  const documentUrl = pathToFileURL(documentPath).href;
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url !== documentUrl) event.preventDefault();
  });
  mainWindow.webContents.on('will-attach-webview', (event) => event.preventDefault());
  mainWindow.webContents.on('will-prevent-unload', (event) => {
    const choice = dialog.showMessageBoxSync(mainWindow, {
      type: 'question', buttons: ['Keep Editing', 'Leave'], defaultId: 0, cancelId: 0,
      message: 'Leave this unsaved project?',
      detail: 'Your latest changes remain in local recovery. Your saved project file will not be overwritten.',
    });
    // Electron uses preventDefault here to allow an unload blocked by the renderer.
    if (choice === 1) event.preventDefault();
  });
  mainWindow.webContents.on('render-process-gone', (_event, details = {}) => {
    const reason = typeof details.reason === 'string' ? details.reason : 'unknown';
    console.error(`Live2Pet App renderer exited unexpectedly (${reason}).`);
    const windowToRecover = mainWindow;
    if (reason === 'clean-exit' || mainRendererRecoveryInProgress || !windowToRecover || windowToRecover.isDestroyed()) return;
    mainRendererRecoveryInProgress = true;
    setTimeout(() => {
      if (!mainWindow || mainWindow !== windowToRecover || windowToRecover.isDestroyed()) {
        mainRendererRecoveryInProgress = false;
        return;
      }
      windowToRecover.loadFile(documentPath, { query: { rendererRecovered: reason } })
        .catch((error) => console.error('Live2Pet could not recover the App renderer.', error))
        .finally(() => { mainRendererRecoveryInProgress = false; });
    }, 100);
  });
  mainWindow.on('closed', () => {
    const sessionToClose = previewSession;
    previewSession = null;
    mainWindow = null;
    if (sessionToClose) void sessionToClose.close();
  });
  const showWindow = () => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.show(); };
  mainWindow.once('ready-to-show', showWindow);
  await mainWindow.loadFile(documentPath);
  // `ready-to-show` may fire before loadFile() resolves. Keep an explicit
  // fallback so a renderer that has no first paint still cannot leave the
  // development shell permanently hidden.
  if (mainWindow && !mainWindow.isVisible()) showWindow();
  if (process.argv.includes(APP_BUNDLE_SMOKE_ARGUMENT)) {
    // Loading index.html alone does not prove that React or its packaged chunks mounted.
    const mounted = await mainWindow.webContents.executeJavaScript(`new Promise((resolve) => {
      const deadline = Date.now() + 10000;
      const check = () => {
        if (document.querySelector('#root .setup-view, #root .welcome-view, #root .app-shell')) return resolve(true);
        if (Date.now() >= deadline) return resolve(false);
        setTimeout(check, 50);
      };
      check();
    })`);
    if (!mounted) { console.error('LIVE2PET_BUNDLE_FAILED HeroUI did not mount.'); app.exit(1); return mainWindow; }
    const services = await mainWindow.webContents.executeJavaScript(`(async () => {
      const api = window.live2pet;
      const spine = await api.getSpinePackStatus();
      const cache = await api.getSourceLibraryCacheStatus();
      return { spine: spine.ok === true, cache: cache.ok === true, cacheLimit: cache.result?.maxBytes };
    })()`);
    if (!services.spine || !services.cache) { console.error('LIVE2PET_BUNDLE_FAILED Library or Spine IPC unavailable.'); app.exit(1); return mainWindow; }
    process.stdout.write(`LIVE2PET_BUNDLE_READY ${JSON.stringify({ packaged: app.isPackaged, renderer: 'heroui', mounted, document: path.basename(documentPath), services })}\n`);
    setTimeout(() => app.quit(), 100);
  }
  return mainWindow;
}

app.whenReady().then(async () => {
  if (!app.isPackaged && process.platform === 'darwin' && app.dock) app.dock.setIcon(APP_DEV_ICON_PATH);
  const defaultSession = require('electron').session.defaultSession;
  defaultSession.protocol.handle(RUNTIME_PROTOCOL_SCHEME, createRuntimeProtocolHandler({
    getRuntimeForGeneration: (cubismVersion) => loadRuntimeForGeneration(runtimeSettingsPath(), cubismVersion),
  }));
  defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  defaultSession.setPermissionCheckHandler(() => false);
  registerIpc();
  installApplicationMenu();
  await createMainWindow();
  app.on('activate', async () => { if (!mainWindow) await createMainWindow(); });
});

app.on('before-quit', () => { void closeActiveSession(); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
