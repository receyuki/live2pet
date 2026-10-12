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
  Object.freeze({
    id: 'spine-player-3.8', runtimeLine: '3.8', version: '3.8-8b4844bd', downloadable: true,
    files: Object.freeze([
      Object.freeze({ name: 'spine-player.min.js', url: 'https://raw.githubusercontent.com/EsotericSoftware/spine-runtimes/8b4844bd4b193ba9e54487ed397a777993cbad56/spine-ts/build/spine-player.js', sha256: '3f335337a8fa9c51c6502a7557ea44cd2bcb4f22483adae275e4ecf5ec69faec' }),
      Object.freeze({ name: 'spine-player.min.css', url: 'https://raw.githubusercontent.com/EsotericSoftware/spine-runtimes/8b4844bd4b193ba9e54487ed397a777993cbad56/spine-ts/player/css/spine-player.css', sha256: 'cdade32ebe78146a24f4215051ca8fa590d92b8407f30465a15f1f2b9bb1009a' }),
      Object.freeze({ name: 'LICENSE', url: 'https://raw.githubusercontent.com/EsotericSoftware/spine-runtimes/8b4844bd4b193ba9e54487ed397a777993cbad56/LICENSE', sha256: '6142ee6cc2c03d3a918793e4750ae772bd3755c534d4a35e559e301acf51ec39' }),
    ]),
  }),
]);
const SPINE_PACK = SPINE_PACKS[0];
const LOCAL_SPINE_NOTICE = 'Optional local compatibility runtime. Imported from an explicitly selected local RYutility checkout. Spine usage remains subject to the Spine Runtimes license. The legacy 2.1 adapter has no separately verified redistribution grant and must not be bundled or published with Live2Pet.\n';
const localFile = (name, sha256) => Object.freeze({ name, sha256 });
const localPack = (runtimeLine, version, runtimeHash, { base = false, spineVersion = null } = {}) => Object.freeze({
  id: `spine-compat-${spineVersion || runtimeLine}`, runtimeLine, spineVersion, version, adapter: 'legacy', downloadable: false,
  files: Object.freeze([
    localFile('pixi.min.js', '403f2f2ee8145fa17f60c5c89403056efe2680e5096ec2762036486914ed19c5'),
    localFile('unsafe-eval.min.js', '94bb4bfdbd015087772ee03bc4117e253c326e8ca73a61646bd331b22f6847ad'),
    ...(base ? [localFile('spine-base.js', '6ea7229e451b3ca8f90ab6986ce1226b4f6ec7ca5b014cc7391dd97651f3e653')] : []),
    localFile('spine-player.min.js', runtimeHash),
    localFile('LICENSE', '6142ee6cc2c03d3a918793e4750ae772bd3755c534d4a35e559e301acf51ec39'),
    localFile('PIXI-LICENSE', '536a16e090f0b6c1454a7c0b47ee8414a39a2f1724a154f10ca1edc750a2dcfd'),
    localFile('UNSAFE-EVAL-LICENSE', 'ef9ae15b5a2b39f6e1445fb1e12ade9f000ebb19c173fb1e505879ba215d9c9d'),
    localFile('LOCAL-NOTICE', crypto.createHash('sha256').update(LOCAL_SPINE_NOTICE).digest('hex')),
  ]),
});
const LOCAL_SPINE_PACKS = Object.freeze([
  localPack('2.1', '2.1-c2e63d62-ik-fix', '7371774177d345d94efcb37920c1f2f19cb82211f52e338faf820fdf3a36b43c'),
  localPack('3.6', 'pixi-spine-runtime-3.6@3.1.3', 'c5572718ec72acb64b7e0a7c308eea4de25c3b1987daa0d203add9b174670ea1', { base: true }),
  localPack('3.8', '@pixi-spine/runtime-3.8@3.1.2', 'e6e38e283aaae8442b3f9052d8155c5d5f4259a9afaa575252f1d01ee84ba1a7', { base: true, spineVersion: '3.8.75' }),
]);

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

function packForLine(runtimeLine, { spineVersion } = {}) {
  const compatibility = LOCAL_SPINE_PACKS.find((entry) => entry.runtimeLine === runtimeLine && (!entry.spineVersion || entry.spineVersion === spineVersion));
  const match = compatibility || SPINE_PACKS.find((entry) => entry.runtimeLine === runtimeLine);
  if (!match) fail('UNSUPPORTED_SPINE_VERSION', `Spine ${runtimeLine || 'unknown'} does not have a verified renderer pack in this App.`, { supported: [...new Set([...SPINE_PACKS, ...LOCAL_SPINE_PACKS].map((entry) => entry.runtimeLine))] });
  return match;
}
function packDirectory(root, selected = SPINE_PACK) { return path.join(normalizeRoot(root), selected.id); }
function manifestPath(root, selected = SPINE_PACK) { return path.join(packDirectory(root, selected), 'pack.json'); }

function publicStatus(root, selected = SPINE_PACK) {
  const directory = packDirectory(root, selected);
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath(root, selected), 'utf8'));
    let totalBytes = 0;
    const valid = manifest?.schemaVersion === PACK_SCHEMA_VERSION
      && manifest.id === selected.id
      && manifest.version === selected.version
      && selected.files.every((file) => {
        const filePath = path.join(directory, file.name);
        const stat = fs.lstatSync(filePath);
        totalBytes += stat.size;
        return manifest.files?.[file.name] === file.sha256 && stat.isFile() && totalBytes <= MAX_PACK_BYTES && digest(fs.readFileSync(filePath)) === file.sha256;
      });
    if (!valid) throw new Error('invalid');
    return { schemaVersion: PACK_SCHEMA_VERSION, id: selected.id, runtimeLine: selected.runtimeLine, version: selected.version, downloadable: selected.downloadable, ...(selected.adapter ? { adapter: selected.adapter, spineVersion: selected.spineVersion } : {}), installed: true };
  } catch {
    return { schemaVersion: PACK_SCHEMA_VERSION, id: selected.id, runtimeLine: selected.runtimeLine, version: selected.version, downloadable: selected.downloadable, ...(selected.adapter ? { adapter: selected.adapter, spineVersion: selected.spineVersion } : {}), installed: false };
  }
}

function getSpinePackStatus(root, runtimeLine = null, options = {}) {
  if (runtimeLine != null) return publicStatus(root, packForLine(runtimeLine, options));
  return { schemaVersion: PACK_SCHEMA_VERSION, packs: SPINE_PACKS.map((entry) => publicStatus(root, entry)), compatibilityPacks: LOCAL_SPINE_PACKS.map((entry) => publicStatus(root, entry)) };
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
  if (!selected.downloadable) fail('SPINE_PACK_LOCAL_IMPORT_REQUIRED', 'This compatibility runtime requires a verified local import; it is not downloadable by the App.');
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

function resolveSpinePack(root, runtimeLine, options = {}) {
  const selected = packForLine(runtimeLine, options);
  const status = publicStatus(root, selected);
  if (!status.installed) fail('SPINE_PACK_REQUIRED', selected.downloadable ? `Install Spine ${selected.runtimeLine} support before previewing or building this model.` : `Import the verified local Spine ${selected.spineVersion || selected.runtimeLine} compatibility runtime before previewing this model.`, { runtimeLine: selected.runtimeLine, packId: selected.id, downloadable: selected.downloadable, ...(selected.spineVersion ? { spineVersion: selected.spineVersion } : {}) });
  const directory = packDirectory(root, selected);
  return { ...status, directory, scriptPath: path.join(directory, 'spine-player.min.js'), stylePath: selected.adapter ? null : path.join(directory, 'spine-player.min.css'), licensePath: path.join(directory, 'LICENSE'), ...(selected.adapter ? { pixiPath: path.join(directory, 'pixi.min.js'), unsafeEvalPath: path.join(directory, 'unsafe-eval.min.js'), basePath: selected.runtimeLine === '2.1' ? null : path.join(directory, 'spine-base.js'), decoderPath: selected.runtimeLine === '2.1' ? path.join(directory, 'spine-player.min.js') : null } : {}) };
}

function importLocalSpinePack(root, { packId, files, confirmInstall = false } = {}) {
  if (!confirmInstall) fail('SPINE_PACK_CONSENT_REQUIRED', 'Importing a local runtime requires explicit consent.');
  const selected = LOCAL_SPINE_PACKS.find((entry) => entry.id === packId);
  if (!selected) fail('UNSUPPORTED_SPINE_VERSION', 'Unknown local compatibility pack.');
  const absoluteRoot = normalizeRoot(root);
  const verified = new Map();
  let total = 0;
  for (const file of selected.files) {
    const source = files?.[file.name];
    const bytes = file.name === 'LOCAL-NOTICE' ? Buffer.from(LOCAL_SPINE_NOTICE) : (() => {
      if (typeof source !== 'string' || !fs.lstatSync(source).isFile()) fail('SPINE_PACK_LOCAL_IMPORT_FAILED', `Missing regular local file ${file.name}.`);
      if (fs.statSync(source).size > MAX_PACK_BYTES) fail('SPINE_PACK_TOO_LARGE', 'Local runtime exceeds the 8 MiB safety limit.');
      return fs.readFileSync(source);
    })();
    total += bytes.length;
    if (total > MAX_PACK_BYTES) fail('SPINE_PACK_TOO_LARGE', 'Local runtime exceeds the 8 MiB safety limit.');
    if (digest(bytes) !== file.sha256) fail('SPINE_PACK_INTEGRITY_FAILED', `Local ${file.name} did not match its pinned integrity value.`);
    verified.set(file.name, bytes);
  }
  fs.mkdirSync(absoluteRoot, { recursive: true, mode: 0o700 });
  const staging = fs.mkdtempSync(path.join(absoluteRoot, `.${selected.id}.`));
  try {
    for (const [name, bytes] of verified) fs.writeFileSync(path.join(staging, name), bytes, { flag: 'wx', mode: 0o600 });
    fs.writeFileSync(path.join(staging, 'pack.json'), JSON.stringify({ schemaVersion: PACK_SCHEMA_VERSION, id: selected.id, version: selected.version, files: Object.fromEntries(selected.files.map((file) => [file.name, file.sha256])) }), { flag: 'wx', mode: 0o600 });
    const destination = packDirectory(absoluteRoot, selected);
    if (fs.existsSync(destination)) { const backup = `${destination}.${crypto.randomUUID()}.old`; fs.renameSync(destination, backup); try { fs.renameSync(staging, destination); } catch (error) { fs.renameSync(backup, destination); throw error; } fs.rmSync(backup, { recursive: true }); }
    else fs.renameSync(staging, destination);
    return publicStatus(root, selected);
  } finally { fs.rmSync(staging, { recursive: true, force: true }); }
}

module.exports = { MAX_PACK_BYTES, PACK_SCHEMA_VERSION, SPINE_PACK, SPINE_PACKS, LOCAL_SPINE_PACKS, SpinePackError, getSpinePackStatus, installSpinePack, importLocalSpinePack, removeSpinePack, resolveSpinePack };
