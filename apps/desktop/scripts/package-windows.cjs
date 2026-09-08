const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  APP_NAME,
  APP_VERSION,
  ELECTRON_VERSION,
  copyResources,
  deployProductionStage,
  desktopRoot,
  outputRoot,
  verifyResourcesLayout,
} = require('./package-macos.cjs');

const WINDOWS_ICON_PATH = path.join(desktopRoot, 'assets', 'icon.ico');

function fail(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  throw error;
}

function currentWindowsArch(platform = process.platform, architecture = process.arch) {
  if (platform !== 'win32') fail('UNSUPPORTED_PACKAGE_HOST', 'The Windows package command must run on Windows.');
  if (architecture !== 'x64') fail('UNSUPPORTED_PACKAGE_ARCH', `Unsupported Windows architecture: ${architecture}.`);
  return architecture;
}

function createWindowsPackagerOptions({ stageRoot, extraResource, arch = currentWindowsArch() } = {}) {
  return {
    dir: stageRoot,
    name: APP_NAME,
    executableName: APP_NAME,
    appVersion: APP_VERSION,
    buildVersion: APP_VERSION,
    icon: WINDOWS_ICON_PATH,
    platform: 'win32',
    arch,
    electronVersion: ELECTRON_VERSION,
    out: outputRoot,
    overwrite: true,
    prune: false,
    derefSymlinks: true,
    asar: { unpack: '**/node_modules/{sharp,@img}/**/*' },
    extraResource,
  };
}

function verifyWindowsBundleLayout(packagePath) {
  return {
    packagePath,
    ...verifyResourcesLayout(path.join(packagePath, 'resources'), { sharpPattern: /sharp-win32-x64\.node$/i }),
  };
}

async function packageWindowsApp() {
  const arch = currentWindowsArch();
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'live2pet-package-'));
  const stageRoot = path.join(tempRoot, 'app');
  try {
    const extraResource = copyResources(tempRoot);
    deployProductionStage(stageRoot);
    const { packager } = await import('@electron/packager');
    const outputPaths = await packager(createWindowsPackagerOptions({ stageRoot, extraResource, arch }));
    if (!Array.isArray(outputPaths) || outputPaths.length !== 1) fail('PACKAGE_OUTPUT_INVALID', 'Electron Packager did not return exactly one Windows build.');
    const verification = verifyWindowsBundleLayout(outputPaths[0]);
    const report = {
      contractVersion: 1,
      platform: 'win32',
      arch,
      electronVersion: ELECTRON_VERSION,
      signed: false,
      distributable: false,
      ...verification,
    };
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return report;
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

if (require.main === module) packageWindowsApp().catch((error) => {
  process.stderr.write(`${error.code || 'PACKAGE_FAILED'}: ${error.message}\n`);
  if (error.details && Object.keys(error.details).length) process.stderr.write(`${JSON.stringify(error.details, null, 2)}\n`);
  process.exitCode = 1;
});

module.exports = {
  WINDOWS_ICON_PATH,
  createWindowsPackagerOptions,
  currentWindowsArch,
  packageWindowsApp,
  verifyWindowsBundleLayout,
};
