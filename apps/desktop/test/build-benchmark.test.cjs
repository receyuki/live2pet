const assert = require('node:assert/strict');
const test = require('node:test');
const vm = require('node:vm');
const { summarizeProgress, readArtifactChunk, inspectPackage } = require('../scripts/benchmark-project-build.cjs');

test('benchmark inspects a Node Buffer ZIP without treating its view as a split archive', async () => {
  const { ZipWriter, Uint8ArrayWriter, Uint8ArrayReader } = require('@zip.js/zip.js');
  const sharp = require('sharp');
  const writer = new ZipWriter(new Uint8ArrayWriter());
  const webp = await sharp({ create: { width: 2, height: 2, channels: 4, background: '#ff000080' } }).webp().toBuffer();
  await writer.add('fixture.webp', new Uint8ArrayReader(webp));
  const archive = Buffer.from(await writer.close());
  const [image] = await inspectPackage(archive);
  assert.equal(image.width, 2);
  assert.equal(image.hasAlpha, true);
  assert.equal(image.samples[0].visiblePixels, 4);
});

test('benchmark downloads binary chunks through the public preload argument contract', async () => {
  const bytes = Uint8Array.from({ length: 70000 }, (_, index) => index % 256);
  const read = vm.runInNewContext(`(${readArtifactChunk.toString()})`, {
    btoa,
    window: { live2pet: { getBuildArtifact: async (artifactId, offset) => {
      assert.equal(artifactId, 'artifact-1');
      assert.equal(offset, 4096);
      return { ok: true, result: { bytes, nextOffset: 4096 + bytes.length } };
    } } },
  });
  const result = await read({ artifactId: 'artifact-1', offset: 4096 });
  assert.equal(result.nextOffset, 74096);
  assert.deepEqual(Buffer.from(result.base64, 'base64'), Buffer.from(bytes));
});

test('benchmark reports overlapping intervals separately and omits private Motion names', () => {
  const summary = summarizeProgress([
    { target: 'clawd', stage: 'encode', status: 'started', at: 100 },
    { target: 'clawd', stage: 'encode', status: 'motion-started', motionId: 'private-motion', at: 110 },
    { target: 'clawd', stage: 'encode', status: 'motion-completed', motionId: 'private-motion', cache: 'miss', at: 150 },
    { target: 'clawd', stage: 'encode', status: 'completed', at: 160 },
  ]);
  assert.deepEqual(summary.stageIntervals.map(interval => [interval.scope, interval.startMs, interval.endMs]), [
    ['motion', 10, 50], ['target', 0, 60],
  ]);
  assert.equal(summary.encodedAnimations, 1);
  assert.equal(JSON.stringify(summary).includes('private-motion'), false);
});
