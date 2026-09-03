const { createCacheKey, decodeCaptureSet, encodeCaptureSet } = require('@live2pet/package-build');
const { digestVisualSettings, normalizeVisualSettings } = require('@live2pet/project');

const CAPTURE_CACHE_ARTIFACT = 'captured-rgba';
const CAPTURE_CACHE_TARGET_VERSION = '1';
const DEFAULT_CAPTURE_RENDERER_VERSION = 'pixi-live2d-capture-v5';

function fail(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  throw error;
}

function normalizeRecipe(value, index = 0) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('INVALID_CAPTURE_CACHE_REQUEST', `Capture recipe ${index} must be an object.`);
  const motionId = typeof value.motionId === 'string' && value.motionId.trim() ? value.motionId.trim() : fail('INVALID_CAPTURE_CACHE_REQUEST', `Capture recipe ${index} motionId is required.`);
  const duration = Number(value.duration);
  const width = Number(value.width);
  const height = Number(value.height);
  const frameCount = Number(value.frameCount);
  const fps = Number(value.fps);
  if (!Number.isFinite(duration) || duration < 0 || duration > 3600 || !Number.isInteger(width) || width < 1 || width > 4096 || !Number.isInteger(height) || height < 1 || height > 4096 || !Number.isInteger(frameCount) || frameCount < 1 || frameCount > 4096 || !Number.isFinite(fps) || fps <= 0 || fps > 240) {
    fail('INVALID_CAPTURE_CACHE_REQUEST', `Capture recipe ${index} contains invalid timing or dimensions.`);
  }
  const expressionId = value.expressionId == null ? null : String(value.expressionId).trim();
  if (expressionId !== null && !expressionId) fail('INVALID_CAPTURE_CACHE_REQUEST', `Capture recipe ${index} expressionId cannot be empty.`);
  return { motionId, expressionId, duration, width, height, frameCount, fps };
}

function normalizeContext(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('INVALID_CAPTURE_CACHE_REQUEST', 'Capture cache context must be an object.');
  const sourceFingerprint = typeof input.sourceFingerprint === 'string' && /^[a-f0-9]{64}$/i.test(input.sourceFingerprint.trim()) ? input.sourceFingerprint.trim().toLowerCase() : fail('INVALID_CAPTURE_CACHE_REQUEST', 'Capture cache sourceFingerprint must be a SHA-256 digest.');
  const cubismVersion = Number(input.cubismVersion);
  if (![2, 3, 4, 5].includes(cubismVersion)) fail('INVALID_CAPTURE_CACHE_REQUEST', 'Capture cache cubismVersion must be 2, 3, 4, or 5.');
  const target = input.target === 'codex-pet' ? 'codex-pet' : input.target === 'clawd' ? 'clawd' : fail('INVALID_CAPTURE_CACHE_REQUEST', 'Capture cache target must be clawd or codex-pet.');
  const renderPreset = typeof input.renderPreset === 'string' && ['compact', 'balanced', 'high'].includes(input.renderPreset.trim().toLowerCase()) ? input.renderPreset.trim().toLowerCase() : fail('INVALID_CAPTURE_CACHE_REQUEST', 'Capture cache renderPreset must be compact, balanced, or high.');
  if (!Array.isArray(input.motions) || !input.motions.length || input.motions.length > 2048) fail('INVALID_CAPTURE_CACHE_REQUEST', 'Capture cache motions must be a non-empty array with at most 2048 entries.');
  const motions = input.motions.map(normalizeRecipe);
  const seen = new Set();
  for (const recipe of motions) {
    if (seen.has(recipe.motionId)) fail('INVALID_CAPTURE_CACHE_REQUEST', `Capture cache contains duplicate Motion recipe: ${recipe.motionId}.`);
    seen.add(recipe.motionId);
  }
  const visualSettings = normalizeVisualSettings(input.visualSettings);
  const suppliedDigest = typeof input.visualSettingsDigest === 'string' && /^[a-f0-9]{64}$/i.test(input.visualSettingsDigest.trim()) ? input.visualSettingsDigest.trim().toLowerCase() : null;
  const visualSettingsDigest = visualSettings.hiddenElementIds.length
    ? digestVisualSettings(visualSettings)
    : (input.visualSettings === undefined ? suppliedDigest : null);
  return { sourceFingerprint, cubismVersion, target, renderPreset, motions, visualSettings, ...(visualSettingsDigest ? { visualSettingsDigest } : {}) };
}

function createCaptureCacheService({ cache, getRuntimeForGeneration, rendererVersion = DEFAULT_CAPTURE_RENDERER_VERSION } = {}) {
  if (!cache || typeof cache.get !== 'function' || typeof cache.put !== 'function' || typeof cache.status !== 'function' || typeof cache.clearAll !== 'function') fail('INVALID_CAPTURE_CACHE_SERVICE', 'Capture cache service requires a CacheStore-compatible cache.');
  if (typeof getRuntimeForGeneration !== 'function') fail('INVALID_CAPTURE_CACHE_SERVICE', 'Capture cache service requires a runtime resolver.');
  if (typeof rendererVersion !== 'string' || !rendererVersion.trim()) fail('INVALID_CAPTURE_CACHE_SERVICE', 'Capture cache service requires a renderer version.');

  async function context(input) {
    const normalized = normalizeContext(input);
    let runtime = null;
    try {
      runtime = await getRuntimeForGeneration(normalized.cubismVersion);
    } catch {
      // Capture caching is an acceleration layer. A stale or temporarily
      // unreadable runtime setting must never make an otherwise valid build
      // fail; the caller simply proceeds without a cache hit.
      runtime = null;
    }
    const runtimeVersion = runtime && runtime.descriptor && runtime.descriptor.fingerprint;
    if (typeof runtimeVersion !== 'string' || !/^[a-f0-9]{64}$/i.test(runtimeVersion)) return { ...normalized, runtime: null, runtimeVersion: null };
    return { ...normalized, runtime, runtimeVersion: runtimeVersion.toLowerCase() };
  }

  function identityFor(normalized, recipe, runtimeVersion) {
    return createCacheKey({
      sourceFingerprint: normalized.sourceFingerprint,
      runtimeVersion,
      rendererVersion: rendererVersion.trim(),
      recipe: { ...recipe, captureVersion: 1, ...(normalized.visualSettingsDigest ? { visualSettingsDigest: normalized.visualSettingsDigest } : {}) },
      targetProfile: normalized.target,
      targetVersion: CAPTURE_CACHE_TARGET_VERSION,
      renderPreset: normalized.renderPreset,
      artifact: CAPTURE_CACHE_ARTIFACT,
    });
  }

  function validCachedFrameSet(value, recipe) {
    if (!value || value.motionId !== recipe.motionId || (value.expressionId || null) !== (recipe.expressionId || null) || !Array.isArray(value.frames) || value.frames.length !== recipe.frameCount) return false;
    return value.frames.every((frame) => frame.width === recipe.width && frame.height === recipe.height);
  }

  async function status(input) {
    const normalized = await context(input);
    const entries = normalized.motions.map((recipe) => {
      if (!normalized.runtimeVersion) return { motionId: recipe.motionId, hit: false };
      const identity = identityFor(normalized, recipe, normalized.runtimeVersion);
      const cached = cache.get(identity);
      if (!cached) return { motionId: recipe.motionId, key: identity.digest, hit: false };
      try {
        const frameSet = decodeCaptureSet(cached.data, { inflate: false });
        if (!validCachedFrameSet(frameSet, recipe)) throw new Error('Capture cache metadata does not match the requested recipe.');
        return { motionId: recipe.motionId, key: identity.digest, hit: true, byteLength: cached.byteLength };
      } catch {
        if (typeof cache.removeFiles === 'function') cache.removeFiles(identity.digest);
        return { motionId: recipe.motionId, key: identity.digest, hit: false };
      }
    });
    return { schemaVersion: 1, target: normalized.target, renderPreset: normalized.renderPreset, runtimeAvailable: Boolean(normalized.runtimeVersion), entries };
  }

  function readFromContext(normalized, recipe) {
    if (!normalized.runtimeVersion) return null;
    const identity = identityFor(normalized, recipe, normalized.runtimeVersion);
    const cached = cache.get(identity);
    if (!cached) return null;
    try {
      const frameSet = decodeCaptureSet(cached.data);
      if (!validCachedFrameSet(frameSet, recipe)) throw new Error('Capture cache metadata does not match the requested recipe.');
      return { key: identity.digest, frameSet };
    } catch {
      if (typeof cache.removeFiles === 'function') cache.removeFiles(identity.digest);
      return null;
    }
  }

  async function read(input, recipeInput) {
    const normalized = await context({ ...input, motions: [recipeInput] });
    return readFromContext(normalized, normalized.motions[0]);
  }

  async function readMany(input, recipeInputs) {
    if (!Array.isArray(recipeInputs) || !recipeInputs.length) return {};
    const normalized = await context({ ...input, motions: recipeInputs });
    return Object.fromEntries(normalized.motions.map((recipe) => [recipe.motionId, readFromContext(normalized, recipe)]));
  }

  async function readEncodedMany(input, recipeInputs) {
    if (!Array.isArray(recipeInputs) || !recipeInputs.length) return {};
    const normalized = await context({ ...input, motions: recipeInputs });
    return Object.fromEntries(normalized.motions.map((recipe) => {
      if (!normalized.runtimeVersion) return [recipe.motionId, null];
      const identity = identityFor(normalized, recipe, normalized.runtimeVersion);
      const cached = cache.get(identity);
      if (!cached) return [recipe.motionId, null];
      try {
        const frameSet = decodeCaptureSet(cached.data, { inflate: false });
        if (!validCachedFrameSet(frameSet, recipe)) throw new Error('Capture cache metadata does not match the requested recipe.');
        return [recipe.motionId, { key: identity.digest, frameSet }];
      } catch {
        if (typeof cache.removeFiles === 'function') cache.removeFiles(identity.digest);
        return [recipe.motionId, null];
      }
    }));
  }

  function writeFromContext(normalized, recipe, frameSet) {
    if (!normalized.runtimeVersion) return { stored: false, reason: 'runtime-unavailable' };
    if (!validCachedFrameSet(frameSet, recipe)) fail('INVALID_CAPTURE_CACHE', `Captured frames do not match Motion ${recipe.motionId}.`);
    const identity = identityFor(normalized, recipe, normalized.runtimeVersion);
    const bytes = encodeCaptureSet(frameSet);
    const result = cache.put(identity, bytes, { sourceFingerprint: normalized.sourceFingerprint, artifact: CAPTURE_CACHE_ARTIFACT });
    return { stored: true, key: identity.digest, byteLength: result.byteLength };
  }

  async function write(input, recipeInput, frameSet) {
    const normalized = await context({ ...input, motions: [recipeInput] });
    return writeFromContext(normalized, normalized.motions[0], frameSet);
  }

  async function writeMany(input, entries) {
    if (!Array.isArray(entries) || !entries.length) return [];
    const normalized = await context({ ...input, motions: entries.map((entry) => entry && entry.recipe) });
    const recipes = new Map(normalized.motions.map((recipe) => [recipe.motionId, recipe]));
    return entries.map((entry) => writeFromContext(normalized, recipes.get(entry.recipe.motionId), entry.frameSet));
  }

  function overview() {
    const current = cache.status();
    return {
      schemaVersion: current.schemaVersion,
      maxBytes: current.maxBytes,
      byteLength: current.byteLength,
      entryCount: current.entryCount,
    };
  }

  function clearAll() {
    const cleared = cache.clearAll();
    return {
      removedEntries: cleared.removedEntries,
      removedBytes: cleared.removedBytes,
      schemaVersion: cleared.schemaVersion,
      maxBytes: cleared.maxBytes,
      byteLength: cleared.byteLength,
      entryCount: cleared.entryCount,
    };
  }

  return Object.freeze({ status, read, readMany, readEncodedMany, write, writeMany, overview, clearAll, rendererVersion: rendererVersion.trim() });
}

module.exports = {
  CAPTURE_CACHE_ARTIFACT,
  CAPTURE_CACHE_TARGET_VERSION,
  DEFAULT_CAPTURE_RENDERER_VERSION,
  createCaptureCacheService,
};
