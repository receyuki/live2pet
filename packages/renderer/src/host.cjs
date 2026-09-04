const { RendererContractError } = require('./errors.cjs');

const RENDERER_IPC_CHANNEL = 'live2pet:renderer';
const RENDERER_IPC_METHODS = Object.freeze([
  'load',
  'unload',
  'playMotion',
  'pause',
  'resume',
  'restart',
  'setLoop',
  'setSpeed',
  'setExpression',
  'step',
  'getState',
  'getBounds',
  'captureRgba',
  'getVisualElements',
  'getVisualElementThumbnail',
  'scanVisualElements',
  'setVisualSettings',
]);

const RENDERER_REALM_STATES = Object.freeze({
  idle: 'idle',
  starting: 'starting',
  ready: 'ready',
  failed: 'failed',
  closed: 'closed',
});

const REALM_FAILURE_CODES = new Set([
  'RENDERER_PAGE_ERROR',
  'RENDERER_PROCESS_GONE',
  'RENDERER_LOAD_FAILED',
  'RENDERER_WINDOW_CLOSED',
  'RENDERER_REALM_FAILED',
  'RENDERER_REALM_START_FAILED',
]);

function fail(code, message, details = {}) {
  throw new RendererContractError(code, message, details);
}

function normalizeRequest(request) {
  if (!request || typeof request !== 'object' || Array.isArray(request)) fail('INVALID_RENDERER_REQUEST', 'Renderer IPC request must be an object.');
  if (request.protocolVersion !== 1) fail('UNSUPPORTED_RENDERER_PROTOCOL', 'Renderer IPC protocol version is not supported.');
  if (!RENDERER_IPC_METHODS.includes(request.method)) fail('UNKNOWN_RENDERER_METHOD', `Renderer method is not allowed: ${String(request.method)}.`);
  const args = request.args == null ? [] : request.args;
  if (!Array.isArray(args) || args.length > 4) fail('INVALID_RENDERER_REQUEST', 'Renderer IPC args must be an array with at most four items.');
  return { protocolVersion: 1, method: request.method, args };
}

function redactMessage(value) {
  return String(value || 'Renderer command failed')
    .replace(/(?:[A-Za-z]:[\\/]|\/(?:Users|home|private|tmp)\/)[^\s'"`]+/g, '<redacted-path>');
}

function rendererRealmError(code, message, details = {}) {
  return new RendererContractError(code, redactMessage(message), details);
}

function rendererRealmFail(code, message, details = {}) {
  throw rendererRealmError(code, message, details);
}

function isRealmFailure(error) {
  if (!(error instanceof RendererContractError)) return true;
  return REALM_FAILURE_CODES.has(error.code);
}

function isDestroyed(value) {
  return Boolean(value && typeof value.isDestroyed === 'function' && value.isDestroyed());
}

function validateRendererWindow(value) {
  if (!value || typeof value !== 'object') rendererRealmFail('INVALID_RENDERER_WINDOW', 'Renderer window factory did not return a window object.');
  return value;
}

function validateRendererContract(value) {
  if (!value || typeof value !== 'object') rendererRealmFail('INVALID_RENDERER', 'Renderer factory did not return a renderer object.');
  const missing = RENDERER_IPC_METHODS.filter((method) => typeof value[method] !== 'function');
  if (missing.length) rendererRealmFail('INCOMPLETE_RENDERER', `Renderer is missing contract methods: ${missing.join(', ')}.`);
  return value;
}

/**
 * Wrap a BrowserWindow-like object as the page surface consumed by the Pixi
 * adapter. Electron's executeJavaScript API accepts source text rather than a
 * function, so only the function and JSON arguments supplied by the renderer
 * host are serialized here. This wrapper exposes no Node or filesystem APIs to
 * the isolated page.
 */
function createElectronWebContentsPage({ webContents } = {}) {
  if (!webContents || typeof webContents.executeJavaScript !== 'function') rendererRealmFail('INVALID_RENDERER_HOST', 'Electron renderer page requires webContents.executeJavaScript.');
  return Object.freeze({
    supportsBinaryResults: true,
    evaluate: async (fn, ...args) => {
      if (typeof fn !== 'function') rendererRealmFail('INVALID_RENDERER_EVALUATION', 'Renderer page evaluation requires a function.');
      let serialized;
      try {
        serialized = JSON.stringify(args);
      } catch (error) {
        throw rendererRealmError('INVALID_RENDERER_EVALUATION', `Renderer page arguments are not JSON-serializable: ${error && error.message ? error.message : error}`);
      }
      if (serialized === undefined) rendererRealmFail('INVALID_RENDERER_EVALUATION', 'Renderer page arguments are not JSON-serializable.');
      // U+2028/U+2029 are valid JSON but have historically been parsed as line
      // terminators by JavaScript engines; escaping them keeps the generated
      // expression executable across supported Electron versions.
      serialized = serialized.replaceAll('\u2028', '\\u2028').replaceAll('\u2029', '\\u2029');
      const source = `(${Function.prototype.toString.call(fn)})(...${serialized})`;
      let processGone;
      let destroyed;
      try {
        if (webContents.isDestroyed?.()) throw rendererRealmError('PREVIEW_VIEW_DESTROYED', 'Preview view was destroyed.');
        if (webContents.isCrashed?.()) throw rendererRealmError('PREVIEW_PROCESS_GONE', 'Preview renderer process exited.');
        // Electron can leave executeJavaScript pending when its renderer dies.
        // Release callers (including the serialized preview/capture queue) at
        // the host lifecycle boundary, without waiting for another page call.
        const terminated = new Promise((_, reject) => {
          processGone = () => reject(rendererRealmError('PREVIEW_PROCESS_GONE', 'Preview renderer process exited.'));
          destroyed = () => reject(rendererRealmError('PREVIEW_VIEW_DESTROYED', 'Preview view was destroyed.'));
          webContents.on?.('render-process-gone', processGone);
          webContents.on?.('destroyed', destroyed);
        });
        return await Promise.race([webContents.executeJavaScript(source, true), terminated]);
      } catch (error) {
        if (['PREVIEW_PROCESS_GONE', 'PREVIEW_VIEW_DESTROYED'].includes(error?.code)) throw error;
        throw rendererRealmError('RENDERER_PAGE_ERROR', error && error.message ? error.message : error);
      } finally {
        if (processGone) webContents.removeListener?.('render-process-gone', processGone);
        if (destroyed) webContents.removeListener?.('destroyed', destroyed);
      }
    },
  });
}

/**
 * Own the lifecycle of one isolated renderer realm. The host deliberately
 * treats a failed renderer as disposable: after a command, load, or process
 * failure it unloads the adapter, destroys the BrowserWindow, and reports a
 * typed error while leaving the caller/main process alive. `restart()` is the
 * explicit recovery operation and creates a fresh realm rather than reusing a
 * compromised JavaScript context.
 */
function createRendererRealmHost({
  createWindow,
  createRenderer,
  loadWindow = async () => {},
  windowOptions = {},
  onStateChange = null,
} = {}) {
  if (typeof createWindow !== 'function') rendererRealmFail('INVALID_RENDERER_HOST', 'Renderer realm host requires a createWindow function.');
  if (typeof createRenderer !== 'function') rendererRealmFail('INVALID_RENDERER_HOST', 'Renderer realm host requires a createRenderer function.');
  if (typeof loadWindow !== 'function') rendererRealmFail('INVALID_RENDERER_HOST', 'Renderer realm host loadWindow must be a function.');
  if (onStateChange !== null && typeof onStateChange !== 'function') rendererRealmFail('INVALID_RENDERER_HOST', 'Renderer realm host onStateChange must be a function when provided.');

  let state = RENDERER_REALM_STATES.idle;
  let generation = 0;
  let window = null;
  let renderer = null;
  let lastError = null;
  let startPromise = null;
  let failurePromise = null;
  let closing = false;
  const listeners = [];

  function status() {
    return {
      protocolVersion: 1,
      state,
      generation,
      hasWindow: Boolean(window && !isDestroyed(window)),
      hasRenderer: Boolean(renderer),
      ...(lastError ? { error: { code: lastError.code, message: redactMessage(lastError.message) } } : {}),
    };
  }

  function setState(next, error = null) {
    state = next;
    lastError = error;
    if (onStateChange) {
      try { onStateChange(status()); } catch {}
    }
  }

  function detachListeners() {
    while (listeners.length) {
      const [target, event, listener] = listeners.pop();
      try {
        if (target && typeof target.removeListener === 'function') target.removeListener(event, listener);
      } catch {}
    }
  }

  async function destroyCurrent() {
    detachListeners();
    const currentRenderer = renderer;
    renderer = null;
    if (currentRenderer && typeof currentRenderer.unload === 'function') {
      try { await currentRenderer.unload(); } catch {}
    }
    const currentWindow = window;
    window = null;
    if (currentWindow && !isDestroyed(currentWindow) && typeof currentWindow.destroy === 'function') {
      try { currentWindow.destroy(); } catch {}
    }
  }

  async function failRealm(error, code = 'RENDERER_REALM_FAILED') {
    const typed = error instanceof RendererContractError
      ? error
      : rendererRealmError(code, error && error.message ? error.message : error);
    if (failurePromise) return failurePromise;
    setState(RENDERER_REALM_STATES.failed, typed);
    failurePromise = (async () => {
      closing = true;
      try { await destroyCurrent(); } finally { closing = false; }
      return typed;
    })();
    try { return await failurePromise; } finally { failurePromise = null; }
  }

  function attachWindowFailureListeners(currentWindow) {
    const add = (target, event, listener) => {
      if (!target || typeof target.on !== 'function') return;
      target.on(event, listener);
      listeners.push([target, event, listener]);
    };
    const processGone = (_event, details = {}) => {
      const reason = details && details.reason ? ` (${details.reason})` : '';
      void failRealm(rendererRealmError('RENDERER_PROCESS_GONE', `Renderer process exited${reason}.`));
    };
    const loadFailed = (_event, errorCode, errorDescription) => {
      void failRealm(rendererRealmError('RENDERER_LOAD_FAILED', `Renderer page failed to load (${errorCode}: ${errorDescription || 'unknown error'}).`));
    };
    const crashed = () => {
      void failRealm(rendererRealmError('RENDERER_PROCESS_GONE', 'Renderer process crashed.'));
    };
    const closed = () => {
      if (!closing && state !== RENDERER_REALM_STATES.closed) {
        void failRealm(rendererRealmError('RENDERER_WINDOW_CLOSED', 'Renderer window closed unexpectedly.'));
      }
    };
    add(currentWindow.webContents, 'render-process-gone', processGone);
    add(currentWindow.webContents, 'did-fail-load', loadFailed);
    add(currentWindow.webContents, 'crashed', crashed);
    add(currentWindow, 'closed', closed);
  }

  async function start() {
    if (state === RENDERER_REALM_STATES.closed) rendererRealmFail('RENDERER_HOST_CLOSED', 'Renderer realm host has been closed.');
    if (state === RENDERER_REALM_STATES.ready) return status();
    if (startPromise) return startPromise;
    startPromise = (async () => {
      setState(RENDERER_REALM_STATES.starting);
      generation += 1;
      try {
        const currentWindow = validateRendererWindow(await createWindow(windowOptions));
        window = currentWindow;
        attachWindowFailureListeners(currentWindow);
        await loadWindow(currentWindow);
        if (state === RENDERER_REALM_STATES.failed) throw lastError || rendererRealmError('RENDERER_LOAD_FAILED', 'Renderer realm failed while loading.');
        renderer = validateRendererContract(await createRenderer(currentWindow));
        setState(RENDERER_REALM_STATES.ready);
        return status();
      } catch (error) {
        const typed = await failRealm(error, 'RENDERER_REALM_START_FAILED');
        throw typed;
      } finally {
        startPromise = null;
      }
    })();
    return startPromise;
  }

  async function invoke(method, ...args) {
    if (!RENDERER_IPC_METHODS.includes(method)) rendererRealmFail('UNKNOWN_RENDERER_METHOD', `Renderer method is not allowed: ${String(method)}.`);
    if (state !== RENDERER_REALM_STATES.ready || !renderer) rendererRealmFail('RENDERER_NOT_READY', 'Renderer realm is not ready. Start or restart it before issuing commands.');
    try {
      return await renderer[method](...args);
    } catch (error) {
      if (!isRealmFailure(error)) throw error;
      const typed = await failRealm(error, 'RENDERER_REALM_FAILED');
      throw typed;
    }
  }

  async function restart() {
    if (state === RENDERER_REALM_STATES.closed) rendererRealmFail('RENDERER_HOST_CLOSED', 'Renderer realm host has been closed.');
    if (startPromise) {
      try { await startPromise; } catch {}
    }
    if (failurePromise) {
      try { await failurePromise; } catch {}
    }
    closing = true;
    try { await destroyCurrent(); } finally {
      closing = false;
      setState(RENDERER_REALM_STATES.idle);
    }
    return start();
  }

  async function close() {
    if (state === RENDERER_REALM_STATES.closed) return status();
    if (startPromise) {
      try { await startPromise; } catch {}
    }
    if (failurePromise) {
      try { await failurePromise; } catch {}
    }
    closing = true;
    try { await destroyCurrent(); } finally {
      closing = false;
      setState(RENDERER_REALM_STATES.closed);
    }
    return status();
  }

  const proxy = Object.freeze(Object.fromEntries(RENDERER_IPC_METHODS.map((method) => [method, (...args) => invoke(method, ...args)])));
  return Object.freeze({
    start,
    restart,
    close,
    invoke,
    proxy,
    getStatus: status,
  });
}

function createRendererIpcRouter({ renderer } = {}) {
  if (!renderer || typeof renderer !== 'object') fail('INVALID_RENDERER', 'Renderer IPC router requires a renderer object.');
  for (const method of RENDERER_IPC_METHODS) if (typeof renderer[method] !== 'function') fail('INCOMPLETE_RENDERER', `Renderer is missing contract method: ${method}.`);
  return async (request) => {
    try {
      const normalized = normalizeRequest(request);
      const result = await renderer[normalized.method](...normalized.args);
      return { protocolVersion: 1, ok: true, result };
    } catch (error) {
      return {
        protocolVersion: 1,
        ok: false,
        error: {
          code: error && error.code ? error.code : 'RENDERER_COMMAND_FAILED',
          message: redactMessage(error && error.message ? error.message : error),
        },
      };
    }
  };
}

function createRendererPreloadApi({ ipcRenderer, channel = RENDERER_IPC_CHANNEL } = {}) {
  if (!ipcRenderer || typeof ipcRenderer.invoke !== 'function') fail('INVALID_RENDERER_PRELOAD', 'Renderer preload API requires ipcRenderer.invoke.');
  if (typeof channel !== 'string' || !channel.trim()) fail('INVALID_RENDERER_PRELOAD', 'Renderer IPC channel must be a non-empty string.');
  const invoke = (method, ...args) => ipcRenderer.invoke(channel, { protocolVersion: 1, method, args });
  return Object.freeze(Object.fromEntries(RENDERER_IPC_METHODS.map((method) => [method, (...args) => invoke(method, ...args)])));
}

function createRendererWindowOptions({ preload, width = 512, height = 512, show = false } = {}) {
  if (typeof preload !== 'string' || !preload.trim()) fail('INVALID_RENDERER_WINDOW', 'A preload path is required for the renderer window.');
  if (!Number.isInteger(width) || width < 1 || width > 4096 || !Number.isInteger(height) || height < 1 || height > 4096) fail('INVALID_RENDERER_WINDOW', 'Renderer window dimensions must be integers between 1 and 4096.');
  if (typeof show !== 'boolean') fail('INVALID_RENDERER_WINDOW', 'Renderer window show must be boolean.');
  return {
    width,
    height,
    show,
    backgroundColor: '#00000000',
    webPreferences: {
      preload,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
    },
  };
}

function createRendererCsp({ scriptNonce } = {}) {
  if (scriptNonce != null && (typeof scriptNonce !== 'string' || !/^[A-Za-z0-9+/_-]+$/.test(scriptNonce))) fail('INVALID_RENDERER_CSP', 'scriptNonce must contain only token-safe characters.');
  const script = scriptNonce ? `'self' 'nonce-${scriptNonce}'` : "'self'";
  return [
    "default-src 'none'",
    "base-uri 'none'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    `script-src ${script}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "connect-src 'self' blob:",
    "font-src 'self'",
    "media-src 'none'",
    "worker-src 'self' blob:",
    "form-action 'none'",
  ].join('; ');
}

function createRendererCspMeta(options = {}) {
  return `<meta http-equiv="Content-Security-Policy" content="${createRendererCsp(options)}">`;
}

function rendererIpcError(error) {
  return {
    code: error && error.code ? error.code : 'RENDERER_COMMAND_FAILED',
    message: redactMessage(error && error.message ? error.message : error),
  };
}

module.exports = {
  RENDERER_IPC_CHANNEL,
  RENDERER_IPC_METHODS,
  RENDERER_REALM_STATES,
  createRendererCsp,
  createRendererCspMeta,
  createElectronWebContentsPage,
  createRendererIpcRouter,
  createRendererPreloadApi,
  createRendererRealmHost,
  createRendererWindowOptions,
  normalizeRequest,
  rendererIpcError,
};
