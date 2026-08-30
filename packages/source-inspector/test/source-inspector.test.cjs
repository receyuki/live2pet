const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const test = require('node:test');

const { SourceInspectionError, inspectSourcePackage } = require('../src/index.cjs');

function temporaryDirectory() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'live2pet-inspector-'));
}

function writeFixture(root, relativePath, content) {
  const target = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
  return target;
}

function modernFixture() {
  const root = temporaryDirectory();
  writeFixture(root, 'hero/hero.model3.json', JSON.stringify({
    Version: 3,
    FileReferences: {
      Moc: 'hero.moc3',
      Textures: ['hero.2048/hero.2048.00.png'],
      Motions: {
        Base: [{ File: 'motions/idle.motion3.json', Name: 'Idle' }],
      },
      Expressions: [{ File: 'expressions/smile.exp3.json', Name: 'Smile' }],
    },
  }));
  writeFixture(root, 'hero/hero.moc3', Buffer.from('moc3-fixture'));
  writeFixture(root, 'hero/hero.2048/hero.2048.00.png', Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  writeFixture(root, 'hero/motions/idle.motion3.json', JSON.stringify({ Meta: { Duration: 1.25 } }));
  writeFixture(root, 'hero/expressions/smile.exp3.json', JSON.stringify({ Parameters: [] }));
  return { root, model: path.join(root, 'hero/hero.model3.json') };
}

function legacyFixture() {
  const root = temporaryDirectory();
  writeFixture(root, 'model.json', JSON.stringify({
    model: 'hero.moc',
    textures: ['hero.png'],
    motions: { idle: [{ file: 'idle.mtn' }] },
    expressions: [{ name: 'smile', file: 'smile.exp.json' }],
  }));
  writeFixture(root, 'hero.moc', Buffer.from('moc-fixture'));
  writeFixture(root, 'hero.png', Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  writeFixture(root, 'idle.mtn', '$fps = 20\nPARAM_ANGLE_X = 0, 1, 2\n');
  writeFixture(root, 'smile.exp.json', JSON.stringify({ params: [] }));
  return { root, model: path.join(root, 'model.json') };
}

function pckFixture({ flags = 0, overlap = false, collision = false, extraMotion = false } = {}) {
  const root = temporaryDirectory();
  const model = JSON.stringify({
    model: 'hero.moc',
    textures: ['hero.png'],
    motions: { idle: [{ file: 'idle.mtn' }] },
    expressions: [{ name: 'smile', file: 'smile.exp.json' }],
    ...(collision ? { physics: 'hero.moc' } : {}),
  });
  const entries = [
    Buffer.from(model),
    Buffer.from('moc-fixture'),
    ...(collision ? [Buffer.from('physics-fixture')] : []),
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from('# Live2D motion\n$fps=20\nPARAM=0,1,2\n'),
    ...(extraMotion ? [Buffer.from('# Live2D extra motion\n$fps=20\nPARAM=0,1\n')] : []),
    Buffer.from(JSON.stringify({ params: [] })),
  ];
  const recordSize = 25;
  const headerSize = 12 + entries.length * recordSize;
  const table = Buffer.alloc(headerSize);
  table.write('PCK\0', 0, 'binary');
  table.writeFloatLE(1.0, 4);
  table.writeUInt32LE(entries.length, 8);
  let offset = headerSize;
  const records = [];
  for (let index = 0; index < entries.length; index += 1) {
    const data = entries[index];
    const actualOffset = overlap && index === 1 ? headerSize : offset;
    const base = 12 + index * recordSize;
    table.writeUInt8(index === 0 ? flags : 0, base + 8);
    table.writeUInt32LE(actualOffset, base + 9);
    table.writeUInt32LE(data.length, base + 13);
    table.writeUInt32LE(data.length, base + 17);
    records.push({ actualOffset, data });
    offset += data.length;
  }
  const payload = Buffer.alloc(offset - headerSize);
  for (const record of records) record.data.copy(payload, record.actualOffset - headerSize);
  const pck = path.join(root, 'hero.pck');
  fs.writeFileSync(pck, Buffer.concat([table, payload]));
  return { root, pck };
}

test('inspects a modern Cubism Source Package into a normalized manifest', () => {
  const fixture = modernFixture();
  const manifest = inspectSourcePackage(fixture.root);

  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.source.kind, 'standard-directory');
  assert.equal(manifest.model.cubism, 3);
  assert.equal(manifest.motions.length, 1);
  assert.deepEqual(manifest.motions[0], {
    id: 'Base:0',
    group: 'Base',
    index: 0,
    name: 'Idle',
    sourceFile: 'hero/motions/idle.motion3.json',
    duration: 1.25,
  });
  assert.equal(manifest.expressions[0].name, 'Smile');
  assert.equal(manifest.warnings.length, 0);
  assert.match(manifest.source.fingerprint, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(manifest).includes(fixture.root), false);
});

test('inspects a Cubism 2 Source Package and derives motion duration', () => {
  const fixture = legacyFixture();
  const manifest = inspectSourcePackage(fixture.root);

  assert.equal(manifest.source.kind, 'standard-directory');
  assert.equal(manifest.model.cubism, 2);
  assert.equal(manifest.motions[0].id, 'idle:0');
  assert.equal(manifest.motions[0].duration, 0.1);
  assert.equal(manifest.expressions[0].sourceFile, 'smile.exp.json');
});

test('reports missing referenced resources without hiding the rest of the manifest', () => {
  const fixture = modernFixture();
  const modelPath = path.join(fixture.root, 'hero/hero.model3.json');
  const model = JSON.parse(fs.readFileSync(modelPath, 'utf8'));
  model.FileReferences.Textures.push('hero.2048/missing.png');
  model.FileReferences.Motions.Base.push({ File: 'motions/missing.motion3.json' });
  model.FileReferences.Physics = 'physics/missing.physics3.json';
  fs.writeFileSync(modelPath, JSON.stringify(model));

  const manifest = inspectSourcePackage(fixture.root);
  const missing = manifest.warnings.filter((warning) => warning.code === 'MISSING_RESOURCE');
  assert.equal(missing.length, 3);
  assert.equal(manifest.motions.length, 2);
});

test('inspects the supported uncompressed and unencrypted Destiny Child PCK layout', () => {
  const fixture = pckFixture();
  const manifest = inspectSourcePackage(fixture.pck);

  assert.equal(manifest.source.kind, 'destiny-child-pck');
  assert.equal(manifest.source.entryCount, 5);
  assert.equal(manifest.model.cubism, 2);
  assert.equal(manifest.motions[0].name, 'idle');
  assert.equal(manifest.expressions[0].name, 'smile');
  assert.equal(manifest.warnings.length, 0);
});

test('rejects compressed or overlapping PCK entries with typed errors', () => {
  const compressed = pckFixture({ flags: 1 });
  assert.throws(
    () => inspectSourcePackage(compressed.pck),
    (error) => error instanceof SourceInspectionError && error.code === 'UNSUPPORTED_PCK_FLAGS',
  );

  const overlapping = pckFixture({ overlap: true });
  assert.throws(
    () => inspectSourcePackage(overlapping.pck),
    (error) => error instanceof SourceInspectionError && error.code === 'OVERLAPPING_PCK_ENTRIES',
  );

  const collision = pckFixture({ collision: true });
  assert.throws(
    () => inspectSourcePackage(collision.pck),
    (error) => error instanceof SourceInspectionError && error.code === 'RESOURCE_COLLISION',
  );

  const ambiguous = pckFixture({ extraMotion: true });
  assert.throws(
    () => inspectSourcePackage(ambiguous.pck),
    (error) => error instanceof SourceInspectionError && error.code === 'AMBIGUOUS_PCK_RESOURCES',
  );
});

test('CLI emits a stable JSON envelope without echoing the absolute input path', () => {
  const fixture = modernFixture();
  const cli = path.join(__dirname, '..', 'bin', 'live2pet-inspect.cjs');
  const output = execFileSync(process.execPath, [cli, '--input', fixture.root], { encoding: 'utf8' });
  const response = JSON.parse(output);

  assert.equal(response.protocolVersion, 1);
  assert.equal(response.operation, 'inspect');
  assert.equal(response.ok, true);
  assert.match(response.operationId, /^[0-9a-f-]{36}$/);
  assert.deepEqual(response.progress, [{ stage: 'inspect', status: 'completed' }]);
  assert.deepEqual(response.warnings, response.result.warnings);
  assert.equal(response.result.source.kind, 'standard-directory');
  assert.equal(output.includes(fixture.root), false);
});

test('CLI returns typed JSON errors and a non-zero exit code', () => {
  const fixture = pckFixture({ flags: 1 });
  const cli = path.join(__dirname, '..', 'bin', 'live2pet-inspect.cjs');
  let error;
  try {
    execFileSync(process.execPath, [cli, '--input', fixture.pck], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (caught) {
    error = caught;
  }

  assert.ok(error);
  const response = JSON.parse(error.stdout);
  assert.equal(response.protocolVersion, 1);
  assert.match(response.operationId, /^[0-9a-f-]{36}$/);
  assert.equal(response.ok, false);
  assert.deepEqual(response.progress, [{ stage: 'inspect', status: 'failed' }]);
  assert.equal(response.error.code, 'UNSUPPORTED_PCK_FLAGS');
});

test('fingerprints change when a source resource changes', () => {
  const fixture = modernFixture();
  const before = inspectSourcePackage(fixture.root).source.fingerprint;
  writeFixture(fixture.root, 'hero/motions/idle.motion3.json', JSON.stringify({ Meta: { Duration: 1.5 } }));
  const after = inspectSourcePackage(fixture.root).source.fingerprint;
  assert.notEqual(after, before);
  assert.equal(crypto.createHash('sha256').update(after).digest('hex').length, 64);
});
