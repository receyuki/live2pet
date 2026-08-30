const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { createClawdThemeZip, createCodexPetZip } = require('../../package-build/src/index.cjs');
const { InstallationError, exportPackage, installPackage } = require('../src/index.cjs');

function tempDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'live2pet-install-')); }

async function codexArchive() {
  return createCodexPetZip({ manifest: { id: 'demo-pet', displayName: 'Demo Pet', description: 'Synthetic', spritesheetPath: 'spritesheet.webp' }, spritesheet: Uint8Array.from([1, 2, 3]) });
}

async function clawdArchive() {
  return createClawdThemeZip({ themeId: 'demo-theme', manifest: { schemaVersion: 1, name: 'Demo Theme' }, assets: { 'idle.webp': Uint8Array.from([4, 5, 6]) } });
}

test('exports a package atomically and refuses accidental overwrite', async () => {
  const root = tempDir();
  const archive = await codexArchive();
  const output = path.join(root, 'exports', 'demo.zip');
  const result = await exportPackage({ packageBytes: archive.buffer, outputPath: output });
  assert.equal(result.byteLength, archive.byteLength);
  assert.equal(fs.readFileSync(output).length, archive.byteLength);
  await assert.rejects(() => exportPackage({ packageBytes: archive.buffer, outputPath: output }), (error) => error instanceof InstallationError && error.code === 'EXPORT_EXISTS');
  const overwritten = await exportPackage({ packageBytes: Buffer.from('replacement'), outputPath: output, overwrite: true });
  assert.equal(overwritten.overwritten, true);
  assert.equal(fs.readFileSync(output).toString(), 'replacement');
});

test('installs Codex packages under an explicit root and defaults conflicts to cancel', async () => {
  const root = tempDir();
  const archive = await codexArchive();
  const events = [];
  const result = await installPackage({ target: 'codex-pet', packageBytes: archive.buffer, targetRoot: root, onProgress: (event) => events.push(`${event.stage}:${event.status}`) });
  assert.equal(result.packageId, 'demo-pet');
  assert.equal(fs.existsSync(path.join(root, 'demo-pet', 'pet.json')), true);
  assert.deepEqual(events, ['inspect:started', 'inspect:completed', 'stage:started', 'stage:completed', 'commit:started', 'commit:completed']);
  await assert.rejects(() => installPackage({ target: 'codex-pet', packageBytes: archive.buffer, targetRoot: root }), (error) => error instanceof InstallationError && error.code === 'INSTALL_CONFLICT' && error.details.choices.includes('upgrade'));
});

test('supports Clawd side-by-side installation without changing the archive', async () => {
  const root = tempDir();
  const archive = await clawdArchive();
  await installPackage({ target: 'clawd', packageBytes: archive.buffer, targetRoot: root });
  const result = await installPackage({ target: 'clawd', packageBytes: archive.buffer, targetRoot: root, conflict: 'side-by-side' });
  assert.equal(result.packageId, 'demo-theme-2');
  assert.equal(fs.existsSync(path.join(root, 'demo-theme-2', 'theme.json')), true);
  assert.equal(fs.existsSync(path.join(root, 'demo-theme-2', 'assets', 'idle.webp')), true);
});

test('upgrade restores the prior installation when commit fails', async () => {
  const root = tempDir();
  const archive = await codexArchive();
  await installPackage({ target: 'codex-pet', packageBytes: archive.buffer, targetRoot: root });
  const existing = path.join(root, 'demo-pet', 'pet.json');
  const prior = fs.readFileSync(existing);
  await assert.rejects(() => installPackage({ target: 'codex-pet', packageBytes: archive.buffer, targetRoot: root, conflict: 'upgrade', beforeCommit: async () => { throw new Error('simulated failure'); } }), (error) => error instanceof InstallationError && error.code === 'INSTALL_FAILED' && error.details.cause === 'simulated failure');
  assert.deepEqual(fs.readFileSync(existing), prior);
  assert.deepEqual(fs.readdirSync(root), ['demo-pet']);
});

test('rejects unsafe archive paths before touching the install root', async () => {
  const fakeZip = {
    ZipReader: class {
      async getEntries() { return [{ filename: '../escape', uncompressedSize: 1, async getData() { return Uint8Array.from([1]); } }]; }
      async close() {}
    },
    Uint8ArrayReader: class { constructor(value) { this.value = value; } },
    Uint8ArrayWriter: class {},
  };
  const root = tempDir();
  await assert.rejects(() => installPackage({ target: 'codex-pet', packageBytes: Uint8Array.from([1]), targetRoot: root, zipModule: fakeZip }), (error) => error instanceof InstallationError && error.code === 'UNSAFE_PACKAGE_PATH');
  assert.deepEqual(fs.readdirSync(root), []);
});
