const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const zip = require('@zip.js/zip.js');

const PROTOCOL_VERSION = 1;
const MAX_ARCHIVE_BYTES = 256 * 1024 * 1024;
const MAX_ENTRY_BYTES = 128 * 1024 * 1024;
const MAX_ENTRY_COUNT = 2048;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/;

class InstallationError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'InstallationError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details = {}) {
  throw new InstallationError(code, message, details);
}

function bytes(value, label) {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  if (ArrayBuffer.isView(value)) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  fail('INVALID_PACKAGE_BYTES', `${label} must be a byte buffer.`);
}

function safeRelativeName(value) {
  if (typeof value !== 'string' || !value || value.includes('\\') || value.startsWith('/') || value.includes('\0')) return false;
  const normalized = path.posix.normalize(value);
  return normalized === value && normalized !== '.' && normalized !== '..' && !normalized.startsWith('../') && !normalized.includes('/../');
}

function safePackageId(value) {
  if (typeof value !== 'string' || !SAFE_ID.test(value)) fail('INVALID_PACKAGE_ID', 'The package id must use a safe filename-compatible identifier.');
  return value;
}

function progress(onProgress, stage, status, details = {}) {
  if (typeof onProgress === 'function') onProgress({ stage, status, ...details });
}

function normalizeConflict(value) {
  const conflict = value || 'cancel';
  if (!['cancel', 'upgrade', 'side-by-side'].includes(conflict)) fail('INVALID_CONFLICT_POLICY', 'Conflict policy must be cancel, upgrade, or side-by-side.');
  return conflict;
}

function archiveRoot(entries, target) {
  if (target === 'codex-pet') return '';
  const themeEntries = entries.filter((entry) => /^([^/]+)\/theme\.json$/i.test(entry.name));
  if (themeEntries.length !== 1) fail('INVALID_CLAWD_ARCHIVE', 'A Clawd package must contain exactly one root theme.json entry.');
  return themeEntries[0].name.slice(0, -'theme.json'.length);
}

function parseManifest(entries, name) {
  const entry = entries.find((item) => item.name === name);
  if (!entry) fail('PACKAGE_MANIFEST_MISSING', `${name} is missing from the package.`);
  try { return JSON.parse(entry.bytes.toString('utf8')); } catch (error) {
    fail('PACKAGE_MANIFEST_INVALID', `${name} is not valid JSON.`, { cause: String(error && error.message ? error.message : error) });
  }
}

function packageIdentity(entries, target, requestedId) {
  if (!['clawd', 'codex-pet'].includes(target)) fail('UNKNOWN_PACKAGE_TARGET', 'Target must be clawd or codex-pet.');
  const root = archiveRoot(entries, target);
  const manifest = parseManifest(entries, target === 'codex-pet' ? 'pet.json' : `${root}theme.json`);
  const manifestId = target === 'codex-pet' ? manifest && manifest.id : root.slice(0, -1);
  const id = safePackageId(requestedId || manifestId);
  if (requestedId && manifestId !== requestedId && target === 'codex-pet') fail('PACKAGE_ID_MISMATCH', 'The requested package id does not match pet.json.');
  return { id, manifest, root };
}

async function readArchive(packageBytes, { maxArchiveBytes = MAX_ARCHIVE_BYTES, maxEntryBytes = MAX_ENTRY_BYTES, maxEntryCount = MAX_ENTRY_COUNT, zipModule = zip } = {}) {
  const archive = bytes(packageBytes, 'package');
  if (!archive.length) fail('EMPTY_PACKAGE', 'The package archive cannot be empty.');
  if (archive.length > maxArchiveBytes) fail('PACKAGE_TOO_LARGE', `The package exceeds the ${maxArchiveBytes}-byte limit.`);
  if (!zipModule || typeof zipModule.ZipReader !== 'function' || typeof zipModule.Uint8ArrayReader !== 'function' || typeof zipModule.Uint8ArrayWriter !== 'function') fail('ZIP_READER_UNAVAILABLE', 'The zip.js reader is not available.');
  const reader = new zipModule.ZipReader(new zipModule.Uint8ArrayReader(new Uint8Array(archive.buffer, archive.byteOffset, archive.byteLength)));
  try {
    const sourceEntries = await reader.getEntries();
    if (sourceEntries.length > maxEntryCount) fail('PACKAGE_ENTRY_COUNT_LIMIT', `The package contains more than ${maxEntryCount} entries.`);
    const result = [];
    for (const entry of sourceEntries) {
      if (!entry || typeof entry.filename !== 'string') fail('INVALID_PACKAGE_ENTRY', 'The package contains an entry without a filename.');
      if (entry.filename.endsWith('/')) continue;
      if (!safeRelativeName(entry.filename)) fail('UNSAFE_PACKAGE_PATH', `The package entry path is not safe: ${entry.filename}`);
      if (Number.isFinite(entry.uncompressedSize) && entry.uncompressedSize > maxEntryBytes) fail('PACKAGE_ENTRY_TOO_LARGE', `The package entry exceeds the ${maxEntryBytes}-byte limit: ${entry.filename}`);
      const data = await entry.getData(new zipModule.Uint8ArrayWriter());
      const content = bytes(data, entry.filename);
      if (content.byteLength > maxEntryBytes) fail('PACKAGE_ENTRY_TOO_LARGE', `The package entry exceeds the ${maxEntryBytes}-byte limit: ${entry.filename}`);
      result.push({ name: entry.filename, bytes: content });
    }
    return result;
  } catch (error) {
    if (error instanceof InstallationError) throw error;
    fail('PACKAGE_READ_FAILED', 'The package archive could not be read.', { cause: String(error && error.message ? error.message : error) });
  } finally {
    try { await reader.close(); } catch {}
  }
}

function normalizeInstallEntries(entries, target, root) {
  const prefix = target === 'clawd' ? root : '';
  const normalized = [];
  for (const entry of entries) {
    if (prefix && !entry.name.startsWith(prefix)) fail('INVALID_CLAWD_ARCHIVE', `The Clawd package contains an entry outside its theme root: ${entry.name}`);
    const name = prefix ? entry.name.slice(prefix.length) : entry.name;
    if (!name || !safeRelativeName(name)) fail('UNSAFE_PACKAGE_PATH', `The package entry path is not safe: ${entry.name}`);
    normalized.push({ name, bytes: entry.bytes });
  }
  if (!normalized.some((entry) => entry.name === 'theme.json' || entry.name === 'pet.json')) fail('PACKAGE_MANIFEST_MISSING', 'The package does not contain its target manifest.');
  return normalized;
}

function ensureDirectory(directory) {
  const absolute = path.resolve(directory);
  if (fs.existsSync(absolute) && !fs.statSync(absolute).isDirectory()) fail('INSTALL_ROOT_NOT_DIRECTORY', 'The installation root is not a directory.');
  fs.mkdirSync(absolute, { recursive: true, mode: 0o700 });
  return absolute;
}

function uniqueSideBySidePath(root, id) {
  for (let index = 2; index < 10000; index += 1) {
    const candidate = `${id}-${index}`.slice(0, 96);
    const full = path.join(root, candidate);
    if (!fs.existsSync(full)) return { id: candidate, path: full };
  }
  fail('INSTALL_ID_EXHAUSTED', 'No available side-by-side package id was found.');
}

function writeStagedEntries(stage, entries) {
  for (const entry of entries) {
    const destination = path.resolve(stage, entry.name);
    if (destination !== stage && !destination.startsWith(`${stage}${path.sep}`)) fail('UNSAFE_PACKAGE_PATH', `The package entry escaped the staging directory: ${entry.name}`);
    fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
    fs.writeFileSync(destination, entry.bytes, { mode: 0o600, flag: 'wx' });
  }
}

function verifyInstalledDirectory(directory, entries) {
  for (const entry of entries) {
    const destination = path.join(directory, entry.name);
    if (!fs.existsSync(destination) || !fs.statSync(destination).isFile()) fail('INSTALL_VERIFY_FAILED', `Installed package is missing ${entry.name}.`);
  }
}

async function exportPackage({ packageBytes, outputPath, overwrite = false } = {}) {
  const content = bytes(packageBytes, 'package');
  if (typeof outputPath !== 'string' || !outputPath.trim()) fail('EXPORT_PATH_REQUIRED', 'An export output path is required.');
  const absolute = path.resolve(outputPath);
  fs.mkdirSync(path.dirname(absolute), { recursive: true, mode: 0o700 });
  const existed = fs.existsSync(absolute);
  if (existed && fs.statSync(absolute).isDirectory()) fail('EXPORT_PATH_DIRECTORY', 'The export output path is a directory.');
  if (existed && !overwrite) fail('EXPORT_EXISTS', 'The export output already exists; choose another path or explicitly enable overwrite.');
  const temporary = `${absolute}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, content, { mode: 0o600, flag: 'wx' });
    fs.renameSync(temporary, absolute);
  } catch (error) {
    try { fs.unlinkSync(temporary); } catch {}
    fail('EXPORT_FAILED', 'The package could not be exported.', { cause: error && error.code ? error.code : String(error && error.message ? error.message : error) });
  }
  return { path: absolute, byteLength: content.byteLength, sha256: crypto.createHash('sha256').update(content).digest('hex'), overwritten: Boolean(overwrite && existed) };
}

async function installPackage({ target, packageBytes, targetRoot, conflict = 'cancel', packageId, onProgress, beforeCommit, zipModule } = {}) {
  const policy = normalizeConflict(conflict);
  progress(onProgress, 'inspect', 'started');
  const entries = await readArchive(packageBytes, { zipModule });
  const identity = packageIdentity(entries, target, packageId);
  const installEntries = normalizeInstallEntries(entries, target, identity.root);
  progress(onProgress, 'inspect', 'completed', { target, packageId: identity.id, files: installEntries.length });
  const root = ensureDirectory(targetRoot);
  let destination = path.join(root, identity.id);
  let resolvedId = identity.id;
  const conflictExists = fs.existsSync(destination);
  if (conflictExists && policy === 'cancel') fail('INSTALL_CONFLICT', `An installation already exists for ${identity.id}.`, { target, packageId: identity.id, path: destination, choices: ['cancel', 'upgrade', 'side-by-side'] });
  if (conflictExists && policy === 'side-by-side') ({ id: resolvedId, path: destination } = uniqueSideBySidePath(root, identity.id));
  const stage = path.join(root, `.live2pet-stage-${crypto.randomUUID()}`);
  const backup = conflictExists && policy === 'upgrade' ? path.join(root, `.live2pet-backup-${crypto.randomUUID()}`) : null;
  progress(onProgress, 'stage', 'started', { packageId: resolvedId });
  try {
    fs.mkdirSync(stage, { recursive: true, mode: 0o700 });
    writeStagedEntries(stage, installEntries);
    verifyInstalledDirectory(stage, installEntries);
    progress(onProgress, 'stage', 'completed', { packageId: resolvedId });
    if (backup) fs.renameSync(destination, backup);
    if (typeof beforeCommit === 'function') await beforeCommit({ phase: 'before-commit', target, packageId: resolvedId, destination });
    progress(onProgress, 'commit', 'started', { packageId: resolvedId, conflict: policy });
    fs.renameSync(stage, destination);
    verifyInstalledDirectory(destination, installEntries);
    if (backup) fs.rmSync(backup, { recursive: true, force: true });
    progress(onProgress, 'commit', 'completed', { packageId: resolvedId, conflict: policy });
    return { protocolVersion: PROTOCOL_VERSION, target, packageId: resolvedId, path: destination, conflict: conflictExists ? policy : 'none', files: installEntries.map((entry) => entry.name), byteLength: installEntries.reduce((total, entry) => total + entry.bytes.byteLength, 0) };
  } catch (error) {
    try { if (fs.existsSync(destination) && (!conflictExists || backup)) fs.rmSync(destination, { recursive: true, force: true }); } catch {}
    try { if (backup && fs.existsSync(backup) && !fs.existsSync(destination)) fs.renameSync(backup, destination); } catch {}
    try { if (fs.existsSync(stage)) fs.rmSync(stage, { recursive: true, force: true }); } catch {}
    if (error instanceof InstallationError) throw error;
    fail('INSTALL_FAILED', 'The package could not be installed.', { cause: error && error.code ? error.code : String(error && error.message ? error.message : error) });
  }
}

module.exports = {
  InstallationError,
  MAX_ARCHIVE_BYTES,
  MAX_ENTRY_BYTES,
  MAX_ENTRY_COUNT,
  PROTOCOL_VERSION,
  exportPackage,
  installPackage,
  readArchive,
};
