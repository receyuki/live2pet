const fs = require('node:fs/promises');

const RUNTIME_PROTOCOL_SCHEME = 'live2pet-runtime';
const RUNTIME_PROTOCOL_ORIGIN = `${RUNTIME_PROTOCOL_SCHEME}://library`;
const RUNTIME_GENERATIONS = Object.freeze({ legacy: 2, modern: 4 });

function runtimeKindFromRequestUrl(value) {
  let url;
  try { url = new URL(value); } catch { return null; }
  if (url.protocol !== `${RUNTIME_PROTOCOL_SCHEME}:` || url.hostname !== 'library' || url.username || url.password || url.port || url.search || url.hash) return null;
  const kind = url.pathname.startsWith('/') ? url.pathname.slice(1) : '';
  return Object.hasOwn(RUNTIME_GENERATIONS, kind) ? kind : null;
}

function response(body, status, ResponseImpl) {
  return new ResponseImpl(body, {
    status,
    headers: {
      'Content-Type': status === 200 ? 'text/javascript; charset=utf-8' : 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

function createRuntimeProtocolHandler({ getRuntimeForGeneration, readFile = fs.readFile, ResponseImpl = globalThis.Response } = {}) {
  if (typeof getRuntimeForGeneration !== 'function') throw new TypeError('getRuntimeForGeneration must be a function.');
  if (typeof readFile !== 'function') throw new TypeError('readFile must be a function.');
  if (typeof ResponseImpl !== 'function') throw new TypeError('ResponseImpl must be a constructor.');
  return async (request) => {
    if (!request || request.method !== 'GET') return response('Method not allowed.', 405, ResponseImpl);
    const kind = runtimeKindFromRequestUrl(request.url);
    if (!kind) return response('Runtime not found.', 404, ResponseImpl);
    let runtime;
    try { runtime = await getRuntimeForGeneration(RUNTIME_GENERATIONS[kind]); }
    catch { return response('Runtime unavailable.', 404, ResponseImpl); }
    if (!runtime?.available || typeof runtime.runtimePath !== 'string') return response('Runtime not configured.', 404, ResponseImpl);
    try {
      return response(await readFile(runtime.runtimePath), 200, ResponseImpl);
    } catch {
      return response('Runtime unavailable.', 404, ResponseImpl);
    }
  };
}

module.exports = {
  RUNTIME_PROTOCOL_ORIGIN,
  RUNTIME_PROTOCOL_SCHEME,
  createRuntimeProtocolHandler,
  runtimeKindFromRequestUrl,
};
