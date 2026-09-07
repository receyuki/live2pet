const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { SPINE_PACK, SPINE_PACKS, SpinePackError, getSpinePackStatus, installSpinePack, removeSpinePack, resolveSpinePack } = require('../src/index.cjs');

function root() { return fs.mkdtempSync(path.join(os.tmpdir(), 'live2pet-spine-pack-')); }
function fixturePack() {
  const crypto = require('node:crypto');
  const files = SPINE_PACK.files.map((file) => ({ ...file, bytes: Buffer.from(file.sha256) })).map((file) => ({ ...file, sha256: crypto.createHash('sha256').update(file.bytes).digest('hex') }));
  return { ...SPINE_PACK, id: 'spine-player-test', files };
}

test('requires explicit consent before any optional pack download', async () => {
  let fetched = false;
  await assert.rejects(() => installSpinePack(root(), { fetchImpl: async () => { fetched = true; } }), (error) => error instanceof SpinePackError && error.code === 'SPINE_PACK_CONSENT_REQUIRED');
  assert.equal(fetched, false);
});

test('installs verified files atomically, reuses them, and removes one pack', async () => {
  const destination = root();
  const pack = fixturePack();
  let requests = 0;
  const fetchImpl = async (url) => {
    requests += 1;
    const fixture = pack.files.find((entry) => entry.url === url);
    return { ok: true, headers: { get: () => String(fixture.bytes.byteLength) }, arrayBuffer: async () => fixture.bytes };
  };
  const progress = [];
  assert.equal((await installSpinePack(destination, { confirmInstall: true, fetchImpl, pack, onProgress: (event) => progress.push(event) })).installed, true);
  assert.equal(requests, 3);
  assert.equal(progress.length, 3);
  await installSpinePack(destination, { confirmInstall: true, fetchImpl, pack });
  assert.equal(requests, 3);
  assert.equal(removeSpinePack(destination, pack.runtimeLine, pack).installed, false);
});

test('rejects integrity failures without leaving an installed pack', async () => {
  const destination = root();
  await assert.rejects(() => installSpinePack(destination, { confirmInstall: true, fetchImpl: async () => ({ ok: true, headers: { get: () => '7' }, arrayBuffer: async () => Buffer.from('damaged') }) }), (error) => error instanceof SpinePackError && error.code === 'SPINE_PACK_INTEGRITY_FAILED');
  assert.equal(getSpinePackStatus(destination, '4.3').installed, false);
});

test('publishes independently installable official Spine 4.x runtime lines', async () => {
  const destination = root();
  assert.deepEqual(SPINE_PACKS.map((pack) => pack.runtimeLine), ['4.3', '4.2', '4.1', '4.0']);
  const status = getSpinePackStatus(destination);
  assert.equal(status.schemaVersion, 2);
  assert.deepEqual(status.packs.map((pack) => ({ line: pack.runtimeLine, installed: pack.installed })), [
    { line: '4.3', installed: false },
    { line: '4.2', installed: false },
    { line: '4.1', installed: false },
    { line: '4.0', installed: false },
  ]);
  assert.throws(() => resolveSpinePack(destination, '3.8'), (error) => error.code === 'UNSUPPORTED_SPINE_VERSION' && error.details.supported.includes('4.1'));
});
