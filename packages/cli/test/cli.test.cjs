const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const test = require('node:test');

const { createProject, saveProjectFile } = require('../../project/src/index.cjs');
const { CacheStore, createCacheKey, createClawdThemeZip, createCodexPetZip } = require('../../package-build/src/index.cjs');
const { CLI_VERSION, OPERATIONS, PROTOCOL_VERSION, execute, parseArgs } = require('../src/index.cjs');

const CLI = path.join(__dirname, '..', 'bin', 'live2pet.cjs');

function temporaryDirectory() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'live2pet-cli-'));
}

function modernFixture() {
  const root = temporaryDirectory();
  fs.mkdirSync(path.join(root, 'hero'), { recursive: true });
  fs.writeFileSync(path.join(root, 'hero', 'hero.model3.json'), JSON.stringify({
    Version: 3,
    FileReferences: {
      Moc: 'hero.moc3',
      Textures: ['hero.2048/texture_00.png'],
      Motions: { Main: [{ File: 'motions/idle.motion3.json', Name: 'Idle' }] },
    },
  }));
  fs.writeFileSync(path.join(root, 'hero', 'hero.moc3'), Buffer.from('moc-fixture'));
  fs.mkdirSync(path.join(root, 'hero', 'hero.2048'), { recursive: true });
  fs.writeFileSync(path.join(root, 'hero', 'hero.2048', 'texture_00.png'), Buffer.from('png-fixture'));
  fs.mkdirSync(path.join(root, 'hero', 'motions'), { recursive: true });
  fs.writeFileSync(path.join(root, 'hero', 'motions', 'idle.motion3.json'), JSON.stringify({ Meta: { Duration: 1 } }));
  return root;
}

test('parses positional and option-form operations', () => {
  assert.deepEqual(parseArgs(['inspect', '--input', '/tmp/model']), { pretty: false, operation: 'inspect', input: '/tmp/model' });
  assert.deepEqual(parseArgs(['--operation', 'version', '--pretty']), { pretty: true, operation: 'version' });
});

test('version operation exposes the stable protocol and capabilities', async () => {
  const response = await execute({ operation: 'version' });
  assert.equal(response.protocolVersion, PROTOCOL_VERSION);
  assert.equal(response.cliVersion, CLI_VERSION);
  assert.equal(response.ok, true);
  assert.deepEqual(response.result.operations, OPERATIONS);
  assert.match(response.operationId, /^[0-9a-f-]{36}$/);
});

test('inspect operation reuses the normalized Source Package contract', () => {
  const root = modernFixture();
  const output = execFileSync(process.execPath, [CLI, 'inspect', '--input', root], { encoding: 'utf8' });
  const response = JSON.parse(output);
  assert.equal(response.ok, true);
  assert.equal(response.operation, 'inspect');
  assert.equal(response.result.source.kind, 'standard-directory');
  assert.equal(response.result.motions[0].name, 'Idle');
  assert.equal(output.includes(root), false);
});

test('runtime-diagnose operation redacts the selected absolute path', () => {
  const root = temporaryDirectory();
  const runtime = path.join(root, 'live2dcubismcore.min.js');
  fs.writeFileSync(runtime, 'var Live2DCubismCore; csmGetVersion csmGetLatestMocVersion;');
  const output = execFileSync(process.execPath, [CLI, 'runtime-diagnose', '--input', runtime], { encoding: 'utf8' });
  const response = JSON.parse(output);
  assert.equal(response.ok, true);
  assert.equal(response.result.runtimeKind, 'modern-cubism-core');
  assert.equal(output.includes(runtime), false);
});

test('project-validate returns a normalized project without echoing its source path', () => {
  const root = temporaryDirectory();
  const projectPath = path.join(root, 'pet.live2pet');
  const sourcePath = path.join(root, 'private-model');
  const project = createProject({
    projectId: 'cli-fixture',
    name: 'CLI fixture',
    source: { kind: 'standard-directory', name: 'private-model', fingerprint: 'a'.repeat(64), path: sourcePath },
  });
  saveProjectFile(projectPath, project);
  const output = execFileSync(process.execPath, [CLI, 'project-validate', '--input', projectPath], { encoding: 'utf8' });
  const response = JSON.parse(output);
  assert.equal(response.ok, true);
  assert.equal(response.result.projectId, 'cli-fixture');
  assert.equal(response.result.sourcePathConfigured, true);
  assert.equal(Object.hasOwn(response.result.source, 'path'), false);
  assert.equal(output.includes(sourcePath), false);
});

test('unknown operations return a typed JSON error and non-zero exit code', () => {
  let error;
  try {
    execFileSync(process.execPath, [CLI, 'does-not-exist'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (caught) {
    error = caught;
  }
  assert.ok(error);
  const response = JSON.parse(error.stdout);
  assert.equal(response.ok, false);
  assert.equal(response.error.code, 'UNKNOWN_OPERATION');
  assert.deepEqual(response.error.details.operations, OPERATIONS);
});

test('argument and missing-project failures stay inside the JSON protocol', () => {
  let argumentError;
  try {
    execFileSync(process.execPath, [CLI, '--unknown'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (caught) {
    argumentError = caught;
  }
  assert.ok(argumentError);
  const argumentResponse = JSON.parse(argumentError.stdout);
  assert.equal(argumentResponse.error.code, 'UNKNOWN_ARGUMENT');

  const missing = path.join(temporaryDirectory(), 'private.live2pet');
  let projectError;
  try {
    execFileSync(process.execPath, [CLI, 'project-validate', '--input', missing], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (caught) {
    projectError = caught;
  }
  assert.ok(projectError);
  const projectResponse = JSON.parse(projectError.stdout);
  assert.equal(projectResponse.error.code, 'PROJECT_NOT_FOUND');
  assert.equal(projectError.stdout.includes(missing), false);
});

test('cache status and filtered clear operations use the shared cache store', () => {
  const root = temporaryDirectory();
  const cache = new CacheStore({ rootDir: root, maxBytes: 64 });
  const key = createCacheKey({
    sourceFingerprint: 'source-sha256',
    runtimeVersion: 'core-5',
    rendererVersion: 'renderer-1',
    recipe: { motionId: 'idle' },
    targetProfile: 'clawd',
    targetVersion: '1',
    renderPreset: 'balanced',
    artifact: 'frames',
  });
  cache.put(key, Buffer.from('frames'), { projectId: 'demo-project' });

  const status = JSON.parse(execFileSync(process.execPath, [CLI, 'cache-status', '--cache-dir', root], { encoding: 'utf8' }));
  assert.equal(status.ok, true);
  assert.equal(status.result.entryCount, 1);
  assert.equal(status.result.entries[0].projectId, 'demo-project');

  const cleared = JSON.parse(execFileSync(process.execPath, [CLI, 'cache-clear', '--cache-dir', root, '--project-id', 'demo-project'], { encoding: 'utf8' }));
  assert.equal(cleared.ok, true);
  assert.equal(cleared.result.removedEntries, 1);
  assert.equal(cleared.result.entryCount, 0);
});

test('package-validate inspects a generated Codex ZIP through the target validator', async () => {
  const root = temporaryDirectory();
  const vp8x = Buffer.alloc(30);
  vp8x.write('RIFF', 0, 'ascii');
  vp8x.writeUInt32LE(22, 4);
  vp8x.write('WEBP', 8, 'ascii');
  vp8x.write('VP8X', 12, 'ascii');
  vp8x.writeUInt32LE(10, 16);
  vp8x[24] = 0xff; vp8x[25] = 0x05; vp8x[26] = 0x00;
  vp8x[27] = 0x4f; vp8x[28] = 0x07; vp8x[29] = 0x00;
  const artifact = await createCodexPetZip({
    manifest: { id: 'cli-codex', displayName: 'CLI Codex', description: 'A synthetic Codex pet.', spritesheetPath: 'spritesheet.webp' },
    spritesheet: vp8x,
  });
  const zipPath = path.join(root, 'codex-pet.zip');
  fs.writeFileSync(zipPath, artifact.buffer);
  const response = JSON.parse(execFileSync(process.execPath, [CLI, 'package-validate', '--input', zipPath], { encoding: 'utf8' }));
  assert.equal(response.ok, true);
  assert.equal(response.result.target, 'codex-pet');
  assert.equal(response.result.result.ok, true);
});

test('package-validate inspects a generated Clawd ZIP and preserves validator warnings', async () => {
  const root = temporaryDirectory();
  const artifact = await createClawdThemeZip({
    themeId: 'cli-theme',
    manifest: {
      schemaVersion: 1,
      name: 'CLI Theme',
      version: '1.0.0',
      description: 'A synthetic Clawd theme.',
      viewBox: { x: 0, y: 0, width: 384, height: 384 },
      eyeTracking: { enabled: false, states: [] },
      miniMode: { supported: false },
      states: { idle: ['idle.webp'], thinking: ['idle.webp'], working: ['idle.webp'], sleeping: { fallbackTo: 'idle' } },
      reactions: {},
    },
    assets: { 'idle.webp': Uint8Array.from([1, 2, 3]) },
  });
  const zipPath = path.join(root, 'clawd-theme.zip');
  fs.writeFileSync(zipPath, artifact.buffer);
  const response = JSON.parse(execFileSync(process.execPath, [CLI, 'package-validate', '--input', zipPath, '--target', 'clawd'], { encoding: 'utf8' }));
  assert.equal(response.ok, true);
  assert.equal(response.result.target, 'clawd');
  assert.equal(response.result.result.ok, true);
  assert.equal(response.result.result.assetCount, 1);
});

test('export and explicit install operations keep local paths out of JSON output', async () => {
  const root = temporaryDirectory();
  const vp8x = Buffer.alloc(30);
  vp8x.write('RIFF', 0, 'ascii');
  vp8x.writeUInt32LE(22, 4);
  vp8x.write('WEBP', 8, 'ascii');
  vp8x.write('VP8X', 12, 'ascii');
  vp8x.writeUInt32LE(10, 16);
  vp8x[24] = 0xff; vp8x[25] = 0x05; vp8x[26] = 0x00;
  vp8x[27] = 0x4f; vp8x[28] = 0x07; vp8x[29] = 0x00;
  const artifact = await createCodexPetZip({
    manifest: { id: 'cli-install', displayName: 'CLI Install', description: 'Synthetic', spritesheetPath: 'spritesheet.webp' },
    spritesheet: vp8x,
  });
  const sourceZip = path.join(root, 'source.zip');
  const exportedZip = path.join(root, 'exported.zip');
  fs.writeFileSync(sourceZip, artifact.buffer);
  const exported = JSON.parse(execFileSync(process.execPath, [CLI, 'export', '--input', sourceZip, '--output', exportedZip], { encoding: 'utf8' }));
  assert.equal(exported.ok, true);
  assert.equal(exported.result.path, '<selected-output>');
  assert.equal(JSON.stringify(exported).includes(root), false);
  let missingConfirmation;
  try {
    execFileSync(process.execPath, [CLI, 'install', '--input', sourceZip, '--target', 'codex-pet', '--target-root', path.join(root, 'pets')], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (error) {
    missingConfirmation = JSON.parse(error.stdout);
  }
  assert.equal(missingConfirmation.error.code, 'INSTALL_AUTHORIZATION_REQUIRED');
  const installed = JSON.parse(execFileSync(process.execPath, [CLI, 'install', '--input', sourceZip, '--target', 'codex-pet', '--target-root', path.join(root, 'pets'), '--confirm-install'], { encoding: 'utf8' }));
  assert.equal(installed.ok, true);
  assert.equal(installed.result.path, '<selected-target-root>');
  assert.equal(fs.existsSync(path.join(root, 'pets', 'cli-install', 'pet.json')), true);
});
