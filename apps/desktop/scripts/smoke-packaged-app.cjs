const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const { APP_NAME, FORBIDDEN_BUNDLE_ENTRY, currentMacArch, verifyBundleLayout } = require('./package-macos.cjs');
const { currentWindowsArch, verifyWindowsBundleLayout } = require('./package-windows.cjs');

const desktopRoot = path.resolve(__dirname, '..');

function packagedAppPath(arch = process.arch, platform = process.platform) {
  if (platform === 'win32') {
    currentWindowsArch(platform, arch);
    return path.join(desktopRoot, 'out', `${APP_NAME}-win32-${arch}`);
  }
  currentMacArch(platform, arch);
  return path.join(desktopRoot, 'out', `${APP_NAME}-darwin-${arch}`, `${APP_NAME}.app`);
}

function smokePaths(appPath, platform) {
  return platform === 'win32'
    ? { executable: path.join(appPath, `${APP_NAME}.exe`), appAsar: path.join(appPath, 'resources', 'app.asar') }
    : { executable: path.join(appPath, 'Contents', 'MacOS', APP_NAME), appAsar: path.join(appPath, 'Contents', 'Resources', 'app.asar') };
}

function runNodeSmoke(appPath, { platform = process.platform, execute = execFileSync } = {}) {
  const { executable, appAsar } = smokePaths(appPath, platform);
  const source = `
    const fs = require('node:fs');
    const path = require('node:path');
    const root = ${JSON.stringify(appAsar)};
    const forbidden = ${FORBIDDEN_BUNDLE_ENTRY.toString()};
    const files = [];
    function walk(dir, prefix = '') {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const relative = prefix ? prefix + '/' + entry.name : entry.name;
        if (entry.isDirectory()) walk(path.join(dir, entry.name), relative);
        else files.push(relative);
      }
    }
    walk(root);
    const bad = files.filter((entry) => forbidden.test(entry));
    if (bad.length) throw new Error('Forbidden bundled source entries: ' + bad.join(', '));
    const sharp = require(path.join(root, 'node_modules', 'sharp'));
    // Resolve the real main-process services from ASAR, not from checkout-relative paths.
    for (const service of ['preview-session-service', 'hosted-build-service', 'project-workspace-service', 'capture-cache-build', 'capture-cache-service', 'source-library-service']) require(path.join(root, service + '.cjs'));
    require('node:module').createRequire(path.join(root, 'main.cjs'))('@live2pet/spine-pack');
    const info = { sharp: sharp.versions.sharp, libvips: sharp.versions.vips, sourceFiles: files.length, forbiddenAssetCount: 0 };
    process.stdout.write(JSON.stringify(info));
  `;
  const output = execute(executable, ['-e', source], {
    encoding: 'utf8',
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  });
  return JSON.parse(output);
}

function runServiceSmoke(appPath, { platform = process.platform, execute = execFileSync } = {}) {
  const { executable, appAsar } = smokePaths(appPath, platform);
  const output = execute(executable, [path.join(__dirname, 'accept-packaged-services.cjs'), '--asar', appAsar], {
    encoding: 'utf8',
    timeout: 30 * 1000,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  });
  return JSON.parse(output);
}

function runWindowSmoke(appPath, { platform = process.platform, execute = execFileSync } = {}) {
  const { executable } = smokePaths(appPath, platform);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'live2pet-bundle-smoke-'));
  let output;
  try { output = execute(executable, ['--live2pet-smoke-test', `--user-data-dir=${profile}`], {
    encoding: 'utf8',
    timeout: 30 * 1000,
    env: Object.fromEntries(Object.entries(process.env).filter(([key]) => key !== 'ELECTRON_RUN_AS_NODE')),
  }); } finally { fs.rmSync(profile, { recursive: true, force: true }); }
  const marker = output.split(/\r?\n/).find((line) => line.startsWith('LIVE2PET_BUNDLE_READY '));
  if (!marker) throw new Error('The packaged App exited without reaching the HeroUI ready state.');
  const ready = JSON.parse(marker.slice('LIVE2PET_BUNDLE_READY '.length));
  if (ready.packaged !== true || ready.renderer !== 'heroui' || ready.mounted !== true || ready.document !== 'index.html') throw new Error('The packaged App reported an invalid HeroUI ready state.');
  if (ready.services?.spine !== true || ready.services?.cache !== true || ready.services?.cacheLimit !== 1024 ** 3) throw new Error('The packaged App failed the clean-profile Spine/library IPC checks.');
  return ready;
}

function smokePackagedApp() {
  const appPath = packagedAppPath();
  if (!fs.existsSync(appPath)) throw new Error('Build the current-machine App before running its smoke test.');
  const layout = process.platform === 'win32' ? verifyWindowsBundleLayout(appPath) : verifyBundleLayout(appPath);
  const runtime = runNodeSmoke(appPath);
  const servicesAcceptance = runServiceSmoke(appPath);
  const window = runWindowSmoke(appPath);
  const report = { contractVersion: 1, appPath, layout, runtime, servicesAcceptance, window };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  return report;
}

if (require.main === module) {
  try { smokePackagedApp(); } catch (error) {
    process.stderr.write(`PACKAGE_SMOKE_FAILED: ${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { packagedAppPath, runNodeSmoke, runServiceSmoke, runWindowSmoke, smokePackagedApp };
