const {
  ATLAS,
  createCodexAtlasPlan,
  createCodexTarget,
  selectCodexFrameSets,
} = require('../../codex-target/src/index.cjs');
const { composeCodexAtlasRgba } = require('../../codex-target/src/index.cjs');

const BUILD_CONTRACT_VERSION = 1;
const STAGES = Object.freeze(['select', 'layout', 'compose', 'encode', 'manifest', 'package']);
const MAX_ENCODE_FRAMES = 4096;
const PACKAGE_FILES = Object.freeze(['pet.json', 'spritesheet.webp']);

class PackageBuildError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'PackageBuildError';
    this.code = code;
    this.details = details;
  }
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

async function buildCodexPet(input = {}, options = {}) {
  const mapping = input.mapping || input;
  const candidatesByRow = input.candidatesByRow || input.candidates;
  const signal = options.signal || input.signal;
  const onProgress = options.onProgress || input.onProgress;
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
  const manifest = {
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

  let packaged = null;
  if (packageRequested) {
    progress(onProgress, STAGES[5], 'started');
    packaged = await createCodexPetZip({ manifest, spritesheet: encoded.buffer, zipModule: options.zipModule });
    checkCancelled(signal);
    progress(onProgress, STAGES[5], 'completed', { byteLength: packaged.byteLength });
  }

  return {
    buildContractVersion: BUILD_CONTRACT_VERSION,
    target: target.profile,
    manifest,
    atlas,
    selections: selection.selections,
    warnings: [],
    encoding: encoded ? { required: 'webp', status: 'completed', format: encoded.format, frameCount: encoded.frameCount, width: encoded.width, height: encoded.height, byteLength: encoded.buffer.length } : { required: 'webp', status: 'pending', reason: 'Set encode:true or package:true to convert atlas.rgba to spritesheet.webp.' },
    spritesheet: encoded ? encoded.buffer : null,
    package: packaged,
  };
}

module.exports = {
  BUILD_CONTRACT_VERSION,
  MAX_ENCODE_FRAMES,
  PackageBuildError,
  STAGES,
  buildCodexPet,
  createCodexPetZip,
  encodeAnimatedWebp,
};
