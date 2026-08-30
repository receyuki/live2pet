const {
  ALL_STATES,
  CORE_STATES,
} = require('../../clawd-target/src/index.cjs');
const {
  ATLAS,
  ROWS,
} = require('../../codex-target/src/index.cjs');

const PREVIEW_CONTRACT_VERSION = 1;

class TargetPreviewError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'TargetPreviewError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details = {}) {
  throw new TargetPreviewError(code, message, details);
}

function isRecord(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function safeAssetName(value) {
  if (typeof value !== 'string' || !value.trim() || value.includes('/') || value.includes('\\') || value.includes('..')) {
    fail('INVALID_TARGET_PREVIEW', `Generated asset name is not a safe basename: ${String(value)}`);
  }
  return value.trim();
}

function assetPath(name) {
  return `assets/${safeAssetName(name)}`;
}

function normalizeAssetReports(assets) {
  if (assets == null) return [];
  if (!Array.isArray(assets)) fail('INVALID_TARGET_PREVIEW', 'Generated Clawd assets must be an array of asset reports.');
  return assets.map((asset, index) => {
    if (!isRecord(asset)) fail('INVALID_TARGET_PREVIEW', `Generated asset report ${index} must be an object.`);
    const file = safeAssetName(asset.file || asset.name);
    return {
      file: assetPath(file),
      ...(Number.isInteger(asset.frameCount) ? { frameCount: asset.frameCount } : {}),
      ...(Number.isInteger(asset.width) ? { width: asset.width } : {}),
      ...(Number.isInteger(asset.height) ? { height: asset.height } : {}),
      ...(Number.isInteger(asset.byteLength) ? { byteLength: asset.byteLength } : {}),
      ...(Array.isArray(asset.delays) ? { delays: [...asset.delays] } : {}),
    };
  });
}

function stateAssets(value) {
  if (!Array.isArray(value) || !value.length) return null;
  return value.map((file) => assetPath(file));
}

function resolveClawdState(slot, states, chain = []) {
  if (chain.includes(slot)) fail('INVALID_TARGET_PREVIEW', `Clawd state fallback contains a cycle at ${slot}.`, { slot, chain: [...chain, slot] });
  const value = states[slot];
  const directAssets = stateAssets(value);
  if (directAssets) return { kind: 'assets', files: directAssets, chain: [...chain, slot] };
  if (isRecord(value) && typeof value.fallbackTo === 'string' && value.fallbackTo.trim()) {
    return resolveClawdState(value.fallbackTo.trim(), states, [...chain, slot]);
  }
  return { kind: 'unmapped', files: [], chain: [...chain, slot] };
}

function createClawdPreview({ manifest, assets = [] } = {}) {
  if (!isRecord(manifest)) fail('INVALID_TARGET_PREVIEW', 'Clawd target preview requires a generated theme manifest.');
  const assetReports = normalizeAssetReports(assets);
  const available = new Set(assetReports.map((asset) => asset.file));
  const states = {};
  const missingStates = [];
  for (const slot of ALL_STATES) {
    const resolved = resolveClawdState(slot, manifest.states || {});
    const missingAssets = resolved.files.filter((file) => !available.has(file));
    states[slot] = { ...resolved, missingAssets };
    if (CORE_STATES.includes(slot) && (resolved.kind !== 'assets' || missingAssets.length)) missingStates.push(slot);
  }
  const reactions = {};
  const missingReactions = [];
  for (const [slot, value] of Object.entries(manifest.reactions || {})) {
    if (!isRecord(value) || typeof value.file !== 'string') {
      reactions[slot] = { kind: 'unmapped', files: [] };
      continue;
    }
    const file = assetPath(value.file);
    const missing = !available.has(file);
    reactions[slot] = { kind: 'asset', file, missing };
    if (missing) missingReactions.push(slot);
  }
  return {
    contractVersion: PREVIEW_CONTRACT_VERSION,
    target: 'clawd',
    source: 'generated-assets',
    ready: missingStates.length === 0 && missingReactions.length === 0,
    missingStates,
    missingReactions,
    assets: assetReports,
    states,
    reactions,
    sleepSequence: isRecord(manifest.sleepSequence) ? { ...manifest.sleepSequence } : { mode: 'direct' },
  };
}

function createCodexPreview({ manifest } = {}) {
  if (!isRecord(manifest) || !isRecord(manifest.atlas) || !Array.isArray(manifest.rows)) {
    fail('INVALID_TARGET_PREVIEW', 'Codex target preview requires a generated manifest with atlas rows.');
  }
  for (const [key, expected] of Object.entries(ATLAS)) {
    if (manifest.atlas[key] !== expected) fail('INVALID_TARGET_PREVIEW', `Codex preview atlas ${key} must be ${expected}.`, { field: key, expected, actual: manifest.atlas[key] });
  }
  const rows = manifest.rows.map((row, rowIndex) => {
    if (!isRecord(row) || typeof row.id !== 'string' || !Number.isInteger(row.row) || !Array.isArray(row.frames)) {
      fail('INVALID_TARGET_PREVIEW', `Codex preview row ${rowIndex} is malformed.`);
    }
    const expectedRow = ROWS[rowIndex];
    if (!expectedRow || row.id !== expectedRow.id || row.row !== rowIndex || row.frames.length !== row.frameCount) {
      fail('INVALID_TARGET_PREVIEW', `Codex preview row ${rowIndex} does not match the target row contract.`, { row: row.id, expected: expectedRow && expectedRow.id });
    }
    return {
      id: row.id,
      row: row.row,
      frameCount: row.frames.length,
      frames: row.frames.map((frame, index) => ({
        ...frame,
        index,
        cell: { x: index * ATLAS.cellWidth, y: row.row * ATLAS.cellHeight, width: ATLAS.cellWidth, height: ATLAS.cellHeight },
      })),
      playback: { loop: true, timing: 'target-default' },
    };
  });
  return {
    contractVersion: PREVIEW_CONTRACT_VERSION,
    target: 'codex-pet',
    source: 'generated-assets',
    ready: rows.length === ROWS.length,
    spritesheet: {
      path: typeof manifest.spritesheetPath === 'string' && manifest.spritesheetPath.trim() ? manifest.spritesheetPath.trim() : 'spritesheet.webp',
      width: ATLAS.width,
      height: ATLAS.height,
      cellWidth: ATLAS.cellWidth,
      cellHeight: ATLAS.cellHeight,
      columns: ATLAS.columns,
      rows: ATLAS.rows,
    },
    rows,
  };
}

function createTargetPreview(build) {
  if (!isRecord(build) || typeof build.target !== 'string') fail('INVALID_TARGET_PREVIEW', 'A Package Build result with a target is required.');
  if (build.target === 'clawd') return createClawdPreview({ manifest: build.manifest, assets: build.assets });
  if (build.target === 'codex-pet') return createCodexPreview({ manifest: build.manifest });
  fail('INVALID_TARGET_PREVIEW', `Unsupported target preview: ${build.target}.`);
}

module.exports = {
  PREVIEW_CONTRACT_VERSION,
  TargetPreviewError,
  createClawdPreview,
  createCodexPreview,
  createTargetPreview,
};
