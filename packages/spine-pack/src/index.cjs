const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const PACK_SCHEMA_VERSION = 2;
const MAX_PACK_BYTES = 8 * 1024 * 1024;
const pack = (runtimeLine, version, hashes, cssName = 'spine-player.min.css') => Object.freeze({
  id: `spine-player-${runtimeLine}`,
  runtimeLine,
  version,
  downloadable: true,
  files: Object.freeze([
    Object.freeze({ name: 'spine-player.min.js', url: `https://unpkg.com/@esotericsoftware/spine-player@${version}/dist/iife/spine-player.min.js`, sha256: hashes.js }),
    Object.freeze({ name: 'spine-player.min.css', url: `https://unpkg.com/@esotericsoftware/spine-player@${version}/dist/${cssName}`, sha256: hashes.css }),
    Object.freeze({ name: 'LICENSE', url: `https://unpkg.com/@esotericsoftware/spine-player@${version}/LICENSE`, sha256: hashes.license }),
  ]),
});
const SPINE_PACKS = Object.freeze([
  pack('4.3', '4.3.13', { js: 'bf48b87866822ce2e8bf244ac0251d90ab8b08bc71564d9da2dfb1b4431b4803', css: '850b3a4bdacc3ca322a958048a79af14c8256bcbf42d32da2fb8f072d2674c4d', license: '435774fb793b0f67892899fc934f98009e64fd90ad3ab964117274e279a0f50e' }),
  pack('4.2', '4.2.119', { js: 'd70f07ff2ec1d5fa392f97576f4b951c8af838702d46066dede4be98b1c99324', css: 'e911ac88f6a8525d87f85d6301fecdd0f5e2b52834e3bfa594b6df407af9679a', license: '435774fb793b0f67892899fc934f98009e64fd90ad3ab964117274e279a0f50e' }),
  pack('4.1', '4.1.56', { js: '24cce070d92269584899187c3bf5d48a47e92e6f8501696855f0683c71bf2e0b', css: '6748233312b7dcf30bcf72016e058d713b85673724b0ffd780491e98067eca9e', license: '6142ee6cc2c03d3a918793e4750ae772bd3755c534d4a35e559e301acf51ec39' }),
  pack('4.0', '4.0.31', { js: 'e9ce520a15946a3e8d345670d78262d7aa71b9b164135a5424fe99ba191ab671', css: '2ce8e4f63557164fa77205aa4469c74950cf834f1ac91c222d794e6e66ae7e0c', license: '6142ee6cc2c03d3a918793e4750ae772bd3755c534d4a35e559e301acf51ec39' }, 'spine-player.css'),
]);
const SPINE_PACK = SPINE_PACKS[0];

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

function packForLine(runtimeLine) {
  const match = SPINE_PACKS.find((entry) => entry.runtimeLine === runtimeLine);
  if (!match) fail('UNSUPPORTED_SPINE_VERSION', `Spine ${runtimeLine || 'unknown'} does not have an official downloadable renderer pack in this App.`, { supported: SPINE_PACKS.map((entry) => entry.runtimeLine) });
  return match;
}
function packDirectory(root, selected = SPINE_PACK) { return path.join(normalizeRoot(root), selected.id); }
function manifestPath(root, selected = SPINE_PACK) { return path.join(packDirectory(root, selected), 'pack.json'); }

function publicStatus(root, selected = SPINE_PACK) {
  const directory = packDirectory(root, selected);
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath(root, selected), 'utf8'));
    const valid = manifest?.schemaVersion === PACK_SCHEMA_VERSION
      && manifest.id === selected.id
      && manifest.version === selected.version
      && selected.files.every((file) => {
        const filePath = path.join(directory, file.name);
        return manifest.files?.[file.name] === file.sha256 && fs.statSync(filePath).isFile() && digest(fs.readFileSync(filePath)) === file.sha256;
      });
    if (!valid) throw new Error('invalid');
    return { schemaVersion: PACK_SCHEMA_VERSION, id: selected.id, runtimeLine: selected.runtimeLine, version: selected.version, downloadable: true, installed: true };
  } catch {
    return { schemaVersion: PACK_SCHEMA_VERSION, id: selected.id, runtimeLine: selected.runtimeLine, version: selected.version, downloadable: true, installed: false };
  }
}

function getSpinePackStatus(root, runtimeLine = null) {
  if (runtimeLine != null) return publicStatus(root, packForLine(runtimeLine));
  return { schemaVersion: PACK_SCHEMA_VERSION, packs: SPINE_PACKS.map((entry) => publicStatus(root, entry)) };
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

async function installSpinePack(root, { runtimeLine = SPINE_PACK.runtimeLine, confirmInstall = false, fetchImpl = globalThis.fetch, onProgress, pack: packOverride = null } = {}) {
  const selected = packOverride || packForLine(runtimeLine);
  if (confirmInstall !== true) fail('SPINE_PACK_CONSENT_REQUIRED', 'Downloading Spine support requires an explicit user action.');
  if (typeof fetchImpl !== 'function') fail('SPINE_PACK_DOWNLOAD_UNAVAILABLE', 'This App runtime cannot download the optional Spine renderer pack.');
  const absoluteRoot = normalizeRoot(root);
  if (publicStatus(absoluteRoot, selected).installed) return publicStatus(absoluteRoot, selected);
  fs.mkdirSync(absoluteRoot, { recursive: true, mode: 0o700 });
  const staging = path.join(absoluteRoot, `.${selected.id}.${process.pid}.${crypto.randomUUID()}.tmp`);
  fs.mkdirSync(staging, { mode: 0o700 });
  try {
    const installedFiles = {};
    let totalBytes = 0;
    for (const [index, file] of selected.files.entries()) {
      const response = await fetchImpl(file.url, { redirect: 'follow' });
      const bytes = await responseBytes(response, file);
      totalBytes += bytes.byteLength;
      if (totalBytes > MAX_PACK_BYTES) fail('SPINE_PACK_TOO_LARGE', 'Spine renderer pack exceeds the 8 MiB safety limit.');
      fs.writeFileSync(path.join(staging, file.name), bytes, { mode: 0o600, flag: 'wx' });
      installedFiles[file.name] = file.sha256;
      onProgress?.({ completed: index + 1, total: selected.files.length, file: file.name });
    }
    fs.writeFileSync(path.join(staging, 'pack.json'), `${JSON.stringify({ schemaVersion: PACK_SCHEMA_VERSION, id: selected.id, runtimeLine: selected.runtimeLine, version: selected.version, files: installedFiles }, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    const destination = packDirectory(absoluteRoot, selected);
    try { fs.rmSync(destination, { recursive: true, force: true }); } catch {}
    fs.renameSync(staging, destination);
    return publicStatus(absoluteRoot, selected);
  } catch (error) {
    try { fs.rmSync(staging, { recursive: true, force: true }); } catch {}
    if (error instanceof SpinePackError) throw error;
    fail('SPINE_PACK_INSTALL_FAILED', 'The optional Spine renderer pack could not be installed.', { cause: error?.code || String(error?.message || error) });
  }
}

function removeSpinePack(root, runtimeLine = SPINE_PACK.runtimeLine, packOverride = null) {
  const selected = packOverride || packForLine(runtimeLine);
  fs.rmSync(packDirectory(root, selected), { recursive: true, force: true });
  return publicStatus(root, selected);
}

function resolveSpinePack(root, runtimeLine) {
  const selected = packForLine(runtimeLine);
  const status = publicStatus(root, selected);
  if (!status.installed) fail('SPINE_PACK_REQUIRED', `Install Spine ${selected.runtimeLine} support before previewing or building this model.`, { runtimeLine: selected.runtimeLine });
  const directory = packDirectory(root, selected);
  return { ...status, directory, scriptPath: path.join(directory, 'spine-player.min.js'), stylePath: path.join(directory, 'spine-player.min.css'), licensePath: path.join(directory, 'LICENSE') };
}

module.exports = { MAX_PACK_BYTES, PACK_SCHEMA_VERSION, SPINE_PACK, SPINE_PACKS, SpinePackError, getSpinePackStatus, installSpinePack, removeSpinePack, resolveSpinePack };
