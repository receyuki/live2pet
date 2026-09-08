const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const repositoryRoot = path.resolve(__dirname, '../../..');
const requiredFiles = [
  'LICENSE',
  'NOTICE',
  'SECURITY.md',
  'CONTRIBUTING.md',
  'docs/dependency-inventory.md',
  'docs/release-checklist.md',
  'apps/desktop/THIRD-PARTY-NOTICES.md',
];
const forbiddenDirectory = /(?:^|\/)(?:examples?|archive|artifacts?)(?:\/|$)/i;
const forbiddenExtension = /\.(?:pck|lpk|moc|moc3|dat|webp|zip|l2pack)$/i;
const forbiddenRuntime = /(?:^|\/)(?:live2dcubismcore|minified-live2d(?:core)?|live2d\.min)\.(?:js|wasm)$/i;
const maximumTextBytes = 2 * 1024 * 1024;
const allowedBinaryReleaseFiles = new Set([
  'apps/desktop/assets/icon.icns',
  'apps/desktop/assets/icon.ico',
  'apps/desktop/assets/icon.png',
  'docs/assets/app-preview.png',
  'docs/assets/live2pet-desktop-pet-preview.gif',
]);

function trackedFiles() {
  const output = execFileSync('git', ['ls-files', '-c', '-o', '--exclude-standard', '-z'], { cwd: repositoryRoot });
  return output.toString('utf8').split('\0').filter(Boolean);
}

function hasBinaryPrefix(bytes) {
  const limit = Math.min(bytes.length, 8192);
  for (let index = 0; index < limit; index += 1) if (bytes[index] === 0) return true;
  return false;
}

function run() {
  const errors = [];
  let files;
  try {
    files = trackedFiles();
  } catch (error) {
    errors.push({ code: 'GIT_FILE_LIST_FAILED', message: String(error.message || error) });
    files = [];
  }
  for (const required of requiredFiles) if (!files.includes(required)) errors.push({ code: 'REQUIRED_RELEASE_FILE_MISSING', file: required });
  for (const relative of files) {
    const normalized = relative.split(path.sep).join('/');
    const allowedBinary = allowedBinaryReleaseFiles.has(normalized);
    if (forbiddenDirectory.test(normalized)) errors.push({ code: 'COPYRIGHT_ASSET_PATH', file: normalized });
    if (forbiddenExtension.test(normalized)) errors.push({ code: 'DERIVED_ASSET_PATH', file: normalized });
    if (forbiddenRuntime.test(normalized)) errors.push({ code: 'RUNTIME_PATH', file: normalized });
    const absolute = path.resolve(repositoryRoot, relative);
    let stat;
    try { stat = fs.statSync(absolute); } catch (error) {
      errors.push({ code: 'RELEASE_FILE_UNREADABLE', file: normalized, message: String(error.message || error) });
      continue;
    }
    if (!stat.isFile()) {
      errors.push({ code: 'RELEASE_ENTRY_NOT_FILE', file: normalized });
      continue;
    }
    if (!allowedBinary && stat.size > maximumTextBytes) errors.push({ code: 'RELEASE_FILE_TOO_LARGE', file: normalized, byteLength: stat.size, maximumTextBytes });
    try {
      const bytes = fs.readFileSync(absolute);
      if (!allowedBinary && hasBinaryPrefix(bytes)) errors.push({ code: 'BINARY_RELEASE_ENTRY', file: normalized });
    } catch (error) {
      errors.push({ code: 'RELEASE_FILE_UNREADABLE', file: normalized, message: String(error.message || error) });
    }
  }
  const license = files.includes('LICENSE') ? fs.readFileSync(path.join(repositoryRoot, 'LICENSE'), 'utf8') : '';
  if (!/Apache License, Version 2\.0/.test(license)) errors.push({ code: 'LICENSE_NOT_APACHE_2', file: 'LICENSE' });
  const notice = files.includes('NOTICE') ? fs.readFileSync(path.join(repositoryRoot, 'NOTICE'), 'utf8') : '';
  if (!/Live2Pet/.test(notice)) errors.push({ code: 'NOTICE_PROJECT_MISSING', file: 'NOTICE' });
  const report = {
    contractVersion: 1,
    ok: errors.length === 0,
    requiredFiles: [...requiredFiles],
    scannedFiles: files.length,
    ignoredLocalInputs: ['examples/', 'archive/', 'artifacts/', '*.pck', '*.lpk', '*.moc', '*.moc3', '*.webp', '*.zip', '*.l2pack', 'Cubism Core'],
    errors,
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (errors.length) process.exitCode = 1;
}

run();
