const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const test = require('node:test');

const {
  RuntimeValidationError,
  clearRuntimeSettings,
  createRuntimeSettings,
  inspectRuntime,
  loadRuntimeSettings,
  redactRuntimeSettings,
  resolveRuntimeEntrypoint,
  saveRuntimeSettings,
} = require('../src/index.cjs');

function temporaryDirectory() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'live2pet-runtime-'));
}

function modernFixture() {
  const root = temporaryDirectory();
  fs.mkdirSync(path.join(root, 'Framework'), { recursive: true });
  fs.writeFileSync(path.join(root, 'Framework', 'live2dcubismcore.min.js'), 'var Live2DCubismCore; csmGetVersion csmGetLatestMocVersion;');
  fs.writeFileSync(path.join(root, 'Framework', 'live2dcubismcore.wasm'), Buffer.from('wasm-fixture'));
  return root;
}

test('recognizes a modern Cubism Core file in an SDK directory', async () => {
  const root = modernFixture();
  const descriptor = await inspectRuntime(root);

  assert.equal(descriptor.schemaVersion, 1);
  assert.equal(descriptor.sourceType, 'directory');
  assert.equal(descriptor.entrypoint, 'Framework/live2dcubismcore.min.js');
  assert.equal(descriptor.runtimeKind, 'modern-cubism-core');
  assert.deepEqual(descriptor.cubismGenerations, [3, 4, 5]);
  assert.match(descriptor.fingerprint, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(descriptor).includes(root), false);
});

test('resolves the same validated entrypoint for an isolated renderer', async () => {
  const root = modernFixture();
  const descriptor = await inspectRuntime(root);
  assert.equal(resolveRuntimeEntrypoint(root), path.join(root, descriptor.entrypoint));
  const file = path.join(root, 'Framework', 'live2dcubismcore.min.js');
  assert.equal(resolveRuntimeEntrypoint(file), file);
});

test('recognizes a legacy Cubism 2 runtime and redacts settings for diagnostics', async () => {
  const root = temporaryDirectory();
  const file = path.join(root, 'live2d.min.js');
  fs.writeFileSync(file, 'var Live2D = {}; var L2D = {};');
  const settings = await createRuntimeSettings(file);
  const redacted = redactRuntimeSettings(settings);

  assert.equal(settings.runtimePath, path.resolve(file));
  assert.equal(settings.restartRequired, true);
  assert.equal(redacted.runtimeName, 'live2d.min.js');
  assert.equal(redacted.runtimeKind, 'legacy-cubism2');
  assert.equal(JSON.stringify(redacted).includes(path.resolve(file)), false);
});

test('rejects unknown runtimes and symlinked runtime inputs', async () => {
  const root = temporaryDirectory();
  const unknown = path.join(root, 'unknown.js');
  fs.writeFileSync(unknown, 'console.log("not cubism");');
  await assert.rejects(
    () => inspectRuntime(unknown),
    (error) => error instanceof RuntimeValidationError && error.code === 'UNKNOWN_RUNTIME',
  );

  const link = path.join(root, 'linked.js');
  fs.symlinkSync(unknown, link);
  await assert.rejects(
    () => inspectRuntime(link),
    (error) => error instanceof RuntimeValidationError && error.code === 'UNSUPPORTED_RUNTIME_SYMLINK',
  );
});

test('CLI emits a stable, path-redacted runtime diagnosis', () => {
  const root = modernFixture();
  const cli = path.join(__dirname, '..', 'bin', 'live2pet-runtime.cjs');
  const output = execFileSync(process.execPath, [cli, '--input', root], { encoding: 'utf8' });
  const response = JSON.parse(output);

  assert.equal(response.protocolVersion, 1);
  assert.equal(response.operation, 'runtime-diagnose');
  assert.equal(response.ok, true);
  assert.deepEqual(response.progress, [{ stage: 'runtime-diagnose', status: 'completed' }]);
  assert.equal(output.includes(root), false);
});

test('persists only runtime settings metadata and revalidates the selected path after restart', async () => {
  const root = modernFixture();
  const settingsRoot = temporaryDirectory();
  const settingsPath = path.join(settingsRoot, 'settings', 'runtime.json');
  const saved = await saveRuntimeSettings(settingsPath, root);
  assert.equal(saved.configured, true);
  assert.equal(saved.available, true);
  const raw = fs.readFileSync(settingsPath, 'utf8');
  assert.equal(raw.includes('Live2DCubismCore'), false);
  assert.equal(raw.includes('wasm-fixture'), false);
  const loaded = await loadRuntimeSettings(settingsPath);
  const redacted = redactRuntimeSettings(loaded);
  assert.equal(redacted.configured, true);
  assert.equal(redacted.available, true);
  assert.equal(redacted.restartRequired, true);
  assert.equal(JSON.stringify(redacted).includes(settingsPath), false);
  fs.rmSync(root, { recursive: true, force: true });
  const unavailable = await loadRuntimeSettings(settingsPath);
  const unavailableRedacted = redactRuntimeSettings(unavailable);
  assert.equal(unavailableRedacted.configured, true);
  assert.equal(unavailableRedacted.available, false);
  assert.equal(unavailableRedacted.error.code, 'RUNTIME_NOT_FOUND');
  assert.equal(JSON.stringify(unavailableRedacted).includes(root), false);
  assert.deepEqual(clearRuntimeSettings(settingsPath), { schemaVersion: 1, configured: false, restartRequired: false });
  fs.rmSync(settingsRoot, { recursive: true, force: true });
});

test('returns an empty runtime setting when no App setting exists', async () => {
  const settingsPath = path.join(temporaryDirectory(), 'runtime.json');
  assert.deepEqual(await loadRuntimeSettings(settingsPath), { schemaVersion: 1, configured: false, restartRequired: false });
  assert.deepEqual(clearRuntimeSettings(settingsPath), { schemaVersion: 1, configured: false, restartRequired: false });
});
