const path = require('node:path');

const {
  createElectronWebContentsPage,
  createPixiLive2dAdapter,
  createRendererAssetServer,
  pixiSourceFromManifest,
} = require('@live2pet/renderer');
const { parsePck: defaultParsePck } = require('@live2pet/source-inspector');

const SESSION_STATES = Object.freeze({
  idle: 'idle',
  opening: 'opening',
  ready: 'ready',
  failed: 'failed',
});
const MIN_PREVIEW_SIZE = 64;
const MAX_PREVIEW_SIZE = 4096;

class PreviewSessionError extends Error {
  constructor(code, message) {
    super(redactMessage(message));
    this.name = 'PreviewSessionError';
    this.code = code;
  }
}

function redactMessage(value) {
  return String(value || 'Preview session failed.')
    .replace(/[A-Za-z]:[\\/][^\s'"`]+/g, '<redacted-path>')
    .replace(/\/(?:Users|home|private|tmp)\/[^\s'"`]+/g, '<redacted-path>')
    .replace(/(^|[\s('"`])\/(?!\/)[^\s'"`)]+/g, '$1<redacted-path>');
}

function fail(code, message) {
  throw new PreviewSessionError(code, message);
}

function nonEmptyString(value, label) {
  if (typeof value !== 'string' || !value.trim()) fail('INVALID_PREVIEW_REQUEST', `${label} must be a non-empty string.`);
  return value.trim();
}

function normalizeProjectId(value) {
  const projectId = nonEmptyString(value, 'projectId');
  if (!/^[a-z0-9][a-z0-9._-]{0,95}$/i.test(projectId)) fail('INVALID_PREVIEW_REQUEST', 'projectId contains unsupported characters.');
  return projectId;
}

function normalizeFingerprint(value) {
  const fingerprint = nonEmptyString(value, 'sourceFingerprint').toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(fingerprint)) fail('INVALID_PREVIEW_REQUEST', 'sourceFingerprint must be a SHA-256 digest.');
  return fingerprint;
}

function clampInteger(value, minimum, maximum, fallback = minimum) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.round(number)));
}

function normalizeBounds(bounds) {
  if (!bounds || typeof bounds !== 'object' || Array.isArray(bounds)) fail('INVALID_PREVIEW_BOUNDS', 'Preview bounds must be an object.');
  return {
    x: clampInteger(bounds.x, 0, 100000, 0),
    y: clampInteger(bounds.y, 0, 100000, 0),
    width: clampInteger(bounds.width, MIN_PREVIEW_SIZE, MAX_PREVIEW_SIZE, MIN_PREVIEW_SIZE),
    height: clampInteger(bounds.height, MIN_PREVIEW_SIZE, MAX_PREVIEW_SIZE, MIN_PREVIEW_SIZE),
  };
}

function normalizeRuntime(runtime) {
  if (typeof runtime === 'string' && runtime.trim()) return runtime;
  const runtimePath = runtime && typeof runtime === 'object'
    ? (runtime.runtimePath || runtime.path || runtime.entrypointPath)
    : null;
  if (typeof runtimePath !== 'string' || !runtimePath.trim()) fail('PREVIEW_RUNTIME_UNAVAILABLE', 'No matching Cubism runtime is available for this Source Package.');
  return runtimePath;
}

function sourceKind(record) {
  const kind = record.kind || record.sourceKind || record.manifest?.source?.kind;
  if (kind === 'pck' || kind === 'destiny-child-pck') return 'pck';
  if (kind === 'directory' || kind === 'standard-directory') return 'directory';
  const inputPath = record.inputPath || record.sourceRoot || record.pckPath;
  return typeof inputPath === 'string' && path.extname(inputPath).toLowerCase() === '.pck' ? 'pck' : 'directory';
}

function viewWebContents(view) {
  const webContents = view && view.webContents;
  if (!webContents || typeof webContents !== 'object') fail('INVALID_PREVIEW_VIEW', 'Preview view factory did not return a WebContentsView-like object.');
  return webContents;
}

function isDestroyed(value) {
  return Boolean(value && typeof value.isDestroyed === 'function' && value.isDestroyed());
}

function createPreviewSessionService({
  ownerWindow,
  createView,
  resolveSource,
  resolveRuntime,
  parsePck = defaultParsePck,
  createAssetServer = createRendererAssetServer,
  createPage = createElectronWebContentsPage,
  createAdapter = createPixiLive2dAdapter,
  createRendererSource = pixiSourceFromManifest,
  loadPage = async ({ webContents, url }) => webContents.loadURL(url),
  vendorPaths = null,
  onStatus = null,
} = {}) {
  if (!ownerWindow || typeof ownerWindow !== 'object') fail('INVALID_PREVIEW_SERVICE', 'Preview session requires an owner window.');
  if (typeof createView !== 'function') fail('INVALID_PREVIEW_SERVICE', 'Preview session requires a view factory.');
  if (typeof resolveSource !== 'function') fail('INVALID_PREVIEW_SERVICE', 'Preview session requires a Source registry resolver.');
  if (typeof resolveRuntime !== 'function') fail('INVALID_PREVIEW_SERVICE', 'Preview session requires a runtime resolver.');
  for (const [label, dependency] of Object.entries({ parsePck, createAssetServer, createPage, createAdapter, createRendererSource, loadPage })) {
    if (typeof dependency !== 'function') fail('INVALID_PREVIEW_SERVICE', `Preview session ${label} must be a function.`);
  }
  if (onStatus !== null && typeof onStatus !== 'function') fail('INVALID_PREVIEW_SERVICE', 'Preview session onStatus must be a function when provided.');

  let state = SESSION_STATES.idle;
  let projectId = null;
  let sourceFingerprint = null;
  let bounds = null;
  let visible = false;
  let error = null;
  let view = null;
  let adapter = null;
  let assetServer = null;
  let generation = 0;
  let cleanupPromise = null;
  let operationQueue = Promise.resolve();
  const listeners = [];

  function enqueue(operation) {
    const result = operationQueue.then(operation, operation);
    operationQueue = result.then(() => undefined, () => undefined);
    return result;
  }

  function getStatus() {
    let playback = null;
    if (state === SESSION_STATES.ready && adapter && typeof adapter.getState === 'function') {
      try { playback = adapter.getState(); } catch {}
    }
    return {
      schemaVersion: 1,
      state,
      projectId,
      sourceFingerprint,
      visible,
      bounds: bounds ? { ...bounds } : null,
      ...(playback ? { playback } : {}),
      ...(error ? { error: { ...error } } : {}),
    };
  }

  function emitStatus() {
    if (!onStatus) return;
    try { onStatus(getStatus()); } catch {}
  }

  function removeListeners() {
    while (listeners.length) {
      const [target, eventName, listener] = listeners.pop();
      try { target.removeListener(eventName, listener); } catch {}
    }
  }

  function removeView(currentView) {
    if (!currentView) return;
    const contentView = ownerWindow.contentView;
    if (contentView && typeof contentView.removeChildView === 'function') {
      try { contentView.removeChildView(currentView); } catch {}
    } else if (typeof ownerWindow.removeBrowserView === 'function') {
      try { ownerWindow.removeBrowserView(currentView); } catch {}
    }
  }

  async function destroyResources() {
    if (cleanupPromise) return cleanupPromise;
    const currentAdapter = adapter;
    const currentView = view;
    const currentServer = assetServer;
    adapter = null;
    view = null;
    assetServer = null;
    cleanupPromise = (async () => {
      removeListeners();
      if (currentAdapter && typeof currentAdapter.unload === 'function') {
        try { await currentAdapter.unload(); } catch {}
      }
      removeView(currentView);
      const webContents = currentView && currentView.webContents;
      if (webContents && !isDestroyed(webContents)) {
        try {
          if (typeof webContents.close === 'function') webContents.close();
          else if (typeof webContents.destroy === 'function') webContents.destroy();
        } catch {}
      }
      if (currentServer && typeof currentServer.close === 'function') {
        try { await currentServer.close(); } catch {}
      }
    })();
    try { await cleanupPromise; } finally { cleanupPromise = null; }
  }

  function typedError(cause, fallbackCode = 'PREVIEW_SESSION_FAILED') {
    if (cause instanceof PreviewSessionError) return cause;
    const code = typeof cause?.code === 'string' && /^[A-Z0-9_]+$/.test(cause.code) ? cause.code : fallbackCode;
    return new PreviewSessionError(code, cause && cause.message ? cause.message : cause);
  }

  async function failSession(cause, token = generation, fallbackCode) {
    if (token !== generation) return typedError(cause, fallbackCode);
    const typed = typedError(cause, fallbackCode);
    error = { code: typed.code, message: typed.message };
    state = SESSION_STATES.failed;
    visible = false;
    await destroyResources();
    emitStatus();
    return typed;
  }

  function attachViewFailureListeners(currentView, token) {
    const webContents = viewWebContents(currentView);
    const add = (target, eventName, listener) => {
      if (!target || typeof target.on !== 'function') return;
      target.on(eventName, listener);
      listeners.push([target, eventName, listener]);
    };
    const processGone = (_event, details = {}) => {
      const reason = details && typeof details.reason === 'string' ? ` (${details.reason})` : '';
      void enqueue(() => failSession(new PreviewSessionError('PREVIEW_PROCESS_GONE', `Preview renderer process exited${reason}.`), token));
    };
    const loadFailed = (_event, code, description) => {
      if (code === -3) return;
      void enqueue(() => failSession(new PreviewSessionError('PREVIEW_PAGE_LOAD_FAILED', `Preview page failed to load (${code}: ${description || 'unknown error'}).`), token));
    };
    const destroyed = () => {
      if (token === generation && state !== SESSION_STATES.idle) {
        void enqueue(() => failSession(new PreviewSessionError('PREVIEW_VIEW_DESTROYED', 'Preview view was destroyed unexpectedly.'), token));
      }
    };
    add(webContents, 'render-process-gone', processGone);
    add(webContents, 'did-fail-load', loadFailed);
    add(webContents, 'destroyed', destroyed);
  }

  function addView(currentView) {
    const contentView = ownerWindow.contentView;
    if (contentView && typeof contentView.addChildView === 'function') contentView.addChildView(currentView);
    else if (typeof ownerWindow.addBrowserView === 'function') ownerWindow.addBrowserView(currentView);
    else fail('INVALID_PREVIEW_SERVICE', 'Owner window cannot attach a preview view.');
  }

  function applyLayout(currentView, nextBounds, nextVisible) {
    if (typeof currentView.setBounds !== 'function') fail('INVALID_PREVIEW_VIEW', 'Preview view does not support bounds updates.');
    currentView.setBounds(nextBounds);
    if (typeof currentView.setVisible === 'function') currentView.setVisible(nextVisible);
  }

  async function closeNow() {
    generation += 1;
    await destroyResources();
    state = SESSION_STATES.idle;
    projectId = null;
    sourceFingerprint = null;
    bounds = null;
    visible = false;
    error = null;
    emitStatus();
    return getStatus();
  }

  async function openNow(input = {}) {
    const requestedProjectId = normalizeProjectId(input.projectId);
    const requestedFingerprint = normalizeFingerprint(input.sourceFingerprint);
    const requestedBounds = normalizeBounds(input.bounds);
    const requestedVisible = input.visible !== false;
    await closeNow();
    const token = ++generation;
    state = SESSION_STATES.opening;
    projectId = requestedProjectId;
    sourceFingerprint = requestedFingerprint;
    bounds = requestedBounds;
    visible = requestedVisible;
    emitStatus();
    try {
      const record = await resolveSource({ projectId: requestedProjectId, sourceFingerprint: requestedFingerprint });
      if (!record || typeof record !== 'object' || !record.manifest) fail('PREVIEW_SOURCE_NOT_FOUND', 'The project Source Package is no longer available.');
      const recordFingerprint = String(record.sourceFingerprint || record.manifest.source?.fingerprint || '').toLowerCase();
      if (recordFingerprint !== requestedFingerprint) fail('PREVIEW_SOURCE_MISMATCH', 'The project Source Package does not match the requested fingerprint.');
      const cubismVersion = Number(record.manifest.model?.cubism);
      if (![2, 3, 4, 5].includes(cubismVersion)) fail('UNSUPPORTED_CUBISM_VERSION', 'The Source Package has an unsupported Cubism generation.');
      const runtimePath = normalizeRuntime(await resolveRuntime(cubismVersion));
      const kind = sourceKind(record);
      const inputPath = record.inputPath || record.sourceRoot || record.pckPath;
      let sourceOptions;
      if (kind === 'pck') {
        if (typeof inputPath !== 'string' || !inputPath.trim()) fail('PREVIEW_SOURCE_NOT_FOUND', 'The PCK Source Package is no longer available.');
        const parsed = await parsePck(inputPath, record.bytes || null);
        if (!parsed || (!(parsed.buffers instanceof Map) && (!parsed.buffers || typeof parsed.buffers !== 'object'))) fail('INVALID_PREVIEW_SOURCE', 'The PCK parser returned no preview resources.');
        sourceOptions = { sourceBuffers: parsed.buffers };
      } else {
        const sourceRoot = record.sourceRoot || record.inputPath;
        if (typeof sourceRoot !== 'string' || !sourceRoot.trim()) fail('PREVIEW_SOURCE_NOT_FOUND', 'The Source Package directory is no longer available.');
        sourceOptions = { sourceRoot };
      }
      const previewAssets = typeof vendorPaths === 'function' ? await vendorPaths(cubismVersion) : vendorPaths;
      assetServer = await createAssetServer({ ...sourceOptions, runtimePath, previewAssets });
      if (token !== generation) return getStatus();
      const previewUrl = assetServer.previewUrl || (assetServer.baseUrl ? `${assetServer.baseUrl}/preview` : null);
      if (!previewUrl) fail('INVALID_PREVIEW_SERVER', 'Preview asset server did not provide a preview URL.');
      view = await createView({ projectId: requestedProjectId });
      const webContents = viewWebContents(view);
      const guardNavigation = (event, targetUrl) => { if (targetUrl !== previewUrl && typeof event?.preventDefault === 'function') event.preventDefault(); };
      if (typeof webContents.on === 'function') {
        webContents.on('will-navigate', guardNavigation);
        listeners.push([webContents, 'will-navigate', guardNavigation]);
        webContents.on('will-redirect', guardNavigation);
        listeners.push([webContents, 'will-redirect', guardNavigation]);
      }
      attachViewFailureListeners(view, token);
      addView(view);
      applyLayout(view, requestedBounds, requestedVisible);
      await loadPage({ view, webContents, url: previewUrl });
      if (token !== generation) return getStatus();
      if (state === SESSION_STATES.failed) throw new PreviewSessionError(error.code, error.message);
      const page = await createPage({ webContents, view });
      adapter = await createAdapter({ page, cubismVersion, width: requestedBounds.width, height: requestedBounds.height, playbackMode: 'realtime' });
      if (!adapter || typeof adapter.load !== 'function') fail('INVALID_PREVIEW_ADAPTER', 'Preview adapter factory returned an invalid adapter.');
      const rendererSource = await createRendererSource(record.manifest, { baseUrl: `${assetServer.baseUrl}/model` });
      await adapter.load(rendererSource);
      if (token !== generation) return getStatus();
      state = SESSION_STATES.ready;
      error = null;
      emitStatus();
      return getStatus();
    } catch (cause) {
      const typed = await failSession(cause, token, 'PREVIEW_OPEN_FAILED');
      throw typed;
    }
  }

  async function layoutNow(input = {}) {
    if (state !== SESSION_STATES.ready || !view) fail('PREVIEW_NOT_READY', 'Preview session is not ready.');
    const nextBounds = input.bounds === undefined ? bounds : normalizeBounds(input.bounds);
    if (!nextBounds) fail('INVALID_PREVIEW_BOUNDS', 'Preview bounds are required before showing the preview.');
    const nextVisible = input.visible !== false;
    if (adapter && bounds && (nextBounds.width !== bounds.width || nextBounds.height !== bounds.height) && typeof adapter.resize === 'function') {
      try {
        await adapter.resize(nextBounds.width, nextBounds.height);
      } catch (cause) {
        const typed = await failSession(cause, generation, 'PREVIEW_RESIZE_FAILED');
        throw typed;
      }
    }
    applyLayout(view, nextBounds, nextVisible);
    bounds = nextBounds;
    visible = nextVisible;
    emitStatus();
    return getStatus();
  }

  async function invokeNow(method, ...args) {
    if (state !== SESSION_STATES.ready || !adapter) fail('PREVIEW_NOT_READY', 'Preview session is not ready.');
    try {
      if (typeof adapter[method] !== 'function') fail('INVALID_PREVIEW_ADAPTER', `Preview adapter does not implement ${method}.`);
      await adapter[method](...args);
      emitStatus();
      return getStatus();
    } catch (cause) {
      const typed = await failSession(cause, generation, 'PREVIEW_COMMAND_FAILED');
      throw typed;
    }
  }

  async function play(input = {}) {
    const motionId = nonEmptyString(input.motionId, 'motionId');
    const loop = input.loop === undefined ? true : input.loop;
    const speed = input.speed === undefined ? 1 : Number(input.speed);
    if (typeof loop !== 'boolean') fail('INVALID_PREVIEW_REQUEST', 'loop must be a boolean.');
    if (!Number.isFinite(speed) || speed < 0.05 || speed > 8) fail('INVALID_PREVIEW_REQUEST', 'speed must be between 0.05 and 8.');
    return enqueue(() => invokeNow('playMotion', motionId, { loop, speed, start: 0 }));
  }

  async function setExpression(input = {}) {
    const expressionId = input.expressionId == null ? null : nonEmptyString(input.expressionId, 'expressionId');
    return enqueue(() => invokeNow('setExpression', expressionId));
  }

  async function control(input = {}) {
    const action = nonEmptyString(input.action, 'action');
    if (action === 'seek') {
      if (!Number.isFinite(input.time) || input.time < 0 || input.time > 3600) fail('INVALID_PREVIEW_CONTROL', 'Seek time must be between 0 and 3600 seconds.');
      return enqueue(() => invokeNow('seek', input.time));
    }
    if (!['pause', 'resume', 'restart'].includes(action)) fail('INVALID_PREVIEW_CONTROL', 'Preview control action must be pause, resume, restart, or seek.');
    return enqueue(() => invokeNow(action));
  }

  async function withRenderer(input = {}, operation) {
    if (typeof operation !== 'function') fail('INVALID_PREVIEW_REQUEST', 'Renderer operation must be a function.');
    const requestedProjectId = normalizeProjectId(input.projectId);
    const requestedFingerprint = normalizeFingerprint(input.sourceFingerprint);
    const requestedBounds = input.bounds === undefined
      ? (bounds || { x: 0, y: 0, width: 768, height: 768 })
      : normalizeBounds(input.bounds);
    return enqueue(async () => {
      const matches = state === SESSION_STATES.ready
        && adapter
        && projectId === requestedProjectId
        && sourceFingerprint === requestedFingerprint;
      if (!matches) await openNow({ projectId: requestedProjectId, sourceFingerprint: requestedFingerprint, bounds: requestedBounds, visible: false });
      else if (visible) await layoutNow({ visible: false });
      if (state !== SESSION_STATES.ready || !adapter) fail('PREVIEW_NOT_READY', 'Preview renderer is not ready for capture.');
      return operation(adapter);
    });
  }

  return Object.freeze({
    open: (input) => enqueue(() => openNow(input)),
    layout: (input) => enqueue(() => layoutNow(input)),
    play,
    setExpression,
    control,
    close: () => enqueue(closeNow),
    getStatus,
    readStatus: () => enqueue(async () => {
      if (state === SESSION_STATES.ready && adapter?.readState) await adapter.readState();
      return getStatus();
    }),
    withRenderer,
  });
}

module.exports = {
  MAX_PREVIEW_SIZE,
  MIN_PREVIEW_SIZE,
  PreviewSessionError,
  SESSION_STATES,
  createPreviewSessionService,
  normalizeBounds,
  normalizeFingerprint,
  normalizeProjectId,
  redactMessage,
};
