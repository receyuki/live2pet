const assert = require('node:assert/strict');
const test = require('node:test');
const UPNG = require('upng-js');
const { encodeAnimatedApng, buildClawdTheme, encodeAsset, decodeAsset } = require('../src/index.cjs');

function frames() {
  return [0, 1, 2].map(index => {
    const rgba = Buffer.alloc(16 * 12 * 4);
    for (let y = 2; y < 8; y++) for (let x = 1 + index; x < 5 + index; x++) {
      const p = (y * 16 + x) * 4;
      rgba[p] = 180; rgba[p + 1] = 20 + index * 40; rgba[p + 2] = 80; rgba[p + 3] = 128 + index * 40;
    }
    return { id: `f${index}`, width: 16, height: 12, rgba };
  });
}

test('UPNG APNG preserves complete RGBA pixels, durations, plays and valid chunk CRCs', async () => {
  const input = frames();
  for (const loop of [0, 1]) {
    const asset = await encodeAnimatedApng({ frames: input, width: 16, height: 12, delay: [17, 33, 50], loop });
    const bytes = asset.buffer;
    const decoded = UPNG.decode(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    assert.equal(decoded.width, 16);
    assert.equal(decoded.height, 12);
    assert.equal(decoded.tabs.acTL.num_plays, loop);
    assert.deepEqual(decoded.frames.map(frame => frame.delay), [17, 33, 50]);
    const rgba = UPNG.toRGBA8(decoded);
    assert.equal(rgba.length, 3);
    rgba.forEach((data, index) => assert.deepEqual(Buffer.from(data), input[index].rgba));
    for (let offset = 8; offset < bytes.length;) {
      const length = bytes.readUInt32BE(offset);
      assert.equal(bytes.readUInt32BE(offset + 8 + length), UPNG.crc.crc(bytes, offset + 4, length + 4) >>> 0);
      offset += length + 12;
    }
    assert.equal(decodeAsset(encodeAsset({ ...asset, bytes })).format, 'apng');
  }
});

test('APNG cancellation terminates the worker and does not produce an asset', async () => {
  const controller = new AbortController();
  const job = encodeAnimatedApng({ frames: frames(), width: 16, height: 12 }, { signal: controller.signal });
  setImmediate(() => controller.abort());
  await assert.rejects(job, { code: 'BUILD_CANCELLED' });
});

test('Clawd builds APNG assets with correct manifest, preview and encoder provenance', async () => {
  const result = await buildClawdTheme({ mapping: { states: { idle: 'motion:idle', thinking: 'motion:idle', working: 'motion:idle', sleeping: 'motion:idle' } }, framesByMotion: { idle: { frames: frames(), fps: 20 } }, metadata: { id: 'apng-pet', name: 'APNG Pet' } }, { format: 'apng', package: true });
  assert.equal(result.validation.ok, true);
  assert.equal(result.encoding.format, 'apng');
  assert.ok(result.assets.every(asset => asset.file.endsWith('.apng') && asset.format === 'apng'));
  assert.equal(result.preview.assets[0].format, 'apng');
  assert.equal(result.provenance.encoder.name, 'upng-js');
  assert.ok(result.package.files.some(file => file.endsWith('.apng')));
});
