const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { packagedAppPath, runNodeSmoke, runWindowSmoke, runServiceSmoke } = require('../scripts/smoke-packaged-app.cjs');

test('packaged smoke selects macOS app and Windows executable bundle paths', () => {
  assert.equal(packagedAppPath('x64', 'win32'), path.resolve(__dirname, '../out/Live2Pet-win32-x64'));
  assert.equal(packagedAppPath('arm64', 'darwin'), path.resolve(__dirname, '../out/Live2Pet-darwin-arm64/Live2Pet.app'));
  assert.throws(() => packagedAppPath('arm64', 'win32'), { code: 'UNSUPPORTED_PACKAGE_ARCH' });
});

test('packaged service acceptance runs the checkout harness against each packaged ASAR', () => {
  for (const [platform, arch] of [['darwin', 'x64'], ['darwin', 'arm64'], ['win32', 'x64']]) {
    const appPath = packagedAppPath(arch, platform);
    const result = runServiceSmoke(appPath, { platform, execute(executable, args, options) {
      assert.equal(executable, platform === 'win32' ? path.join(appPath, 'Live2Pet.exe') : path.join(appPath, 'Contents/MacOS/Live2Pet'));
      assert.equal(args[0], path.resolve(__dirname, '../scripts/accept-packaged-services.cjs'));
      assert.equal(args[1], '--asar');
      assert.equal(args[2], platform === 'win32' ? path.join(appPath, 'resources/app.asar') : path.join(appPath, 'Contents/Resources/app.asar'));
      assert.equal(options.env.ELECTRON_RUN_AS_NODE, '1');
      return JSON.stringify({ contractVersion: 1, packagedModules: true, scenarios: { installRollback: true } });
    } });
    assert.equal(result.packagedModules, true);
    assert.equal(result.scenarios.installRollback, true);
  }
});

test('native dependency smoke launches the platform executable against its ASAR', () => {
  for (const platform of ['darwin', 'win32']) {
    const appPath = packagedAppPath('x64', platform);
    const report = runNodeSmoke(appPath, { platform, execute(executable, args, options) {
      assert.equal(executable, platform === 'win32' ? path.join(appPath, 'Live2Pet.exe') : path.join(appPath, 'Contents/MacOS/Live2Pet'));
      const asar = platform === 'win32' ? path.join(appPath, 'resources/app.asar') : path.join(appPath, 'Contents/Resources/app.asar');
      assert.ok(args[1].includes(JSON.stringify(asar)));
      assert.equal(options.env.ELECTRON_RUN_AS_NODE, '1');
      return JSON.stringify({ sharp: 'fixture', libvips: 'fixture' });
    } });
    assert.equal(report.sharp, 'fixture');
  }
});

test('Windows startup smoke verifies the clean-profile ready marker and always removes its profile', () => {
  const ready = { packaged: true, renderer: 'heroui', mounted: true, document: 'index.html', services: { spine: true, cache: true, cacheLimit: 1024 ** 3 } };
  let profile;
  const options = { platform: 'win32', execute(executable, args, settings) {
    assert.equal(path.basename(executable), 'Live2Pet.exe');
    profile = args.find(arg => arg.startsWith('--user-data-dir=')).slice('--user-data-dir='.length);
    assert.equal(fs.existsSync(profile), true);
    assert.equal(settings.env.ELECTRON_RUN_AS_NODE, undefined);
    return `startup\r\nLIVE2PET_BUNDLE_READY ${JSON.stringify(ready)}\r\n`;
  } };
  assert.deepEqual(runWindowSmoke(packagedAppPath('x64', 'win32'), options), ready);
  assert.equal(fs.existsSync(profile), false);
  options.execute = (_executable, args) => {
    profile = args.find(arg => arg.startsWith('--user-data-dir=')).slice('--user-data-dir='.length);
    throw new Error('startup failed');
  };
  assert.throws(() => runWindowSmoke(packagedAppPath('x64', 'win32'), options), /startup failed/);
  assert.equal(fs.existsSync(profile), false);
});
