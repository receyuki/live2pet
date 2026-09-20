const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createProject } = require('../../../packages/project/src/index.cjs');
const { SyntheticRenderer } = require('../../../packages/renderer/src/index.cjs');
const { CacheStore, buildProjectTargets } = require('../../../packages/package-build/src/index.cjs');
const { createHostedBuildService } = require('../hosted-build-service.cjs');
const { createPlannedBuildService } = require('../planned-build-service.cjs');
const { createCaptureCacheBuildService } = require('../capture-cache-build.cjs');
const { inspectPackage } = require('../scripts/benchmark-project-build.cjs');

test('mixed encoded hits preserve pixels when the renderer carries state between Motions', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'live2pet-motion-isolation-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  let cache = new CacheStore({ rootDir: path.join(root, 'warm'), maxBytes: 1024 * 1024 });
  class StatefulRenderer extends SyntheticRenderer {
    history = 0;
    async prepareCapture() { this.history = 0; }
    captureRgba(options) {
      const frame = super.captureRgba(options);
      for (let i = 0; i < frame.rgba.length; i += 4) if (frame.rgba[i + 3]) frame.rgba[i] = 20 + this.history * 20;
      this.history++;
      return frame;
    }
  }
  const build = createPlannedBuildService({
    getCache: () => cache,
    resolveContext: async () => ({ runtimeVersion: 'b'.repeat(64), rendererVersion: 'synthetic-1', encoderVersion: 'sharp-test', targetVersion: '1' }),
    buildProject: createHostedBuildService({
      previewSession: { withRenderer: async (_input, run) => {
        const renderer = new StatefulRenderer();
        await renderer.load({ motions: ['idle', 'wave', 'jump'].map(id => ({ id, duration: 0.1 })) });
        return run(renderer);
      } }, buildProject: buildProjectTargets,
    }),
  });
  const project = createProject({ projectId: 'isolation', name: 'Isolation', source: { kind: 'standard-directory', name: 'fixture', fingerprint: 'a'.repeat(64) }, targets: {
    clawd: { mappings: { idle: 'motion:idle', thinking: 'motion:wave', working: 'motion:wave', sleeping: 'motion:idle' } },
  } });
  const input = { project, targets: ['clawd'], inputsByTarget: { clawd: { render: { preset: 'compact', width: 128, height: 128, samples: 2 } } }, optionsByTarget: { clawd: { package: true } } };
  await build(input);
  project.targets.clawd.mappings.thinking = 'motion:jump';
  const mixed = await build(input);
  assert.equal(mixed.builds.clawd.cache.hits, 2);
  cache = new CacheStore({ rootDir: path.join(root, 'cold'), maxBytes: 1024 * 1024 });
  const reference = await build(input);
  assert.deepEqual(await inspectPackage(mixed.builds.clawd.package.buffer), await inspectPackage(reference.builds.clawd.package.buffer));
});

for (const changeAt of ['acquisition', 'encoding', 'publication', 'selected-runtime']) {
  test(`runtime changes at ${changeAt} cannot publish an earlier identity`, async t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'live2pet-cache-race-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const cache = new CacheStore({ rootDir: root, maxBytes: 1024 * 1024 });
    let runtimeVersion = 'a'.repeat(64);
    let captures = 0;
    const build = createPlannedBuildService({
      getCache: () => cache,
      resolveContext: async () => ({ runtimeVersion, rendererVersion: 'synthetic-1', encoderVersion: 'sharp-test', targetVersion: '1' }),
      buildProject: createHostedBuildService({
        previewSession: { withRenderer: async (input, run) => {
          if (changeAt === 'acquisition') runtimeVersion = 'b'.repeat(64);
          if (changeAt === 'selected-runtime') await input.verifyBuildContext?.({ runtimeVersion: 'b'.repeat(64) });
          const renderer = new SyntheticRenderer();
          await renderer.load({ motions: [{ id: 'idle', duration: 0.1 }] });
          return run(renderer);
        } },
        buildProject: buildProjectTargets,
      }),
    });
    const project = createProject({ projectId: 'race', name: 'Race', source: { kind: 'standard-directory', name: 'fixture', fingerprint: 'c'.repeat(64) }, targets: {
      clawd: { mappings: { idle: 'motion:idle', thinking: 'motion:idle', working: 'motion:idle', sleeping: 'motion:idle' } },
    } });
    await assert.rejects(build({ project, targets: ['clawd'], inputsByTarget: { clawd: { render: { preset: 'compact', width: 128, height: 128, samples: 2 } } }, onProgress: event => {
      if (event.stage === 'render' && event.status === 'started') captures++;
      if (changeAt === 'encoding' && event.stage === 'encode' && event.status === 'motion-started') runtimeVersion = 'b'.repeat(64);
      if (changeAt === 'publication' && event.stage === 'validate' && event.status === 'completed') runtimeVersion = 'b'.repeat(64);
    } }), { code: 'BUILD_INPUT_CHANGED' });
    if (['acquisition', 'selected-runtime'].includes(changeAt)) assert.equal(captures, 0);
    if (changeAt !== 'publication') assert.equal(cache.status().entryCount, 0);
  });
}

test('unchanged or renamed Clawd builds reuse animations without acquiring a renderer; mixed builds capture only misses', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'live2pet-planned-build-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const cache = new CacheStore({ rootDir: root, maxBytes: 1024 * 1024 });
  let opens = 0;
  const captures = [];
  let runtimeVersion = 'b'.repeat(64);
  const build = createPlannedBuildService({
    getCache: () => cache,
    resolveContext: async () => ({ runtimeVersion, rendererVersion: 'synthetic-1', encoderVersion: 'sharp-test', targetVersion: '1' }),
    buildProject: createHostedBuildService({
      previewSession: { withRenderer: async (_input, run) => {
        opens++;
        const renderer = new SyntheticRenderer();
        await renderer.load({ motions: ['idle', 'wave', 'jump'].map(id => ({ id, duration: 0.1 })) });
        renderer.source = { cubismVersion: 4 };
        return run(renderer);
      } },
      buildProject: createCaptureCacheBuildService({
        buildProjectTargets,
        getCaptureCacheService: () => ({}),
        getEncodedCache: () => cache,
        resolveEncodedCacheContext: async () => ({ runtimeVersion, rendererVersion: 'synthetic-1', encoderVersion: 'sharp-test', targetVersion: '1' }),
      }),
    }),
  });
  const project = createProject({ projectId: 'fixture', name: 'Fixture', source: { kind: 'standard-directory', name: 'fixture', fingerprint: 'a'.repeat(64) }, targets: {
    clawd: { mappings: { idle: 'motion:idle', thinking: 'motion:wave', working: 'motion:wave', sleeping: 'motion:idle' } },
  } });
  const input = { project, targets: ['clawd'], inputsByTarget: { clawd: { render: { preset: 'compact', width: 128, height: 128, samples: 2 } } }, optionsByTarget: { clawd: { package: true } }, onProgress: event => { if (event.stage === 'render' && event.status === 'started') captures.push(event.motionId); } };
  const cold = await build(input);
  assert.ok(cache.status().entryCount > 0, 'completed assets are cached');
  assert.equal(cache.status().entries.filter(entry => entry.key.artifact.includes('encoded')).length, 2, 'one encoded persistence owner per animation');
  assert.equal(cold.builds.clawd.validation.ok, true);
  assert.deepEqual(captures, ['idle', 'wave']);
  const warm = await build(input);
  const renamed = await build({ ...input, project: { ...project, name: 'Renamed' } });
  assert.equal(opens, 1);
  assert.equal(warm.builds.clawd.cache.hits, 2);
  assert.equal(renamed.builds.clawd.artifactName, 'renamed-clawd.zip');
  assert.deepEqual(warm.builds.clawd.assets, cold.builds.clawd.assets);
  assert.deepEqual(warm.builds.clawd.provenance, cold.builds.clawd.provenance);
  assert.equal(warm.builds.clawd.provenance.encoder.version, 'sharp-test');
  const changed = structuredClone(project);
  changed.targets.clawd.mappings.thinking = 'motion:jump';
  const mixed = await build({ ...input, project: changed });
  assert.equal(mixed.builds.clawd.validation.ok, true);
  assert.equal(opens, 2);
  assert.deepEqual(captures, ['idle', 'wave', 'jump']);
  const entry = cache.status().entries.find(item => item.key.artifact === 'planned-encoded-webp' && item.key.recipe.motionId === 'idle');
  cache.put(entry.key, Buffer.from('malformed encoded asset'));
  const repaired = await build(input);
  assert.equal(repaired.builds.clawd.validation.ok, true);
  assert.equal(repaired.builds.clawd.cache.misses, 1);
  assert.deepEqual(captures, ['idle', 'wave', 'jump'], 'corrupt encoded data can still reuse valid raw captures');
  runtimeVersion = 'c'.repeat(64);
  await build(input);
  assert.deepEqual(captures, ['idle', 'wave', 'jump', 'idle', 'wave']);
});

test('Codex caches the actual atlas content and sprite version, not the theme name', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'live2pet-planned-codex-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const cache = new CacheStore({ rootDir: root, maxBytes: 1024 * 1024 });
  let opens = 0;
  const build = createPlannedBuildService({
    getCache: () => cache,
    resolveContext: async () => ({ runtimeVersion: 'b'.repeat(64), rendererVersion: 'synthetic-1', encoderVersion: 'sharp-test', targetVersion: '1' }),
    buildProject: createHostedBuildService({
      previewSession: { withRenderer: async (_input, run) => {
        opens++;
        const renderer = new SyntheticRenderer();
        await renderer.load({ motions: [{ id: 'idle', duration: 1 }, { id: 'wave', duration: 1 }] });
        return run(renderer);
      } },
      buildProject: buildProjectTargets,
    }),
  });
  const mappings = Object.fromEntries(['idle', 'running-right', 'running-left', 'waving', 'jumping', 'failed', 'waiting', 'running', 'review'].map(id => [id, 'motion:idle']));
  const project = createProject({ projectId: 'fixture', name: 'Fixture', source: { kind: 'spine-directory', name: 'fixture', fingerprint: 'a'.repeat(64) }, targets: { 'codex-pet': { mappings } } });
  const input = { project, targets: ['codex-pet'], optionsByTarget: { 'codex-pet': { package: true, spriteVersionNumber: 2 } } };
  const cold = await build(input);
  assert.ok(cache.status().entryCount > 0, 'completed atlas is cached');
  const warm = await build({ ...input, project: { ...project, name: 'Renamed' } });
  assert.equal(opens, 1);
  assert.deepEqual(warm.builds['codex-pet'].spritesheet, cold.builds['codex-pet'].spritesheet);
  assert.equal(warm.builds['codex-pet'].manifest.displayName, 'Renamed');
  const v1 = await build({ ...input, optionsByTarget: { 'codex-pet': { package: true, spriteVersionNumber: 1 } } });
  assert.equal(opens, 2);
  assert.equal(v1.builds['codex-pet'].manifest.spriteVersionNumber, 1);
  const changed = structuredClone(project);
  changed.targets['codex-pet'].mappings.waving = 'motion:wave';
  await build({ ...input, project: changed });
  assert.equal(opens, 3);
});
