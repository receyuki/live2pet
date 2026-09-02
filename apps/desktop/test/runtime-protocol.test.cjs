const assert = require('node:assert/strict');
const test = require('node:test');

const {
  RUNTIME_PROTOCOL_ORIGIN,
  createRuntimeProtocolHandler,
  runtimeKindFromRequestUrl,
} = require('../runtime-protocol.cjs');

test('runtime protocol accepts only fixed library runtime URLs', () => {
  assert.equal(runtimeKindFromRequestUrl(`${RUNTIME_PROTOCOL_ORIGIN}/legacy`), 'legacy');
  assert.equal(runtimeKindFromRequestUrl(`${RUNTIME_PROTOCOL_ORIGIN}/modern`), 'modern');
  for (const value of [
    `${RUNTIME_PROTOCOL_ORIGIN}/legacy/extra`,
    'live2pet-runtime://library//legacy',
    'live2pet-runtime://library:123/legacy',
    `${RUNTIME_PROTOCOL_ORIGIN}/modern?path=/tmp/core.js`,
    'live2pet-runtime://other/modern',
    'file:///tmp/core.js',
    'not a url',
  ]) assert.equal(runtimeKindFromRequestUrl(value), null);
});

test('runtime protocol resolves a generation internally without exposing a path', async () => {
  const generations = [];
  const readPaths = [];
  const handler = createRuntimeProtocolHandler({
    getRuntimeForGeneration: async (generation) => {
      generations.push(generation);
      return { available: true, runtimePath: '/private/app-library/runtime.js' };
    },
    readFile: async (runtimePath) => {
      readPaths.push(runtimePath);
      return Buffer.from('globalThis.Live2D = {};');
    },
  });
  const result = await handler({ method: 'GET', url: `${RUNTIME_PROTOCOL_ORIGIN}/legacy` });
  assert.equal(result.status, 200);
  assert.equal(result.headers.get('content-type'), 'text/javascript; charset=utf-8');
  assert.equal(await result.text(), 'globalThis.Live2D = {};');
  assert.deepEqual(generations, [2]);
  assert.deepEqual(readPaths, ['/private/app-library/runtime.js']);
  assert.equal(result.headers.has('location'), false);
});

test('runtime protocol rejects unknown, missing, and non-GET requests', async () => {
  const handler = createRuntimeProtocolHandler({ getRuntimeForGeneration: async () => null });
  assert.equal((await handler({ method: 'POST', url: `${RUNTIME_PROTOCOL_ORIGIN}/modern` })).status, 405);
  assert.equal((await handler({ method: 'GET', url: `${RUNTIME_PROTOCOL_ORIGIN}/unknown` })).status, 404);
  assert.equal((await handler({ method: 'GET', url: `${RUNTIME_PROTOCOL_ORIGIN}/modern` })).status, 404);
  const unavailable = createRuntimeProtocolHandler({ getRuntimeForGeneration: async () => { throw new Error('settings unreadable'); } });
  assert.equal((await unavailable({ method: 'GET', url: `${RUNTIME_PROTOCOL_ORIGIN}/modern` })).status, 404);
});
