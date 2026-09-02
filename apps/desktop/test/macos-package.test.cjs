const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  FORBIDDEN_BUNDLE_ENTRY,
  createPackagerOptions,
  currentMacArch,
  findElectronZipDir,
  pnpmInvocation,
  verifyBundleLayout,
} = require('../scripts/package-macos.cjs');

test('macOS package options remain local, unsigned, current-architecture, and Sharp-safe', () => {
  const options = createPackagerOptions({ stageRoot: '/tmp/live2pet-stage', extraResource: ['/tmp/mapper-dist'], arch: 'x64' });
  assert.equal(options.platform, 'darwin');
  assert.equal(options.arch, 'x64');
  assert.equal(options.electronVersion, '44.0.0');
  assert.equal(options.asar.unpack, '**/node_modules/{sharp,@img}/**/*');
  assert.equal(options.prune, false);
  assert.equal(options.overwrite, true);
  assert.equal(options.osxSign, undefined);
  assert.deepEqual(options.extraResource, ['/tmp/mapper-dist']);
});

test('macOS package command rejects unsupported hosts and requires a pnpm invocation', () => {
  assert.equal(currentMacArch('darwin', 'arm64'), 'arm64');
  assert.throws(() => currentMacArch('win32', 'x64'), (error) => error.code === 'UNSUPPORTED_PACKAGE_HOST');
  assert.throws(() => currentMacArch('darwin', 'ia32'), (error) => error.code === 'UNSUPPORTED_PACKAGE_ARCH');
  assert.throws(() => pnpmInvocation({}), (error) => error.code === 'PNPM_REQUIRED');
  assert.deepEqual(pnpmInvocation({ npm_execpath: '/tmp/pnpm.mjs' }).prefix, ['/tmp/pnpm.mjs']);
});

test('macOS package command can reuse the official Electron archive cache offline', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'live2pet-electron-cache-'));
  try {
    const nested = path.join(root, 'digest');
    fs.mkdirSync(nested, { recursive: true });
    fs.writeFileSync(path.join(nested, 'electron-v44.0.0-darwin-x64.zip'), 'zip');
    assert.equal(findElectronZipDir('x64', root), nested);
    assert.equal(findElectronZipDir('arm64', root), null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('bundle verification requires staged resources, unpacked Sharp, and no user assets', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'live2pet-bundle-test-'));
  const appPath = path.join(root, 'Live2Pet.app');
  const resources = path.join(appPath, 'Contents', 'Resources');
  try {
    for (const relative of ['mapper-dist/index.html', 'app.asar', 'app.asar.unpacked/node_modules/@img/sharp-darwin-x64/lib/sharp-darwin-x64.node']) {
      const absolute = path.join(resources, relative);
      fs.mkdirSync(path.dirname(absolute), { recursive: true });
      fs.writeFileSync(absolute, 'test');
    }
    assert.equal(verifyBundleLayout(appPath).nativeSharp, true);
    const forbidden = path.join(resources, 'models', 'sample.moc3');
    fs.mkdirSync(path.dirname(forbidden), { recursive: true });
    fs.writeFileSync(forbidden, 'test');
    assert.throws(() => verifyBundleLayout(appPath), (error) => error.code === 'FORBIDDEN_PACKAGE_ASSET');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('forbidden package matcher covers model, runtime, example, and generated inputs', () => {
  for (const entry of ['examples/a.json', 'models/a.json', 'runtime/live2d.min.js', 'input/model.moc3', 'output/theme.webp', 'theme.zip']) {
    assert.match(entry, FORBIDDEN_BUNDLE_ENTRY);
  }
  for (const entry of ['mapper-dist/index.html', 'node_modules/sharp/package.json', 'node_modules/@live2pet/runtime/package.json']) {
    assert.doesNotMatch(entry, FORBIDDEN_BUNDLE_ENTRY);
  }
});
