const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { ZipReader, Uint8ArrayReader, Uint8ArrayWriter, TextReader, TextWriter, ZipWriter } = require('@zip.js/zip.js');
const { createProject, serializeProject } = require('../../../packages/project/src/index.cjs');
const { openPortableProject, savePortableProject } = require('../portable-project.cjs');

async function writeArchive(filePath, files) {
  const output = new Uint8ArrayWriter();
  const writer = new ZipWriter(output);
  for (const [entry, content] of files) await writer.add(entry, new TextReader(content));
  fs.writeFileSync(filePath, Buffer.from(await writer.close()));
}

function manifestFor(projectText, sourceEntries, source = { entry: 'source', type: 'directory' }) {
  const files = [{ path: 'project.l2p', size: Buffer.byteLength(projectText), sha256: crypto.createHash('sha256').update(projectText).digest('hex') }];
  for (const [entry, content] of sourceEntries) {
    files.push({ path: entry, size: Buffer.byteLength(content), sha256: crypto.createHash('sha256').update(content).digest('hex') });
  }
  return `${JSON.stringify({ format: 'live2pet-package', containerVersion: 1, project: 'project.l2p', source, files }, null, 2)}\n`;
}

test('portable project keeps its model source after the original folder is removed', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'live2pet-portable-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, 'original-model');
  fs.mkdirSync(path.join(source, 'textures'), { recursive: true });
  fs.writeFileSync(path.join(source, 'model.model3.json'), '{"Version":3}');
  fs.writeFileSync(path.join(source, 'textures', 'body.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  const project = createProject({
    projectId: 'portable-fixture',
    name: 'Portable fixture',
    source: { kind: 'standard-directory', name: 'original-model', path: source, modelConfig: 'model.model3.json', fingerprint: 'fixture' },
    targets: {},
  });
  const packagePath = path.join(root, 'Portable fixture.l2pack');
  await savePortableProject(packagePath, project);

  const archive = new ZipReader(new Uint8ArrayReader(Uint8Array.from(fs.readFileSync(packagePath))));
  const entries = await archive.getEntries();
  const manifestEntry = entries.find((entry) => entry.filename === 'manifest.json');
  const manifest = JSON.parse(await manifestEntry.getData(new TextWriter()));
  await archive.close();
  assert.equal(manifest.format, 'live2pet-package');
  assert.equal(manifest.containerVersion, 1);
  assert.deepEqual(entries.map((entry) => entry.filename).sort(), ['manifest.json', 'project.l2p', 'source/model.model3.json', 'source/textures/body.png']);

  fs.rmSync(source, { recursive: true });
  const opened = await openPortableProject(packagePath, path.join(root, 'workspace'));
  assert.equal(opened.schemaVersion, 3);
  assert.equal(opened.source.location.type, 'relative');
  assert.equal(fs.readFileSync(path.join(opened.source.path, 'model.model3.json'), 'utf8'), '{"Version":3}');
  assert.equal(fs.existsSync(source), false);
});

test('saving inside the source folder does not embed an older portable package', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'live2pet-portable-self-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, 'model');
  fs.mkdirSync(source);
  fs.writeFileSync(path.join(source, 'model.model3.json'), '{"Version":3}');
  const packagePath = path.join(source, 'model.l2pack');
  fs.writeFileSync(packagePath, 'old package');
  const project = createProject({
    projectId: 'portable-self-fixture',
    name: 'Portable self fixture',
    source: { kind: 'standard-directory', name: 'model', path: source, modelConfig: 'model.model3.json', fingerprint: 'fixture' },
    targets: {},
  });

  await savePortableProject(packagePath, project);

  const archive = new ZipReader(new Uint8ArrayReader(Uint8Array.from(fs.readFileSync(packagePath))));
  const entries = await archive.getEntries();
  await archive.close();
  assert.deepEqual(entries.map((entry) => entry.filename).sort(), ['manifest.json', 'project.l2p', 'source/model.model3.json']);
});

test('rejects a project whose source location disagrees with the manifest on every open', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'live2pet-portable-invalid-source-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const project = createProject({
    projectId: 'portable-invalid-source',
    name: 'Portable invalid source',
    source: { kind: 'standard-directory', name: 'model', fingerprint: 'fixture', modelConfig: 'model.json' },
    targets: {},
  });
  const projectText = serializeProject(project, { sourceLocation: { type: 'relative', path: 'source/not-packaged' } });
  const sourceEntries = [['source/model.json', '{}']];
  const packagePath = path.join(root, 'invalid.l2pack');
  await writeArchive(packagePath, [['manifest.json', manifestFor(projectText, sourceEntries)], ['project.l2p', projectText], ...sourceEntries]);
  const workspace = path.join(root, 'workspace');

  await assert.rejects(openPortableProject(packagePath, workspace), (error) => error.code === 'INVALID_PORTABLE_PROJECT');
  await assert.rejects(openPortableProject(packagePath, workspace), (error) => error.code === 'INVALID_PORTABLE_PROJECT');
  assert.equal(fs.existsSync(workspace) ? fs.readdirSync(workspace).length : 0, 0);
});

test('does not trust a ready cache after a packaged source file is changed', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'live2pet-portable-cache-integrity-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, 'model');
  fs.mkdirSync(source);
  fs.writeFileSync(path.join(source, 'model.json'), '{}');
  const project = createProject({
    projectId: 'portable-cache-integrity',
    name: 'Portable cache integrity',
    source: { kind: 'standard-directory', name: 'model', path: source, modelConfig: 'model.json', fingerprint: 'fixture' },
    targets: {},
  });
  const packagePath = path.join(root, 'valid.l2pack');
  const workspace = path.join(root, 'workspace');
  await savePortableProject(packagePath, project);
  await openPortableProject(packagePath, workspace);
  const archiveHash = crypto.createHash('sha256').update(fs.readFileSync(packagePath)).digest('hex');
  const cachedSource = path.join(workspace, archiveHash, 'source', 'model.json');
  fs.writeFileSync(cachedSource, '{"tampered":true}');

  await assert.rejects(openPortableProject(packagePath, workspace), (error) => error.code === 'INVALID_PORTABLE_PROJECT');
  await assert.rejects(openPortableProject(packagePath, workspace), (error) => error.code === 'INVALID_PORTABLE_PROJECT');
  assert.equal(fs.readFileSync(cachedSource, 'utf8'), '{"tampered":true}');
});

test('reopens a cached package with a deeply nested source inventory', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'live2pet-portable-cache-limit-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const project = createProject({
    projectId: 'portable-cache-limit',
    name: 'Portable cache limit',
    source: { kind: 'standard-directory', name: 'model', modelConfig: 'model-00000/part-00/part-01/part-02/part-03/part-04/part-05/part-06/part-07/part-08/part-09/file.json', fingerprint: 'fixture' },
    targets: {},
  });
  const sourceEntries = Array.from({ length: 1000 }, (_, index) => [`source/model-${String(index).padStart(5, '0')}/part-00/part-01/part-02/part-03/part-04/part-05/part-06/part-07/part-08/part-09/file.json`, '{}']);
  const projectText = serializeProject(project, { sourceLocation: { type: 'relative', path: 'source' } });
  const packagePath = path.join(root, 'cache-limit.l2pack');
  const workspace = path.join(root, 'workspace');
  await writeArchive(packagePath, [['manifest.json', manifestFor(projectText, sourceEntries)], ['project.l2p', projectText], ...sourceEntries]);

  const first = await openPortableProject(packagePath, workspace);
  const second = await openPortableProject(packagePath, workspace);
  assert.equal(first.projectId, 'portable-cache-limit');
  assert.equal(second.projectId, 'portable-cache-limit');
});

test('reopens edits saved from a portable working copy', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'live2pet-portable-edit-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, 'model');
  fs.mkdirSync(source);
  fs.writeFileSync(path.join(source, 'model.json'), '{}');
  const project = createProject({
    projectId: 'portable-edit',
    name: 'Before edit',
    source: { kind: 'standard-directory', name: 'model', path: source, modelConfig: 'model.json', fingerprint: 'fixture' },
    targets: {},
  });
  const packagePath = path.join(root, 'editable.l2pack');
  const workspace = path.join(root, 'workspace');
  await savePortableProject(packagePath, project);
  const opened = await openPortableProject(packagePath, workspace);
  await savePortableProject(packagePath, { ...opened, name: 'After edit' });
  const reopened = await openPortableProject(packagePath, workspace);
  assert.equal(reopened.name, 'After edit');
  assert.equal(fs.readFileSync(path.join(reopened.source.path, 'model.json'), 'utf8'), '{}');
});

test('concurrent opens publish one complete working copy and clean owned staging', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'live2pet-portable-concurrent-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, 'model');
  fs.mkdirSync(source);
  fs.writeFileSync(path.join(source, 'model.bin'), Buffer.alloc(1024 * 1024, 7));
  const project = createProject({
    projectId: 'portable-concurrent',
    name: 'Portable concurrent',
    source: { kind: 'standard-directory', name: 'model', path: source, modelConfig: 'model.bin', fingerprint: 'fixture' },
    targets: {},
  });
  const packagePath = path.join(root, 'concurrent.l2pack');
  const workspace = path.join(root, 'workspace');
  await savePortableProject(packagePath, project);
  const opened = await Promise.all(Array.from({ length: 6 }, () => openPortableProject(packagePath, workspace)));
  assert.equal(opened.length, 6);
  assert.ok(opened.every((value) => value.projectId === 'portable-concurrent'));
  const archiveHash = crypto.createHash('sha256').update(fs.readFileSync(packagePath)).digest('hex');
  assert.deepEqual(fs.readdirSync(workspace).sort(), [archiveHash]);
  assert.equal(fs.readFileSync(path.join(workspace, archiveHash, '.ready'), 'utf8').trim(), archiveHash);
});
