const fs = require('node:fs');
const crypto = require('node:crypto');
const http = require('node:http');
const path = require('node:path');
const { URL } = require('node:url');

const { RendererContractError } = require('./errors.cjs');

const LOOPBACK_HOST = '127.0.0.1';
const MIME_TYPES = Object.freeze({
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.moc': 'application/octet-stream',
  '.moc3': 'application/octet-stream',
  '.mtn': 'text/plain; charset=utf-8',
  '.motion3': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
});

function fail(code, message, details = {}) {
  throw new RendererContractError(code, message, details);
}

function existingDirectory(input, label) {
  if (typeof input !== 'string' || !input.trim()) fail('INVALID_ASSET_SERVER', `${label} must be a non-empty path.`);
  const resolved = path.resolve(input);
  let stat;
  try { stat = fs.lstatSync(resolved); } catch (error) { fail('INVALID_ASSET_SERVER', `${label} does not exist.`, { cause: error.code }); }
  if (!stat.isDirectory()) fail('INVALID_ASSET_SERVER', `${label} must be a directory.`);
  return resolved;
}

function existingFile(input, label) {
  if (typeof input !== 'string' || !input.trim()) fail('INVALID_ASSET_SERVER', `${label} must be a non-empty path.`);
  const resolved = path.resolve(input);
  let stat;
  try { stat = fs.lstatSync(resolved); } catch (error) { fail('INVALID_ASSET_SERVER', `${label} does not exist.`, { cause: error.code }); }
  if (!stat.isFile()) fail('INVALID_ASSET_SERVER', `${label} must be a regular file.`);
  return resolved;
}

function safeRelativePath(root, relativePath) {
  if (typeof relativePath !== 'string' || !relativePath || relativePath.includes('\0')) return null;
  const normalized = relativePath.replaceAll('\\', '/');
  if (normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized)) return null;
  const target = path.resolve(root, normalized);
  const base = `${path.resolve(root)}${path.sep}`;
  if (!target.startsWith(base)) return null;
  return target;
}

function safeBufferPath(relativePath) {
  if (typeof relativePath !== 'string' || !relativePath || relativePath.includes('\0')) return null;
  const normalized = relativePath.replaceAll('\\', '/');
  if (normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized)) return null;
  const segments = normalized.split('/');
  if (segments.some((segment) => segment === '..')) return null;
  const canonical = segments.filter((segment) => segment && segment !== '.').join('/');
  return canonical || null;
}

function normalizeSourceBuffers(sourceBuffers) {
  const entries = sourceBuffers instanceof Map
    ? [...sourceBuffers.entries()]
    : sourceBuffers && typeof sourceBuffers === 'object' && !Array.isArray(sourceBuffers)
      ? Object.entries(sourceBuffers)
      : null;
  if (!entries) fail('INVALID_ASSET_SERVER', 'sourceBuffers must be a Map or plain object of relative paths to byte buffers.');
  if (!entries.length) fail('INVALID_ASSET_SERVER', 'sourceBuffers must contain at least one resource.');
  const buffers = new Map();
  for (const [relativePath, value] of entries) {
    const safePath = safeBufferPath(relativePath);
    if (!safePath) fail('INVALID_ASSET_SERVER', 'sourceBuffers contains an unsafe resource path.', { path: String(relativePath) });
    if (buffers.has(safePath)) fail('INVALID_ASSET_SERVER', 'sourceBuffers contains duplicate normalized resource paths.', { path: safePath });
    let buffer;
    if (Buffer.isBuffer(value)) buffer = Buffer.from(value);
    else if (ArrayBuffer.isView(value)) buffer = Buffer.from(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
    else if (value instanceof ArrayBuffer) buffer = Buffer.from(new Uint8Array(value));
    else fail('INVALID_ASSET_SERVER', 'sourceBuffers values must be Buffer, ArrayBuffer, or typed-array bytes.', { path: safePath });
    buffers.set(safePath, buffer);
  }
  return buffers;
}

function encodeRelativeUrl(relativePath) {
  return String(relativePath).split('/').map((segment) => encodeURIComponent(segment)).join('/');
}

function contentType(file) {
  return MIME_TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';
}

function jsonResponse(response, value, status = 200) {
  const body = Buffer.from(`${JSON.stringify(value)}\n`, 'utf8');
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': body.length,
  });
  response.end(body);
}

function previewDocument(runtimeName) {
  const runtimeUrl = `./runtime/${encodeURIComponent(runtimeName)}`;
  return Buffer.from(`<!doctype html>
<html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; script-src 'self'; style-src 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' blob:"><style>html,body{width:100%;height:100%;margin:0;overflow:hidden;background:transparent}canvas{width:100%;height:100%;display:block}</style></head><body><canvas id="live2pet-stage"></canvas><script src="./vendor/pixi.js"></script><script src="./vendor/unsafe-eval.js"></script><script src="${runtimeUrl}"></script><script src="./vendor/live2d-adapter.js"></script></body></html>`, 'utf8');
}

function normalizePreviewAssets(previewAssets) {
  if (previewAssets == null) return null;
  if (!previewAssets || typeof previewAssets !== 'object' || Array.isArray(previewAssets)) fail('INVALID_ASSET_SERVER', 'previewAssets must be an object.');
  return Object.freeze({
    pixi: existingFile(previewAssets.pixi, 'previewAssets.pixi'),
    unsafeEval: existingFile(previewAssets.unsafeEval, 'previewAssets.unsafeEval'),
    live2dAdapter: existingFile(previewAssets.live2dAdapter, 'previewAssets.live2dAdapter'),
  });
}

function createRendererAssetServer({ sourceRoot, sourceBuffers, runtimePath, previewAssets, host = LOOPBACK_HOST, port = 0 } = {}) {
  if (host !== LOOPBACK_HOST) return Promise.reject(new RendererContractError('NON_LOOPBACK_BINDING', 'Renderer Asset Server can bind only to 127.0.0.1.'));
  if (!Number.isInteger(port) || port < 0 || port > 65535) return Promise.reject(new RendererContractError('INVALID_ASSET_SERVER_PORT', 'Renderer Asset Server port must be an integer between 0 and 65535.'));
  let root;
  let buffers;
  let runtime;
  let preview;
  const sessionToken = crypto.randomBytes(24).toString('hex');
  try {
    const hasSourceRoot = sourceRoot !== undefined && sourceRoot !== null;
    const hasSourceBuffers = sourceBuffers !== undefined && sourceBuffers !== null;
    if (hasSourceRoot === hasSourceBuffers) fail('INVALID_ASSET_SERVER', 'Provide exactly one of sourceRoot or sourceBuffers.');
    root = hasSourceRoot ? existingDirectory(sourceRoot, 'sourceRoot') : null;
    buffers = hasSourceBuffers ? normalizeSourceBuffers(sourceBuffers) : null;
    runtime = existingFile(runtimePath, 'runtimePath');
    preview = normalizePreviewAssets(previewAssets);
  } catch (error) {
    return Promise.reject(error);
  }
  const server = http.createServer((request, response) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, { Allow: 'GET, HEAD' });
      response.end();
      return;
    }
    try {
      const requestUrl = new URL(request.url || '/', `http://${LOOPBACK_HOST}`);
      const address = server.address();
      if (!address || request.headers.host !== `${host}:${address.port}`) { response.writeHead(421); response.end(); return; }
      const prefix = `/${sessionToken}`;
      if (requestUrl.pathname !== prefix && !requestUrl.pathname.startsWith(`${prefix}/`)) { response.writeHead(404); response.end(); return; }
      const routePath = requestUrl.pathname.slice(prefix.length) || '/';
      if (routePath === '/health') {
        jsonResponse(response, { ok: true, protocolVersion: 1 });
        return;
      }
      let file = null;
      let buffer = null;
      let modelPath = null;
      if (routePath === '/preview' && preview) {
        buffer = previewDocument(path.basename(runtime));
        modelPath = 'preview.html';
      } else if (routePath.startsWith('/model/')) {
        const relativePath = decodeURIComponent(routePath.slice('/model/'.length));
        if (buffers) {
          modelPath = safeBufferPath(relativePath);
          buffer = modelPath ? buffers.get(modelPath) : null;
          if (!buffer) { response.writeHead(404); response.end(); return; }
        } else {
          file = safeRelativePath(root, relativePath);
          if (!file) { response.writeHead(404); response.end(); return; }
          const realRoot = fs.realpathSync(root);
          const realFile = fs.realpathSync(file);
          if (realFile !== realRoot && !realFile.startsWith(`${realRoot}${path.sep}`)) { response.writeHead(404); response.end(); return; }
          if (!fs.statSync(realFile).isFile()) { response.writeHead(404); response.end(); return; }
          file = realFile;
          modelPath = relativePath;
        }
      } else if (routePath === `/runtime/${encodeURIComponent(path.basename(runtime))}`) {
        file = runtime;
      } else if (preview && routePath === '/vendor/pixi.js') {
        file = preview.pixi;
      } else if (preview && routePath === '/vendor/unsafe-eval.js') {
        file = preview.unsafeEval;
      } else if (preview && routePath === '/vendor/live2d-adapter.js') {
        file = preview.live2dAdapter;
      } else {
        response.writeHead(404);
        response.end();
        return;
      }
      const size = buffer ? buffer.length : fs.statSync(file).size;
      response.writeHead(200, {
        'Content-Type': contentType(modelPath || file),
        'Content-Length': size,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      });
      if (request.method === 'HEAD') { response.end(); return; }
      if (buffer) response.end(buffer);
      else fs.createReadStream(file).pipe(response);
    } catch (error) {
      if (error instanceof URIError || error.code === 'ENOENT') { response.writeHead(404); response.end(); return; }
      response.writeHead(500);
      response.end('Renderer Asset Server failed.');
    }
  });
  return new Promise((resolve, reject) => {
    const onError = (error) => reject(new RendererContractError('ASSET_SERVER_START_FAILED', error.message || String(error), { cause: error.code }));
    server.once('error', onError);
    server.listen(port, host, () => {
      server.removeListener('error', onError);
      const address = server.address();
      const originUrl = `http://${host}:${address.port}`;
      const baseUrl = `${originUrl}/${sessionToken}`;
      resolve({
        protocolVersion: 1,
        host,
        port: address.port,
        baseUrl,
        previewUrl: preview ? `${baseUrl}/preview` : null,
        modelUrl: (modelConfig) => `${baseUrl}/model/${encodeRelativeUrl(modelConfig)}`,
        runtimeUrl: `${baseUrl}/runtime/${encodeURIComponent(path.basename(runtime))}`,
        close: () => new Promise((closeResolve) => server.close(() => closeResolve())),
      });
    });
  });
}

module.exports = {
  LOOPBACK_HOST,
  RendererContractError,
  createRendererAssetServer,
  encodeRelativeUrl,
  normalizeSourceBuffers,
  normalizePreviewAssets,
  previewDocument,
  safeRelativePath,
  safeBufferPath,
};
