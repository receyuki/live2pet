const fs = require('node:fs');
const path = require('node:path');

const { APP_NAME, outputRoot, verifyBundleLayout } = require('./package-macos.cjs');

function resolvePaths(root = outputRoot) {
  return {
    x64AppPath: path.resolve(root, `${APP_NAME}-darwin-x64`, `${APP_NAME}.app`),
    arm64AppPath: path.resolve(root, `${APP_NAME}-darwin-arm64`, `${APP_NAME}.app`),
    outAppPath: path.resolve(root, `${APP_NAME}-darwin-universal`, `${APP_NAME}.app`),
  };
}

function requireSlice(appPath, arch) {
  if (!fs.existsSync(appPath)) {
    const error = new Error(`The ${arch} macOS App slice is missing: ${appPath}`);
    error.code = 'MACOS_SLICE_MISSING';
    throw error;
  }
  verifyBundleLayout(appPath, { requiredSharpPatterns: [new RegExp(`sharp-darwin-${arch}\\.node$`, 'i')] });
}

async function mergeMacUniversal(root = outputRoot) {
  const paths = resolvePaths(root);
  requireSlice(paths.x64AppPath, 'x64');
  requireSlice(paths.arm64AppPath, 'arm64');
  fs.mkdirSync(path.dirname(paths.outAppPath), { recursive: true });
  const { makeUniversalApp } = await import('@electron/universal');
  await makeUniversalApp({
    ...paths,
    force: true,
    mergeASARs: true,
    singleArchFiles: 'node_modules/@img/**',
  });
  const verification = verifyBundleLayout(paths.outAppPath, {
    requiredSharpPatterns: [/sharp-darwin-x64\.node$/i, /sharp-darwin-arm64\.node$/i],
  });
  const report = { contractVersion: 1, platform: 'darwin', arch: 'universal', signed: false, distributable: false, ...verification };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  return report;
}

if (require.main === module) mergeMacUniversal().catch((error) => {
  process.stderr.write(`${error.code || 'UNIVERSAL_PACKAGE_FAILED'}: ${error.message}\n`);
  process.exitCode = 1;
});

module.exports = { mergeMacUniversal, requireSlice, resolvePaths };
