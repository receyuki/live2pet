const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const MAX_SOURCE_FILES = 10000;
const MAX_PCK_BYTES = 512 * 1024 * 1024;
const MAX_PCK_ENTRIES = 4096;
const PCK_RECORD_SIZE = 25;
const SOURCE_CACHE_SCHEMA_VERSION = 1;
const SOURCE_CACHE_HEADER_BYTES = 4 * 1024 * 1024;
const SOURCE_LIBRARY_SCHEMA_VERSION = 1;
const DEFAULT_LIBRARY_SCAN_DEPTH = 2;
const MAX_LIBRARY_CANDIDATES = 512;
const IGNORED_LIBRARY_DIRECTORIES = new Set(['.git', '.hg', '.svn', 'node_modules']);
const SOURCE_CACHE_KEY = Object.freeze({
  runtimeVersion: 'source-inspector',
  rendererVersion: 'none',
  recipe: Object.freeze({ operation: 'inspect', schemaVersion: SOURCE_CACHE_SCHEMA_VERSION }),
  targetProfile: 'source-package',
  targetVersion: String(SOURCE_CACHE_SCHEMA_VERSION),
  renderPreset: 'none',
  artifact: 'source-inspection',
});

class SourceInspectionError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'SourceInspectionError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details = {}) {
  throw new SourceInspectionError(code, message, details);
}

function sha256(update) {
  const hash = crypto.createHash('sha256');
  update(hash);
  return hash.digest('hex');
}

function hashBuffer(buffer) {
  return sha256((hash) => hash.update(buffer));
}

function hashFiles(files) {
  return sha256((hash) => {
    for (const file of files) {
      hash.update(file.relative);
      hash.update('\0');
      hash.update(fs.readFileSync(file.absolute));
      hash.update('\0');
    }
  });
}

function normalizeCacheBytes(value) {
  if (Buffer.isBuffer(value)) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  if (value instanceof Uint8Array) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  if (ArrayBuffer.isView(value)) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  fail('INVALID_INSPECTION_CACHE', 'Source inspection cache data must be a byte buffer.');
}

function sourceCacheKey(sourceFingerprint) {
  return { sourceFingerprint, ...SOURCE_CACHE_KEY };
}

function encodeInspectionCache({ manifest, buffers = new Map() } = {}) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) fail('INVALID_INSPECTION_CACHE', 'Source inspection cache requires a normalized manifest.');
  if (!(buffers instanceof Map)) fail('INVALID_INSPECTION_CACHE', 'Source inspection cache resources must be a Map.');
  const payloads = [];
  let offset = 0;
  const resources = [];
  for (const [relative, value] of buffers.entries()) {
    if (typeof relative !== 'string' || !relative.trim()) fail('INVALID_INSPECTION_CACHE', 'Source inspection cache resource paths must be non-empty.');
    const bytes = normalizeCacheBytes(value);
    const resource = {
      path: normalizeReference(relative),
      offset,
      length: bytes.byteLength,
      sha256: hashBuffer(bytes),
    };
    resources.push(resource);
    payloads.push(bytes);
    offset += bytes.byteLength;
  }
  const header = Buffer.from(JSON.stringify({
    schemaVersion: SOURCE_CACHE_SCHEMA_VERSION,
    kind: 'source-inspection',
    manifest,
    resources,
  }), 'utf8');
  if (header.byteLength > SOURCE_CACHE_HEADER_BYTES) fail('SOURCE_CACHE_HEADER_TOO_LARGE', `Source inspection cache metadata exceeds the ${SOURCE_CACHE_HEADER_BYTES}-byte limit.`);
  const prefix = Buffer.allocUnsafe(4);
  prefix.writeUInt32LE(header.byteLength, 0);
  return Buffer.concat([prefix, header, ...payloads]);
}

function decodeInspectionCache(value) {
  const bytes = normalizeCacheBytes(value);
  if (bytes.byteLength < 5) fail('INVALID_INSPECTION_CACHE', 'Source inspection cache data is truncated before its header.');
  const headerLength = bytes.readUInt32LE(0);
  if (!headerLength || headerLength > SOURCE_CACHE_HEADER_BYTES || headerLength + 4 > bytes.byteLength) fail('INVALID_INSPECTION_CACHE', 'Source inspection cache header length is invalid.');
  let header;
  try { header = JSON.parse(bytes.toString('utf8', 4, 4 + headerLength)); } catch (error) {
    fail('INVALID_INSPECTION_CACHE', 'Source inspection cache header is not valid JSON.', { cause: String(error.message || error) });
  }
  if (!header || header.schemaVersion !== SOURCE_CACHE_SCHEMA_VERSION || header.kind !== 'source-inspection' || !header.manifest || typeof header.manifest !== 'object' || !Array.isArray(header.resources)) {
    fail('INVALID_INSPECTION_CACHE', 'Source inspection cache header does not match the supported schema.');
  }
  const payloadLength = bytes.byteLength - 4 - headerLength;
  const ranges = [];
  for (const [index, resource] of header.resources.entries()) {
    if (!resource || typeof resource.path !== 'string' || !resource.path || !Number.isSafeInteger(resource.offset) || resource.offset < 0 || !Number.isSafeInteger(resource.length) || resource.length < 0 || resource.offset + resource.length > payloadLength || typeof resource.sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(resource.sha256)) {
      fail('INVALID_INSPECTION_CACHE', `Source inspection cache resource ${index} is invalid.`);
    }
    normalizeReference(resource.path);
    ranges.push({ start: resource.offset, end: resource.offset + resource.length });
  }
  ranges.sort((left, right) => left.start - right.start);
  for (let index = 1; index < ranges.length; index += 1) {
    if (ranges[index].start < ranges[index - 1].end) fail('INVALID_INSPECTION_CACHE', 'Source inspection cache resources overlap.');
  }
  return { manifest: header.manifest, resources: header.resources.map((resource) => ({ ...resource })) };
}

function sourceCacheAvailable(cache) {
  if (cache == null) return false;
  if (!cache || typeof cache.get !== 'function' || typeof cache.put !== 'function') fail('INVALID_INSPECTION_CACHE', 'Source inspection cache must expose get() and put() methods.');
  return true;
}

function normalizeReference(reference, baseDirectory = '') {
  if (typeof reference !== 'string' || !reference.trim()) {
    fail('INVALID_RESOURCE_PATH', 'A referenced resource path must be a non-empty string.');
  }
  const replaced = reference.replaceAll('\\', '/');
  if (replaced.includes('\0') || replaced.startsWith('/') || /^[a-z]:\//i.test(replaced)) {
    fail('INVALID_RESOURCE_PATH', `Resource path is not safely relative: ${reference}`);
  }
  const candidate = path.posix.normalize(path.posix.join(baseDirectory || '', replaced));
  if (!candidate || candidate === '.' || candidate === '..' || candidate.startsWith('../')) {
    fail('INVALID_RESOURCE_PATH', `Resource path escapes the Source Package: ${reference}`);
  }
  return candidate;
}

function walkSourceDirectory(root) {
  const files = [];
  function visit(directory, relativeDirectory) {
    const entries = fs.readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      const relative = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) fail('UNSUPPORTED_SYMLINK', `Source Package contains a symbolic link: ${relative}`);
      if (entry.isDirectory()) {
        if (IGNORED_LIBRARY_DIRECTORIES.has(entry.name)) continue;
        visit(absolute, relative);
        continue;
      }
      if (!entry.isFile()) fail('UNSUPPORTED_SOURCE_ENTRY', `Source Package entry is not a regular file: ${relative}`);
      files.push({ absolute, relative: relative.replaceAll('\\', '/') });
      if (files.length > MAX_SOURCE_FILES) fail('SOURCE_TOO_LARGE', `Source Package contains more than ${MAX_SOURCE_FILES} files.`);
    }
  }
  visit(root, '');
  return files;
}

function parseJsonBuffer(buffer, label) {
  try {
    return JSON.parse(buffer.toString('utf8'));
  } catch (error) {
    fail('INVALID_JSON', `${label} is not valid UTF-8 JSON.`, { cause: String(error.message || error) });
  }
}

function basenameWithoutExtension(file, extensions) {
  let name = path.posix.basename(file);
  for (const extension of extensions) {
    if (name.toLowerCase().endsWith(extension)) return name.slice(0, -extension.length);
  }
  return name;
}

function durationFromModernMotion(buffer) {
  const parsed = parseJsonBuffer(buffer, 'Motion');
  const duration = Number(parsed?.Meta?.Duration);
  return Number.isFinite(duration) && duration > 0 ? duration : null;
}

function durationFromCubism2Motion(buffer) {
  const text = buffer.toString('utf8');
  const fps = Number(text.match(/^\$fps\s*=\s*([\d.]+)/mi)?.[1]) || 30;
  let frameCount = 0;
  for (const line of text.split(/\r?\n|\r/)) {
    if (!line || line.startsWith('#') || line.startsWith('$')) continue;
    const separator = line.indexOf('=');
    if (separator < 0) continue;
    frameCount = Math.max(frameCount, line.slice(separator + 1).split(',').length);
  }
  return frameCount > 1 ? (frameCount - 1) / fps : null;
}

function resourceName(reference, extensions) {
  return basenameWithoutExtension(reference, extensions);
}

function createSourceView({ files, buffers, configPath, source }) {
  const fileMap = new Map(files.map((file) => [file.relative, file]));
  const bufferMap = buffers || new Map();
  const warnings = [];
  const resources = [];

  function resolve(reference, baseDirectory = null) {
    const configDirectory = path.posix.dirname(configPath) === '.' ? '' : path.posix.dirname(configPath);
    const relative = normalizeReference(reference, baseDirectory == null ? configDirectory : baseDirectory);
    if (fileMap.has(relative) || bufferMap.has(relative)) return relative;
    const rootRelative = normalizeReference(reference);
    if (fileMap.has(rootRelative) || bufferMap.has(rootRelative)) return rootRelative;
    return relative;
  }

  function has(relative) {
    return fileMap.has(relative) || bufferMap.has(relative);
  }

  function read(relative) {
    if (bufferMap.has(relative)) return bufferMap.get(relative);
    const file = fileMap.get(relative);
    return file ? fs.readFileSync(file.absolute) : null;
  }

  function addResource(kind, reference, required = true, baseDirectory = null) {
    const relative = resolve(reference, baseDirectory);
    const exists = has(relative);
    const item = { kind, path: relative, required, exists };
    resources.push(item);
    if (!exists && required) warnings.push({ code: 'MISSING_RESOURCE', resource: relative, kind });
    return { ...item, relative };
  }

  return { source, configPath, warnings, resources, resolve, has, read, addResource };
}

function inspectSettings(settings, view, cubism) {
  const model = {
    cubism,
    configFile: view.configPath,
    modelFile: null,
    textures: [],
    physics: null,
    pose: null,
  };

  const motions = [];
  const expressions = [];
  if (cubism === 2) {
    if (!settings.model || !Array.isArray(settings.textures) || !settings.motions || typeof settings.motions !== 'object') {
      fail('INVALID_MODEL_CONFIG', 'Cubism 2 model.json is missing model, textures, or motions.');
    }
    model.modelFile = view.addResource('model', settings.model).relative;
    model.textures = settings.textures.map((reference) => view.addResource('texture', reference).relative);
    for (const key of ['physics', 'pose']) {
      if (settings[key]) model[key] = view.addResource(key, settings[key]).relative;
    }
    if (Array.isArray(settings.expressions)) {
      settings.expressions.forEach((entry, index) => {
        if (!entry?.file) return;
        const resource = view.addResource('expression', entry.file);
        expressions.push({
          id: String(index),
          index,
          name: entry.name || resourceName(entry.file, ['.exp.json']),
          sourceFile: resource.relative,
        });
      });
    }
    for (const [group, entries] of Object.entries(settings.motions)) {
      if (!Array.isArray(entries)) continue;
      entries.forEach((entry, index) => {
        if (!entry?.file) fail('INVALID_MOTION_DEFINITION', `Cubism 2 motion ${group}:${index} has no file.`);
        const resource = view.addResource('motion', entry.file);
        const buffer = view.read(resource.relative);
        motions.push({
          id: `${group || 'default'}:${index}`,
          group,
          index,
          name: entry.name || resourceName(entry.file, ['.mtn']),
          sourceFile: resource.relative,
          duration: buffer ? durationFromCubism2Motion(buffer) : null,
        });
      });
    }
  } else {
    const references = settings.FileReferences;
    if (!references || typeof references !== 'object' || !references.Moc || !Array.isArray(references.Textures)) {
      fail('INVALID_MODEL_CONFIG', 'Modern model3.json is missing FileReferences, Moc, or Textures.');
    }
    model.modelFile = view.addResource('model', references.Moc).relative;
    model.textures = references.Textures.map((reference) => view.addResource('texture', reference).relative);
    for (const [key, kind] of [['Physics', 'physics'], ['Pose', 'pose'], ['UserData', 'userdata'], ['DisplayInfo', 'display-info']]) {
      if (references[key]) view.addResource(kind, references[key]);
    }
    if (Array.isArray(references.Expressions)) {
      references.Expressions.forEach((entry, index) => {
        if (!entry?.File) return;
        const resource = view.addResource('expression', entry.File);
        expressions.push({
          id: String(index),
          index,
          name: entry.Name || resourceName(entry.File, ['.exp3.json']),
          sourceFile: resource.relative,
        });
      });
    }
    for (const [group, entries] of Object.entries(references.Motions || {})) {
      if (!Array.isArray(entries)) continue;
      entries.forEach((entry, index) => {
        if (!entry?.File) fail('INVALID_MOTION_DEFINITION', `Modern motion ${group}:${index} has no File.`);
        const resource = view.addResource('motion', entry.File);
        const buffer = view.read(resource.relative);
        let duration = null;
        if (buffer) {
          try { duration = durationFromModernMotion(buffer); } catch (error) {
            if (!(error instanceof SourceInspectionError)) throw error;
          }
        }
        motions.push({
          id: `${group || 'default'}:${index}`,
          group,
          index,
          name: entry.Name || resourceName(entry.File, ['.motion3.json']),
          sourceFile: resource.relative,
          duration,
        });
      });
    }
  }

  return {
    schemaVersion: 1,
    source: { ...view.source, modelConfig: view.configPath },
    model,
    motions,
    expressions,
    resources: view.resources,
    warnings: view.warnings,
  };
}

function spineRuntimeLine(version) {
  const match = String(version || '').trim().match(/^(\d+)\.(\d+)(?:\.|$)/);
  return match ? `${match[1]}.${match[2]}` : null;
}

function spineAnimationDuration(value) {
  let duration = 0;
  const visit = (entry) => {
    if (Array.isArray(entry)) return entry.forEach(visit);
    if (!entry || typeof entry !== 'object') return;
    if (Number.isFinite(Number(entry.time))) duration = Math.max(duration, Number(entry.time));
    Object.values(entry).forEach(visit);
  };
  visit(value);
  return duration;
}

function spineAtlasPages(buffer) {
  const pages = [];
  let expectPage = true;
  for (const rawLine of buffer.toString('utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) {
      expectPage = true;
      continue;
    }
    if (!expectPage) continue;
    if (line.includes(':')) fail('INVALID_SPINE_ATLAS', 'Spine atlas begins with an invalid texture page name.');
    pages.push(line);
    expectPage = false;
  }
  if (!pages.length) fail('INVALID_SPINE_ATLAS', 'Spine atlas contains no texture pages.');
  return [...new Set(pages)];
}

function readSpineBinaryString(buffer, cursor) {
  let value = 0;
  let shift = 0;
  for (let count = 0; count < 5; count += 1) {
    if (cursor.offset >= buffer.length) fail('INVALID_SPINE_SKELETON', 'Spine binary skeleton header is truncated.');
    const byte = buffer[cursor.offset++];
    value |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) {
      if (value === 0) return null;
      const length = value - 1;
      if (length < 0 || cursor.offset + length > buffer.length) fail('INVALID_SPINE_SKELETON', 'Spine binary skeleton contains an invalid header string.');
      const result = buffer.subarray(cursor.offset, cursor.offset + length).toString('utf8');
      cursor.offset += length;
      return result;
    }
    shift += 7;
  }
  fail('INVALID_SPINE_SKELETON', 'Spine binary skeleton contains an invalid header length.');
}

function spineBinaryVersion(buffer) {
  const attempts = [{ offset: 0 }, { offset: 8 }];
  for (const cursor of attempts) {
    try {
      if (cursor.offset === 0) readSpineBinaryString(buffer, cursor);
      const version = readSpineBinaryString(buffer, cursor);
      if (spineRuntimeLine(version)) return version;
    } catch (error) {
      if (!(error instanceof SourceInspectionError)) throw error;
    }
  }
  const header = buffer.subarray(0, Math.min(buffer.length, 256)).toString('latin1');
  const fallback = header.match(/(?:^|[^0-9])([2-9]\.[0-9]+(?:\.[0-9]+)?)(?:[^0-9]|$)/)?.[1];
  return fallback || null;
}

function inspectSpineDirectory(root, sourceFiles, skeletonCandidate, atlasCandidate, fingerprint) {
  const source = { kind: 'spine-directory', name: path.basename(root), fingerprint: fingerprint || hashFiles(sourceFiles), fileCount: sourceFiles.length };
  const view = createSourceView({ files: sourceFiles, configPath: skeletonCandidate.relative, source });
  const skeletonBuffer = fs.readFileSync(skeletonCandidate.absolute);
  const isJson = /\.json$/i.test(skeletonCandidate.relative);
  const skeleton = isJson ? parseJsonBuffer(skeletonBuffer, skeletonCandidate.relative) : null;
  const version = isJson ? skeleton?.skeleton?.spine : spineBinaryVersion(skeletonBuffer);
  const runtimeLine = spineRuntimeLine(version);
  if (!runtimeLine) fail('INVALID_SPINE_VERSION', 'Spine skeleton does not declare a recognizable export version.');
  const atlasDirectory = path.posix.dirname(atlasCandidate.relative) === '.' ? '' : path.posix.dirname(atlasCandidate.relative);
  const modelFile = view.addResource('skeleton', skeletonCandidate.relative, true, '').relative;
  const atlasFile = view.addResource('atlas', atlasCandidate.relative, true, '').relative;
  const textures = spineAtlasPages(fs.readFileSync(atlasCandidate.absolute)).map((reference) => view.addResource('texture', reference, true, atlasDirectory).relative);
  const animations = isJson && skeleton.animations && typeof skeleton.animations === 'object' && !Array.isArray(skeleton.animations) ? Object.entries(skeleton.animations) : [];
  return {
    schemaVersion: 1,
    source: { ...source, modelConfig: skeletonCandidate.relative },
    model: { format: 'spine', configFile: skeletonCandidate.relative, modelFile, atlasFile, textures, spineVersion: String(version), runtimeLine, binary: !isJson },
    motions: animations.map(([name, animation], index) => ({ id: name, group: 'animations', index, name, sourceFile: skeletonCandidate.relative, duration: spineAnimationDuration(animation) })),
    expressions: [],
    visualElements: isJson && Array.isArray(skeleton.slots) ? skeleton.slots.filter((slot) => slot && typeof slot.name === 'string' && slot.name).map((slot) => ({ id: `slot:${slot.name}`, name: slot.name, kind: 'slot' })) : [],
    resources: view.resources,
    warnings: view.warnings,
  };
}

function inspectDirectory(root, { files = null, fingerprint = null, withResources = false, modelConfig = null } = {}) {
  const sourceFiles = files || walkSourceDirectory(root);
  const modelCandidates = sourceFiles.filter((file) => /\.model3\.json$/i.test(file.relative) || /(^|\/)model\.json$/i.test(file.relative));
  const spineJsonCandidates = sourceFiles.filter((file) => {
    if (!/\.json$/i.test(file.relative) || /\.(?:model3|motion3|exp3|physics3|pose3|userdata3)\.json$/i.test(file.relative) || /(^|\/)model\.json$/i.test(file.relative)) return false;
    try {
      const value = parseJsonBuffer(fs.readFileSync(file.absolute), file.relative);
      return Boolean(value?.skeleton?.spine && value.animations && typeof value.animations === 'object');
    } catch { return false; }
  });
  const spineCandidates = [...spineJsonCandidates, ...sourceFiles.filter((file) => /\.skel$/i.test(file.relative))];
  const selectedConfig = modelConfig == null ? null : normalizeReference(modelConfig);
  const selectedLive2d = selectedConfig ? modelCandidates.filter((file) => file.relative === selectedConfig) : modelCandidates;
  const selectedSpine = selectedConfig ? spineCandidates.filter((file) => file.relative === selectedConfig) : spineCandidates;
  if (selectedConfig && !selectedLive2d.length && !selectedSpine.length) fail('MODEL_CONFIG_NOT_FOUND', `The selected model configuration was not found: ${selectedConfig}`);
  if (!selectedConfig && modelCandidates.length && spineCandidates.length) fail('AMBIGUOUS_SOURCE_FORMAT', 'Source Package contains both Live2D and Spine model configurations.');
  if (selectedSpine.length) {
    if (selectedSpine.length > 1) fail('AMBIGUOUS_SPINE_SKELETON', 'Source Package contains more than one Spine skeleton.', { candidates: selectedSpine.map((file) => file.relative) });
    const skeleton = selectedSpine[0];
    const skeletonDirectory = path.posix.dirname(skeleton.relative);
    const skeletonBase = basenameWithoutExtension(skeleton.relative, ['.json', '.skel']);
    const atlasCandidates = sourceFiles.filter((file) => /\.atlas$/i.test(file.relative));
    const atlas = atlasCandidates.find((file) => path.posix.dirname(file.relative) === skeletonDirectory && basenameWithoutExtension(file.relative, ['.atlas']) === skeletonBase)
      || (atlasCandidates.length === 1 ? atlasCandidates[0] : null);
    if (!atlas) fail(atlasCandidates.length ? 'AMBIGUOUS_SPINE_ATLAS' : 'SPINE_ATLAS_NOT_FOUND', atlasCandidates.length ? 'Spine Source Package contains multiple atlases and none matches the skeleton name.' : 'Spine Source Package contains no .atlas file.');
    const manifest = inspectSpineDirectory(root, sourceFiles, skeleton, atlas, fingerprint);
    return withResources ? { manifest, buffers: new Map() } : manifest;
  }
  if (!selectedLive2d.length) fail('MODEL_CONFIG_NOT_FOUND', 'Source Package contains no Live2D model config or supported Spine skeleton.');
  if (selectedLive2d.length > 1) fail('AMBIGUOUS_MODEL_CONFIG', 'Source Package contains more than one model configuration.', { candidates: selectedLive2d.map((file) => file.relative) });

  const config = selectedLive2d[0];
  const settings = parseJsonBuffer(fs.readFileSync(config.absolute), config.relative);
  const cubism = /\.model3\.json$/i.test(config.relative)
    ? Number(settings.Meta?.CubismVersion || settings.Version || 3)
    : 2;
  if (![2, 3, 4, 5].includes(cubism)) fail('UNSUPPORTED_CUBISM_VERSION', `Unsupported Cubism generation: ${cubism}`);
  const source = {
    kind: 'standard-directory',
    name: path.basename(root),
    fingerprint: fingerprint || hashFiles(sourceFiles),
    fileCount: sourceFiles.length,
  };
  const view = createSourceView({ files: sourceFiles, configPath: config.relative, source });
  const manifest = inspectSettings(settings, view, cubism);
  return withResources ? { manifest, buffers: new Map() } : manifest;
}

function bytesMatch(bytes, signature) {
  return bytes.length >= signature.length && signature.every((value, index) => bytes[index] === value);
}

function pckEntryType(bytes) {
  if (bytesMatch(bytes, [0x23, 0x20, 0x4c, 0x69, 0x76, 0x65, 0x32, 0x44])) return 'motion';
  if (bytesMatch(bytes, [0x6d, 0x6f, 0x63])) return 'model';
  if (bytesMatch(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'texture';
  if (bytes.toString('utf8').trimStart().startsWith('{')) return 'json';
  return 'unknown';
}

function parsePck(filePath, sourceBytes = null) {
  const bytes = sourceBytes || fs.readFileSync(filePath);
  if (bytes.length > MAX_PCK_BYTES) fail('PCK_TOO_LARGE', `PCK exceeds the ${MAX_PCK_BYTES} byte inspection limit.`);
  if (bytes.length < 12 || !bytesMatch(bytes, [0x50, 0x43, 0x4b, 0x00])) fail('INVALID_PCK_HEADER', 'Not a supported Live2D PCK file: missing PCK\\0 header.');
  const version = bytes.readFloatLE(4);
  const count = bytes.readUInt32LE(8);
  const headerSize = 12 + count * PCK_RECORD_SIZE;
  if (!count || count > MAX_PCK_ENTRIES || headerSize > bytes.length) fail('INVALID_PCK_TABLE', `Invalid PCK table: ${count} entries.`);

  const entries = [];
  for (let index = 0; index < count; index += 1) {
    const base = 12 + index * PCK_RECORD_SIZE;
    const flags = bytes.readUInt8(base + 8);
    const offset = bytes.readUInt32LE(base + 9);
    const storedSize = bytes.readUInt32LE(base + 13);
    const originalSize = bytes.readUInt32LE(base + 17);
    if (offset < headerSize || offset + storedSize > bytes.length) fail('PCK_ENTRY_OUT_OF_BOUNDS', `PCK entry ${index} is out of bounds.`, { index });
    if (flags !== 0 || storedSize !== originalSize) fail('UNSUPPORTED_PCK_FLAGS', `PCK entry ${index} uses unsupported compression or encryption flags.`, { index, flags, storedSize, originalSize });
    entries.push({ index, offset, end: offset + storedSize, storedSize, data: bytes.subarray(offset, offset + storedSize), type: pckEntryType(bytes.subarray(offset, offset + storedSize)) });
  }
  const ranges = [...entries].sort((left, right) => left.offset - right.offset);
  for (let index = 1; index < ranges.length; index += 1) {
    if (ranges[index].offset < ranges[index - 1].end) fail('OVERLAPPING_PCK_ENTRIES', `PCK entries ${ranges[index - 1].index} and ${ranges[index].index} overlap.`);
  }

  const jsonEntries = entries.filter((entry) => entry.type === 'json');
  const parsedJson = jsonEntries.map((entry) => ({ entry, value: parseJsonBuffer(entry.data, `PCK JSON entry ${entry.index}`) }));
  const modelJson = parsedJson.find(({ value }) => value && typeof value === 'object' && value.model && Array.isArray(value.textures) && value.motions);
  if (!modelJson) fail('PCK_MODEL_CONFIG_NOT_FOUND', 'PCK contains no complete Cubism 2 model.json.');
  const settings = modelJson.value;
  const motionDefinitions = Object.values(settings.motions).flat().filter(Boolean);
  const expressionDefinitions = Array.isArray(settings.expressions) ? settings.expressions.filter((entry) => entry?.file) : [];
  const modelEntries = entries.filter((entry) => entry.type === 'model');
  const textureEntries = entries.filter((entry) => entry.type === 'texture');
  const motionEntries = entries.filter((entry) => entry.type === 'motion');
  const extraJsonEntries = jsonEntries.filter((entry) => entry.index !== modelJson.entry.index);
  const binaryEntries = entries.filter((entry) => !['json', 'motion', 'texture'].includes(entry.type));
  const binaryRefs = [settings.model, settings.physics, settings.pose].filter(Boolean);
  if (modelEntries.length < 1) fail('PCK_MODEL_BINARY_NOT_FOUND', 'PCK contains no Cubism 2 model binary.');
  if (textureEntries.length < settings.textures.length) fail('PCK_TEXTURES_MISSING', 'PCK contains too few textures.', { expected: settings.textures.length, actual: textureEntries.length });
  if (motionEntries.length < motionDefinitions.length) fail('PCK_MOTIONS_MISSING', 'PCK contains too few motions.', { expected: motionDefinitions.length, actual: motionEntries.length });
  if (extraJsonEntries.length < expressionDefinitions.length) fail('PCK_EXPRESSIONS_MISSING', 'PCK contains too few expressions.', { expected: expressionDefinitions.length, actual: extraJsonEntries.length });
  if (binaryEntries.length < binaryRefs.length) fail('PCK_BINARY_RESOURCES_MISSING', 'PCK contains too few model-side binary resources.', { expected: binaryRefs.length, actual: binaryEntries.length });
  if (modelEntries.length > 1 || textureEntries.length > settings.textures.length || motionEntries.length > motionDefinitions.length || extraJsonEntries.length > expressionDefinitions.length) {
    fail('AMBIGUOUS_PCK_RESOURCES', 'PCK contains extra typed resources that cannot be mapped to required model references.');
  }

  const buffers = new Map();
  const setBuffer = (reference, data) => {
    const relative = normalizeReference(reference);
    const previous = buffers.get(relative);
    if (previous && !previous.equals(data)) {
      fail('RESOURCE_COLLISION', `PCK resources resolve to the same path with different contents: ${relative}`, { path: relative });
    }
    buffers.set(relative, data);
  };
  setBuffer('model.json', modelJson.entry.data);
  binaryRefs.forEach((reference, index) => setBuffer(reference, binaryEntries[index].data));
  settings.textures.forEach((reference, index) => setBuffer(reference, textureEntries[index].data));
  motionDefinitions.forEach((definition, index) => setBuffer(definition.file, motionEntries[index].data));
  expressionDefinitions.forEach((definition, index) => setBuffer(definition.file, extraJsonEntries[index].data));
  return { version, count, entries, settings, buffers };
}

function inspectPck(filePath, { bytes = null, fingerprint = null, withResources = false } = {}) {
  const parsed = parsePck(filePath, bytes);
  const source = {
    kind: 'pck',
    name: path.basename(filePath),
    fingerprint: fingerprint || hashBuffer(bytes || fs.readFileSync(filePath)),
    fileCount: parsed.buffers.size,
    entryCount: parsed.count,
    version: parsed.version,
  };
  const files = [...parsed.buffers.keys()].map((relative) => ({ relative, absolute: null }));
  const view = createSourceView({ files, buffers: parsed.buffers, configPath: 'model.json', source });
  const manifest = inspectSettings(parsed.settings, view, 2);
  return withResources ? { manifest, buffers: parsed.buffers } : manifest;
}

function resolveSourceInput(inputPath) {
  if (typeof inputPath !== 'string' || !inputPath.trim()) fail('INPUT_REQUIRED', 'An input Source Package path is required.');
  const resolved = path.resolve(inputPath);
  if (!fs.existsSync(resolved)) fail('INPUT_NOT_FOUND', 'The selected Source Package does not exist.');
  const stat = fs.lstatSync(resolved);
  if (stat.isDirectory()) {
    const files = walkSourceDirectory(resolved);
    return { kind: 'directory', resolved, files, fingerprint: hashFiles(files) };
  }
  if (stat.isFile() && path.extname(resolved).toLowerCase() === '.pck') {
    if (stat.size > MAX_PCK_BYTES) fail('PCK_TOO_LARGE', `PCK exceeds the ${MAX_PCK_BYTES} byte inspection limit.`);
    const bytes = fs.readFileSync(resolved);
    return { kind: 'pck', resolved, bytes, fingerprint: hashBuffer(bytes) };
  }
  fail('UNSUPPORTED_INPUT', 'Select a Source Package directory or a .pck file.');
}

function inspectSourcePackage(inputPath, { cache = null, projectId, modelConfig = null } = {}) {
  const descriptor = resolveSourceInput(inputPath);
  if (descriptor.kind !== 'directory' && modelConfig != null) fail('INVALID_MODEL_SELECTION', 'A model configuration can only select a model inside a Source Package directory.');
  const selectedConfig = modelConfig == null ? null : normalizeReference(modelConfig);
  const inspectionFingerprint = selectedConfig
    ? hashBuffer(Buffer.from(`${descriptor.fingerprint}\0${selectedConfig}`, 'utf8'))
    : descriptor.fingerprint;
  const useCache = sourceCacheAvailable(cache);
  const key = useCache ? sourceCacheKey(inspectionFingerprint) : null;
  if (useCache) {
    const cached = cache.get(key);
    if (cached) {
      try {
        const decoded = decodeInspectionCache(cached.data);
        if (decoded.manifest?.source?.fingerprint === inspectionFingerprint) return decoded.manifest;
      } catch {
        // A stale or manually damaged cache entry is ignored and rebuilt below.
      }
    }
  }

  const inspected = descriptor.kind === 'directory'
    ? inspectDirectory(descriptor.resolved, { files: descriptor.files, fingerprint: inspectionFingerprint, withResources: useCache, modelConfig: selectedConfig })
    : inspectPck(descriptor.resolved, { bytes: descriptor.bytes, fingerprint: descriptor.fingerprint, withResources: useCache });
  const manifest = useCache ? inspected.manifest : inspected;
  if (useCache) {
    const data = encodeInspectionCache({ manifest, buffers: inspected.buffers });
    cache.put(key, data, {
      ...(projectId === undefined ? {} : { projectId }),
      sourceFingerprint: inspectionFingerprint,
      artifact: SOURCE_CACHE_KEY.artifact,
    });
  }
  return manifest;
}

function discoverSourcePackages(inputPath, { maxDepth = DEFAULT_LIBRARY_SCAN_DEPTH } = {}) {
  if (!Number.isInteger(maxDepth) || maxDepth < 0 || maxDepth > 8) fail('INVALID_LIBRARY_SCAN_DEPTH', 'Source library scan depth must be an integer from 0 to 8.');
  if (typeof inputPath !== 'string' || !inputPath.trim()) fail('INPUT_REQUIRED', 'A Source library directory is required.');
  const root = path.resolve(inputPath);
  let rootStat;
  try { rootStat = fs.lstatSync(root); } catch { fail('INPUT_NOT_FOUND', 'The selected Source library does not exist.'); }
  if (!rootStat.isDirectory()) fail('INVALID_SOURCE_LIBRARY', 'A Source library must be a directory.');
  const candidates = [];
  const addCandidate = ({ absolute, relative, format, modelConfig, version = null, runtimeLine = null, binary = false, name = null }) => {
    if (candidates.length >= MAX_LIBRARY_CANDIDATES) fail('SOURCE_LIBRARY_TOO_LARGE', `Source library contains more than ${MAX_LIBRARY_CANDIDATES} model projects within the selected scan depth.`);
    const normalized = relative.replaceAll('\\', '/');
    candidates.push({
      id: hashBuffer(Buffer.from(`${format}\0${normalized}`, 'utf8')).slice(0, 24),
      name: name || basenameWithoutExtension(normalized, ['.model3.json', '.json', '.skel', '.pck']),
      relativePath: normalized,
      format,
      modelConfig,
      version,
      runtimeLine,
      binary,
      inputPath: absolute,
    });
  };
  const visit = (directory, relativeDirectory, depth) => {
    let entries;
    try { entries = fs.readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name)); }
    catch { return; }
    const files = entries.filter((entry) => entry.isFile());
    const fileNames = new Set(files.map((entry) => entry.name));
    for (const entry of files) {
      const absolute = path.join(directory, entry.name);
      const relative = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
      const lower = entry.name.toLowerCase();
      if (lower.endsWith('.pck')) {
        addCandidate({ absolute, relative, format: 'live2d-pck', modelConfig: null });
        continue;
      }
      if (lower.endsWith('.model3.json')) {
        addCandidate({ absolute: directory, relative, format: 'live2d', modelConfig: relativeDirectory ? relative.slice(relativeDirectory.length + 1) : relative });
        continue;
      }
      if (lower === 'model.json') {
        try {
          const settings = parseJsonBuffer(fs.readFileSync(absolute), relative);
          if (settings?.model && Array.isArray(settings.textures) && settings.motions && typeof settings.motions === 'object') {
            addCandidate({ absolute: directory, relative, format: 'live2d', modelConfig: entry.name, name: path.basename(directory) });
          }
        } catch {}
        continue;
      }
      if (lower.endsWith('.skel')) {
        const version = spineBinaryVersion(fs.readFileSync(absolute));
        const atlasName = `${entry.name.slice(0, -5)}.atlas`;
        if (fileNames.has(atlasName)) addCandidate({ absolute: directory, relative, format: 'spine', modelConfig: entry.name, version, runtimeLine: spineRuntimeLine(version), binary: true });
        continue;
      }
      if (lower.endsWith('.json') && !/\.(?:motion3|exp3|physics3|pose3|userdata3)\.json$/i.test(lower)) {
        try {
          const skeleton = parseJsonBuffer(fs.readFileSync(absolute), relative);
          const version = skeleton?.skeleton?.spine;
          const atlasName = `${entry.name.slice(0, -5)}.atlas`;
          if (version && skeleton.animations && typeof skeleton.animations === 'object' && fileNames.has(atlasName)) {
            addCandidate({ absolute: directory, relative, format: 'spine', modelConfig: entry.name, version: String(version), runtimeLine: spineRuntimeLine(version) });
          }
        } catch {}
      }
    }
    if (depth >= maxDepth) return;
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink() || IGNORED_LIBRARY_DIRECTORIES.has(entry.name)) continue;
      visit(path.join(directory, entry.name), relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name, depth + 1);
    }
  };
  visit(root, '', 0);
  candidates.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  return { schemaVersion: SOURCE_LIBRARY_SCHEMA_VERSION, name: path.basename(root), maxDepth, candidates };
}

module.exports = {
  DEFAULT_LIBRARY_SCAN_DEPTH,
  SOURCE_CACHE_SCHEMA_VERSION,
  SOURCE_LIBRARY_SCHEMA_VERSION,
  SourceInspectionError,
  decodeInspectionCache,
  discoverSourcePackages,
  encodeInspectionCache,
  inspectSourcePackage,
  normalizeReference,
  parsePck,
};
