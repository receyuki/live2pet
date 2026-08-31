(function exposeClawdCapturePlan(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.Live2PetClawdCapture = api;
})(typeof globalThis === 'object' ? globalThis : this, () => {
  const MIN_DURATION_SECONDS = 0.8;
  const MAX_DURATION_SECONDS = 8;
  const DEFAULT_DURATION_SECONDS = 1.2;
  const DEFAULT_PRESET = 'balanced';
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
    CLAWD_RENDER_PRESETS,
    createClawdCapturePlan,
    resolveClawdEncodingConcurrency,
    resolveClawdRenderSettings,
  });
});
