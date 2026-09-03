const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createTargetInstallationService, inspectRoot } = require('../target-installation-service.cjs');

async function fixture(t) {
  const homeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'live2pet-target-settings-'));
  t.after(() => fs.rm(homeDir, { recursive: true, force: true }));
  const applicationDirs = [path.join(homeDir, 'Applications')];
  await fs.mkdir(applicationDirs[0]);
  const options = { settingsPath: path.join(homeDir, 'private', 'installation.json'), homeDir, applicationDirs, platform: 'darwin', env: {}, readApplication: async p => JSON.parse(await fs.readFile(path.join(p, 'fixture.json'), 'utf8')), pick: async () => null };
  const app = async (name, id) => { const p = path.join(applicationDirs[0], name); await fs.mkdir(p); await fs.writeFile(path.join(p, 'fixture.json'), JSON.stringify({ CFBundleIdentifier: id, CFBundleShortVersionString: '1.2.3' })); return p; };
  return { homeDir, options, app };
}

test('detects validated App bundles separately from absent package folders without writing', async t => {
  const { homeDir, options, app } = await fixture(t);
  await app('Clawd on Desk.app', 'com.clawd.on-desk');
  await app('Codex.app', 'another.app');
  const result = await createTargetInstallationService(options).get();
  assert.equal(result.targets[0].application.status, 'found');
  assert.equal(result.targets[0].application.version, '1.2.3');
  assert.equal(result.targets[1].application.status, 'not-found');
  assert.equal(result.targets[0].root.state, 'will-create');
  assert.equal(result.targets[0].root.path, path.join(homeDir, 'Library/Application Support/clawd-on-desk/themes'));
  await assert.rejects(fs.stat(options.settingsPath), { code: 'ENOENT' });
  await assert.rejects(fs.stat(result.targets[0].root.path), { code: 'ENOENT' });
});

test('persists native choices, validates manual Apps, and resets preferences without deleting files', async t => {
  const { homeDir, options, app } = await fixture(t);
  const moved = await app('Renamed.app', 'com.clawd.on-desk');
  const root = path.join(homeDir, 'custom-themes'); await fs.mkdir(root);
  const service = createTargetInstallationService({ ...options, pick: async ({kind}) => kind === 'root' ? root : moved });
  await service.configure({target:'clawd', action:'choose-root'});
  await service.configure({target:'clawd', action:'choose-app'});
  let record = (await createTargetInstallationService(options).get()).targets[0];
  assert.equal(record.root.path, root); assert.equal(record.root.source, 'manual');
  assert.equal(record.application.path, moved); assert.equal(record.application.source, 'manual');
  await assert.rejects(service.configure({target:'codex-pet', action:'choose-app'}), {code:'INSTALL_APP_MISMATCH'});
  await service.configure({target:'clawd', action:'reset-root'});
  await service.configure({target:'clawd', action:'reset-app'});
  record = (await service.get()).targets[0];
  assert.equal(record.root.source, 'default'); assert.equal(record.application.status, 'not-found');
  assert.ok((await fs.stat(root)).isDirectory()); assert.ok((await fs.stat(moved)).isDirectory());
});

test('cancelled selection leaves settings untouched; invalid settings are not overwritten', async t => {
  const { options } = await fixture(t);
  const service = createTargetInstallationService(options);
  assert.deepEqual(await service.configure({target:'clawd', action:'choose-root'}), {cancelled:true});
  await assert.rejects(fs.stat(options.settingsPath), {code:'ENOENT'});
  await fs.mkdir(path.dirname(options.settingsPath)); await fs.writeFile(options.settingsPath, 'bad');
  await assert.rejects(service.configure({target:'clawd', action:'reset-root'}), {code:'INSTALL_SETTINGS_INVALID'});
  assert.equal(await fs.readFile(options.settingsPath, 'utf8'), 'bad');
});

test('reports stale custom folders and ancestor file collisions; respects environment overrides', async t => {
  const { homeDir, options } = await fixture(t);
  const collision = path.join(homeDir, 'file'); await fs.writeFile(collision, 'x');
  assert.equal(await inspectRoot(path.join(collision, 'themes')), 'not-directory');
  const service = createTargetInstallationService({...options, env:{LIVE2PET_CODEX_ROOT:path.join(homeDir,'pets')}});
  const record = (await service.get()).targets[1];
  assert.equal(record.root.source, 'environment'); assert.equal(record.root.state, 'will-create');
  const unknown = createTargetInstallationService({...options, platform:'linux'});
  assert.equal((await unknown.get()).targets[0].application.status, 'unsupported');
});
