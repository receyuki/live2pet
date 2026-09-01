const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { CacheStore, createCacheKey } = require('../../../packages/package-build/src/index.cjs');
const { createCaptureCacheBuildService, mappedMotionIds } = require('../capture-cache-build.cjs');

function project() {
  return {
    projectId: 'capture-cache-build-test',
    source: { fingerprint: 'a'.repeat(64) },
    targets: {
      clawd: {
        mappings: { idle: 'motion:idle', working: 'motion:working' },
        reactions: { attention: 'motion:idle' },
      },
      'codex-pet': { mappings: {} },
    },
  };
}

function plan(motions, overrides = {}) {
  const recipesByMotion = Object.fromEntries(motions.map((motionId) => [motionId, {
    motionId,
    duration: 1,
    width: 2,
    height: 2,
    frameCount: 1,
    fps: 24,
  }]));
  const keysByMotion = Object.fromEntries(motions.map((motionId) => [motionId, (motionId === 'idle' ? 'b' : 'c').repeat(64)]));
  return {
    cubismVersion: 4,
    renderPreset: 'balanced',
    recipesByMotion,
    keysByMotion,
    ...overrides,
  };
}

function frameSet(motionId, value) {
  return {
    motionId,
    frames: [{ id: `${motionId}-0`, index: 0, time: 0, width: 2, height: 2, rgba: Uint8Array.from([value, 0, 0, 255, value, 1, 0, 255, value, 2, 0, 0, 255, value, 3, 0, 255]) }],
    fps: 24,
  };
}

test('capture-cache build service replaces Clawd inputs with cache hits and strips cache controls', async () => {
  const seen = [];
  const service = createCaptureCacheBuildService({
    getCaptureCacheService: () => ({
      readMany: async () => { throw new Error('builds must not inflate every cached Motion before encoding'); },
      readEncodedMany: async (_context, recipes) => Object.fromEntries(recipes.map((recipe) => [recipe.motionId, {
        key: recipe.motionId === 'idle' ? 'b'.repeat(64) : 'c'.repeat(64),
        frameSet: frameSet(recipe.motionId, recipe.motionId === 'idle' ? 7 : 8),
      }])),
      writeMany: async () => [],
    }),
    buildProjectTargets: async (input) => {
      seen.push(input);
      return { targets: ['clawd'], builds: { clawd: { ok: true } } };
    },
  });

  await service({
    project: project(),
    targets: ['clawd'],
    inputsByTarget: {
      clawd: {
        framesByMotion: { idle: frameSet('idle', 1), working: frameSet('working', 2) },
        captureCache: plan(['idle', 'working']),
      },
    },
  });

  assert.equal(seen.length, 1);
  const clawdInput = seen[0].inputsByTarget.clawd;
  assert.equal('captureCache' in clawdInput, false);
  assert.equal(clawdInput.framesByMotion.idle.frames[0].rgba[0], 7);
  assert.equal(clawdInput.framesByMotion.working.frames[0].rgba[0], 8);
});

test('capture-cache build service includes user-configured Clawd behavior Motions', () => {
  assert.deepEqual(mappedMotionIds({
    mappings: { idle: 'motion:idle' },
    reactions: {},
    options: {
      behavior: {
        idleAnimations: [{ motion: 'motion:idle-pool' }],
        workingTiers: [{ motion: 'motion:working-tier' }],
        jugglingTiers: [{ motion: 'motion:juggling-tier' }],
      },
    },
  }), ['idle', 'idle-pool', 'working-tier', 'juggling-tier']);
});

test('capture-cache build service persists completed misses even when the build fails', async () => {
  const writes = [];
  const service = createCaptureCacheBuildService({
    getCaptureCacheService: () => ({
      readMany: async () => ({}),
      writeMany: async (context, entries) => { writes.push({ context, entries }); return entries; },
    }),
    buildProjectTargets: async () => { throw new Error('package validation failed'); },
  });

  await assert.rejects(
    () => service({
      project: project(),
      targets: ['clawd'],
      inputsByTarget: {
        clawd: {
          framesByMotion: { idle: frameSet('idle', 3), working: frameSet('working', 4) },
          captureCache: plan(['idle', 'working']),
        },
      },
    }),
    /package validation failed/,
  );

  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0].entries.map((entry) => entry.recipe.motionId), ['idle', 'working']);
  assert.equal(writes[0].context.target, 'clawd');
});

test('capture-cache build service preserves Codex recipe Expressions when writing misses', async () => {
  const writes = [];
  const codexProject = project();
  codexProject.targets['codex-pet'].mappings = { idle: 'motion:idle' };
  const codexPlan = plan(['idle'], { recipesByMotion: { idle: { ...plan(['idle']).recipesByMotion.idle, expressionId: 'smile' } } });
  const service = createCaptureCacheBuildService({
    getCaptureCacheService: () => ({
      readMany: async () => ({}),
      writeMany: async (_context, entries) => { writes.push(...entries); return entries; },
    }),
    buildProjectTargets: async () => ({ targets: ['codex-pet'], builds: { 'codex-pet': { ok: true } } }),
  });

  await service({
    project: codexProject,
    targets: ['codex-pet'],
    inputsByTarget: {
      'codex-pet': {
        candidatesByRow: { idle: frameSet('idle', 1).frames },
        captureCache: codexPlan,
      },
    },
  });

  assert.equal(writes.length, 1);
  assert.equal(writes[0].recipe.expressionId, 'smile');
  assert.equal(writes[0].frameSet.expressionId, 'smile');
});

test('Desktop Package Builds reuse encoded assets through the persistent capture CacheStore', async () => {
  const cacheRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'live2pet-desktop-encoded-cache-'));
  const cache = new CacheStore({ rootDir: cacheRoot, maxBytes: 1024 * 1024 });
  let encodes = 0;
  const buildProjectTargets = async (input) => {
    const target = input.targets[0];
    const options = input.optionsByTarget[target];
    const context = options.cacheContext;
    assert.equal(options.cache, cache);
    assert.deepEqual(context, {
      projectId: 'capture-cache-build-test',
      sourceFingerprint: 'a'.repeat(64),
      runtimeVersion: 'd'.repeat(64),
      rendererVersion: 'pixi-live2d-capture-v2',
      targetVersion: '1',
      renderPreset: 'balanced',
      encoderVersion: 'sharp-0.34.5',
    });
    assert.equal(JSON.stringify(context).includes('/'), false);
    const key = createCacheKey({
      sourceFingerprint: context.sourceFingerprint,
      runtimeVersion: context.runtimeVersion,
      rendererVersion: context.rendererVersion,
      recipe: { motion: 'idle', encoderVersion: context.encoderVersion },
      targetProfile: target,
      targetVersion: context.targetVersion,
      renderPreset: context.renderPreset,
      artifact: 'encoded-webp',
    });
    const hit = options.cache.get(key);
    if (!hit) {
      encodes += 1;
      options.cache.put(key, Buffer.from('encoded-webp'), { projectId: context.projectId, sourceFingerprint: context.sourceFingerprint, artifact: 'encoded-webp' });
    }
    return { targets: [target], builds: { [target]: { cache: { hits: hit ? 1 : 0, misses: hit ? 0 : 1 } } } };
  };
  const createService = () => createCaptureCacheBuildService({
    buildProjectTargets,
    getCaptureCacheService: () => ({ readEncodedMany: async () => ({}), writeMany: async () => [] }),
    getEncodedCache: () => cache,
    resolveEncodedCacheContext: async () => ({
      runtimeVersion: 'd'.repeat(64),
      rendererVersion: 'pixi-live2d-capture-v2',
      targetVersion: '1',
      encoderVersion: 'sharp-0.34.5',
    }),
  });
  const input = {
    project: project(),
    targets: ['clawd'],
    inputsByTarget: { clawd: { framesByMotion: { idle: frameSet('idle', 1), working: frameSet('working', 2) }, captureCache: plan(['idle', 'working']) } },
    optionsByTarget: { clawd: { package: true } },
  };

  const first = await createService()(input);
  const second = await createService()(input);

  assert.deepEqual(first.builds.clawd.cache, { hits: 0, misses: 1 });
  assert.deepEqual(second.builds.clawd.cache, { hits: 1, misses: 0 });
  assert.equal(encodes, 1);
  assert.equal(cache.status().entryCount, 1);
});

test('Desktop Package Builds inject one shared encoded cache into both Target Profiles', async () => {
  const cache = new CacheStore({ rootDir: fs.mkdtempSync(path.join(os.tmpdir(), 'live2pet-desktop-both-targets-')), maxBytes: 1024 * 1024 });
  const dualProject = project();
  dualProject.targets['codex-pet'].mappings = { idle: 'motion:idle' };
  const seen = [];
  const service = createCaptureCacheBuildService({
    getCaptureCacheService: () => ({ readEncodedMany: async () => ({}), writeMany: async () => [] }),
    getEncodedCache: () => cache,
    resolveEncodedCacheContext: async () => ({ runtimeVersion: 'd'.repeat(64), rendererVersion: 'renderer-v1', targetVersion: '1', encoderVersion: 'sharp-0.34.5' }),
    buildProjectTargets: async (input) => {
      for (const target of input.targets) {
        seen.push({ target, options: input.optionsByTarget[target] });
      }
      return { builds: {} };
    },
  });

  await service({
    project: dualProject,
    targets: ['clawd', 'codex-pet'],
    inputsByTarget: {
      clawd: { framesByMotion: { idle: frameSet('idle', 1), working: frameSet('working', 2) }, captureCache: plan(['idle', 'working']) },
      'codex-pet': { candidatesByRow: { idle: frameSet('idle', 1).frames }, captureCache: plan(['idle'], { renderPreset: 'high' }) },
    },
  });

  assert.deepEqual(seen.map(({ target, options }) => ({ target, sameCache: options.cache === cache, preset: options.cacheContext.renderPreset })), [
    { target: 'clawd', sameCache: true, preset: 'balanced' },
    { target: 'codex-pet', sameCache: true, preset: 'high' },
  ]);
});

test('Desktop encoded cache misses when its path-free build identity changes', async () => {
  const cache = new CacheStore({ rootDir: fs.mkdtempSync(path.join(os.tmpdir(), 'live2pet-desktop-encoded-identity-')), maxBytes: 1024 * 1024 });
  let runtimeVersion = 'd'.repeat(64);
  let misses = 0;
  const service = createCaptureCacheBuildService({
    getCaptureCacheService: () => ({ readEncodedMany: async () => ({}), writeMany: async () => [] }),
    getEncodedCache: () => cache,
    resolveEncodedCacheContext: async () => ({ runtimeVersion, rendererVersion: 'renderer-v1', targetVersion: '1', encoderVersion: 'sharp-0.34.5' }),
    buildProjectTargets: async (input) => {
      const context = input.optionsByTarget.clawd.cacheContext;
      const key = createCacheKey({ sourceFingerprint: context.sourceFingerprint, runtimeVersion: context.runtimeVersion, rendererVersion: context.rendererVersion, recipe: { encoderVersion: context.encoderVersion }, targetProfile: 'clawd', targetVersion: context.targetVersion, renderPreset: context.renderPreset, artifact: 'encoded-webp' });
      if (!cache.get(key)) {
        misses += 1;
        cache.put(key, Buffer.from(`encoded-${misses}`), { projectId: context.projectId, sourceFingerprint: context.sourceFingerprint, artifact: 'encoded-webp' });
      }
      return { builds: { clawd: { ok: true } } };
    },
  });
  const input = { project: project(), targets: ['clawd'], inputsByTarget: { clawd: { framesByMotion: { idle: frameSet('idle', 1) }, captureCache: plan(['idle']) } } };

  await service(input);
  await service(input);
  runtimeVersion = 'e'.repeat(64);
  await service(input);

  assert.equal(misses, 2);
  assert.equal(cache.status().entryCount, 2);
});
