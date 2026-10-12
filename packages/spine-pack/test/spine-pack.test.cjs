const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { SPINE_PACK, SPINE_PACKS, LOCAL_SPINE_PACKS, SpinePackError, getSpinePackStatus, installSpinePack, importLocalSpinePack, removeSpinePack, resolveSpinePack } = require('../src/index.cjs');

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

test('local compatibility variants do not replace the official 3.8 pack or duplicate its UI row', async () => {
  const destination = root();
  const all = getSpinePackStatus(destination);
  assert.equal(all.packs.filter((pack) => pack.runtimeLine === '3.8').length, 1);
  assert.equal(getSpinePackStatus(destination, '3.8').id, 'spine-player-3.8');
  assert.equal(getSpinePackStatus(destination, '3.8', { spineVersion: '3.8.75' }).id, 'spine-compat-3.8.75');
  assert.equal(getSpinePackStatus(destination, '3.8', { spineVersion: '3.8.84' }).id, 'spine-player-3.8');
  assert.equal(getSpinePackStatus(destination, '3.6').downloadable, false);
  assert.deepEqual(all.compatibilityPacks.map((pack) => pack.id), ['spine-compat-2.1', 'spine-compat-3.5', 'spine-compat-3.6', 'spine-compat-3.7', 'spine-compat-3.8.75']);
  await assert.rejects(installSpinePack(destination, { runtimeLine: '3.6', confirmInstall: true, fetchImpl() { throw new Error('Must never download'); } }), { code: 'SPINE_PACK_LOCAL_IMPORT_REQUIRED' });
});

test('local import requires consent and rejects unpinned scripts before changing storage', () => {
  const destination = root();
  assert.throws(() => importLocalSpinePack(destination, { packId: LOCAL_SPINE_PACKS[0].id }), { code: 'SPINE_PACK_CONSENT_REQUIRED' });
  assert.throws(() => importLocalSpinePack(destination, { packId: 'model-provided-pack', confirmInstall: true }), { code: 'UNSUPPORTED_SPINE_VERSION' });
  const fake = path.join(destination, 'fake.js');
  fs.writeFileSync(fake, 'arbitrary script');
  assert.throws(() => importLocalSpinePack(destination, { packId: LOCAL_SPINE_PACKS[0].id, confirmInstall: true, files: { 'pixi.min.js': fake } }), { code: 'SPINE_PACK_INTEGRITY_FAILED' });
  assert.deepEqual(fs.readdirSync(destination), ['fake.js']);
});

test('imports the real pinned local runtimes and verifies every resolve path', { skip: !process.env.LIVE2PET_LOCAL_SPINE_SOURCE }, () => {
  const destination = root();
  const { importFromRyutility } = require('../../../apps/desktop/scripts/install-local-spine-compat.cjs');
  const installed = importFromRyutility(destination, process.env.LIVE2PET_LOCAL_SPINE_SOURCE);
  assert.ok(installed.every((pack) => pack.installed && !pack.downloadable));
  for (const pack of LOCAL_SPINE_PACKS) {
    const resolved = resolveSpinePack(destination, pack.runtimeLine, { spineVersion: pack.spineVersion });
    assert.equal(resolved.id, pack.id);
    assert.equal(resolved.adapter, 'legacy');
    assert.ok(fs.statSync(resolved.pixiPath).isFile());
    assert.ok(fs.statSync(resolved.scriptPath).isFile());
    assert.match(fs.readFileSync(path.join(resolved.directory, 'LOCAL-NOTICE'), 'utf8'), /must not be bundled or published/);
    fs.appendFileSync(resolved.scriptPath, '\nchanged');
    assert.throws(() => resolveSpinePack(destination, pack.runtimeLine, { spineVersion: pack.spineVersion }), { code: 'SPINE_PACK_REQUIRED' });
  }
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

test('publishes independently installable official Spine 3.8 and 4.x runtime lines', async () => {
  const destination = root();
  assert.deepEqual(SPINE_PACKS.map((pack) => pack.runtimeLine), ['4.3', '4.2', '4.1', '4.0', '3.8']);
  const status = getSpinePackStatus(destination);
  assert.equal(status.schemaVersion, 2);
  assert.deepEqual(status.packs.map((pack) => ({ line: pack.runtimeLine, installed: pack.installed })), [
    { line: '4.3', installed: false },
    { line: '4.2', installed: false },
    { line: '4.1', installed: false },
    { line: '4.0', installed: false },
    { line: '3.8', installed: false },
  ]);
  assert.throws(() => resolveSpinePack(destination, '3.8'), { code: 'SPINE_PACK_REQUIRED' });
  assert.throws(() => resolveSpinePack(destination, '3.4'), (error) => error.code === 'UNSUPPORTED_SPINE_VERSION' && error.details.supported.includes('3.8'));
});
