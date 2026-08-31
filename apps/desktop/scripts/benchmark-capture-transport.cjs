const { performance } = require('node:perf_hooks');
const { deflateSync } = require('node:zlib');

const { CAPTURE_CHUNK_MAX_BYTES, createCaptureChunkPlan } = require('../../mapper/clawd-capture-plan.js');

function option(name, fallback, minimum, maximum) {
  const index = process.argv.indexOf(`--${name}`);
  if (index < 0) return fallback;
  const value = Number(process.argv[index + 1]);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new Error(`--${name} must be an integer between ${minimum} and ${maximum}.`);
  return value;
}

function createFrames(width, height, frameCount) {
  const frameBytes = width * height * 4;
  return Array.from({ length: frameCount }, (_, frameIndex) => {
    const frame = Buffer.allocUnsafe(frameBytes);
    for (let offset = 0; offset < frame.length; offset += 4) {
      const pixel = offset / 4;
      frame[offset] = (pixel + frameIndex * 7) & 0xff;
      frame[offset + 1] = ((pixel >>> 3) + frameIndex * 11) & 0xff;
      frame[offset + 2] = ((pixel >>> 7) + frameIndex * 13) & 0xff;
      frame[offset + 3] = pixel % 19 === 0 ? 230 : 0;
    }
    return frame;
  });
}

function elapsed(operation) {
  const started = performance.now();
  const result = operation();
  return { result, milliseconds: performance.now() - started };
}

function run() {
  const width = option('width', 768, 1, 4096);
  const height = option('height', 768, 1, 4096);
  const frameCount = option('frames', 29, 1, 4096);
  const frames = createFrames(width, height, frameCount);
  const legacy = elapsed(() => frames.map((frame) => deflateSync(frame)));
  const chunkPlan = createCaptureChunkPlan(width, height, frameCount);
  const stacked = elapsed(() => chunkPlan.map((chunk) => deflateSync(Buffer.concat(frames.slice(chunk.startFrame, chunk.startFrame + chunk.frameCount)))));
  const legacyBytes = legacy.result.reduce((total, value) => total + value.byteLength, 0);
  const stackedBytes = stacked.result.reduce((total, value) => total + value.byteLength, 0);
  process.stdout.write(`${JSON.stringify({
    width,
    height,
    frameCount,
    rawBytes: width * height * 4 * frameCount,
    chunkLimitBytes: CAPTURE_CHUNK_MAX_BYTES,
    chunkCount: chunkPlan.length,
    legacy: { milliseconds: Number(legacy.milliseconds.toFixed(2)), compressedBytes: legacyBytes, calls: frameCount },
    stacked: { milliseconds: Number(stacked.milliseconds.toFixed(2)), compressedBytes: stackedBytes, calls: chunkPlan.length },
    callReduction: Number((frameCount / chunkPlan.length).toFixed(2)),
    elapsedSpeedup: Number((legacy.milliseconds / Math.max(0.001, stacked.milliseconds)).toFixed(2)),
    payloadReduction: Number((legacyBytes / Math.max(1, stackedBytes)).toFixed(3)),
  }, null, 2)}\n`);
}

try {
  run();
} catch (error) {
  process.stderr.write(`CAPTURE_BENCHMARK_FAILED: ${error.message}\n`);
  process.exitCode = 1;
}
