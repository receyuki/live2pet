const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const PACK_SCHEMA_VERSION = 1;
const MAX_PACK_BYTES = 8 * 1024 * 1024;
const SPINE_PACK = Object.freeze({
  id: 'spine-player-4.3',
  runtimeLine: '4.3',
  version: '4.3.13',
  files: Object.freeze([
    Object.freeze({ name: 'spine-player.min.js', url: 'https://unpkg.com/@esotericsoftware/spine-player@4.3.13/dist/iife/spine-player.min.js', sha256: 'bf48b87866822ce2e8bf244ac0251d90ab8b08bc71564d9da2dfb1b4431b4803' }),
    Object.freeze({ name: 'spine-player.min.css', url: 'https://unpkg.com/@esotericsoftware/spine-player@4.3.13/dist/spine-player.min.css', sha256: '850b3a4bdacc3ca322a958048a79af14c8256bcbf42d32da2fb8f072d2674c4d' }),
    Object.freeze({ name: 'LICENSE', url: 'https://unpkg.com/@esotericsoftware/spine-player@4.3.13/LICENSE', sha256: '435774fb793b0f67892899fc934f98009e64fd90ad3ab964117274e279a0f50e' }),
  ]),
});

class SpinePackError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'SpinePackError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details = {}) { throw new SpinePackError(code, message, details); }
function digest(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }

function normalizeRoot(root) {
  if (typeof root !== 'string' || !root.trim()) fail('INVALID_SPINE_PACK_ROOT', 'A Spine renderer-pack storage directory is required.');
  const absolute = path.resolve(root);
  if (path.parse(absolute).root === absolute) fail('INVALID_SPINE_PACK_ROOT', 'The Spine renderer-pack storage directory cannot be a filesystem root.');
  return absolute;
}

function packDirectory(root, pack = SPINE_PACK) { return path.join(normalizeRoot(root), pack.id); }
function manifestPath(root, pack = SPINE_PACK) { return path.join(packDirectory(root, pack), 'pack.json'); }

function publicStatus(root, pack = SPINE_PACK) {
  const directory = packDirectory(root, pack);
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath(root, pack), 'utf8'));
    const valid = manifest?.schemaVersion === PACK_SCHEMA_VERSION
      && manifest.id === pack.id
      && manifest.version === pack.version
      && pack.files.every((file) => {
        const filePath = path.join(directory, file.name);
        return manifest.files?.[file.name] === file.sha256 && fs.statSync(filePath).isFile() && digest(fs.readFileSync(filePath)) === file.sha256;
      });
    if (!valid) throw new Error('invalid');
    return { schemaVersion: PACK_SCHEMA_VERSION, id: pack.id, runtimeLine: pack.runtimeLine, version: pack.version, installed: true };
  } catch {
    return { schemaVersion: PACK_SCHEMA_VERSION, id: pack.id, runtimeLine: pack.runtimeLine, version: pack.version, installed: false };
  }
}

async function responseBytes(response, file) {
  if (!response || response.ok !== true || typeof response.arrayBuffer !== 'function') fail('SPINE_PACK_DOWNLOAD_FAILED', `Could not download ${file.name}.`, { status: response?.status });
  const contentLength = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(contentLength) && contentLength > MAX_PACK_BYTES) fail('SPINE_PACK_TOO_LARGE', 'Spine renderer pack exceeds the 8 MiB safety limit.');
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.byteLength > MAX_PACK_BYTES) fail('SPINE_PACK_TOO_LARGE', 'Spine renderer pack exceeds the 8 MiB safety limit.');
  if (digest(bytes) !== file.sha256) fail('SPINE_PACK_INTEGRITY_FAILED', `Downloaded ${file.name} did not match the pinned integrity value.`);
  return bytes;
}

async function installSpinePack(root, { confirmInstall = false, fetchImpl = globalThis.fetch, onProgress, pack = SPINE_PACK } = {}) {
  if (confirmInstall !== true) fail('SPINE_PACK_CONSENT_REQUIRED', 'Downloading Spine support requires an explicit user action.');
  if (typeof fetchImpl !== 'function') fail('SPINE_PACK_DOWNLOAD_UNAVAILABLE', 'This App runtime cannot download the optional Spine renderer pack.');
  const absoluteRoot = normalizeRoot(root);
  if (publicStatus(absoluteRoot, pack).installed) return publicStatus(absoluteRoot, pack);
  fs.mkdirSync(absoluteRoot, { recursive: true, mode: 0o700 });
  const staging = path.join(absoluteRoot, `.${pack.id}.${process.pid}.${crypto.randomUUID()}.tmp`);
  fs.mkdirSync(staging, { mode: 0o700 });
  try {
    const installedFiles = {};
    let totalBytes = 0;
    for (const [index, file] of pack.files.entries()) {
      const response = await fetchImpl(file.url, { redirect: 'follow' });
      const bytes = await responseBytes(response, file);
      totalBytes += bytes.byteLength;
      if (totalBytes > MAX_PACK_BYTES) fail('SPINE_PACK_TOO_LARGE', 'Spine renderer pack exceeds the 8 MiB safety limit.');
      fs.writeFileSync(path.join(staging, file.name), bytes, { mode: 0o600, flag: 'wx' });
      installedFiles[file.name] = file.sha256;
      onProgress?.({ completed: index + 1, total: pack.files.length, file: file.name });
    }
    fs.writeFileSync(path.join(staging, 'pack.json'), `${JSON.stringify({ schemaVersion: PACK_SCHEMA_VERSION, id: pack.id, runtimeLine: pack.runtimeLine, version: pack.version, files: installedFiles }, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    const destination = packDirectory(absoluteRoot, pack);
    try { fs.rmSync(destination, { recursive: true, force: true }); } catch {}
    fs.renameSync(staging, destination);
    return publicStatus(absoluteRoot, pack);
  } catch (error) {
    try { fs.rmSync(staging, { recursive: true, force: true }); } catch {}
    if (error instanceof SpinePackError) throw error;
    fail('SPINE_PACK_INSTALL_FAILED', 'The optional Spine renderer pack could not be installed.', { cause: error?.code || String(error?.message || error) });
  }
}

function removeSpinePack(root, pack = SPINE_PACK) {
  fs.rmSync(packDirectory(root, pack), { recursive: true, force: true });
  return publicStatus(root, pack);
}

function resolveSpinePack(root, runtimeLine) {
  if (runtimeLine !== SPINE_PACK.runtimeLine) fail('UNSUPPORTED_SPINE_VERSION', `Spine ${runtimeLine} is not supported by the installed renderer pack.`, { supported: SPINE_PACK.runtimeLine });
  const status = publicStatus(root);
  if (!status.installed) fail('SPINE_PACK_REQUIRED', `Install Spine ${SPINE_PACK.runtimeLine} support before previewing or building this model.`);
  const directory = packDirectory(root, SPINE_PACK);
  return { ...status, directory, scriptPath: path.join(directory, 'spine-player.min.js'), stylePath: path.join(directory, 'spine-player.min.css'), licensePath: path.join(directory, 'LICENSE') };
}

module.exports = { MAX_PACK_BYTES, PACK_SCHEMA_VERSION, SPINE_PACK, SpinePackError, getSpinePackStatus: publicStatus, installSpinePack, removeSpinePack, resolveSpinePack };
