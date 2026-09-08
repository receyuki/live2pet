const {
  ATLAS,
  createCodexAtlasPlan,
  createCodexTarget,
  composeCodexAtlasRgba,
  selectCodexFrameSets,
  validateCodexPetPackage,
} = require('@live2pet/codex-target');
const CODEX_PROFILE = require('@live2pet/codex-target/profile');
const { createHash } = require('node:crypto');
const { createClawdTarget, validateClawdThemePackage, clawdPackageSizeWarning } = require('@live2pet/clawd-target');
const CLAWD_PROFILE = require('@live2pet/clawd-target/profile');
const {
  assertProjectBuildable,
  digestVisualSettings,
  normalizeVisualSettings,
  normalizeClawdRenderOverrides,
  validateProject,
} = require('@live2pet/project');
const { sampleMotionCandidates } = require('@live2pet/renderer');
const { CacheError, CacheStore, DEFAULT_CACHE_LIMIT, createCacheKey } = require('./cache.cjs');
const { createClawdPreview, createCodexPreview, createTargetPreview, PREVIEW_CONTRACT_VERSION, TargetPreviewError } = require('./preview.cjs');
const { decodeFrameSet, encodeFrameSet, FRAME_CACHE_SCHEMA_VERSION, FrameCacheError } = require('./frame-cache.cjs');
const {
  decodeCaptureSet,
  encodeCaptureSet,
  CAPTURE_CACHE_COMPRESSION,
  CAPTURE_CACHE_SCHEMA_VERSION,
  CaptureCacheError,
  MAX_CAPTURE_CACHE_BYTES,
  MAX_CAPTURE_CACHE_CHUNK_BYTES,
  MAX_CAPTURE_CACHE_DIMENSION,
  MAX_CAPTURE_CACHE_FRAME_BYTES,
  MAX_CAPTURE_CACHE_FRAMES,
} = require('./capture-cache.cjs');
const { decodeAsset, encodeAsset, ASSET_CACHE_SCHEMA_VERSION, AssetCacheError } = require('./asset-cache.cjs');
const { createInflate } = require('node:zlib');

const BUILD_CONTRACT_VERSION = 1;
const SHARP_ENCODER_VERSION = 'sharp-0.34.5';
const STAGES = Object.freeze(['select', 'layout', 'compose', 'encode', 'manifest', 'preview', 'package', 'report']);
const CLAWD_STAGES = Object.freeze(['validate', 'encode', 'manifest', 'preview', 'package', 'report']);
const MAX_ENCODE_FRAMES = 4096;
const MAX_RGBA_FRAME_DIMENSION = 4096;
const MAX_RGBA_FRAME_BYTES = 64 * 1024 * 1024;
const MAX_RGBA_CHUNK_BYTES = 64 * 1024 * 1024;
const MAX_STACKED_RGBA_BYTES = 1024 * 1024 * 1024;
const RGBA_FRAME_COMPRESSION = 'deflate';
const RGBA_STACK_COMPRESSION = 'deflate-stack-v1';
const PACKAGE_FILES = CODEX_PROFILE.package.files;
const CLAWD_PACKAGE_LIMIT = CLAWD_PROFILE.package.maxBytes;
const DEFAULT_CLAWD_ENCODING_CONCURRENCY = 2;
const MAX_CLAWD_ENCODING_CONCURRENCY = 8;
const BUILD_REPORT_SCHEMA_VERSION = 1;
const SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const TARGET_PROFILES = Object.freeze({ clawd: CLAWD_PROFILE, 'codex-pet': CODEX_PROFILE });
const TARGET_RENDER_PRESETS = Object.freeze(Object.fromEntries(Object.entries(TARGET_PROFILES).map(([id, profile]) => [id, profile.renderPresets])));

class PackageBuildError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'PackageBuildError';
    this.code = code;
    this.details = details;
  }
}

function resolveTargetRenderPreset(target, render = {}) {
  const profile = TARGET_PROFILES[target];
  const presetName = typeof render.preset === 'string' && render.preset.trim()
    ? render.preset.trim().toLowerCase()
    : (profile ? profile.defaultRenderPreset : 'balanced');
  const preset = profile && profile.renderPresets[presetName];
  if (!preset) fail('INVALID_RENDER_PRESET', `Unknown ${target || 'target'} Render Preset: ${presetName}.`, { target, preset: presetName, available: Object.keys(TARGET_RENDER_PRESETS[target] || {}) });
  const overrides = target === 'clawd' ? normalizeClawdRenderOverrides(Object.fromEntries(['width', 'height', 'fps', 'quality'].filter(key => render[key] !== undefined).map(key => [key, render[key]]))) : {};
  return { name: presetName, settings: { ...preset, ...overrides } };
}

function buildProvenance(target, targetContractVersion, render = {}, encoderVersion) {
  const selection = resolveTargetRenderPreset(target, render);
  const provenance = {
    schemaVersion: 1,
    buildContractVersion: BUILD_CONTRACT_VERSION,
    targetProfile: target,
    targetContractVersion,
    renderPreset: selection.name,
    render: selection.settings,
    encoder: { name: 'sharp', format: 'webp' },
  };
  if (typeof encoderVersion === 'string' && encoderVersion.trim()) provenance.encoder.version = encoderVersion.trim();
  return provenance;
}

function createArtifactFilename({ packageId, target } = {}) {
  const id = String(packageId || '').trim();
  const targetId = String(target || '').trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/.test(id)) fail('INVALID_ARTIFACT_NAME', 'Artifact package id must be filename-safe.');
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(targetId)) fail('INVALID_ARTIFACT_NAME', 'Artifact target id must be filename-safe.');
  return `${id}-${targetId}.zip`;
}

function createBuildReport({ build, projectId, source } = {}) {
  if (!build || typeof build !== 'object' || typeof build.target !== 'string') fail('INVALID_BUILD_REPORT', 'A Package Build result with a target is required.');
  const report = {
    schemaVersion: BUILD_REPORT_SCHEMA_VERSION,
    buildContractVersion: build.buildContractVersion || BUILD_CONTRACT_VERSION,
    target: build.target,
    targetContractVersion: build.targetContractVersion || build.provenance?.targetContractVersion || null,
    renderPreset: build.provenance?.renderPreset || null,
    validation: build.validation ? {
      ok: build.validation.ok === true,
      errorCount: Array.isArray(build.validation.errors) ? build.validation.errors.length : 0,
      warningCount: Array.isArray(build.validation.warnings) ? build.validation.warnings.length : 0,
    } : null,
    output: {
      encoding: build.encoding ? { ...build.encoding } : null,
      package: build.package ? { format: build.package.format, byteLength: build.package.byteLength, files: [...(build.package.files || [])], ...(build.package.artifactName ? { artifactName: build.package.artifactName } : {}) } : null,
    },
    cache: build.cache ? { enabled: build.cache.enabled === true, hits: Number.isInteger(build.cache.hits) ? build.cache.hits : 0, misses: Number.isInteger(build.cache.misses) ? build.cache.misses : 0 } : null,
    preview: build.preview ? { target: build.preview.target, source: build.preview.source, ready: build.preview.ready === true } : null,
    timings: build.timings ? {
      totalMs: Number.isInteger(build.timings.totalMs) && build.timings.totalMs >= 0 ? build.timings.totalMs : 0,
      stages: Object.fromEntries(Object.entries(build.timings.stages || {}).filter(([, value]) => Number.isInteger(value) && value >= 0)),
    } : null,
    warnings: Array.isArray(build.warnings) ? build.warnings.map((warning) => ({ ...warning })) : [],
  };
  if (typeof projectId === 'string' && projectId.trim()) report.projectId = projectId.trim();
  if (source && typeof source === 'object') {
    if (typeof source.kind === 'string' && source.kind.trim()) report.sourceKind = source.kind.trim();
    if (typeof source.fingerprint === 'string' && /^[a-f0-9]{64}$/i.test(source.fingerprint.trim())) report.sourceFingerprint = source.fingerprint.trim().toLowerCase();
  }
  return report;
}

function fail(code, message, details = {}) {
  throw new PackageBuildError(code, message, details);
}

function checkCancelled(signal) {
  if (signal && signal.aborted) fail('BUILD_CANCELLED', 'Package Build was cancelled before the next stage completed.');
}

function rgbaByteLength(width, height, label = 'RGBA frame') {
  if (!Number.isSafeInteger(width) || width < 1 || width > MAX_RGBA_FRAME_DIMENSION || !Number.isSafeInteger(height) || height < 1 || height > MAX_RGBA_FRAME_DIMENSION) {
    fail('INVALID_RGBA_FRAME', `${label} width and height must be integers between 1 and ${MAX_RGBA_FRAME_DIMENSION}.`, { width, height, maxDimension: MAX_RGBA_FRAME_DIMENSION });
  }
  const byteLength = width * height * 4;
  if (!Number.isSafeInteger(byteLength) || byteLength > MAX_RGBA_FRAME_BYTES) {
    fail('RGBA_FRAME_TOO_LARGE', `${label} RGBA payload exceeds the ${MAX_RGBA_FRAME_BYTES}-byte limit.`, { width, height, byteLength, maxBytes: MAX_RGBA_FRAME_BYTES });
  }
  return byteLength;
}

function normalizeByteBuffer(value, label) {
  if (Buffer.isBuffer(value)) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  if (value instanceof Uint8Array) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  if (ArrayBuffer.isView(value)) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  if (value instanceof ArrayBuffer) return Buffer.from(value);
  fail('INVALID_RGBA_FRAME', `${label} must be a byte buffer.`);
}

function cancellationError() {
  return new PackageBuildError('BUILD_CANCELLED', 'Package Build was cancelled before the next stage completed.');
}

/**
 * Decode one browser-produced `CompressionStream("deflate")` RGBA payload.
 * The stream is intentionally bounded by the dimensions supplied alongside the
 * payload so a small compressed input cannot expand without limit. Destroying
 * the inflater on abort also stops an in-flight decode instead of waiting for
 * all compressed bytes to be produced.
 */
function decodeCompressedRgbaPayload({ width, height, expectedBytes, rgbaDeflate, compression, expectedCompression, maxCompressedBytes, label, sizeErrorCode, sizeDescription } = {}, { signal } = {}) {
  if (compression !== expectedCompression) fail('INVALID_RGBA_FRAME', `${label} compression must be "${expectedCompression}".`);
  const compressed = normalizeByteBuffer(rgbaDeflate, `${label}.rgbaDeflate`);
  if (!compressed.byteLength) fail('INVALID_RGBA_FRAME', `${label}.rgbaDeflate cannot be empty.`);
  if (compressed.byteLength > maxCompressedBytes) fail('RGBA_FRAME_TOO_LARGE', `${label}.rgbaDeflate exceeds the ${maxCompressedBytes}-byte limit.`, { compressedBytes: compressed.byteLength, maxBytes: maxCompressedBytes });
  checkCancelled(signal);
  return new Promise((resolve, reject) => {
    const chunks = [];
    let outputBytes = 0;
    let settled = false;
    let inflater;
    const cleanup = () => {
      if (signal && typeof signal.removeEventListener === 'function') signal.removeEventListener('abort', onAbort);
    };
    const rejectOnce = (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const resolveOnce = (value) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(value);
    };
    const onAbort = () => {
      if (!settled && inflater) inflater.destroy(cancellationError());
    };
    try {
      inflater = createInflate();
      inflater.on('data', (chunk) => {
        if (signal && signal.aborted) {
          inflater.destroy(cancellationError());
          return;
        }
        outputBytes += chunk.byteLength;
        if (outputBytes > expectedBytes || outputBytes > maxCompressedBytes) {
          inflater.destroy(new PackageBuildError(sizeErrorCode, `${label} decompressed RGBA payload exceeds the declared ${sizeDescription} size.`, { width, height, expectedBytes, actualBytes: outputBytes }));
          return;
        }
        chunks.push(chunk);
      });
      inflater.once('error', (error) => {
        if (error instanceof PackageBuildError) rejectOnce(error);
        else rejectOnce(new PackageBuildError('RGBA_DECOMPRESSION_FAILED', `${label} deflate payload could not be decoded.`, { cause: error && error.code ? error.code : String(error && error.message ? error.message : error) }));
      });
      inflater.once('end', () => {
        if (signal && signal.aborted) {
          rejectOnce(cancellationError());
          return;
        }
        if (outputBytes !== expectedBytes) {
          rejectOnce(new PackageBuildError(sizeErrorCode, `${label} decompressed RGBA payload is ${outputBytes} bytes; expected ${expectedBytes} bytes for ${sizeDescription}.`, { width, height, expectedBytes, actualBytes: outputBytes }));
          return;
        }
        resolveOnce(Buffer.concat(chunks, outputBytes));
      });
      if (signal && typeof signal.addEventListener === 'function') signal.addEventListener('abort', onAbort, { once: true });
      checkCancelled(signal);
      inflater.end(compressed);
    } catch (error) {
      rejectOnce(error instanceof PackageBuildError ? error : new PackageBuildError('RGBA_DECOMPRESSION_FAILED', `${label} deflate payload could not be decoded.`, { cause: String(error && error.message ? error.message : error) }));
    }
  });
}

function decodeCompressedRgbaFrame({ width, height, rgbaDeflate, compression } = {}, { signal, label = 'RGBA frame' } = {}) {
  const expectedBytes = rgbaByteLength(width, height, label);
  return decodeCompressedRgbaPayload({
    width,
    height,
    expectedBytes,
    rgbaDeflate,
    compression,
    expectedCompression: RGBA_FRAME_COMPRESSION,
    maxCompressedBytes: MAX_RGBA_FRAME_BYTES,
    label,
    sizeErrorCode: 'RGBA_FRAME_SIZE_MISMATCH',
    sizeDescription: `${width}×${height}`,
  }, { signal });
}

function decodeCompressedRgbaStack({ width, height, frameCount, rgbaDeflate, compression } = {}, { signal, label = 'RGBA capture chunk' } = {}) {
  if (!Number.isSafeInteger(frameCount) || frameCount < 1 || frameCount > MAX_ENCODE_FRAMES) fail('INVALID_RGBA_FRAME', `${label} frameCount must be between 1 and ${MAX_ENCODE_FRAMES}.`);
  const frameBytes = rgbaByteLength(width, height, label);
  const expectedBytes = frameBytes * frameCount;
  if (!Number.isSafeInteger(expectedBytes) || expectedBytes > MAX_RGBA_CHUNK_BYTES) fail('RGBA_ANIMATION_TOO_LARGE', `${label} exceeds the ${MAX_RGBA_CHUNK_BYTES}-byte chunk limit.`);
  return decodeCompressedRgbaPayload({
    width,
    height,
    expectedBytes,
    rgbaDeflate,
    compression,
    expectedCompression: RGBA_STACK_COMPRESSION,
    maxCompressedBytes: MAX_RGBA_CHUNK_BYTES,
    label,
    sizeErrorCode: 'RGBA_STACK_SIZE_MISMATCH',
    sizeDescription: `${width}×${height}×${frameCount}`,
  }, { signal });
}

function progress(onProgress, stage, status, details = {}) {
  if (typeof onProgress === 'function') onProgress({ stage, status, ...details });
}

function cacheIdentityAvailable(cache, cacheContext) {
  return cache && typeof cache.get === 'function' && typeof cache.put === 'function' && cacheContext && typeof cacheContext === 'object'
    && typeof cacheContext.sourceFingerprint === 'string' && typeof cacheContext.runtimeVersion === 'string'
    && typeof cacheContext.rendererVersion === 'string';
}

function encodedCacheIdentityAvailable(cache, cacheContext) {
  return Boolean(cacheIdentityAvailable(cache, cacheContext) && typeof cacheContext.encoderVersion === 'string' && cacheContext.encoderVersion.trim());
}

function normalizeBuildVisualSettings(value) {
  try {
    return normalizeVisualSettings(value);
  } catch (error) {
    if (error && error.code === 'INVALID_VISUAL_SETTINGS') fail(error.code, error.message, error.details);
    throw error;
  }
}

function resolveVisualSettings(value, cacheContext) {
  const explicit = value !== undefined;
  const candidate = explicit ? value : cacheContext?.visualSettings;
  const settings = normalizeBuildVisualSettings(candidate);
  let digest = settings.hiddenElementIds.length ? digestVisualSettings(settings) : null;
  if (!explicit && candidate === undefined && typeof cacheContext?.visualSettingsDigest === 'string' && /^[a-f0-9]{64}$/i.test(cacheContext.visualSettingsDigest.trim())) {
    digest = cacheContext.visualSettingsDigest.trim().toLowerCase();
  }
  return { settings, digest };
}

function withVisualSettingsCacheContext(cacheContext, settings, digestOverride = null) {
  if (!cacheContext || typeof cacheContext !== 'object' || Array.isArray(cacheContext)) return cacheContext;
  const normalized = normalizeBuildVisualSettings(settings);
  const next = { ...cacheContext };
  const digest = digestOverride || (normalized.hiddenElementIds.length ? digestVisualSettings(normalized) : null);
  if (digest) next.visualSettingsDigest = digest;
  else delete next.visualSettingsDigest;
  return next;
}

function visualSettingsRecipe(recipe, digest) {
  return digest ? { ...recipe, visualSettingsDigest: digest } : recipe;
}

async function applyRendererVisualSettings(renderer, settings, target) {
  if (!renderer || typeof renderer.setVisualSettings !== 'function') {
    if (settings.hiddenElementIds.length) fail('UNSUPPORTED_VISUAL_SETTINGS', `${target} capture requires a renderer with Visual Settings support.`, { target });
    return;
  }
  await renderer.setVisualSettings(settings);
}

function encodedAssetCacheKey({ cacheContext, target, targetVersion, renderPreset, recipe, visualSettingsDigest: digestOverride }) {
  const digest = digestOverride || cacheContext.visualSettingsDigest;
  return createCacheKey({
    sourceFingerprint: cacheContext.sourceFingerprint,
    runtimeVersion: cacheContext.runtimeVersion,
    rendererVersion: cacheContext.rendererVersion,
    recipe: visualSettingsRecipe(recipe, digest),
    targetProfile: target,
    targetVersion: String(targetVersion),
    renderPreset,
    artifact: 'encoded-webp',
  });
}

function mappedMotionIds(values) {
  const ids = [];
  const seen = new Set();
  for (const value of Object.values(values || {})) {
    if (typeof value !== 'string' || !value.startsWith('motion:')) continue;
    const id = value.slice(7);
    if (!seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  }
  return ids;
}

function resolveProjectRecipeExpressions(project, targetProject, targetId) {
  const recipesById = new Map((Array.isArray(project?.recipes) ? project.recipes : []).map((recipe) => [recipe.id, recipe]));
  const expressionByMotion = {};
  for (const [slot, recipeId] of Object.entries(targetProject?.recipeMappings || {})) {
    if (!recipeId) continue;
    const recipe = recipesById.get(recipeId);
    if (!recipe) fail('UNKNOWN_RECIPE_ID', `The ${targetId} recipe mapping ${slot} references an unknown recipe: ${recipeId}.`);
    const mapping = targetProject.mappings?.[slot] || targetProject.reactions?.[slot];
    if (typeof mapping !== 'string' || !mapping.startsWith('motion:')) fail('RECIPE_MAPPING_MISMATCH', `${targetId}.${slot} must map to a Motion before it can use recipe ${recipeId}.`);
    const motionId = mapping.slice(7);
    if (motionId !== recipe.motionId) fail('RECIPE_MAPPING_MISMATCH', `${targetId}.${slot} uses recipe ${recipeId}, which belongs to ${recipe.motionId}, not ${motionId}.`);
    const expressionId = recipe.expressionId || null;
    if (Object.hasOwn(expressionByMotion, motionId) && expressionByMotion[motionId] !== expressionId) {
      fail('CONFLICTING_RECIPE_EXPRESSIONS', `${targetId} maps Motion ${motionId} with more than one Expression; split the Motion or use one Expression per Motion.`);
    }
    expressionByMotion[motionId] = expressionId;
  }
  return expressionByMotion;
}

function rendererMotionDescriptor(renderer, motionId) {
  const collections = [renderer && renderer.source && renderer.source.motions, renderer && renderer.motions].filter(Array.isArray);
  for (const collection of collections) {
    const motion = collection.find((item) => item && item.id === motionId);
    if (motion) return motion;
  }
  return null;
}

async function renderMappedMotions({ renderer, motionIds, render = {}, signal, onProgress, target, cache, cacheContext, expressionByMotion = {}, visualSettings } = {}) {
  if (!renderer || typeof renderer.captureRgba !== 'function') fail('RENDERER_REQUIRED', 'A renderer implementing captureRgba is required when build inputs do not include captured frames.');
  if (!Array.isArray(motionIds) || !motionIds.length) fail('MOTION_MAPPING_REQUIRED', `No ${target || 'target'} Motion mappings are available for renderer capture.`);
  const visualSettingsIdentity = resolveVisualSettings(visualSettings, cacheContext);
  const { name: presetName, settings: preset } = resolveTargetRenderPreset(target, render);
  const width = Number.isInteger(render.width) ? render.width : preset.width;
  const height = Number.isInteger(render.height) ? render.height : preset.height;
  const configuredSamples = Number.isInteger(render.samples) ? render.samples : null;
  const framesByMotion = {};
  const cacheEnabled = cache && typeof cache.get === 'function' && typeof cache.put === 'function' && cacheContext && typeof cacheContext === 'object'
    && typeof cacheContext.sourceFingerprint === 'string' && typeof cacheContext.runtimeVersion === 'string'
    && typeof cacheContext.rendererVersion === 'string' && typeof cacheContext.targetVersion === 'string';
  for (const motionId of motionIds) {
    checkCancelled(signal);
    const descriptor = rendererMotionDescriptor(renderer, motionId);
    const configuredDuration = render.durations && Object.prototype.hasOwnProperty.call(render.durations, motionId)
      ? render.durations[motionId]
      : descriptor && descriptor.duration;
    const sourceDuration = configuredDuration == null ? 1 : Number(configuredDuration);
    if (!Number.isFinite(sourceDuration) || sourceDuration < 0 || sourceDuration > 3600) fail('INVALID_MOTION_DURATION', `Motion ${motionId} has no valid duration for renderer capture.`);
    const duration = target === 'codex-pet' ? Math.min(sourceDuration, Math.max(...Object.values(CODEX_PROFILE.frameDurations).map((delays) => delays.reduce((a, b) => a + b, 0) / 1000))) : sourceDuration;
    const samples = configuredSamples || (target === 'codex-pet'
      ? Math.max(2, Math.ceil(duration * preset.samplesPerSecond))
      : Math.max(2, Math.ceil(duration * preset.fps)));
    const expressionId = Object.hasOwn(expressionByMotion, motionId)
      ? expressionByMotion[motionId]
      : (cacheContext?.expressionId || null);
    const cacheKey = cacheEnabled ? createCacheKey({
      sourceFingerprint: cacheContext.sourceFingerprint,
      runtimeVersion: cacheContext.runtimeVersion,
      rendererVersion: cacheContext.rendererVersion,
      recipe: visualSettingsRecipe({
        motionId,
        expressionId,
        render: { captureTimingVersion: 3, width, height, samples, duration, fps: Number.isFinite(render.fps) ? render.fps : null },
      }, visualSettingsIdentity.digest),
      targetProfile: target,
      targetVersion: cacheContext.targetVersion,
      renderPreset: presetName,
      artifact: 'render-candidates',
    }) : null;
    if (cacheKey) {
      const cached = cache.get(cacheKey);
      if (cached) {
        try {
          const decoded = decodeFrameSet(cached.data);
          if (decoded.motionId === motionId && decoded.frames.length > 0) {
            framesByMotion[motionId] = decoded;
            progress(onProgress, 'render', 'completed', { target, motionId, samples: decoded.frames.length, cache: 'hit', fraction: (motionIds.indexOf(motionId) + 1) / motionIds.length });
            continue;
          }
        } catch (error) {
          if (error instanceof FrameCacheError && typeof cache.removeFiles === 'function') cache.removeFiles(cacheKey.digest);
        }
      }
    }
    const motionIndex = motionIds.indexOf(motionId);
    progress(onProgress, 'render', 'started', { target, motionId, width, height, samples, duration, fraction: motionIndex / motionIds.length });
    const result = await sampleMotionCandidates(renderer, { motionId, duration, samples, width, height, includeEndpoint: target !== 'clawd', expressionId, signal, onFrame: ({ completed, total }) => progress(onProgress, 'render', 'frame-completed', { target, motionId, completed, total, fraction: (motionIndex + completed / total) / motionIds.length }) });
    checkCancelled(signal);
    framesByMotion[motionId] = {
      frames: result.candidates,
      fps: target === 'clawd' && !configuredSamples && duration > 0 ? samples / duration : Number.isFinite(render.fps) ? render.fps : (render.preset ? (preset.fps || (duration > 0 ? samples / duration : 10)) : (duration > 0 ? samples / duration : 10)),
      expressionId,
    };
    if (cacheKey) cache.put(cacheKey, encodeFrameSet({ motionId, ...framesByMotion[motionId] }), { projectId: cacheContext.projectId, sourceFingerprint: cacheContext.sourceFingerprint, artifact: 'render-candidates' });
    progress(onProgress, 'render', 'completed', { target, motionId, samples: result.candidates.length, fraction: (motionIndex + 1) / motionIds.length });
  }
  return framesByMotion;
}

function frameMetadata(frame) {
  return {
    id: frame.id,
    ...(Number.isInteger(frame.sourceIndex) ? { sourceIndex: frame.sourceIndex } : {}),
    ...(Number.isFinite(frame.time) ? { time: frame.time } : {}),
  };
}

function captureMap(frameSets) {
  const captures = {};
  for (const frames of Object.values(frameSets)) for (const frame of frames) {
    if (!frame || !frame.id || !ArrayBuffer.isView(frame.rgba)) fail('MISSING_FRAME_CAPTURE', `Selected frame ${frame && frame.id ? frame.id : '<unknown>'} has no RGBA capture.`);
    captures[frame.id] = { width: frame.width, height: frame.height, rgba: frame.rgba };
  }
  return captures;
}

function resolveSharp(explicit) {
  if (typeof explicit === 'function') return explicit;
  if (explicit === null) fail('WEBP_ENCODER_UNAVAILABLE', 'The sharp WebP encoder is not available in this App runtime.');
  try {
    return require('sharp');
  } catch (error) {
    fail('WEBP_ENCODER_UNAVAILABLE', 'The sharp WebP encoder is not available in this App runtime.', { cause: error && error.code ? error.code : String(error && error.message ? error.message : error) });
  }
}

function resolveZip(explicit) {
  if (explicit && typeof explicit === 'object') return explicit;
  try {
    return require('@zip.js/zip.js');
  } catch (error) {
    fail('ZIP_BUILDER_UNAVAILABLE', 'The zip.js package builder is not available in this App runtime.', { cause: error && error.code ? error.code : String(error && error.message ? error.message : error) });
  }
}

async function normalizeEncodeFrames(frames, width, height, { signal, rgbaChunks } = {}) {
  if (!Array.isArray(frames) || !frames.length || frames.length > MAX_ENCODE_FRAMES) fail('INVALID_WEBP_INPUT', `WebP encoding requires between 1 and ${MAX_ENCODE_FRAMES} frames.`);
  if (!Number.isInteger(width) || width < 1 || !Number.isInteger(height) || height < 1) fail('INVALID_WEBP_INPUT', 'WebP width and height must be positive integers.');
  const expectedBytes = rgbaByteLength(width, height, 'WebP frame');
  const stackedBytes = expectedBytes * frames.length;
  if (!Number.isSafeInteger(stackedBytes) || stackedBytes > MAX_STACKED_RGBA_BYTES) {
    fail('RGBA_ANIMATION_TOO_LARGE', `Animated WebP RGBA input exceeds the ${MAX_STACKED_RGBA_BYTES}-byte encoder budget.`, { width, height, frameCount: frames.length, byteLength: stackedBytes, maxBytes: MAX_STACKED_RGBA_BYTES });
  }
  // Decode directly into the final page stack so a full normalized-frame
  // array and Buffer.concat copy never coexist for large animations.
  const stacked = Buffer.allocUnsafe(stackedBytes);
  if (rgbaChunks !== undefined) {
    if (!Array.isArray(rgbaChunks) || !rgbaChunks.length) fail('INVALID_WEBP_INPUT', 'RGBA capture chunks must be a non-empty array.');
    if (frames.some((frame) => !frame || typeof frame !== 'object' || frame.width !== width || frame.height !== height)) {
      fail('INVALID_WEBP_INPUT', `Every frame must contain ${width}×${height} metadata when RGBA capture chunks are supplied.`);
    }
    let nextFrame = 0;
    for (const [index, chunk] of rgbaChunks.entries()) {
      if (!chunk || typeof chunk !== 'object' || chunk.startFrame !== nextFrame || !Number.isSafeInteger(chunk.frameCount) || chunk.frameCount < 1 || chunk.startFrame < 0 || chunk.startFrame + chunk.frameCount > frames.length) fail('INVALID_WEBP_INPUT', `RGBA capture chunk ${index} is not contiguous with the declared frame set.`);
      const decoded = await decodeCompressedRgbaStack({ ...chunk, width, height }, { signal, label: `RGBA capture chunk ${index}` });
      decoded.copy(stacked, nextFrame * expectedBytes);
      nextFrame += chunk.frameCount;
    }
    if (nextFrame !== frames.length) fail('INVALID_WEBP_INPUT', `RGBA capture chunks contain ${nextFrame} frames; expected ${frames.length}.`);
    return stacked;
  }
  for (const [index, frame] of frames.entries()) {
    checkCancelled(signal);
    if (!frame || typeof frame !== 'object' || frame.width !== width || frame.height !== height) fail('INVALID_WEBP_INPUT', `Frame ${index} must contain ${width}×${height} RGBA bytes.`);
    const hasRaw = frame.rgba !== undefined;
    const hasCompressed = frame.rgbaDeflate !== undefined;
    if (hasRaw && hasCompressed) fail('INVALID_WEBP_INPUT', `Frame ${index} cannot contain both rgba and rgbaDeflate payloads.`);
    if (hasCompressed) {
      try {
        const decoded = await decodeCompressedRgbaFrame(frame, { signal, label: `Frame ${index}` });
        if (decoded.byteLength !== expectedBytes) fail('INVALID_WEBP_INPUT', `Frame ${index} must contain ${expectedBytes} decompressed RGBA bytes.`);
        decoded.copy(stacked, index * expectedBytes);
      } catch (error) {
        if (error instanceof PackageBuildError) throw error;
        fail('RGBA_DECOMPRESSION_FAILED', `Frame ${index} deflate payload could not be decoded.`, { cause: String(error && error.message ? error.message : error) });
      }
      continue;
    }
    if (!hasRaw || !ArrayBuffer.isView(frame.rgba) || frame.rgba.byteLength !== expectedBytes) fail('INVALID_WEBP_INPUT', `Frame ${index} must contain ${width}×${height} RGBA bytes.`);
    Buffer.from(frame.rgba.buffer, frame.rgba.byteOffset, frame.rgba.byteLength).copy(stacked, index * expectedBytes);
  }
  checkCancelled(signal);
  return stacked;
}

async function encodeAnimatedWebp({ frames, rgbaChunks, width, height, delay = 100, loop = 0, quality = 80, alphaQuality = 100, lossless = false } = {}, { sharpFactory, signal } = {}) {
  const stacked = await normalizeEncodeFrames(frames, width, height, { signal, rgbaChunks });
  checkCancelled(signal);
  if (!Number.isInteger(loop) || loop < 0 || loop > 65535) fail('INVALID_WEBP_INPUT', 'WebP loop count must be an integer between 0 and 65535.');
  if (!Number.isFinite(quality) || quality < 0 || quality > 100 || !Number.isFinite(alphaQuality) || alphaQuality < 0 || alphaQuality > 100) fail('INVALID_WEBP_INPUT', 'WebP quality values must be between 0 and 100.');
  const delays = Array.isArray(delay) ? delay : Array(frames.length).fill(delay);
  if (delays.length !== frames.length || delays.some((value) => !Number.isInteger(value) || value < 1 || value > 60000)) fail('INVALID_WEBP_INPUT', 'WebP delays must contain one integer millisecond value per frame between 1 and 60000.');
  const sharp = resolveSharp(sharpFactory);
  try {
    const result = await sharp(stacked, { animated: frames.length > 1, raw: { width, height: height * frames.length, channels: 4, pageHeight: height } })
      .webp({ quality, alphaQuality, lossless, loop, delay: delays })
      .toBuffer({ resolveWithObject: true });
    checkCancelled(signal);
    const buffer = Buffer.isBuffer(result) ? result : result && result.data;
    if (!buffer || !buffer.length) fail('WEBP_ENCODER_INVALID_OUTPUT', 'The WebP encoder returned an empty buffer.');
    return { format: 'webp', buffer, frameCount: frames.length, width, height, delays, info: result && result.info ? result.info : null };
  } catch (error) {
    if (error instanceof PackageBuildError) throw error;
    fail('WEBP_ENCODER_FAILED', `The WebP encoder failed: ${error && error.message ? error.message : error}`);
  }
}

function normalizeZipBytes(value, label) {
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return Uint8Array.from(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
  fail('INVALID_ZIP_INPUT', `${label} must be a byte buffer.`);
}

function normalizeManifestJson(manifest) {
  if (typeof manifest === 'string') {
    try { JSON.parse(manifest); } catch (error) { fail('INVALID_ZIP_INPUT', 'pet.json must contain valid JSON.', { cause: String(error.message || error) }); }
    return manifest.endsWith('\n') ? manifest : `${manifest}\n`;
  }
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) fail('INVALID_ZIP_INPUT', 'pet.json must be a JSON object or JSON text.');
  try { return `${JSON.stringify(manifest, null, 2)}\n`; } catch (error) { fail('INVALID_ZIP_INPUT', 'pet.json could not be serialized.', { cause: String(error.message || error) }); }
}

async function createCodexPetZip({ manifest, spritesheet, zipModule } = {}) {
  const petJson = Buffer.from(normalizeManifestJson(manifest), 'utf8');
  const spriteBytes = normalizeZipBytes(spritesheet, 'spritesheet.webp');
  if (!spriteBytes.length) fail('INVALID_ZIP_INPUT', 'spritesheet.webp cannot be empty.');
  const zip = resolveZip(zipModule);
  const required = ['ZipWriter', 'Uint8ArrayWriter', 'Uint8ArrayReader'];
  if (required.some((name) => typeof zip[name] !== 'function')) fail('ZIP_BUILDER_UNAVAILABLE', 'The zip.js package builder is missing a required writer API.');
  try {
    const writer = new zip.ZipWriter(new zip.Uint8ArrayWriter('application/zip'));
    await writer.add('pet.json', new zip.Uint8ArrayReader(petJson));
    await writer.add('spritesheet.webp', new zip.Uint8ArrayReader(spriteBytes));
    const data = await writer.close();
    const buffer = normalizeZipBytes(data, 'ZIP output');
    if (!buffer.length) fail('ZIP_BUILDER_INVALID_OUTPUT', 'The ZIP builder returned an empty archive.');
    return { format: 'zip', buffer, files: [...PACKAGE_FILES], byteLength: buffer.length };
  } catch (error) {
    if (error instanceof PackageBuildError) throw error;
    fail('ZIP_BUILDER_FAILED', `The ZIP builder failed: ${error && error.message ? error.message : error}`);
  }
}

function safeThemeId(value) {
  const normalized = String(value || '').trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 96);
  if (!normalized) fail('INVALID_CLAWD_METADATA', 'Clawd theme id must contain at least one safe filename character.');
  return normalized;
}

function safeAssetBasename(value) {
  const normalized = String(value || '').trim();
  if (!normalized || normalized.includes('/') || normalized.includes('\\') || normalized === '.' || normalized === '..' || normalized.includes('..')) fail('INVALID_CLAWD_ASSET', `Clawd asset filename is not a safe basename: ${value}`);
  return normalized;
}

function cloneJsonValue(value, label) {
  try { return JSON.parse(JSON.stringify(value)); } catch (error) { fail('INVALID_CLAWD_METADATA', `${label} must be JSON-serializable.`, { cause: String(error && error.message ? error.message : error) }); }
}

function normalizeClawdMetadata(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('INVALID_CLAWD_METADATA', 'Clawd theme metadata must be an object.');
  const name = typeof input.name === 'string' && input.name.trim() ? input.name.trim() : 'Live2Pet Theme';
  const version = typeof input.version === 'string' && input.version.trim() ? input.version.trim() : '1.0.0';
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) fail('INVALID_CLAWD_METADATA', 'Clawd theme version must be a semantic version such as 1.0.0.');
  const themeId = safeThemeId(input.id || name);
  const metadata = {
    schemaVersion: 1,
    name,
    ...(typeof input.author === 'string' && input.author.trim() ? { author: input.author.trim() } : {}),
    version,
    description: typeof input.description === 'string' && input.description.trim() ? input.description.trim() : `A Live2Pet theme generated from ${name}.`,
    customization: { petTint: false },
    viewBox: { x: 0, y: 0, width: 384, height: 384 },
    objectScale: { widthRatio: 1, heightRatio: 1, offsetX: 0, offsetY: 0 },
    eyeTracking: { enabled: false, states: [] },
    miniMode: { supported: false },
  };
  if (typeof input.license === 'string' && input.license.trim()) metadata.license = input.license.trim();
  for (const key of ['customization', 'viewBox', 'objectScale', 'layout', 'updateBubbleAnchorBox', 'eyeTracking', 'miniMode', 'timings', 'hitBoxes', 'roamFlipAssets', 'idleAnimations', 'idleEasterEggs', 'workingTiers', 'jugglingTiers']) {
    if (input[key] !== undefined) metadata[key] = cloneJsonValue(input[key], `metadata.${key}`);
  }
  if (metadata.hitBoxes === undefined) {
    const { x, y, width, height } = metadata.viewBox;
    metadata.hitBoxes = { default: { x, y, w: width, h: height } };
  }
  return { themeId, metadata };
}

function collectClawdMotionIds(target, behavior = {}) {
  const ids = [];
  const seen = new Set();
  const collect = value => {
    if (typeof value !== 'string' || !value.startsWith('motion:')) return;
    const id = value.slice(7);
    if (!seen.has(id)) { seen.add(id); ids.push(id); }
  };
  Object.values(target.states || {}).forEach(collect);
  Object.values(target.reactions || {}).forEach(collect);
  for (const field of ['idleAnimations', 'workingTiers', 'jugglingTiers']) {
    if (!Array.isArray(behavior[field])) continue;
    for (const entry of behavior[field]) collect(entry && entry.motion);
  }
  return ids;
}

function normalizeClawdFrameSet(value, motionId, defaults = {}) {
  const frames = Array.isArray(value) ? value : value && Array.isArray(value.frames) ? value.frames : null;
  if (!frames || !frames.length) fail('INVALID_CLAWD_FRAME_SET', `${motionId} must provide at least one RGBA frame.`);
  const options = Array.isArray(value) ? {} : value;
  const delay = options.delay ?? (Number.isFinite(options.fps) && options.fps > 0 ? Math.round(1000 / options.fps) : 100);
  return { frames, ...(options.rgbaChunks === undefined ? {} : { rgbaChunks: options.rgbaChunks }), expressionId: options.expressionId || null, delay, loop: options.loop ?? 0, quality: options.quality ?? defaults.quality ?? 80, alphaQuality: options.alphaQuality ?? defaults.alphaQuality ?? 100, lossless: options.lossless ?? false };
}

function clawdAssetSlug(motionId, used) {
  const base = String(motionId).toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'motion';
  let slug = base;
  let suffix = 2;
  while (used.has(slug)) slug = `${base}-${suffix++}`;
  used.add(slug);
  return slug;
}

function resolveClawdEncodingConcurrency(value) {
  const concurrency = value == null ? DEFAULT_CLAWD_ENCODING_CONCURRENCY : Number(value);
  if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > MAX_CLAWD_ENCODING_CONCURRENCY) {
    fail('INVALID_ENCODING_CONCURRENCY', `Clawd encodingConcurrency must be an integer between 1 and ${MAX_CLAWD_ENCODING_CONCURRENCY}.`);
  }
  return concurrency;
}

async function mapConcurrentOrdered(items, concurrency, worker, signal) {
  const results = new Array(items.length);
  let nextIndex = 0;
  let firstError = null;
  const runWorker = async () => {
    while (!firstError) {
      const index = nextIndex++;
      if (index >= items.length) return;
      try {
        checkCancelled(signal);
        results[index] = await worker(items[index], index);
      } catch (error) {
        firstError ||= error;
        return;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => runWorker()));
  if (firstError) throw firstError;
  return results;
}

function clawdThemeBindings(target, assetsByMotion) {
  const states = {};
  for (const [slot, value] of Object.entries(target.states || {})) {
    if (!value) continue;
    if (value.startsWith('fallback:')) states[slot] = { fallbackTo: value.slice(9) };
    else if (value.startsWith('motion:')) states[slot] = [assetsByMotion[value.slice(7)]];
  }
  const reactions = {};
  for (const [slot, value] of Object.entries(target.reactions || {})) if (value && value.startsWith('motion:')) reactions[slot] = { file: assetsByMotion[value.slice(7)] };
  const idleFile = Array.isArray(states.idle) ? states.idle[0] : null;
  if (idleFile) {
    for (const slot of ['drag', 'clickLeft', 'clickRight']) reactions[slot] ||= { file: idleFile };
  }
  return { states, reactions };
}

function clawdMotionId(value) {
  return typeof value === 'string' && value.startsWith('motion:') ? value.slice('motion:'.length) : null;
}

function deriveClawdBehaviorMetadata(metadata, target, assetsByMotion) {
  const result = { ...metadata };
  const workingMotion = clawdMotionId(target.states?.working);
  const jugglingMotion = clawdMotionId(target.states?.juggling);
  if (workingMotion && assetsByMotion[workingMotion] && result.workingTiers === undefined) {
    result.workingTiers = [{ minSessions: 1, file: assetsByMotion[workingMotion] }];
  }
  if (jugglingMotion && assetsByMotion[jugglingMotion] && result.jugglingTiers === undefined) {
    result.jugglingTiers = [{ minSessions: 1, file: assetsByMotion[jugglingMotion] }];
  }
  return result;
}

function normalizeClawdBehaviorInput(input, assetsByMotion) {
  if (input == null) return {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('INVALID_CLAWD_METADATA', 'Clawd behavior configuration must be an object.');
  const result = {};
  if (input.roamFlipAssets !== undefined) {
    if (typeof input.roamFlipAssets !== 'boolean') fail('INVALID_CLAWD_METADATA', 'behavior.roamFlipAssets must be a boolean.');
    result.roamFlipAssets = input.roamFlipAssets;
  }
  for (const field of ['idleAnimations', 'workingTiers', 'jugglingTiers']) {
    if (input[field] === undefined) continue;
    if (!Array.isArray(input[field])) fail('INVALID_CLAWD_METADATA', `behavior.${field} must be an array.`);
    if (input[field].length === 0) continue;
    result[field] = input[field].map((entry, index) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry) || typeof entry.motion !== 'string' || !entry.motion.startsWith('motion:') || !entry.motion.slice(7)) {
        fail('INVALID_CLAWD_METADATA', `behavior.${field}[${index}] must reference a Motion as motion:<id>.`);
      }
      const motionId = entry.motion.slice(7);
      const file = assetsByMotion[motionId];
      if (!file) fail('MISSING_CLAWD_FRAME_SET', `behavior.${field}[${index}] references ${motionId}, but no captured frames are available.`);
      const mapped = { file };
      for (const key of ['duration', 'minSessions', 'maxSessions']) if (entry[key] !== undefined && entry[key] !== null) mapped[key] = entry[key];
      return mapped;
    });
  }
  return result;
}

function normalizeCodexMetadata(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('INVALID_CODEX_METADATA', 'Codex pet metadata must be an object.');
  const displayName = typeof input.displayName === 'string' && input.displayName.trim()
    ? input.displayName.trim()
    : typeof input.name === 'string' && input.name.trim()
      ? input.name.trim()
      : 'Live2Pet Codex Pet';
  const id = String(input.id || displayName).trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 96);
  if (!id) fail('INVALID_CODEX_METADATA', 'Codex pet id must contain at least one safe filename character.');
  const description = typeof input.description === 'string' && input.description.trim()
    ? input.description.trim()
    : `A Codex pet generated locally by Live2Pet from ${displayName}.`;
  const version = typeof input.version === 'string' && input.version.trim() ? input.version.trim() : '1.0.0';
  if (!SEMVER_PATTERN.test(version)) fail('INVALID_CODEX_METADATA', 'Codex pet version must be a semantic version such as 1.0.0.');
  return { id, displayName, description, version, spritesheetPath: 'spritesheet.webp' };
}

async function createClawdThemeZip({ themeId, manifest, assets, readme, zipModule, maxBytes = CLAWD_PACKAGE_LIMIT } = {}) {
  const root = safeThemeId(themeId || manifest && manifest.name);
  const petJson = Buffer.from(normalizeManifestJson(manifest), 'utf8');
  const readmeText = typeof readme === 'string' && readme.length ? (readme.endsWith('\n') ? readme : `${readme}\n`) : `# ${manifest.name}\n\nGenerated locally by Live2Pet. Source assets remain on the user's computer.\n`;
  if (Buffer.byteLength(readmeText, 'utf8') > 2 * 1024 * 1024) fail('INVALID_CLAWD_METADATA', 'Clawd README exceeds the 2 MiB limit.');
  if (!assets || typeof assets !== 'object' || Array.isArray(assets)) fail('INVALID_CLAWD_ASSET', 'Clawd assets must be an object keyed by safe basenames.');
  const entries = Object.entries(assets).map(([name, bytes]) => ({ name: safeAssetBasename(name), bytes: normalizeZipBytes(bytes, `Clawd asset ${name}`) }));
  const names = new Set();
  for (const entry of entries) {
    if (names.has(entry.name)) fail('DUPLICATE_CLAWD_ASSET', `Clawd asset is declared more than once: ${entry.name}`);
    names.add(entry.name);
    if (!entry.name.toLowerCase().endsWith('.webp')) fail('INVALID_CLAWD_ASSET', `Clawd asset must be WebP output: ${entry.name}`);
    if (!entry.bytes.length) fail('INVALID_CLAWD_ASSET', `Clawd asset cannot be empty: ${entry.name}`);
  }
  const zip = resolveZip(zipModule);
  const required = ['ZipWriter', 'Uint8ArrayWriter', 'Uint8ArrayReader'];
  if (required.some((name) => typeof zip[name] !== 'function')) fail('ZIP_BUILDER_UNAVAILABLE', 'The zip.js package builder is missing a required writer API.');
  entries.sort((left, right) => left.name.localeCompare(right.name));
  try {
    const writer = new zip.ZipWriter(new zip.Uint8ArrayWriter('application/zip'));
    const files = [`${root}/theme.json`, `${root}/README.md`, ...entries.map(entry => `${root}/assets/${entry.name}`)];
    await writer.add(`${root}/theme.json`, new zip.Uint8ArrayReader(petJson));
    await writer.add(`${root}/README.md`, new zip.Uint8ArrayReader(Buffer.from(readmeText, 'utf8')));
    for (const entry of entries) await writer.add(`${root}/assets/${entry.name}`, new zip.Uint8ArrayReader(entry.bytes));
    const data = await writer.close();
    const buffer = normalizeZipBytes(data, 'ZIP output');
    if (!buffer.length) fail('ZIP_BUILDER_INVALID_OUTPUT', 'The ZIP builder returned an empty archive.');
    const warnings = [];
    if (buffer.byteLength > maxBytes) {
      const largestAssets = entries.slice().sort((left, right) => right.bytes.byteLength - left.bytes.byteLength).slice(0, 5).map(entry => ({ name: entry.name, byteLength: entry.bytes.byteLength }));
      warnings.push(clawdPackageSizeWarning(buffer.byteLength, maxBytes, largestAssets));
    }
    return { format: 'zip', buffer, files, themeId: root, byteLength: buffer.byteLength, warnings };
  } catch (error) {
    if (error instanceof PackageBuildError) throw error;
    fail('ZIP_BUILDER_FAILED', `The zip.js package builder failed: ${error && error.message ? error.message : error}`);
  }
}

async function buildClawdTheme(input = {}, options = {}) {
  const mapping = input.mapping || input;
  const framesByMotion = input.framesByMotion || input.frames;
  const signal = options.signal || input.signal;
  const onProgress = options.onProgress || input.onProgress;
  const render = options.render || (options.renderPreset ? { preset: options.renderPreset } : {});
  const renderSelection = resolveTargetRenderPreset('clawd', render);
  const rawCacheContext = options.cacheContext;
  const visualSettingsIdentity = resolveVisualSettings(options.visualSettings !== undefined ? options.visualSettings : input.visualSettings, rawCacheContext);
  const cacheContext = withVisualSettingsCacheContext(rawCacheContext, visualSettingsIdentity.settings, visualSettingsIdentity.digest);
  const expressionByMotion = input.expressionByMotion || options.expressionByMotion || {};
  const cache = options.cache;
  const cacheEnabled = encodedCacheIdentityAvailable(cache, cacheContext);
  const cacheStats = { enabled: cacheEnabled, hits: 0, misses: 0 };
  checkCancelled(signal);
  progress(onProgress, CLAWD_STAGES[0], 'started');
  const target = createClawdTarget(mapping);
  const motionIds = collectClawdMotionIds(target, input.behavior);
  if (!framesByMotion || typeof framesByMotion !== 'object' || Array.isArray(framesByMotion)) fail('INVALID_CLAWD_FRAME_SET', 'framesByMotion must be an object keyed by Motion id.');
  for (const motionId of motionIds) if (!Object.hasOwn(framesByMotion, motionId)) fail('MISSING_CLAWD_FRAME_SET', `${motionId} is mapped but has no captured frames.`);
  const { themeId, metadata } = normalizeClawdMetadata(input.metadata || {});
  const artifactName = createArtifactFilename({ packageId: themeId, target: 'clawd' });
  progress(onProgress, CLAWD_STAGES[0], 'completed', { motions: motionIds.length });
  checkCancelled(signal);

  const encodingConcurrency = resolveClawdEncodingConcurrency(options.encodingConcurrency);
  progress(onProgress, CLAWD_STAGES[1], 'started', { motions: motionIds.length, total: motionIds.length, concurrency: encodingConcurrency });
  const assetsByMotion = {};
  const assets = {};
  const assetReports = [];
  const usedSlugs = new Set();
  const jobs = motionIds.map((motionId, index) => {
    checkCancelled(signal);
    const frameSet = normalizeClawdFrameSet(framesByMotion[motionId], motionId, renderSelection.settings);
    const expectedExpressionId = Object.hasOwn(expressionByMotion, motionId) ? (expressionByMotion[motionId] || null) : null;
    if (frameSet.expressionId !== expectedExpressionId) {
      fail('RECIPE_CAPTURE_MISMATCH', `Captured frames for ${motionId} use Expression ${frameSet.expressionId || 'none'}, but the project recipe requires ${expectedExpressionId || 'none'}.`);
    }
    const firstFrame = frameSet.frames[0];
    const delays = Array.isArray(frameSet.delay) ? [...frameSet.delay] : Array(frameSet.frames.length).fill(frameSet.delay);
    const cacheKey = cacheEnabled ? encodedAssetCacheKey({
      cacheContext,
      target: 'clawd',
      targetVersion: target.contractVersion,
      renderPreset: renderSelection.name,
      recipe: {
        motionId,
        expressionId: frameSet.expressionId || null,
        frameIds: frameSet.frames.map((frame, index) => typeof frame.id === 'string' && frame.id ? frame.id : `frame-${index}`),
        render: { width: firstFrame && firstFrame.width, height: firstFrame && firstFrame.height, delays, quality: frameSet.quality, alphaQuality: frameSet.alphaQuality, lossless: frameSet.lossless },
        encoderVersion: cacheContext.encoderVersion,
      },
      visualSettingsDigest: visualSettingsIdentity.digest,
    }) : null;
    return { motionId, index, frameSet, firstFrame, delays, cacheKey };
  });
  let completedEncodes = 0;
  const encodedResults = await mapConcurrentOrdered(jobs, encodingConcurrency, async (job) => {
    checkCancelled(signal);
    const { motionId, index, frameSet, firstFrame, delays, cacheKey } = job;
    progress(onProgress, CLAWD_STAGES[1], 'motion-started', { motionId, index, total: motionIds.length });
    let encoded = null;
    let cacheStatus = cacheEnabled ? 'miss' : 'disabled';
    if (cacheKey) {
      const cached = cache.get(cacheKey);
      if (cached) {
        try {
          const decoded = decodeAsset(cached.data);
          if (firstFrame && decoded.format === 'webp' && decoded.width === firstFrame.width && decoded.height === firstFrame.height && decoded.frameCount === frameSet.frames.length && decoded.delays.length === delays.length) {
            encoded = { format: decoded.format, buffer: decoded.bytes, frameCount: decoded.frameCount, width: decoded.width, height: decoded.height, delays: decoded.delays, info: null };
            cacheStats.hits += 1;
            cacheStatus = 'hit';
          }
        } catch (error) {
          if (error instanceof AssetCacheError && typeof cache.removeFiles === 'function') cache.removeFiles(cacheKey.digest);
        }
      }
    }
    if (!encoded) {
      checkCancelled(signal);
      if (cacheEnabled) cacheStats.misses += 1;
      encoded = await encodeAnimatedWebp({ ...frameSet, width: firstFrame && firstFrame.width, height: firstFrame && firstFrame.height }, { sharpFactory: options.sharpFactory, signal });
      checkCancelled(signal);
      if (cacheKey) cache.put(cacheKey, encodeAsset({ format: encoded.format, width: encoded.width, height: encoded.height, frameCount: encoded.frameCount, delays: encoded.delays, bytes: encoded.buffer }), { projectId: cacheContext.projectId, sourceFingerprint: cacheContext.sourceFingerprint, artifact: 'encoded-webp' });
    }
    checkCancelled(signal);
    completedEncodes += 1;
    progress(onProgress, CLAWD_STAGES[1], 'motion-completed', { motionId, index, completed: completedEncodes, total: motionIds.length, fraction: completedEncodes / motionIds.length, cache: cacheStatus, frameCount: encoded.frameCount });
    return { motionId, encoded };
  }, signal);
  for (const { motionId, encoded } of encodedResults) {
    const assetName = `${themeId}-${clawdAssetSlug(motionId, usedSlugs)}.webp`;
    assetsByMotion[motionId] = assetName;
    assets[assetName] = encoded.buffer;
    assetReports.push({ motionId, file: assetName, frameCount: encoded.frameCount, width: encoded.width, height: encoded.height, byteLength: encoded.buffer.byteLength, delays: encoded.delays });
  }
  progress(onProgress, CLAWD_STAGES[1], 'completed', { assets: assetReports.length, cacheHits: cacheStats.hits, cacheMisses: cacheStats.misses, concurrency: encodingConcurrency });
  checkCancelled(signal);

  progress(onProgress, CLAWD_STAGES[2], 'started');
  const bindings = clawdThemeBindings(target, assetsByMotion);
  const behaviorMetadata = { ...deriveClawdBehaviorMetadata(metadata, target, assetsByMotion), ...normalizeClawdBehaviorInput(input.behavior, assetsByMotion) };
  const manifest = { ...behaviorMetadata, states: bindings.states, sleepSequence: { mode: target.sleepSequence.mode }, reactions: bindings.reactions };
  progress(onProgress, CLAWD_STAGES[2], 'completed', { states: Object.keys(bindings.states).length, reactions: Object.keys(bindings.reactions).length });
  checkCancelled(signal);

  const validation = validateClawdThemePackage({
    themeId,
    manifest,
    assets: Object.fromEntries(assetReports.map((asset) => [asset.file, { byteLength: asset.byteLength }])),
  });
  if (!validation.ok) fail('TARGET_VALIDATION_FAILED', 'The generated Clawd theme failed Target Profile validation.', { target: 'clawd', errors: validation.errors });

  progress(onProgress, CLAWD_STAGES[3], 'started');
  const preview = createClawdPreview({ manifest, assets: assetReports });
  progress(onProgress, CLAWD_STAGES[3], 'completed', { ready: preview.ready, missingStates: preview.missingStates.length, missingReactions: preview.missingReactions.length });
  checkCancelled(signal);

  let packaged = null;
  if (options.package === true) {
    progress(onProgress, CLAWD_STAGES[4], 'started');
    packaged = await createClawdThemeZip({ themeId, manifest, assets, readme: input.readme, zipModule: options.zipModule, maxBytes: options.maxBytes ?? CLAWD_PACKAGE_LIMIT });
    packaged.artifactName = artifactName;
    validation.warnings.push(...packaged.warnings);
    checkCancelled(signal);
    progress(onProgress, CLAWD_STAGES[4], 'completed', { byteLength: packaged.byteLength });
  }
  const result = {
    buildContractVersion: BUILD_CONTRACT_VERSION,
    target: target.profile,
    targetContractVersion: target.contractVersion,
    themeId,
    artifactName,
    manifest,
    assets: assetReports,
    warnings: [...(target.warnings || []), ...validation.warnings],
    validation,
    encoding: { required: 'webp', status: 'completed', assetCount: assetReports.length },
    provenance: buildProvenance('clawd', target.contractVersion, render, cacheContext && cacheContext.encoderVersion),
    package: packaged,
    preview,
    cache: cacheStats,
  };
  result.report = createBuildReport({ build: result });
  progress(onProgress, CLAWD_STAGES[5], 'started');
  progress(onProgress, CLAWD_STAGES[5], 'completed', { packageByteLength: packaged ? packaged.byteLength : 0, previewReady: preview.ready });
  return result;
}

async function buildCodexPet(input = {}, options = {}) {
  const spriteVersionNumber = options.spriteVersionNumber ?? 1;
  if (![1, 2].includes(spriteVersionNumber)) fail('INVALID_SPRITE_VERSION', 'Codex sprite version must be 1 or 2.');
  const spriteAtlas = CODEX_PROFILE.atlases[spriteVersionNumber];
  const mapping = input.mapping || input;
  const candidatesByRow = input.candidatesByRow || input.candidates;
  const signal = options.signal || input.signal;
  const onProgress = options.onProgress || input.onProgress;
  const render = options.render || (options.renderPreset ? { preset: options.renderPreset } : {});
  const renderSelection = resolveTargetRenderPreset('codex-pet', render);
  const target = createCodexTarget(mapping);
  const rawCacheContext = options.cacheContext;
  const visualSettingsIdentity = resolveVisualSettings(options.visualSettings !== undefined ? options.visualSettings : input.visualSettings, rawCacheContext);
  const cacheContext = withVisualSettingsCacheContext(rawCacheContext, visualSettingsIdentity.settings, visualSettingsIdentity.digest);
  const cache = options.cache;
  const cacheEnabled = encodedCacheIdentityAvailable(cache, cacheContext);
  const cacheStats = { enabled: cacheEnabled, hits: 0, misses: 0 };
  checkCancelled(signal);

  progress(onProgress, STAGES[0], 'started');
  const selection = selectCodexFrameSets({ ...mapping, candidatesByRow }, options.selection || {});
  checkCancelled(signal);
  progress(onProgress, STAGES[0], 'completed', { rows: Object.keys(selection.frameSets).length });

  progress(onProgress, STAGES[1], 'started');
  const atlasPlan = createCodexAtlasPlan({ ...mapping, framesByRow: selection.frameSets });
  checkCancelled(signal);
  progress(onProgress, STAGES[1], 'completed', { cells: atlasPlan.cells.length });

  progress(onProgress, STAGES[2], 'started');
  const atlas = composeCodexAtlasRgba(atlasPlan, captureMap(selection.frameSets));
  if (spriteVersionNumber === 2) {
    const rgba = new Uint8Array(spriteAtlas.width * spriteAtlas.height * 4);
    rgba.set(atlas.rgba);
    // Compatibility mode: all look directions use the first idle pose, not an invented animation.
    for (let direction = 0; direction < 16; direction += 1) {
      const x = direction % 8 * ATLAS.cellWidth;
      const y = (9 + Math.floor(direction / 8)) * ATLAS.cellHeight;
      for (let row = 0; row < ATLAS.cellHeight; row += 1) {
        const source = row * ATLAS.width * 4;
        rgba.set(atlas.rgba.subarray(source, source + ATLAS.cellWidth * 4), ((y + row) * spriteAtlas.width + x) * 4);
      }
    }
    atlas.rgba = rgba;
    atlas.height = spriteAtlas.height;
    atlas.occupiedCells += 16;
  }
  checkCancelled(signal);
  progress(onProgress, STAGES[2], 'completed', { occupiedCells: atlas.occupiedCells, transparentCells: atlas.transparentCells });

  const packageRequested = options.package === true;
  const encodeRequested = packageRequested || options.encode === true;
  let encoded = null;
  if (encodeRequested) {
    progress(onProgress, STAGES[3], 'started');
    const quality = options.quality ?? 80;
    const alphaQuality = options.alphaQuality ?? 100;
    const lossless = options.lossless ?? false;
    const cacheKey = cacheEnabled ? encodedAssetCacheKey({
      cacheContext,
      target: 'codex-pet',
      targetVersion: target.contractVersion,
      renderPreset: renderSelection.name,
      recipe: {
        rows: Object.fromEntries(Object.entries(selection.frameSets).map(([rowId, frames]) => [rowId, frames.map((frame, index) => typeof frame.id === 'string' && frame.id ? frame.id : `frame-${index}`)])),
        atlas: { ...spriteAtlas },
        spriteVersionNumber,
        encoding: { quality, alphaQuality, lossless },
        encoderVersion: cacheContext.encoderVersion,
      },
      visualSettingsDigest: visualSettingsIdentity.digest,
    }) : null;
    if (cacheKey) {
      const cached = cache.get(cacheKey);
      if (cached) {
        try {
          const decoded = decodeAsset(cached.data);
          if (decoded.format === 'webp' && decoded.width === atlas.width && decoded.height === atlas.height && decoded.frameCount === 1) {
            encoded = { format: decoded.format, buffer: decoded.bytes, frameCount: decoded.frameCount, width: decoded.width, height: decoded.height, delays: decoded.delays, info: null };
            cacheStats.hits += 1;
          }
        } catch (error) {
          if (error instanceof AssetCacheError && typeof cache.removeFiles === 'function') cache.removeFiles(cacheKey.digest);
        }
      }
    }
    if (!encoded) {
      if (cacheEnabled) cacheStats.misses += 1;
      encoded = await encodeAnimatedWebp({ frames: [{ width: atlas.width, height: atlas.height, rgba: atlas.rgba }], width: atlas.width, height: atlas.height, quality, alphaQuality, lossless }, { sharpFactory: options.sharpFactory, signal });
      if (cacheKey) cache.put(cacheKey, encodeAsset({ format: encoded.format, width: encoded.width, height: encoded.height, frameCount: encoded.frameCount, delays: encoded.delays, bytes: encoded.buffer }), { projectId: cacheContext.projectId, sourceFingerprint: cacheContext.sourceFingerprint, artifact: 'encoded-webp' });
    }
    checkCancelled(signal);
    progress(onProgress, STAGES[3], 'completed', { format: encoded.format, byteLength: encoded.buffer.length, cacheHits: cacheStats.hits, cacheMisses: cacheStats.misses });
  }

  progress(onProgress, STAGES[4], 'started');
  const metadata = normalizeCodexMetadata(input.metadata || {});
  const artifactName = createArtifactFilename({ packageId: metadata.id, target: 'codex-pet' });
  const manifest = {
    ...metadata,
    schemaVersion: BUILD_CONTRACT_VERSION,
    target: target.profile,
    contractVersion: target.contractVersion,
    packageFiles: target.packageFiles,
    spriteVersionNumber,
    ...(spriteVersionNumber === 2 ? { gaze: { mode: 'neutral', directions: 16, rows: [9, 10] } } : {}),
    atlas: { ...spriteAtlas },
    rows: atlasPlan.rows.map((row) => ({
      id: row.id,
      row: row.row,
      frameCount: row.frames.length,
      frames: row.frames.map(frameMetadata),
      transparentCells: row.cells.filter((cell) => cell.transparent).length,
    })),
  };
  if (encoded) manifest.assets = { spritesheet: { path: 'spritesheet.webp', format: encoded.format, width: encoded.width, height: encoded.height, frameCount: encoded.frameCount } };
  checkCancelled(signal);
  progress(onProgress, STAGES[4], 'completed');

  const validation = validateCodexPetPackage({
    files: packageRequested ? [...PACKAGE_FILES] : undefined,
    manifest,
    spritesheet: { path: 'spritesheet.webp', format: 'webp', width: atlas.width, height: atlas.height, frameCount: 1, ...(encoded ? { byteLength: encoded.buffer.byteLength } : {}) },
  });
  if (!validation.ok) fail('TARGET_VALIDATION_FAILED', 'The generated Codex Pet failed Target Profile validation.', { target: 'codex-pet', errors: validation.errors });

  progress(onProgress, STAGES[5], 'started');
  const preview = createCodexPreview({ manifest, selections: selection.selections });
  progress(onProgress, STAGES[5], 'completed', { ready: preview.ready, rows: preview.rows.length });
  checkCancelled(signal);

  let packaged = null;
  if (packageRequested) {
    progress(onProgress, STAGES[6], 'started');
    packaged = await createCodexPetZip({ manifest, spritesheet: encoded.buffer, zipModule: options.zipModule });
    packaged.artifactName = artifactName;
    checkCancelled(signal);
    progress(onProgress, STAGES[6], 'completed', { byteLength: packaged.byteLength });
  }

  const result = {
    buildContractVersion: BUILD_CONTRACT_VERSION,
    target: target.profile,
    artifactName,
    manifest,
    atlas,
    selections: selection.selections,
    warnings: [],
    validation,
    encoding: encoded ? { required: 'webp', status: 'completed', format: encoded.format, frameCount: encoded.frameCount, width: encoded.width, height: encoded.height, byteLength: encoded.buffer.length } : { required: 'webp', status: 'pending', reason: 'Set encode:true or package:true to convert atlas.rgba to spritesheet.webp.' },
    provenance: buildProvenance('codex-pet', target.contractVersion, render, cacheContext && cacheContext.encoderVersion),
    spritesheet: encoded ? encoded.buffer : null,
    package: packaged,
    preview,
    cache: cacheStats,
  };
  result.report = createBuildReport({ build: result });
  progress(onProgress, STAGES[7], 'started');
  progress(onProgress, STAGES[7], 'completed', { packageByteLength: packaged ? packaged.byteLength : 0, previewReady: preview.ready });
  return result;
}

async function buildProjectTargets({ project, inputsByTarget = {}, targets = ['clawd', 'codex-pet'], metadataByTarget = {}, optionsByTarget = {}, signal, onProgress } = {}) {
  const normalizedProject = validateProject(project);
  const projectVisualSettings = normalizeBuildVisualSettings(normalizedProject.visualSettings);
  const projectVisualSettingsDigest = projectVisualSettings.hiddenElementIds.length ? digestVisualSettings(projectVisualSettings) : null;
  const nameSlug = normalizedProject.name.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
  const defaultMetadata = { name: normalizedProject.name, id: /[^\x00-\x7f]/.test(normalizedProject.name)
    ? `${nameSlug || 'pet'}-${createHash('sha256').update(normalizedProject.name).digest('hex').slice(0, 10)}`
    : nameSlug || normalizedProject.projectId };
  assertProjectBuildable(normalizedProject);
  if (!Array.isArray(targets) || !targets.length || targets.some((target) => !['clawd', 'codex-pet'].includes(target))) fail('INVALID_BUILD_TARGETS', 'targets must contain clawd and/or codex-pet.');
  const uniqueTargets = [...new Set(targets)];
  const builds = {};
  const warnings = [];
  for (const targetId of uniqueTargets) {
    const targetStartedAt = Date.now();
    const stageStartedAt = new Map();
    const stageDurations = {};
    checkCancelled(signal);
    const targetInput = inputsByTarget[targetId] || {};
    const targetProject = normalizedProject.targets[targetId];
    if (!targetProject || !targetProject.mappings || !Object.keys(targetProject.mappings).length) fail('TARGET_MAPPING_REQUIRED', `${targetId} has no mappings in the Live2Pet Project.`);
    const targetOptions = { ...(optionsByTarget[targetId] || {}), signal, onProgress: (event) => {
      const now = Date.now();
      if (event.status === 'started') stageStartedAt.set(event.stage, now);
      if (event.status === 'completed' && stageStartedAt.has(event.stage)) {
        stageDurations[event.stage] = (stageDurations[event.stage] || 0) + Math.max(0, now - stageStartedAt.get(event.stage));
        stageStartedAt.delete(event.stage);
      }
      onProgress?.({ target: targetId, ...event });
    } };
    const defaultCacheContext = {
      sourceFingerprint: normalizedProject.source.fingerprint,
      runtimeVersion: targetOptions.runtimeVersion,
      rendererVersion: targetOptions.rendererVersion,
      targetVersion: targetOptions.targetVersion || '1',
      encoderVersion: targetOptions.encoderVersion,
      projectId: normalizedProject.projectId,
    };
    targetOptions.cacheContext = withVisualSettingsCacheContext(targetOptions.cacheContext || defaultCacheContext, projectVisualSettings, projectVisualSettingsDigest);
    targetOptions.visualSettings = projectVisualSettings;
    const expressionByMotion = resolveProjectRecipeExpressions(normalizedProject, targetProject, targetId);
    const configuredRender = targetInput.render
      || (targetInput.renderPreset ? { preset: targetInput.renderPreset } : null)
      || targetOptions.render
      || { preset: targetProject.renderPreset || 'balanced', ...targetProject.options?.renderOverrides };
    targetOptions.render = configuredRender;
    const renderer = targetInput.renderer || targetOptions.renderer;
    let renderedInput = targetInput;
    if (renderer) {
      if (targetId === 'clawd' && !targetInput.framesByMotion && !targetInput.frames) {
        await applyRendererVisualSettings(renderer, projectVisualSettings, targetId);
        const ids = mappedMotionIds({ ...targetProject.mappings, ...targetProject.reactions });
        const framesByMotion = await renderMappedMotions({ renderer, motionIds: ids, expressionByMotion, visualSettings: projectVisualSettings, render: targetInput.render || (targetInput.renderPreset ? { preset: targetInput.renderPreset } : targetOptions.render), signal, onProgress: targetOptions.onProgress, target: targetId, cache: targetOptions.cache, cacheContext: targetOptions.cacheContext });
        renderedInput = { ...targetInput, framesByMotion };
      } else if (targetId === 'codex-pet' && !targetInput.candidatesByRow && !targetInput.candidates) {
        await applyRendererVisualSettings(renderer, projectVisualSettings, targetId);
        targetOptions.selection = { ...targetOptions.selection, preserveTiming: true };
        const ids = mappedMotionIds(targetProject.mappings);
        const framesByMotion = await renderMappedMotions({ renderer, motionIds: ids, expressionByMotion, visualSettings: projectVisualSettings, render: targetInput.render || (targetInput.renderPreset ? { preset: targetInput.renderPreset } : targetOptions.render), signal, onProgress: targetOptions.onProgress, target: targetId, cache: targetOptions.cache, cacheContext: targetOptions.cacheContext });
        const candidatesByRow = Object.fromEntries(Object.entries(targetProject.mappings).map(([row, value]) => [row, framesByMotion[value.slice(7)]?.frames || []]));
        renderedInput = { ...targetInput, candidatesByRow };
      }
    }
    let result;
    if (targetId === 'clawd') {
      result = await buildClawdTheme({
        mapping: { sleepMode: targetProject.options.sleepMode || 'direct', states: targetProject.mappings, reactions: targetProject.reactions },
        framesByMotion: renderedInput.framesByMotion || renderedInput.frames,
        expressionByMotion,
        behavior: targetProject.options.behavior,
        metadata: metadataByTarget[targetId] || renderedInput.metadata || defaultMetadata,
        readme: renderedInput.readme,
      }, targetOptions);
    } else {
      result = await buildCodexPet({
        mapping: { mappings: targetProject.mappings },
        candidatesByRow: renderedInput.candidatesByRow || renderedInput.candidates,
        metadata: metadataByTarget[targetId] || renderedInput.metadata || defaultMetadata,
      }, targetOptions);
    }
    result.timings = { totalMs: Math.max(0, Date.now() - targetStartedAt), stages: stageDurations };
    result.report = createBuildReport({ build: result, projectId: normalizedProject.projectId, source: normalizedProject.source });
    builds[targetId] = result;
    warnings.push(...(result.warnings || []).map((warning) => ({ target: targetId, ...warning })));
  }
  return { buildContractVersion: BUILD_CONTRACT_VERSION, projectId: normalizedProject.projectId, targets: uniqueTargets, builds, warnings };
}

module.exports = {
  BUILD_CONTRACT_VERSION,
  SHARP_ENCODER_VERSION,
  BUILD_REPORT_SCHEMA_VERSION,
  ASSET_CACHE_SCHEMA_VERSION,
  AssetCacheError,
  CAPTURE_CACHE_COMPRESSION,
  CAPTURE_CACHE_SCHEMA_VERSION,
  CaptureCacheError,
  MAX_CAPTURE_CACHE_BYTES,
  MAX_CAPTURE_CACHE_CHUNK_BYTES,
  MAX_CAPTURE_CACHE_DIMENSION,
  MAX_CAPTURE_CACHE_FRAME_BYTES,
  MAX_CAPTURE_CACHE_FRAMES,
  CLAWD_PACKAGE_LIMIT,
  DEFAULT_CLAWD_ENCODING_CONCURRENCY,
  MAX_RGBA_CHUNK_BYTES,
  MAX_RGBA_FRAME_BYTES,
  MAX_RGBA_FRAME_DIMENSION,
  MAX_STACKED_RGBA_BYTES,
  RGBA_FRAME_COMPRESSION,
  RGBA_STACK_COMPRESSION,
  CacheError,
  CacheStore,
  DEFAULT_CACHE_LIMIT,
  CLAWD_STAGES,
  MAX_ENCODE_FRAMES,
  PackageBuildError,
  PREVIEW_CONTRACT_VERSION,
  FRAME_CACHE_SCHEMA_VERSION,
  FrameCacheError,
  STAGES,
  TargetPreviewError,
  TARGET_RENDER_PRESETS,
  TARGET_PROFILES,
  buildClawdTheme,
  buildCodexPet,
  buildProjectTargets,
  buildProvenance,
  createArtifactFilename,
  createBuildReport,
  createCodexPetZip,
  createClawdThemeZip,
  createClawdPreview,
  createCodexPreview,
  createTargetPreview,
  decodeCompressedRgbaFrame,
  decodeCompressedRgbaStack,
  decodeCaptureSet,
  decodeAsset,
  createCacheKey,
  encodeAsset,
  encodeAnimatedWebp,
  encodeCaptureSet,
  renderMappedMotions,
  resolveTargetRenderPreset,
  decodeFrameSet,
  encodeFrameSet,
  normalizeCodexMetadata,
};
