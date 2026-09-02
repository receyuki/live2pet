const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { app, BrowserWindow, dialog, ipcMain, protocol, WebContentsView } = require('electron');

const {
  APP_BUILD_PROGRESS_CHANNEL,
  APP_IPC_CHANNEL,
  createAppIpcRouter,
  createAppWindowOptions,
} = require('@live2pet/app-host');
const { CacheStore, SHARP_ENCODER_VERSION, buildProjectTargets } = require('@live2pet/package-build');
const { installPackage } = require('@live2pet/installation');
const { inspectSourcePackage } = require('@live2pet/source-inspector');
const { createPreviewSessionService } = require('./preview-session-service.cjs');
const { createCaptureCacheService } = require('./capture-cache-service.cjs');
const { createCaptureCacheBuildService } = require('./capture-cache-build.cjs');
const { RUNTIME_PROTOCOL_SCHEME, createRuntimeProtocolHandler } = require('./runtime-protocol.cjs');
const {
  clearRuntimeSettings,
  loadRuntimeForGeneration,
  loadRuntimeSettings,
  redactRuntimeSettings,
  saveRuntimeSettings,
} = require('@live2pet/runtime');

const DEVELOPMENT_MAPPER_PATH = path.resolve(__dirname, '../mapper/index.html');
const DEVELOPMENT_RENDERER_PATH = path.resolve(__dirname, 'renderer-dist/index.html');
const PACKAGED_MAPPER_PATH = path.join(process.resourcesPath, 'mapper-dist', 'index.html');
const SOURCE_CACHE_LIMIT = 1024 * 1024 * 1024;
const CAPTURE_CACHE_LIMIT = 1024 * 1024 * 1024;
const ENCODED_CACHE_TARGET_VERSION = '1';
const ENCODED_CACHE_ENCODER_VERSION = SHARP_ENCODER_VERSION;
const APP_BUNDLE_SMOKE_ARGUMENT = '--live2pet-smoke-test';
const UI_PREVIEW_ARGUMENT = '--live2pet-ui-preview';
const APP_NAME = 'Live2Pet';
const PREVIEW_IPC_CHANNEL = 'live2pet:preview';
const PREVIEW_STATUS_CHANNEL = 'live2pet:preview-status';
const PREVIEW_METHODS = new Set(['open', 'layout', 'play', 'setExpression', 'control', 'close', 'getStatus']);
const APP_DEV_ICON_PATH = path.resolve(__dirname, 'assets', 'icon.png');
let mainWindow = null;
let route = null;
let sourceCache = null;
let runtimeSettingsFile = null;
let captureCacheStore = null;
let captureCacheService = null;
let previewSession = null;
let mainRendererRecoveryInProgress = false;
const sourceRegistry = new Map();

protocol.registerSchemesAsPrivileged([{
  scheme: RUNTIME_PROTOCOL_SCHEME,
  privileges: { standard: true, secure: true },
}]);

app.setName(APP_NAME);

function mapperPath() {
  return app.isPackaged ? PACKAGED_MAPPER_PATH : DEVELOPMENT_MAPPER_PATH;
}

function appDocumentPath() {
  if (!app.isPackaged && process.argv.includes(UI_PREVIEW_ARGUMENT)) return DEVELOPMENT_RENDERER_PATH;
  return mapperPath();
}

function sourceInspectionService({ inputPath, projectId } = {}) {
  if (!sourceCache) {
    sourceCache = new CacheStore({
      rootDir: path.join(app.getPath('userData'), 'cache', 'source-inspection'),
      maxBytes: SOURCE_CACHE_LIMIT,
    });
  }
  const manifest = inspectSourcePackage(inputPath, { cache: sourceCache, projectId });
  if (projectId) {
    sourceRegistry.delete(projectId);
    sourceRegistry.set(projectId, { inputPath, sourceFingerprint: manifest.source.fingerprint, manifest });
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
  clear: async () => {
    if (previewSession) await previewSession.close();
    return redactRuntimeSettings(clearRuntimeSettings(runtimeSettingsPath()));
  },
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

async function chooseInstallRoot({ target } = {}) {
  if (!mainWindow || mainWindow.isDestroyed()) throw new Error('The Live2Pet window is not available for folder selection.');
  const title = target === 'clawd' ? 'Choose a Clawd themes folder' : 'Choose a Codex pets folder';
  const result = await dialog.showOpenDialog(mainWindow, { title, properties: ['openDirectory', 'createDirectory'] });
  if (result.canceled || !result.filePaths?.[0]) return { cancelled: true };
  return { path: result.filePaths[0] };
}

function registerIpc() {
  route = createAppIpcRouter({
    sourceInspectionService,
    runtimeSettingsService,
    captureCacheService: getCaptureCacheService(),
    buildProjectService: buildProjectWithCaptureCache,
    installPackageService: installPackage,
    installRootPickerService: chooseInstallRoot,
    onBuildProgress: (event) => {
      if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return;
      try { mainWindow.webContents.send(APP_BUILD_PROGRESS_CHANNEL, event); } catch {}
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
  const windowOptions = createAppWindowOptions({ preload, width: 1540, height: 960, show: false });
  if (documentPath === DEVELOPMENT_RENDERER_PATH) {
    Object.assign(windowOptions, {
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: { x: 18, y: 19 },
      minWidth: 900,
      minHeight: 640,
    });
  }
  mainWindow = new BrowserWindow(windowOptions);
  previewSession = createPreviewSessionService({
    ownerWindow: mainWindow,
    createView: createPreviewView,
    resolveSource: ({ projectId, sourceFingerprint }) => {
      const record = sourceRegistry.get(projectId);
      return record && record.sourceFingerprint === sourceFingerprint ? record : null;
    },
    resolveRuntime: (cubismVersion) => loadRuntimeForGeneration(runtimeSettingsPath(), cubismVersion),
    vendorPaths: previewVendorPaths,
    onStatus: (status) => {
      if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return;
      try { mainWindow.webContents.send(PREVIEW_STATUS_CHANNEL, status); } catch {}
    },
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  const mapperUrl = pathToFileURL(documentPath).href;
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url !== mapperUrl) event.preventDefault();
  });
  mainWindow.webContents.on('will-attach-webview', (event) => event.preventDefault());
  mainWindow.webContents.on('render-process-gone', (_event, details = {}) => {
    const reason = typeof details.reason === 'string' ? details.reason : 'unknown';
    console.error(`Live2Pet Mapper renderer exited unexpectedly (${reason}).`);
    const windowToRecover = mainWindow;
    if (reason === 'clean-exit' || mainRendererRecoveryInProgress || !windowToRecover || windowToRecover.isDestroyed()) return;
    mainRendererRecoveryInProgress = true;
    setTimeout(() => {
      if (!mainWindow || mainWindow !== windowToRecover || windowToRecover.isDestroyed()) {
        mainRendererRecoveryInProgress = false;
        return;
      }
      windowToRecover.loadFile(documentPath, { query: { rendererRecovered: reason } })
        .catch((error) => console.error('Live2Pet could not recover the Mapper renderer.', error))
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
    process.stdout.write(`LIVE2PET_BUNDLE_READY ${JSON.stringify({ packaged: app.isPackaged, mapper: path.basename(documentPath) })}\n`);
    // Give the renderer one event-loop turn to settle its local subresources;
    // quitting immediately can make Electron report a false ERR_FAILED after
    // the ready marker even though the packaged Mapper loaded successfully.
    setTimeout(() => app.quit(), 500);
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
  await createMainWindow();
  app.on('activate', async () => { if (!mainWindow) await createMainWindow(); });
});

app.on('before-quit', () => { void closeActiveSession(); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
