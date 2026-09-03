const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const SCHEMA_VERSION = 1;
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

function normalizeSource(source) {
  assertRecord(source, 'source');
  const normalized = {
    kind: text(source.kind, 'source.kind', { max: 64 }),
    name: text(source.name, 'source.name', { max: 512 }),
    fingerprint: text(source.fingerprint, 'source.fingerprint', { max: 128 }),
  };
  for (const key of ['path', 'modelConfig']) {
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
  }
  return normalized;
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

function validateProject(input) {
  assertRecord(input, 'project');
  if (input.schemaVersion !== SCHEMA_VERSION) {
    if (Number.isInteger(input.schemaVersion) && input.schemaVersion > SCHEMA_VERSION) {
      fail('UNSUPPORTED_PROJECT_VERSION', `Project schema version ${input.schemaVersion} is newer than supported version ${SCHEMA_VERSION}.`);
    }
    fail('INVALID_PROJECT_VERSION', `Project schemaVersion must be ${SCHEMA_VERSION}.`);
  }
  const project = {
    schemaVersion: SCHEMA_VERSION,
    projectId: normalizeProjectId(input.projectId),
    appVersion: text(input.appVersion, 'appVersion', { max: 64 }),
    name: text(input.name, 'name', { max: 256 }),
    source: normalizeSource(input.source),
    recipes: normalizeRecipes(input.recipes),
    targets: {},
  };
  for (const targetId of TARGETS) project.targets[targetId] = normalizeTarget(input.targets?.[targetId], targetId);
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
  const rightsNote = text(input.rightsNote, 'rightsNote', { required: false, max: 4096 });
  if (rightsNote !== undefined) project.rightsNote = rightsNote;
  const sourceReview = normalizeSourceReview(input.sourceReview);
  if (sourceReview !== undefined) project.sourceReview = sourceReview;
  return project;
}

function createProject(input) {
  return validateProject({
    schemaVersion: SCHEMA_VERSION,
    appVersion: '0.1.0',
    name: 'Untitled Live2Pet Project',
    ...input,
  });
}

function serializeProject(project) {
  return `${JSON.stringify(validateProject(project), null, 2)}\n`;
}

function parseProject(textValue) {
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
  return validateProject(parsed);
}

function saveProjectFile(filePath, project) {
  if (typeof filePath !== 'string' || !filePath.trim()) fail('INVALID_PROJECT_PATH', 'A project file path is required.');
  const serialized = serializeProject(project);
  const absolute = path.resolve(filePath);
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
  return parseProject(fs.readFileSync(absolute, 'utf8'));
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
  const mergedSource = normalizeSource({ ...current.source, ...nextSource });
  const changed = current.source.fingerprint !== mergedSource.fingerprint;
  const nextProject = { ...current, source: mergedSource };
  if (!changed) {
    // Re-inspecting the same bytes is not user acknowledgement of an earlier change.
    return { project: validateProject(nextProject), status: 'relinked', reviewRequired: Boolean(current.sourceReview?.required), affectedRecipeIds: current.sourceReview?.affectedRecipeIds ?? [] };
  }

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
  SCHEMA_VERSION,
  TARGETS,
  RENDER_PRESETS,
  ProjectValidationError,
  createProject,
  acknowledgeSourceReview,
  assertProjectBuildable,
  autosavePath,
  clearAutosaveFile,
  isProjectBuildable,
  loadProjectFile,
  parseProject,
  recoverAutosaveFile,
  relinkProjectSource,
  saveAutosaveFile,
  saveProjectFile,
  serializeProject,
  validateProject,
};
