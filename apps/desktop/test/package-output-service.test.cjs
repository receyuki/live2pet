const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createPackageOutputService } = require('../package-output-service.cjs');

async function fixture(t, options = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'live2pet-output-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const settingsPath = path.join(root, 'settings', 'output.json');
  return { root, settingsPath, service: createPackageOutputService({ settingsPath, pickFolder: async () => root, pickSavePath: async () => path.join(root, 'selected.zip'), ...options }) };
}
const artifact = { filename: 'pet.zip', bytes: Uint8Array.from([80, 75, 3, 4, 7]) };

test('defaults to asking, respects cancellation, and saves the exact complete bytes', async t => {
  const { service, root } = await fixture(t, { pickSavePath: async ({ defaultPath }) => { assert.equal(defaultPath, 'pet.zip'); return null; } });
  assert.deepEqual(await service.get(), { schemaVersion: 1, mode: 'ask' });
  assert.deepEqual(await service.save(artifact), { cancelled: true });
  assert.deepEqual(await fs.readdir(root), []);
  const saved = await fixture(t);
  await fs.writeFile(path.join(saved.root, 'selected.zip'), 'old package');
  const result = await saved.service.save(artifact);
  assert.equal(result.cancelled, false);
  assert.equal(result.filename, 'selected.zip');
  assert.equal(result.byteLength, artifact.bytes.byteLength);
  assert.deepEqual(await fs.readFile(result.path), Buffer.from(artifact.bytes));
  assert.deepEqual(await fs.readdir(saved.root), ['selected.zip']);
});

test('persists the selected output folder and never overwrites colliding packages', async t => {
  const { service, root, settingsPath } = await fixture(t);
  assert.deepEqual(await service.configure({ action: 'choose-folder' }), { cancelled: false });
  assert.deepEqual(await service.get(), { schemaVersion: 1, mode: 'folder', folder: root, folderState: 'ready' });
  await fs.writeFile(path.join(root, 'pet.zip'), 'existing');
  const [first, second] = await Promise.all([service.save(artifact), service.save(artifact)]);
  assert.deepEqual([first.filename, second.filename].sort(), ['pet (1).zip', 'pet (2).zip']);
  assert.equal(await fs.readFile(path.join(root, 'pet.zip'), 'utf8'), 'existing');
  for (const result of [first, second]) assert.deepEqual(await fs.readFile(result.path), Buffer.from(artifact.bytes));
  const reloaded = createPackageOutputService({ settingsPath });
  assert.equal((await reloaded.get()).folder, root);
  await reloaded.configure({ action: 'ask-every-time' });
  assert.equal((await reloaded.get()).mode, 'ask');
  assert.equal((await reloaded.get()).folder, root);
  assert.equal((await fs.readdir(root)).some(name => name.endsWith('.tmp')), false);
});

test('cancelling folder selection keeps prior settings and unavailable folders do not redirect saves', async t => {
  const cancelled = await fixture(t, { pickFolder: async () => null });
  assert.deepEqual(await cancelled.service.configure({ action: 'choose-folder' }), { cancelled: true });
  assert.equal((await cancelled.service.get()).mode, 'ask');
  const { service, root, settingsPath } = await fixture(t);
  const missing = path.join(root, 'missing');
  await fs.mkdir(path.dirname(settingsPath), { recursive: true });
  await fs.writeFile(settingsPath, JSON.stringify({ schemaVersion: 1, mode: 'folder', folder: missing }));
  await assert.rejects(service.save(artifact), { code: 'OUTPUT_FOLDER_UNAVAILABLE' });
  await assert.rejects(fs.stat(missing), { code: 'ENOENT' });
});

test('invalid settings and unsafe artifact names are rejected without overwriting anything', async t => {
  const { service, root, settingsPath } = await fixture(t);
  for (const filename of ['../pet.zip', 'folder\\pet.zip', 'pet.png', 'bad\0.zip']) {
    await assert.rejects(service.save({ ...artifact, filename }), { code: 'INVALID_OUTPUT_ARTIFACT' });
  }
  await fs.mkdir(path.dirname(settingsPath), { recursive: true });
  await fs.writeFile(settingsPath, '{broken');
  await assert.rejects(service.get(), { code: 'OUTPUT_SETTINGS_INVALID' });
  await assert.rejects(service.configure({ action: 'ask-every-time' }), { code: 'OUTPUT_SETTINGS_INVALID' });
  assert.equal(await fs.readFile(settingsPath, 'utf8'), '{broken');
  assert.deepEqual(await fs.readdir(root), ['settings']);
});

test('a failed publication leaves the existing destination and no temporary file', async t => {
  const { service, root } = await fixture(t);
  await fs.mkdir(path.join(root, 'selected.zip'));
  await fs.writeFile(path.join(root, 'selected.zip', 'preserved.txt'), 'preserved');
  await assert.rejects(service.save(artifact));
  assert.equal(await fs.readFile(path.join(root, 'selected.zip', 'preserved.txt'), 'utf8'), 'preserved');
  assert.deepEqual(await fs.readdir(root), ['selected.zip']);
});
