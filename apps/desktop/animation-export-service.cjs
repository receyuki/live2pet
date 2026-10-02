const { validateProject, normalizeVisualSettings } = require('@live2pet/project');
const { decodeAsset, encodeAsset, encodeAnimatedImage, normalizeAnimationFormat, normalizeClawdFrameSet, renderMappedMotions, resolveTargetRenderPreset, createCapturePipeline, MAX_ENCODE_FRAMES, MAX_STACKED_RGBA_BYTES } = require('@live2pet/package-build');
const { animationCacheKey } = require('./animation-cache-key.cjs');

function fail(code, message) { throw Object.assign(new Error(message), { code }); }
function checkCancelled(signal) { if (signal?.aborted) fail('BUILD_CANCELLED', 'Animation export was cancelled.'); }

function normalizeAnimationRender(value = {}) {
  const allowed = new Set(['preset', 'width', 'height', 'fps', 'quality', 'lossless', 'loop', 'format']);
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !allowed.has(key))) fail('INVALID_ANIMATION_RENDER', 'Unsupported animation export setting.');
  if (value.lossless !== undefined && typeof value.lossless !== 'boolean') fail('INVALID_ANIMATION_RENDER', 'lossless must be a boolean.');
  if (value.loop !== undefined && typeof value.loop !== 'boolean') fail('INVALID_ANIMATION_RENDER', 'loop must be a boolean.');
  const selection = resolveTargetRenderPreset('clawd', value);
  return { ...selection.settings, preset: selection.name, format: normalizeAnimationFormat(value.format), lossless: value.lossless ?? false, loop: value.loop === false ? 1 : 0 };
}

function createAnimationExportService({ getCache, resolveContext, withRenderer, encode = encodeAnimatedImage }) {
  return async function exportAnimations(input = {}) {
    const project = validateProject(input.project);
    if (project.sourceReview?.required) fail('SOURCE_REVIEW_REQUIRED', 'Review the changed Source Package before exporting animations.');
    const motionIds = input.motionIds;
    if (!Array.isArray(motionIds) || !motionIds.length || motionIds.length > 4096 || motionIds.some(id => typeof id !== 'string' || !id.trim()) || new Set(motionIds).size !== motionIds.length) fail('INVALID_ANIMATION_SELECTION', 'Choose distinct Motion ids to export.');
    if (input.expressionId != null && (typeof input.expressionId !== 'string' || !input.expressionId.trim())) fail('INVALID_ANIMATION_SELECTION', 'Expression id must be a nonempty string or null.');
    if (typeof input.onAnimation !== 'function') fail('INVALID_ANIMATION_OUTPUT', 'An animation output writer is required.');
    const render = normalizeAnimationRender(input.render);
    const visualSettings = normalizeVisualSettings(project.visualSettings);
    const context = await resolveContext(project);
    const cache = getCache();
    const verifyBuildContext = async (selected = {}) => {
      checkCancelled(input.signal);
      const current = await resolveContext(project);
      if (['runtimeVersion', 'rendererVersion', 'targetVersion', 'encoderVersion'].some(key => current[key] !== context[key]) || (selected.runtimeVersion && selected.runtimeVersion !== context.runtimeVersion)) fail('BUILD_INPUT_CHANGED', 'Build inputs changed. Retry with the current source and runtime.');
    };
    const result = { animations: [], failures: [], cache: { hits: 0, misses: 0 } };
    const emit = event => input.onProgress?.({ target: 'animation', ...event });
    for (const [index, motionId] of motionIds.entries()) {
      checkCancelled(input.signal);
      const key = animationCacheKey({ project, context, recipe: { motionId, expressionId: input.expressionId || null }, render, visualSettings });
      let encoded;
      let cacheStatus = 'miss';
      try {
        const cached = cache.get(key);
        if (cached) {
          try {
            const asset = decodeAsset(cached.data);
            if (asset.format === render.format && asset.width === render.width && asset.height === render.height) encoded = { ...asset, buffer: asset.bytes };
          } catch { cache.removeFiles?.(key.digest); }
        }
        if (encoded) {
          cacheStatus = 'hit';
          result.cache.hits++;
          emit({ stage: 'encode', status: 'completed', motionId, cache: 'hit', fraction: (index + 0.9) / motionIds.length });
        } else {
          result.cache.misses++;
          const pipeline = createCapturePipeline({ motionIds: [motionId], signal: input.signal,
            withRenderer: operation => withRenderer({ project, signal: input.signal, verifyBuildContext, onProgress: emit }, operation),
            prepare: async renderer => { await renderer.setVisualSettings?.(visualSettings); },
            estimateBytes: renderer => {
            const descriptor = (renderer.source?.motions || renderer.motions || []).find(motion => motion.id === motionId);
            if (!descriptor) fail('UNKNOWN_MOTION', `Unknown Motion: ${motionId}.`);
            const samples = Math.max(2, Math.ceil(Number(descriptor.duration ?? 1) * render.fps));
            if (!Number.isFinite(samples) || samples > MAX_ENCODE_FRAMES || render.width * render.height * 4 * samples > MAX_STACKED_RGBA_BYTES) fail('ANIMATION_TOO_LARGE', 'This animation exceeds the capture budget. Reduce resolution or frame rate.');
            return render.width * render.height * 4 * samples * 4 + 64 * 1024 * 1024;
          }, capture: async (renderer, _motionId, _index, signal) => {
            const frames = await renderMappedMotions({ renderer, motionIds: [motionId], target: 'clawd', render, expressionByMotion: { [motionId]: input.expressionId || null }, visualSettings, signal, cache, cacheContext: { ...context, projectId: project.projectId, sourceFingerprint: project.source.fingerprint }, onProgress: event => emit({ ...event, target: 'animation', fraction: (index + (event.fraction || 0) * 0.8) / motionIds.length }) });
            return frames[motionId];
          } });
          let pipelineError;
          try {
            encoded = await pipeline.withFrameSet(motionId, async frameSet => {
              checkCancelled(input.signal);
              emit({ stage: 'encode', status: 'started', motionId, fraction: (index + 0.8) / motionIds.length });
              return encode({ ...normalizeClawdFrameSet(frameSet, motionId, render), format: render.format, width: render.width, height: render.height, lossless: render.lossless, loop: render.loop }, { signal: input.signal });
            });
          } catch (error) { pipelineError = error; throw error; }
          finally { await pipeline.finish(pipelineError); }
          await verifyBuildContext();
          try { cache.put(key, encodeAsset({ ...encoded, bytes: encoded.buffer }), { projectId: project.projectId, sourceFingerprint: project.source.fingerprint, artifact: `planned-encoded-${render.format}` }); } catch { /* Optional cache writes must not lose the user's export. */ }
        }
        await verifyBuildContext();
        const output = await input.onAnimation({ motionId, ...encoded, cache: cacheStatus });
        result.animations.push({ motionId, format: encoded.format, width: encoded.width, height: encoded.height, frameCount: encoded.frameCount, byteLength: encoded.buffer.length, cache: cacheStatus, ...(output || {}) });
      } catch (error) {
        if (['BUILD_CANCELLED', 'BUILD_INPUT_CHANGED', 'PREVIEW_SOURCE_CHANGED', 'PREVIEW_SOURCE_MISMATCH'].includes(error.code)) throw error;
        result.failures.push({ motionId, code: error.code || 'ANIMATION_EXPORT_FAILED', message: error.message });
      }
      emit({ stage: 'export', status: 'motion-completed', motionId, completed: index + 1, total: motionIds.length, fraction: (index + 1) / motionIds.length });
    }
    return result;
  };
}

module.exports = { createAnimationExportService, normalizeAnimationRender };
