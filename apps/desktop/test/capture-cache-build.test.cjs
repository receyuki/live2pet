const assert = require('node:assert/strict');
const test = require('node:test');

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
      readMany: async (_context, recipes) => Object.fromEntries(recipes.map((recipe) => [recipe.motionId, {
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
