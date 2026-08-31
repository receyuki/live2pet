const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const SCHEMA_VERSION = 1;
const MAX_RUNTIME_BYTES = 128 * 1024 * 1024;
const MAX_RUNTIME_FILES = 512;
const MAX_RUNTIME_DEPTH = 5;
const MAX_SCAN_BYTES = 2 * 1024 * 1024;
const RUNTIME_SETTINGS_SCHEMA_VERSION = 2;
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
    runtimes: [],
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

function validRuntimeDescriptor(descriptor) {
  return Boolean(
    descriptor
    && typeof descriptor === 'object'
    && !Array.isArray(descriptor)
    && typeof descriptor.entrypointName === 'string'
    && descriptor.entrypointName
    && ['modern-cubism-core', 'legacy-cubism2'].includes(descriptor.runtimeKind)
    && Array.isArray(descriptor.cubismGenerations)
    && descriptor.cubismGenerations.every((generation) => Number.isInteger(generation) && generation >= 2 && generation <= 5)
    && typeof descriptor.fingerprint === 'string'
    && /^[a-f0-9]{64}$/i.test(descriptor.fingerprint)
  );
}

function runtimeStorageRoot(settingsPath) {
  return path.join(path.dirname(normalizeSettingsPath(settingsPath)), 'runtimes');
}

function resolveStoredRuntimePath(settingsPath, storagePath) {
  if (typeof storagePath !== 'string' || !storagePath.trim() || path.isAbsolute(storagePath)) fail('INVALID_RUNTIME_SETTINGS', 'Stored runtime paths must be relative to the App settings directory.');
  const settingsDirectory = path.dirname(normalizeSettingsPath(settingsPath));
  const absolute = path.resolve(settingsDirectory, storagePath);
  const root = path.resolve(runtimeStorageRoot(settingsPath));
  if (absolute !== root && !absolute.startsWith(`${root}${path.sep}`)) fail('INVALID_RUNTIME_SETTINGS', 'Stored runtime paths must remain inside the App runtime library.');
  return absolute;
}

function storedRuntimeRecord(settingsPath, runtimePath, descriptor) {
  const relative = path.relative(path.dirname(normalizeSettingsPath(settingsPath)), runtimePath).replaceAll(path.sep, '/');
  return { storagePath: relative, descriptor };
}

async function copyRuntimeIntoLibrary(settingsPath, inputPath, descriptor = null) {
  const inspected = descriptor || await inspectRuntime(inputPath);
  const source = resolveRuntimeEntrypoint(inputPath);
  const destinationDirectory = path.join(runtimeStorageRoot(settingsPath), inspected.runtimeKind, inspected.fingerprint);
  const destination = path.join(destinationDirectory, inspected.entrypointName);
  fs.mkdirSync(destinationDirectory, { recursive: true, mode: 0o700 });
  if (path.resolve(source) !== path.resolve(destination)) {
    let keepExisting = false;
    try { keepExisting = fs.statSync(destination).isFile() && await sha256(destination) === inspected.fingerprint; } catch {}
    if (!keepExisting) {
      const temporary = `${destination}.${process.pid}.${crypto.randomUUID()}.tmp`;
      try {
        fs.copyFileSync(source, temporary, fs.constants.COPYFILE_EXCL);
        fs.chmodSync(temporary, 0o600);
        fs.rmSync(destination, { force: true });
        fs.renameSync(temporary, destination);
      } catch (error) {
        try { fs.unlinkSync(temporary); } catch {}
        fail('RUNTIME_COPY_FAILED', 'The selected runtime could not be copied into App storage.', { cause: error && error.code ? error.code : String(error && error.message ? error.message : error) });
      }
    }
  }
  return { ...storedRuntimeRecord(settingsPath, destination, inspected), runtimePath: destination, available: true };
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
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) fail('INVALID_RUNTIME_SETTINGS', 'Runtime settings must be an object.');
  if (parsed.schemaVersion === 1 && typeof parsed.runtimePath === 'string' && parsed.runtimePath.trim() && validRuntimeDescriptor(parsed.descriptor)) {
    return { ...parsed, runtimePath: path.resolve(parsed.runtimePath) };
  }
  if (parsed.schemaVersion !== RUNTIME_SETTINGS_SCHEMA_VERSION || !Array.isArray(parsed.runtimes)) {
    fail('INVALID_RUNTIME_SETTINGS', `Runtime settings must use schema version ${RUNTIME_SETTINGS_SCHEMA_VERSION} and contain a runtimes array.`);
  }
  const kinds = new Set();
  const runtimes = parsed.runtimes.map((runtime) => {
    if (!runtime || typeof runtime !== 'object' || Array.isArray(runtime) || !validRuntimeDescriptor(runtime.descriptor)) fail('INVALID_RUNTIME_SETTINGS', 'Runtime settings contain an invalid runtime descriptor.');
    if (kinds.has(runtime.descriptor.runtimeKind)) fail('INVALID_RUNTIME_SETTINGS', `Runtime settings contain duplicate ${runtime.descriptor.runtimeKind} entries.`);
    kinds.add(runtime.descriptor.runtimeKind);
    resolveStoredRuntimePath(settingsPath, runtime.storagePath);
    return { storagePath: runtime.storagePath, descriptor: runtime.descriptor };
  });
  return { schemaVersion: RUNTIME_SETTINGS_SCHEMA_VERSION, runtimes };
}

async function saveRuntimeSettings(settingsPath, inputPath) {
  const descriptor = await inspectRuntime(inputPath);
  let existing;
  try { existing = await loadRuntimeSettings(settingsPath); }
  catch (error) {
    if (!(error instanceof RuntimeValidationError)) throw error;
    existing = emptyRuntimeSettings();
  }
  const copied = await copyRuntimeIntoLibrary(settingsPath, inputPath, descriptor);
  const runtimes = existing.runtimes
    .filter((runtime) => runtime.descriptor.runtimeKind !== descriptor.runtimeKind)
    .map((runtime) => storedRuntimeRecord(settingsPath, runtime.runtimePath, runtime.descriptor));
  runtimes.push({ storagePath: copied.storagePath, descriptor: copied.descriptor });
  runtimes.sort((left, right) => left.descriptor.runtimeKind.localeCompare(right.descriptor.runtimeKind));
  writeRuntimeSettings(settingsPath, { schemaVersion: RUNTIME_SETTINGS_SCHEMA_VERSION, runtimes });
  return loadRuntimeSettings(settingsPath);
}

async function loadRuntimeSettings(settingsPath) {
  const stored = parseRuntimeSettings(settingsPath);
  if (!stored) return emptyRuntimeSettings();
  if (stored.schemaVersion === 1) {
    const copied = await copyRuntimeIntoLibrary(settingsPath, stored.runtimePath, stored.descriptor);
    writeRuntimeSettings(settingsPath, {
      schemaVersion: RUNTIME_SETTINGS_SCHEMA_VERSION,
      runtimes: [{ storagePath: copied.storagePath, descriptor: copied.descriptor }],
    });
    return loadRuntimeSettings(settingsPath);
  }
  const runtimes = [];
  for (const runtime of stored.runtimes) {
    const runtimePath = resolveStoredRuntimePath(settingsPath, runtime.storagePath);
    try {
      const descriptor = await inspectRuntime(runtimePath);
      const matches = descriptor.runtimeKind === runtime.descriptor.runtimeKind && descriptor.fingerprint === runtime.descriptor.fingerprint;
      if (!matches) fail('RUNTIME_LIBRARY_MISMATCH', 'A saved runtime no longer matches its validated App library record.');
      runtimes.push({ ...runtime, runtimePath, descriptor, available: true });
    } catch (error) {
      if (!(error instanceof RuntimeValidationError)) throw error;
      runtimes.push({ ...runtime, runtimePath, available: false, error: { code: error.code, message: error.message } });
    }
  }
  return {
    schemaVersion: RUNTIME_SETTINGS_SCHEMA_VERSION,
    configured: runtimes.length > 0,
    restartRequired: false,
    runtimes,
  };
}

async function loadRuntimeForGeneration(settingsPath, cubismVersion) {
  const generation = Number(cubismVersion);
  if (![2, 3, 4, 5].includes(generation)) fail('UNSUPPORTED_CUBISM_VERSION', `Cubism generation ${String(cubismVersion)} is not supported.`);
  const settings = await loadRuntimeSettings(settingsPath);
  return settings.runtimes.find((runtime) => runtime.available === true && runtime.descriptor.cubismGenerations.includes(generation)) || null;
}

function clearRuntimeSettings(settingsPath) {
  const absolute = normalizeSettingsPath(settingsPath);
  try { fs.unlinkSync(absolute); } catch (error) {
    if (error && error.code !== 'ENOENT') fail('RUNTIME_SETTINGS_CLEAR_FAILED', 'Runtime settings could not be cleared.', { cause: error.code || String(error.message || error) });
  }
  try { fs.rmSync(runtimeStorageRoot(settingsPath), { recursive: true, force: true }); } catch (error) {
    fail('RUNTIME_SETTINGS_CLEAR_FAILED', 'The App runtime library could not be cleared.', { cause: error.code || String(error.message || error) });
  }
  return emptyRuntimeSettings();
}

function redactRuntimeSettings(settings) {
  if (!settings || typeof settings !== 'object') fail('INVALID_RUNTIME_SETTINGS', 'Runtime settings must be an object.');
  if (settings.schemaVersion === RUNTIME_SETTINGS_SCHEMA_VERSION && Array.isArray(settings.runtimes)) {
    return {
      schemaVersion: RUNTIME_SETTINGS_SCHEMA_VERSION,
      configured: settings.runtimes.length > 0,
      restartRequired: false,
      runtimes: settings.runtimes.map((runtime) => ({
        runtimeName: runtime.descriptor.entrypointName,
        sourceType: runtime.descriptor.sourceType,
        runtimeKind: runtime.descriptor.runtimeKind,
        cubismGenerations: [...runtime.descriptor.cubismGenerations],
        fingerprint: runtime.descriptor.fingerprint,
        available: runtime.available !== false,
        ...(runtime.error && typeof runtime.error === 'object' && typeof runtime.error.code === 'string' ? { error: { code: runtime.error.code, message: String(runtime.error.message || 'Runtime is unavailable.').replace(/(?:[A-Za-z]:[\\/]|\/(?:Users|home|private|tmp)\/)[^\s'"`]+/g, '<redacted-path>') } } : {}),
      })),
    };
  }
  if (settings.configured === false || !settings.runtimePath) return emptyRuntimeSettings();
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
  loadRuntimeForGeneration,
  loadRuntimeSettings,
  redactRuntimeSettings,
  resolveRuntimeEntrypoint,
  saveRuntimeSettings,
  SCHEMA_VERSION,
};
