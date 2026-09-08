const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const PROJECT_FORMAT = 'live2pet-project';
const SCHEMA_VERSION = 3;
const PREVIOUS_SCHEMA_VERSIONS = new Set([1, 2]);
const MAX_VISUAL_ELEMENT_IDS = 4096;
const MAX_VISUAL_ELEMENT_ID_LENGTH = 256;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f-\u009f]/;
const MAX_PROJECT_BYTES = 2 * 1024 * 1024;
const PROJECT_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,95}$/i;
const MAPPING_PATTERN = /^(motion|fallback):[^\s:][^\s]{0,255}$/;
const RECIPE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const TARGETS = ['clawd', 'codex-pet'];
const RENDER_PRESETS = ['compact', 'balanced', 'high'];

class ProjectValidationError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'ProjectValidationError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details = {}) {
  throw new ProjectValidationError(code, message, details);
}

function assertRecord(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail('INVALID_PROJECT', `${label} must be an object.`);
  }
}

function text(value, label, { required = true, max = 512 } = {}) {
  if (value == null && !required) return undefined;
  if (typeof value !== 'string' || (required && !value.trim()) || value.length > max) {
    fail('INVALID_PROJECT', `${label} must be a string${required ? ' and cannot be empty' : ''} (maximum ${max} characters).`);
  }
  return value;
}

function normalizeProjectId(value) {
  const projectId = value || `project-${crypto.randomUUID()}`;
  if (typeof projectId !== 'string' || !PROJECT_ID_PATTERN.test(projectId)) {
    fail('INVALID_PROJECT_ID', 'projectId must contain only letters, numbers, dots, underscores, or hyphens.');
  }
  return projectId;
}

function normalizeVisualSettings(value = { hiddenElementIds: [] }) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !Array.isArray(value.hiddenElementIds)) {
    fail('INVALID_VISUAL_SETTINGS', 'visualSettings.hiddenElementIds must be an array.');
  }
  const ids = value.hiddenElementIds;
  if (ids.length > MAX_VISUAL_ELEMENT_IDS) {
    fail('INVALID_VISUAL_SETTINGS', `visualSettings.hiddenElementIds cannot contain more than ${MAX_VISUAL_ELEMENT_IDS} identities.`, { max: MAX_VISUAL_ELEMENT_IDS });
  }
  const seen = new Set();
  for (const [index, id] of ids.entries()) {
    if (typeof id !== 'string' || !id.length || id.length > MAX_VISUAL_ELEMENT_ID_LENGTH || CONTROL_CHARACTER_PATTERN.test(id)) {
      fail('INVALID_VISUAL_SETTINGS', `visualSettings.hiddenElementIds[${index}] must be a non-empty identity of at most ${MAX_VISUAL_ELEMENT_ID_LENGTH} characters without control characters.`, { index, maxLength: MAX_VISUAL_ELEMENT_ID_LENGTH });
    }
    seen.add(id);
  }
  return { hiddenElementIds: [...seen].sort() };
}

function digestVisualSettings(value = { hiddenElementIds: [] }) {
  const normalized = normalizeVisualSettings(value);
  return crypto.createHash('sha256').update(JSON.stringify(normalized), 'utf8').digest('hex');
}

function normalizeSourceLocation(value, baseDirectory) {
  if (value == null) return undefined;
  assertRecord(value, 'source.location');
  if (!['relative', 'absolute'].includes(value.type)) fail('INVALID_SOURCE_LOCATION', 'source.location.type must be relative or absolute.');
  const locationPath = text(value.path, 'source.location.path', { max: 4096 });
  if (locationPath.includes('\0')) fail('INVALID_SOURCE_LOCATION', 'source.location.path cannot contain null bytes.');
  if (value.type === 'absolute' && !path.isAbsolute(locationPath)) fail('INVALID_SOURCE_LOCATION', 'An absolute source location must contain an absolute path.');
  if (value.type === 'relative' && path.isAbsolute(locationPath)) fail('INVALID_SOURCE_LOCATION', 'A relative source location cannot contain an absolute path.');
  return {
    location: { type: value.type, path: locationPath.replace(/\\/g, '/') },
    path: value.type === 'relative' && baseDirectory ? path.resolve(baseDirectory, locationPath) : locationPath,
  };
}

function normalizeSource(source, { baseDirectory } = {}) {
  assertRecord(source, 'source');
  const normalized = {
    kind: text(source.kind, 'source.kind', { max: 64 }),
    name: text(source.name, 'source.name', { max: 512 }),
    fingerprint: text(source.fingerprint, 'source.fingerprint', { max: 128 }),
  };
  const located = normalizeSourceLocation(source.location, baseDirectory);
  const legacyPath = text(source.path, 'source.path', { required: false, max: 4096 });
  if (located) normalized.location = located.location;
  if (legacyPath !== undefined) normalized.path = legacyPath;
  else if (located) normalized.path = located.path;
  for (const key of ['modelConfig']) {
    const value = text(source[key], `source.${key}`, { required: false, max: 4096 });
    if (value !== undefined) normalized[key] = value;
  }
  return normalized;
}

function normalizeRecipe(recipe, index) {
  assertRecord(recipe, `recipes[${index}]`);
  const id = text(recipe.id, `recipes[${index}].id`, { max: 128 });
  const motionId = text(recipe.motionId, `recipes[${index}].motionId`, { max: 256 });
  const expressionId = text(recipe.expressionId, `recipes[${index}].expressionId`, { required: false, max: 256 });
  const label = text(recipe.label, `recipes[${index}].label`, { required: false, max: 256 });
  const normalized = { id, motionId, expressionId: expressionId ?? null };
  if (label !== undefined) normalized.label = label;
  return normalized;
}

function normalizeRecipes(recipes) {
  if (recipes == null) return [];
  if (!Array.isArray(recipes)) fail('INVALID_PROJECT', 'recipes must be an array.');
  const ids = new Set();
  return recipes.map((recipe, index) => {
    const normalized = normalizeRecipe(recipe, index);
    if (ids.has(normalized.id)) fail('DUPLICATE_RECIPE_ID', `recipes contains duplicate id: ${normalized.id}`);
    ids.add(normalized.id);
    return normalized;
  });
}

function normalizeMappings(mappings, label) {
  if (mappings == null) return {};
  assertRecord(mappings, `${label}.mappings`);
  const normalized = {};
  for (const [key, value] of Object.entries(mappings)) {
    if (!/^[a-z][a-z0-9-]{0,63}$/i.test(key)) fail('INVALID_MAPPING_KEY', `${label}.mappings has an unsafe slot id: ${key}`);
    if (value === '') {
      normalized[key] = '';
      continue;
    }
    if (typeof value !== 'string' || !MAPPING_PATTERN.test(value)) {
      fail('INVALID_MAPPING', `${label}.mappings.${key} must be empty, motion:<id>, or fallback:<state>.`);
    }
    normalized[key] = value;
  }
  return normalized;
}

function normalizeRecipeMappings(mappings, label) {
  if (mappings == null) return undefined;
  assertRecord(mappings, `${label}.recipeMappings`);
  const normalized = {};
  for (const [key, value] of Object.entries(mappings)) {
    if (!/^[a-z][a-z0-9-]{0,63}$/i.test(key)) fail('INVALID_MAPPING_KEY', `${label}.recipeMappings has an unsafe slot id: ${key}`);
    if (value === '') {
      normalized[key] = '';
      continue;
    }
    if (typeof value !== 'string' || !RECIPE_ID_PATTERN.test(value)) {
      fail('INVALID_RECIPE_MAPPING', `${label}.recipeMappings.${key} must be empty or a safe recipe id.`);
    }
    normalized[key] = value;
  }
  return normalized;
}

function normalizeTarget(target, targetId) {
  if (target == null) return { profile: targetId, mappings: {}, reactions: {}, options: {} };
  assertRecord(target, `targets.${targetId}`);
  const profile = text(target.profile || targetId, `targets.${targetId}.profile`, { max: 64 });
  const normalized = {
    profile,
    mappings: normalizeMappings(target.mappings, `targets.${targetId}`),
    reactions: normalizeMappings(target.reactions, `targets.${targetId}.reactions`),
    options: {},
  };
  const recipeMappings = normalizeRecipeMappings(target.recipeMappings, `targets.${targetId}`);
  if (recipeMappings !== undefined) normalized.recipeMappings = recipeMappings;
  const renderPreset = target.renderPreset ?? target.options?.renderPreset;
  if (renderPreset !== undefined) {
    if (typeof renderPreset !== 'string' || !RENDER_PRESETS.includes(renderPreset.trim().toLowerCase())) {
      fail('INVALID_RENDER_PRESET', `targets.${targetId}.renderPreset must be compact, balanced, or high.`);
    }
    normalized.renderPreset = renderPreset.trim().toLowerCase();
  }
  if (target.options != null) {
    assertRecord(target.options, `targets.${targetId}.options`);
    normalized.options = JSON.parse(JSON.stringify(target.options));
    delete normalized.options.renderPreset;
    if (normalized.options.renderOverrides !== undefined) {
      if (targetId !== 'clawd') fail('INVALID_RENDER_SETTINGS', 'Custom render settings are currently supported for Clawd only.');
      normalized.options.renderOverrides = normalizeClawdRenderOverrides(normalized.options.renderOverrides);
    }
  }
  return normalized;
}

function normalizeClawdRenderOverrides(value) {
  assertRecord(value, 'Clawd render overrides');
  const ranges = { width: [1, 2048], height: [1, 2048], fps: [1, 60], quality: [1, 100] };
  const result = {};
  for (const [key, number] of Object.entries(value)) {
    const range = ranges[key];
    if (!range || !Number.isInteger(number) || number < range[0] || number > range[1]) fail('INVALID_RENDER_SETTINGS', `Clawd ${key} must be an integer ${range ? `between ${range[0]} and ${range[1]}` : 'in a supported render field'}.`);
    result[key] = number;
  }
  return result;
}

function normalizeSourceReview(review) {
  if (review == null) return undefined;
  assertRecord(review, 'sourceReview');
  if (typeof review.required !== 'boolean') fail('INVALID_PROJECT', 'sourceReview.required must be a boolean.');
  const reason = text(review.reason, 'sourceReview.reason', { required: false, max: 128 });
  const reviewedFingerprint = text(review.reviewedFingerprint, 'sourceReview.reviewedFingerprint', { required: false, max: 128 });
  if (!Array.isArray(review.affectedRecipeIds) || review.affectedRecipeIds.some((id) => typeof id !== 'string' || !id.trim() || id.length > 128)) {
    fail('INVALID_PROJECT', 'sourceReview.affectedRecipeIds must be an array of recipe ids.');
  }
  return {
    required: review.required,
    ...(reason !== undefined ? { reason } : {}),
    ...(reviewedFingerprint !== undefined ? { reviewedFingerprint } : {}),
    affectedRecipeIds: [...new Set(review.affectedRecipeIds)],
  };
}

function validateProject(input, { baseDirectory } = {}) {
  assertRecord(input, 'project');
  const schemaVersion = input.schemaVersion;
  if (schemaVersion !== SCHEMA_VERSION && !PREVIOUS_SCHEMA_VERSIONS.has(schemaVersion)) {
    if (Number.isInteger(schemaVersion) && schemaVersion > SCHEMA_VERSION) {
      fail('UNSUPPORTED_PROJECT_VERSION', `Project schema version ${schemaVersion} is newer than supported version ${SCHEMA_VERSION}.`);
    }
    fail('INVALID_PROJECT_VERSION', `Project schemaVersion must be ${SCHEMA_VERSION}.`);
  }
  if (schemaVersion === SCHEMA_VERSION && input.format !== PROJECT_FORMAT) fail('INVALID_PROJECT_FORMAT', `Project format must be ${PROJECT_FORMAT}.`);
  // Schema v1 did not persist Visual Settings. Schema v1 and v2 used source.path
  // directly. Both migrate into the v3 in-memory shape without mutating the file.
  const source = {
    ...input,
    format: PROJECT_FORMAT,
    schemaVersion: SCHEMA_VERSION,
    ...(schemaVersion === 1 ? { visualSettings: { hiddenElementIds: [] } } : {}),
  };
  const project = {
    format: PROJECT_FORMAT,
    schemaVersion: SCHEMA_VERSION,
    projectId: normalizeProjectId(source.projectId),
    appVersion: text(source.appVersion, 'appVersion', { max: 64 }),
    name: text(source.name, 'name', { max: 256 }),
    source: normalizeSource(source.source, { baseDirectory }),
    recipes: normalizeRecipes(source.recipes),
    visualSettings: normalizeVisualSettings(source.visualSettings),
    targets: {},
  };
  for (const targetId of TARGETS) project.targets[targetId] = normalizeTarget(source.targets?.[targetId], targetId);
  const recipesById = new Map(project.recipes.map((recipe) => [recipe.id, recipe]));
  for (const [targetId, target] of Object.entries(project.targets)) {
    for (const [slot, recipeId] of Object.entries(target.recipeMappings || {})) {
      if (!recipeId) continue;
      const recipe = recipesById.get(recipeId);
      if (!recipe) fail('UNKNOWN_RECIPE_ID', `targets.${targetId}.recipeMappings.${slot} references an unknown recipe: ${recipeId}`);
      const mapping = target.mappings[slot] || target.reactions[slot];
      if (typeof mapping !== 'string' || !mapping.startsWith('motion:') || mapping.slice(7) !== recipe.motionId) {
        fail('RECIPE_MAPPING_MISMATCH', `targets.${targetId}.recipeMappings.${slot} must match motion:${recipe.motionId}.`);
      }
    }
  }
  const rightsNote = text(source.rightsNote, 'rightsNote', { required: false, max: 4096 });
  if (rightsNote !== undefined) project.rightsNote = rightsNote;
  const sourceReview = normalizeSourceReview(source.sourceReview);
  if (sourceReview !== undefined) project.sourceReview = sourceReview;
  return project;
}

function createProject(input) {
  return validateProject({
    format: PROJECT_FORMAT,
    schemaVersion: SCHEMA_VERSION,
    appVersion: '0.1.0',
    name: 'Untitled Live2Pet Project',
    ...input,
  });
}

function storageSource(project, { baseDirectory, sourceLocation } = {}) {
  const source = { ...project.source };
  let location = sourceLocation;
  if (!location && source.path) {
    if (baseDirectory && path.isAbsolute(source.path)) {
      const relative = path.relative(baseDirectory, source.path);
      location = path.isAbsolute(relative)
        ? { type: 'absolute', path: source.path }
        : { type: 'relative', path: relative || '.' };
    } else {
      location = { type: path.isAbsolute(source.path) ? 'absolute' : 'relative', path: source.path };
    }
  }
  delete source.path;
  if (location) source.location = normalizeSourceLocation(location).location;
  else delete source.location;
  return source;
}

function serializeProject(project, options = {}) {
  const validated = validateProject(project);
  const stored = { ...validated, source: storageSource(validated, options) };
  return `${JSON.stringify(stored, null, 2)}\n`;
}

function parseProject(textValue, options = {}) {
  if (typeof textValue !== 'string') fail('INVALID_PROJECT', 'Project content must be text.');
  if (Buffer.byteLength(textValue, 'utf8') > MAX_PROJECT_BYTES) {
    fail('PROJECT_TOO_LARGE', `Project exceeds the ${MAX_PROJECT_BYTES}-byte limit.`);
  }
  let parsed;
  try {
    parsed = JSON.parse(textValue);
  } catch (error) {
    fail('INVALID_PROJECT_JSON', 'Project is not valid UTF-8 JSON.', { cause: String(error.message || error) });
  }
  return validateProject(parsed, options);
}

function saveProjectFile(filePath, project) {
  if (typeof filePath !== 'string' || !filePath.trim()) fail('INVALID_PROJECT_PATH', 'A project file path is required.');
  const absolute = path.resolve(filePath);
  const serialized = serializeProject(project, { baseDirectory: path.dirname(absolute) });
  const temporary = `${absolute}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, serialized, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    fs.renameSync(temporary, absolute);
  } catch (error) {
    try { fs.unlinkSync(temporary); } catch {}
    throw error;
  }
  return absolute;
}

function loadProjectFile(filePath) {
  if (typeof filePath !== 'string' || !filePath.trim()) fail('INVALID_PROJECT_PATH', 'A project file path is required.');
  const absolute = path.resolve(filePath);
  return parseProject(fs.readFileSync(absolute, 'utf8'), { baseDirectory: path.dirname(absolute) });
}

function autosavePath(filePath) {
  if (typeof filePath !== 'string' || !filePath.trim()) fail('INVALID_PROJECT_PATH', 'A project file path is required.');
  return `${path.resolve(filePath)}.autosave`;
}

function saveAutosaveFile(filePath, project) {
  return saveProjectFile(autosavePath(filePath), project);
}

function clearAutosaveFile(filePath) {
  const absolute = autosavePath(filePath);
  try { fs.unlinkSync(absolute); } catch (error) {
    if (error && error.code !== 'ENOENT') throw error;
  }
  return absolute;
}

function recoverAutosaveFile(filePath) {
  const primary = path.resolve(filePath);
  const autosave = autosavePath(filePath);
  let autosaveStat;
  try { autosaveStat = fs.statSync(autosave); } catch (error) {
    if (error && error.code === 'ENOENT') return { available: false, path: autosave };
    throw error;
  }
  let primaryStat = null;
  try { primaryStat = fs.statSync(primary); } catch (error) {
    if (error && error.code !== 'ENOENT') throw error;
  }
  if (primaryStat && autosaveStat.mtimeMs <= primaryStat.mtimeMs) return { available: false, path: autosave, reason: 'autosave-not-newer' };
  return { available: true, path: autosave, modifiedAt: autosaveStat.mtime.toISOString(), project: loadProjectFile(autosave) };
}

function recipeDependencyIds(recipe) {
  return { motionId: recipe.motionId, expressionId: recipe.expressionId || null };
}

function relinkProjectSource(project, nextSource, { previousManifest, nextManifest } = {}) {
  const current = validateProject(project);
  assertRecord(nextSource, 'nextSource');
  const mergedSourceInput = { ...current.source, ...nextSource };
  if (Object.hasOwn(nextSource, 'path') && !Object.hasOwn(nextSource, 'location')) delete mergedSourceInput.location;
  const mergedSource = normalizeSource(mergedSourceInput);
  const changed = current.source.fingerprint !== mergedSource.fingerprint;
  const nextProject = { ...current, source: mergedSource };
  if (!changed) {
    // Re-inspecting the same bytes is not user acknowledgement of an earlier change.
    return { project: validateProject(nextProject), status: 'relinked', reviewRequired: Boolean(current.sourceReview?.required), affectedRecipeIds: current.sourceReview?.affectedRecipeIds ?? [] };
  }

  // Part identities belong to the old source, not another model with possibly
  // unrelated IDs. A path-only move above retains the manual visibility set.
  nextProject.visualSettings = { hiddenElementIds: [] };
  const previousMotions = new Set(Array.isArray(previousManifest?.motions) ? previousManifest.motions.map((motion) => String(motion.id)) : []);
  const nextMotions = new Set(Array.isArray(nextManifest?.motions) ? nextManifest.motions.map((motion) => String(motion.id)) : []);
  const previousExpressions = new Set(Array.isArray(previousManifest?.expressions) ? previousManifest.expressions.map((expression) => String(expression.id)) : []);
  const nextExpressions = new Set(Array.isArray(nextManifest?.expressions) ? nextManifest.expressions.map((expression) => String(expression.id)) : []);
  const hasComparableManifests = previousMotions.size > 0 || previousExpressions.size > 0 || nextMotions.size > 0 || nextExpressions.size > 0;
  const affectedRecipeIds = current.recipes.filter((recipe) => {
    if (!hasComparableManifests) return true;
    const dependency = recipeDependencyIds(recipe);
    return !nextMotions.has(dependency.motionId) || (dependency.expressionId !== null && !nextExpressions.has(dependency.expressionId)) || (previousMotions.has(dependency.motionId) && !nextMotions.has(dependency.motionId));
  }).map((recipe) => recipe.id);
  const reviewRequired = current.recipes.length > 0;
  nextProject.sourceReview = {
    required: reviewRequired,
    reason: 'source-fingerprint-changed',
    affectedRecipeIds: affectedRecipeIds.length ? affectedRecipeIds : current.recipes.map((recipe) => recipe.id),
  };
  return { project: validateProject(nextProject), status: 'source-changed', reviewRequired, affectedRecipeIds: nextProject.sourceReview.affectedRecipeIds };
}

function acknowledgeSourceReview(project) {
  const current = validateProject(project);
  if (!current.sourceReview?.required) return current;
  return validateProject({ ...current, sourceReview: { ...current.sourceReview, required: false, reviewedFingerprint: current.source.fingerprint } });
}

function isProjectBuildable(project) {
  const current = validateProject(project);
  return !current.sourceReview?.required;
}

function assertProjectBuildable(project) {
  const current = validateProject(project);
  if (current.sourceReview?.required) fail('PROJECT_REVIEW_REQUIRED', 'The Source Package changed and affected mappings must be reviewed before building.', { affectedRecipeIds: current.sourceReview.affectedRecipeIds });
  return current;
}

module.exports = {
  MAX_PROJECT_BYTES,
  MAX_VISUAL_ELEMENT_IDS,
  MAX_VISUAL_ELEMENT_ID_LENGTH,
  PROJECT_FORMAT,
  SCHEMA_VERSION,
  TARGETS,
  RENDER_PRESETS,
  ProjectValidationError,
  createProject,
  acknowledgeSourceReview,
  assertProjectBuildable,
  autosavePath,
  clearAutosaveFile,
  digestVisualSettings,
  isProjectBuildable,
  loadProjectFile,
  parseProject,
  recoverAutosaveFile,
  relinkProjectSource,
  normalizeVisualSettings,
  normalizeClawdRenderOverrides,
  saveAutosaveFile,
  saveProjectFile,
  serializeProject,
  validateProject,
};
