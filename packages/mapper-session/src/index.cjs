const crypto = require('node:crypto');
const http = require('node:http');

const { ProjectValidationError, validateProject } = require('../../project/src/index.cjs');

const PROTOCOL_VERSION = 1;
const DEFAULT_IDLE_TIMEOUT_MS = 15 * 60 * 1000;
const MAX_BODY_BYTES = 2 * 1024 * 1024;
const LOOPBACK_HOST = '127.0.0.1';

class MapperSessionError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'MapperSessionError';
    this.code = code;
    this.details = details;
  }
}

function createMapperSessionClient({ origin, token, fetchImpl = globalThis.fetch } = {}) {
  if (typeof origin !== 'string' || !origin.trim()) throw new MapperSessionError('SESSION_ORIGIN_REQUIRED', 'Mapper Session origin is required.');
  let parsed;
  try { parsed = new URL(origin); } catch { throw new MapperSessionError('SESSION_ORIGIN_INVALID', 'Mapper Session origin must be a valid URL.'); }
  if (parsed.protocol !== 'http:' || parsed.hostname !== LOOPBACK_HOST) throw new MapperSessionError('SESSION_ORIGIN_INVALID', 'Mapper Session client accepts only a loopback http origin.');
  if (typeof token !== 'string' || token.length < 40) throw new MapperSessionError('SESSION_TOKEN_REQUIRED', 'Mapper Session token is required.');
  if (typeof fetchImpl !== 'function') throw new MapperSessionError('SESSION_FETCH_UNAVAILABLE', 'A fetch implementation is required for Mapper Session access.');

  async function request(pathname, options = {}) {
    let response;
    try {
      response = await fetchImpl(`${origin}${pathname}`, {
        ...options,
        headers: { Origin: origin, Authorization: `Bearer ${token}`, ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) },
      });
    } catch (error) {
      throw new MapperSessionError('SESSION_REQUEST_FAILED', 'Mapper Session request failed.', { cause: error && error.message ? error.message : String(error) });
    }
    let body = null;
    try { body = await response.json(); } catch {
      throw new MapperSessionError('SESSION_RESPONSE_INVALID', 'Mapper Session returned invalid JSON.', { status: response.status });
    }
    if (!response.ok || body?.ok === false) {
      const detail = body?.error || {};
      throw new MapperSessionError(detail.code || 'SESSION_REQUEST_REJECTED', detail.message || 'Mapper Session request was rejected.', detail.details || {});
    }
    return body;
  }

  return Object.freeze({
    getSession: () => request('/session'),
    getProject: () => request('/project'),
    updateProject: (project) => request('/project', { method: 'PUT', body: JSON.stringify(project) }),
    close: () => request('/close', { method: 'POST' }),
  });
}

function fail(code, message, details = {}) {
  throw new MapperSessionError(code, message, details);
}

function cloneJson(value, label) {
  try { return JSON.parse(JSON.stringify(value)); } catch (error) { fail('INVALID_PROJECT', `${label} must be JSON-serializable.`, { cause: String(error.message || error) }); }
}

function normalizeProject(project) {
  if (!project || typeof project !== 'object' || Array.isArray(project)) fail('PROJECT_REQUIRED', 'A Live2Pet Project is required to start a Mapper Session.');
  try { return validateProject(cloneJson(project, 'project')); } catch (error) {
    if (error instanceof ProjectValidationError) fail(error.code, error.message, error.details);
    throw error;
  }
}

function normalizeOrigins(origins) {
  if (origins == null) return null;
  if (!Array.isArray(origins) || origins.some((origin) => typeof origin !== 'string' || !origin.trim())) fail('INVALID_ORIGIN_ALLOWLIST', 'allowedOrigins must be an array of non-empty origin strings.');
  return new Set(origins.map((origin) => origin.trim()));
}

function jsonResponse(value, status = 200, headers = {}) {
  const body = Buffer.from(`${JSON.stringify(value)}\n`, 'utf8');
  return { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'content-length': String(body.length), ...headers }, body };
}

function errorResponse(error, status = 400) {
  return jsonResponse({ protocolVersion: PROTOCOL_VERSION, ok: false, error: { code: error.code || 'MAPPER_SESSION_FAILED', message: error.message || String(error), details: error.details || {} } }, status);
}

function writeResponse(response, result) {
  response.writeHead(result.status, result.headers);
  response.end(result.body);
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    const contentLength = Number(request.headers['content-length']);
    if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
      reject(new MapperSessionError('REQUEST_TOO_LARGE', `Mapper Session request exceeds the ${MAX_BODY_BYTES}-byte limit.`));
      request.resume();
      return;
    }
    const chunks = [];
    let size = 0;
    let settled = false;
    const rejectOnce = (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    request.on('data', (chunk) => {
      if (settled) return;
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        rejectOnce(new MapperSessionError('REQUEST_TOO_LARGE', `Mapper Session request exceeds the ${MAX_BODY_BYTES}-byte limit.`));
        request.resume();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      if (settled) return;
      try {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve(text ? JSON.parse(text) : {});
      } catch (error) {
        rejectOnce(new MapperSessionError('INVALID_JSON', 'Mapper Session request body must be valid JSON.', { cause: String(error.message || error) }));
      }
    });
    request.on('error', rejectOnce);
  });
}

function startMapperSession({ project, allowedOrigins, host = LOOPBACK_HOST, port = 0, idleTimeoutMs = DEFAULT_IDLE_TIMEOUT_MS } = {}) {
  if (host !== LOOPBACK_HOST) return Promise.reject(new MapperSessionError('NON_LOOPBACK_BINDING', 'Mapper Sessions can bind only to 127.0.0.1.'));
  if (!Number.isInteger(port) || port < 0 || port > 65535) return Promise.reject(new MapperSessionError('INVALID_PORT', 'Mapper Session port must be an integer between 0 and 65535.'));
  if (!Number.isInteger(idleTimeoutMs) || idleTimeoutMs < 1000 || idleTimeoutMs > 24 * 60 * 60 * 1000) return Promise.reject(new MapperSessionError('INVALID_IDLE_TIMEOUT', 'Mapper Session idleTimeoutMs must be between 1000 and 86400000.'));
  let currentProject;
  let origins;
  try {
    currentProject = normalizeProject(project);
    origins = normalizeOrigins(allowedOrigins);
  } catch (error) {
    return Promise.reject(error);
  }

  const sessionId = crypto.randomUUID();
  const token = crypto.randomBytes(32).toString('base64url');
  const server = http.createServer();
  let timer = null;
  let closed = false;
  let origin = null;
  let expiresAt = null;

  const clearTimer = () => { if (timer) clearTimeout(timer); timer = null; };
  const closeServer = () => new Promise((resolve) => {
    if (closed) { resolve(); return; }
    closed = true;
    clearTimer();
    server.close(() => resolve());
  });
  const armTimer = () => {
    clearTimer();
    expiresAt = new Date(Date.now() + idleTimeoutMs).toISOString();
    timer = setTimeout(() => { closeServer(); }, idleTimeoutMs);
    timer.unref?.();
  };
  const isAllowedOrigin = (requestOrigin) => Boolean(requestOrigin && origins && origins.has(requestOrigin));
  const isAuthorized = (request) => {
    const header = request.headers.authorization;
    if (typeof header !== 'string' || !header.startsWith('Bearer ')) return false;
    const candidate = Buffer.from(header.slice(7));
    const expected = Buffer.from(token);
    return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
  };
  const failRequest = (response, error, status) => writeResponse(response, errorResponse(error, status));

  server.on('request', async (request, response) => {
    const requestOrigin = typeof request.headers.origin === 'string' ? request.headers.origin : null;
    if (origins === null && origin) origins = new Set([origin]);
    if (!isAllowedOrigin(requestOrigin)) {
      failRequest(response, new MapperSessionError('ORIGIN_NOT_ALLOWED', 'The request Origin is not allowed for this Mapper Session.'), 403);
      return;
    }
    const corsHeaders = { 'access-control-allow-origin': requestOrigin, vary: 'Origin' };
    if (request.method === 'OPTIONS') {
      writeResponse(response, jsonResponse({ protocolVersion: PROTOCOL_VERSION, ok: true }, 204, { ...corsHeaders, 'access-control-allow-methods': 'GET, PUT, POST, OPTIONS', 'access-control-allow-headers': 'Authorization, Content-Type' }));
      return;
    }
    if (!isAuthorized(request)) {
      failRequest(response, new MapperSessionError('UNAUTHORIZED', 'A valid Mapper Session Bearer token is required.'), 401);
      return;
    }
    if (closed) {
      failRequest(response, new MapperSessionError('SESSION_CLOSED', 'Mapper Session is closed.'), 410);
      return;
    }
    armTimer();
    const requestPath = new URL(request.url || '/', origin).pathname;
    try {
      if (request.method === 'GET' && requestPath === '/session') {
        writeResponse(response, jsonResponse({ protocolVersion: PROTOCOL_VERSION, ok: true, sessionId, origin, expiresAt, capabilities: ['project-read', 'project-write', 'close'] }, 200, corsHeaders));
        return;
      }
      if (request.method === 'GET' && requestPath === '/project') {
        writeResponse(response, jsonResponse({ protocolVersion: PROTOCOL_VERSION, ok: true, project: cloneJson(currentProject, 'project') }, 200, corsHeaders));
        return;
      }
      if (request.method === 'PUT' && requestPath === '/project') {
        const next = normalizeProject(await readJsonBody(request));
        if (next.projectId !== currentProject.projectId) fail('PROJECT_NOT_ALLOWLISTED', 'Mapper Session can update only its original projectId.');
        currentProject = next;
        writeResponse(response, jsonResponse({ protocolVersion: PROTOCOL_VERSION, ok: true, project: cloneJson(currentProject, 'project') }, 200, corsHeaders));
        return;
      }
      if (request.method === 'POST' && requestPath === '/close') {
        writeResponse(response, jsonResponse({ protocolVersion: PROTOCOL_VERSION, ok: true }, 200, corsHeaders));
        await closeServer();
        return;
      }
      fail('NOT_FOUND', 'Mapper Session endpoint was not found.');
    } catch (error) {
      const typed = error instanceof MapperSessionError;
      const normalized = typed ? error : new MapperSessionError('MAPPER_SESSION_FAILED', error.message || String(error));
      const status = normalized.code === 'NOT_FOUND' ? 404 : normalized.code === 'REQUEST_TOO_LARGE' ? 413 : 400;
      failRequest(response, normalized, status);
    }
  });

  return new Promise((resolve, reject) => {
    const onError = (error) => reject(new MapperSessionError('SESSION_START_FAILED', error.message || String(error), { cause: error.code }));
    server.once('error', onError);
    server.listen(port, LOOPBACK_HOST, () => {
      server.removeListener('error', onError);
      const address = server.address();
      origin = `http://${LOOPBACK_HOST}:${address.port}`;
      if (origins === null) origins = new Set([origin]);
      armTimer();
      resolve({
        protocolVersion: PROTOCOL_VERSION,
        sessionId,
        token,
        origin,
        port: address.port,
        expiresAt,
        get closed() { return closed; },
        close: closeServer,
      });
    });
  });
}

module.exports = {
  DEFAULT_IDLE_TIMEOUT_MS,
  LOOPBACK_HOST,
  MapperSessionError,
  MAX_BODY_BYTES,
  PROTOCOL_VERSION,
  createMapperSessionClient,
  startMapperSession,
};
