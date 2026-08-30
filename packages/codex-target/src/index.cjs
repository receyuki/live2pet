const CONTRACT_VERSION = 1;
const { selectMotionFrames } = require('../../frame-selection/src/index.cjs');
const PACKAGE_FILES = ['pet.json', 'spritesheet.webp'];
const ATLAS = Object.freeze({ width: 1536, height: 1872, columns: 8, rows: 9, cellWidth: 192, cellHeight: 208 });
const ROWS = Object.freeze([
  { id: 'idle', frames: 6 },
  { id: 'running-right', frames: 8 },
  { id: 'running-left', frames: 8 },
  { id: 'waving', frames: 4 },
  { id: 'jumping', frames: 5 },
  { id: 'failed', frames: 8 },
  { id: 'waiting', frames: 6 },
  { id: 'running', frames: 6 },
  { id: 'review', frames: 6 },
]);
const ROW_IDS = ROWS.map((row) => row.id);
const MAPPING_PATTERN = /^motion:[^\s:][^\s]{0,255}$/;
const SAFE_PET_ID = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,95})$/;

class CodexValidationError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'CodexValidationError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details = {}) {
  throw new CodexValidationError(code, message, details);
}

function isByteBuffer(value) {
  return Buffer.isBuffer(value) || value instanceof Uint8Array || ArrayBuffer.isView(value);
}

function readUInt24LE(bytes, offset) {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
}

function webpInfoFromBytes(value) {
  if (!isByteBuffer(value)) fail('INVALID_CODEX_PACKAGE', 'spritesheet bytes must be a byte buffer.');
  const bytes = Buffer.isBuffer(value)
    ? value
    : value instanceof Uint8Array
      ? Buffer.from(value.buffer, value.byteOffset, value.byteLength)
      : Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  if (bytes.length < 12) fail('INVALID_CODEX_PACKAGE', 'spritesheet.webp must contain a RIFF WEBP header.');
  if (bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WEBP') fail('INVALID_CODEX_PACKAGE', 'spritesheet bytes must be a WEBP RIFF container.');
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const chunkType = bytes.toString('ascii', offset, offset + 4);
    const chunkSize = bytes.readUInt32LE(offset + 4);
    const dataOffset = offset + 8;
    const dataEnd = dataOffset + chunkSize;
    if (dataEnd > bytes.length) fail('INVALID_CODEX_PACKAGE', `WEBP chunk ${chunkType} exceeds the available bytes.`);
    if (chunkType === 'VP8X') {
      if (chunkSize < 10) fail('INVALID_CODEX_PACKAGE', 'WEBP VP8X chunk is too small.');
      return {
        format: 'webp',
        width: readUInt24LE(bytes, dataOffset + 4) + 1,
        height: readUInt24LE(bytes, dataOffset + 7) + 1,
        animated: (bytes[dataOffset] & 0x02) !== 0,
      };
    }
    if (chunkType === 'VP8L') {
      if (chunkSize < 5 || bytes[dataOffset] !== 0x2f) fail('INVALID_CODEX_PACKAGE', 'WEBP VP8L chunk is invalid.');
      const b0 = bytes[dataOffset + 1];
      const b1 = bytes[dataOffset + 2];
      const b2 = bytes[dataOffset + 3];
      const b3 = bytes[dataOffset + 4];
      return {
        format: 'webp',
        width: 1 + (((b1 & 0x3f) << 8) | b0),
        height: 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6)),
        animated: false,
      };
    }
    if (chunkType === 'VP8 ') {
      if (chunkSize < 10 || bytes[dataOffset + 3] !== 0x9d || bytes[dataOffset + 4] !== 0x01 || bytes[dataOffset + 5] !== 0x2a) {
        fail('INVALID_CODEX_PACKAGE', 'WEBP VP8 chunk is invalid.');
      }
      return {
        format: 'webp',
        width: bytes.readUInt16LE(dataOffset + 6) & 0x3fff,
        height: bytes.readUInt16LE(dataOffset + 8) & 0x3fff,
        animated: false,
      };
    }
    offset = dataEnd + (chunkSize % 2);
  }
  fail('INVALID_CODEX_PACKAGE', 'spritesheet.webp is missing a supported VP8, VP8L, or VP8X image chunk.');
}

function validateAtlasGeometry(input = ATLAS) {
  const errors = [];
  for (const [key, expected] of Object.entries(ATLAS)) if (input[key] !== expected) errors.push({ code: 'INVALID_ATLAS_GEOMETRY', field: key, expected, actual: input[key], message: `Codex atlas ${key} must be ${expected}.` });
  if (input.width !== input.columns * input.cellWidth) errors.push({ code: 'ATLAS_WIDTH_MISMATCH', message: 'Codex atlas width must equal columns × cellWidth.' });
  if (input.height !== input.rows * input.cellHeight) errors.push({ code: 'ATLAS_HEIGHT_MISMATCH', message: 'Codex atlas height must equal rows × cellHeight.' });
  return { ok: errors.length === 0, errors };
}

function normalizeMappings(mappings) {
  if (!mappings || typeof mappings !== 'object' || Array.isArray(mappings)) fail('INVALID_CODEX_MAPPING', 'Codex mappings must be an object.');
  const normalized = {};
  for (const [id, value] of Object.entries(mappings)) {
    if (!ROW_IDS.includes(id)) fail('UNKNOWN_CODEX_SLOT', `Codex mappings contain unsupported slot: ${id}`);
    if (typeof value !== 'string' || !MAPPING_PATTERN.test(value)) fail('INVALID_CODEX_MAPPING', `${id} must map directly to motion:<id>; fallback and automatic mirroring are not supported.`);
    normalized[id] = value;
  }
  return normalized;
}

function validateCodexMapping(input = {}) {
  const mapping = input.mappings || input.states;
  const errors = [];
  let normalized = {};
  try { normalized = normalizeMappings(mapping || {}); } catch (error) {
    if (error instanceof CodexValidationError) errors.push({ code: error.code, message: error.message });
    else throw error;
  }
  for (const row of ROWS) if (!normalized[row.id]) errors.push({ code: 'REQUIRED_CODEX_SLOT_UNMAPPED', slot: row.id, message: `${row.id} must map to a user-confirmed Motion.` });
  const atlas = validateAtlasGeometry(input.atlas || ATLAS);
  errors.push(...atlas.errors);
  return { contractVersion: CONTRACT_VERSION, atlas: { ...ATLAS }, rows: ROWS.map((row) => ({ ...row })), mappings: normalized, errors, ok: errors.length === 0 };
}

function assertValidCodexMapping(input) {
  const result = validateCodexMapping(input);
  if (!result.ok) fail('INVALID_CODEX_MAPPING', result.errors.map((error) => error.message).join(' '), { errors: result.errors });
  return result;
}

function packageError(errors, code, message, details = {}) {
  errors.push({ code, message, ...details });
}

function normalizePackageManifest(value, errors) {
  let parsed = value;
  if (typeof parsed === 'string') {
    try { parsed = JSON.parse(parsed); } catch (error) {
      packageError(errors, 'INVALID_MANIFEST_JSON', 'pet.json must contain valid JSON.', { cause: String(error.message || error) });
      return null;
    }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    packageError(errors, 'INVALID_MANIFEST', 'pet.json must be a JSON object.');
    return null;
  }
  return parsed;
}

function validatePackageFiles(files, errors) {
  if (files == null) return;
  if (!Array.isArray(files)) {
    packageError(errors, 'INVALID_PACKAGE_FILES', 'Package files must be an array when provided.');
    return;
  }
  for (const required of PACKAGE_FILES) if (!files.includes(required)) packageError(errors, 'MISSING_PACKAGE_FILE', `Package is missing ${required}.`, { file: required });
  for (const file of files) if (!PACKAGE_FILES.includes(file)) packageError(errors, 'UNEXPECTED_PACKAGE_FILE', `Package contains an unexpected file: ${file}`, { file });
}

function validateManifestFields(manifest, errors) {
  if (!manifest) return null;
  const normalized = {
    id: typeof manifest.id === 'string' ? manifest.id.trim() : '',
    displayName: typeof manifest.displayName === 'string' ? manifest.displayName.trim() : '',
    description: typeof manifest.description === 'string' ? manifest.description.trim() : '',
    spritesheetPath: typeof manifest.spritesheetPath === 'string' ? manifest.spritesheetPath.trim() : '',
  };
  if (!normalized.id) packageError(errors, 'INVALID_PET_ID', 'pet.json id must be a non-empty string.');
  else if (!SAFE_PET_ID.test(normalized.id) || normalized.id.includes('..')) packageError(errors, 'INVALID_PET_ID', 'pet.json id must be a safe package id without spaces or path separators.', { id: normalized.id });
  if (!normalized.displayName) packageError(errors, 'INVALID_DISPLAY_NAME', 'pet.json displayName must be a non-empty string.');
  if (!normalized.description) packageError(errors, 'INVALID_DESCRIPTION', 'pet.json description must be a non-empty string.');
  if (normalized.spritesheetPath !== 'spritesheet.webp') packageError(errors, 'INVALID_SPRITESHEET_PATH', 'pet.json spritesheetPath must be "spritesheet.webp".', { actual: normalized.spritesheetPath || null });
  return normalized;
}

function normalizePackageSpritesheet(value, errors) {
  const sprite = isByteBuffer(value) ? { bytes: value } : value;
  if (!sprite || typeof sprite !== 'object' || Array.isArray(sprite)) {
    packageError(errors, 'INVALID_SPRITESHEET', 'spritesheet must be a metadata object or WEBP byte buffer.');
    return null;
  }
  const normalized = {
    path: typeof sprite.path === 'string' && sprite.path.trim() ? sprite.path.trim() : 'spritesheet.webp',
    format: typeof sprite.format === 'string' && sprite.format.trim() ? sprite.format.trim().toLowerCase() : null,
    width: Number.isInteger(sprite.width) ? sprite.width : null,
    height: Number.isInteger(sprite.height) ? sprite.height : null,
    frameCount: Number.isInteger(sprite.frameCount) ? sprite.frameCount : null,
    byteLength: Number.isInteger(sprite.byteLength) ? sprite.byteLength : null,
    bytes: sprite.bytes,
  };
  if (normalized.path !== 'spritesheet.webp') packageError(errors, 'INVALID_SPRITESHEET_PATH', 'spritesheet path must be "spritesheet.webp".', { actual: normalized.path });
  if (normalized.format && normalized.format !== 'webp') packageError(errors, 'INVALID_SPRITESHEET_FORMAT', 'Codex Pet V1 packages must use spritesheet.webp.', { actual: normalized.format });
  if (normalized.frameCount != null && normalized.frameCount !== 1) packageError(errors, 'INVALID_SPRITESHEET_FRAME_COUNT', 'Codex Pet V1 spritesheet.webp must contain exactly one atlas image.', { actual: normalized.frameCount });
  if (normalized.byteLength != null && normalized.byteLength < 1) packageError(errors, 'INVALID_SPRITESHEET_BYTES', 'spritesheet.webp cannot be empty.');
  let parsed = null;
  if (normalized.bytes !== undefined) {
    if (!isByteBuffer(normalized.bytes)) packageError(errors, 'INVALID_SPRITESHEET_BYTES', 'spritesheet bytes must be a byte buffer.');
    else {
      try {
        parsed = webpInfoFromBytes(normalized.bytes);
        normalized.byteLength = normalized.byteLength ?? normalized.bytes.byteLength;
        normalized.format = normalized.format || parsed.format;
        if (normalized.width != null && normalized.width !== parsed.width) packageError(errors, 'INVALID_SPRITESHEET_WIDTH', `spritesheet width metadata ${normalized.width} does not match WEBP bytes ${parsed.width}.`, { metadata: normalized.width, actual: parsed.width });
        if (normalized.height != null && normalized.height !== parsed.height) packageError(errors, 'INVALID_SPRITESHEET_HEIGHT', `spritesheet height metadata ${normalized.height} does not match WEBP bytes ${parsed.height}.`, { metadata: normalized.height, actual: parsed.height });
        if (parsed.animated) packageError(errors, 'INVALID_SPRITESHEET_FRAME_COUNT', 'Codex Pet V1 spritesheet.webp must be a single static atlas, not animated.');
        normalized.width = parsed.width;
        normalized.height = parsed.height;
      } catch (error) {
        if (error instanceof CodexValidationError) packageError(errors, error.code, error.message, error.details);
        else throw error;
      }
    }
  }
  return normalized;
}

function validateCodexPetPackage(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('INVALID_CODEX_PACKAGE', 'Codex Pet Package validation input must be an object.');
  const errors = [];
  validatePackageFiles(input.files, errors);
  const manifest = validateManifestFields(normalizePackageManifest(input.manifest, errors), errors);
  const spritesheet = normalizePackageSpritesheet(input.spritesheet, errors);
  if (!spritesheet) packageError(errors, 'MISSING_SPRITESHEET', 'spritesheet metadata or bytes are required.');
  if (spritesheet) {
    const geometry = validateAtlasGeometry({ width: spritesheet.width, height: spritesheet.height, columns: ATLAS.columns, rows: ATLAS.rows, cellWidth: ATLAS.cellWidth, cellHeight: ATLAS.cellHeight });
    errors.push(...geometry.errors);
    if (spritesheet.width == null) packageError(errors, 'INVALID_SPRITESHEET_WIDTH', `spritesheet.webp width must be ${ATLAS.width}.`);
    if (spritesheet.height == null) packageError(errors, 'INVALID_SPRITESHEET_HEIGHT', `spritesheet.webp height must be ${ATLAS.height}.`);
  }
  if (manifest && spritesheet && manifest.spritesheetPath && spritesheet.path && manifest.spritesheetPath !== spritesheet.path) {
    packageError(errors, 'INVALID_SPRITESHEET_PATH', 'pet.json spritesheetPath must match the packaged spritesheet path.');
  }
  return {
    contractVersion: CONTRACT_VERSION,
    packageFiles: [...PACKAGE_FILES],
    atlas: { ...ATLAS },
    rows: ROWS.map((row) => ({ ...row })),
    manifest,
    spritesheet: spritesheet ? {
      path: spritesheet.path,
      format: spritesheet.format || 'webp',
      width: spritesheet.width,
      height: spritesheet.height,
      frameCount: spritesheet.frameCount ?? 1,
      byteLength: spritesheet.byteLength ?? null,
    } : null,
    errors,
    warnings: [],
    ok: errors.length === 0,
  };
}

function assertValidCodexPetPackage(input) {
  const result = validateCodexPetPackage(input);
  if (!result.ok) fail('INVALID_CODEX_PACKAGE', result.errors.map((error) => error.message).join(' '), { errors: result.errors });
  return result;
}

function createCodexTarget(input = {}) {
  const result = assertValidCodexMapping(input);
  return {
    profile: 'codex-pet',
    contractVersion: CONTRACT_VERSION,
    packageFiles: [...PACKAGE_FILES],
    atlas: result.atlas,
    rows: result.rows,
    mappings: result.mappings,
  };
}

function normalizeFrameReference(frame, rowId, index) {
  if (typeof frame === 'string' && frame) return { id: frame };
  if (!frame || typeof frame !== 'object' || typeof frame.id !== 'string' || !frame.id) {
    fail('INVALID_CODEX_FRAME_SET', `${rowId} frame ${index} must provide a non-empty id.`);
  }
  return { id: frame.id, sourceIndex: Number.isInteger(frame.index) ? frame.index : undefined, time: Number.isFinite(frame.time) ? frame.time : undefined };
}

function createCodexAtlasPlan(input = {}) {
  const result = assertValidCodexMapping(input);
  const framesByRow = input.framesByRow || input.frames;
  if (!framesByRow || typeof framesByRow !== 'object' || Array.isArray(framesByRow)) fail('INVALID_CODEX_FRAME_SET', 'framesByRow must be an object keyed by Codex row id.');
  const rowPlans = result.rows.map((row, rowIndex) => {
    const frames = framesByRow[row.id];
    if (!Array.isArray(frames) || frames.length !== row.frames) fail('INVALID_CODEX_FRAME_SET', `${row.id} must contain exactly ${row.frames} selected frames.`, { slot: row.id, expected: row.frames, actual: Array.isArray(frames) ? frames.length : null });
    const normalized = frames.map((frame, frameIndex) => normalizeFrameReference(frame, row.id, frameIndex));
    const cells = Array.from({ length: ATLAS.columns }, (_, column) => ({
      row: rowIndex,
      column,
      x: column * ATLAS.cellWidth,
      y: rowIndex * ATLAS.cellHeight,
      width: ATLAS.cellWidth,
      height: ATLAS.cellHeight,
      transparent: column >= normalized.length,
      frame: normalized[column] || null,
    }));
    return { id: row.id, row: rowIndex, frames: normalized, cells };
  });
  return {
    contractVersion: CONTRACT_VERSION,
    atlas: { ...ATLAS },
    rows: rowPlans,
    cells: rowPlans.flatMap((row) => row.cells),
  };
}

function selectCodexFrameSets(input = {}, options = {}) {
  const result = assertValidCodexMapping(input);
  const candidatesByRow = input.candidatesByRow || input.candidates;
  if (!candidatesByRow || typeof candidatesByRow !== 'object' || Array.isArray(candidatesByRow)) fail('INVALID_CODEX_FRAME_SET', 'candidatesByRow must be an object keyed by Codex row id.');
  const selections = {};
  const frameSets = {};
  for (const row of result.rows) {
    const candidates = candidatesByRow[row.id];
    if (!Array.isArray(candidates)) fail('INVALID_CODEX_FRAME_SET', `${row.id} candidates must be an array.`, { slot: row.id });
    try {
      const rowOptions = options[row.id] && typeof options[row.id] === 'object' ? options[row.id] : options;
      const selection = selectMotionFrames(candidates, row.frames, rowOptions);
      selections[row.id] = selection;
      frameSets[row.id] = selection.frames;
    } catch (error) {
      if (error && error.code) fail('INVALID_CODEX_FRAME_SET', `${row.id}: ${error.message}`, { slot: row.id, causeCode: error.code });
      throw error;
    }
  }
  return { mapping: result, selections, frameSets };
}

function composeCodexAtlasRgba(plan, captures) {
  if (!plan || typeof plan !== 'object' || !plan.atlas || !Array.isArray(plan.cells)) fail('INVALID_CODEX_ATLAS_PLAN', 'A Codex atlas plan is required.');
  const geometry = validateAtlasGeometry(plan.atlas);
  if (!geometry.ok || plan.cells.length !== ATLAS.columns * ATLAS.rows) fail('INVALID_CODEX_ATLAS_PLAN', 'Codex atlas plan geometry or cell count is invalid.', { errors: geometry.errors });
  if (!captures || typeof captures !== 'object' || Array.isArray(captures)) fail('INVALID_CODEX_CAPTURE', 'captures must be an object keyed by frame id.');
  const rgba = new Uint8Array(plan.atlas.width * plan.atlas.height * 4);
  let occupiedCells = 0;
  for (const cell of plan.cells) {
    if (cell.transparent) continue;
    const frameId = cell.frame && cell.frame.id;
    const capture = frameId ? captures[frameId] : null;
    if (!capture || !Number.isInteger(capture.width) || !Number.isInteger(capture.height) || capture.width !== plan.atlas.cellWidth || capture.height !== plan.atlas.cellHeight) fail('INVALID_CODEX_CAPTURE', `Capture ${frameId || '<unknown>'} must be exactly ${plan.atlas.cellWidth}×${plan.atlas.cellHeight}.`, { frameId, expected: { width: plan.atlas.cellWidth, height: plan.atlas.cellHeight } });
    if (!ArrayBuffer.isView(capture.rgba) || capture.rgba.byteLength !== plan.atlas.cellWidth * plan.atlas.cellHeight * 4) fail('INVALID_CODEX_CAPTURE', `Capture ${frameId} must contain RGBA bytes for one atlas cell.`, { frameId });
    const frameRgba = new Uint8Array(capture.rgba.buffer, capture.rgba.byteOffset, capture.rgba.byteLength);
    for (let row = 0; row < plan.atlas.cellHeight; row += 1) {
      const sourceStart = row * plan.atlas.cellWidth * 4;
      const destinationStart = ((cell.y + row) * plan.atlas.width + cell.x) * 4;
      rgba.set(frameRgba.subarray(sourceStart, sourceStart + plan.atlas.cellWidth * 4), destinationStart);
    }
    occupiedCells += 1;
  }
  return { width: plan.atlas.width, height: plan.atlas.height, rgba, occupiedCells, transparentCells: plan.cells.length - occupiedCells };
}

module.exports = {
  ATLAS,
  CONTRACT_VERSION,
  CodexValidationError,
  PACKAGE_FILES,
  ROWS,
  ROW_IDS,
  assertValidCodexPetPackage,
  assertValidCodexMapping,
  composeCodexAtlasRgba,
  createCodexAtlasPlan,
  createCodexTarget,
  selectCodexFrameSets,
  validateAtlasGeometry,
  validateCodexMapping,
  validateCodexPetPackage,
};
