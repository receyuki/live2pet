const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  WINDOWS_ICON_PATH,
  createWindowsPackagerOptions,
  currentWindowsArch,
  verifyWindowsBundleLayout,
} = require('../scripts/package-windows.cjs');

test('Windows package options are unsigned, x64, and Sharp-safe', () => {
  assert.equal(require('../package.json').author, 'Live2Pet contributors');
  const options = createWindowsPackagerOptions({ stageRoot: 'C:\\stage', extraResource: ['C:\\renderer'], arch: 'x64' });
  assert.equal(options.platform, 'win32');
  assert.equal(options.arch, 'x64');
  assert.equal(options.electronVersion, '44.0.0');
  assert.equal(options.appVersion, require('../package.json').version);
  assert.equal(options.buildVersion, require('../package.json').version);
  assert.equal(options.icon, WINDOWS_ICON_PATH);
  assert.equal(path.extname(WINDOWS_ICON_PATH), '.ico');
  assert.equal(fs.existsSync(WINDOWS_ICON_PATH), true);
  assert.equal(options.asar.unpack, '**/node_modules/{sharp,@img}/**/*');
  assert.equal(options.win32metadata, undefined);
});

test('Windows package command rejects unsupported hosts and architectures', () => {
  assert.equal(currentWindowsArch('win32', 'x64'), 'x64');
  assert.throws(() => currentWindowsArch('darwin', 'x64'), (error) => error.code === 'UNSUPPORTED_PACKAGE_HOST');
  assert.throws(() => currentWindowsArch('win32', 'arm64'), (error) => error.code === 'UNSUPPORTED_PACKAGE_ARCH');
});

test('Windows bundle verification requires the native Sharp module', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'live2pet-win-bundle-'));
  const resources = path.join(root, 'resources');
  try {
    for (const relative of ['mapper-dist/index.html', 'renderer-dist/index.html', 'renderer-dist/THIRD-PARTY-LICENSES.md', 'renderer-dist/licenses/@heroui_styles.txt', 'renderer-dist/licenses/tailwindcss.txt', 'app.asar', 'app.asar.unpacked/node_modules/@img/sharp-win32-x64/lib/sharp-win32-x64.node']) {
      const absolute = path.join(resources, relative);
      fs.mkdirSync(path.dirname(absolute), { recursive: true });
      fs.writeFileSync(absolute, 'test');
    }
    assert.equal(verifyWindowsBundleLayout(root).nativeSharp, true);
    fs.rmSync(path.join(resources, 'app.asar.unpacked'), { recursive: true });
    assert.throws(() => verifyWindowsBundleLayout(root), (error) => error.code === 'SHARP_NATIVE_BINARY_MISSING');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
