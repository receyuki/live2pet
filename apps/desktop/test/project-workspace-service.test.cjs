const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { createProject, loadProjectFile, saveProjectFile } = require('../../../packages/project/src/index.cjs');
const {
  MAX_RECENT_PROJECTS,
  createProjectSourceService,
  createProjectWorkspaceService,
  loadWindowBounds,
  normalizeRecentState,
  normalizeWindowBounds,
} = require('../project-workspace-service.cjs');

function fixtureProject(name = 'Cat Project') {
  return createProject({ name, projectId: `project-${name.toLowerCase().replace(/\W+/g, '-')}`, source: { kind: 'live2d', name: 'cat', fingerprint: 'fixture' }, targets: {} });
}

test('opens a dropped project path without showing the picker and registers it for saving', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'live2pet-project-drop-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const inputPath = path.join(root, 'dropped.live2pet');
  saveProjectFile(inputPath, fixtureProject());
  const service = createProjectWorkspaceService({ stateFile: path.join(root, 'recent.json'), showOpenDialog: async () => { assert.fail('A drop must not open the picker'); }, showSaveDialog: async () => { assert.fail('A dropped document is already registered'); } });
  const opened = await service.openProject({ inputPath });
  assert.equal(opened.fileName, 'dropped.live2pet');
  await service.saveProject({ documentId: opened.documentId, project: { ...opened.project, name: 'Renamed' } });
  assert.equal(loadProjectFile(inputPath).name, 'Renamed');
});

test('project workspace opens, saves, and persists opaque recent documents', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'live2pet-workspace-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const stateFile = path.join(root, 'user-data', 'recent-projects.json');
  const originalPath = path.join(root, 'private-source-name.live2pet');
  const savedAsPath = path.join(root, 'saved-copy');
  saveProjectFile(originalPath, fixtureProject());
  let openResult = { canceled: false, filePaths: [originalPath] };
  let saveResult = { canceled: false, filePath: savedAsPath };
  const service = createProjectWorkspaceService({
    stateFile,
    showOpenDialog: async () => openResult,
    showSaveDialog: async () => saveResult,
  });

  const opened = await service.openProject();
  assert.equal(opened.cancelled, false);
  assert.equal(opened.fileName, 'private-source-name.live2pet');
  assert.equal(opened.project.name, 'Cat Project');
  assert.ok(/^[A-Za-z0-9_-]{8,128}$/.test(opened.documentId));
  assert.equal(JSON.stringify(opened).includes(root), false);
  assert.deepEqual(await service.getRecentProjects(), opened.recentProjects);

  const updated = { ...opened.project, name: 'Updated Cat' };
  const saved = await service.saveProject({ documentId: opened.documentId, project: updated });
  assert.equal(saved.documentId, opened.documentId);
  assert.equal(loadProjectFile(originalPath).name, 'Updated Cat');

  const savedAs = await service.saveProject({ documentId: opened.documentId, project: updated, saveAs: true });
  assert.equal(savedAs.fileName, 'saved-copy.live2pet');
  assert.equal(fs.existsSync(`${savedAsPath}.live2pet`), true);
  assert.equal((await service.getRecentProjects()).length, 2);

  const restored = createProjectWorkspaceService({ stateFile, showOpenDialog: async () => openResult, showSaveDialog: async () => saveResult });
  assert.equal((await restored.getRecentProjects())[0].documentId, savedAs.documentId);
});

test('project workspace handles cancellation, unknown ids, missing files, and corrupt bounded state', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'live2pet-workspace-errors-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const stateFile = path.join(root, 'recent.json');
  fs.writeFileSync(stateFile, '{broken json');
  const service = createProjectWorkspaceService({
    stateFile,
    showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
    showSaveDialog: async () => ({ canceled: true }),
  });
  assert.deepEqual(await service.openProject(), { cancelled: true, recentProjects: [] });
  assert.deepEqual(await service.saveProject({ project: fixtureProject('Cancel') }), { cancelled: true, recentProjects: [] });
  await assert.rejects(service.openProject({ documentId: 'unknown_123' }), (error) => error.code === 'PROJECT_DOCUMENT_NOT_FOUND');

  const entries = Array.from({ length: 12 }, (_, index) => ({ documentId: `document_${String(index).padStart(3, '0')}`, path: path.join(root, `${index}.live2pet`), name: `P${index}`, fileName: `${index}.live2pet` }));
  assert.equal(normalizeRecentState({ version: 1, recent: entries }).length, MAX_RECENT_PROJECTS);
  assert.deepEqual(normalizeRecentState({ version: 1, recent: [{ documentId: 'document_001', path: 'relative.live2pet' }] }), []);
});

test('project workspace does not expose local paths in file-system errors', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'live2pet-workspace-redaction-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const missingPath = path.join(root, 'private-project-name.live2pet');
  const service = createProjectWorkspaceService({
    stateFile: path.join(root, 'recent.json'),
    showOpenDialog: async () => ({ canceled: false, filePaths: [missingPath] }),
    showSaveDialog: async () => ({ canceled: true }),
  });

  await assert.rejects(service.openProject(), (error) => {
    assert.equal(error.code, 'PROJECT_OPEN_FAILED');
    assert.equal(error.message.includes(root), false);
    assert.equal(error.message.includes('private-project-name'), false);
    return true;
  });
});

test('project Source service relinks inspected manifests, retains host paths privately, and gates changed recipes', async () => {
  const sourceRegistry = new Map();
  const project = createProject({
    name: 'Relink fixture', projectId: 'relink-fixture',
    source: { kind: 'standard-directory', name: 'old', fingerprint: 'old-fingerprint', modelConfig: 'old.model3.json' },
    recipes: [
      { id: 'idle-recipe', motionId: 'idle', expressionId: null },
      { id: 'smile-recipe', motionId: 'wave', expressionId: 'smile' },
    ],
    targets: {},
  });
  sourceRegistry.set(project.projectId, {
    inputPath: '/private/old-source', sourceFingerprint: project.source.fingerprint,
    manifest: { motions: [{ id: 'idle' }, { id: 'wave' }], expressions: [{ id: 'smile' }] },
  });
  const nextManifest = {
    schemaVersion: 1,
    source: { kind: 'pck', name: 'new', fingerprint: 'new-fingerprint', modelConfig: 'new.model3.json' },
    model: { cubism: 4 }, motions: [{ id: 'idle' }], expressions: [], resources: [], warnings: [],
  };
  const calls = [];
  const service = createProjectSourceService({
    sourceRegistry,
    inspectSource: async (input) => { calls.push(input); return nextManifest; },
  });

  const result = await service.relink({ project, inputPath: '/private/new-source.pck' });
  assert.deepEqual(calls, [{ inputPath: '/private/new-source.pck', modelConfig: 'old.model3.json' }]);
  assert.equal(result.status, 'source-changed');
  assert.equal(result.reviewRequired, true);
  assert.deepEqual(result.affectedRecipeIds, ['smile-recipe']);
  assert.equal(result.project.source.fingerprint, 'new-fingerprint');
  assert.equal(result.project.source.path, '/private/new-source.pck');
  assert.equal(sourceRegistry.get(project.projectId).inputPath, '/private/new-source.pck');
  assert.equal(sourceRegistry.get(project.projectId).manifest, nextManifest);

  const acknowledged = await service.acknowledgeReview({ project: result.project });
  assert.equal(acknowledged.project.sourceReview.required, false);
  assert.equal(acknowledged.project.sourceReview.reviewedFingerprint, 'new-fingerprint');
});

test('project Source service never registers failed inspections', async () => {
  const sourceRegistry = new Map([['existing-1', {}], ['existing-2', {}]]);
  const service = createProjectSourceService({
    sourceRegistry, maxSources: 2,
    inspectSource: async () => { throw Object.assign(new Error('inspection failed'), { code: 'SOURCE_INVALID' }); },
  });
  await assert.rejects(service.relink({ project: fixtureProject('Failed relink'), inputPath: '/private/failure' }), (error) => error.code === 'SOURCE_INVALID');
  assert.deepEqual([...sourceRegistry.keys()], ['existing-1', 'existing-2']);
});

test('window bounds restore only validated, visible geometry and clamp to a display', (t) => {
  const displays = [{ workArea: { x: 0, y: 0, width: 1440, height: 900 } }];
  assert.deepEqual(normalizeWindowBounds({ x: 1200, y: 700, width: 1000, height: 700 }, displays), { x: 440, y: 200, width: 1000, height: 700 });
  assert.equal(normalizeWindowBounds({ x: 5000, y: 5000, width: 1000, height: 700 }, displays), null);
  assert.equal(normalizeWindowBounds({ x: 0, y: 0, width: 400, height: 300 }, displays), null);

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'live2pet-window-state-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const stateFile = path.join(root, 'window.json');
  fs.writeFileSync(stateFile, JSON.stringify({ version: 1, bounds: { x: 10, y: 20, width: 1000, height: 700 } }));
  assert.deepEqual(loadWindowBounds(stateFile, displays), { x: 10, y: 20, width: 1000, height: 700 });
  fs.writeFileSync(stateFile, '{corrupt');
  assert.equal(loadWindowBounds(stateFile, displays), null);
});
