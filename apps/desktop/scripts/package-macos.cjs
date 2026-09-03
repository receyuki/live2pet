const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const repositoryRoot = path.resolve(__dirname, '../../..');
const desktopRoot = path.resolve(__dirname, '..');
const mapperRoot = path.join(desktopRoot, 'mapper-dist');
const rendererRoot = path.join(desktopRoot, 'renderer-dist');
const outputRoot = path.join(desktopRoot, 'out');
const APP_ICON_PATH = path.join(desktopRoot, 'assets', 'icon.icns');
const ELECTRON_VERSION = '44.0.0';
const APP_NAME = 'Live2Pet';
const RENDERER_LICENSE_FILE = 'THIRD-PARTY-LICENSES.md';
const RENDERER_STYLE_LICENSES = ['@heroui/styles', 'tailwindcss'];
const FORBIDDEN_BUNDLE_ENTRY = /(?:^|\/)(?:examples?|archive|artifacts?|models?)(?:\/|$)|\.(?:pck|lpk|moc|moc3|dat|webp|zip)$|(?:^|\/)(?:live2dcubismcore|minified-live2d(?:core)?|live2d\.min)\.(?:js|wasm)$/i;

function fail(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  throw error;
}

function currentMacArch(platform = process.platform, architecture = process.arch) {
  if (platform !== 'darwin') fail('UNSUPPORTED_PACKAGE_HOST', 'The personal-use V1 package command currently builds macOS only.');
  if (!['x64', 'arm64'].includes(architecture)) fail('UNSUPPORTED_PACKAGE_ARCH', `Unsupported macOS architecture: ${architecture}.`);
  return architecture;
}

function pnpmInvocation(environment = process.env) {
  const entrypoint = environment.npm_execpath;
  if (typeof entrypoint !== 'string' || !entrypoint.trim()) {
    fail('PNPM_REQUIRED', 'Run this command through pnpm so the production deployment can use the locked workspace graph.');
  }
  return { command: process.execPath, prefix: [entrypoint] };
}

function requireDirectory(directory, code, message) {
  let stat;
  try { stat = fs.statSync(directory); } catch { fail(code, message); }
  if (!stat.isDirectory()) fail(code, message);
}

function copyResources(tempRoot) {
  requireDirectory(mapperRoot, 'MAPPER_NOT_STAGED', 'Stage the Mapper assets before packaging the App.');
  requireDirectory(rendererRoot, 'RENDERER_NOT_BUILT', 'Build the HeroUI renderer before packaging the App.');
  const resourcesRoot = path.join(tempRoot, 'resources');
  const mapperTarget = path.join(resourcesRoot, 'mapper-dist');
  const rendererTarget = path.join(resourcesRoot, 'renderer-dist');
  fs.mkdirSync(resourcesRoot, { recursive: true });
  fs.cpSync(mapperRoot, mapperTarget, { recursive: true, dereference: true });
  fs.cpSync(rendererRoot, rendererTarget, { recursive: true, dereference: true });
  if (!fs.existsSync(path.join(rendererTarget, RENDERER_LICENSE_FILE))) fail('RENDERER_LICENSES_MISSING', 'Rebuild the renderer with its bundled dependency license report.');
  const licensesRoot = path.join(rendererTarget, 'licenses');
  fs.mkdirSync(licensesRoot, { recursive: true });
  // Vite records JavaScript module licenses. Keep CSS-only dependency licenses too.
  for (const name of RENDERER_STYLE_LICENSES) {
    const dependencyRoot = path.join(desktopRoot, 'node_modules', name);
    const license = fs.readdirSync(dependencyRoot).find(file => /^licen[cs]e(?:\.|$)/i.test(file));
    if (!license) fail('RENDERER_LICENSES_MISSING', `Missing stylesheet license for ${name}.`);
    fs.copyFileSync(path.join(dependencyRoot, license), path.join(licensesRoot, `${name.replace('/', '_')}.txt`));
  }
  return [mapperTarget, rendererTarget];
}

function verifyProductionStage(stageRoot) {
  const redundant = ['assets', 'ui', 'renderer-dist', 'mapper-dist', 'node_modules/react', 'node_modules/react-dom', 'node_modules/lucide-react', 'node_modules/@heroui'];
  const found = redundant.filter(relative => fs.existsSync(path.join(stageRoot, relative)));
  if (found.length) fail('REDUNDANT_PACKAGE_CONTENT', 'The production stage contains renderer-only dependencies or local design assets.', { entries: found });
}

function deployProductionStage(stageRoot, environment = process.env) {
  const invocation = pnpmInvocation(environment);
  execFileSync(invocation.command, [
    ...invocation.prefix,
    '--config.inject-workspace-packages=true',
    '--config.node-linker=hoisted',
    '--filter',
    '@live2pet/desktop',
    'deploy',
    '--prod',
    stageRoot,
  ], { cwd: repositoryRoot, env: environment, stdio: 'inherit' });

  for (const relative of ['mapper-dist', 'renderer-dist', 'ui', 'test', 'scripts', 'out', 'make', 'forge.config.cjs']) {
    fs.rmSync(path.join(stageRoot, relative), { recursive: true, force: true });
  }
  const internalPackages = path.join(stageRoot, 'node_modules', '@live2pet');
  if (fs.existsSync(internalPackages)) {
    for (const packageName of fs.readdirSync(internalPackages)) {
      fs.rmSync(path.join(internalPackages, packageName, 'test'), { recursive: true, force: true });
    }
  }
  for (const relative of ['node_modules/.pnpm', 'node_modules/.modules.yaml', 'node_modules/.pnpm-workspace-state-v1.json', 'pnpm-lock.yaml']) {
    fs.rmSync(path.join(stageRoot, relative), { recursive: true, force: true });
  }
  verifyProductionStage(stageRoot);
}

function createPackagerOptions({ stageRoot, extraResource, arch = currentMacArch() } = {}) {
  const electronZipDir = findElectronZipDir(arch);
  return {
    dir: stageRoot,
    name: APP_NAME,
    executableName: APP_NAME,
    appBundleId: 'dev.live2pet.desktop',
    appVersion: '0.1.0',
    buildVersion: '0.1.0',
    icon: APP_ICON_PATH,
    platform: 'darwin',
    arch,
    electronVersion: ELECTRON_VERSION,
    ...(electronZipDir ? { electronZipDir } : {}),
    out: outputRoot,
    overwrite: true,
    prune: false,
    derefSymlinks: true,
    asar: { unpack: '**/node_modules/{sharp,@img}/**/*' },
    extraResource,
  };
}

function findElectronZipDir(arch = currentMacArch(), cacheRoot = path.join(os.homedir(), 'Library', 'Caches', 'electron')) {
  const expected = `electron-v${ELECTRON_VERSION}-darwin-${arch}.zip`;
  const pending = [{ directory: cacheRoot, depth: 0 }];
  while (pending.length) {
    const { directory, depth } = pending.shift();
    let entries;
    try { entries = fs.readdirSync(directory, { withFileTypes: true }); } catch { continue; }
    if (entries.some((entry) => entry.isFile() && entry.name === expected)) return directory;
    if (depth >= 2) continue;
    for (const entry of entries) if (entry.isDirectory()) pending.push({ directory: path.join(directory, entry.name), depth: depth + 1 });
  }
  return null;
}

function walkFiles(root, prefix = '') {
  const files = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...walkFiles(absolute, relative));
    else files.push(relative);
  }
  return files;
}

function verifyBundleLayout(appPath) {
  const resources = path.join(appPath, 'Contents', 'Resources');
  const required = [
    path.join(resources, 'app.asar'),
    path.join(resources, 'mapper-dist', 'index.html'),
    path.join(resources, 'renderer-dist', 'index.html'),
    path.join(resources, 'renderer-dist', RENDERER_LICENSE_FILE),
    ...RENDERER_STYLE_LICENSES.map(name => path.join(resources, 'renderer-dist', 'licenses', `${name.replace('/', '_')}.txt`)),
  ];
  const missing = required.filter((entry) => !fs.existsSync(entry));
  if (missing.length) fail('PACKAGE_LAYOUT_INVALID', 'The packaged App is missing required resources.', { missing });
  const visibleEntries = walkFiles(resources).filter((entry) => !entry.startsWith('app.asar'));
  const forbidden = visibleEntries.filter((entry) => FORBIDDEN_BUNDLE_ENTRY.test(entry));
  if (forbidden.length) fail('FORBIDDEN_PACKAGE_ASSET', 'The packaged App contains a user-provided or generated asset.', { forbidden });
  const nativeRoot = path.join(resources, 'app.asar.unpacked', 'node_modules');
  const nativeEntries = fs.existsSync(nativeRoot) ? walkFiles(nativeRoot) : [];
  if (!nativeEntries.some((entry) => /sharp-darwin-(?:x64|arm64)\.node$/i.test(entry))) {
    fail('SHARP_NATIVE_BINARY_MISSING', 'The packaged App does not contain an unpacked Sharp native module.');
  }
  return {
    appPath,
    resources: ['mapper-dist', 'renderer-dist'],
    nativeSharp: true,
    forbiddenAssetCount: 0,
  };
}

async function packageMacApp() {
  const arch = currentMacArch();
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'live2pet-package-'));
  const stageRoot = path.join(tempRoot, 'app');
  try {
    const extraResource = copyResources(tempRoot);
    deployProductionStage(stageRoot);
    const { packager } = await import('@electron/packager');
    const outputPaths = await packager(createPackagerOptions({ stageRoot, extraResource, arch }));
    if (!Array.isArray(outputPaths) || outputPaths.length !== 1) fail('PACKAGE_OUTPUT_INVALID', 'Electron Packager did not return exactly one current-machine build.');
    const appPath = path.join(outputPaths[0], `${APP_NAME}.app`);
    const verification = verifyBundleLayout(appPath);
    const report = {
      contractVersion: 1,
      platform: 'darwin',
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

if (require.main === module) packageMacApp().catch((error) => {
  process.stderr.write(`${error.code || 'PACKAGE_FAILED'}: ${error.message}\n`);
  if (error.details && Object.keys(error.details).length) process.stderr.write(`${JSON.stringify(error.details, null, 2)}\n`);
  process.exitCode = 1;
});

module.exports = {
  APP_ICON_PATH,
  APP_NAME,
  ELECTRON_VERSION,
  FORBIDDEN_BUNDLE_ENTRY,
  createPackagerOptions,
  currentMacArch,
  findElectronZipDir,
  packageMacApp,
  pnpmInvocation,
  verifyBundleLayout,
  verifyProductionStage,
};
