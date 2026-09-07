const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const LIBRARY_SCHEMA_VERSION = 1;
const CACHE_SETTINGS_SCHEMA_VERSION = 1;
const MAX_LIBRARIES = 8;
const MAX_REMOTE_FILES = 10000;
const DEFAULT_GITHUB_CACHE_BYTES = 1024 * 1024 * 1024;
const MIN_GITHUB_CACHE_BYTES = 256 * 1024 * 1024;
const MAX_GITHUB_CACHE_BYTES = 20 * 1024 * 1024 * 1024;
const MAX_REMOTE_MODEL_BYTES = 4 * 1024 * 1024 * 1024;

class SourceLibraryError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'SourceLibraryError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details = {}) { throw new SourceLibraryError(code, message, details); }
function digest(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function isRecord(value) { return Boolean(value && typeof value === 'object' && !Array.isArray(value)); }
function safeSegment(value, label) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9._-]+$/.test(value) || value === '.' || value === '..') fail('INVALID_GITHUB_URL', `GitHub ${label} is invalid.`);
  return value;
}
function safeRelative(value) {
  const normalized = String(value || '').replaceAll('\\', '/').replace(/^\/+|\/+$/g, '');
  if (!normalized) return '';
  const segments = normalized.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..' || segment.includes('\0'))) fail('INVALID_GITHUB_URL', 'GitHub folder path is invalid.');
  return segments.join('/');
}

function directoryBytes(root) {
  let total = 0;
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile()) total += fs.statSync(absolute).size;
    }
  };
  try { visit(root); } catch {}
  return total;
}

function githubCacheEntries(root) {
  const entries = [];
  let total = 0;
  try {
    for (const repository of fs.readdirSync(root, { withFileTypes: true })) {
      if (!repository.isDirectory()) continue;
      const repositoryRoot = path.join(root, repository.name);
      for (const source of fs.readdirSync(repositoryRoot, { withFileTypes: true })) {
        if (!source.isDirectory() || source.name.endsWith('.tmp')) continue;
        const absolute = path.join(repositoryRoot, source.name);
        const bytes = directoryBytes(absolute);
        let accessedAt = 0;
        try { accessedAt = fs.statSync(path.join(absolute, '.live2pet-source-ready')).mtimeMs; } catch {}
        entries.push({ absolute, bytes, accessedAt });
        total += bytes;
      }
    }
  } catch {}
  return { entries, byteLength: total };
}

function pruneGithubCache(root, requiredBytes, protectedPath = null, maxBytes = DEFAULT_GITHUB_CACHE_BYTES) {
  const snapshot = githubCacheEntries(root);
  let total = snapshot.byteLength;
  for (const entry of snapshot.entries.sort((left, right) => left.accessedAt - right.accessedAt)) {
    if (total + requiredBytes <= maxBytes) break;
    if (protectedPath && path.resolve(entry.absolute) === path.resolve(protectedPath)) continue;
    fs.rmSync(entry.absolute, { recursive: true, force: true });
    total -= entry.bytes;
  }
  if (total + requiredBytes > maxBytes) fail('GITHUB_CACHE_FULL', 'The selected model does not fit within the configured GitHub model cache. Increase the cache limit or choose a smaller model.');
  return { byteLength: total, maxBytes };
}

function normalizeCacheLimit(value) {
  const bytes = Number(value);
  if (!Number.isSafeInteger(bytes) || bytes < MIN_GITHUB_CACHE_BYTES || bytes > MAX_GITHUB_CACHE_BYTES) fail('INVALID_GITHUB_CACHE_LIMIT', 'GitHub model cache limit must be between 256 MiB and 20 GiB.');
  return bytes;
}

function loadCacheLimit(settingsFile) {
  try {
    const value = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
    if (value?.schemaVersion === CACHE_SETTINGS_SCHEMA_VERSION) return normalizeCacheLimit(value.maxBytes);
  } catch {}
  return DEFAULT_GITHUB_CACHE_BYTES;
}

function saveCacheLimit(settingsFile, maxBytes) {
  fs.mkdirSync(path.dirname(settingsFile), { recursive: true, mode: 0o700 });
  const temporary = `${settingsFile}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, `${JSON.stringify({ schemaVersion: CACHE_SETTINGS_SCHEMA_VERSION, maxBytes }, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    fs.renameSync(temporary, settingsFile);
  } catch (error) {
    try { fs.unlinkSync(temporary); } catch {}
    throw error;
  }
}

function parseGitHubTreeUrl(value) {
  let url;
  try { url = new URL(value); } catch { fail('INVALID_GITHUB_URL', 'Enter a public GitHub repository or folder URL.'); }
  if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== 'github.com' || url.username || url.password || url.search || url.hash) fail('INVALID_GITHUB_URL', 'Only public https://github.com repository and folder URLs are supported.');
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts.length < 2) fail('INVALID_GITHUB_URL', 'GitHub URL must contain an owner and repository.');
  const owner = safeSegment(parts[0], 'owner');
  const repo = safeSegment(parts[1].replace(/\.git$/i, ''), 'repository');
  if (parts.length === 2) return { owner, repo, ref: null, folder: '' };
  if (parts[2] !== 'tree' || parts.length < 4) fail('INVALID_GITHUB_URL', 'Use a GitHub repository URL or a /tree/<branch>/<folder> URL.');
  let ref;
  let folder;
  try {
    ref = safeSegment(decodeURIComponent(parts[3]), 'branch');
    folder = safeRelative(parts.slice(4).map(decodeURIComponent).join('/'));
  } catch (error) {
    if (error instanceof SourceLibraryError) throw error;
    fail('INVALID_GITHUB_URL', 'GitHub URL contains invalid path encoding.');
  }
  return { owner, repo, ref, folder };
}

function publicCandidate(candidate) {
  return {
    id: candidate.id,
    name: candidate.name,
    relativePath: candidate.relativePath,
    format: candidate.format,
    version: candidate.version || null,
    runtimeLine: candidate.runtimeLine || null,
    binary: candidate.binary === true,
  };
}

function remoteCandidates(entries, maxDepth) {
  const blobs = entries.filter((entry) => entry?.type === 'blob' && typeof entry.path === 'string');
  const names = new Set(blobs.map((entry) => entry.path.toLowerCase()));
  const candidates = [];
  const add = (entry, format, binary = false) => {
    const relativePath = safeRelative(entry.path);
    const depth = relativePath.split('/').length - 1;
    if (depth > maxDepth) return;
    const basename = path.posix.basename(relativePath);
    const parent = path.posix.basename(path.posix.dirname(relativePath));
    const name = basename.toLowerCase() === 'model.json'
      ? parent
      : basename.replace(/\.model3\.json$|\.json$|\.skel$|\.pck$/i, '');
    candidates.push({
      id: digest(`${format}\0${relativePath}`).slice(0, 24),
      name,
      relativePath,
      format,
      version: null,
      runtimeLine: null,
      binary,
      modelConfig: format === 'live2d-pck' ? null : basename,
    });
  };
  for (const entry of blobs) {
    const lower = entry.path.toLowerCase();
    if (lower.endsWith('.pck')) add(entry, 'live2d-pck');
    else if (lower.endsWith('.model3.json') || lower.endsWith('/model.json') || lower === 'model.json') add(entry, 'live2d');
    else if (lower.endsWith('.skel') && names.has(`${lower.slice(0, -5)}.atlas`)) add(entry, 'spine', true);
    else if (lower.endsWith('.json') && names.has(`${lower.slice(0, -5)}.atlas`)) add(entry, 'spine');
  }
  return candidates.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

async function fetchJson(fetchImpl, url) {
  const response = await fetchImpl(url, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Live2Pet' }, redirect: 'follow' });
  if (!response?.ok || typeof response.json !== 'function') fail('GITHUB_REQUEST_FAILED', 'GitHub could not provide this repository folder.', { status: response?.status || null });
  return response.json();
}

function createSourceLibraryService({ showOpenDialog, discoverSources, inspectSource, githubCacheRoot, cacheSettingsFile = path.join(githubCacheRoot || '', 'cache-settings.json'), fetchImpl = globalThis.fetch, maxDepth = 2 } = {}) {
  if (typeof showOpenDialog !== 'function' || typeof discoverSources !== 'function' || typeof inspectSource !== 'function') throw new TypeError('Source library service requires dialog, discovery, and inspection dependencies.');
  if (typeof githubCacheRoot !== 'string' || !path.isAbsolute(githubCacheRoot)) throw new TypeError('Source library GitHub cache root must be absolute.');
  if (typeof cacheSettingsFile !== 'string' || !path.isAbsolute(cacheSettingsFile)) throw new TypeError('Source library cache settings path must be absolute.');
  const libraries = new Map();
  let maxCacheBytes = loadCacheLimit(cacheSettingsFile);
  const cacheStatus = () => {
    const snapshot = githubCacheEntries(githubCacheRoot);
    return { schemaVersion: CACHE_SETTINGS_SCHEMA_VERSION, maxBytes: maxCacheBytes, byteLength: snapshot.byteLength, entryCount: snapshot.entries.length };
  };
  const register = (record) => {
    libraries.set(record.id, record);
    while (libraries.size > MAX_LIBRARIES) libraries.delete(libraries.keys().next().value);
    return { schemaVersion: LIBRARY_SCHEMA_VERSION, libraryId: record.id, name: record.name, kind: record.kind, maxDepth, candidates: record.candidates.map(publicCandidate) };
  };
  const localRecord = (root) => {
    const discovered = discoverSources(root, { maxDepth });
    return {
      id: crypto.randomUUID(),
      kind: 'local',
      name: discovered.name,
      candidates: discovered.candidates,
    };
  };
  const githubTree = async (input) => {
    if (typeof fetchImpl !== 'function') fail('GITHUB_UNAVAILABLE', 'This App runtime cannot access public GitHub repositories.');
    const parsed = parseGitHubTreeUrl(input);
    let ref = parsed.ref;
    if (!ref) {
      const repository = await fetchJson(fetchImpl, `https://api.github.com/repos/${parsed.owner}/${parsed.repo}`);
      ref = safeSegment(repository.default_branch, 'default branch');
    }
    let treeSha = ref;
    if (parsed.folder) {
      const content = await fetchJson(fetchImpl, `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/contents/${parsed.folder.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(ref)}`);
      if (!isRecord(content) || content.type !== 'dir' || typeof content.sha !== 'string') fail('GITHUB_FOLDER_NOT_FOUND', 'The GitHub URL does not point to a repository folder.');
      treeSha = content.sha;
    }
    const tree = await fetchJson(fetchImpl, `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/git/trees/${encodeURIComponent(treeSha)}?recursive=1`);
    if (!isRecord(tree) || !Array.isArray(tree.tree)) fail('INVALID_GITHUB_TREE', 'GitHub returned an invalid repository tree.');
    if (tree.truncated === true) fail('GITHUB_TREE_TOO_LARGE', 'This GitHub folder is too large to browse as one model library. Choose a more specific /tree/ folder URL.');
    return { ...parsed, ref, treeSha: tree.sha || treeSha, entries: tree.tree };
  };
  const materializeRemote = async (library, candidate) => {
    const key = digest(`${library.owner}\0${library.repo}\0${library.ref}\0${library.folder}\0${library.treeSha}\0${candidate.relativePath}`);
    const destination = path.join(githubCacheRoot, `${library.owner}-${library.repo}`, key);
    const ready = path.join(destination, '.live2pet-source-ready');
    if (fs.existsSync(ready)) {
      const now = new Date();
      try { fs.utimesSync(ready, now, now); } catch {}
      return candidate.format === 'live2d-pck' ? path.join(destination, path.posix.basename(candidate.relativePath)) : destination;
    }
    const candidateDirectory = path.posix.dirname(candidate.relativePath) === '.' ? '' : path.posix.dirname(candidate.relativePath);
    const nestedProjectDirectories = library.candidates
      .filter((other) => other.id !== candidate.id)
      .map((other) => path.posix.dirname(other.relativePath) === '.' ? '' : path.posix.dirname(other.relativePath))
      .filter((directory) => directory && directory.startsWith(candidateDirectory ? `${candidateDirectory}/` : ''));
    const selected = library.entries.filter((entry) => {
      if (entry?.type !== 'blob' || typeof entry.path !== 'string') return false;
      const relative = safeRelative(entry.path);
      if (candidate.format === 'live2d-pck') return relative === candidate.relativePath;
      if (candidateDirectory && relative !== candidateDirectory && !relative.startsWith(`${candidateDirectory}/`)) return false;
      return !nestedProjectDirectories.some((directory) => relative.startsWith(`${directory}/`));
    });
    if (!selected.length || selected.length > MAX_REMOTE_FILES) fail('REMOTE_SOURCE_TOO_LARGE', `The selected model contains an unsupported number of files (maximum ${MAX_REMOTE_FILES}).`);
    const declaredBytes = selected.reduce((total, entry) => total + (Number.isSafeInteger(entry.size) ? entry.size : 0), 0);
    const modelLimit = Math.min(maxCacheBytes, MAX_REMOTE_MODEL_BYTES);
    if (declaredBytes > modelLimit) fail('REMOTE_SOURCE_TOO_LARGE', 'The selected model exceeds the configured cache limit or the 4 GiB per-model safety limit.');
    fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
    pruneGithubCache(githubCacheRoot, declaredBytes, destination, maxCacheBytes);
    if (fs.existsSync(destination)) fs.rmSync(destination, { recursive: true, force: true });
    const staging = `${destination}.${process.pid}.${crypto.randomUUID()}.tmp`;
    fs.mkdirSync(staging, { mode: 0o700 });
    try {
      let receivedBytes = 0;
      for (const entry of selected) {
        const repositoryPath = [library.folder, entry.path].filter(Boolean).join('/');
        const rawUrl = `https://raw.githubusercontent.com/${library.owner}/${library.repo}/${encodeURIComponent(library.ref)}/${repositoryPath.split('/').map(encodeURIComponent).join('/')}`;
        const response = await fetchImpl(rawUrl, { redirect: 'follow' });
        if (!response?.ok || typeof response.arrayBuffer !== 'function') fail('GITHUB_DOWNLOAD_FAILED', `Could not download ${entry.path}.`, { status: response?.status || null });
        const bytes = Buffer.from(await response.arrayBuffer());
        receivedBytes += bytes.byteLength;
        if (receivedBytes > modelLimit) fail('REMOTE_SOURCE_TOO_LARGE', 'The selected model exceeded the configured cache limit or the 4 GiB per-model safety limit.');
        const relativeToModel = candidateDirectory ? path.posix.relative(candidateDirectory, entry.path) : entry.path;
        const target = path.join(staging, safeRelative(relativeToModel));
        fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
        fs.writeFileSync(target, bytes, { mode: 0o600, flag: 'wx' });
      }
      fs.writeFileSync(path.join(staging, '.live2pet-source-ready'), `${library.owner}/${library.repo}@${library.ref}\n`, { mode: 0o600, flag: 'wx' });
      fs.renameSync(staging, destination);
    } catch (error) {
      try { fs.rmSync(staging, { recursive: true, force: true }); } catch {}
      throw error;
    }
    return candidate.format === 'live2d-pck' ? path.join(destination, path.posix.basename(candidate.relativePath)) : destination;
  };
  return Object.freeze({
    openLocal: async () => {
      const selected = await showOpenDialog({ title: 'Choose model library folder', properties: ['openDirectory'] });
      if (selected?.canceled || !selected?.filePaths?.[0]) return { cancelled: true };
      return { cancelled: false, library: register(localRecord(selected.filePaths[0])) };
    },
    openGitHub: async ({ url } = {}) => {
      const remote = await githubTree(url);
      const candidates = remoteCandidates(remote.entries, maxDepth);
      const record = { id: crypto.randomUUID(), kind: 'github', name: `${remote.owner}/${remote.repo}${remote.folder ? `/${remote.folder}` : ''}`, candidates, ...remote };
      return { cancelled: false, library: register(record) };
    },
    inspect: async ({ libraryId, sourceId, projectId } = {}) => {
      const library = libraries.get(libraryId);
      if (!library) fail('SOURCE_LIBRARY_EXPIRED', 'Reopen the model library before selecting a model.');
      const candidate = library.candidates.find((entry) => entry.id === sourceId);
      if (!candidate) fail('SOURCE_LIBRARY_ITEM_NOT_FOUND', 'The selected model is no longer present in this library.');
      const inputPath = library.kind === 'github' ? await materializeRemote(library, candidate) : candidate.inputPath;
      const manifest = await inspectSource({ inputPath, projectId, ...(candidate.modelConfig ? { modelConfig: candidate.modelConfig } : {}) });
      return { candidate: publicCandidate({ ...candidate, version: manifest.model?.spineVersion || candidate.version, runtimeLine: manifest.model?.runtimeLine || candidate.runtimeLine }), inspection: manifest };
    },
    getCacheStatus: async () => cacheStatus(),
    configureCache: async ({ maxBytes } = {}) => {
      maxCacheBytes = normalizeCacheLimit(maxBytes);
      saveCacheLimit(cacheSettingsFile, maxCacheBytes);
      pruneGithubCache(githubCacheRoot, 0, null, maxCacheBytes);
      return cacheStatus();
    },
    clearCache: async ({ confirmClear } = {}) => {
      if (confirmClear !== true) fail('CACHE_CLEAR_AUTHORIZATION_REQUIRED', 'Clearing downloaded GitHub models requires explicit confirmation.');
      const before = cacheStatus();
      fs.rmSync(githubCacheRoot, { recursive: true, force: true });
      return { ...cacheStatus(), removedEntries: before.entryCount, removedBytes: before.byteLength };
    },
  });
}

module.exports = { CACHE_SETTINGS_SCHEMA_VERSION, DEFAULT_GITHUB_CACHE_BYTES, LIBRARY_SCHEMA_VERSION, MAX_GITHUB_CACHE_BYTES, MAX_REMOTE_MODEL_BYTES, MIN_GITHUB_CACHE_BYTES, SourceLibraryError, createSourceLibraryService, parseGitHubTreeUrl, pruneGithubCache, remoteCandidates };
