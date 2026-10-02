const { parentPort, workerData } = require('node:worker_threads');
const UPNG = require('upng-js');

// UPNG owns PNG compression, frame disposal, blending, and chunk generation.
// Its encoder always emits infinite looping; only replace acTL.num_plays and
// recalculate that chunk's CRC with the library's own implementation.
const { rgba, width, height, frameCount, delays, loop } = workerData;
const frameBytes = width * height * 4;
const frames = Array.from({ length: frameCount }, (_, index) => rgba.slice(index * frameBytes, (index + 1) * frameBytes));
const output = new Uint8Array(UPNG.encode(frames, width, height, 0, delays));
const view = new DataView(output.buffer, output.byteOffset, output.byteLength);
if (loop !== 0) {
  for (let offset = 8; offset + 12 <= output.byteLength;) {
    const length = view.getUint32(offset);
    if (offset + length + 12 > output.byteLength) throw new Error('UPNG returned a truncated PNG chunk.');
    if (output[offset + 4] === 97 && output[offset + 5] === 99 && output[offset + 6] === 84 && output[offset + 7] === 76) {
      view.setUint32(offset + 12, loop);
      view.setUint32(offset + 16, UPNG.crc.crc(output, offset + 4, 12));
      break;
    }
    offset += length + 12;
  }
}
parentPort.postMessage(output, [output.buffer]);
