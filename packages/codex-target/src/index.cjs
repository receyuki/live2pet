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
  assertValidCodexMapping,
  composeCodexAtlasRgba,
  createCodexAtlasPlan,
  createCodexTarget,
  selectCodexFrameSets,
  validateAtlasGeometry,
  validateCodexMapping,
};
