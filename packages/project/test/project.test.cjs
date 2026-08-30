const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  ProjectValidationError,
  createProject,
  loadProjectFile,
  parseProject,
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
