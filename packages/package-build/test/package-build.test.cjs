const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');

const {
  PackageBuildError,
  buildCodexPet,
  createCodexPetZip,
  encodeAnimatedWebp,
} = require('../src/index.cjs');

function mapping() {
  return {
    idle: 'motion:idle',
    'running-right': 'motion:running-right',
    'running-left': 'motion:running-left',
    waving: 'motion:waving',
    jumping: 'motion:jumping',
    failed: 'motion:failed',
    waiting: 'motion:waiting',
    running: 'motion:running',
    review: 'motion:review',
  };
}

function candidatesByRow() {
  const counts = { idle: 6, 'running-right': 8, 'running-left': 8, waving: 4, jumping: 5, failed: 8, waiting: 6, running: 6, review: 6 };
  return Object.fromEntries(Object.entries(counts).map(([row, count]) => [row, Array.from({ length: count }, (_, index) => {
    const rgba = new Uint8Array(192 * 208 * 4);
    rgba.fill((row.length * 13 + index) % 255);
    rgba[3] = 255;
    return { id: `${row}-${index}`, index, time: index / 10, visualChange: index ? 0.2 : 0, width: 192, height: 208, rgba };
  })]));
}

test('builds a deterministic Codex atlas handoff with progress stages', async () => {
  const events = [];
  const first = await buildCodexPet({ mapping: { mappings: mapping() }, candidatesByRow: candidatesByRow() }, { onProgress: (event) => events.push(event) });
  const second = await buildCodexPet({ mapping: { mappings: mapping() }, candidatesByRow: candidatesByRow() });
  assert.deepEqual(events.map(({ stage, status }) => `${stage}:${status}`), ['select:started', 'select:completed', 'layout:started', 'layout:completed', 'compose:started', 'compose:completed', 'manifest:started', 'manifest:completed']);
  assert.equal(first.target, 'codex-pet');
  assert.deepEqual(first.manifest.atlas, { width: 1536, height: 1872, columns: 8, rows: 9, cellWidth: 192, cellHeight: 208 });
  assert.deepEqual(first.manifest.rows.map((row) => row.frameCount), [6, 8, 8, 4, 5, 8, 6, 6, 6]);
  assert.equal(first.atlas.occupiedCells, 57);
  assert.equal(first.atlas.transparentCells, 15);
  assert.equal(first.encoding.status, 'pending');
  assert.deepEqual(first.manifest, second.manifest);
  assert.equal(crypto.createHash('sha256').update(first.atlas.rgba).digest('hex'), crypto.createHash('sha256').update(second.atlas.rgba).digest('hex'));
});

test('cancels before work and blocks missing captures', async () => {
  await assert.rejects(
    () => buildCodexPet({ mapping: { mappings: mapping() }, candidatesByRow: candidatesByRow() }, { signal: { aborted: true } }),
    (error) => error instanceof PackageBuildError && error.code === 'BUILD_CANCELLED',
  );
  const candidates = candidatesByRow();
  delete candidates.idle[0].rgba;
  await assert.rejects(
    () => buildCodexPet({ mapping: { mappings: mapping() }, candidatesByRow: candidates }),
    (error) => error instanceof PackageBuildError && error.code === 'MISSING_FRAME_CAPTURE',
  );
});

test('encodes stacked RGBA frames through the injected WebP encoder contract', async () => {
  const calls = [];
  const fakeSharp = (input, options) => {
    calls.push({ input: Buffer.from(input), options });
    return {
      webp(webpOptions) {
        calls.push({ webpOptions });
        return { toBuffer: async () => ({ data: Buffer.from('RIFF-webp-fixture'), info: { pages: 2 } }) };
      },
    };
  };
  const frames = [0, 1].map((index) => ({ width: 2, height: 1, rgba: Uint8Array.from([index, 0, 0, 255, index, 1, 0, 255]) }));
  const encoded = await encodeAnimatedWebp({ frames, width: 2, height: 1, delay: [120, 180], loop: 0, quality: 82, alphaQuality: 97, lossless: true }, { sharpFactory: fakeSharp });
  assert.equal(encoded.format, 'webp');
  assert.equal(encoded.frameCount, 2);
  assert.deepEqual(encoded.delays, [120, 180]);
  assert.equal(encoded.buffer.toString(), 'RIFF-webp-fixture');
  assert.deepEqual(calls[0].options, { animated: true, raw: { width: 2, height: 2, channels: 4, pageHeight: 1 } });
  assert.deepEqual(calls[1].webpOptions, { quality: 82, alphaQuality: 97, lossless: true, loop: 0, delay: [120, 180] });
  assert.equal(calls[0].input.length, 16);
});

test('can encode and package a Codex atlas when explicitly requested', async () => {
  const events = [];
  const fakeSharp = (input, options) => ({
    webp() {
      assert.equal(options.animated, false);
      assert.deepEqual(options.raw, { width: 1536, height: 1872, channels: 4, pageHeight: 1872 });
      assert.equal(input.length, 1536 * 1872 * 4);
      return { toBuffer: async () => ({ data: Buffer.from('RIFF-codex-fixture'), info: { width: 1536, height: 1872 } }) };
    },
  });
  const result = await buildCodexPet({ mapping: { mappings: mapping() }, candidatesByRow: candidatesByRow() }, { package: true, sharpFactory: fakeSharp, onProgress: (event) => events.push(event) });
  assert.equal(result.encoding.status, 'completed');
  assert.equal(result.package.files.join(','), 'pet.json,spritesheet.webp');
  assert.deepEqual(events.map(({ stage, status }) => `${stage}:${status}`), ['select:started', 'select:completed', 'layout:started', 'layout:completed', 'compose:started', 'compose:completed', 'encode:started', 'encode:completed', 'manifest:started', 'manifest:completed', 'package:started', 'package:completed']);
  assert.deepEqual(result.manifest.assets.spritesheet, { path: 'spritesheet.webp', format: 'webp', width: 1536, height: 1872, frameCount: 1 });
});

test('creates a two-file ZIP that can be read back with zip.js', async () => {
  const zip = require('@zip.js/zip.js');
  const artifact = await createCodexPetZip({ manifest: { schemaVersion: 1, target: 'codex-pet' }, spritesheet: Uint8Array.from([0x52, 0x49, 0x46, 0x46]) });
  assert.equal(artifact.format, 'zip');
  const reader = new zip.ZipReader(new zip.Uint8ArrayReader(artifact.buffer));
  const entries = await reader.getEntries();
  assert.deepEqual(entries.map((entry) => entry.filename), ['pet.json', 'spritesheet.webp']);
  assert.equal(await entries[0].getData(new zip.TextWriter()), '{\n  "schemaVersion": 1,\n  "target": "codex-pet"\n}\n');
  assert.deepEqual(await entries[1].getData(new zip.Uint8ArrayWriter()), Uint8Array.from([0x52, 0x49, 0x46, 0x46]));
  await reader.close();
});

test('reports unavailable or malformed WebP encoder inputs with typed errors', async () => {
  await assert.rejects(
    () => encodeAnimatedWebp({ frames: [{ width: 2, height: 1, rgba: new Uint8Array(8) }], width: 2, height: 1 }, { sharpFactory: () => { throw new Error('missing sharp'); } }),
    (error) => error instanceof PackageBuildError && error.code === 'WEBP_ENCODER_FAILED',
  );
  await assert.rejects(
    () => encodeAnimatedWebp({ frames: [{ width: 2, height: 1, rgba: new Uint8Array(8) }], width: 2, height: 1 }, { sharpFactory: null }),
    (error) => error instanceof PackageBuildError && error.code === 'WEBP_ENCODER_UNAVAILABLE',
  );
  await assert.rejects(
    () => encodeAnimatedWebp({ frames: [], width: 2, height: 1 }, { sharpFactory: () => {} }),
    (error) => error instanceof PackageBuildError && error.code === 'INVALID_WEBP_INPUT',
  );
});
