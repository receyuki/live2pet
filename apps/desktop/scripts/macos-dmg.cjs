const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

function fail(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  throw error;
}

function requireMac(platform = process.platform) {
  if (platform !== 'darwin') fail('UNSUPPORTED_DMG_HOST', 'Live2Pet DMGs can only be created and inspected on macOS.');
}

function requireApp(appPath) {
  let stat;
  try { stat = fs.statSync(appPath); } catch { fail('APP_NOT_FOUND', `Packaged App not found: ${appPath}`); }
  if (!stat.isDirectory() || path.extname(appPath) !== '.app') fail('APP_NOT_FOUND', `Packaged App not found: ${appPath}`);
}

function findCreateDmgBin(environment = process.env, exists = fs.existsSync) {
  if (environment.LIVE2PET_CREATE_DMG_BIN) return environment.LIVE2PET_CREATE_DMG_BIN;
  for (const candidate of ['/opt/homebrew/opt/create-dmg/bin/create-dmg', '/usr/local/opt/create-dmg/bin/create-dmg']) {
    if (exists(candidate)) return candidate;
  }
  return 'create-dmg';
}

function createDmg({
  appPath,
  outputPath,
  platform = process.platform,
  run = execFileSync,
  createDmgBin = findCreateDmgBin(),
} = {}) {
  requireMac(platform);
  const app = path.resolve(appPath || '');
  const output = path.resolve(outputPath || '');
  requireApp(app);
  if (path.extname(output).toLowerCase() !== '.dmg') fail('INVALID_DMG_OUTPUT', 'The DMG output path must end in .dmg.');

  const outputRoot = path.dirname(output);
  fs.mkdirSync(outputRoot, { recursive: true });
  const tempRoot = fs.mkdtempSync(path.join(outputRoot, '.live2pet-dmg-'));
  try {
    run(createDmgBin, [
      '--volname', 'Live2Pet',
      '--window-size', '660', '400',
      '--icon-size', '128',
      '--add-file', 'Live2Pet.app', app, '180', '185',
      '--hide-extension', 'Live2Pet.app',
      '--app-drop-link', '480', '185',
      '--format', 'ULFO',
      '--overwrite',
      '--hdiutil-quiet',
      output,
      tempRoot,
    ], { stdio: 'inherit' });

    if (!fs.existsSync(output)) fail('DMG_OUTPUT_MISSING', 'create-dmg did not produce the requested disk image.');
    return { contractVersion: 1, appPath: app, outputPath: output, signed: false };
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

function verifyDmg({ dmgPath, platform = process.platform, run = execFileSync } = {}) {
  requireMac(platform);
  const dmg = path.resolve(dmgPath || '');
  if (!fs.existsSync(dmg) || path.extname(dmg).toLowerCase() !== '.dmg') fail('DMG_NOT_FOUND', `DMG not found: ${dmg}`);

  const mountRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'live2pet-dmg-mount-'));
  let attached = false;
  try {
    run('/usr/bin/hdiutil', ['attach', '-readonly', '-nobrowse', '-mountpoint', mountRoot, dmg], { stdio: 'pipe' });
    attached = true;
    const app = path.join(mountRoot, 'Live2Pet.app');
    const applications = path.join(mountRoot, 'Applications');
    if (!fs.existsSync(app) || !fs.statSync(app).isDirectory()) fail('DMG_APP_MISSING', 'The DMG does not contain Live2Pet.app.');
    if (!fs.existsSync(applications)) fail('DMG_APPLICATIONS_LINK_MISSING', 'The DMG does not contain an Applications link.');
    return { contractVersion: 1, dmgPath: dmg, application: 'Live2Pet.app', applicationsLink: true };
  } finally {
    if (attached) run('/usr/bin/hdiutil', ['detach', mountRoot, '-force'], { stdio: 'pipe' });
    fs.rmSync(mountRoot, { recursive: true, force: true });
  }
}

if (require.main === module) {
  try {
    const [command, input, output] = process.argv.slice(2);
    const result = command === 'create'
      ? createDmg({ appPath: input, outputPath: output })
      : command === 'verify'
        ? verifyDmg({ dmgPath: input })
        : fail('INVALID_DMG_COMMAND', 'Usage: node macos-dmg.cjs <create APP DMG | verify DMG>');
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error.code || 'DMG_FAILED'}: ${error.message}\n`);
    if (error.details && Object.keys(error.details).length) process.stderr.write(`${JSON.stringify(error.details, null, 2)}\n`);
    process.exitCode = 1;
  }
}

module.exports = { createDmg, findCreateDmgBin, requireMac, verifyDmg };
