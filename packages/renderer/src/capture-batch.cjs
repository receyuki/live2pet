const MAX_CAPTURE_BATCH_BYTES = 1024 * 1024;
const MAX_CAPTURE_BATCH_FRAMES = 4;
const CAPTURE_BATCH_TIME_MS = 64;

function captureBatchSize(width, height) {
  return Math.max(1, Math.min(MAX_CAPTURE_BATCH_FRAMES, Math.floor(MAX_CAPTURE_BATCH_BYTES / (width * height * 4))));
}

module.exports = { captureBatchSize, CAPTURE_BATCH_TIME_MS };
