const path = require('node:path');
const { pathToFileURL } = require('node:url');

const {
  RENDERER_REALM_STATES,
  createElectronWebContentsPage,
  createRendererAssetServer,
  createRendererRealmHost,
  createRendererWindowOptions,
  safeRelativePath,
  selectRendererAdapter,
} = require('@live2pet/renderer');

const DEFAULT_READY_TIMEOUT_MS = 30 * 1000;
const DEFAULT_READY_POLL_MS = 25;

function fail(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  throw error;
}

function cubismAdapter(cubismVersion, { modernAdapter = 'pixi' } = {}) {
  try {
    return selectRendererAdapter(cubismVersion, { modern: modernAdapter });
  } catch (error) {
    if (error && ['UNSUPPORTED_CUBISM_VERSION', 'UNSUPPORTED_RENDERER_ADAPTER'].includes(error.code)) throw error;
    fail('UNSUPPORTED_CUBISM_VERSION', `Renderer host does not support Cubism generation ${String(cubismVersion)}.`, { cubismVersion });
  }
}

function hardenRendererWindow(window, rendererDocument) {
  if (!window || !window.webContents) return window;
  const webContents = window.webContents;
  if (typeof webContents.setWindowOpenHandler === 'function') webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  if (typeof webContents.on === 'function') {
    const expectedPath = pathToFileURL(path.resolve(rendererDocument)).pathname;
    webContents.on('will-navigate', (event, url) => {
      let parsed;
      try { parsed = new URL(url); } catch { event.preventDefault(); return; }
      if (parsed.protocol !== 'file:' || parsed.pathname !== expectedPath) event.preventDefault();
    });
    webContents.on('will-attach-webview', (event) => event.preventDefault());
  }
  return window;
}

async function waitForRendererReady(webContents, { timeoutMs = DEFAULT_READY_TIMEOUT_MS, pollMs = DEFAULT_READY_POLL_MS } = {}) {
  if (!webContents || typeof webContents.executeJavaScript !== 'function') fail('INVALID_RENDERER_HOST', 'Renderer window webContents must expose executeJavaScript.');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 120000) fail('INVALID_RENDERER_HOST', 'Renderer ready timeout must be between 100 and 120000 milliseconds.');
  if (!Number.isInteger(pollMs) || pollMs < 5 || pollMs > 1000) fail('INVALID_RENDERER_HOST', 'Renderer ready poll interval must be between 5 and 1000 milliseconds.');
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    let status;
    try {
      status = await webContents.executeJavaScript('({ready: window.__live2petRendererReady === true, error: window.__live2petRendererError || null})', true);
    } catch (error) {
      fail('RENDERER_PAGE_BOOT_FAILED', 'Renderer page could not report its bootstrap status.', { cause: error && error.code ? error.code : 'EXECUTE_JAVASCRIPT_FAILED' });
    }
    if (status && status.ready === true) return { ready: true };
    if (status && typeof status.error === 'string' && status.error) fail('RENDERER_PAGE_BOOT_FAILED', 'Renderer page dependencies failed to load.');
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  fail('RENDERER_PAGE_BOOT_TIMEOUT', 'Renderer page did not finish loading within the configured timeout.');
}

function createRendererWindowHost({
  BrowserWindow,
  sourceRoot,
  runtimePath,
  cubismVersion,
  rendererDocument,
  preload = path.resolve(__dirname, 'renderer-preload.cjs'),
  width = 512,
  height = 512,
  padding = 24,
  motionPriority = 3,
  modernAdapter = 'pixi',
  frameworkPath = null,
  frameworkGlobal,
  show = false,
  readyTimeoutMs = DEFAULT_READY_TIMEOUT_MS,
} = {}) {
  if (typeof BrowserWindow !== 'function') fail('INVALID_RENDERER_HOST', 'A BrowserWindow constructor is required.');
  if (typeof sourceRoot !== 'string' || !sourceRoot.trim()) fail('INVALID_RENDERER_HOST', 'Renderer sourceRoot is required.');
  if (typeof runtimePath !== 'string' || !runtimePath.trim()) fail('INVALID_RENDERER_HOST', 'Renderer runtimePath is required.');
  if (typeof rendererDocument !== 'string' || !rendererDocument.trim()) fail('INVALID_RENDERER_HOST', 'Renderer document path is required.');
  const { kind, adapter, Adapter } = cubismAdapter(cubismVersion, { modernAdapter });
  if (adapter === 'official' && (typeof frameworkPath !== 'string' || !frameworkPath.trim())) {
    fail('OFFICIAL_FRAMEWORK_REQUIRED', 'The official Cubism renderer requires a user-provided Cubism Web Framework bridge bundle.');
  }
  const options = createRendererWindowOptions({ preload, width, height, show });
  let assetServer = null;
  let assetServerPromise = null;

  const ensureAssetServer = async () => {
    if (assetServer) return assetServer;
    if (!assetServerPromise) assetServerPromise = createRendererAssetServer({ sourceRoot, runtimePath, frameworkPath });
    try {
      assetServer = await assetServerPromise;
    } catch (error) {
      assetServerPromise = null;
      throw error;
    }
    return assetServer;
  };

  const host = createRendererRealmHost({
    windowOptions: options,
    createWindow: (windowOptions) => hardenRendererWindow(new BrowserWindow(windowOptions), rendererDocument),
    loadWindow: async (window) => {
      const server = await ensureAssetServer();
      const query = new URLSearchParams({ cubism: String(cubismVersion), runtime: server.runtimeUrl, renderer: adapter });
      if (server.frameworkUrl) query.set('framework', server.frameworkUrl);
      await window.loadURL(`${pathToFileURL(path.resolve(rendererDocument)).href}?${query.toString()}`);
      await waitForRendererReady(window.webContents, { timeoutMs: readyTimeoutMs });
    },
    createRenderer: (window) => new Adapter({
      page: createElectronWebContentsPage({ webContents: window.webContents }),
      width,
      height,
      padding,
      motionPriority,
      ...(frameworkGlobal ? { frameworkGlobal } : {}),
    }),
  });

  const close = async () => {
    const status = await host.close();
    if (assetServer) {
      const server = assetServer;
      assetServer = null;
      assetServerPromise = null;
      try { await server.close(); } catch {}
    }
    return status;
  };

  const loadSource = async (source) => {
    if (!source || typeof source !== 'object' || Array.isArray(source)) fail('INVALID_RENDER_SOURCE', 'Renderer source must be an object.');
    if (Number(source.cubismVersion) !== Number(cubismVersion)) fail('RENDERER_RUNTIME_MISMATCH', 'The selected renderer runtime does not match the Source Package Cubism generation.');
    const server = await ensureAssetServer();
    const modelConfig = typeof source.modelConfig === 'string' ? source.modelConfig : null;
    if (!modelConfig && typeof source.modelUrl !== 'string') fail('INVALID_RENDER_SOURCE', 'Renderer source requires a relative modelConfig or a loopback modelUrl.');
    if (modelConfig && !safeRelativePath(sourceRoot, modelConfig)) fail('INVALID_RENDER_SOURCE', 'Renderer modelConfig must remain inside the selected Source Package.');
    if (!modelConfig) {
      let parsed;
      try { parsed = new URL(source.modelUrl); } catch { fail('INVALID_RENDER_SOURCE', 'Renderer modelUrl must be a valid loopback URL.'); }
      if (parsed.protocol !== 'http:' || parsed.hostname !== '127.0.0.1') fail('INVALID_RENDER_SOURCE', 'Renderer modelUrl must use the loopback asset server.');
    }
    const prepared = modelConfig ? { ...source, modelUrl: server.modelUrl(modelConfig) } : { ...source };
    await host.start();
    return host.invoke('load', prepared);
  };

  return Object.freeze({
    kind,
    adapter,
    start: host.start,
    restart: host.restart,
    close,
    loadSource,
    invoke: host.invoke,
    proxy: host.proxy,
    getStatus: host.getStatus,
    getAssetDescriptor: () => assetServer ? ({ protocolVersion: 1, baseUrl: assetServer.baseUrl, runtimeUrl: assetServer.runtimeUrl, ...(assetServer.frameworkUrl ? { frameworkUrl: assetServer.frameworkUrl } : {}) }) : null,
    modelUrl: (modelConfig) => {
      if (!assetServer) fail('RENDERER_NOT_READY', 'Start the renderer host before resolving a model URL.');
      return assetServer.modelUrl(modelConfig);
    },
    states: RENDERER_REALM_STATES,
  });
}

module.exports = {
  DEFAULT_READY_POLL_MS,
  DEFAULT_READY_TIMEOUT_MS,
  cubismAdapter,
  createRendererWindowHost,
  hardenRendererWindow,
  waitForRendererReady,
};
