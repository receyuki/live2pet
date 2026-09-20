const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

const { parseProject, serializeProject, validateProject } = require('@live2pet/project');
const zip = require('@zip.js/zip.js');

const PORTABLE_FORMAT = 'live2pet-package';
const CONTAINER_VERSION = 1;
const PROJECT_ENTRY = 'project.l2p';
const MANIFEST_ENTRY = 'manifest.json';
const MAX_PORTABLE_FILES = 10000;
const MAX_PORTABLE_BYTES = 4 * 1024 * 1024 * 1024;
const MAX_PORTABLE_MANIFEST_BYTES = 4 * 1024 * 1024;
const STORED_EXTENSIONS = new Set(['.7z', '.aac', '.flac', '.gif', '.gz', '.jpeg', '.jpg', '.lpk', '.mp3', '.mp4', '.ogg', '.pck', '.png', '.rar', '.webm', '.webp', '.zip']);

class PortableProjectError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'PortableProjectError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details = {}) {
  throw new PortableProjectError(code, message, details);
}

function safeEntryPath(value) {
  if (typeof value !== 'string' || !value || value.includes('\\') || value.includes('\0')) return false;
  if (value.startsWith('/') || /^[A-Za-z]:/.test(value)) return false;
  const normalized = path.posix.normalize(value);
  return normalized === value && !normalized.split('/').includes('..');
}

function sha256Buffer(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

async function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex');
}

async function sourceFiles(sourcePath, excludedPath) {
  const absolute = path.resolve(sourcePath);
  const excluded = excludedPath ? path.resolve(excludedPath) : null;
  let rootStat;
  try { rootStat = await fsp.lstat(absolute); } catch { fail('PORTABLE_SOURCE_UNAVAILABLE', 'The model source is unavailable and cannot be included.'); }
  if (rootStat.isSymbolicLink()) fail('PORTABLE_SOURCE_LINK', 'A symbolic link cannot be used as the portable project source.');
  if (rootStat.isFile()) {
    if (rootStat.size > MAX_PORTABLE_BYTES) fail('PORTABLE_SOURCE_TOO_LARGE', 'The model source is too large for a portable project.');
    return { sourceEntry: `source/${path.basename(absolute)}`, records: [{ absolute, entry: `source/${path.basename(absolute)}`, size: rootStat.size }] };
  }
  if (!rootStat.isDirectory()) fail('PORTABLE_SOURCE_INVALID', 'The portable project source must be a model folder or file.');
  const records = [];
  let total = 0;
  async function visit(directory, relativeDirectory = '') {
    const entries = await fsp.readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const relative = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
      const absoluteEntry = path.join(directory, entry.name);
      if (excluded && path.resolve(absoluteEntry) === excluded) continue;
      if (entry.isSymbolicLink()) fail('PORTABLE_SOURCE_LINK', `The model source contains a symbolic link: ${relative}`);
      if (entry.isDirectory()) await visit(absoluteEntry, relative);
      else if (entry.isFile()) {
        const stat = await fsp.stat(absoluteEntry);
        total += stat.size;
        if (records.length >= MAX_PORTABLE_FILES || total > MAX_PORTABLE_BYTES) fail('PORTABLE_SOURCE_TOO_LARGE', `Portable projects support at most ${MAX_PORTABLE_FILES} files and ${MAX_PORTABLE_BYTES} uncompressed bytes.`);
        records.push({ absolute: absoluteEntry, entry: `source/${relative.replace(/\\/g, '/')}`, size: stat.size });
      }
    }
  }
  await visit(absolute);
  if (!records.length) fail('PORTABLE_SOURCE_EMPTY', 'The selected model source folder is empty.');
  return { sourceEntry: 'source', records };
}

function fileReader(filePath, size) {
  let handle;
  const reader = new zip.Reader();
  reader.size = size;
  reader.init = async () => { handle = await fsp.open(filePath, 'r'); reader.initialized = true; };
  reader.readUint8Array = async (offset, length) => {
    const buffer = Buffer.allocUnsafe(length);
    const { bytesRead } = await handle.read(buffer, 0, length, offset);
    return Uint8Array.from(buffer.subarray(0, bytesRead));
  };
  reader.close = async () => { if (handle) await handle.close(); };
  return reader;
}

function fileWriter(filePath) {
  let handle;
  let offset = 0;
  const writer = new zip.Writer();
  writer.init = async () => { handle = await fsp.open(filePath, 'wx', 0o600); writer.initialized = true; };
  writer.writeUint8Array = async (array) => {
    const buffer = Buffer.from(array.buffer, array.byteOffset, array.byteLength);
    await handle.write(buffer, 0, buffer.length, offset);
    offset += buffer.length;
  };
  writer.getData = async () => { if (handle) { await handle.close(); handle = null; } return filePath; };
  writer.abort = async () => { if (handle) { await handle.close(); handle = null; } };
  return writer;
}

function shouldCompress(entry) {
  return !STORED_EXTENSIONS.has(path.extname(entry).toLowerCase());
}

async function savePortableProject(filePath, project) {
  const validated = validateProject(project);
  if (!validated.source.path) fail('PORTABLE_SOURCE_UNAVAILABLE', 'Relink the model source before saving a portable project.');
  const absolute = path.resolve(filePath);
  const { sourceEntry, records } = await sourceFiles(validated.source.path, absolute);
  const projectText = serializeProject(validated, { sourceLocation: { type: 'relative', path: sourceEntry } });
  const files = [{ path: PROJECT_ENTRY, size: Buffer.byteLength(projectText), sha256: sha256Buffer(projectText) }];
  for (const record of records) files.push({ path: record.entry, size: record.size, sha256: await sha256File(record.absolute) });
  const manifest = `${JSON.stringify({ format: PORTABLE_FORMAT, containerVersion: CONTAINER_VERSION, project: PROJECT_ENTRY, source: { entry: sourceEntry, type: sourceEntry === 'source' ? 'directory' : 'file' }, files }, null, 2)}\n`;
  if (Buffer.byteLength(manifest, 'utf8') > MAX_PORTABLE_MANIFEST_BYTES) fail('PORTABLE_MANIFEST_TOO_LARGE', 'The portable project manifest is too large to open safely.');
  const temporary = `${absolute}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await fsp.mkdir(path.dirname(absolute), { recursive: true });
  const output = fileWriter(temporary);
  const writer = new zip.ZipWriter(output);
  try {
    await writer.add(MANIFEST_ENTRY, new zip.TextReader(manifest), { level: 6 });
    await writer.add(PROJECT_ENTRY, new zip.TextReader(projectText), { level: 6 });
    for (const record of records) {
      const input = fileReader(record.absolute, record.size);
      try { await writer.add(record.entry, input, { level: shouldCompress(record.entry) ? 6 : 0 }); }
      finally { await input.close(); }
    }
    await writer.close();
    await fsp.rename(temporary, absolute);
  } catch (error) {
    await output.abort();
    try { await fsp.unlink(temporary); } catch {}
    if (error instanceof PortableProjectError) throw error;
    fail('PORTABLE_SAVE_FAILED', `The portable project could not be written: ${error?.message || error}`);
  }
  return absolute;
}

async function archiveReader(filePath) {
  const stat = await fsp.stat(filePath);
  return fileReader(filePath, stat.size);
}

function resolveContainedEntry(root, entry) {
  const resolved = path.resolve(root, ...entry.split('/'));
  const relative = path.relative(root, resolved);
  if (path.isAbsolute(relative) || relative === '..' || relative.startsWith(`..${path.sep}`)) {
    fail('INVALID_PORTABLE_PROJECT', 'The portable project source path escapes its working copy.');
  }
  return resolved;
}

async function rejectSymlinkComponents(root, target) {
  let current = path.resolve(root);
  const relative = path.relative(current, path.resolve(target));
  for (const segment of relative ? relative.split(path.sep) : []) {
    current = path.join(current, segment);
    const stat = await fsp.lstat(current).catch(() => null);
    if (stat?.isSymbolicLink()) fail('INVALID_PORTABLE_PROJECT', 'The portable project source contains a symbolic link.');
  }
}

function manifestInventory(manifest) {
  const declaredFiles = new Map();
  const declaredDirectories = new Map();
  for (const record of manifest.files) {
    const fileIdentity = record.path.normalize('NFC').toLowerCase();
    declaredFiles.set(fileIdentity, record.path);
    let directory = path.posix.dirname(record.path);
    while (directory !== '.') {
      const directoryIdentity = directory.normalize('NFC').toLowerCase();
      const existing = declaredDirectories.get(directoryIdentity);
      if (existing && existing !== directory) fail('INVALID_PORTABLE_PROJECT', 'The portable project manifest contains duplicate directory paths.');
      declaredDirectories.set(directoryIdentity, directory);
      directory = path.posix.dirname(directory);
    }
  }
  for (const identity of declaredFiles.keys()) {
    if (declaredDirectories.has(identity)) fail('INVALID_PORTABLE_PROJECT', 'The portable project uses the same path as a file and directory.');
  }
  return { declaredFiles, declaredDirectories };
}

function validateManifest(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.format !== PORTABLE_FORMAT || value.containerVersion !== CONTAINER_VERSION || value.project !== PROJECT_ENTRY) fail('INVALID_PORTABLE_PROJECT', 'The selected file is not a supported Live2Pet portable project.');
  if (!value.source || !['file', 'directory'].includes(value.source.type) || !safeEntryPath(value.source.entry) || (value.source.entry !== 'source' && !value.source.entry.startsWith('source/'))) fail('INVALID_PORTABLE_PROJECT', 'The portable project source entry is invalid.');
  if (!Array.isArray(value.files) || value.files.length < 2 || value.files.length > MAX_PORTABLE_FILES + 1) fail('INVALID_PORTABLE_PROJECT', 'The portable project file list is invalid.');
  const seen = new Set();
  let total = 0;
  for (const record of value.files) {
    if (!record || typeof record !== 'object' || !safeEntryPath(record.path) || !Number.isSafeInteger(record.size) || record.size < 0 || !/^[a-f0-9]{64}$/.test(record.sha256)) fail('INVALID_PORTABLE_PROJECT', 'The portable project contains invalid file metadata.');
    if (record.path !== PROJECT_ENTRY && !record.path.startsWith('source/')) fail('INVALID_PORTABLE_PROJECT', 'The portable project contains a file outside its source directory.');
    const identity = record.path.normalize('NFC').toLowerCase();
    if (seen.has(identity)) fail('INVALID_PORTABLE_PROJECT', 'The portable project contains duplicate cross-platform paths.');
    seen.add(identity);
    total += record.size;
    if (total > MAX_PORTABLE_BYTES + 2 * 1024 * 1024) fail('PORTABLE_SOURCE_TOO_LARGE', 'The portable project expands beyond the supported size.');
  }
  if (!seen.has(PROJECT_ENTRY)) fail('INVALID_PORTABLE_PROJECT', 'The portable project is missing project.l2p metadata.');
  const sourceIdentity = value.source.entry.normalize('NFC').toLowerCase();
  if (value.source.type === 'file' && !seen.has(sourceIdentity)) fail('INVALID_PORTABLE_PROJECT', 'The portable project source file is not declared in its manifest.');
  if (value.source.type === 'directory' && ![...seen].some((entry) => entry.startsWith(`${sourceIdentity}/`))) fail('INVALID_PORTABLE_PROJECT', 'The portable project source directory is empty in its manifest.');
  const sourcePrefix = `${value.source.entry}/`;
  for (const record of value.files) {
    if (record.path === PROJECT_ENTRY) continue;
    if (value.source.type === 'file' ? record.path !== value.source.entry : !record.path.startsWith(sourcePrefix)) {
      fail('INVALID_PORTABLE_PROJECT', 'The portable project contains a file outside its declared source.');
    }
  }
  manifestInventory(value);
  return value;
}

async function readArchive(reader) {
  const entries = await reader.getEntries();
  if (entries.length > MAX_PORTABLE_FILES + 2) fail('INVALID_PORTABLE_PROJECT', 'The portable project contains too many archive entries.');
  const byName = new Map();
  for (const entry of entries) {
    if (entry.directory) continue;
    if (!safeEntryPath(entry.filename)) fail('INVALID_PORTABLE_PROJECT', 'The portable project contains an unsafe path.');
    const identity = entry.filename.normalize('NFC').toLowerCase();
    if (byName.has(identity)) fail('INVALID_PORTABLE_PROJECT', 'The portable project contains duplicate cross-platform paths.');
    const unixType = (entry.externalFileAttributes >>> 16) & 0o170000;
    if (unixType === 0o120000) fail('INVALID_PORTABLE_PROJECT', 'The portable project contains a symbolic link.');
    byName.set(identity, entry);
  }
  const manifestEntry = byName.get(MANIFEST_ENTRY);
  if (!manifestEntry?.getData || !Number.isSafeInteger(manifestEntry.uncompressedSize) || manifestEntry.uncompressedSize > MAX_PORTABLE_MANIFEST_BYTES) {
    fail('INVALID_PORTABLE_PROJECT', 'The portable project manifest is missing or too large.');
  }
  let manifest;
  try {
    manifest = validateManifest(JSON.parse(await manifestEntry.getData(new zip.TextWriter())));
  } catch (error) {
    if (error instanceof PortableProjectError) throw error;
    fail('INVALID_PORTABLE_PROJECT', 'The portable project manifest is not valid JSON.');
  }
  const declaredEntries = new Set([MANIFEST_ENTRY, ...manifest.files.map((record) => record.path.normalize('NFC').toLowerCase())]);
  for (const identity of byName.keys()) if (!declaredEntries.has(identity)) fail('INVALID_PORTABLE_PROJECT', 'The portable project contains an undeclared file.');
  for (const record of manifest.files) {
    const entry = byName.get(record.path.normalize('NFC').toLowerCase());
    if (!entry?.getData || entry.uncompressedSize !== record.size) fail('INVALID_PORTABLE_PROJECT', `The portable project is missing or has changed: ${record.path}`);
  }
  return { byName, manifest };
}

async function validateProjectSource(project, manifest, root) {
  const expectedSource = resolveContainedEntry(root, manifest.source.entry);
  await rejectSymlinkComponents(root, expectedSource);
  if (typeof project?.source?.path !== 'string' || path.resolve(project.source.path) !== expectedSource) {
    fail('INVALID_PORTABLE_PROJECT', 'The embedded project does not point to its packaged source.');
  }
  if (project.source.location && (project.source.location.type !== 'relative' || project.source.location.path !== manifest.source.entry)) {
    fail('INVALID_PORTABLE_PROJECT', 'The embedded project source location is invalid.');
  }
  const sourceStat = await fsp.lstat(expectedSource).catch(() => null);
  if (!sourceStat || sourceStat.isSymbolicLink() || (manifest.source.type === 'directory' ? !sourceStat.isDirectory() : !sourceStat.isFile())) {
    fail('INVALID_PORTABLE_PROJECT', 'The packaged source type does not match its manifest.');
  }
  return project;
}

async function validateCachedProject(destination, ready, archiveHash, manifest) {
  let destinationStat;
  try { destinationStat = await fsp.lstat(destination); } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
  if (!destinationStat.isDirectory() || destinationStat.isSymbolicLink()) fail('INVALID_PORTABLE_PROJECT', 'The portable project working copy is invalid.');
  let marker;
  try { marker = await fsp.readFile(ready, 'utf8'); } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
  const readyStat = await fsp.lstat(ready).catch(() => null);
  if (!readyStat?.isFile() || marker.trim() !== archiveHash) fail('INVALID_PORTABLE_PROJECT', 'The portable project working copy is not trusted.');
  const { declaredFiles, declaredDirectories } = manifestInventory(manifest);
  const seen = new Set();
  async function inspectCache(directory, relativeDirectory = '') {
    const entries = await fsp.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const relative = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
      const current = path.join(directory, entry.name);
      if (!relativeDirectory && entry.name === '.ready') continue;
      if (entry.isSymbolicLink()) fail('INVALID_PORTABLE_PROJECT', 'The portable project working copy contains a symbolic link.');
      const identity = relative.normalize('NFC').toLowerCase();
      if (seen.has(identity)) fail('INVALID_PORTABLE_PROJECT', 'The portable project working copy contains duplicate cross-platform paths.');
      seen.add(identity);
      if (entry.isDirectory()) {
        if (declaredDirectories.get(identity) !== relative) fail('INVALID_PORTABLE_PROJECT', 'The portable project working copy contains an undeclared directory.');
        await inspectCache(current, relative);
      } else if (entry.isFile()) {
        if (declaredFiles.get(identity) !== relative) fail('INVALID_PORTABLE_PROJECT', 'The portable project working copy contains an undeclared file.');
      } else {
        fail('INVALID_PORTABLE_PROJECT', 'The portable project working copy contains an invalid entry.');
      }
    }
  }
  await inspectCache(destination);
  for (const record of manifest.files) {
    const outputPath = resolveContainedEntry(destination, record.path);
    await rejectSymlinkComponents(destination, outputPath);
    const stat = await fsp.lstat(outputPath).catch(() => null);
    if (!stat || !stat.isFile() || stat.isSymbolicLink() || stat.size !== record.size || await sha256File(outputPath) !== record.sha256) {
      fail('INVALID_PORTABLE_PROJECT', `Portable project checksum failed: ${record.path}`);
    }
  }
  const project = parseProject(await fsp.readFile(path.join(destination, PROJECT_ENTRY), 'utf8'), { baseDirectory: destination });
  return validateProjectSource(project, manifest, destination);
}

function destinationExistsError(error) {
  return error?.code === 'EEXIST' || error?.code === 'ENOTEMPTY';
}

async function openPortableProject(filePath, workspaceRoot) {
  if (typeof workspaceRoot !== 'string' || !path.isAbsolute(workspaceRoot)) throw new TypeError('A portable project workspace root is required.');
  const absolute = path.resolve(filePath);
  const archiveHash = await sha256File(absolute);
  const destination = path.join(workspaceRoot, archiveHash);
  const ready = path.join(destination, '.ready');
  const readerSource = await archiveReader(absolute);
  const reader = new zip.ZipReader(readerSource);
  const staging = `${destination}.${process.pid}.${crypto.randomUUID()}.tmp`;
  let stagingPublished = false;
  try {
    const { byName, manifest } = await readArchive(reader);
    const cached = await validateCachedProject(destination, ready, archiveHash, manifest);
    if (cached) return cached;

    await fsp.mkdir(staging, { recursive: true, mode: 0o700 });
    for (const record of manifest.files) {
      const entry = byName.get(record.path.normalize('NFC').toLowerCase());
      const outputPath = resolveContainedEntry(staging, record.path);
      await fsp.mkdir(path.dirname(outputPath), { recursive: true, mode: 0o700 });
      await entry.getData(fileWriter(outputPath));
      if (await sha256File(outputPath) !== record.sha256) fail('INVALID_PORTABLE_PROJECT', `Portable project checksum failed: ${record.path}`);
    }
    const project = parseProject(await fsp.readFile(path.join(staging, PROJECT_ENTRY), 'utf8'), { baseDirectory: staging });
    await validateProjectSource(project, manifest, staging);
    await fsp.writeFile(path.join(staging, '.ready'), `${archiveHash}\n`, { mode: 0o600, flag: 'wx' });
    await fsp.mkdir(workspaceRoot, { recursive: true, mode: 0o700 });
    let published = false;
    let renameError = null;
    try {
      await fsp.rename(staging, destination);
      published = true;
      stagingPublished = true;
    } catch (error) {
      renameError = error;
    }
    if (!published) {
      let concurrent;
      try {
        concurrent = await validateCachedProject(destination, ready, archiveHash, manifest);
      } catch (error) {
        if (!destinationExistsError(renameError)) throw renameError;
        throw error;
      }
      if (!concurrent) {
        if (!destinationExistsError(renameError)) throw renameError;
        fail('INVALID_PORTABLE_PROJECT', 'The portable project working copy could not be published.');
      }
      return concurrent;
    }
    return validateProjectSource(parseProject(await fsp.readFile(path.join(destination, PROJECT_ENTRY), 'utf8'), { baseDirectory: destination }), manifest, destination);
  } catch (error) {
    if (error instanceof PortableProjectError || error?.name === 'ProjectValidationError') throw error;
    fail('PORTABLE_OPEN_FAILED', `The portable project could not be opened: ${error?.message || error}`);
  } finally {
    if (!stagingPublished) {
      try { await fsp.rm(staging, { recursive: true, force: true }); } catch {}
    }
    await reader.close().catch(() => {});
    await readerSource.close();
  }
}

module.exports = {
  CONTAINER_VERSION,
  PORTABLE_FORMAT,
  PortableProjectError,
  openPortableProject,
  savePortableProject,
};
