const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  CacheError,
  CacheStore,
  DEFAULT_CACHE_LIMIT,
  createCacheKey,
} = require('../src/cache.cjs');

function key(overrides = {}) {
  return createCacheKey({
    sourceFingerprint: 'source-sha256',
    runtimeVersion: 'core-5.0',
    rendererVersion: 'renderer-1',
    recipe: { expressionId: null, motionId: 'idle' },
    targetProfile: 'clawd',
    targetVersion: '1',
    renderPreset: 'balanced',
    artifact: 'render-candidates',
    ...overrides,
  });
}

function store(maxBytes = DEFAULT_CACHE_LIMIT) {
  return new CacheStore({ rootDir: fs.mkdtempSync(path.join(os.tmpdir(), 'live2pet-cache-')), maxBytes });
}

test('creates deterministic cache identities without leaking source paths', () => {
  const first = key();
  const second = createCacheKey({
    artifact: 'render-candidates',
    renderPreset: 'balanced',
    targetVersion: '1',
    targetProfile: 'clawd',
    recipe: { motionId: 'idle', expressionId: null },
    rendererVersion: 'renderer-1',
    runtimeVersion: 'core-5.0',
    sourceFingerprint: 'source-sha256',
  });
  assert.equal(first.digest, second.digest);
  assert.equal(first.canonical.includes('/private/'), false);
  assert.notEqual(first.digest, key({ targetProfile: 'codex-pet' }).digest);
});
test('writes, reads, accounts, and filters an integrity-checked entry', () => {
  const cache = store();
  const identity = key();
  const bytes = Buffer.from('rendered-candidates');
  const created = cache.put(identity, bytes, { projectId: 'demo-project' });
  assert.equal(created.byteLength, bytes.byteLength);
  assert.deepEqual(cache.get(identity).data, bytes);
  assert.equal(cache.status().entryCount, 1);
  assert.equal(cache.status({ projectId: 'demo-project' }).byteLength, bytes.byteLength);
  assert.equal(cache.status({ projectId: 'other-project' }).entryCount, 0);
  assert.equal(cache.status().entries[0].sourceFingerprint, 'source-sha256');
});

test('evicts the least recently used entries within the bounded limit', () => {
  const cache = store(10);
  const first = key({ artifact: 'first' });
  const second = key({ artifact: 'second' });
  const third = key({ artifact: 'third' });
  cache.put(first, Buffer.from('123456'));
  cache.put(second, Buffer.from('abcdef'));
  assert.equal(cache.get(first), null);
  assert.deepEqual(cache.get(second).data, Buffer.from('abcdef'));
  cache.put(third, Buffer.from('ghijkl'));
  assert.equal(cache.get(second), null);
  assert.deepEqual(cache.get(third).data, Buffer.from('ghijkl'));
  assert.equal(cache.status().byteLength, 6);
});

test('treats tampered bytes as a cache miss and removes the invalid entry', () => {
  const cache = store();
  const identity = key();
  cache.put(identity, Buffer.from('valid'));
  const dataPath = path.join(cache.rootDir, `${identity.digest}.bin`);
  fs.writeFileSync(dataPath, 'tampered');
  assert.equal(cache.get(identity), null);
  assert.equal(cache.status().entryCount, 0);
});

test('clears entries by project or source and rejects oversized entries', () => {
  const cache = store(8);
  cache.put(key({ artifact: 'one' }), Buffer.from('1234'), { projectId: 'demo-project' });
  cache.put(key({ artifact: 'two' }), Buffer.from('5678'), { projectId: 'other-project' });
  const cleared = cache.clear({ projectId: 'demo-project' });
  assert.equal(cleared.removedEntries, 1);
  assert.equal(cache.status().entryCount, 1);
  assert.throws(
    () => cache.put(key({ artifact: 'oversized' }), Buffer.from('123456789'), { projectId: 'other-project' }),
    (error) => error instanceof CacheError && error.code === 'CACHE_ENTRY_TOO_LARGE',
  );
});
