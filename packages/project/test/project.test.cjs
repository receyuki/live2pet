const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  acknowledgeSourceReview,
  assertProjectBuildable,
  ProjectValidationError,
  createProject,
  clearAutosaveFile,
  isProjectBuildable,
  loadProjectFile,
  parseProject,
  recoverAutosaveFile,
  relinkProjectSource,
  saveAutosaveFile,
  saveProjectFile,
  serializeProject,
} = require('../src/index.cjs');

function fixture() {
  return createProject({
    projectId: 'saint-louis',
    appVersion: '0.1.0',
    name: "Saint Louis - Holy Knight's Resplendence",
    source: {
      kind: 'destiny-child-pck',
      name: 'c311_02.pck',
      path: '/private/models/c311_02.pck',
      fingerprint: 'sha256:fixture',
      modelConfig: 'model.json',
    },
    recipes: [
      { id: 'idle-recipe', motionId: 'idle:0', expressionId: null },
      { id: 'smile-recipe', motionId: 'idle:1', expressionId: '0', label: 'Smile idle' },
    ],
    targets: {
      clawd: {
        profile: 'clawd',
        mappings: { idle: 'motion:idle:0', sleeping: 'fallback:idle' },
        reactions: { drag: 'motion:idle:1' },
        options: { sleepMode: 'direct', outputPrefix: 'saint-louis' },
      },
    },
    rightsNote: 'Personal use only; source remains local.',
  });
}

test('creates and round-trips a reference-only Live2Pet Project', () => {
  const project = fixture();
  const text = serializeProject(project);
  const parsed = parseProject(text);

  assert.deepEqual(parsed, project);
  assert.equal(text.endsWith('\n'), true);
  assert.equal(text.includes('runtimeBytes'), false);
  assert.equal(text.includes('modelData'), false);
});

test('normalizes missing targets without embedding source assets', () => {
  const project = createProject({
    projectId: 'minimal',
    source: { kind: 'standard-directory', name: 'hero', fingerprint: 'fingerprint' },
  });

  assert.deepEqual(project.targets['codex-pet'], { profile: 'codex-pet', mappings: {}, reactions: {}, options: {} });
  assert.deepEqual(project.recipes, []);
  assert.equal(Object.hasOwn(project.source, 'runtime'), false);
});

test('rejects future schema versions, duplicate recipes, and malformed mappings', () => {
  assert.throws(
    () => parseProject(JSON.stringify({ schemaVersion: 2 })),
    (error) => error instanceof ProjectValidationError && error.code === 'UNSUPPORTED_PROJECT_VERSION',
  );

  const duplicate = fixture();
  duplicate.recipes.push(duplicate.recipes[0]);
  assert.throws(
    () => serializeProject(duplicate),
    (error) => error instanceof ProjectValidationError && error.code === 'DUPLICATE_RECIPE_ID',
  );

  const malformed = fixture();
  malformed.targets.clawd.mappings.idle = 'motion';
  assert.throws(
    () => serializeProject(malformed),
    (error) => error instanceof ProjectValidationError && error.code === 'INVALID_MAPPING',
  );
  const invalidPreset = fixture();
  invalidPreset.targets.clawd.renderPreset = 'ultra';
  assert.throws(
    () => serializeProject(invalidPreset),
    (error) => error instanceof ProjectValidationError && error.code === 'INVALID_RENDER_PRESET',
  );
});

test('normalizes a target Render Preset without retaining a duplicate option', () => {
  const project = createProject({
    projectId: 'preset',
    name: 'Preset',
    source: { kind: 'standard-directory', name: 'fixture', fingerprint: 'fingerprint' },
    targets: { clawd: { options: { renderPreset: 'HIGH', sleepMode: 'direct' } } },
  });
  assert.equal(project.targets.clawd.renderPreset, 'high');
  assert.deepEqual(project.targets.clawd.options, { sleepMode: 'direct' });
});

test('saves atomically and reloads the same project', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'live2pet-project-'));
  const filePath = path.join(directory, 'project.live2pet');
  const saved = saveProjectFile(filePath, fixture());
  assert.equal(saved, path.resolve(filePath));
  assert.deepEqual(loadProjectFile(filePath), fixture());
  assert.equal(fs.statSync(filePath).mode & 0o777, 0o600);
  assert.equal(fs.readdirSync(directory).filter((entry) => entry.endsWith('.tmp')).length, 0);
});

test('relinks a moved source without forcing review when the fingerprint is unchanged', () => {
  const project = fixture();
  const result = relinkProjectSource(project, { path: '/new/location/c311_02.pck' });
  assert.equal(result.status, 'relinked');
  assert.equal(result.reviewRequired, false);
  assert.equal(result.project.source.path, '/new/location/c311_02.pck');
  assert.equal(Object.hasOwn(result.project, 'sourceReview'), false);
  assert.equal(result.project.recipes.length, project.recipes.length);
});

test('marks changed sources for review and blocks builds until acknowledged', () => {
  const project = fixture();
  const result = relinkProjectSource(project, { fingerprint: 'sha256:changed', path: '/new/c311_02.pck' });
  assert.equal(result.status, 'source-changed');
  assert.equal(result.reviewRequired, true);
  assert.deepEqual(result.affectedRecipeIds, ['idle-recipe', 'smile-recipe']);
  assert.equal(isProjectBuildable(result.project), false);
  assert.throws(() => assertProjectBuildable(result.project), (error) => error instanceof ProjectValidationError && error.code === 'PROJECT_REVIEW_REQUIRED');
  const acknowledged = acknowledgeSourceReview(result.project);
  assert.equal(isProjectBuildable(acknowledged), true);
  assert.equal(acknowledged.sourceReview.required, false);
  assert.equal(acknowledged.sourceReview.reviewedFingerprint, 'sha256:changed');
});

test('preserves only affected recipe ids when comparable manifests reveal a missing dependency', () => {
  const project = fixture();
  const result = relinkProjectSource(project, { fingerprint: 'sha256:changed' }, {
    previousManifest: { motions: [{ id: 'idle:0' }, { id: 'idle:1' }], expressions: [{ id: '0' }] },
    nextManifest: { motions: [{ id: 'idle:0' }], expressions: [] },
  });
  assert.deepEqual(result.affectedRecipeIds, ['smile-recipe']);
  assert.deepEqual(result.project.sourceReview.affectedRecipeIds, ['smile-recipe']);
});

test('offers explicit autosave recovery and cleanup', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'live2pet-autosave-'));
  const filePath = path.join(directory, 'project.live2pet');
  saveProjectFile(filePath, fixture());
  const autosave = saveAutosaveFile(filePath, fixture());
  fs.utimesSync(autosave, new Date(Date.now() + 1000), new Date(Date.now() + 1000));
  const recovery = recoverAutosaveFile(filePath);
  assert.equal(recovery.available, true);
  assert.equal(recovery.project.projectId, 'saint-louis');
  assert.equal(recovery.path, autosave);
  assert.equal(clearAutosaveFile(filePath), autosave);
  assert.equal(recoverAutosaveFile(filePath).available, false);
});
