function fail(message) {
  const error = new Error(message);
  error.code = 'INVALID_CAPTURE_CACHE_BUILD';
  throw error;
}

const { digestVisualSettings, normalizeVisualSettings } = require('@live2pet/project');

function mappedMotionIds(target = {}) {
  const behavior = target.options && target.options.behavior && typeof target.options.behavior === 'object' ? target.options.behavior : {};
  const behaviorValues = ['idleAnimations', 'workingTiers', 'jugglingTiers']
    .flatMap((field) => Array.isArray(behavior[field]) ? behavior[field].map((entry) => entry && entry.motion) : []);
  const values = [...Object.values(target.mappings || {}), ...Object.values(target.reactions || {}), ...behaviorValues];
  const seen = new Set();
  return values
    .filter((value) => typeof value === 'string' && value.startsWith('motion:'))
    .map((value) => value.slice(7))
    .filter((id) => !seen.has(id) && seen.add(id));
}

function captureCacheContext(project, target, plan) {
  if (!project || !project.source || typeof project.source.fingerprint !== 'string' || !/^[a-f0-9]{64}$/i.test(project.source.fingerprint)) return null;
  if (!plan || ![2, 3, 4, 5].includes(Number(plan.cubismVersion)) || !['clawd', 'codex-pet'].includes(target)) return null;
  const visualSettings = normalizeVisualSettings(project.visualSettings);
  const visualSettingsDigest = visualSettings.hiddenElementIds.length ? digestVisualSettings(visualSettings) : null;
  return {
    sourceFingerprint: project.source.fingerprint,
    cubismVersion: Number(plan.cubismVersion),
    target,
    renderPreset: typeof plan.renderPreset === 'string' ? plan.renderPreset : 'balanced',
    ...(visualSettingsDigest ? { visualSettings, visualSettingsDigest } : {}),
  };
}

function inferredRendererPlan(input, targetProject) {
  const renderer = input && input.renderer;
  const cubismVersion = Number(renderer && renderer.source && renderer.source.cubismVersion);
  if (![2, 3, 4, 5].includes(cubismVersion)) return null;
  const render = input && input.render && typeof input.render === 'object' ? input.render : {};
  const renderPreset = render.preset || input.renderPreset || targetProject?.renderPreset || targetProject?.options?.renderPreset || 'balanced';
  return { cubismVersion, renderPreset, inferred: true };
}

function encodedCacheContext(project, target, plan, resolved) {
  const captureContext = captureCacheContext(project, target, plan);
  if (!captureContext || !project || typeof project.projectId !== 'string' || !project.projectId.trim() || !resolved || typeof resolved !== 'object') return null;
  const runtimeVersion = typeof resolved.runtimeVersion === 'string' && /^[a-f0-9]{64}$/i.test(resolved.runtimeVersion.trim()) ? resolved.runtimeVersion.trim().toLowerCase() : null;
  const rendererVersion = typeof resolved.rendererVersion === 'string' && resolved.rendererVersion.trim() ? resolved.rendererVersion.trim() : null;
  const targetVersion = typeof resolved.targetVersion === 'string' && resolved.targetVersion.trim() ? resolved.targetVersion.trim() : null;
  const encoderVersion = typeof resolved.encoderVersion === 'string' && resolved.encoderVersion.trim() ? resolved.encoderVersion.trim() : null;
  if (!runtimeVersion || !rendererVersion || !targetVersion || !encoderVersion) return null;
  return {
    projectId: project.projectId.trim(),
    sourceFingerprint: captureContext.sourceFingerprint.toLowerCase(),
    runtimeVersion,
    rendererVersion,
    targetVersion,
    renderPreset: captureContext.renderPreset,
    encoderVersion,
    ...(captureContext.visualSettingsDigest ? { visualSettingsDigest: captureContext.visualSettingsDigest } : {}),
  };
}

function createCaptureCacheBuildService({ buildProjectTargets, getCaptureCacheService, getEncodedCache = null, resolveEncodedCacheContext = null } = {}) {
  if (typeof buildProjectTargets !== 'function') fail('buildProjectTargets must be a function.');
  if (typeof getCaptureCacheService !== 'function') fail('getCaptureCacheService must be a function.');
  if (getEncodedCache !== null && typeof getEncodedCache !== 'function') fail('getEncodedCache must be a function when provided.');
  if (resolveEncodedCacheContext !== null && typeof resolveEncodedCacheContext !== 'function') fail('resolveEncodedCacheContext must be a function when provided.');

  return async function buildProjectWithCaptureCache(input = {}) {
    const targetInputs = { ...(input.inputsByTarget || {}) };
    const targetOptions = Object.fromEntries(Object.entries(input.optionsByTarget || {}).map(([target, options]) => {
      const { cache: _cache, cacheContext: _cacheContext, ...cleanOptions } = options && typeof options === 'object' ? options : {};
      return [target, cleanOptions];
    }));
    const pendingWrites = [];
    const service = getCaptureCacheService();
    for (const target of input.targets || ['clawd', 'codex-pet']) {
      const original = targetInputs[target];
      const plan = original && original.captureCache;
      const targetProject = input.project && input.project.targets && input.project.targets[target];
      if (!plan || typeof plan !== 'object') continue;
      const context = captureCacheContext(input.project, target, plan);
      if (!context || !targetProject) continue;
      const recipes = plan.recipesByMotion && typeof plan.recipesByMotion === 'object' ? plan.recipesByMotion : {};
      const keys = plan.keysByMotion && typeof plan.keysByMotion === 'object' ? plan.keysByMotion : {};
      const resolved = new Map();
      const cacheHits = new Set();
      const mappedIds = mappedMotionIds(targetProject);
      const readableRecipes = mappedIds
        .map((motionId) => recipes[motionId])
        .filter((recipe) => recipe && typeof keys[recipe.motionId] === 'string' && /^[a-f0-9]{64}$/i.test(keys[recipe.motionId]));
      const cachedByMotion = typeof service.readEncodedMany === 'function'
        ? await service.readEncodedMany(context, readableRecipes)
        : typeof service.readMany === 'function'
          ? await service.readMany(context, readableRecipes)
        : Object.fromEntries(await Promise.all(readableRecipes.map(async (recipe) => [recipe.motionId, await service.read(context, recipe)])));
      for (const motionId of mappedIds) {
        const recipe = recipes[motionId];
        const expectedKey = keys[motionId];
        if (!recipe || typeof expectedKey !== 'string' || !/^[a-f0-9]{64}$/i.test(expectedKey)) continue;
        const cached = cachedByMotion[motionId];
        if (!cached) continue;
        if (cached.key !== expectedKey.toLowerCase()) throw new Error(`Capture cache identity mismatch for ${motionId}.`);
        resolved.set(motionId, cached.frameSet);
        cacheHits.add(motionId);
      }
      const { captureCache: _captureCache, ...cleanInput } = original;
      if (target === 'clawd') {
        const framesByMotion = { ...(cleanInput.framesByMotion || {}) };
        for (const [motionId, frameSet] of resolved) framesByMotion[motionId] = frameSet;
        targetInputs[target] = { ...cleanInput, framesByMotion };
        for (const motionId of mappedIds) {
          if (cacheHits.has(motionId)) continue;
          const recipe = recipes[motionId];
          const frameSet = framesByMotion[motionId];
          if (recipe && frameSet) pendingWrites.push({ context, recipe, frameSet });
        }
      } else {
        const candidatesByRow = { ...(cleanInput.candidatesByRow || {}) };
        for (const [row, value] of Object.entries(targetProject.mappings || {})) {
          if (!value || !value.startsWith('motion:')) continue;
          const motionId = value.slice(7);
          const frameSet = resolved.get(motionId);
          if (frameSet && Array.isArray(frameSet.frames)) candidatesByRow[row] = frameSet.frames;
        }
        targetInputs[target] = { ...cleanInput, candidatesByRow };
        const candidatesByMotion = new Map();
        for (const [row, value] of Object.entries(targetProject.mappings || {})) {
          if (!value || !value.startsWith('motion:')) continue;
          const motionId = value.slice(7);
          if (cacheHits.has(motionId)) continue;
          const candidates = candidatesByRow[row];
          if (Array.isArray(candidates) && (!candidatesByMotion.has(motionId) || candidates.length > candidatesByMotion.get(motionId).length)) candidatesByMotion.set(motionId, candidates);
        }
        for (const [motionId, frameSet] of candidatesByMotion) {
          const recipe = recipes[motionId];
          if (recipe) pendingWrites.push({ context, recipe, frameSet: { motionId, expressionId: recipe.expressionId || null, frames: frameSet, fps: recipe.fps } });
        }
      }
    }
    if (getEncodedCache && resolveEncodedCacheContext) {
      const cache = getEncodedCache();
      if (cache && typeof cache.get === 'function' && typeof cache.put === 'function') {
        for (const target of input.targets || ['clawd', 'codex-pet']) {
          const targetProject = input.project && input.project.targets && input.project.targets[target];
          const targetInput = input.inputsByTarget && input.inputsByTarget[target];
          const plan = targetInput && targetInput.captureCache
            ? targetInput.captureCache
            : inferredRendererPlan(targetInput, targetProject);
          if (!plan || !targetProject) continue;
          let resolved = null;
          try { resolved = await resolveEncodedCacheContext({ project: input.project, target, targetProject, plan }); } catch {}
          const context = encodedCacheContext(input.project, target, plan, resolved);
          if (!context) continue;
          targetOptions[target] = { ...(targetOptions[target] || {}), cache, cacheContext: context };
        }
      }
    }
    const persistCaptures = async () => {
      if (typeof service.writeMany === 'function' && pendingWrites.length) {
        const groups = new Map();
        for (const pending of pendingWrites) {
          const key = JSON.stringify([pending.context.sourceFingerprint, pending.context.cubismVersion, pending.context.target, pending.context.renderPreset, pending.context.visualSettingsDigest || null]);
          if (!groups.has(key)) groups.set(key, { context: pending.context, entries: [] });
          groups.get(key).entries.push({ recipe: pending.recipe, frameSet: pending.frameSet });
        }
        for (const group of groups.values()) {
          try { await service.writeMany(group.context, group.entries); } catch {}
        }
      } else for (const pending of pendingWrites) {
        try { await service.write(pending.context, pending.recipe, pending.frameSet); } catch {}
      }
    };
    try {
      return await buildProjectTargets({ ...input, inputsByTarget: targetInputs, optionsByTarget: targetOptions });
    } finally {
      // Keep completed captures even when package validation or cancellation
      // aborts the build; a retry can then skip Live2D capture.
      await persistCaptures();
    }
  };
}

module.exports = { captureCacheContext, createCaptureCacheBuildService, encodedCacheContext, mappedMotionIds };
