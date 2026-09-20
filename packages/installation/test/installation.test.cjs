const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { createClawdThemeZip, createCodexPetZip } = require('../../package-build/src/index.cjs');
const { InstallationError, exportPackage, installPackage, resolveTargetRoot } = require('../src/index.cjs');

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

test('upgrade preserves the installed package when staging runs out of space', async (t) => {
  const root = tempDir();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const archive = await codexArchive();
  await installPackage({ target: 'codex-pet', packageBytes: archive.buffer, targetRoot: root });
  const manifest = path.join(root, 'demo-pet', 'pet.json');
  const previous = fs.readFileSync(manifest);
  const writeFile = fs.writeFileSync;
  t.mock.method(fs, 'writeFileSync', (filename, ...args) => {
    if (path.basename(path.dirname(filename)).startsWith('.live2pet-stage-')) {
      throw Object.assign(new Error('disk full'), { code: 'ENOSPC' });
    }
    return writeFile(filename, ...args);
  });

  await assert.rejects(
    () => installPackage({ target: 'codex-pet', packageBytes: archive.buffer, targetRoot: root, conflict: 'upgrade' }),
    (error) => error.code === 'INSTALL_FAILED' && error.details.cause === 'ENOSPC',
  );
  assert.deepEqual(fs.readFileSync(manifest), previous);
  assert.deepEqual(fs.readdirSync(root), ['demo-pet']);
});

test('failed restoration retains the previous package and reports how to recover it', async (t) => {
  const root = tempDir();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const archive = await codexArchive();
  await installPackage({ target: 'codex-pet', packageBytes: archive.buffer, targetRoot: root });
  const prior = fs.readFileSync(path.join(root, 'demo-pet', 'pet.json'));
  const rename = fs.renameSync;
  t.mock.method(fs, 'renameSync', (from, to) => {
    if (path.basename(from).startsWith('.live2pet-backup-')) {
      throw Object.assign(new Error('restore denied'), { code: 'EACCES' });
    }
    return rename(from, to);
  });

  await assert.rejects(
    () => installPackage({ target: 'codex-pet', packageBytes: archive.buffer, targetRoot: root, conflict: 'upgrade', beforeCommit: () => { throw new Error('publication interrupted'); } }),
    (error) => {
      assert.equal(error.code, 'INSTALL_ROLLBACK_FAILED');
      assert.equal(error.details.cause, 'publication interrupted');
      assert.equal(error.details.rollbackCause, 'EACCES');
      assert.match(error.details.backupDirectory, /^\.live2pet-backup-/);
      assert.equal(error.details.packageId, 'demo-pet');
      assert.ok(error.message.includes(error.details.backupDirectory));
      assert.deepEqual(fs.readFileSync(path.join(root, error.details.backupDirectory, 'pet.json')), prior);
      return true;
    },
  );
  assert.equal(fs.readdirSync(root).length, 1);
});

test('backup cleanup failure never rolls back an already verified installation', async (t) => {
  const root = tempDir();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const archive = await codexArchive();
  await installPackage({ target: 'codex-pet', packageBytes: archive.buffer, targetRoot: root });
  fs.writeFileSync(path.join(root, 'demo-pet', 'spritesheet.webp'), 'old pet');
  const remove = fs.rmSync;
  t.mock.method(fs, 'rmSync', (directory, options) => {
    if (path.basename(directory).startsWith('.live2pet-backup-')) {
      remove(path.join(directory, 'pet.json'));
      throw Object.assign(new Error('cleanup interrupted'), { code: 'EACCES' });
    }
    return remove(directory, options);
  });

  const result = await installPackage({ target: 'codex-pet', packageBytes: archive.buffer, targetRoot: root, conflict: 'upgrade' });
  assert.deepEqual(fs.readFileSync(path.join(result.path, 'spritesheet.webp')), Buffer.from([1, 2, 3]));
  assert.equal(JSON.parse(fs.readFileSync(path.join(result.path, 'pet.json'))).id, 'demo-pet');
  assert.match(result.cleanupWarning.backupDirectory, /^\.live2pet-backup-/);
  assert.deepEqual(fs.readdirSync(root).sort(), [result.cleanupWarning.backupDirectory, 'demo-pet'].sort());
});

for (const target of ['codex-pet', 'clawd']) {
  for (const phase of ['stage creation', 'staging verification', 'backup movement', 'publication', 'installed verification']) {
    test(`${target} upgrade preserves all old files after ${phase} failure`, async (t) => {
      const root = tempDir();
      t.after(() => fs.rmSync(root, { recursive: true, force: true }));
      const archive = await (target === 'clawd' ? clawdArchive() : codexArchive());
      const existing = await installPackage({ target, packageBytes: archive.buffer, targetRoot: root });
      const previous = existing.files.map((name) => ({ name, bytes: fs.readFileSync(path.join(existing.path, name)) }));
      const inStage = (filename) => path.relative(root, filename).split(path.sep)[0].startsWith('.live2pet-stage-');
      const method = phase === 'stage creation' ? 'mkdirSync' : phase.includes('verification') ? 'statSync' : 'renameSync';
      const operation = fs[method];
      let injected = false;
      t.mock.method(fs, method, (...args) => {
        const [from, to] = args;
        const matches = phase === 'stage creation' || phase === 'staging verification' ? inStage(from)
          : phase === 'backup movement' ? from === existing.path
          : phase === 'publication' ? inStage(from) && to === existing.path
          : from.startsWith(`${existing.path}${path.sep}`);
        if (!injected && matches) {
          injected = true;
          throw Object.assign(new Error(`${phase} failed`), { code: 'EIO' });
        }
        return operation(...args);
      });
      const events = [];

      await assert.rejects(
        () => installPackage({ target, packageBytes: archive.buffer, targetRoot: root, conflict: 'upgrade', onProgress: (event) => events.push(event) }),
        (error) => error.code === 'INSTALL_FAILED' && error.details.cause === 'EIO',
      );
      assert.equal(injected, true);
      for (const file of previous) assert.deepEqual(fs.readFileSync(path.join(existing.path, file.name)), file.bytes);
      assert.deepEqual(fs.readdirSync(root), [existing.packageId]);
      assert.equal(events.some((event) => event.stage === 'commit' && event.status === 'completed'), false);
    });
  }

  test(`${target} upgrade publishes the replacement and removes its temporary directories`, async (t) => {
    const root = tempDir();
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const archive = await (target === 'clawd' ? clawdArchive() : codexArchive());
    const existing = await installPackage({ target, packageBytes: archive.buffer, targetRoot: root });
    fs.writeFileSync(path.join(existing.path, 'old-only.txt'), 'previous package');
    const installed = await installPackage({ target, packageBytes: archive.buffer, targetRoot: root, conflict: 'upgrade' });
    assert.equal(installed.conflict, 'upgrade');
    assert.equal(installed.cleanupWarning, undefined);
    assert.equal(fs.existsSync(path.join(installed.path, 'old-only.txt')), false);
    assert.deepEqual(fs.readdirSync(root), [installed.packageId]);
    for (const name of installed.files) assert.ok(fs.readFileSync(path.join(installed.path, name)).length > 0);
  });
}

test('a failed destination cleanup retains the backup instead of overwriting either copy', async (t) => {
  const root = tempDir();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const archive = await codexArchive();
  const existing = await installPackage({ target: 'codex-pet', packageBytes: archive.buffer, targetRoot: root });
  fs.writeFileSync(path.join(existing.path, 'old-only.txt'), 'previous package');
  const stat = fs.statSync;
  const remove = fs.rmSync;
  t.mock.method(fs, 'statSync', (filename, ...args) => {
    if (filename === path.join(existing.path, 'pet.json')) throw Object.assign(new Error('verification interrupted'), { code: 'EIO' });
    return stat(filename, ...args);
  });
  t.mock.method(fs, 'rmSync', (directory, options) => {
    if (directory === existing.path) throw Object.assign(new Error('destination locked'), { code: 'EACCES' });
    return remove(directory, options);
  });
  await assert.rejects(
    () => installPackage({ target: 'codex-pet', packageBytes: archive.buffer, targetRoot: root, conflict: 'upgrade' }),
    (error) => {
      assert.equal(error.code, 'INSTALL_ROLLBACK_FAILED');
      const backup = path.join(root, error.details.backupDirectory);
      assert.equal(fs.readFileSync(path.join(backup, 'old-only.txt'), 'utf8'), 'previous package');
      assert.equal(fs.existsSync(existing.path), true);
      assert.deepEqual(fs.readdirSync(root).sort(), [error.details.backupDirectory, 'demo-pet'].sort());
      return true;
    },
  );
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

test('resolves documented Clawd and Codex roots without creating them', () => {
  assert.deepEqual(resolveTargetRoot('clawd', { platform: 'darwin', homeDir: '/Users/demo', env: {} }), {
    target: 'clawd', platform: 'darwin', path: '/Users/demo/Library/Application Support/clawd-on-desk/themes', source: 'default', variable: null,
  });
  assert.deepEqual(resolveTargetRoot('clawd', { platform: 'win32', homeDir: 'C:\\Users\\demo', env: { APPDATA: 'C:\\Users\\demo\\AppData\\Roaming' } }), {
    target: 'clawd', platform: 'win32', path: 'C:\\Users\\demo\\AppData\\Roaming\\clawd-on-desk\\themes', source: 'default', variable: 'APPDATA',
  });
  assert.deepEqual(resolveTargetRoot('codex-pet', { platform: 'linux', homeDir: '/home/demo', env: { CODEX_HOME: '/srv/codex' } }), {
    target: 'codex-pet', platform: 'linux', path: '/srv/codex/pets', source: 'default', variable: 'CODEX_HOME',
  });
  assert.deepEqual(resolveTargetRoot('clawd', { targetRoot: '/tmp/custom-themes', platform: 'darwin', homeDir: '/Users/demo', env: {} }).source, 'explicit');
});

test('installs into a platform default only when the caller explicitly invokes install', async () => {
  const root = tempDir();
  const archive = await codexArchive();
  const result = await installPackage({ target: 'codex-pet', packageBytes: archive.buffer, platform: 'darwin', homeDir: root, env: {} });
  assert.equal(result.packageId, 'demo-pet');
  assert.equal(fs.existsSync(path.join(root, '.codex', 'pets', 'demo-pet', 'pet.json')), true);
});
