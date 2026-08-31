const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { app, BrowserWindow, ipcMain } = require('electron');

const {
  APP_BUILD_PROGRESS_CHANNEL,
  APP_IPC_CHANNEL,
  createAppIpcRouter,
  createAppWindowOptions,
} = require('../../packages/app-host/src/index.cjs');
const { startMapperSessionHost } = require('../../packages/mapper-session/src/index.cjs');
const { CacheStore, buildProjectTargets } = require('../../packages/package-build/src/index.cjs');
const { installPackage } = require('../../packages/installation/src/index.cjs');
const { inspectSourcePackage } = require('../../packages/source-inspector/src/index.cjs');
const { createRendererWindowHost } = require('./renderer-host.cjs');
const { createRendererPreviewService } = require('./renderer-preview-service.cjs');
const {
  clearRuntimeSettings,
  loadRuntimeSettings,
  redactRuntimeSettings,
  resolveRuntimeEntrypoint,
  saveRuntimeSettings,
} = require('../../packages/runtime/src/index.cjs');

const DEVELOPMENT_MAPPER_PATH = path.resolve(__dirname, '../mapper/index.html');
const PACKAGED_MAPPER_PATH = path.join(process.resourcesPath, 'mapper-dist', 'index.html');
const DEVELOPMENT_RENDERER_PATH = path.resolve(__dirname, 'renderer/index.html');
const PACKAGED_RENDERER_PATH = path.join(process.resourcesPath, 'mapper-dist', 'renderer.html');
const SOURCE_CACHE_LIMIT = 1024 * 1024 * 1024;
let mainWindow = null;
let route = null;
let sourceCache = null;
let runtimeSettingsFile = null;
let rendererWindowHost = null;

function mapperPath() {
  return app.isPackaged ? PACKAGED_MAPPER_PATH : DEVELOPMENT_MAPPER_PATH;
}

function rendererPath() {
  return app.isPackaged ? PACKAGED_RENDERER_PATH : DEVELOPMENT_RENDERER_PATH;
}

/**
 * Create the isolated Live2D renderer only for an explicit preview operation.
 * The main Mapper window never receives model/runtime bytes; this host owns a
 * separate sandboxed BrowserWindow and a loopback asset server instead.
 */
function createRendererPreviewHost(options = {}) {
  if (rendererWindowHost && rendererWindowHost.getStatus().state !== 'closed') return rendererWindowHost;
  rendererWindowHost = null;
  rendererWindowHost = createRendererWindowHost({
    ...options,
    BrowserWindow,
    rendererDocument: rendererPath(),
    preload: path.join(__dirname, 'renderer-preload.cjs'),
  });
  return rendererWindowHost;
}

async function closeRendererPreviewHost() {
  if (!rendererWindowHost) return;
  const host = rendererWindowHost;
  rendererWindowHost = null;
  await host.close();
}

function mapperHostFactory(options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) throw new TypeError('Mapper Session options must be an object.');
  const documentPath = mapperPath();
  return startMapperSessionHost({
    project: options.project,
    mapperPath: documentPath,
    mapperUrl: pathToFileURL(documentPath).href,
    mapperAssetRoot: app.isPackaged ? path.dirname(documentPath) : undefined,
    idleTimeoutMs: options.idleTimeoutMs,
  });
}

function sourceInspectionService({ inputPath, projectId } = {}) {
  if (!sourceCache) {
    sourceCache = new CacheStore({
      rootDir: path.join(app.getPath('userData'), 'cache', 'source-inspection'),
      maxBytes: SOURCE_CACHE_LIMIT,
    });
  }
  return inspectSourcePackage(inputPath, { cache: sourceCache, projectId });
}

function runtimeSettingsPath() {
  if (!runtimeSettingsFile) runtimeSettingsFile = path.join(app.getPath('userData'), 'settings', 'runtime.json');
  return runtimeSettingsFile;
}

const runtimeSettingsService = Object.freeze({
  get: async () => redactRuntimeSettings(await loadRuntimeSettings(runtimeSettingsPath())),
  configure: async ({ inputPath } = {}) => redactRuntimeSettings(await saveRuntimeSettings(runtimeSettingsPath(), inputPath)),
  clear: async () => redactRuntimeSettings(clearRuntimeSettings(runtimeSettingsPath())),
});

const rendererPreviewService = createRendererPreviewService({
  loadRuntime: () => loadRuntimeSettings(runtimeSettingsPath()),
  resolveRuntimeEntrypoint,
  createHost: (options) => createRendererPreviewHost(options),
});

function registerIpc() {
  route = createAppIpcRouter({
    mapperHostFactory,
    sourceInspectionService,
    runtimeSettingsService,
    rendererPreviewService,
    buildProjectService: buildProjectTargets,
    installPackageService: installPackage,
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
}

async function closeActiveSession() {
  if (route) await route({ protocolVersion: 1, method: 'closeMapperSession', args: [] });
  if (route) await route({ protocolVersion: 1, method: 'closeRendererPreview', args: [] });
  else await closeRendererPreviewHost();
}

async function createMainWindow() {
  const preload = path.join(__dirname, 'preload.cjs');
  const documentPath = mapperPath();
  mainWindow = new BrowserWindow(createAppWindowOptions({ preload, width: 1540, height: 960, show: false }));
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  const mapperUrl = pathToFileURL(documentPath).href;
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url !== mapperUrl) event.preventDefault();
  });
  mainWindow.webContents.on('will-attach-webview', (event) => event.preventDefault());
  mainWindow.on('closed', () => { mainWindow = null; });
  const showWindow = () => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.show(); };
  mainWindow.once('ready-to-show', showWindow);
  await mainWindow.loadFile(documentPath);
  // `ready-to-show` may fire before loadFile() resolves. Keep an explicit
  // fallback so a renderer that has no first paint still cannot leave the
  // development shell permanently hidden.
  if (mainWindow && !mainWindow.isVisible()) showWindow();
  return mainWindow;
}

app.whenReady().then(async () => {
  const defaultSession = require('electron').session.defaultSession;
  defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  defaultSession.setPermissionCheckHandler(() => false);
  registerIpc();
  await createMainWindow();
  app.on('activate', async () => { if (!mainWindow) await createMainWindow(); });
});

app.on('before-quit', () => { void closeActiveSession(); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
