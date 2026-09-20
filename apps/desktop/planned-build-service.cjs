const { createCacheKey, createCodexPreview, decodeAsset, encodeAsset, planTargetRecipes } = require('@live2pet/package-build');
const CODEX_PROFILE = require('@live2pet/codex-target/profile');
const { performance } = require('node:perf_hooks');

// Independent from Project/Source Package versions: algorithm changes only
// invalidate generated assets, never the user's source or saved mappings.
const PLAN_VERSION = 'encoded-before-render-v2-isolated-motions';

function encodeAtlas(value) {
  const { encoded, ...metadata } = value;
  const header = Buffer.from(JSON.stringify({ version: 1, ...metadata }));
  if (header.length > 128 * 1024) throw new Error('Atlas cache metadata exceeds its limit.');
  const prefix = Buffer.alloc(4);
  prefix.writeUInt32LE(header.length);
  return Buffer.concat([prefix, header, encodeAsset({ ...encoded, bytes: encoded.buffer })]);
}

function decodeAtlas(bytes, spriteVersionNumber) {
  if (bytes.length < 5) throw new Error('Truncated atlas cache.');
  const length = bytes.readUInt32LE(0);
  if (length < 1 || length > 128 * 1024 || length + 4 >= bytes.length) throw new Error('Invalid atlas cache metadata.');
  const metadata = JSON.parse(bytes.toString('utf8', 4, length + 4));
  const encoded = decodeAsset(bytes.subarray(4 + length));
  const atlas = CODEX_PROFILE.atlases[spriteVersionNumber];
  if (metadata.version !== 1 || !atlas || encoded.format !== 'webp' || encoded.frameCount !== 1
    || encoded.width !== atlas.width || encoded.height !== atlas.height
    || metadata.atlas?.width !== atlas.width || metadata.atlas?.height !== atlas.height
    || !Array.isArray(metadata.rows) || metadata.rows.length !== 9
    || metadata.rows.some(row => !Number.isInteger(row.frameCount) || row.frameCount < 1 || row.frameCount > atlas.columns)
    || !createCodexPreview({ manifest: { spriteVersionNumber, atlas, rows: metadata.rows } }).ready) throw new Error('Atlas cache does not match its target.');
  return { rows: metadata.rows, selections: metadata.selections, atlas: metadata.atlas, encoded: { ...encoded, buffer: encoded.bytes } };
}

function createPlannedBuildService({ getCache, resolveContext, buildProject }) {
  return async function plannedBuild(input = {}) {
    const startedAt = performance.now();
    const desktopTimings = { requestMs: 0, identityChecksMs: 0, encodedCacheReadMs: 0, encodedCacheWriteMs: 0, encodedCacheReadBytes: 0, encodedCacheWriteBytes: 0, rendererQueueMs: 0, rendererAcquisitionMs: 0, queuedRequestsAhead: 0 };
    const resolve = async () => {
      const started = performance.now();
      try {
        return await resolveContext(input.project, (phase, duration) => {
          if (['sourceInspectionMs', 'runtimeVerificationMs'].includes(phase) && Number.isFinite(duration) && duration >= 0) desktopTimings[phase] = (desktopTimings[phase] || 0) + duration;
        });
      } finally { desktopTimings.identityChecksMs += performance.now() - started; }
    };
    const targets = input.targets || ['clawd', 'codex-pet'];
    const inputsByTarget = { ...input.inputsByTarget };
    const optionsByTarget = { ...input.optionsByTarget };
    let context;
    const verifyBuildContext = async (selected = {}) => {
      if (!context) return;
      const current = await resolve();
      if (['runtimeVersion', 'rendererVersion', 'targetVersion', 'encoderVersion'].some(key => current[key] !== context[key])
        || (selected.runtimeVersion && selected.runtimeVersion !== context.runtimeVersion)) {
        throw Object.assign(new Error('Build inputs changed. Retry with the current source and runtime.'), { code: 'BUILD_INPUT_CHANGED' });
      }
    };
    const cache = getCache();
    const read = key => {
      const started = performance.now();
      try {
        const cached = cache.get(key);
        desktopTimings.encodedCacheReadBytes += cached?.data?.byteLength || 0;
        return cached;
      } finally { desktopTimings.encodedCacheReadMs += performance.now() - started; }
    };
    for (const target of targets) {
      const original = inputsByTarget[target] || {};
      // External captures are not identified by the Source Package fingerprint.
      if (!['clawd', 'codex-pet'].includes(target) || original.renderer || original.frames || original.framesByMotion || original.candidates || original.candidatesByRow || original.encodedByMotion || original.encodedAtlas) continue;
      if (!context) context = await resolve();
      const options = optionsByTarget[target] || {};
      const plan = planTargetRecipes(input.project, target, original.render || (original.renderPreset ? { preset: original.renderPreset } : options.render));
      const keyFor = recipe => createCacheKey({
        sourceFingerprint: input.project.source.fingerprint,
        runtimeVersion: context.runtimeVersion,
        rendererVersion: context.rendererVersion,
        targetProfile: target,
        targetVersion: context.targetVersion,
        renderPreset: plan.render.preset,
        artifact: 'planned-encoded-webp',
        recipe: { planVersion: PLAN_VERSION, ...recipe, render: plan.render, visualSettings: plan.visualSettings, encoderVersion: context.encoderVersion },
      });
      const store = (key, bytes) => {
        const started = performance.now();
        try {
          const written = cache.put(key, bytes, { projectId: input.project.projectId, sourceFingerprint: input.project.source.fingerprint, artifact: 'planned-encoded-webp' });
          if (written.stored) desktopTimings.encodedCacheWriteBytes += bytes.byteLength;
          return written;
        } finally { desktopTimings.encodedCacheWriteMs += performance.now() - started; }
      };
      if (target === 'codex-pet') {
        const spriteVersionNumber = options.spriteVersionNumber ?? 1;
        const recipes = new Map(plan.motions.map(recipe => [recipe.motionId, recipe]));
        const key = keyFor({
          rows: Object.fromEntries(Object.entries(input.project.targets[target].mappings).map(([row, value]) => [row, recipes.get(value.slice(7))])),
          spriteVersionNumber,
          selection: { ...options.selection, preserveTiming: true },
          encoding: { quality: options.quality ?? 80, alphaQuality: options.alphaQuality ?? 100, lossless: options.lossless ?? false },
        });
        const cached = read(key);
        if (cached) {
          try { inputsByTarget[target] = { ...original, encodedAtlas: decodeAtlas(cached.data, spriteVersionNumber) }; }
          catch { cache.removeFiles?.(key.digest); }
        }
        optionsByTarget[target] = { ...options, ...context, onEncodedAtlas: async value => {
          await verifyBuildContext();
          try { store(key, encodeAtlas(value)); } catch { /* Cache writes are optional. */ }
        } };
        continue;
      }
      const keys = new Map(plan.motions.map(recipe => [recipe.motionId, keyFor(recipe)]));
      const encodedByMotion = {};
      for (const [motionId, key] of keys) {
        const cached = read(key);
        if (!cached) continue;
        try {
          const decoded = decodeAsset(cached.data);
          if (decoded.format !== 'webp' || decoded.width !== plan.render.width || decoded.height !== plan.render.height) continue;
          encodedByMotion[motionId] = { ...decoded, buffer: decoded.bytes };
        } catch { cache.removeFiles?.(key.digest); }
      }
      const allHit = Object.keys(encodedByMotion).length === keys.size;
      inputsByTarget[target] = { ...original, encodedByMotion, ...(allHit ? { framesByMotion: {} } : {}) };
      optionsByTarget[target] = { ...options, ...context, onEncodedAsset: async (motionId, asset) => {
        const key = keys.get(motionId);
        if (!key) return;
        await verifyBuildContext();
        try {
          store(key, encodeAsset({ ...asset, bytes: asset.buffer }));
        } catch { /* A cache write must not invalidate a successful capture. */ }
      } };
    }
    const result = await buildProject({ ...input, inputsByTarget, optionsByTarget, verifyBuildContext, onHostedTimings: ({ queueMs, acquisitionMs, queuedRequestsAhead }) => {
      desktopTimings.rendererQueueMs += queueMs;
      desktopTimings.rendererAcquisitionMs += acquisitionMs;
      desktopTimings.queuedRequestsAhead = Math.max(desktopTimings.queuedRequestsAhead, queuedRequestsAhead);
    } });
    await verifyBuildContext();
    desktopTimings.requestMs = performance.now() - startedAt;
    // Shared request-level measurements, not additive per-target durations.
    for (const build of Object.values(result.builds || {})) if (build.report) build.report.desktopTimings = { ...desktopTimings };
    return result;
  };
}

module.exports = { createPlannedBuildService, PLAN_VERSION };
