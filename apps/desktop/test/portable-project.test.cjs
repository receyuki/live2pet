const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { ZipReader, Uint8ArrayReader, TextWriter } = require('@zip.js/zip.js');
const { createProject } = require('../../../packages/project/src/index.cjs');
const { openPortableProject, savePortableProject } = require('../portable-project.cjs');

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
