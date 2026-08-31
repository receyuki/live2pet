const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const { ProjectValidationError, validateProject } = require('../../project/src/index.cjs');

const PROTOCOL_VERSION = 1;
const DEFAULT_IDLE_TIMEOUT_MS = 15 * 60 * 1000;
const MAX_BODY_BYTES = 2 * 1024 * 1024;
const MAX_MAPPER_HTML_BYTES = 4 * 1024 * 1024;
const MAX_MAPPER_ASSETS = 128;
const MAX_MAPPER_ASSET_BYTES = 16 * 1024 * 1024;
const MAX_MAPPER_ASSET_TOTAL_BYTES = 64 * 1024 * 1024;
const LOOPBACK_HOST = '127.0.0.1';
const MAPPER_PATH = '/mapper';

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

function htmlResponse(html, status = 200, headers = {}) {
  const body = Buffer.from(html, 'utf8');
  return {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'content-security-policy': "default-src 'self'; script-src 'self' 'unsafe-inline' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; connect-src 'self'; font-src 'self' data:; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
      'x-content-type-options': 'nosniff',
      'content-length': String(body.length),
      ...headers,
    },
    body,
  };
}

function normalizeMapperAssetPath(value) {
  if (typeof value !== 'string' || !value.trim()) fail('INVALID_MAPPER_ASSET', 'Mapper asset paths must be non-empty strings.');
  const replaced = value.replaceAll('\\', '/');
  if (replaced.includes('\0') || replaced.startsWith('/') || /^[a-z]:\//i.test(replaced)) fail('INVALID_MAPPER_ASSET', `Mapper asset path is not safely relative: ${value}`);
  const normalized = path.posix.normalize(replaced);
  if (!normalized || normalized === '.' || normalized === '..' || normalized.startsWith('../')) fail('INVALID_MAPPER_ASSET', `Mapper asset path escapes its bundle: ${value}`);
  return normalized;
}

function mapperAssetContentType(relativePath) {
  const extension = path.posix.extname(relativePath).toLowerCase();
  return {
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.txt': 'text/plain; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.wasm': 'application/wasm',
  }[extension] || 'application/octet-stream';
}

function normalizeMapperAssets(input) {
  if (input == null) return new Map();
  const entries = input instanceof Map ? [...input.entries()] : input && typeof input === 'object' && !Array.isArray(input) ? Object.entries(input) : null;
  if (!entries) fail('INVALID_MAPPER_ASSET', 'Mapper assets must be a Map or an object keyed by relative paths.');
  if (entries.length > MAX_MAPPER_ASSETS) fail('MAPPER_ASSET_LIMIT', `Mapper assets cannot contain more than ${MAX_MAPPER_ASSETS} files.`);
  const assets = new Map();
  let total = 0;
  for (const [rawName, rawValue] of entries) {
    const name = normalizeMapperAssetPath(rawName);
    if (assets.has(name)) fail('DUPLICATE_MAPPER_ASSET', `Mapper asset is declared more than once: ${name}`);
    const body = typeof rawValue === 'string' ? Buffer.from(rawValue, 'utf8') : Buffer.isBuffer(rawValue) ? Buffer.from(rawValue) : rawValue instanceof Uint8Array ? Buffer.from(rawValue) : null;
    if (!body || !body.length) fail('INVALID_MAPPER_ASSET', `Mapper asset cannot be empty: ${name}`);
    if (body.length > MAX_MAPPER_ASSET_BYTES) fail('MAPPER_ASSET_TOO_LARGE', `Mapper asset exceeds the ${MAX_MAPPER_ASSET_BYTES}-byte limit: ${name}`);
    total += body.length;
    if (total > MAX_MAPPER_ASSET_TOTAL_BYTES) fail('MAPPER_ASSET_TOTAL_TOO_LARGE', `Mapper assets exceed the ${MAX_MAPPER_ASSET_TOTAL_BYTES}-byte total limit.`);
    assets.set(name, { body, contentType: mapperAssetContentType(name) });
  }
  return assets;
}

function readMapperAssets(root) {
  if (typeof root !== 'string' || !root.trim()) throw new MapperSessionError('MAPPER_ASSET_ROOT_REQUIRED', 'mapperAssetRoot must be a non-empty directory path.');
  let stat;
  try { stat = fs.statSync(root); } catch (error) { throw new MapperSessionError('MAPPER_ASSET_ROOT_READ_FAILED', 'The Mapper asset directory could not be read.', { cause: error && error.code ? error.code : 'UNKNOWN' }); }
  if (!stat.isDirectory()) throw new MapperSessionError('MAPPER_ASSET_ROOT_READ_FAILED', 'The Mapper asset root is not a directory.');
  const entries = [];
  function visit(directory, relativeDirectory) {
    const children = fs.readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name));
    for (const child of children) {
      const absolute = path.join(directory, child.name);
      const relative = relativeDirectory ? `${relativeDirectory}/${child.name}` : child.name;
      if (child.isSymbolicLink()) throw new MapperSessionError('UNSUPPORTED_MAPPER_ASSET', `Mapper asset bundle contains a symbolic link: ${relative}`);
      if (child.isDirectory()) { visit(absolute, relative); continue; }
      if (!child.isFile()) throw new MapperSessionError('UNSUPPORTED_MAPPER_ASSET', `Mapper asset bundle entry is not a regular file: ${relative}`);
      entries.push({ relative: normalizeMapperAssetPath(relative), absolute });
      if (entries.length > MAX_MAPPER_ASSETS) throw new MapperSessionError('MAPPER_ASSET_LIMIT', `Mapper assets cannot contain more than ${MAX_MAPPER_ASSETS} files.`);
    }
  }
  visit(root, '');
  const assets = new Map();
  for (const entry of entries) {
    const data = fs.readFileSync(entry.absolute);
    assets.set(entry.relative, data);
  }
  return assets;
}

function resolveMapperUrl(value, fallback) {
  const candidate = value === undefined ? fallback : value;
  if (typeof candidate !== 'string' || !candidate.trim()) throw new MapperSessionError('INVALID_MAPPER_URL', 'mapperUrl must be a non-empty URL string.');
  let parsed;
  try { parsed = new URL(candidate); } catch { throw new MapperSessionError('INVALID_MAPPER_URL', 'mapperUrl must be a valid URL.'); }
  if (parsed.protocol === 'file:') return candidate;
  if (parsed.protocol === 'http:' && parsed.hostname === LOOPBACK_HOST) return candidate;
  throw new MapperSessionError('INVALID_MAPPER_URL', 'mapperUrl must use a file URL or loopback http URL.');
}

function readMapperHtml(mapperPath) {
  if (typeof mapperPath !== 'string' || !mapperPath.trim()) throw new MapperSessionError('MAPPER_PATH_REQUIRED', 'mapperPath is required when mapperHtml is not provided.');
  let stat;
  try { stat = fs.statSync(mapperPath); } catch (error) { throw new MapperSessionError('MAPPER_READ_FAILED', 'The Mapper document could not be read.', { cause: error && error.code ? error.code : 'UNKNOWN' }); }
  if (!stat.isFile()) throw new MapperSessionError('MAPPER_READ_FAILED', 'The Mapper document path is not a file.');
  if (stat.size > MAX_MAPPER_HTML_BYTES) throw new MapperSessionError('INVALID_MAPPER_HTML', `mapperHtml must be a UTF-8 string no larger than ${MAX_MAPPER_HTML_BYTES} bytes.`);
  try { return fs.readFileSync(mapperPath, 'utf8'); } catch (error) { throw new MapperSessionError('MAPPER_READ_FAILED', 'The Mapper document could not be read.', { cause: error && error.code ? error.code : 'UNKNOWN' }); }
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

function startMapperSession({ project, allowedOrigins, mapperHtml, mapperAssets, host = LOOPBACK_HOST, port = 0, idleTimeoutMs = DEFAULT_IDLE_TIMEOUT_MS } = {}) {
  if (host !== LOOPBACK_HOST) return Promise.reject(new MapperSessionError('NON_LOOPBACK_BINDING', 'Mapper Sessions can bind only to 127.0.0.1.'));
  if (!Number.isInteger(port) || port < 0 || port > 65535) return Promise.reject(new MapperSessionError('INVALID_PORT', 'Mapper Session port must be an integer between 0 and 65535.'));
  if (!Number.isInteger(idleTimeoutMs) || idleTimeoutMs < 1000 || idleTimeoutMs > 24 * 60 * 60 * 1000) return Promise.reject(new MapperSessionError('INVALID_IDLE_TIMEOUT', 'Mapper Session idleTimeoutMs must be between 1000 and 86400000.'));
  let currentProject;
  let origins;
  if (mapperHtml !== undefined && (typeof mapperHtml !== 'string' || Buffer.byteLength(mapperHtml, 'utf8') > MAX_MAPPER_HTML_BYTES)) {
    return Promise.reject(new MapperSessionError('INVALID_MAPPER_HTML', `mapperHtml must be a UTF-8 string no larger than ${MAX_MAPPER_HTML_BYTES} bytes.`));
  }
  let normalizedAssets;
  try {
    currentProject = normalizeProject(project);
    origins = normalizeOrigins(allowedOrigins);
    normalizedAssets = normalizeMapperAssets(mapperAssets);
  } catch (error) {
    return Promise.reject(error);
  }

  const sessionId = crypto.randomUUID();
  const token = crypto.randomBytes(32).toString('base64url');
  const browserCode = mapperHtml === undefined ? null : crypto.randomBytes(24).toString('base64url');
  let browserCodeConsumed = false;
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
    const requestPath = new URL(request.url || '/', origin || `http://${LOOPBACK_HOST}`).pathname;
    const isMapperDocument = request.method === 'GET' && requestPath === MAPPER_PATH && mapperHtml !== undefined;
    const assetName = requestPath.startsWith('/') ? requestPath.slice(1) : requestPath;
    const mapperAsset = request.method === 'GET' ? normalizedAssets.get(assetName) : null;
    const isMapperAsset = Boolean(mapperAsset);
    if (!isMapperDocument && !isAllowedOrigin(requestOrigin)) {
      failRequest(response, new MapperSessionError('ORIGIN_NOT_ALLOWED', 'The request Origin is not allowed for this Mapper Session.'), 403);
      return;
    }
    const corsHeaders = { 'access-control-allow-origin': requestOrigin, vary: 'Origin' };
    if (isMapperDocument) {
      writeResponse(response, htmlResponse(mapperHtml, 200));
      return;
    }
    if (isMapperAsset) {
      writeResponse(response, {
        status: 200,
        headers: { 'content-type': mapperAsset.contentType, 'cache-control': 'no-store', 'content-length': String(mapperAsset.body.length), 'x-content-type-options': 'nosniff', ...corsHeaders },
        body: mapperAsset.body,
      });
      return;
    }
    if (request.method === 'OPTIONS') {
      writeResponse(response, jsonResponse({ protocolVersion: PROTOCOL_VERSION, ok: true }, 204, { ...corsHeaders, 'access-control-allow-methods': 'GET, PUT, POST, OPTIONS', 'access-control-allow-headers': 'Authorization, Content-Type' }));
      return;
    }
    if (request.method === 'POST' && requestPath === '/bootstrap') {
      try {
        const body = await readJsonBody(request);
        const candidate = body && typeof body.code === 'string' ? body.code : '';
        const expected = Buffer.from(browserCode || '');
        const actual = Buffer.from(candidate);
        if (browserCodeConsumed || !browserCode || actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) {
          fail('BOOTSTRAP_INVALID', 'The Mapper Session browser bootstrap code is invalid or already used.');
        }
        browserCodeConsumed = true;
        armTimer();
        writeResponse(response, jsonResponse({ protocolVersion: PROTOCOL_VERSION, ok: true, token, expiresAt }, 200, corsHeaders));
      } catch (error) {
        const typed = error instanceof MapperSessionError;
        failRequest(response, typed ? error : new MapperSessionError('BOOTSTRAP_FAILED', error.message || String(error)), typed && error.code === 'REQUEST_TOO_LARGE' ? 413 : 401);
      }
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
      else origins.add(origin);
      armTimer();
      resolve({
        protocolVersion: PROTOCOL_VERSION,
        sessionId,
        token,
        origin,
        port: address.port,
        expiresAt,
        getMapperUrl: ({ mapperUrl = `${origin}${MAPPER_PATH}` } = {}) => {
          if (mapperHtml === undefined) return null;
          if (browserCodeConsumed) return null;
          const safeMapperUrl = resolveMapperUrl(mapperUrl, `${origin}${MAPPER_PATH}`);
          return `${safeMapperUrl}#live2pet=${encodeURIComponent(origin)}.${browserCode}`;
        },
        get closed() { return closed; },
        close: closeServer,
      });
    });
  });
}

async function startMapperSessionHost({ project, mapperHtml, mapperPath, mapperUrl, mapperAssetRoot, mapperAssets, allowedOrigins, host = LOOPBACK_HOST, port = 0, idleTimeoutMs = DEFAULT_IDLE_TIMEOUT_MS } = {}) {
  const document = mapperHtml === undefined ? readMapperHtml(mapperPath) : mapperHtml;
  const assets = mapperAssets === undefined && mapperAssetRoot !== undefined ? readMapperAssets(mapperAssetRoot) : mapperAssets;
  const resolvedMapperUrl = mapperUrl === undefined && mapperPath ? resolveMapperUrl(pathToFileURL(path.resolve(mapperPath)).href) : mapperUrl === undefined ? undefined : resolveMapperUrl(mapperUrl);
  let origins = allowedOrigins;
  if (origins === undefined && resolvedMapperUrl) {
    const parsed = new URL(resolvedMapperUrl);
    origins = parsed.protocol === 'file:' ? ['null'] : [parsed.origin];
  }
  const session = await startMapperSession({ project, mapperHtml: document, mapperAssets: assets, allowedOrigins: origins, host, port, idleTimeoutMs });
  const launchUrl = () => session.getMapperUrl({ mapperUrl: resolvedMapperUrl || `${session.origin}${MAPPER_PATH}` });
  return Object.freeze({
    protocolVersion: session.protocolVersion,
    sessionId: session.sessionId,
    origin: session.origin,
    expiresAt: session.expiresAt,
    getLaunchUrl: launchUrl,
    getLaunchDescriptor: () => ({ protocolVersion: session.protocolVersion, sessionId: session.sessionId, origin: session.origin, expiresAt: session.expiresAt, mapperUrl: launchUrl() }),
    getClient: () => createMapperSessionClient({ origin: session.origin, token: session.token }),
    close: session.close,
  });
}

module.exports = {
  DEFAULT_IDLE_TIMEOUT_MS,
  LOOPBACK_HOST,
  MapperSessionError,
  MAX_BODY_BYTES,
  MAX_MAPPER_HTML_BYTES,
  MAPPER_PATH,
  PROTOCOL_VERSION,
  createMapperSessionClient,
  readMapperHtml,
  readMapperAssets,
  normalizeMapperAssetPath,
  normalizeMapperAssets,
  resolveMapperUrl,
  startMapperSession,
  startMapperSessionHost,
};
