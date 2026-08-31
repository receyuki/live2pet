(function exposeClawdCapturePlan(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.Live2PetClawdCapture = api;
})(typeof globalThis === 'object' ? globalThis : this, () => {
  const MIN_DURATION_SECONDS = 0.8;
  const MAX_DURATION_SECONDS = 8;
  const DEFAULT_DURATION_SECONDS = 1.2;
  const DEFAULT_PRESET = 'balanced';
  // Keep at most two compressed chunks plus the active capture buffer alive;
  // 16 MiB keeps that peak predictable on laptops while still reducing IPC
  // compression calls several-fold for the Balanced preset.
  const CAPTURE_CHUNK_MAX_BYTES = 16 * 1024 * 1024;
  const CLAWD_RENDER_PRESETS = Object.freeze({
    compact: Object.freeze({ width: 512, height: 512, fps: 18, quality: 76, alphaQuality: 100 }),
    balanced: Object.freeze({ width: 768, height: 768, fps: 24, quality: 82, alphaQuality: 100 }),
    high: Object.freeze({ width: 1024, height: 1024, fps: 30, quality: 88, alphaQuality: 100 }),
  });

  function resolveClawdRenderSettings(value) {
    const preset = Object.hasOwn(CLAWD_RENDER_PRESETS, value) ? value : DEFAULT_PRESET;
    return { preset, settings: CLAWD_RENDER_PRESETS[preset] };
  }

  function normalizeDurationSeconds(value) {
    const duration = Number(value);
    const usable = Number.isFinite(duration) && duration > 0 ? duration : DEFAULT_DURATION_SECONDS;
    return Math.max(MIN_DURATION_SECONDS, Math.min(MAX_DURATION_SECONDS, usable));
  }

  function exactIntegerDelays(durationMs, frameCount) {
    const roundedDuration = Math.round(durationMs);
    return Array.from({ length: frameCount }, (_, index) => (
      Math.round(((index + 1) * roundedDuration) / frameCount)
      - Math.round((index * roundedDuration) / frameCount)
    ));
  }

  function createFixedStepPlan(durationValue, frameCountValue) {
    const durationSeconds = normalizeDurationSeconds(durationValue);
    const frameCount = Math.max(1, Math.floor(Number(frameCountValue) || 1));
    const durationMs = Math.round(durationSeconds * 1000);
    return {
      durationSeconds,
      durationMs,
      frameCount,
      stepMs: durationMs / frameCount,
      times: Array.from({ length: frameCount }, (_, index) => durationSeconds * (frameCount === 1 ? 0 : index / (frameCount - 1))),
    };
  }

  function createCaptureChunkPlan(widthValue, heightValue, frameCountValue, maxBytes = CAPTURE_CHUNK_MAX_BYTES) {
    const width = Math.floor(Number(widthValue));
    const height = Math.floor(Number(heightValue));
    const frameCount = Math.floor(Number(frameCountValue));
    const limit = Math.floor(Number(maxBytes));
    if (!Number.isInteger(width) || width < 1 || !Number.isInteger(height) || height < 1 || !Number.isInteger(frameCount) || frameCount < 1 || !Number.isInteger(limit) || limit < 1) {
      throw new Error('Capture chunk dimensions, frame count, and byte limit must be positive integers.');
    }
    const frameBytes = width * height * 4;
    if (!Number.isSafeInteger(frameBytes) || frameBytes > limit) throw new Error('A single capture frame exceeds the bounded chunk byte limit.');
    const framesPerChunk = Math.max(1, Math.floor(limit / frameBytes));
    const chunks = [];
    for (let startFrame = 0; startFrame < frameCount; startFrame += framesPerChunk) {
      const chunkFrameCount = Math.min(framesPerChunk, frameCount - startFrame);
      chunks.push({ startFrame, frameCount: chunkFrameCount, byteLength: chunkFrameCount * frameBytes });
    }
    return chunks;
  }

  function createClawdCapturePlan(presetValue, durationValue) {
    const { preset, settings } = resolveClawdRenderSettings(presetValue);
    const durationSeconds = normalizeDurationSeconds(durationValue);
    const durationMs = Math.round(durationSeconds * 1000);
    const frameCount = Math.max(2, Math.ceil(durationSeconds * settings.fps));
    return {
      preset,
      settings,
      durationSeconds,
      durationMs,
      frameCount,
      stepMs: durationMs / frameCount,
      delays: exactIntegerDelays(durationMs, frameCount),
    };
  }

  function resolveClawdEncodingConcurrency(presetValue) {
    const { preset } = resolveClawdRenderSettings(presetValue);
    return preset === 'compact' ? 2 : 1;
  }

  return Object.freeze({
    CAPTURE_CHUNK_MAX_BYTES,
    CLAWD_RENDER_PRESETS,
    createCaptureChunkPlan,
    createClawdCapturePlan,
    createFixedStepPlan,
    resolveClawdEncodingConcurrency,
    resolveClawdRenderSettings,
  });
});
