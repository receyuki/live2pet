const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { app, BrowserWindow, ipcMain } = require('electron');

const {
  APP_IPC_CHANNEL,
  createAppIpcRouter,
  createAppWindowOptions,
} = require('../../packages/app-host/src/index.cjs');
const { startMapperSessionHost } = require('../../packages/mapper-session/src/index.cjs');

const MAPPER_PATH = path.resolve(__dirname, '../mapper/index.html');
let mainWindow = null;
let route = null;

function mapperHostFactory(options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) throw new TypeError('Mapper Session options must be an object.');
  return startMapperSessionHost({
    project: options.project,
    mapperPath: MAPPER_PATH,
    mapperUrl: pathToFileURL(MAPPER_PATH).href,
    idleTimeoutMs: options.idleTimeoutMs,
  });
}

function registerIpc() {
  route = createAppIpcRouter({ mapperHostFactory, appVersion: app.getVersion() });
  ipcMain.handle(APP_IPC_CHANNEL, (event, request) => {
    if (!mainWindow || event.sender !== mainWindow.webContents) return { protocolVersion: 1, ok: false, error: { code: 'APP_SENDER_NOT_ALLOWED', message: 'The App IPC sender is not allowed.' } };
    return route(request);
  });
}

async function closeActiveSession() {
  if (route) await route({ protocolVersion: 1, method: 'closeMapperSession', args: [] });
}

async function createMainWindow() {
  const preload = path.join(__dirname, 'preload.cjs');
  mainWindow = new BrowserWindow(createAppWindowOptions({ preload, width: 1540, height: 960, show: false }));
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.on('closed', () => { mainWindow = null; });
  const showWindow = () => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.show(); };
  mainWindow.once('ready-to-show', showWindow);
  await mainWindow.loadFile(MAPPER_PATH);
  // `ready-to-show` may fire before loadFile() resolves. Keep an explicit
  // fallback so a renderer that has no first paint still cannot leave the
  // development shell permanently hidden.
  if (mainWindow && !mainWindow.isVisible()) showWindow();
  return mainWindow;
}

app.whenReady().then(async () => {
  registerIpc();
  await createMainWindow();
  app.on('activate', async () => { if (!mainWindow) await createMainWindow(); });
});

app.on('before-quit', () => { void closeActiveSession(); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
