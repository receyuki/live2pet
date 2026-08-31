const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const SCHEMA_VERSION = 1;
const MAX_RUNTIME_BYTES = 128 * 1024 * 1024;
const MAX_RUNTIME_FILES = 512;
const MAX_RUNTIME_DEPTH = 5;
const MAX_SCAN_BYTES = 2 * 1024 * 1024;
const RUNTIME_SETTINGS_SCHEMA_VERSION = 1;
const MAX_RUNTIME_SETTINGS_BYTES = 64 * 1024;

class RuntimeValidationError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'RuntimeValidationError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details = {}) {
  throw new RuntimeValidationError(code, message, details);
}

function sha256(filePath) {
  const hash = crypto.createHash('sha256');
  const stream = fs.createReadStream(filePath);
  return new Promise((resolve, reject) => {
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

function readSignature(filePath) {
  const handle = fs.openSync(filePath, 'r');
  try {
    const buffer = Buffer.alloc(MAX_SCAN_BYTES);
    const bytesRead = fs.readSync(handle, buffer, 0, buffer.length, 0);
    return buffer.subarray(0, bytesRead).toString('utf8');
  } finally {
    fs.closeSync(handle);
  }
}

function walkDirectory(root) {
  const files = [];
  function visit(directory, relativeDirectory, depth) {
    if (depth > MAX_RUNTIME_DEPTH) fail('RUNTIME_DIRECTORY_TOO_DEEP', `Runtime directory exceeds the ${MAX_RUNTIME_DEPTH}-level scan limit.`);
    const entries = fs.readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      const relative = relativeDirectory ? path.join(relativeDirectory, entry.name) : entry.name;
      if (entry.isSymbolicLink()) fail('UNSUPPORTED_RUNTIME_SYMLINK', `Runtime contains a symbolic link: ${relative}`);
      if (entry.isDirectory()) {
        visit(absolute, relative, depth + 1);
        continue;
      }
      if (!entry.isFile()) fail('UNSUPPORTED_RUNTIME_ENTRY', `Runtime entry is not a regular file: ${relative}`);
      files.push({ absolute, relative: relative.replaceAll('\\', '/') });
      if (files.length > MAX_RUNTIME_FILES) fail('RUNTIME_DIRECTORY_TOO_LARGE', `Runtime directory contains more than ${MAX_RUNTIME_FILES} files.`);
    }
  }
  visit(root, '', 0);
  return files;
}

function classifyRuntime(filePath, signature) {
  const basename = path.basename(filePath).toLowerCase();
  const modern = signature.includes('Live2DCubismCore') && (signature.includes('csmGetVersion') || signature.includes('csmGetLatestMocVersion'));
  if (modern) {
    return { runtimeKind: 'modern-cubism-core', cubismGenerations: [3, 4, 5], entrypointType: 'javascript' };
  }
  const legacy = /(^|\/)(live2d(?:\.min)?\.js|live2d\.js)$/i.test(basename) || (signature.includes('Live2D') && signature.includes('L2D'));
  if (legacy) {
    return { runtimeKind: 'legacy-cubism2', cubismGenerations: [2], entrypointType: 'javascript' };
  }
  fail('UNKNOWN_RUNTIME', `The selected file is not a recognized Cubism runtime entrypoint: ${path.basename(filePath)}`);
}

function selectEntrypoint(inputPath) {
  const absoluteInput = path.resolve(inputPath);
  let stat;
  try { stat = fs.lstatSync(absoluteInput); } catch (error) { fail('RUNTIME_NOT_FOUND', `Runtime path does not exist: ${path.basename(absoluteInput)}`, { cause: error.code }); }
  if (stat.isSymbolicLink()) fail('UNSUPPORTED_RUNTIME_SYMLINK', 'The selected runtime path cannot be a symbolic link.');
  if (stat.isFile()) return { root: path.dirname(absoluteInput), file: absoluteInput, relative: path.basename(absoluteInput), sourceType: 'file' };
  if (!stat.isDirectory()) fail('UNSUPPORTED_RUNTIME_ENTRY', 'The selected runtime path must be a file or directory.');
  const files = walkDirectory(absoluteInput);
  const ranked = files
    .filter((file) => /\.m?js$/i.test(file.relative))
    .map((file) => ({ ...file, rank: /live2dcubismcore/i.test(file.relative) ? 0 : (/live2d/i.test(file.relative) ? 1 : 2) }))
    .sort((left, right) => left.rank - right.rank || left.relative.localeCompare(right.relative));
  if (!ranked.length) fail('RUNTIME_ENTRYPOINT_NOT_FOUND', 'No JavaScript runtime entrypoint was found in the selected directory.');
  for (const candidate of ranked) {
    const signature = readSignature(candidate.absolute);
    if ((signature.includes('Live2DCubismCore') && signature.includes('csmGetVersion')) || signature.includes('Live2D')) {
      return { root: absoluteInput, file: candidate.absolute, relative: candidate.relative, sourceType: 'directory' };
    }
  }
  fail('UNKNOWN_RUNTIME', 'No recognized Cubism runtime entrypoint was found in the selected directory.');
}

/**
 * Resolve the validated JavaScript entrypoint that should be served to an
 * isolated renderer. This keeps directory selection and entrypoint ranking in
 * one place; callers should not expose the returned absolute path over IPC.
 */
function resolveRuntimeEntrypoint(inputPath) {
  if (typeof inputPath !== 'string' || !inputPath.trim()) fail('INVALID_RUNTIME_PATH', 'A Cubism runtime file or SDK directory is required.');
  return selectEntrypoint(inputPath).file;
}

async function inspectRuntime(inputPath) {
  if (typeof inputPath !== 'string' || !inputPath.trim()) fail('INVALID_RUNTIME_PATH', 'A Cubism runtime file or SDK directory is required.');
  const selected = selectEntrypoint(inputPath);
  let stat;
  try { stat = fs.statSync(selected.file); } catch (error) { fail('RUNTIME_NOT_FOUND', 'The selected runtime entrypoint cannot be read.', { cause: error.code }); }
  if (stat.size > MAX_RUNTIME_BYTES) fail('RUNTIME_TOO_LARGE', `Runtime entrypoint exceeds the ${MAX_RUNTIME_BYTES}-byte limit.`);
  const signature = readSignature(selected.file);
  const classification = classifyRuntime(selected.file, signature);
  return {
    schemaVersion: SCHEMA_VERSION,
    sourceType: selected.sourceType,
    entrypoint: selected.relative,
    entrypointName: path.basename(selected.file),
    runtimeKind: classification.runtimeKind,
    cubismGenerations: classification.cubismGenerations,
    entrypointType: classification.entrypointType,
    sizeBytes: stat.size,
    fingerprint: await sha256(selected.file),
  };
}

async function createRuntimeSettings(inputPath) {
  const descriptor = await inspectRuntime(inputPath);
  return {
    schemaVersion: SCHEMA_VERSION,
    runtimePath: path.resolve(inputPath),
    descriptor,
    restartRequired: true,
  };
}

function emptyRuntimeSettings() {
  return {
    schemaVersion: RUNTIME_SETTINGS_SCHEMA_VERSION,
    configured: false,
    restartRequired: false,
  };
}

function normalizeSettingsPath(settingsPath) {
  if (typeof settingsPath !== 'string' || !settingsPath.trim()) fail('INVALID_RUNTIME_SETTINGS_PATH', 'A runtime settings file path is required.');
  const absolute = path.resolve(settingsPath);
  if (path.parse(absolute).root === absolute) fail('INVALID_RUNTIME_SETTINGS_PATH', 'The runtime settings file cannot be a filesystem root.');
  return absolute;
}

function writeRuntimeSettings(settingsPath, settings) {
  const absolute = normalizeSettingsPath(settingsPath);
  const serialized = `${JSON.stringify(settings, null, 2)}\n`;
  if (Buffer.byteLength(serialized, 'utf8') > MAX_RUNTIME_SETTINGS_BYTES) fail('RUNTIME_SETTINGS_TOO_LARGE', `Runtime settings exceed the ${MAX_RUNTIME_SETTINGS_BYTES}-byte limit.`);
  fs.mkdirSync(path.dirname(absolute), { recursive: true, mode: 0o700 });
  const temporary = `${absolute}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, serialized, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    fs.renameSync(temporary, absolute);
  } catch (error) {
    try { fs.unlinkSync(temporary); } catch {}
    fail('RUNTIME_SETTINGS_WRITE_FAILED', 'Runtime settings could not be saved.', { cause: error && error.code ? error.code : String(error && error.message ? error.message : error) });
  }
  return absolute;
}

function parseRuntimeSettings(settingsPath) {
  const absolute = normalizeSettingsPath(settingsPath);
  let text;
  try {
    const stat = fs.statSync(absolute);
    if (!stat.isFile()) fail('INVALID_RUNTIME_SETTINGS', 'Runtime settings must be a regular file.');
    if (stat.size > MAX_RUNTIME_SETTINGS_BYTES) fail('RUNTIME_SETTINGS_TOO_LARGE', `Runtime settings exceed the ${MAX_RUNTIME_SETTINGS_BYTES}-byte limit.`);
    text = fs.readFileSync(absolute, 'utf8');
  } catch (error) {
    if (error instanceof RuntimeValidationError) throw error;
    if (error && error.code === 'ENOENT') return null;
    fail('RUNTIME_SETTINGS_READ_FAILED', 'Runtime settings could not be read.', { cause: error && error.code ? error.code : String(error && error.message ? error.message : error) });
  }
  let parsed;
  try { parsed = JSON.parse(text); } catch (error) {
    fail('INVALID_RUNTIME_SETTINGS', 'Runtime settings are not valid JSON.', { cause: String(error && error.message ? error.message : error) });
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || parsed.schemaVersion !== RUNTIME_SETTINGS_SCHEMA_VERSION || typeof parsed.runtimePath !== 'string' || !parsed.runtimePath.trim() || !parsed.descriptor || typeof parsed.descriptor !== 'object') {
    fail('INVALID_RUNTIME_SETTINGS', `Runtime settings must use schema version ${RUNTIME_SETTINGS_SCHEMA_VERSION} and contain a runtimePath and descriptor.`);
  }
  return { ...parsed, runtimePath: path.resolve(parsed.runtimePath) };
}

async function saveRuntimeSettings(settingsPath, inputPath) {
  const descriptor = await inspectRuntime(inputPath);
  const settings = {
    schemaVersion: RUNTIME_SETTINGS_SCHEMA_VERSION,
    runtimePath: path.resolve(inputPath),
    descriptor,
    restartRequired: true,
  };
  writeRuntimeSettings(settingsPath, settings);
  return { ...settings, configured: true, available: true };
}

async function loadRuntimeSettings(settingsPath) {
  const stored = parseRuntimeSettings(settingsPath);
  if (!stored) return emptyRuntimeSettings();
  try {
    const descriptor = await inspectRuntime(stored.runtimePath);
    return { ...stored, descriptor, configured: true, available: true, restartRequired: true };
  } catch (error) {
    if (!(error instanceof RuntimeValidationError)) throw error;
    return {
      ...stored,
      configured: true,
      available: false,
      restartRequired: true,
      error: { code: error.code, message: error.message },
    };
  }
}

function clearRuntimeSettings(settingsPath) {
  const absolute = normalizeSettingsPath(settingsPath);
  try { fs.unlinkSync(absolute); } catch (error) {
    if (error && error.code !== 'ENOENT') fail('RUNTIME_SETTINGS_CLEAR_FAILED', 'Runtime settings could not be cleared.', { cause: error.code || String(error.message || error) });
  }
  return emptyRuntimeSettings();
}

function redactRuntimeSettings(settings) {
  if (!settings || typeof settings !== 'object') fail('INVALID_RUNTIME_SETTINGS', 'Runtime settings must be an object.');
  if (settings.configured === false || !settings.runtimePath) {
    return {
      schemaVersion: RUNTIME_SETTINGS_SCHEMA_VERSION,
      configured: false,
      restartRequired: false,
    };
  }
  if (!settings.descriptor || typeof settings.descriptor !== 'object') fail('INVALID_RUNTIME_SETTINGS', 'Runtime settings are missing a validated descriptor.');
  return {
    schemaVersion: settings.schemaVersion,
    configured: Boolean(settings.runtimePath),
    runtimeName: settings.descriptor.entrypointName,
    sourceType: settings.descriptor.sourceType,
    runtimeKind: settings.descriptor.runtimeKind,
    cubismGenerations: settings.descriptor.cubismGenerations,
    fingerprint: settings.descriptor.fingerprint,
    restartRequired: settings.restartRequired !== false,
    available: settings.available !== false,
    ...(settings.error && typeof settings.error === 'object' && typeof settings.error.code === 'string' ? { error: { code: settings.error.code, message: String(settings.error.message || 'Runtime is unavailable.').replace(/(?:[A-Za-z]:[\\/]|\/(?:Users|home|private|tmp)\/)[^\s'"`]+/g, '<redacted-path>') } } : {}),
  };
}

module.exports = {
  MAX_RUNTIME_BYTES,
  MAX_RUNTIME_FILES,
  MAX_RUNTIME_SETTINGS_BYTES,
  RuntimeValidationError,
  RUNTIME_SETTINGS_SCHEMA_VERSION,
  clearRuntimeSettings,
  createRuntimeSettings,
  inspectRuntime,
  loadRuntimeSettings,
  redactRuntimeSettings,
  resolveRuntimeEntrypoint,
  saveRuntimeSettings,
  SCHEMA_VERSION,
};
