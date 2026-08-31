const crypto = require('node:crypto');

function fail(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  throw error;
}

function isRecord(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function emptyRendererStatus() {
  return {
    protocolVersion: 1,
    active: false,
    status: {
      protocolVersion: 1,
      state: 'idle',
      generation: 0,
      hasWindow: false,
      hasRenderer: false,
    },
  };
}

/**
 * Own the one user-facing isolated preview session exposed by the Desktop
 * App. The service deliberately accepts only a selected source directory and
 * a validated runtime resolver; it never returns either absolute path to the
 * Mapper renderer.
 */
function createRendererPreviewService({
  createHost,
  loadRuntime,
  resolveRuntimeEntrypoint = (inputPath) => inputPath,
} = {}) {
  if (typeof createHost !== 'function') fail('INVALID_RENDERER_PREVIEW_SERVICE', 'Renderer preview service requires a host factory.');
  if (typeof loadRuntime !== 'function') fail('INVALID_RENDERER_PREVIEW_SERVICE', 'Renderer preview service requires a runtime loader.');
  if (typeof resolveRuntimeEntrypoint !== 'function') fail('INVALID_RENDERER_PREVIEW_SERVICE', 'Renderer preview service requires a runtime entrypoint resolver.');

  let session = null;
  let starting = false;

  function requireSession(sessionId) {
    if (!session) fail('RENDERER_PREVIEW_REQUIRED', 'Open an isolated renderer preview before issuing preview commands.');
    if (typeof sessionId !== 'string' || sessionId !== session.id) fail('RENDERER_PREVIEW_SESSION_MISMATCH', 'The isolated renderer preview session is no longer current.');
    return session;
  }

  async function start(input = {}) {
    if (!isRecord(input)) fail('INVALID_RENDERER_PREVIEW_REQUEST', 'Renderer preview start input must be an object.');
    if (session) fail('RENDERER_PREVIEW_ACTIVE', 'An isolated renderer preview is already active. Close it before opening another preview.');
    if (starting) fail('RENDERER_PREVIEW_STARTING', 'An isolated renderer preview is already starting.');
    starting = true;
    let host = null;
    try {
      const cubismVersion = Number(input.cubismVersion);
      const settings = await loadRuntime(cubismVersion);
      if (!settings || settings.available !== true || typeof settings.runtimePath !== 'string' || !settings.runtimePath.trim()) {
        fail('RENDERER_RUNTIME_REQUIRED', `No saved runtime supports Cubism generation ${String(input.cubismVersion)}. Add it to the local runtime library once, then retry.`);
      }
      const generations = settings.descriptor && Array.isArray(settings.descriptor.cubismGenerations)
        ? settings.descriptor.cubismGenerations
        : [];
      if (!generations.includes(cubismVersion)) {
        fail('RENDERER_RUNTIME_MISMATCH', `The saved Cubism runtime does not support generation ${String(input.cubismVersion)}.`);
      }
      const runtimePath = resolveRuntimeEntrypoint(settings.runtimePath);
      host = createHost({
        sourceRoot: input.sourceRoot,
        runtimePath,
        cubismVersion,
        width: input.width,
        height: input.height,
        show: input.show,
      });
      if (!host || typeof host.start !== 'function' || typeof host.close !== 'function' || typeof host.getStatus !== 'function' || typeof host.loadSource !== 'function' || typeof host.invoke !== 'function' || typeof host.restart !== 'function') {
        fail('INVALID_RENDERER_PREVIEW_HOST', 'Renderer preview host does not expose the required lifecycle methods.');
      }
      await host.start();
      const id = crypto.randomUUID();
      session = { id, host, cubismVersion };
      return {
        protocolVersion: 1,
        sessionId: id,
        kind: host.kind || 'unknown',
        cubismVersion,
        status: host.getStatus(),
      };
    } catch (error) {
      if (host && typeof host.close === 'function') {
        try { await host.close(); } catch {}
      }
      throw error;
    } finally {
      starting = false;
    }
  }

  async function loadSource({ sessionId, ...source } = {}) {
    const current = requireSession(sessionId);
    const result = await current.host.loadSource(source);
    return { protocolVersion: 1, sessionId: current.id, result };
  }

  async function command({ sessionId, method, args = [] } = {}) {
    const current = requireSession(sessionId);
    const result = await current.host.invoke(method, ...args);
    return { protocolVersion: 1, sessionId: current.id, result };
  }

  function status() {
    if (!session) return emptyRendererStatus();
    return {
      protocolVersion: 1,
      active: true,
      sessionId: session.id,
      kind: session.host.kind || 'unknown',
      cubismVersion: session.cubismVersion,
      status: session.host.getStatus(),
    };
  }

  async function restart({ sessionId } = {}) {
    const current = requireSession(sessionId);
    const rendererStatus = await current.host.restart();
    return { protocolVersion: 1, sessionId: current.id, status: rendererStatus };
  }

  async function close({ sessionId } = {}) {
    if (!session) return { protocolVersion: 1, closed: false };
    if (sessionId !== undefined && sessionId !== null && sessionId !== session.id) {
      fail('RENDERER_PREVIEW_SESSION_MISMATCH', 'The isolated renderer preview session is no longer current.');
    }
    const current = session;
    session = null;
    const rendererStatus = await current.host.close();
    return { protocolVersion: 1, closed: true, sessionId: current.id, status: rendererStatus };
  }

  return Object.freeze({ start, loadSource, command, status, restart, close });
}

module.exports = {
  createRendererPreviewService,
  emptyRendererStatus,
};
