const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const { inspectSourcePackage, SourceInspectionError } = require('../../source-inspector/src/index.cjs');
const { inspectRuntime, RuntimeValidationError } = require('../../runtime/src/index.cjs');
const { loadProjectFile, ProjectValidationError, recoverAutosaveFile } = require('../../project/src/index.cjs');
const { CacheError, CacheStore, PackageBuildError, buildProjectTargets } = require('../../package-build/src/index.cjs');
const { InstallationError, exportPackage, installPackage } = require('../../installation/src/index.cjs');
const { validateClawdThemePackage } = require('../../clawd-target/src/index.cjs');
const { validateCodexPetPackage } = require('../../codex-target/src/index.cjs');
const zip = require('@zip.js/zip.js');

const PROTOCOL_VERSION = 1;
const CLI_VERSION = '0.1.0';
const MAX_PACKAGE_BYTES = 256 * 1024 * 1024;
const MAX_PACKAGE_ENTRY_BYTES = 128 * 1024 * 1024;
const MAX_BUILD_SPEC_BYTES = 128 * 1024 * 1024;
const OPERATIONS = Object.freeze(['version', 'inspect', 'runtime-diagnose', 'project-validate', 'project-recover', 'package-build', 'package-validate', 'export', 'install', 'cache-status', 'cache-clear']);

class CliError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'CliError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details = {}) {
  throw new CliError(code, message, details);
}

function parseArgs(argv = []) {
  const options = { pretty: false };
  const positional = [];
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--operation' || argument === '-o') {
      const operation = argv[++index];
      if (!operation) fail('INVALID_ARGUMENT', '--operation requires a value.');
      options.operation = operation;
    } else if (argument === '--input' || argument === '-i') {
      const input = argv[++index];
      if (!input) fail('INVALID_ARGUMENT', '--input requires a value.');
      options.input = input;
    } else if (argument === '--cache-dir') {
      const cacheDir = argv[++index];
      if (!cacheDir) fail('INVALID_ARGUMENT', '--cache-dir requires a value.');
      options.cacheDir = cacheDir;
    } else if (argument === '--project-id') {
      const projectId = argv[++index];
      if (!projectId) fail('INVALID_ARGUMENT', '--project-id requires a value.');
      options.projectId = projectId;
    } else if (argument === '--source-fingerprint') {
      const sourceFingerprint = argv[++index];
      if (!sourceFingerprint) fail('INVALID_ARGUMENT', '--source-fingerprint requires a value.');
      options.sourceFingerprint = sourceFingerprint;
    } else if (argument === '--runtime-version') {
      const runtimeVersion = argv[++index];
      if (!runtimeVersion) fail('INVALID_ARGUMENT', '--runtime-version requires a value.');
      options.runtimeVersion = runtimeVersion;
    } else if (argument === '--renderer-version') {
      const rendererVersion = argv[++index];
      if (!rendererVersion) fail('INVALID_ARGUMENT', '--renderer-version requires a value.');
      options.rendererVersion = rendererVersion;
    } else if (argument === '--encoder-version') {
      const encoderVersion = argv[++index];
      if (!encoderVersion) fail('INVALID_ARGUMENT', '--encoder-version requires a value.');
      options.encoderVersion = encoderVersion;
    } else if (argument === '--target') {
      const target = argv[++index];
      if (!target) fail('INVALID_ARGUMENT', '--target requires a value.');
      options.target = target;
    } else if (argument === '--target-root') {
      const targetRoot = argv[++index];
      if (!targetRoot) fail('INVALID_ARGUMENT', '--target-root requires a value.');
      options.targetRoot = targetRoot;
    } else if (argument === '--output') {
      const output = argv[++index];
      if (!output) fail('INVALID_ARGUMENT', '--output requires a value.');
      options.output = output;
    } else if (argument === '--package-id') {
      const packageId = argv[++index];
      if (!packageId) fail('INVALID_ARGUMENT', '--package-id requires a value.');
      options.packageId = packageId;
    } else if (argument === '--conflict') {
      const conflict = argv[++index];
      if (!conflict) fail('INVALID_ARGUMENT', '--conflict requires a value.');
      options.conflict = conflict;
    } else if (argument === '--overwrite') {
      options.overwrite = true;
    } else if (argument === '--confirm-install') {
      options.confirmInstall = true;
    } else if (argument === '--all') {
      options.all = true;
    } else if (argument === '--pretty') {
      options.pretty = true;
    } else if (argument === '--help' || argument === '-h') {
      options.help = true;
    } else if (argument.startsWith('-')) {
      fail('UNKNOWN_ARGUMENT', `Unknown argument: ${argument}`);
    } else {
      positional.push(argument);
    }
  }
  if (!options.operation && positional.length) options.operation = positional.shift();
  if (positional.length) fail('UNKNOWN_ARGUMENT', `Unexpected argument: ${positional[0]}`);
  return options;
}

function operationSpec(operation) {
  if (operation === 'version') return { usage: 'live2pet version [--pretty]' };
  if (operation === 'inspect') return { usage: 'live2pet inspect --input <source-directory-or-pck> [--pretty]' };
  if (operation === 'runtime-diagnose') return { usage: 'live2pet runtime-diagnose --input <core-file-or-sdk-directory> [--pretty]' };
  if (operation === 'project-validate') return { usage: 'live2pet project-validate --input <project.live2pet> [--pretty]' };
  if (operation === 'project-recover') return { usage: 'live2pet project-recover --input <project.live2pet> [--pretty]' };
  if (operation === 'package-build') return { usage: 'live2pet package-build --input <build-spec.json> [--target clawd|codex-pet] [--output <directory>] [--cache-dir <cache-directory>] [--runtime-version <id> --renderer-version <id> --encoder-version <id>] [--overwrite] [--pretty]' };
  if (operation === 'package-validate') return { usage: 'live2pet package-validate --input <package.zip> [--target clawd|codex-pet] [--pretty]' };
  if (operation === 'export') return { usage: 'live2pet export --input <package.zip> --output <path.zip> [--overwrite] [--pretty]' };
  if (operation === 'install') return { usage: 'live2pet install --input <package.zip> --target clawd|codex-pet [--target-root <directory>] --confirm-install [--conflict cancel|upgrade|side-by-side] [--pretty]' };
  if (operation === 'cache-status') return { usage: 'live2pet cache-status --cache-dir <cache-directory> [--pretty]' };
  if (operation === 'cache-clear') return { usage: 'live2pet cache-clear --cache-dir <cache-directory> (--all | --project-id <id> | --source-fingerprint <sha256>) [--pretty]' };
  return { usage: 'live2pet <version|inspect|runtime-diagnose|project-validate|project-recover|package-build|package-validate|export|install|cache-status|cache-clear> [options]' };
}

function sanitizeProject(project) {
  const sanitized = JSON.parse(JSON.stringify(project));
  const sourcePathConfigured = Boolean(sanitized.source && sanitized.source.path);
  if (sanitized.source) delete sanitized.source.path;
  return { project: sanitized, sourcePathConfigured };
}

function envelope(operation, operationId, fields = {}) {
  return { protocolVersion: PROTOCOL_VERSION, cliVersion: CLI_VERSION, operation, operationId, ...fields };
}

function redactAbsolutePaths(value) {
  if (typeof value === 'string') return path.isAbsolute(value) ? '<redacted-path>' : value;
  if (Array.isArray(value)) return value.map(redactAbsolutePaths);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactAbsolutePaths(item)]));
  return value;
}

function normalizeError(error) {
  if (error instanceof CliError || error instanceof SourceInspectionError || error instanceof RuntimeValidationError || error instanceof ProjectValidationError || error instanceof CacheError || error instanceof PackageBuildError || error instanceof InstallationError) {
    return { code: error.code, message: error.message, details: redactAbsolutePaths(error.details || {}) };
  }
  return { code: 'CLI_OPERATION_FAILED', message: error && error.message ? error.message : String(error), details: {} };
}

function readPackageFile(inputPath) {
  if (typeof inputPath !== 'string' || !inputPath.trim()) fail('INPUT_REQUIRED', 'A package ZIP path is required.');
  const absolute = path.resolve(inputPath);
  let stat;
  try { stat = fs.statSync(absolute); } catch (error) { fail(error && error.code === 'ENOENT' ? 'PACKAGE_NOT_FOUND' : 'PACKAGE_READ_FAILED', error && error.code === 'ENOENT' ? 'The selected package does not exist.' : 'The selected package could not be read.', { cause: error && error.code ? error.code : 'UNKNOWN' }); }
  if (!stat.isFile()) fail('UNSUPPORTED_PACKAGE_INPUT', 'The selected package path is not a file.');
  if (stat.size > MAX_PACKAGE_BYTES) fail('PACKAGE_TOO_LARGE', `Package exceeds the ${MAX_PACKAGE_BYTES}-byte limit.`);
  return fs.readFileSync(absolute);
}

function entryNames(entries) {
  return entries.map((entry) => entry.filename).sort();
}

async function readZipEntry(entry, label) {
  if (!entry || typeof entry.getData !== 'function') fail('MISSING_PACKAGE_ENTRY', `${label} is missing from the archive.`);
  if (Number.isFinite(entry.uncompressedSize) && entry.uncompressedSize > MAX_PACKAGE_ENTRY_BYTES) fail('PACKAGE_ENTRY_TOO_LARGE', `${label} exceeds the ${MAX_PACKAGE_ENTRY_BYTES}-byte limit.`);
  try {
    const bytes = await entry.getData(new zip.Uint8ArrayWriter());
    if (!bytes || bytes.byteLength > MAX_PACKAGE_ENTRY_BYTES) fail('PACKAGE_ENTRY_TOO_LARGE', `${label} exceeds the ${MAX_PACKAGE_ENTRY_BYTES}-byte limit.`);
    return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  } catch (error) {
    if (error instanceof CliError) throw error;
    fail('PACKAGE_ENTRY_READ_FAILED', `${label} could not be read from the archive.`, { cause: error && error.message ? error.message : String(error) });
  }
}

async function validatePackageArchive(inputPath, targetHint) {
  if (typeof inputPath !== 'string' || !inputPath.trim()) fail('INPUT_REQUIRED', operationSpec('package-validate').usage);
  const absolute = path.resolve(inputPath);
  let stat;
  try { stat = fs.statSync(absolute); } catch (error) { fail(error && error.code === 'ENOENT' ? 'PACKAGE_NOT_FOUND' : 'PACKAGE_READ_FAILED', error && error.code === 'ENOENT' ? 'The selected package does not exist.' : 'The selected package could not be read.', { cause: error && error.code ? error.code : 'UNKNOWN' }); }
  if (!stat.isFile()) fail('UNSUPPORTED_PACKAGE_INPUT', 'Package validation requires a ZIP file.');
  if (stat.size > MAX_PACKAGE_BYTES) fail('PACKAGE_TOO_LARGE', `Package exceeds the ${MAX_PACKAGE_BYTES}-byte limit.`);
  const archiveBuffer = fs.readFileSync(absolute);
  const archive = new Uint8Array(archiveBuffer.buffer, archiveBuffer.byteOffset, archiveBuffer.byteLength);
  let reader;
  try {
    reader = new zip.ZipReader(new zip.Uint8ArrayReader(archive));
    const entries = await reader.getEntries();
    const byName = new Map(entries.map((entry) => [entry.filename, entry]));
    const codexShape = byName.has('pet.json') && byName.has('spritesheet.webp');
    const themeEntry = entries.find((entry) => /^(?:[^/]+)\/theme\.json$/i.test(entry.filename));
    const detected = codexShape ? 'codex-pet' : themeEntry ? 'clawd' : null;
    const target = targetHint || detected;
    if (!target || !['clawd', 'codex-pet'].includes(target)) fail('UNKNOWN_PACKAGE_TARGET', 'Could not identify a supported package target. Use --target clawd or --target codex-pet.');
    if (target === 'codex-pet') {
      const manifest = (await readZipEntry(byName.get('pet.json'), 'pet.json')).toString('utf8');
      const spritesheet = await readZipEntry(byName.get('spritesheet.webp'), 'spritesheet.webp');
      const result = validateCodexPetPackage({ files: entryNames(entries), manifest, spritesheet: { path: 'spritesheet.webp', bytes: spritesheet } });
      return { target, files: entryNames(entries), result };
    }
    if (!themeEntry) fail('INVALID_PACKAGE_ARCHIVE', 'Clawd package is missing a root theme.json entry.');
    const root = themeEntry.filename.slice(0, -'theme.json'.length);
    const manifest = JSON.parse((await readZipEntry(themeEntry, 'theme.json')).toString('utf8'));
    const assets = {};
    for (const entry of entries) {
      if (!entry.filename.startsWith(`${root}assets/`)) continue;
      const name = entry.filename.slice(`${root}assets/`.length);
      if (!name || name.includes('/')) continue;
      assets[name] = await readZipEntry(entry, `Clawd asset ${name}`);
    }
    const result = validateClawdThemePackage({ themeId: root.slice(0, -1), manifest, assets, byteLength: stat.size });
    return { target, files: entryNames(entries), result };
  } catch (error) {
    if (error instanceof CliError) throw error;
    fail('PACKAGE_ARCHIVE_READ_FAILED', 'The package archive could not be read.', { cause: error && error.message ? error.message : String(error) });
  } finally {
    if (reader) {
      try { await reader.close(); } catch {}
    }
  }
}

function readBuildSpec(inputPath) {
  if (typeof inputPath !== 'string' || !inputPath.trim()) fail('INPUT_REQUIRED', operationSpec('package-build').usage);
  const absolute = path.resolve(inputPath);
  let stat;
  try { stat = fs.statSync(absolute); } catch (error) {
    fail(error && error.code === 'ENOENT' ? 'BUILD_SPEC_NOT_FOUND' : 'BUILD_SPEC_READ_FAILED', error && error.code === 'ENOENT' ? 'The Package Build spec does not exist.' : 'The Package Build spec could not be read.', { cause: error && error.code ? error.code : 'UNKNOWN' });
  }
  if (!stat.isFile()) fail('UNSUPPORTED_BUILD_SPEC', 'Package Build requires a JSON spec file.');
  if (stat.size > MAX_BUILD_SPEC_BYTES) fail('BUILD_SPEC_TOO_LARGE', `The Package Build spec exceeds the ${MAX_BUILD_SPEC_BYTES}-byte limit.`);
  let parsed;
  try { parsed = JSON.parse(fs.readFileSync(absolute, 'utf8')); } catch (error) {
    fail('INVALID_BUILD_SPEC', 'The Package Build spec is not valid JSON.', { cause: String(error && error.message ? error.message : error) });
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || parsed.schemaVersion !== 1 || !parsed.project || typeof parsed.project !== 'object' || Array.isArray(parsed.project)) {
    fail('INVALID_BUILD_SPEC', 'Package Build specs require schemaVersion 1 and an inline Live2Pet Project object.');
  }
  if (!parsed.inputsByTarget || typeof parsed.inputsByTarget !== 'object' || Array.isArray(parsed.inputsByTarget)) fail('INVALID_BUILD_SPEC', 'Package Build specs require inputsByTarget keyed by Target Profile.');
  return parsed;
}

function decodeBuildSpecValue(value, label = 'build spec', depth = 0) {
  if (depth > 32) fail('INVALID_BUILD_SPEC', `${label} is nested too deeply.`);
  if (Buffer.isBuffer(value) || value instanceof Uint8Array || ArrayBuffer.isView(value)) return value;
  if (Array.isArray(value)) return value.map((item, index) => decodeBuildSpecValue(item, `${label}[${index}]`, depth + 1));
  if (!value || typeof value !== 'object') return value;
  if (Object.hasOwn(value, 'rgbaBase64')) {
    if (typeof value.rgbaBase64 !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value.rgbaBase64) || !value.rgbaBase64.length) fail('INVALID_BUILD_SPEC', `${label}.rgbaBase64 must be standard base64.`);
    const rgba = Buffer.from(value.rgbaBase64, 'base64');
    if (!rgba.length || rgba.length > MAX_PACKAGE_ENTRY_BYTES) fail('INVALID_BUILD_SPEC', `${label}.rgbaBase64 exceeds the byte limit.`);
    const decoded = { ...value, rgba };
    delete decoded.rgbaBase64;
    return Object.fromEntries(Object.entries(decoded).map(([key, item]) => [key, decodeBuildSpecValue(item, `${label}.${key}`, depth + 1)]));
  }
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, decodeBuildSpecValue(item, `${label}.${key}`, depth + 1)]));
}

function buildOptionSubset(source = {}) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) return {};
  const allowed = ['render', 'renderPreset', 'quality', 'alphaQuality', 'lossless', 'selection', 'maxBytes'];
  return Object.fromEntries(allowed.filter((key) => source[key] !== undefined).map((key) => [key, source[key]]));
}

function summarizeBuild(build) {
  const packageResult = build.package ? {
    format: build.package.format,
    byteLength: build.package.byteLength,
    files: [...(build.package.files || [])],
    ...(build.package.artifactName ? { artifactName: build.package.artifactName } : {}),
  } : null;
  return {
    target: build.target,
    ...(build.targetContractVersion !== undefined ? { targetContractVersion: build.targetContractVersion } : {}),
    ...(build.themeId ? { themeId: build.themeId } : {}),
    ...(build.artifactName ? { artifactName: build.artifactName } : {}),
    manifest: build.manifest,
    assets: build.assets || [],
    validation: build.validation || null,
    encoding: build.encoding || null,
    provenance: build.provenance || null,
    preview: build.preview || null,
    cache: build.cache || null,
    report: build.report || null,
    package: packageResult,
  };
}

async function executePackageBuild(options, operationId) {
  const spec = readBuildSpec(options.input);
  const project = spec.project;
  const targets = options.target ? [options.target] : (Array.isArray(spec.targets) ? spec.targets : Object.keys(spec.inputsByTarget));
  if (!targets.length || targets.some((target) => !['clawd', 'codex-pet'].includes(target))) fail('INVALID_BUILD_TARGETS', 'Package Build targets must be clawd and/or codex-pet.');
  const inputsByTarget = Object.fromEntries(targets.map((target) => [target, decodeBuildSpecValue(spec.inputsByTarget[target] || {}, `inputsByTarget.${target}`)]));
  const cache = options.cacheDir ? new CacheStore({ rootDir: options.cacheDir }) : null;
  const sourceFingerprint = project.source && project.source.fingerprint;
  const cacheContext = {
    projectId: project.projectId,
    sourceFingerprint,
    runtimeVersion: options.runtimeVersion || spec.runtimeVersion,
    rendererVersion: options.rendererVersion || spec.rendererVersion,
    encoderVersion: options.encoderVersion || spec.encoderVersion,
  };
  const optionsByTarget = Object.fromEntries(targets.map((target) => [target, {
    ...buildOptionSubset(spec.optionsByTarget && spec.optionsByTarget[target]),
    package: true,
    ...(cache ? { cache, cacheContext } : {}),
  }]));
  const progressEvents = [];
  const built = await buildProjectTargets({
    project,
    targets,
    inputsByTarget,
    metadataByTarget: spec.metadataByTarget || {},
    optionsByTarget,
    onProgress: (event) => progressEvents.push(event),
  });
  const exported = [];
  if (options.output) {
    const outputRoot = path.resolve(options.output);
    fs.mkdirSync(outputRoot, { recursive: true, mode: 0o700 });
    for (const target of built.targets) {
      const build = built.builds[target];
      if (!build.package || !build.package.buffer) fail('PACKAGE_OUTPUT_MISSING', `${target} did not produce a package archive.`);
      const artifactName = build.package.artifactName || build.artifactName;
      const result = await exportPackage({ packageBytes: build.package.buffer, outputPath: path.join(outputRoot, artifactName), overwrite: options.overwrite === true });
      exported.push({ target, artifactName, byteLength: result.byteLength, sha256: result.sha256, overwritten: result.overwritten, path: '<selected-output>' });
    }
  }
  return envelope('package-build', operationId, {
    ok: true,
    progress: progressEvents,
    warnings: built.warnings || [],
    result: redactAbsolutePaths({
      projectId: built.projectId,
      targets: built.targets,
      builds: Object.fromEntries(built.targets.map((target) => [target, summarizeBuild(built.builds[target])])),
      exports: exported,
    }),
  });
}

async function execute(options = {}) {
  const operation = options.operation;
  const operationId = crypto.randomUUID();
  if (!operation) fail('OPERATION_REQUIRED', 'Choose a Live2Pet CLI operation.');
  if (!OPERATIONS.includes(operation)) fail('UNKNOWN_OPERATION', `Unsupported Live2Pet CLI operation: ${operation}.`, { operations: [...OPERATIONS] });

  if (operation === 'version') {
    return envelope(operation, operationId, {
      ok: true,
      progress: [{ stage: 'version', status: 'completed' }],
      warnings: [],
      result: { protocolVersion: PROTOCOL_VERSION, cliVersion: CLI_VERSION, operations: [...OPERATIONS] },
    });
  }

  if (operation === 'inspect') {
    if (!options.input) fail('INPUT_REQUIRED', operationSpec(operation).usage);
    const result = inspectSourcePackage(options.input);
    return envelope(operation, operationId, { ok: true, progress: [{ stage: 'inspect', status: 'completed' }], warnings: result.warnings, result });
  }

  if (operation === 'runtime-diagnose') {
    if (!options.input) fail('INPUT_REQUIRED', operationSpec(operation).usage);
    const result = await inspectRuntime(options.input);
    return envelope(operation, operationId, { ok: true, progress: [{ stage: 'runtime-diagnose', status: 'completed' }], warnings: [], result });
  }

  if (operation === 'cache-status' || operation === 'cache-clear') {
    if (!options.cacheDir) fail('CACHE_PATH_REQUIRED', operationSpec(operation).usage);
    const cache = new CacheStore({ rootDir: options.cacheDir });
    if (operation === 'cache-status') {
      return envelope(operation, operationId, { ok: true, progress: [{ stage: 'cache-status', status: 'completed' }], warnings: [], result: cache.status() });
    }
    const hasFilter = options.all || options.projectId !== undefined || options.sourceFingerprint !== undefined;
    if (!hasFilter) fail('CACHE_FILTER_REQUIRED', operationSpec(operation).usage);
    if (options.all && (options.projectId !== undefined || options.sourceFingerprint !== undefined)) fail('CACHE_FILTER_CONFLICT', '--all cannot be combined with a cache filter.');
    const result = cache.clear(options.all ? {} : { projectId: options.projectId, sourceFingerprint: options.sourceFingerprint });
    return envelope(operation, operationId, { ok: true, progress: [{ stage: 'cache-clear', status: 'completed' }], warnings: [], result });
  }

  if (operation === 'package-build') return executePackageBuild(options, operationId);

  if (operation === 'package-validate') {
    const validation = await validatePackageArchive(options.input, options.target);
    return envelope(operation, operationId, {
      ok: validation.result.ok,
      progress: [{ stage: 'package-validate', status: validation.result.ok ? 'completed' : 'failed' }],
      warnings: validation.result.warnings || [],
      result: validation,
    });
  }

  if (operation === 'project-recover') {
    if (!options.input) fail('INPUT_REQUIRED', operationSpec(operation).usage);
    let recovery;
    try { recovery = recoverAutosaveFile(options.input); } catch (error) {
      if (error instanceof ProjectValidationError) throw error;
      fail(error && error.code === 'ENOENT' ? 'PROJECT_NOT_FOUND' : 'PROJECT_RECOVERY_FAILED', 'The project autosave could not be inspected.', { cause: error && error.code ? error.code : 'UNKNOWN' });
    }
    if (!recovery.available) return envelope(operation, operationId, { ok: true, progress: [{ stage: 'project-recover', status: 'completed' }], warnings: [], result: { available: false, reason: recovery.reason || 'autosave-not-found' } });
    const sanitized = sanitizeProject(recovery.project);
    return envelope(operation, operationId, { ok: true, progress: [{ stage: 'project-recover', status: 'completed' }], warnings: [], result: { available: true, project: sanitized.project, sourcePathConfigured: sanitized.sourcePathConfigured, modifiedAt: recovery.modifiedAt } });
  }

  if (operation === 'export') {
    const packageBytes = readPackageFile(options.input);
    if (!options.output) fail('EXPORT_PATH_REQUIRED', operationSpec(operation).usage);
    const result = await exportPackage({ packageBytes, outputPath: options.output, overwrite: options.overwrite === true });
    return envelope(operation, operationId, { ok: true, progress: [{ stage: 'export', status: 'completed' }], warnings: [], result: { ...result, path: '<selected-output>' } });
  }

  if (operation === 'install') {
    if (!options.confirmInstall) fail('INSTALL_AUTHORIZATION_REQUIRED', 'Installation requires the explicit --confirm-install flag.');
    if (!options.target || !['clawd', 'codex-pet'].includes(options.target)) fail('TARGET_REQUIRED', operationSpec(operation).usage);
    const packageBytes = readPackageFile(options.input);
    const validation = await validatePackageArchive(options.input, options.target);
    if (!validation.result.ok) fail('PACKAGE_VALIDATION_FAILED', 'The package failed target validation and was not installed.', { errors: validation.result.errors });
    const progressEvents = [];
    const result = await installPackage({ target: options.target, packageBytes, targetRoot: options.targetRoot, packageId: options.packageId, conflict: options.conflict, onProgress: (event) => progressEvents.push(event) });
    return envelope(operation, operationId, { ok: true, progress: progressEvents, warnings: validation.result.warnings || [], result: { ...result, path: '<selected-target-root>' } });
  }

  if (!options.input) fail('INPUT_REQUIRED', operationSpec(operation).usage);
  const absolute = path.resolve(options.input);
  let project;
  try {
    project = loadProjectFile(absolute);
  } catch (error) {
    if (error instanceof ProjectValidationError) throw error;
    fail(error && error.code === 'ENOENT' ? 'PROJECT_NOT_FOUND' : 'PROJECT_READ_FAILED', error && error.code === 'ENOENT' ? 'The selected Live2Pet Project does not exist.' : 'The selected Live2Pet Project could not be read.', { cause: error && error.code ? error.code : 'UNKNOWN' });
  }
  const sanitized = sanitizeProject(project);
  return envelope(operation, operationId, {
    ok: true,
    progress: [{ stage: 'project-validate', status: 'completed' }],
    warnings: [],
    result: { ...sanitized.project, sourcePathConfigured: sanitized.sourcePathConfigured },
  });
}

async function run(argv = process.argv.slice(2)) {
  let options = { pretty: false };
  try {
    options = parseArgs(argv);
    if (options.help) {
      const operation = options.operation || 'help';
      return envelope(operation, crypto.randomUUID(), { ok: true, progress: [{ stage: 'help', status: 'completed' }], warnings: [], result: operationSpec(options.operation) });
    }
    return await execute(options);
  } catch (error) {
    const operation = options.operation || 'unknown';
    return envelope(operation, crypto.randomUUID(), { ok: false, progress: [{ stage: operation, status: 'failed' }], warnings: [], error: normalizeError(error) });
  }
}

module.exports = {
  CLI_VERSION,
  CliError,
  OPERATIONS,
  PROTOCOL_VERSION,
  execute,
  normalizeError,
  parseArgs,
  run,
};
