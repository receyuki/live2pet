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
  createRendererCsp,
  createRendererCspMeta,
  createRendererIpcRouter,
  createRendererPreloadApi,
  createRendererWindowOptions,
  normalizeRequest,
  rendererIpcError,
};
