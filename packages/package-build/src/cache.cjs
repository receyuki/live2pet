const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const CACHE_SCHEMA_VERSION = 1;
const DEFAULT_CACHE_LIMIT = 5 * 1024 * 1024 * 1024;
const MAX_CACHE_KEY_BYTES = 16 * 1024;
const MAX_CACHE_METADATA_BYTES = 128 * 1024;
const PROJECT_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,95}$/i;
const KEY_FIELDS = Object.freeze([
  'sourceFingerprint',
  'runtimeVersion',
  'rendererVersion',
  'recipe',
  'targetProfile',
  'targetVersion',
  'renderPreset',
  'artifact',
]);

class CacheError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'CacheError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details = {}) {
  throw new CacheError(code, message, details);
}

function stableValue(value, label = 'value') {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail('INVALID_CACHE_KEY', `${label} must contain only finite numbers.`);
    return value;
  }
  if (Array.isArray(value)) return value.map((item, index) => stableValue(item, `${label}[${index}]`));
  if (typeof value === 'object') {
    if (Buffer.isBuffer(value) || ArrayBuffer.isView(value) || value instanceof ArrayBuffer) fail('INVALID_CACHE_KEY', `${label} cannot contain binary data.`);
    const result = {};
    for (const key of Object.keys(value).sort()) {
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') fail('INVALID_CACHE_KEY', `${label} contains an unsafe field.`);
      result[key] = stableValue(value[key], `${label}.${key}`);
    }
    return result;
  }
  if (value === undefined) return null;
  fail('INVALID_CACHE_KEY', `${label} contains an unsupported value.`);
}

function stableStringify(value, label = 'value') {
  return JSON.stringify(stableValue(value, label));
}

function safeText(value, label, { max = 256 } = {}) {
  if (typeof value !== 'string' || !value.trim() || value.length > max || value.includes('\0')) {
    fail('INVALID_CACHE_KEY', `${label} must be a non-empty text value (maximum ${max} characters).`);
  }
  return value.trim();
}

function normalizeCacheKey(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('INVALID_CACHE_KEY', 'Cache identity must be an object.');
  const identity = {};
  for (const field of KEY_FIELDS) {
    if (field === 'recipe') {
      if (input.recipe === undefined) fail('INVALID_CACHE_KEY', 'Cache identity is missing recipe.');
      identity.recipe = stableValue(input.recipe, 'recipe');
      continue;
    }
    identity[field] = safeText(input[field], `Cache identity ${field}`);
  }
  const canonical = stableStringify({ schemaVersion: CACHE_SCHEMA_VERSION, ...identity }, 'cache identity');
  if (Buffer.byteLength(canonical, 'utf8') > MAX_CACHE_KEY_BYTES) fail('INVALID_CACHE_KEY', `Cache identity exceeds the ${MAX_CACHE_KEY_BYTES}-byte limit.`);
  const digest = crypto.createHash('sha256').update(canonical).digest('hex');
  return { digest, identity, canonical };
}

function normalizeBytes(value, label = 'Cache value') {
  if (Buffer.isBuffer(value)) return Buffer.from(value);
  if (value instanceof Uint8Array) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  if (ArrayBuffer.isView(value)) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  fail('INVALID_CACHE_VALUE', `${label} must be a byte buffer.`);
}

function digestBytes(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function summaryFromMetadata(metadata) {
  return {
    key: metadata.key,
    byteLength: metadata.byteLength,
    sha256: metadata.sha256,
    ...(metadata.projectId ? { projectId: metadata.projectId } : {}),
    sourceFingerprint: metadata.sourceFingerprint,
    artifact: metadata.artifact,
    createdAt: metadata.createdAt,
    accessedAt: metadata.accessedAt,
  };
}

function parseMetadata(filePath) {
  let parsed;
  try {
    const stat = fs.statSync(filePath);
    if (stat.size > MAX_CACHE_METADATA_BYTES) return null;
    parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
  if (!parsed || parsed.schemaVersion !== CACHE_SCHEMA_VERSION || parsed.complete !== true || typeof parsed.keyDigest !== 'string' || typeof parsed.byteLength !== 'number' || parsed.byteLength < 0 || typeof parsed.sha256 !== 'string' || typeof parsed.key !== 'object') return null;
  return parsed;
}

function timestamp() {
  return new Date().toISOString();
}

class CacheStore {
  constructor({ rootDir, maxBytes = DEFAULT_CACHE_LIMIT } = {}) {
    if (typeof rootDir !== 'string' || !rootDir.trim()) fail('INVALID_CACHE_PATH', 'A cache directory is required.');
    const resolved = path.resolve(rootDir);
    if (resolved === path.parse(resolved).root) fail('INVALID_CACHE_PATH', 'The cache directory cannot be a filesystem root.');
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) fail('INVALID_CACHE_LIMIT', 'Cache maxBytes must be a positive safe integer.');
    this.rootDir = resolved;
    this.maxBytes = maxBytes;
    fs.mkdirSync(this.rootDir, { recursive: true, mode: 0o700 });
  }

  paths(digest) {
    if (!/^[a-f0-9]{64}$/.test(digest)) fail('INVALID_CACHE_KEY', 'Cache digest must be a SHA-256 hex digest.');
    return {
      bytes: path.join(this.rootDir, `${digest}.bin`),
      metadata: path.join(this.rootDir, `${digest}.json`),
    };
  }

  removeFiles(digest) {
    const files = this.paths(digest);
    for (const file of [files.bytes, files.metadata]) {
      try { fs.unlinkSync(file); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
  }

  removeOrphans() {
    let entries;
    try { entries = fs.readdirSync(this.rootDir); } catch { return; }
    for (const name of entries) {
      if (name.endsWith('.tmp') || name.endsWith('.bin') || name.endsWith('.json')) {
        const digest = name.replace(/\.(?:tmp|bin|json)$/, '');
        if (!/^[a-f0-9]{64}$/.test(digest) || !fs.existsSync(path.join(this.rootDir, `${digest}.json`)) || !fs.existsSync(path.join(this.rootDir, `${digest}.bin`))) {
          try { fs.unlinkSync(path.join(this.rootDir, name)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
        }
      }
    }
  }

  readMetadata() {
    this.removeOrphans();
    let names;
    try { names = fs.readdirSync(this.rootDir); } catch { return []; }
    const results = [];
    for (const name of names.filter((entry) => entry.endsWith('.json')).sort()) {
      const digest = name.slice(0, -5);
      if (!/^[a-f0-9]{64}$/.test(digest)) continue;
      const metadataPath = path.join(this.rootDir, name);
      const metadata = parseMetadata(metadataPath);
      if (!metadata || metadata.keyDigest !== digest) {
        this.removeFiles(digest);
        continue;
      }
      const dataPath = path.join(this.rootDir, `${digest}.bin`);
      let stat;
      try { stat = fs.statSync(dataPath); } catch { this.removeFiles(digest); continue; }
      if (stat.size !== metadata.byteLength) {
        this.removeFiles(digest);
        continue;
      }
      results.push({ metadata, dataPath });
    }
    return results;
  }

  writeJsonAtomic(filePath, value) {
    const temporary = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
    const text = `${JSON.stringify(value)}\n`;
    try {
      fs.writeFileSync(temporary, text, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
      fs.renameSync(temporary, filePath);
    } catch (error) {
      try { fs.unlinkSync(temporary); } catch {}
      throw error;
    }
  }

  evict(requiredBytes, protectedDigest = null) {
    const records = this.readMetadata();
    let totalBytes = records.reduce((total, record) => total + record.metadata.byteLength, 0);
    const evicted = [];
    records
      .filter((record) => record.metadata.keyDigest !== protectedDigest)
      .sort((left, right) => String(left.metadata.accessedAt).localeCompare(String(right.metadata.accessedAt)) || String(left.metadata.createdAt).localeCompare(String(right.metadata.createdAt)))
      .some((record) => {
        if (totalBytes + requiredBytes <= this.maxBytes) return true;
        this.removeFiles(record.metadata.keyDigest);
        totalBytes -= record.metadata.byteLength;
        evicted.push(summaryFromMetadata(record.metadata));
        return false;
      });
    if (totalBytes + requiredBytes > this.maxBytes) fail('CACHE_ENTRY_TOO_LARGE', `Cache entry requires ${requiredBytes} bytes but the ${this.maxBytes}-byte cache limit cannot accommodate it.`, { byteLength: requiredBytes, maxBytes: this.maxBytes, evicted });
    return evicted;
  }

  put(keyInput, value, metadata = {}) {
    const key = keyInput && keyInput.digest && keyInput.identity ? keyInput : normalizeCacheKey(keyInput);
    const bytes = normalizeBytes(value);
    if (bytes.byteLength > this.maxBytes) fail('CACHE_ENTRY_TOO_LARGE', `Cache entry is ${bytes.byteLength} bytes; the maximum cache size is ${this.maxBytes} bytes.`, { byteLength: bytes.byteLength, maxBytes: this.maxBytes });
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) fail('INVALID_CACHE_METADATA', 'Cache metadata must be an object.');
    const projectId = metadata.projectId == null ? undefined : safeText(metadata.projectId, 'Cache metadata projectId', { max: 96 });
    if (projectId && !PROJECT_ID_PATTERN.test(projectId)) fail('INVALID_CACHE_METADATA', 'Cache metadata projectId contains unsafe characters.');
    if (metadata.sourceFingerprint !== undefined && metadata.sourceFingerprint !== key.identity.sourceFingerprint) fail('INVALID_CACHE_METADATA', 'Cache metadata sourceFingerprint must match the cache identity.');
    if (metadata.artifact !== undefined && metadata.artifact !== key.identity.artifact) fail('INVALID_CACHE_METADATA', 'Cache metadata artifact must match the cache identity.');
    const now = timestamp();
    const entry = {
      schemaVersion: CACHE_SCHEMA_VERSION,
      complete: true,
      keyDigest: key.digest,
      key: key.identity,
      byteLength: bytes.byteLength,
      sha256: digestBytes(bytes),
      sourceFingerprint: key.identity.sourceFingerprint,
      artifact: key.identity.artifact,
      ...(projectId ? { projectId } : {}),
      createdAt: now,
      accessedAt: now,
    };
    const files = this.paths(key.digest);
    const existing = parseMetadata(files.metadata);
    if (existing && existing.keyDigest === key.digest) this.removeFiles(key.digest);
    const evicted = this.evict(bytes.byteLength, key.digest);
    const temporaryBytes = `${files.bytes}.${process.pid}.${crypto.randomUUID()}.tmp`;
    try {
      fs.writeFileSync(temporaryBytes, bytes, { mode: 0o600, flag: 'wx' });
      fs.renameSync(temporaryBytes, files.bytes);
      this.writeJsonAtomic(files.metadata, entry);
    } catch (error) {
      try { fs.unlinkSync(temporaryBytes); } catch {}
      this.removeFiles(key.digest);
      throw error;
    }
    return { ...summaryFromMetadata(entry), evicted };
  }

  get(keyInput) {
    const key = keyInput && keyInput.digest && keyInput.identity ? keyInput : normalizeCacheKey(keyInput);
    const files = this.paths(key.digest);
    const metadata = parseMetadata(files.metadata);
    if (!metadata || metadata.keyDigest !== key.digest || stableStringify(metadata.key, 'cache metadata key') !== stableStringify(key.identity, 'cache key')) {
      if (metadata || fs.existsSync(files.bytes) || fs.existsSync(files.metadata)) this.removeFiles(key.digest);
      return null;
    }
    let bytes;
    try { bytes = fs.readFileSync(files.bytes); } catch { this.removeFiles(key.digest); return null; }
    if (bytes.byteLength !== metadata.byteLength || digestBytes(bytes) !== metadata.sha256) {
      this.removeFiles(key.digest);
      return null;
    }
    metadata.accessedAt = timestamp();
    try { this.writeJsonAtomic(files.metadata, metadata); } catch { /* A read remains valid when LRU bookkeeping cannot be written. */ }
    return { data: bytes, ...summaryFromMetadata(metadata) };
  }

  status(filters = {}) {
    const records = this.readMetadata().filter(({ metadata }) => (
      (filters.projectId === undefined || metadata.projectId === filters.projectId)
      && (filters.sourceFingerprint === undefined || metadata.sourceFingerprint === filters.sourceFingerprint)
    ));
    return {
      schemaVersion: CACHE_SCHEMA_VERSION,
      maxBytes: this.maxBytes,
      byteLength: records.reduce((total, record) => total + record.metadata.byteLength, 0),
      entryCount: records.length,
      entries: records.map(({ metadata }) => summaryFromMetadata(metadata)),
    };
  }

  clear(filters = {}) {
    const records = this.readMetadata();
    let removedBytes = 0;
    let removedEntries = 0;
    for (const { metadata } of records) {
      if (filters.projectId !== undefined && metadata.projectId !== filters.projectId) continue;
      if (filters.sourceFingerprint !== undefined && metadata.sourceFingerprint !== filters.sourceFingerprint) continue;
      this.removeFiles(metadata.keyDigest);
      removedBytes += metadata.byteLength;
      removedEntries += 1;
    }
    return { removedEntries, removedBytes, ...this.status() };
  }

  clearAll() {
    return this.clear();
  }
}

module.exports = {
  CACHE_SCHEMA_VERSION,
  CacheError,
  CacheStore,
  DEFAULT_CACHE_LIMIT,
  KEY_FIELDS,
  createCacheKey: normalizeCacheKey,
  normalizeCacheKey,
  stableStringify,
};
