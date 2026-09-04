const PROFILE = require('./profile.js');
const CONTRACT_VERSION = PROFILE.contractVersion;
const CLAWD_PACKAGE_LIMIT = PROFILE.package.maxBytes;
const GUIDE_URL = 'https://github.com/rullerzhou-afk/clawd-on-desk/blob/main/docs/guides/guide-theme-creation.md';
const CORE_STATES = PROFILE.states.core;
const FULL_SLEEP_STATES = PROFILE.states.fullSleep;
const OPTIONAL_STATES = PROFILE.states.optional;
const REACTIONS = PROFILE.reactions;
const ALL_STATES = PROFILE.states.all;
const FALLBACK_ALLOWED = new Set(PROFILE.states.fallbackAllowed);
const MAPPING_PATTERN = /^(motion|fallback):[^\s:][^\s]{0,255}$/;
const SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const SAFE_THEME_ID_PATTERN = /^[a-z0-9._-]{1,96}$/;

function clawdPackageSizeWarning(byteLength, maxBytes = CLAWD_PACKAGE_LIMIT, largestAssets = []) {
  if (byteLength <= maxBytes) return null;
  const size = bytes => bytes >= 1024 * 1024 ? `${Number((bytes / 1024 / 1024).toFixed(1))} MiB` : bytes >= 1024 ? `${Number((bytes / 1024).toFixed(1))} KiB` : `${bytes} B`;
  return { code: 'CLAWD_PACKAGE_TOO_LARGE', byteLength, maxBytes, largestAssets, message: `Clawd theme ZIP is ${size(byteLength)}, above the ${size(maxBytes)} host import limit. The ZIP can be saved, but Clawd may reject it. Reduce resolution, frame rate, or WebP quality and rebuild.` };
}

class ClawdValidationError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'ClawdValidationError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details = {}) {
  throw new ClawdValidationError(code, message, details);
}

function isRecord(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function mappingKind(value) {
  if (typeof value !== 'string' || value === '') return null;
  if (!MAPPING_PATTERN.test(value)) return 'invalid';
  return value.startsWith('motion:') ? 'motion' : 'fallback';
}

function normalizeMap(value, label) {
  if (value == null) return {};
  if (!isRecord(value)) fail('INVALID_CLAWD_MAPPING', `${label} must be an object.`);
  const result = {};
  for (const [key, mapping] of Object.entries(value)) {
    if (!ALL_STATES.includes(key) && !REACTIONS.includes(key)) fail('UNKNOWN_CLAWD_SLOT', `${label} contains unsupported slot: ${key}`);
    if (mapping !== '' && mappingKind(mapping) !== 'motion' && mappingKind(mapping) !== 'fallback') fail('INVALID_CLAWD_MAPPING', `${label}.${key} must be empty, motion:<id>, or fallback:<state>.`);
    result[key] = mapping;
  }
  return result;
}

function validateMappingFallbacks(mapping, errors) {
  for (const [slot, value] of Object.entries(mapping)) {
    if (mappingKind(value) !== 'fallback') continue;
    if (!FALLBACK_ALLOWED.has(slot)) {
      errors.push({ code: 'FALLBACK_NOT_ALLOWED', slot, message: `${slot} does not allow fallbackTo.` });
      continue;
    }
    const target = value.slice('fallback:'.length);
    if (!ALL_STATES.includes(target)) {
      errors.push({ code: 'UNKNOWN_FALLBACK_TARGET', slot, target, message: `${slot} fallback target ${target} is not a Clawd state.` });
    }
  }
  for (const slot of Object.keys(mapping)) {
    const seen = new Set();
    let current = slot;
    while (mappingKind(mapping[current]) === 'fallback') {
      if (seen.has(current)) {
        errors.push({ code: 'FALLBACK_CYCLE', slot, message: `${slot} fallback chain contains a cycle.` });
        break;
      }
      seen.add(current);
      current = mapping[current].slice('fallback:'.length);
      if (!Object.hasOwn(mapping, current) || mapping[current] === '') {
        errors.push({ code: 'UNRESOLVED_FALLBACK', slot, target: current, message: `${slot} fallback target ${current} is not mapped.` });
        break;
      }
    }
  }
}

function validateClawdMapping(input = {}) {
  const mapping = normalizeMap(input.states || input.mappings, 'states');
  const reactions = normalizeMap(input.reactions, 'reactions');
  const sleepMode = input.sleepMode || input.sleepSequence?.mode || 'direct';
  const errors = [];
  const warnings = [];
  if (!PROFILE.sleepModes.includes(sleepMode)) errors.push({ code: 'INVALID_SLEEP_MODE', message: 'sleepSequence.mode must be direct or full.' });
  for (const slot of PROFILE.states.requiredDirect) if (mappingKind(mapping[slot]) !== 'motion') errors.push({ code: 'REQUIRED_STATE_UNMAPPED', slot, message: `${slot} must map to a real Motion.` });
  if (!mappingKind(mapping.sleeping)) errors.push({ code: 'REQUIRED_STATE_UNMAPPED', slot: 'sleeping', message: 'sleeping must map to a Motion or fallbackTo.' });
  if (sleepMode === 'full') for (const slot of FULL_SLEEP_STATES) if (mappingKind(mapping[slot]) !== 'motion') errors.push({ code: 'FULL_SLEEP_STATE_UNMAPPED', slot, message: `full sleep requires a real Motion for ${slot}.` });
  for (const [slot, value] of Object.entries(reactions)) if (value && mappingKind(value) !== 'motion') errors.push({ code: 'REACTION_FALLBACK_NOT_ALLOWED', slot, message: `${slot} reactions must map directly to a Motion.` });
  validateMappingFallbacks(mapping, errors);
  for (const slot of OPTIONAL_STATES) if (!mapping[slot]) warnings.push({ code: 'OPTIONAL_STATE_UNMAPPED', slot, message: `${slot} is optional and will be omitted.` });
  return { contractVersion: CONTRACT_VERSION, guide: GUIDE_URL, sleepMode, states: mapping, reactions, errors, warnings, ok: errors.length === 0 };
}

function assertValidClawdMapping(input) {
  const result = validateClawdMapping(input);
  if (!result.ok) fail('INVALID_CLAWD_MAPPING', result.errors.map((error) => error.message).join(' '), { errors: result.errors });
  return result;
}

function bytesLength(value) {
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) return value.byteLength;
  if (ArrayBuffer.isView(value)) return value.byteLength;
  if (Number.isInteger(value) && value > 0) return value;
  if (isRecord(value) && Number.isInteger(value.byteLength) && value.byteLength > 0) return value.byteLength;
  return null;
}

function isSafeBasename(value) {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= 255
    && !value.includes('/')
    && !value.includes('\\')
    && value !== '.'
    && value !== '..'
    && !value.includes('..')
    && /^[A-Za-z0-9._-]+$/.test(value);
}

function validateAssetName(name, errors, context) {
  if (!isSafeBasename(name)) {
    errors.push({ code: 'INVALID_CLAWD_ASSET', asset: String(name), message: `${context} must use a safe basename.` });
    return false;
  }
  if (!name.toLowerCase().endsWith('.webp')) {
    errors.push({ code: 'INVALID_CLAWD_ASSET', asset: name, message: `${context} must reference a .webp asset.` });
    return false;
  }
  return true;
}

function validateThemeStateBinding(slot, value, errors, referencedAssets) {
  if (Array.isArray(value)) {
    if (!value.length) {
      errors.push({ code: 'INVALID_CLAWD_STATE_BINDING', slot, message: `${slot} must reference at least one asset.` });
      return 'invalid';
    }
    for (const asset of value) {
      if (typeof asset !== 'string' || !asset.trim()) {
        errors.push({ code: 'INVALID_CLAWD_STATE_BINDING', slot, message: `${slot} asset entries must be non-empty strings.` });
        continue;
      }
      if (validateAssetName(asset, errors, `${slot} asset`)) referencedAssets.add(asset);
    }
    return 'assets';
  }
  if (isRecord(value) && Object.keys(value).length === 1 && typeof value.fallbackTo === 'string' && value.fallbackTo.trim()) return 'fallback';
  if (value == null) return 'missing';
  errors.push({ code: 'INVALID_CLAWD_STATE_BINDING', slot, message: `${slot} must be a non-empty asset list or { fallbackTo }.` });
  return 'invalid';
}

function validateThemeFallbacks(states, stateKinds, errors) {
  for (const [slot, value] of Object.entries(states)) {
    if (stateKinds[slot] !== 'fallback') continue;
    if (!FALLBACK_ALLOWED.has(slot)) {
      errors.push({ code: 'FALLBACK_NOT_ALLOWED', slot, message: `${slot} does not allow fallbackTo.` });
      continue;
    }
    const target = value.fallbackTo;
    if (!ALL_STATES.includes(target)) {
      errors.push({ code: 'UNKNOWN_FALLBACK_TARGET', slot, target, message: `${slot} fallback target ${target} is not a Clawd state.` });
    }
  }
  for (const slot of Object.keys(states)) {
    const seen = new Set();
    let current = slot;
    while (stateKinds[current] === 'fallback') {
      if (seen.has(current)) {
        errors.push({ code: 'FALLBACK_CYCLE', slot, message: `${slot} fallback chain contains a cycle.` });
        break;
      }
      seen.add(current);
      current = states[current].fallbackTo;
      if (!ALL_STATES.includes(current) || !Object.hasOwn(states, current) || !stateKinds[current] || stateKinds[current] === 'missing' || stateKinds[current] === 'invalid') {
        errors.push({ code: 'UNRESOLVED_FALLBACK', slot, target: current, message: `${slot} fallback target ${current} is not mapped.` });
        break;
      }
    }
  }
}

function validatePositiveInteger(value, field, errors, { minimum = 1 } = {}) {
  if (!Number.isSafeInteger(value) || value < minimum) {
    errors.push({ code: 'INVALID_CLAWD_METADATA', field, message: `${field} must be an integer >= ${minimum}.` });
    return false;
  }
  return true;
}

function validateAnimationPool(field, value, errors, referencedAssets) {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    errors.push({ code: 'INVALID_CLAWD_METADATA', field, message: `${field} must be an array.` });
    return;
  }
  for (const [index, entry] of value.entries()) {
    const prefix = `${field}[${index}]`;
    if (!isRecord(entry) || typeof entry.file !== 'string' || !entry.file.trim()) {
      errors.push({ code: 'INVALID_CLAWD_METADATA', field: prefix, message: `${prefix} must provide a file basename.` });
      continue;
    }
    if (validateAssetName(entry.file.trim(), errors, `${prefix}.file`)) referencedAssets.add(entry.file.trim());
    if (entry.duration !== undefined && (!Number.isSafeInteger(entry.duration) || entry.duration <= 0)) {
      errors.push({ code: 'INVALID_CLAWD_METADATA', field: `${prefix}.duration`, message: `${prefix}.duration must be a positive integer in milliseconds.` });
    }
  }
}

function validateTierList(field, value, errors, referencedAssets) {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    errors.push({ code: 'INVALID_CLAWD_METADATA', field, message: `${field} must be an array.` });
    return;
  }
  for (const [index, entry] of value.entries()) {
    const prefix = `${field}[${index}]`;
    if (!isRecord(entry) || typeof entry.file !== 'string' || !entry.file.trim()) {
      errors.push({ code: 'INVALID_CLAWD_METADATA', field: prefix, message: `${prefix} must provide a file basename.` });
      continue;
    }
    if (validateAssetName(entry.file.trim(), errors, `${prefix}.file`)) referencedAssets.add(entry.file.trim());
    validatePositiveInteger(entry.minSessions, `${prefix}.minSessions`, errors);
    if (entry.maxSessions !== undefined && validatePositiveInteger(entry.maxSessions, `${prefix}.maxSessions`, errors)) {
      if (Number.isSafeInteger(entry.minSessions) && entry.maxSessions < entry.minSessions) {
        errors.push({ code: 'INVALID_CLAWD_METADATA', field: `${prefix}.maxSessions`, message: `${prefix}.maxSessions must be >= minSessions.` });
      }
    }
  }
}

function validateClawdBehaviorMetadata(manifest, errors, referencedAssets) {
  if (manifest.roamFlipAssets !== undefined && typeof manifest.roamFlipAssets !== 'boolean') {
    errors.push({ code: 'INVALID_CLAWD_METADATA', field: 'roamFlipAssets', message: 'roamFlipAssets must be a boolean when provided.' });
  }
  validateAnimationPool('idleAnimations', manifest.idleAnimations, errors, referencedAssets);
  validateTierList('workingTiers', manifest.workingTiers, errors, referencedAssets);
  validateTierList('jugglingTiers', manifest.jugglingTiers, errors, referencedAssets);
}

function normalizeThemeAssets(input, errors) {
  if (input == null) {
    errors.push({ code: 'INVALID_CLAWD_ASSET', message: 'Clawd assets must be provided as an object keyed by basenames or an array of asset entries.' });
    return [];
  }
  const entries = [];
  if (Array.isArray(input)) {
    for (const item of input) {
      if (!isRecord(item)) {
        errors.push({ code: 'INVALID_CLAWD_ASSET', message: 'Clawd asset entries must be objects with name and byteLength-compatible content.' });
        continue;
      }
      const size = bytesLength(item.bytes ?? item.byteLength ?? item.data);
      if (!validateAssetName(item.name, errors, 'Clawd asset')) continue;
      if (!Number.isInteger(size) || size < 1) {
        errors.push({ code: 'INVALID_CLAWD_ASSET', asset: item.name, message: `Clawd asset ${item.name} must provide non-empty bytes or byteLength.` });
        continue;
      }
      entries.push({ name: item.name, byteLength: size });
    }
  } else if (isRecord(input)) {
    for (const [name, value] of Object.entries(input)) {
      const size = bytesLength(value);
      if (!validateAssetName(name, errors, 'Clawd asset')) continue;
      if (!Number.isInteger(size) || size < 1) {
        errors.push({ code: 'INVALID_CLAWD_ASSET', asset: name, message: `Clawd asset ${name} must provide non-empty bytes or byteLength.` });
        continue;
      }
      entries.push({ name, byteLength: size });
    }
  } else {
    errors.push({ code: 'INVALID_CLAWD_ASSET', message: 'Clawd assets must be an object keyed by basenames or an array of asset entries.' });
  }
  const seen = new Set();
  for (const entry of entries) {
    if (seen.has(entry.name)) errors.push({ code: 'DUPLICATE_CLAWD_ASSET', asset: entry.name, message: `Clawd asset is declared more than once: ${entry.name}` });
    seen.add(entry.name);
  }
  return entries;
}

function validateClawdThemePackage(input = {}) {
  const errors = [];
  const warnings = [];
  const manifest = input.manifest;
  const maxBytes = Number.isInteger(input.maxBytes) && input.maxBytes > 0 ? input.maxBytes : CLAWD_PACKAGE_LIMIT;
  const byteLength = input.byteLength;
  const referencedAssets = new Set();
  const stateKinds = {};

  if (input.themeId !== undefined && (typeof input.themeId !== 'string' || !SAFE_THEME_ID_PATTERN.test(input.themeId))) {
    errors.push({ code: 'INVALID_CLAWD_THEME_ID', themeId: input.themeId, message: 'themeId must be a safe lowercase identifier using only a-z, 0-9, dot, underscore, or hyphen.' });
  }

  let normalizedStates = {};
  let normalizedReactions = {};
  let sleepMode = 'direct';
  if (!isRecord(manifest)) {
    errors.push({ code: 'INVALID_CLAWD_THEME_MANIFEST', message: 'manifest must be a JSON object.' });
  } else {
    if (manifest.schemaVersion !== CONTRACT_VERSION) errors.push({ code: 'INVALID_CLAWD_THEME_MANIFEST', field: 'schemaVersion', expected: CONTRACT_VERSION, actual: manifest.schemaVersion, message: `theme.json schemaVersion must be ${CONTRACT_VERSION}.` });
    if (typeof manifest.name !== 'string' || !manifest.name.trim()) errors.push({ code: 'INVALID_CLAWD_METADATA', field: 'name', message: 'theme.json name must be a non-empty string.' });
    if (typeof manifest.version !== 'string' || !SEMVER_PATTERN.test(manifest.version)) errors.push({ code: 'INVALID_CLAWD_METADATA', field: 'version', message: 'theme.json version must be a semantic version such as 1.0.0.' });
    if (typeof manifest.description !== 'string' || !manifest.description.trim()) errors.push({ code: 'INVALID_CLAWD_METADATA', field: 'description', message: 'theme.json description must be a non-empty string.' });
    if (!isRecord(manifest.viewBox) || !['x', 'y', 'width', 'height'].every((key) => Number.isFinite(manifest.viewBox[key])) || manifest.viewBox.width <= 0 || manifest.viewBox.height <= 0) {
      errors.push({ code: 'INVALID_CLAWD_METADATA', field: 'viewBox', message: 'theme.json viewBox must provide finite x, y, width, and height values with positive width and height.' });
    }
    const defaultHitBox = manifest.hitBoxes?.default;
    if (!isRecord(defaultHitBox) || !['x', 'y', 'w', 'h'].every(key => Number.isFinite(defaultHitBox[key])) || defaultHitBox.w <= 0 || defaultHitBox.h <= 0) {
      errors.push({ code: 'INVALID_CLAWD_METADATA', field: 'hitBoxes.default', message: 'theme.json requires a finite default hit box with positive width and height for pointer interaction.' });
    }
    if (!isRecord(manifest.eyeTracking) || manifest.eyeTracking.enabled !== false || (Array.isArray(manifest.eyeTracking.states) && manifest.eyeTracking.states.length > 0)) {
      errors.push({ code: 'EYE_TRACKING_UNSUPPORTED', field: 'eyeTracking', message: 'Clawd WebP output must disable eyeTracking and provide no eye-tracking states.' });
    }
    if (!isRecord(manifest.miniMode) || manifest.miniMode.supported !== false) {
      errors.push({ code: 'MINI_MODE_UNSUPPORTED', field: 'miniMode', message: 'Clawd WebP output must mark miniMode.supported as false.' });
    }
    sleepMode = manifest.sleepSequence && manifest.sleepSequence.mode ? manifest.sleepSequence.mode : 'direct';
    if (!PROFILE.sleepModes.includes(sleepMode)) errors.push({ code: 'INVALID_SLEEP_MODE', message: 'sleepSequence.mode must be direct or full.' });

    if (!isRecord(manifest.states)) {
      errors.push({ code: 'INVALID_CLAWD_THEME_MANIFEST', field: 'states', message: 'theme.json states must be an object.' });
    } else {
      normalizedStates = manifest.states;
      for (const [slot, value] of Object.entries(manifest.states)) {
        if (!ALL_STATES.includes(slot)) {
          errors.push({ code: 'UNKNOWN_CLAWD_SLOT', slot, message: `theme.json states contain unsupported slot: ${slot}` });
          continue;
        }
        stateKinds[slot] = validateThemeStateBinding(slot, value, errors, referencedAssets);
      }
    }

    validateClawdBehaviorMetadata(manifest, errors, referencedAssets);

    if (manifest.reactions === undefined) normalizedReactions = {};
    else if (!isRecord(manifest.reactions)) errors.push({ code: 'INVALID_CLAWD_THEME_MANIFEST', field: 'reactions', message: 'theme.json reactions must be an object.' });
    else {
      normalizedReactions = manifest.reactions;
      for (const [slot, value] of Object.entries(manifest.reactions)) {
        if (!REACTIONS.includes(slot)) {
          errors.push({ code: 'UNKNOWN_CLAWD_SLOT', slot, message: `theme.json reactions contain unsupported slot: ${slot}` });
          continue;
        }
        if (!isRecord(value)) {
          errors.push({ code: 'INVALID_CLAWD_REACTION', slot, message: `${slot} reaction must be an object with a file or files field.` });
          continue;
        }
        const allowedKeys = slot === 'drag'
          ? new Set(['file', 'fileLeft', 'fileRight'])
          : new Set(['file', 'files', 'duration']);
        for (const key of Object.keys(value)) if (!allowedKeys.has(key)) errors.push({ code: 'INVALID_CLAWD_REACTION', slot, field: key, message: `${slot} reaction contains unsupported field ${key}.` });
        const files = slot === 'double' && Array.isArray(value.files) ? value.files : (typeof value.file === 'string' ? [value.file] : []);
        const directional = slot === 'drag' ? ['file', 'fileLeft', 'fileRight'].filter((key) => value[key] !== undefined).map((key) => value[key]) : [];
        const candidates = [...files, ...directional];
        if ((slot === 'drag' && (typeof value.file !== 'string' || !value.file.trim())) || !candidates.length || candidates.some((file) => typeof file !== 'string' || !file.trim())) {
          errors.push({ code: 'INVALID_CLAWD_REACTION', slot, message: `${slot} reaction must provide at least one non-empty file.` });
          continue;
        }
        for (const file of candidates) if (validateAssetName(file.trim(), errors, `${slot} reaction`)) referencedAssets.add(file.trim());
        if (slot === 'double' && value.files !== undefined && (!Array.isArray(value.files) || !value.files.length)) errors.push({ code: 'INVALID_CLAWD_REACTION', slot, message: 'double reaction files must be a non-empty array.' });
        if (value.duration !== undefined && (!Number.isSafeInteger(value.duration) || value.duration <= 0)) errors.push({ code: 'INVALID_CLAWD_REACTION', slot, field: 'duration', message: `${slot} reaction duration must be a positive integer in milliseconds.` });
      }
    }
  }

  for (const slot of PROFILE.states.requiredDirect) if (stateKinds[slot] !== 'assets') errors.push({ code: 'REQUIRED_STATE_UNMAPPED', slot, message: `${slot} must bind to one or more WebP assets.` });
  if (stateKinds.sleeping !== 'assets' && stateKinds.sleeping !== 'fallback') errors.push({ code: 'REQUIRED_STATE_UNMAPPED', slot: 'sleeping', message: 'sleeping must bind to one or more WebP assets or fallbackTo.' });
  if (sleepMode === 'full') for (const slot of FULL_SLEEP_STATES) if (stateKinds[slot] !== 'assets') errors.push({ code: 'FULL_SLEEP_STATE_UNMAPPED', slot, message: `full sleep requires one or more WebP assets for ${slot}.` });
  validateThemeFallbacks(normalizedStates, stateKinds, errors);

  const assets = normalizeThemeAssets(input.assets, errors);
  const assetNames = new Set(assets.map((asset) => asset.name));
  for (const asset of referencedAssets) if (!assetNames.has(asset)) errors.push({ code: 'MISSING_CLAWD_ASSET', asset, message: `theme.json references ${asset}, but it is not present in the package assets.` });
  for (const asset of assets) if (!referencedAssets.has(asset.name)) warnings.push({ code: 'UNUSED_CLAWD_ASSET', asset: asset.name, message: `${asset.name} is packaged but not referenced by theme.json.` });

  if (byteLength !== undefined) {
    if (!Number.isInteger(byteLength) || byteLength < 1) errors.push({ code: 'INVALID_CLAWD_PACKAGE_SIZE', byteLength, message: 'byteLength must be a positive integer when provided.' });
    else if (byteLength > maxBytes) {
      const largestAssets = assets.slice().sort((left, right) => right.byteLength - left.byteLength).slice(0, 5).map((asset) => ({ name: asset.name, byteLength: asset.byteLength }));
      warnings.push(clawdPackageSizeWarning(byteLength, maxBytes, largestAssets));
    }
  }

  return {
    contractVersion: CONTRACT_VERSION,
    guide: GUIDE_URL,
    maxBytes,
    ...(typeof input.themeId === 'string' ? { themeId: input.themeId } : {}),
    ...(Number.isInteger(byteLength) ? { byteLength } : {}),
    states: normalizedStates,
    reactions: normalizedReactions,
    assetCount: assets.length,
    referencedAssetCount: referencedAssets.size,
    errors,
    warnings,
    ok: errors.length === 0,
  };
}

function assertValidClawdThemePackage(input) {
  const result = validateClawdThemePackage(input);
  if (!result.ok) fail('INVALID_CLAWD_THEME_PACKAGE', result.errors.map((error) => error.message).join(' '), { errors: result.errors });
  return result;
}

function createClawdTarget(input = {}) {
  const result = assertValidClawdMapping(input);
  return {
    profile: 'clawd',
    contractVersion: CONTRACT_VERSION,
    guide: GUIDE_URL,
    sleepSequence: { mode: result.sleepMode },
    states: result.states,
    reactions: result.reactions,
  };
}

module.exports = {
  ALL_STATES,
  CLAWD_PACKAGE_LIMIT,
  CONTRACT_VERSION,
  CORE_STATES,
  ClawdValidationError,
  FALLBACK_ALLOWED,
  FULL_SLEEP_STATES,
  GUIDE_URL,
  OPTIONAL_STATES,
  PROFILE,
  REACTIONS,
  assertValidClawdMapping,
  assertValidClawdThemePackage,
  createClawdTarget,
  clawdPackageSizeWarning,
  validateClawdMapping,
  validateClawdThemePackage,
};
