const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { SPINE_PACK, SpinePackError, getSpinePackStatus, installSpinePack, removeSpinePack } = require('../src/index.cjs');

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
  assert.equal(removeSpinePack(destination, pack).installed, false);
});

test('rejects integrity failures without leaving an installed pack', async () => {
  const destination = root();
  await assert.rejects(() => installSpinePack(destination, { confirmInstall: true, fetchImpl: async () => ({ ok: true, headers: { get: () => '7' }, arrayBuffer: async () => Buffer.from('damaged') }) }), (error) => error instanceof SpinePackError && error.code === 'SPINE_PACK_INTEGRITY_FAILED');
  assert.equal(getSpinePackStatus(destination).installed, false);
});
