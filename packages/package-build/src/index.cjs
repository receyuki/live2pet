const {
  ATLAS,
  createCodexAtlasPlan,
  createCodexTarget,
  selectCodexFrameSets,
} = require('../../codex-target/src/index.cjs');
const { composeCodexAtlasRgba } = require('../../codex-target/src/index.cjs');
const { createClawdTarget, validateClawdThemePackage } = require('../../clawd-target/src/index.cjs');
const { validateCodexPetPackage } = require('../../codex-target/src/index.cjs');
const { assertProjectBuildable, validateProject } = require('../../project/src/index.cjs');
const { sampleMotionCandidates } = require('../../renderer/src/index.cjs');
const { CacheError, CacheStore, DEFAULT_CACHE_LIMIT, createCacheKey } = require('./cache.cjs');
const { createClawdPreview, createCodexPreview, createTargetPreview, PREVIEW_CONTRACT_VERSION, TargetPreviewError } = require('./preview.cjs');
const { decodeFrameSet, encodeFrameSet, FRAME_CACHE_SCHEMA_VERSION, FrameCacheError } = require('./frame-cache.cjs');

const BUILD_CONTRACT_VERSION = 1;
const STAGES = Object.freeze(['select', 'layout', 'compose', 'encode', 'manifest', 'preview', 'package', 'report']);
const CLAWD_STAGES = Object.freeze(['validate', 'encode', 'manifest', 'preview', 'package', 'report']);
const MAX_ENCODE_FRAMES = 4096;
const PACKAGE_FILES = Object.freeze(['pet.json', 'spritesheet.webp']);
const CLAWD_PACKAGE_LIMIT = 83_886_080;
const BUILD_REPORT_SCHEMA_VERSION = 1;
const TARGET_RENDER_PRESETS = Object.freeze({
  clawd: Object.freeze({
    compact: Object.freeze({ width: 512, height: 512, fps: 18, quality: 76, alphaQuality: 100 }),
    balanced: Object.freeze({ width: 768, height: 768, fps: 24, quality: 82, alphaQuality: 100 }),
    high: Object.freeze({ width: 1024, height: 1024, fps: 30, quality: 88, alphaQuality: 100 }),
  }),
  'codex-pet': Object.freeze({
    compact: Object.freeze({ width: 192, height: 208, samplesPerSecond: 32 }),
    balanced: Object.freeze({ width: 192, height: 208, samplesPerSecond: 64 }),
    high: Object.freeze({ width: 192, height: 208, samplesPerSecond: 96 }),
  }),
});

class PackageBuildError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'PackageBuildError';
    this.code = code;
    this.details = details;
  }
}

function resolveTargetRenderPreset(target, render = {}) {
  const presetName = typeof render.preset === 'string' && render.preset.trim()
    ? render.preset.trim().toLowerCase()
    : 'balanced';
  const preset = TARGET_RENDER_PRESETS[target] && TARGET_RENDER_PRESETS[target][presetName];
  if (!preset) fail('INVALID_RENDER_PRESET', `Unknown ${target || 'target'} Render Preset: ${presetName}.`, { target, preset: presetName, available: Object.keys(TARGET_RENDER_PRESETS[target] || {}) });
  return { name: presetName, settings: { ...preset } };
}

function buildProvenance(target, targetContractVersion, render = {}) {
  const selection = resolveTargetRenderPreset(target, render);
  return {
    schemaVersion: 1,
    buildContractVersion: BUILD_CONTRACT_VERSION,
    targetProfile: target,
    targetContractVersion,
    renderPreset: selection.name,
    render: selection.settings,
    encoder: { name: 'sharp', format: 'webp' },
  };
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
      package: build.package ? { format: build.package.format, byteLength: build.package.byteLength, files: [...(build.package.files || [])] } : null,
    },
    preview: build.preview ? { target: build.preview.target, source: build.preview.source, ready: build.preview.ready === true } : null,
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

function progress(onProgress, stage, status, details = {}) {
  if (typeof onProgress === 'function') onProgress({ stage, status, ...details });
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

function rendererMotionDescriptor(renderer, motionId) {
  const collections = [renderer && renderer.source && renderer.source.motions, renderer && renderer.motions].filter(Array.isArray);
  for (const collection of collections) {
    const motion = collection.find((item) => item && item.id === motionId);
    if (motion) return motion;
  }
  return null;
}

async function renderMappedMotions({ renderer, motionIds, render = {}, signal, onProgress, target, cache, cacheContext } = {}) {
  if (!renderer || typeof renderer.captureRgba !== 'function') fail('RENDERER_REQUIRED', 'A renderer implementing captureRgba is required when build inputs do not include captured frames.');
  if (!Array.isArray(motionIds) || !motionIds.length) fail('MOTION_MAPPING_REQUIRED', `No ${target || 'target'} Motion mappings are available for renderer capture.`);
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
    const duration = configuredDuration == null ? 1 : Number(configuredDuration);
    if (!Number.isFinite(duration) || duration < 0 || duration > 3600) fail('INVALID_MOTION_DURATION', `Motion ${motionId} has no valid duration for renderer capture.`);
    const samples = configuredSamples || (target === 'codex-pet'
      ? Math.max(2, Math.ceil(duration * preset.samplesPerSecond))
      : Math.max(2, Math.ceil(duration * preset.fps)));
    const cacheKey = cacheEnabled ? createCacheKey({
      sourceFingerprint: cacheContext.sourceFingerprint,
      runtimeVersion: cacheContext.runtimeVersion,
      rendererVersion: cacheContext.rendererVersion,
      recipe: {
        motionId,
        expressionId: cacheContext.expressionId || null,
        render: { width, height, samples, duration, fps: Number.isFinite(render.fps) ? render.fps : null },
      },
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
            progress(onProgress, 'render', 'completed', { target, motionId, samples: decoded.frames.length, cache: 'hit' });
            continue;
          }
        } catch (error) {
          if (error instanceof FrameCacheError && typeof cache.removeFiles === 'function') cache.removeFiles(cacheKey.digest);
        }
      }
    }
    progress(onProgress, 'render', 'started', { target, motionId, width, height, samples, duration });
    const result = await sampleMotionCandidates(renderer, { motionId, duration, samples, width, height });
    checkCancelled(signal);
    framesByMotion[motionId] = {
      frames: result.candidates,
      fps: Number.isFinite(render.fps) ? render.fps : (render.preset ? (preset.fps || (duration > 0 ? samples / duration : 10)) : (duration > 0 ? samples / duration : 10)),
    };
    if (cacheKey) cache.put(cacheKey, encodeFrameSet({ motionId, ...framesByMotion[motionId] }), { projectId: cacheContext.projectId, sourceFingerprint: cacheContext.sourceFingerprint, artifact: 'render-candidates' });
    progress(onProgress, 'render', 'completed', { target, motionId, samples: result.candidates.length });
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

function normalizeEncodeFrames(frames, width, height) {
  if (!Array.isArray(frames) || !frames.length || frames.length > MAX_ENCODE_FRAMES) fail('INVALID_WEBP_INPUT', `WebP encoding requires between 1 and ${MAX_ENCODE_FRAMES} frames.`);
  if (!Number.isInteger(width) || width < 1 || !Number.isInteger(height) || height < 1) fail('INVALID_WEBP_INPUT', 'WebP width and height must be positive integers.');
  return frames.map((frame, index) => {
    if (!frame || !ArrayBuffer.isView(frame.rgba) || frame.width !== width || frame.height !== height || frame.rgba.byteLength !== width * height * 4) fail('INVALID_WEBP_INPUT', `Frame ${index} must contain ${width}×${height} RGBA bytes.`);
    return Buffer.from(frame.rgba.buffer, frame.rgba.byteOffset, frame.rgba.byteLength);
  });
}

async function encodeAnimatedWebp({ frames, width, height, delay = 100, loop = 0, quality = 80, alphaQuality = 100, lossless = false } = {}, { sharpFactory } = {}) {
  const normalizedFrames = normalizeEncodeFrames(frames, width, height);
  if (!Number.isInteger(loop) || loop < 0 || loop > 65535) fail('INVALID_WEBP_INPUT', 'WebP loop count must be an integer between 0 and 65535.');
  if (!Number.isFinite(quality) || quality < 0 || quality > 100 || !Number.isFinite(alphaQuality) || alphaQuality < 0 || alphaQuality > 100) fail('INVALID_WEBP_INPUT', 'WebP quality values must be between 0 and 100.');
  const delays = Array.isArray(delay) ? delay : Array(normalizedFrames.length).fill(delay);
  if (delays.length !== normalizedFrames.length || delays.some((value) => !Number.isInteger(value) || value < 1 || value > 60000)) fail('INVALID_WEBP_INPUT', 'WebP delays must contain one integer millisecond value per frame between 1 and 60000.');
  const stacked = Buffer.concat(normalizedFrames);
  const sharp = resolveSharp(sharpFactory);
  try {
    const result = await sharp(stacked, { animated: normalizedFrames.length > 1, raw: { width, height: height * normalizedFrames.length, channels: 4, pageHeight: height } })
      .webp({ quality, alphaQuality, lossless, loop, delay: delays })
      .toBuffer({ resolveWithObject: true });
    const buffer = Buffer.isBuffer(result) ? result : result && result.data;
    if (!buffer || !buffer.length) fail('WEBP_ENCODER_INVALID_OUTPUT', 'The WebP encoder returned an empty buffer.');
    return { format: 'webp', buffer, frameCount: normalizedFrames.length, width, height, delays, info: result && result.info ? result.info : null };
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
    eyeTracking: { enabled: false, states: [] },
    miniMode: { supported: false },
  };
  if (typeof input.license === 'string' && input.license.trim()) metadata.license = input.license.trim();
  for (const key of ['customization', 'viewBox', 'layout', 'updateBubbleAnchorBox', 'eyeTracking', 'miniMode', 'timings', 'hitBoxes', 'roamFlipAssets', 'idleAnimations', 'idleEasterEggs', 'workingTiers', 'jugglingTiers']) {
    if (input[key] !== undefined) metadata[key] = cloneJsonValue(input[key], `metadata.${key}`);
  }
  return { themeId, metadata };
}

function collectClawdMotionIds(target) {
  const ids = [];
  const seen = new Set();
  const collect = value => {
    if (typeof value !== 'string' || !value.startsWith('motion:')) return;
    const id = value.slice(7);
    if (!seen.has(id)) { seen.add(id); ids.push(id); }
  };
  Object.values(target.states || {}).forEach(collect);
  Object.values(target.reactions || {}).forEach(collect);
  return ids;
}

function normalizeClawdFrameSet(value, motionId, defaults = {}) {
  const frames = Array.isArray(value) ? value : value && Array.isArray(value.frames) ? value.frames : null;
  if (!frames || !frames.length) fail('INVALID_CLAWD_FRAME_SET', `${motionId} must provide at least one RGBA frame.`);
  const options = Array.isArray(value) ? {} : value;
  const delay = options.delay ?? (Number.isFinite(options.fps) && options.fps > 0 ? Math.round(1000 / options.fps) : 100);
  return { frames, delay, loop: options.loop ?? 0, quality: options.quality ?? defaults.quality ?? 80, alphaQuality: options.alphaQuality ?? defaults.alphaQuality ?? 100, lossless: options.lossless ?? false };
}

function clawdAssetSlug(motionId, used) {
  const base = String(motionId).toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'motion';
  let slug = base;
  let suffix = 2;
  while (used.has(slug)) slug = `${base}-${suffix++}`;
  used.add(slug);
  return slug;
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
  return { states, reactions };
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
  return { id, displayName, description, spritesheetPath: 'spritesheet.webp' };
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
    if (buffer.byteLength > maxBytes) {
      const largestAssets = entries.slice().sort((left, right) => right.bytes.byteLength - left.bytes.byteLength).slice(0, 5).map(entry => ({ name: entry.name, byteLength: entry.bytes.byteLength }));
      fail('CLAWD_PACKAGE_TOO_LARGE', `Clawd theme ZIP is ${buffer.byteLength} bytes; the maximum is ${maxBytes}.`, { byteLength: buffer.byteLength, maxBytes, largestAssets });
    }
    return { format: 'zip', buffer, files, themeId: root, byteLength: buffer.byteLength };
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
  checkCancelled(signal);
  progress(onProgress, CLAWD_STAGES[0], 'started');
  const target = createClawdTarget(mapping);
  const motionIds = collectClawdMotionIds(target);
  if (!framesByMotion || typeof framesByMotion !== 'object' || Array.isArray(framesByMotion)) fail('INVALID_CLAWD_FRAME_SET', 'framesByMotion must be an object keyed by Motion id.');
  for (const motionId of motionIds) if (!Object.hasOwn(framesByMotion, motionId)) fail('MISSING_CLAWD_FRAME_SET', `${motionId} is mapped but has no captured frames.`);
  const { themeId, metadata } = normalizeClawdMetadata(input.metadata || {});
  progress(onProgress, CLAWD_STAGES[0], 'completed', { motions: motionIds.length });
  checkCancelled(signal);

  progress(onProgress, CLAWD_STAGES[1], 'started', { motions: motionIds.length });
  const assetsByMotion = {};
  const assets = {};
  const assetReports = [];
  const usedSlugs = new Set();
  for (const motionId of motionIds) {
    checkCancelled(signal);
    const frameSet = normalizeClawdFrameSet(framesByMotion[motionId], motionId, renderSelection.settings);
    const firstFrame = frameSet.frames[0];
    const encoded = await encodeAnimatedWebp({ ...frameSet, width: firstFrame && firstFrame.width, height: firstFrame && firstFrame.height }, { sharpFactory: options.sharpFactory });
    const assetName = `${themeId}-${clawdAssetSlug(motionId, usedSlugs)}.webp`;
    assetsByMotion[motionId] = assetName;
    assets[assetName] = encoded.buffer;
    assetReports.push({ motionId, file: assetName, frameCount: encoded.frameCount, width: encoded.width, height: encoded.height, byteLength: encoded.buffer.byteLength, delays: encoded.delays });
  }
  progress(onProgress, CLAWD_STAGES[1], 'completed', { assets: assetReports.length });
  checkCancelled(signal);

  progress(onProgress, CLAWD_STAGES[2], 'started');
  const bindings = clawdThemeBindings(target, assetsByMotion);
  const manifest = { ...metadata, states: bindings.states, sleepSequence: { mode: target.sleepSequence.mode }, reactions: bindings.reactions };
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
    checkCancelled(signal);
    progress(onProgress, CLAWD_STAGES[4], 'completed', { byteLength: packaged.byteLength });
  }
  const result = {
    buildContractVersion: BUILD_CONTRACT_VERSION,
    target: target.profile,
    targetContractVersion: target.contractVersion,
    themeId,
    manifest,
    assets: assetReports,
    warnings: target.warnings || [],
    validation,
    encoding: { required: 'webp', status: 'completed', assetCount: assetReports.length },
    provenance: buildProvenance('clawd', target.contractVersion, render),
    package: packaged,
    preview,
  };
  result.report = createBuildReport({ build: result });
  progress(onProgress, CLAWD_STAGES[5], 'started');
  progress(onProgress, CLAWD_STAGES[5], 'completed', { packageByteLength: packaged ? packaged.byteLength : 0, previewReady: preview.ready });
  return result;
}

async function buildCodexPet(input = {}, options = {}) {
  const mapping = input.mapping || input;
  const candidatesByRow = input.candidatesByRow || input.candidates;
  const signal = options.signal || input.signal;
  const onProgress = options.onProgress || input.onProgress;
  const render = options.render || (options.renderPreset ? { preset: options.renderPreset } : {});
  const renderSelection = resolveTargetRenderPreset('codex-pet', render);
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
  checkCancelled(signal);
  progress(onProgress, STAGES[2], 'completed', { occupiedCells: atlas.occupiedCells, transparentCells: atlas.transparentCells });

  const packageRequested = options.package === true;
  const encodeRequested = packageRequested || options.encode === true;
  let encoded = null;
  if (encodeRequested) {
    progress(onProgress, STAGES[3], 'started');
    encoded = await encodeAnimatedWebp({ frames: [{ width: atlas.width, height: atlas.height, rgba: atlas.rgba }], width: atlas.width, height: atlas.height, quality: options.quality ?? 80, alphaQuality: options.alphaQuality ?? 100, lossless: options.lossless ?? false }, { sharpFactory: options.sharpFactory });
    checkCancelled(signal);
    progress(onProgress, STAGES[3], 'completed', { format: encoded.format, byteLength: encoded.buffer.length });
  }

  progress(onProgress, STAGES[4], 'started');
  const target = createCodexTarget(mapping);
  const metadata = normalizeCodexMetadata(input.metadata || {});
  const manifest = {
    ...metadata,
    schemaVersion: BUILD_CONTRACT_VERSION,
    target: target.profile,
    contractVersion: target.contractVersion,
    packageFiles: target.packageFiles,
    atlas: { ...ATLAS },
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
    checkCancelled(signal);
    progress(onProgress, STAGES[6], 'completed', { byteLength: packaged.byteLength });
  }

  const result = {
    buildContractVersion: BUILD_CONTRACT_VERSION,
    target: target.profile,
    manifest,
    atlas,
    selections: selection.selections,
    warnings: [],
    validation,
    encoding: encoded ? { required: 'webp', status: 'completed', format: encoded.format, frameCount: encoded.frameCount, width: encoded.width, height: encoded.height, byteLength: encoded.buffer.length } : { required: 'webp', status: 'pending', reason: 'Set encode:true or package:true to convert atlas.rgba to spritesheet.webp.' },
    provenance: buildProvenance('codex-pet', target.contractVersion, render),
    spritesheet: encoded ? encoded.buffer : null,
    package: packaged,
    preview,
  };
  result.report = createBuildReport({ build: result });
  progress(onProgress, STAGES[7], 'started');
  progress(onProgress, STAGES[7], 'completed', { packageByteLength: packaged ? packaged.byteLength : 0, previewReady: preview.ready });
  return result;
}

async function buildProjectTargets({ project, inputsByTarget = {}, targets = ['clawd', 'codex-pet'], metadataByTarget = {}, optionsByTarget = {}, signal, onProgress } = {}) {
  const normalizedProject = validateProject(project);
  assertProjectBuildable(normalizedProject);
  if (!Array.isArray(targets) || !targets.length || targets.some((target) => !['clawd', 'codex-pet'].includes(target))) fail('INVALID_BUILD_TARGETS', 'targets must contain clawd and/or codex-pet.');
  const uniqueTargets = [...new Set(targets)];
  const builds = {};
  const warnings = [];
  for (const targetId of uniqueTargets) {
    checkCancelled(signal);
    const targetInput = inputsByTarget[targetId] || {};
    const targetProject = normalizedProject.targets[targetId];
    if (!targetProject || !targetProject.mappings || !Object.keys(targetProject.mappings).length) fail('TARGET_MAPPING_REQUIRED', `${targetId} has no mappings in the Live2Pet Project.`);
    const targetOptions = { ...(optionsByTarget[targetId] || {}), signal, onProgress: (event) => onProgress?.({ target: targetId, ...event }) };
    const configuredRender = targetInput.render
      || (targetInput.renderPreset ? { preset: targetInput.renderPreset } : null)
      || targetOptions.render
      || (targetProject.renderPreset ? { preset: targetProject.renderPreset } : null)
      || (targetProject.options && targetProject.options.renderPreset ? { preset: targetProject.options.renderPreset } : {});
    targetOptions.render = configuredRender;
    const renderer = targetInput.renderer || targetOptions.renderer;
    let renderedInput = targetInput;
    if (renderer) {
      if (targetId === 'clawd' && !targetInput.framesByMotion && !targetInput.frames) {
        const ids = mappedMotionIds({ ...targetProject.mappings, ...targetProject.reactions });
        const framesByMotion = await renderMappedMotions({ renderer, motionIds: ids, render: targetInput.render || (targetInput.renderPreset ? { preset: targetInput.renderPreset } : targetOptions.render), signal, onProgress: targetOptions.onProgress, target: targetId, cache: targetOptions.cache, cacheContext: targetOptions.cacheContext || { sourceFingerprint: normalizedProject.source.fingerprint, runtimeVersion: targetOptions.runtimeVersion, rendererVersion: targetOptions.rendererVersion, targetVersion: targetOptions.targetVersion || '1', projectId: normalizedProject.projectId } });
        renderedInput = { ...targetInput, framesByMotion };
      } else if (targetId === 'codex-pet' && !targetInput.candidatesByRow && !targetInput.candidates) {
        const ids = mappedMotionIds(targetProject.mappings);
        const framesByMotion = await renderMappedMotions({ renderer, motionIds: ids, render: targetInput.render || (targetInput.renderPreset ? { preset: targetInput.renderPreset } : targetOptions.render), signal, onProgress: targetOptions.onProgress, target: targetId, cache: targetOptions.cache, cacheContext: targetOptions.cacheContext || { sourceFingerprint: normalizedProject.source.fingerprint, runtimeVersion: targetOptions.runtimeVersion, rendererVersion: targetOptions.rendererVersion, targetVersion: targetOptions.targetVersion || '1', projectId: normalizedProject.projectId } });
        const candidatesByRow = Object.fromEntries(Object.entries(targetProject.mappings).map(([row, value]) => [row, framesByMotion[value.slice(7)]?.frames || []]));
        renderedInput = { ...targetInput, candidatesByRow };
      }
    }
    let result;
    if (targetId === 'clawd') {
      result = await buildClawdTheme({
        mapping: { sleepMode: targetProject.options.sleepMode || 'direct', states: targetProject.mappings, reactions: targetProject.reactions },
        framesByMotion: renderedInput.framesByMotion || renderedInput.frames,
        metadata: metadataByTarget[targetId] || renderedInput.metadata,
        readme: renderedInput.readme,
      }, targetOptions);
    } else {
      result = await buildCodexPet({
        mapping: { mappings: targetProject.mappings },
        candidatesByRow: renderedInput.candidatesByRow || renderedInput.candidates,
        metadata: metadataByTarget[targetId] || renderedInput.metadata,
      }, targetOptions);
    }
    result.report = createBuildReport({ build: result, projectId: normalizedProject.projectId, source: normalizedProject.source });
    builds[targetId] = result;
    warnings.push(...(result.warnings || []).map((warning) => ({ target: targetId, ...warning })));
  }
  return { buildContractVersion: BUILD_CONTRACT_VERSION, projectId: normalizedProject.projectId, targets: uniqueTargets, builds, warnings };
}

module.exports = {
  BUILD_CONTRACT_VERSION,
  BUILD_REPORT_SCHEMA_VERSION,
  CLAWD_PACKAGE_LIMIT,
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
  buildClawdTheme,
  buildCodexPet,
  buildProjectTargets,
  buildProvenance,
  createBuildReport,
  createCodexPetZip,
  createClawdThemeZip,
  createClawdPreview,
  createCodexPreview,
  createTargetPreview,
  createCacheKey,
  encodeAnimatedWebp,
  renderMappedMotions,
  resolveTargetRenderPreset,
  decodeFrameSet,
  encodeFrameSet,
  normalizeCodexMetadata,
};
