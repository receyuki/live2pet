const { createCacheKey, normalizeAnimationFormat, APNG_ENCODER_VERSION } = require('@live2pet/package-build');

const PLAN_VERSION = 'encoded-before-render-v2-isolated-motions';

// A standalone animation uses the same full-motion capture policy as Clawd.
// Names and output destinations deliberately do not identify rendered pixels.
function animationCacheKey({ project, context, recipe, render, visualSettings }) {
  const normalized = { ...render };
  const format = normalizeAnimationFormat(normalized.format);
  delete normalized.format;
  delete normalized.preset;
  if (format === 'apng') {
    delete normalized.quality;
    delete normalized.alphaQuality;
    delete normalized.lossless;
  }
  if (normalized.lossless === false) delete normalized.lossless;
  if (normalized.loop === 0) delete normalized.loop;
  return createCacheKey({
    sourceFingerprint: project.source.fingerprint,
    runtimeVersion: context.runtimeVersion,
    rendererVersion: context.rendererVersion,
    targetProfile: 'clawd',
    targetVersion: context.targetVersion,
    renderPreset: 'full-motion-v1',
    artifact: `planned-encoded-${format}`,
    recipe: { planVersion: PLAN_VERSION, ...recipe, render: normalized, visualSettings, encoderVersion: format === 'apng' ? APNG_ENCODER_VERSION : context.encoderVersion },
  });
}

module.exports = { animationCacheKey, PLAN_VERSION };
