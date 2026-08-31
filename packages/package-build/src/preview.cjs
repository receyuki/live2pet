const {
  ALL_STATES,
  CORE_STATES,
  FULL_SLEEP_STATES,
  REACTIONS,
} = require('../../clawd-target/src/index.cjs');
const {
  ATLAS,
  ROWS,
} = require('../../codex-target/src/index.cjs');

const PREVIEW_CONTRACT_VERSION = 1;

// These values are preview fallbacks only. A generated theme may override them
// through its documented `timings` block; the preview never mutates the theme
// manifest or claims to replace Clawd's runtime defaults.
const DEFAULT_CLAWD_PREVIEW_TIMINGS = Object.freeze({
  yawnDurationMs: 3000,
  wakeDurationMs: 1500,
  minDisplayMs: Object.freeze({ thinking: 1000, working: 1000, attention: 4000, error: 5000, notification: 2500 }),
  autoReturnMs: Object.freeze({ attention: 11000, error: 6000, notification: 6000 }),
  reactionDurationMs: Object.freeze({ clickLeft: 2500, clickRight: 2500, annoyed: 3500, double: 3500 }),
});

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
  const files = Array.isArray(value)
    ? value
    : isRecord(value) && Array.isArray(value.files)
      ? value.files
      : null;
  if (!files || !files.length) return null;
  return files.map((file) => assetPath(file));
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

function positiveMilliseconds(value, fallback = null) {
  if (!Number.isFinite(Number(value))) return fallback;
  const milliseconds = Math.round(Number(value));
  return milliseconds > 0 ? milliseconds : fallback;
}

function normalizeTimingMap(value, defaults) {
  const input = isRecord(value) ? value : {};
  const result = Object.fromEntries(Object.entries(defaults).map(([key, fallback]) => [key, positiveMilliseconds(input[key], fallback)]));
  for (const [key, candidate] of Object.entries(input)) {
    const milliseconds = positiveMilliseconds(candidate);
    if (milliseconds !== null) result[key] = milliseconds;
  }
  return result;
}

function normalizeClawdPreviewTimings(manifest) {
  const input = isRecord(manifest?.timings) ? manifest.timings : {};
  const reactionInput = isRecord(input.reactionDuration)
    ? input.reactionDuration
    : isRecord(input.reactionDurations)
      ? input.reactionDurations
      : {};
  return {
    yawnDurationMs: positiveMilliseconds(input.yawnDuration, DEFAULT_CLAWD_PREVIEW_TIMINGS.yawnDurationMs),
    wakeDurationMs: positiveMilliseconds(input.wakeDuration, DEFAULT_CLAWD_PREVIEW_TIMINGS.wakeDurationMs),
    minDisplayMs: { ...normalizeTimingMap(input.minDisplay, DEFAULT_CLAWD_PREVIEW_TIMINGS.minDisplayMs) },
    autoReturnMs: { ...normalizeTimingMap(input.autoReturn, DEFAULT_CLAWD_PREVIEW_TIMINGS.autoReturnMs) },
    reactionDurationMs: { ...normalizeTimingMap(reactionInput, DEFAULT_CLAWD_PREVIEW_TIMINGS.reactionDurationMs) },
  };
}

function assetDurationMs(files, assetReports) {
  const reports = new Map(assetReports.map((asset) => [asset.file, asset]));
  for (const file of files || []) {
    const report = reports.get(file);
    if (!report) continue;
    if (Array.isArray(report.delays) && report.delays.length && report.delays.every((delay) => Number.isInteger(delay) && delay > 0)) {
      return report.delays.reduce((total, delay) => total + delay, 0);
    }
    if (Number.isInteger(report.frameCount) && report.frameCount > 0) return report.frameCount * 100;
  }
  return null;
}

function clonePreviewStep(plan, overrides = {}) {
  return {
    logicalState: plan.logicalState,
    visualState: plan.visualState,
    resolvedState: plan.resolvedState,
    fallbackChain: [...plan.fallbackChain],
    files: [...plan.files],
    missingFiles: [...plan.missingFiles],
    available: plan.available,
    assetDurationMs: plan.assetDurationMs,
    durationMs: plan.durationMs,
    loop: plan.loop,
    minDisplayMs: plan.minDisplayMs,
    autoReturnMs: plan.autoReturnMs,
    returnTo: plan.returnTo,
    ...overrides,
  };
}

function createClawdBehaviorPreview({ manifest, states, assets }) {
  const assetReports = Array.isArray(assets) ? assets : [];
  const timings = normalizeClawdPreviewTimings(manifest);
  const statePlans = {};
  for (const slot of ALL_STATES) {
    const resolved = states[slot] || { kind: 'unmapped', files: [], chain: [slot], missingAssets: [] };
    const missingFiles = [...(resolved.missingAssets || [])];
    const autoReturnMs = Object.hasOwn(timings.autoReturnMs, slot) ? timings.autoReturnMs[slot] : null;
    statePlans[slot] = {
      logicalState: slot,
      visualState: resolved.kind === 'assets' ? resolved.chain.at(-1) : null,
      resolvedState: resolved.kind === 'assets' ? resolved.chain.at(-1) : null,
      fallbackChain: [...(resolved.chain || [slot])],
      files: [...(resolved.files || [])],
      missingFiles,
      available: resolved.kind === 'assets' && missingFiles.length === 0,
      assetDurationMs: assetDurationMs(resolved.files, assetReports),
      durationMs: assetDurationMs(resolved.files, assetReports),
      loop: true,
      minDisplayMs: Object.hasOwn(timings.minDisplayMs, slot) ? timings.minDisplayMs[slot] : 0,
      autoReturnMs,
      returnTo: autoReturnMs ? 'idle' : null,
    };
  }

  const sleepMode = manifest?.sleepSequence?.mode === 'full' ? 'full' : 'direct';
  const sleepEnterSlots = sleepMode === 'full' ? ['yawning', 'dozing', 'collapsing', 'sleeping'] : ['sleeping'];
  const sleepEnter = sleepEnterSlots.map((slot) => {
    const plan = statePlans[slot];
    const durationMs = slot === 'yawning'
      ? timings.yawnDurationMs
      : slot === 'sleeping'
        ? null
        : plan.assetDurationMs;
    return clonePreviewStep(plan, {
      loop: slot === 'sleeping',
      durationMs,
      returnTo: null,
    });
  });
  const wakePlan = statePlans.waking && statePlans.waking.available
    ? clonePreviewStep(statePlans.waking, { loop: false, durationMs: timings.wakeDurationMs, returnTo: 'idle' })
    : clonePreviewStep(statePlans.idle, { logicalState: 'waking', loop: false, durationMs: statePlans.idle.assetDurationMs, returnTo: 'idle' });

  const idleEntries = Array.isArray(manifest?.idleAnimations) ? manifest.idleAnimations : [];
  const idlePool = idleEntries.flatMap((entry, index) => {
    if (!isRecord(entry) || typeof entry.file !== 'string' || !entry.file.trim()) return [];
    const files = [assetPath(entry.file.trim())];
    const durationMs = positiveMilliseconds(entry.duration, assetDurationMs(files, assetReports));
    const missingFiles = files.filter((file) => !assetReports.some((asset) => asset.file === file));
    return [{ id: `idle-animation-${index + 1}`, file: files[0], files, durationMs, missingFiles, available: missingFiles.length === 0, loop: false, returnTo: 'idle' }];
  });
  if (!idlePool.length) {
    idlePool.push(...statePlans.idle.files.map((file, index) => ({
      id: `idle-state-${index + 1}`,
      file,
      files: [file],
      durationMs: statePlans.idle.assetDurationMs,
      missingFiles: [...statePlans.idle.missingFiles],
      available: statePlans.idle.available,
      loop: true,
      returnTo: null,
    })));
  }

  const reactionPlans = {};
  for (const slot of REACTIONS) {
    const value = manifest?.reactions?.[slot];
    if (!isRecord(value)) continue;
    const files = slot === 'double' && Array.isArray(value.files)
      ? value.files.filter((file) => typeof file === 'string' && file.trim()).map((file) => assetPath(file.trim()))
      : slot === 'double' && typeof value.file === 'string' && value.file.trim()
        ? [assetPath(value.file.trim())]
      : typeof value.file === 'string' && value.file.trim()
        ? [assetPath(value.file.trim())]
        : [];
    if (slot === 'drag') {
      const directional = {
        default: typeof value.file === 'string' && value.file.trim() ? assetPath(value.file.trim()) : null,
        left: typeof value.fileLeft === 'string' && value.fileLeft.trim() ? assetPath(value.fileLeft.trim()) : null,
        right: typeof value.fileRight === 'string' && value.fileRight.trim() ? assetPath(value.fileRight.trim()) : null,
      };
      directional.left ||= directional.default;
      directional.right ||= directional.default;
      const directionalFiles = Object.values(directional).filter(Boolean);
      const missingFiles = directionalFiles.filter((file) => !assetReports.some((asset) => asset.file === file));
      reactionPlans[slot] = {
        id: slot,
        trigger: 'drag',
        files: directional,
        missingFiles: [...new Set(missingFiles)],
        available: missingFiles.length === 0 && Boolean(directional.default),
        durationMs: null,
        loop: true,
        returnTo: 'idle',
      };
      continue;
    }
    const missingFiles = files.filter((file) => !assetReports.some((asset) => asset.file === file));
    const durationMs = positiveMilliseconds(value.duration, timings.reactionDurationMs[slot] || 3500);
    reactionPlans[slot] = {
      id: slot,
      trigger: slot === 'double' ? 'rapid-four-click' : slot === 'annoyed' ? 'double-click-alternative' : `double-click-${slot === 'clickLeft' ? 'left' : 'right'}`,
      files,
      missingFiles: [...new Set(missingFiles)],
      available: files.length > 0 && missingFiles.length === 0,
      durationMs,
      loop: false,
      returnTo: 'idle',
    };
  }

  const scenarios = {
    idle: { id: 'idle', loop: true, steps: idlePool.map((entry) => ({ ...entry })) },
    sleep: { id: 'sleep', mode: sleepMode, loop: false, steps: sleepEnter, wake: [wakePlan] },
    wake: { id: 'wake', loop: false, steps: [wakePlan] },
  };
  for (const [slot, reaction] of Object.entries(reactionPlans)) {
    const reactionFiles = Array.isArray(reaction.files) ? reaction.files : Object.values(reaction.files).filter(Boolean);
    const base = statePlans.idle;
    scenarios[`reaction:${slot}`] = {
      id: `reaction:${slot}`,
      loop: reaction.loop,
      steps: [{
        logicalState: slot,
        visualState: slot,
        resolvedState: slot,
        fallbackChain: [slot],
        files: reactionFiles,
        missingFiles: [...reaction.missingFiles],
        available: reaction.available,
        assetDurationMs: assetDurationMs(reactionFiles, assetReports),
        durationMs: reaction.durationMs,
        loop: reaction.loop,
        minDisplayMs: 0,
        autoReturnMs: reaction.durationMs,
        returnTo: reaction.returnTo,
      }, clonePreviewStep(base, { durationMs: null })],
    };
  }

  return {
    contractVersion: PREVIEW_CONTRACT_VERSION,
    timings,
    states: statePlans,
    idlePool,
    sleepSequence: { mode: sleepMode, enter: sleepEnter, wake: wakePlan },
    reactions: reactionPlans,
    scenarios,
  };
}

function createClawdPreview({ manifest, assets = [] } = {}) {
  if (!isRecord(manifest)) fail('INVALID_TARGET_PREVIEW', 'Clawd target preview requires a generated theme manifest.');
  const assetReports = normalizeAssetReports(assets);
  const available = new Set(assetReports.map((asset) => asset.file));
  const states = {};
  const missingStates = [];
  const fullSleep = manifest.sleepSequence?.mode === 'full';
  for (const slot of ALL_STATES) {
    const resolved = resolveClawdState(slot, manifest.states || {});
    const missingAssets = resolved.files.filter((file) => !available.has(file));
    states[slot] = { ...resolved, resolvedState: resolved.kind === 'assets' ? resolved.chain.at(-1) : null, missingAssets };
    if ((CORE_STATES.includes(slot) || (fullSleep && FULL_SLEEP_STATES.includes(slot))) && (resolved.kind !== 'assets' || missingAssets.length)) missingStates.push(slot);
  }
  const reactions = {};
  const missingReactions = [];
  for (const [slot, value] of Object.entries(manifest.reactions || {})) {
    if (!isRecord(value)) {
      reactions[slot] = { kind: 'unmapped', files: [] };
      continue;
    }
    const files = slot === 'double' && Array.isArray(value.files)
      ? value.files.filter((file) => typeof file === 'string' && file.trim()).map((file) => assetPath(file.trim()))
      : slot === 'double' && typeof value.file === 'string' && value.file.trim()
        ? [assetPath(value.file.trim())]
        : typeof value.file === 'string' && value.file.trim()
          ? [assetPath(value.file.trim())]
          : [];
    const directional = slot === 'drag'
      ? Object.fromEntries(['file', 'fileLeft', 'fileRight'].filter((key) => typeof value[key] === 'string' && value[key].trim()).map((key) => [key, assetPath(value[key].trim())]))
      : null;
    const allFiles = [...new Set([...files, ...Object.values(directional || {})])];
    if (!allFiles.length) {
      reactions[slot] = { kind: 'unmapped', files: [] };
      continue;
    }
    const missingFiles = allFiles.filter((file) => !available.has(file));
    reactions[slot] = { kind: 'asset', ...(files.length ? { file: files[0], files } : {}), ...(directional ? directional : {}), missing: missingFiles.length > 0, missingFiles };
    if (missingFiles.length) missingReactions.push(slot);
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
    behavior: createClawdBehaviorPreview({ manifest, states, assets: assetReports }),
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
  DEFAULT_CLAWD_PREVIEW_TIMINGS,
  PREVIEW_CONTRACT_VERSION,
  TargetPreviewError,
  createClawdBehaviorPreview,
  createClawdPreview,
  createCodexPreview,
  createTargetPreview,
};
