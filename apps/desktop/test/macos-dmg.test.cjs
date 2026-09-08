const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { createDmg, findCreateDmgBin, requireMac, verifyDmg } = require('../scripts/macos-dmg.cjs');
const repositoryRoot = path.resolve(__dirname, '../../..');

test('DMG commands remain macOS-only', () => {
  assert.doesNotThrow(() => requireMac('darwin'));
  assert.throws(() => requireMac('win32'), (error) => error.code === 'UNSUPPORTED_DMG_HOST');
});

test('DMG tool resolution prefers an explicit path, then native Homebrew prefixes', () => {
  assert.equal(findCreateDmgBin({ LIVE2PET_CREATE_DMG_BIN: '/custom/create-dmg' }, () => false), '/custom/create-dmg');
  assert.equal(findCreateDmgBin({}, (candidate) => candidate.startsWith('/usr/local/')), '/usr/local/opt/create-dmg/bin/create-dmg');
  assert.equal(findCreateDmgBin({}, () => false), 'create-dmg');
});

test('DMG creation uses the pinned unsigned drag-to-install tool and preserves the requested filename', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'live2pet-dmg-create-test-'));
  const app = path.join(root, 'Live2Pet.app');
  const output = path.join(root, 'Live2Pet-macOS-x64.dmg');
  fs.mkdirSync(app);
  try {
    const result = createDmg({
      appPath: app,
      outputPath: output,
      platform: 'darwin',
      createDmgBin: '/test/create-dmg',
      run(command, args) {
        assert.equal(command, '/test/create-dmg');
        assert.deepEqual(args.slice(0, 8), ['--volname', 'Live2Pet', '--window-size', '660', '400', '--icon-size', '128', '--add-file']);
        assert.deepEqual(args.slice(-4), ['--overwrite', '--hdiutil-quiet', output, args.at(-1)]);
        fs.writeFileSync(output, 'disk image');
      },
    });
    assert.equal(result.outputPath, output);
    assert.equal(result.signed, false);
    assert.equal(fs.readFileSync(output, 'utf8'), 'disk image');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('DMG verification requires both the App and Applications entry and always detaches', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'live2pet-dmg-verify-test-'));
  const dmg = path.join(root, 'Live2Pet.dmg');
  fs.writeFileSync(dmg, 'disk image');
  const calls = [];
  try {
    const result = verifyDmg({
      dmgPath: dmg,
      platform: 'darwin',
      run(command, args) {
        calls.push([command, ...args]);
        if (args[0] === 'attach') {
          const mountRoot = args[args.indexOf('-mountpoint') + 1];
          fs.mkdirSync(path.join(mountRoot, 'Live2Pet.app'));
          fs.writeFileSync(path.join(mountRoot, 'Applications'), 'Finder alias');
        }
      },
    });
    assert.equal(result.applicationsLink, true);
    assert.equal(calls[0][1], 'attach');
    assert.equal(calls.at(-1)[1], 'detach');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('release workflow builds and verifies the styled DMG while READMEs reuse the packaged PNG', () => {
  const workflow = fs.readFileSync(path.join(repositoryRoot, '.github/workflows/desktop-release.yml'), 'utf8');
  const manifest = require('../package.json');
  assert.match(workflow, /brew install create-dmg/);
  assert.match(workflow, /macos-dmg\.cjs create/);
  assert.match(workflow, /macos-dmg\.cjs verify/);
  assert.equal(manifest.devDependencies['create-dmg'], undefined);
  for (const readme of ['README.md', 'README.zh-CN.md']) {
    const source = fs.readFileSync(path.join(repositoryRoot, readme), 'utf8');
    assert.match(source, /^<p align="center"><img src="apps\/desktop\/assets\/icon\.png"/);
  }
});
