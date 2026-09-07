const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { createSourceLibraryService, parseGitHubTreeUrl, pruneGithubCache } = require('../source-library-service.cjs');

function temporaryDirectory() { return fs.mkdtempSync(path.join(os.tmpdir(), 'live2pet-source-library-')); }

test('accepts public GitHub repository and tree folder URLs only', () => {
  assert.deepEqual(parseGitHubTreeUrl('https://github.com/MilkyLan/AzurLane-Live2d/tree/main/live2d'), {
    owner: 'MilkyLan', repo: 'AzurLane-Live2d', ref: 'main', folder: 'live2d',
  });
  assert.deepEqual(parseGitHubTreeUrl('https://github.com/Jelosus2/BD2-L2D-Viewer'), {
    owner: 'Jelosus2', repo: 'BD2-L2D-Viewer', ref: null, folder: '',
  });
  for (const value of ['http://github.com/a/b', 'https://gitlab.com/a/b', 'https://user:token@github.com/a/b', 'https://github.com/a/b/blob/main/model.json']) {
    assert.throws(() => parseGitHubTreeUrl(value), (error) => error.code === 'INVALID_GITHUB_URL');
  }
});

test('opens a local folder as a two-level model library without exposing its paths', async () => {
  const root = temporaryDirectory();
  const service = createSourceLibraryService({
    showOpenDialog: async () => ({ canceled: false, filePaths: [root] }),
    discoverSources: (inputPath, options) => ({ name: 'models', candidates: [{ id: 'source-1', name: 'Hero', relativePath: 'hero/hero.model3.json', format: 'live2d', inputPath, modelConfig: 'hero.model3.json' }], options }),
    inspectSource: async ({ inputPath, modelConfig }) => ({ schemaVersion: 1, source: { fingerprint: 'a'.repeat(64) }, model: { cubism: 4, inputPath, modelConfig }, motions: [], expressions: [], resources: [], warnings: [] }),
    githubCacheRoot: path.join(root, 'github-cache'),
  });
  const opened = await service.openLocal();
  assert.equal(opened.library.candidates[0].inputPath, undefined);
  assert.equal(JSON.stringify(opened.library).includes(root), false);
  const selected = await service.inspect({ libraryId: opened.library.libraryId, sourceId: 'source-1' });
  assert.equal(selected.inspection.model.modelConfig, 'hero.model3.json');
});

test('browses GitHub tree metadata then downloads only the selected model folder', async () => {
  const root = temporaryDirectory();
  const requests = [];
  const entries = [
    { path: 'hero/hero.model3.json', type: 'blob', size: 64 },
    { path: 'hero/hero.moc3', type: 'blob', size: 4 },
    { path: 'hero/textures/hero.png', type: 'blob', size: 4 },
    { path: 'other/other.model3.json', type: 'blob', size: 64 },
    { path: 'other/other.moc3', type: 'blob', size: 4 },
  ];
  const fetchImpl = async (url) => {
    requests.push(url);
    if (url.includes('/contents/live2d?')) return { ok: true, json: async () => ({ type: 'dir', sha: 'tree-sha' }) };
    if (url.includes('/git/trees/')) return { ok: true, json: async () => ({ sha: 'tree-sha', truncated: false, tree: entries }) };
    return { ok: true, arrayBuffer: async () => Buffer.from(url.includes('.json') ? '{"Version":3}' : 'data') };
  };
  const inspected = [];
  const service = createSourceLibraryService({
    showOpenDialog: async () => ({ canceled: true }),
    discoverSources: () => assert.fail('remote browsing must not scan a local clone'),
    inspectSource: async (input) => {
      inspected.push(input);
      return { schemaVersion: 1, source: { fingerprint: 'b'.repeat(64) }, model: { cubism: 3 }, motions: [], expressions: [], resources: [], warnings: [] };
    },
    githubCacheRoot: path.join(root, 'github-cache'),
    fetchImpl,
  });
  const opened = await service.openGitHub({ url: 'https://github.com/example/models/tree/main/live2d' });
  assert.deepEqual(opened.library.candidates.map((item) => item.relativePath), ['hero/hero.model3.json', 'other/other.model3.json']);
  await service.inspect({ libraryId: opened.library.libraryId, sourceId: opened.library.candidates[0].id, projectId: 'hero' });
  assert.equal(requests.some((url) => url.includes('/other/')), false);
  assert.equal(requests.filter((url) => url.includes('raw.githubusercontent.com')).length, 3);
  assert.equal(inspected[0].modelConfig, 'hero.model3.json');
  assert.equal(fs.existsSync(path.join(inspected[0].inputPath, 'other.model3.json')), false);
});

test('evicts the least recently used GitHub model cache before exceeding the total limit', () => {
  const root = temporaryDirectory();
  const repository = path.join(root, 'owner-repo');
  const older = path.join(repository, 'older');
  const newer = path.join(repository, 'newer');
  for (const [directory, size, age] of [[older, 700 * 1024 * 1024, 1000], [newer, 200 * 1024 * 1024, 2000]]) {
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, '.live2pet-source-ready'), 'ready');
    fs.writeFileSync(path.join(directory, 'model.bin'), '');
    fs.truncateSync(path.join(directory, 'model.bin'), size);
    const date = new Date(age);
    fs.utimesSync(path.join(directory, '.live2pet-source-ready'), date, date);
  }
  pruneGithubCache(root, 300 * 1024 * 1024, null, 1024 * 1024 * 1024);
  assert.equal(fs.existsSync(older), false);
  assert.equal(fs.existsSync(newer), true);
});
