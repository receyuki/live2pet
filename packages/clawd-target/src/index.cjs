const CONTRACT_VERSION = 1;
const GUIDE_URL = 'https://github.com/rullerzhou-afk/clawd-on-desk/blob/main/docs/guides/guide-theme-creation.md';
const CORE_STATES = ['idle', 'thinking', 'working', 'sleeping'];
const FULL_SLEEP_STATES = ['yawning', 'dozing', 'collapsing', 'waking'];
const OPTIONAL_STATES = ['error', 'attention', 'notification', 'sweeping', 'carrying', 'juggling', 'roam'];
const REACTIONS = ['drag', 'clickLeft', 'clickRight', 'annoyed', 'double'];
const ALL_STATES = [...CORE_STATES, ...OPTIONAL_STATES, ...FULL_SLEEP_STATES];
const FALLBACK_ALLOWED = new Set(['sleeping', 'error', 'attention', 'notification', 'sweeping', 'carrying', 'roam']);
const MAPPING_PATTERN = /^(motion|fallback):[^\s:][^\s]{0,255}$/;

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

function mappingKind(value) {
  if (typeof value !== 'string' || value === '') return null;
  if (!MAPPING_PATTERN.test(value)) return 'invalid';
  return value.startsWith('motion:') ? 'motion' : 'fallback';
}

function normalizeMap(value, label) {
  if (value == null) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('INVALID_CLAWD_MAPPING', `${label} must be an object.`);
  const result = {};
  for (const [key, mapping] of Object.entries(value)) {
    if (!ALL_STATES.includes(key) && !REACTIONS.includes(key)) fail('UNKNOWN_CLAWD_SLOT', `${label} contains unsupported slot: ${key}`);
    if (mapping !== '' && mappingKind(mapping) !== 'motion' && mappingKind(mapping) !== 'fallback') fail('INVALID_CLAWD_MAPPING', `${label}.${key} must be empty, motion:<id>, or fallback:<state>.`);
    result[key] = mapping;
  }
  return result;
}

function validateFallbacks(mapping, errors) {
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
  if (!['direct', 'full'].includes(sleepMode)) errors.push({ code: 'INVALID_SLEEP_MODE', message: 'sleepSequence.mode must be direct or full.' });
  for (const slot of ['idle', 'thinking', 'working']) if (mappingKind(mapping[slot]) !== 'motion') errors.push({ code: 'REQUIRED_STATE_UNMAPPED', slot, message: `${slot} must map to a real Motion.` });
  if (!mappingKind(mapping.sleeping)) errors.push({ code: 'REQUIRED_STATE_UNMAPPED', slot: 'sleeping', message: 'sleeping must map to a Motion or fallbackTo.' });
  if (sleepMode === 'full') for (const slot of FULL_SLEEP_STATES) if (mappingKind(mapping[slot]) !== 'motion') errors.push({ code: 'FULL_SLEEP_STATE_UNMAPPED', slot, message: `full sleep requires a real Motion for ${slot}.` });
  for (const [slot, value] of Object.entries(reactions)) if (value && mappingKind(value) !== 'motion') errors.push({ code: 'REACTION_FALLBACK_NOT_ALLOWED', slot, message: `${slot} reactions must map directly to a Motion.` });
  validateFallbacks(mapping, errors);
  for (const slot of OPTIONAL_STATES) if (!mapping[slot]) warnings.push({ code: 'OPTIONAL_STATE_UNMAPPED', slot, message: `${slot} is optional and will be omitted.` });
  return { contractVersion: CONTRACT_VERSION, guide: GUIDE_URL, sleepMode, states: mapping, reactions, errors, warnings, ok: errors.length === 0 };
}

function assertValidClawdMapping(input) {
  const result = validateClawdMapping(input);
  if (!result.ok) fail('INVALID_CLAWD_MAPPING', result.errors.map((error) => error.message).join(' '), { errors: result.errors });
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
  CONTRACT_VERSION,
  CORE_STATES,
  ClawdValidationError,
  FALLBACK_ALLOWED,
  FULL_SLEEP_STATES,
  GUIDE_URL,
  OPTIONAL_STATES,
  REACTIONS,
  assertValidClawdMapping,
  createClawdTarget,
  validateClawdMapping,
};
