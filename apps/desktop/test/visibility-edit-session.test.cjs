const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { parseVisibilityEditArgument, createVisibilityEditSession } = require('../visibility-edit-session.cjs');

function fixture(t, overrides = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'live2pet-visibility-test-'));
  fs.chmodSync(root, 0o700);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'source'));
  fs.writeFileSync(path.join(root, 'source/model.model3.json'), '{}');
  const request = {
    protocol: 'live2pet-visibility-edit', version: 1,
    sessionId: '1'.repeat(32),
    model: { id: '2'.repeat(32), revision: '3'.repeat(64), name: 'Example', format: 'live2d', generation: 3, entry: 'source/model.model3.json' },
    visualSettings: { hiddenElementIds: ['PartBG'] }, runtime: null,
    ...overrides,
  };
  const requestPath = path.join(root, 'request.json');
  fs.writeFileSync(requestPath, JSON.stringify(request), { mode: 0o600 });
  return { root, requestPath, request };
}

test('launch arguments require one absolute request.json path', () => {
  assert.equal(parseVisibilityEditArgument(['app']), null);
  assert.equal(parseVisibilityEditArgument(['app', '--live2pet-visibility-edit', '/private/tmp/session/request.json']), '/private/tmp/session/request.json');
  for (const args of [
    ['--live2pet-visibility-edit'], ['--live2pet-visibility-edit', 'request.json'],
    ['--live2pet-visibility-edit', '/private/tmp/other.json'],
    ['--live2pet-visibility-edit', '/private/tmp/request.json', '--live2pet-visibility-edit', '/private/tmp/request.json'],
  ]) assert.throws(() => parseVisibilityEditArgument(args), { code: 'INVALID_VISIBILITY_EDIT_ARGUMENT' });
});

test('apply preserves identity, validates loaded element IDs, and atomically publishes one result', t => {
  const { root, requestPath, request } = fixture(t);
  const session = createVisibilityEditSession(requestPath);
  assert.equal(session.modelConfig, 'model.model3.json');
  assert.equal(session.sourceRoot, path.join(fs.realpathSync(root), 'source'));
  assert.equal(session.runtimePath, null);
  assert.equal(session.completed, false);
  assert.throws(() => session.finish('applied', { visualSettings: { hiddenElementIds: ['missing'] }, elements: [{ id: 'PartBG' }] }), { code: 'INVALID_VISIBILITY_EDIT_SETTINGS' });
  assert.equal(fs.existsSync(path.join(root, 'result.json')), false);
  const result = session.finish('applied', { visualSettings: { hiddenElementIds: ['PartBG', 'slot:background'] }, elements: [{ id: 'PartBG' }, { id: 'slot:background' }] });
  assert.deepEqual(result, { protocol: request.protocol, version: 1, sessionId: request.sessionId, modelId: request.model.id, modelRevision: request.model.revision, status: 'applied', visualSettings: { hiddenElementIds: ['PartBG', 'slot:background'] } });
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, 'result.json'))), result);
  assert.equal(fs.statSync(path.join(root, 'result.json')).mode & 0o777, 0o600);
  assert.equal(session.completed, true);
  assert.throws(() => session.finish('cancelled'), { code: 'VISIBILITY_EDIT_COMPLETED' });
  assert.equal(fs.readFileSync(path.join(root, 'source/model.model3.json'), 'utf8'), '{}');
});

test('cancel and startup error never publish settings or unsafe error details', t => {
  const cancelled = fixture(t);
  assert.equal(createVisibilityEditSession(cancelled.requestPath).finish('cancelled').visualSettings, undefined);
  const failed = fixture(t);
  const result = createVisibilityEditSession(failed.requestPath).finish('error', { error: { code: 'RUNTIME_REQUIRED', message: 'failed /Users/private/core.js', stack: 'secret' } });
  assert.equal(result.error.code, 'RUNTIME_REQUIRED');
  assert.doesNotMatch(JSON.stringify(result), /Users|core\.js|secret/);
  assert.equal(result.visualSettings, undefined);
});

test('preflight validates loaded settings without publishing or completing the session', t => {
  const { root, requestPath } = fixture(t);
  const session = createVisibilityEditSession(requestPath);
  const elements = [{ id: 'PartBG' }];
  assert.throws(() => session.validateSettings({ hiddenElementIds: ['unknown'] }, elements), { code: 'INVALID_VISIBILITY_EDIT_SETTINGS' });
  assert.equal(session.completed, false);
  assert.equal(fs.existsSync(path.join(root, 'result.json')), false);
  const input = { hiddenElementIds: ['PartBG'] };
  const settings = session.validateSettings(input, elements);
  assert.deepEqual(settings, input);
  assert.notEqual(settings.hiddenElementIds, input.hiddenElementIds);
  assert.equal(session.finish('applied', { visualSettings: settings, elements }).status, 'applied');
});

test('only fixed matching trusted runtime is accepted', t => {
  const { root, requestPath } = fixture(t, { runtime: { generation: 3, path: 'runtime/core.js' } });
  fs.mkdirSync(path.join(root, 'runtime'));
  fs.writeFileSync(path.join(root, 'runtime/core.js'), 'trusted runtime');
  assert.equal(createVisibilityEditSession(requestPath).runtimePath, path.join(fs.realpathSync(root), 'runtime/core.js'));
  const wrong = fixture(t, { runtime: { generation: 2, path: 'runtime/core.js' } });
  assert.throws(() => createVisibilityEditSession(wrong.requestPath), { code: 'INVALID_VISIBILITY_EDIT_REQUEST' });
});

test('supported Spine lines preserve optional skin without a Cubism runtime', t => {
  for (const runtimeLine of ['2.1', '3.5', '3.6', '3.7', '3.8', '4.0', '4.1', '4.2', '4.3']) {
    const entry = runtimeLine === '3.5' ? 'character.json' : 'character.skel';
    const { root, requestPath } = fixture(t, { model: { id: '2'.repeat(32), revision: '3'.repeat(64), name: 'Spine', format: 'spine', runtimeLine, initialSkin: 'default', entry: `source/${entry}` }, runtime: null });
    fs.writeFileSync(path.join(root, 'source', entry), 'placeholder');
    const session = createVisibilityEditSession(requestPath);
    assert.equal(session.request.model.initialSkin, 'default');
    assert.equal(session.modelConfig, entry);
  }
});

test('rejects malformed, oversized, ambiguous and escaping requests', t => {
  for (const overrides of [
    { sessionId: 'A'.repeat(32) }, { version: 2 }, { protocol: 'other' },
    { visualSettings: { hiddenElementIds: ['PartBG', 'PartBG'] } },
    { visualSettings: { hiddenElementIds: ['bad\nID'] } },
    { visualSettings: { hiddenElementIds: ['x'.repeat(257)] } },
    { visualSettings: { hiddenElementIds: [], soloElementId: 'PartBG' } },
    { model: { id: '2'.repeat(32), revision: '3'.repeat(64), format: 'live2d', generation: 3, entry: 'source/../request.json' } },
    { runtime: { generation: 3, path: 'source/core.js' } },
  ]) {
    const { requestPath } = fixture(t, overrides);
    assert.throws(() => createVisibilityEditSession(requestPath), { code: 'INVALID_VISIBILITY_EDIT_REQUEST' });
  }
  const oversized = fixture(t);
  fs.writeFileSync(oversized.requestPath, ' '.repeat(65537));
  assert.throws(() => createVisibilityEditSession(oversized.requestPath), { code: 'INVALID_VISIBILITY_EDIT_REQUEST' });
});

test('result bounds and temporary Solo prevent applying without publishing a file', t => {
  const { root, requestPath } = fixture(t);
  const session = createVisibilityEditSession(requestPath);
  assert.throws(() => session.finish('applied', { visualSettings: { hiddenElementIds: [], soloElementId: 'PartBG' }, elements: [{ id: 'PartBG' }] }), { code: 'INVALID_VISIBILITY_EDIT_SETTINGS' });
  const ids = Array.from({ length: 300 }, (_, index) => `${String(index).padStart(4, '0')}${'x'.repeat(252)}`);
  assert.throws(() => session.validateSettings({ hiddenElementIds: ids }, ids.map(id => ({ id }))), { code: 'INVALID_VISIBILITY_EDIT_RESULT' });
  assert.throws(() => session.finish('applied', { visualSettings: { hiddenElementIds: ids }, elements: ids.map(id => ({ id })) }), { code: 'INVALID_VISIBILITY_EDIT_RESULT' });
  assert.equal(fs.existsSync(path.join(root, 'result.json')), false);
  assert.equal(session.completed, false);
});

test('result identity is captured from the validated request and cannot be replaced by renderer state', t => {
  const { requestPath } = fixture(t);
  const session = createVisibilityEditSession(requestPath);
  session.request.sessionId = '9'.repeat(32);
  session.request.model.id = '8'.repeat(32);
  session.request.model.revision = '7'.repeat(64);
  const result = session.finish('cancelled');
  assert.equal(result.sessionId, '1'.repeat(32));
  assert.equal(result.modelId, '2'.repeat(32));
  assert.equal(result.modelRevision, '3'.repeat(64));
});

test('private request permissions are required on POSIX', { skip: process.platform === 'win32' }, t => {
  const { root, requestPath } = fixture(t);
  fs.chmodSync(requestPath, 0o644);
  assert.throws(() => createVisibilityEditSession(requestPath), { code: 'INVALID_VISIBILITY_EDIT_REQUEST' });
  fs.chmodSync(requestPath, 0o600);
  fs.chmodSync(root, 0o755);
  assert.throws(() => createVisibilityEditSession(requestPath), { code: 'INVALID_VISIBILITY_EDIT_REQUEST' });
});

test('rejects symlinks anywhere in resources and does not overwrite an existing result', t => {
  const symlink = fixture(t);
  fs.symlinkSync(symlink.requestPath, path.join(symlink.root, 'source/linked.json'));
  assert.throws(() => createVisibilityEditSession(symlink.requestPath), { code: 'INVALID_VISIBILITY_EDIT_REQUEST' });
  const existing = fixture(t);
  fs.writeFileSync(path.join(existing.root, 'result.json'), 'original');
  assert.throws(() => createVisibilityEditSession(existing.requestPath), { code: 'VISIBILITY_EDIT_COMPLETED' });
  assert.equal(fs.readFileSync(path.join(existing.root, 'result.json'), 'utf8'), 'original');
  const raced = fixture(t);
  const session = createVisibilityEditSession(raced.requestPath);
  fs.writeFileSync(path.join(raced.root, 'result.json'), 'external');
  assert.throws(() => session.finish('cancelled'), { code: 'VISIBILITY_EDIT_COMPLETED' });
  assert.equal(fs.readFileSync(path.join(raced.root, 'result.json'), 'utf8'), 'external');
  const dangling = fixture(t);
  fs.symlinkSync(path.join(dangling.root, 'nonexistent'), path.join(dangling.root, 'result.json'));
  assert.throws(() => createVisibilityEditSession(dangling.requestPath), { code: 'VISIBILITY_EDIT_COMPLETED' });
});
