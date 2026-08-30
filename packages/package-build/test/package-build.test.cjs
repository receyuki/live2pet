const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');

const {
  CLAWD_PACKAGE_LIMIT,
  PackageBuildError,
  buildClawdTheme,
  buildCodexPet,
  buildProjectTargets,
  createClawdThemeZip,
  createCodexPetZip,
  encodeAnimatedWebp,
} = require('../src/index.cjs');
const { validateClawdThemePackage } = require('../../clawd-target/src/index.cjs');
const { validateCodexPetPackage } = require('../../codex-target/src/index.cjs');
const { createProject, ProjectValidationError } = require('../../project/src/index.cjs');
const { SyntheticRenderer } = require('../../renderer/src/index.cjs');

function mapping() {
  return {
    idle: 'motion:idle',
    'running-right': 'motion:running-right',
    'running-left': 'motion:running-left',
    waving: 'motion:waving',
    jumping: 'motion:jumping',
    failed: 'motion:failed',
    waiting: 'motion:waiting',
    running: 'motion:running',
    review: 'motion:review',
  };
}

function candidatesByRow() {
  const counts = { idle: 6, 'running-right': 8, 'running-left': 8, waving: 4, jumping: 5, failed: 8, waiting: 6, running: 6, review: 6 };
  return Object.fromEntries(Object.entries(counts).map(([row, count]) => [row, Array.from({ length: count }, (_, index) => {
    const rgba = new Uint8Array(192 * 208 * 4);
    rgba.fill((row.length * 13 + index) % 255);
    rgba[3] = 255;
    return { id: `${row}-${index}`, index, time: index / 10, visualChange: index ? 0.2 : 0, width: 192, height: 208, rgba };
  })]));
}

function clawdMapping() {
  return {
    sleepMode: 'direct',
    states: {
      idle: 'motion:idle',
      thinking: 'motion:thinking',
      working: 'motion:working',
      sleeping: 'fallback:idle',
      error: 'motion:error',
      attention: 'motion:attention',
    },
    reactions: { drag: 'motion:error' },
  };
}

function clawdFrames() {
  return Object.fromEntries(['idle', 'thinking', 'working', 'error', 'attention'].map((motionId, motionIndex) => [motionId, {
    frames: [0, 1].map((index) => ({
      width: 2,
      height: 2,
      rgba: Uint8Array.from([motionIndex, index, 0, 255, motionIndex, index, 1, 255, motionIndex, index, 2, 255, motionIndex, index, 3, 255]),
    })),
    fps: 10,
  }]));
}

function clawdSharpFactory() {
  let count = 0;
  return (input, options) => ({
    webp(webpOptions) {
      assert.equal(options.animated, true);
      assert.deepEqual(options.raw, { width: 2, height: 4, channels: 4, pageHeight: 2 });
      assert.equal(input.length, 32);
      assert.deepEqual(webpOptions, { quality: 80, alphaQuality: 100, lossless: false, loop: 0, delay: [100, 100] });
      count += 1;
      return { toBuffer: async () => ({ data: Buffer.from(`RIFF-clawd-${count}`), info: { width: 2, height: 2, pages: 2 } }) };
    },
  });
}

test('builds a guide-shaped Clawd theme package from captured Motion frames', async () => {
  const events = [];
  const result = await buildClawdTheme({ mapping: clawdMapping(), framesByMotion: clawdFrames(), metadata: { id: 'demo-theme', name: 'Demo Theme', author: 'Test' } }, { package: true, sharpFactory: clawdSharpFactory(), onProgress: (event) => events.push(event) });
  assert.equal(result.target, 'clawd');
  assert.equal(result.themeId, 'demo-theme');
  assert.deepEqual(result.manifest.states.idle, ['demo-theme-idle.webp']);
  assert.deepEqual(result.manifest.states.sleeping, { fallbackTo: 'idle' });
  assert.deepEqual(result.manifest.reactions.drag, { file: 'demo-theme-error.webp' });
  assert.equal(result.assets.length, 5);
  assert.equal(result.encoding.assetCount, 5);
  assert.deepEqual(events.map(({ stage, status }) => `${stage}:${status}`), ['validate:started', 'validate:completed', 'encode:started', 'encode:completed', 'manifest:started', 'manifest:completed', 'package:started', 'package:completed']);
  const zip = require('@zip.js/zip.js');
  const reader = new zip.ZipReader(new zip.Uint8ArrayReader(result.package.buffer));
  const entries = await reader.getEntries();
  assert.deepEqual(entries.map((entry) => entry.filename), [
    'demo-theme/theme.json',
    'demo-theme/README.md',
    'demo-theme/assets/demo-theme-attention.webp',
    'demo-theme/assets/demo-theme-error.webp',
    'demo-theme/assets/demo-theme-idle.webp',
    'demo-theme/assets/demo-theme-thinking.webp',
    'demo-theme/assets/demo-theme-working.webp',
  ]);
  await reader.close();
});

test('rejects missing Clawd captures and oversized theme archives', async () => {
  const frames = clawdFrames();
  delete frames.error;
  await assert.rejects(
    () => buildClawdTheme({ mapping: clawdMapping(), framesByMotion: frames }, { sharpFactory: clawdSharpFactory() }),
    (error) => error instanceof PackageBuildError && error.code === 'MISSING_CLAWD_FRAME_SET',
  );
  const oversizedZip = {
    ZipWriter: class {
      async add() {}
      async close() { return new Uint8Array(11); }
    },
    Uint8ArrayWriter: class {},
    Uint8ArrayReader: class { constructor(value) { this.value = value; } },
  };
  await assert.rejects(
    () => createClawdThemeZip({ themeId: 'demo-theme', manifest: { name: 'Demo Theme' }, assets: { 'demo.webp': Uint8Array.from([1]) }, zipModule: oversizedZip, maxBytes: 10 }),
    (error) => error instanceof PackageBuildError && error.code === 'CLAWD_PACKAGE_TOO_LARGE' && error.details.maxBytes === 10,
  );
  assert.equal(CLAWD_PACKAGE_LIMIT, 83886080);
});

test('builds a deterministic Codex atlas handoff with progress stages', async () => {
  const events = [];
  const first = await buildCodexPet({ mapping: { mappings: mapping() }, candidatesByRow: candidatesByRow() }, { onProgress: (event) => events.push(event) });
  const second = await buildCodexPet({ mapping: { mappings: mapping() }, candidatesByRow: candidatesByRow() });
  assert.deepEqual(events.map(({ stage, status }) => `${stage}:${status}`), ['select:started', 'select:completed', 'layout:started', 'layout:completed', 'compose:started', 'compose:completed', 'manifest:started', 'manifest:completed']);
  assert.equal(first.target, 'codex-pet');
  assert.deepEqual({ id: first.manifest.id, displayName: first.manifest.displayName, description: first.manifest.description, spritesheetPath: first.manifest.spritesheetPath }, {
    id: 'live2pet-codex-pet',
    displayName: 'Live2Pet Codex Pet',
    description: 'A Codex pet generated locally by Live2Pet from Live2Pet Codex Pet.',
    spritesheetPath: 'spritesheet.webp',
  });
  assert.deepEqual(first.manifest.atlas, { width: 1536, height: 1872, columns: 8, rows: 9, cellWidth: 192, cellHeight: 208 });
  assert.deepEqual(first.manifest.rows.map((row) => row.frameCount), [6, 8, 8, 4, 5, 8, 6, 6, 6]);
  assert.equal(first.atlas.occupiedCells, 57);
  assert.equal(first.atlas.transparentCells, 15);
  assert.equal(first.encoding.status, 'pending');
  assert.deepEqual(first.manifest, second.manifest);
  assert.equal(crypto.createHash('sha256').update(first.atlas.rgba).digest('hex'), crypto.createHash('sha256').update(second.atlas.rgba).digest('hex'));
});

test('cancels before work and blocks missing captures', async () => {
  await assert.rejects(
    () => buildCodexPet({ mapping: { mappings: mapping() }, candidatesByRow: candidatesByRow() }, { signal: { aborted: true } }),
    (error) => error instanceof PackageBuildError && error.code === 'BUILD_CANCELLED',
  );
  const candidates = candidatesByRow();
  delete candidates.idle[0].rgba;
  await assert.rejects(
    () => buildCodexPet({ mapping: { mappings: mapping() }, candidatesByRow: candidates }),
    (error) => error instanceof PackageBuildError && error.code === 'MISSING_FRAME_CAPTURE',
  );
});

test('encodes stacked RGBA frames through the injected WebP encoder contract', async () => {
  const calls = [];
  const fakeSharp = (input, options) => {
    calls.push({ input: Buffer.from(input), options });
    return {
      webp(webpOptions) {
        calls.push({ webpOptions });
        return { toBuffer: async () => ({ data: Buffer.from('RIFF-webp-fixture'), info: { pages: 2 } }) };
      },
    };
  };
  const frames = [0, 1].map((index) => ({ width: 2, height: 1, rgba: Uint8Array.from([index, 0, 0, 255, index, 1, 0, 255]) }));
  const encoded = await encodeAnimatedWebp({ frames, width: 2, height: 1, delay: [120, 180], loop: 0, quality: 82, alphaQuality: 97, lossless: true }, { sharpFactory: fakeSharp });
  assert.equal(encoded.format, 'webp');
  assert.equal(encoded.frameCount, 2);
  assert.deepEqual(encoded.delays, [120, 180]);
  assert.equal(encoded.buffer.toString(), 'RIFF-webp-fixture');
  assert.deepEqual(calls[0].options, { animated: true, raw: { width: 2, height: 2, channels: 4, pageHeight: 1 } });
  assert.deepEqual(calls[1].webpOptions, { quality: 82, alphaQuality: 97, lossless: true, loop: 0, delay: [120, 180] });
  assert.equal(calls[0].input.length, 16);
});

test('can encode and package a Codex atlas when explicitly requested', async () => {
  const events = [];
  const fakeSharp = (input, options) => ({
    webp() {
      assert.equal(options.animated, false);
      assert.deepEqual(options.raw, { width: 1536, height: 1872, channels: 4, pageHeight: 1872 });
      assert.equal(input.length, 1536 * 1872 * 4);
      return { toBuffer: async () => ({ data: Buffer.from('RIFF-codex-fixture'), info: { width: 1536, height: 1872 } }) };
    },
  });
  const result = await buildCodexPet({ mapping: { mappings: mapping() }, candidatesByRow: candidatesByRow() }, { package: true, sharpFactory: fakeSharp, onProgress: (event) => events.push(event) });
  assert.equal(result.encoding.status, 'completed');
  assert.equal(result.package.files.join(','), 'pet.json,spritesheet.webp');
  assert.deepEqual(events.map(({ stage, status }) => `${stage}:${status}`), ['select:started', 'select:completed', 'layout:started', 'layout:completed', 'compose:started', 'compose:completed', 'encode:started', 'encode:completed', 'manifest:started', 'manifest:completed', 'package:started', 'package:completed']);
  assert.deepEqual(result.manifest.assets.spritesheet, { path: 'spritesheet.webp', format: 'webp', width: 1536, height: 1872, frameCount: 1 });
});

test('creates a two-file ZIP that can be read back with zip.js', async () => {
  const zip = require('@zip.js/zip.js');
  const artifact = await createCodexPetZip({ manifest: { schemaVersion: 1, target: 'codex-pet' }, spritesheet: Uint8Array.from([0x52, 0x49, 0x46, 0x46]) });
  assert.equal(artifact.format, 'zip');
  const reader = new zip.ZipReader(new zip.Uint8ArrayReader(artifact.buffer));
  const entries = await reader.getEntries();
  assert.deepEqual(entries.map((entry) => entry.filename), ['pet.json', 'spritesheet.webp']);
  assert.equal(await entries[0].getData(new zip.TextWriter()), '{\n  "schemaVersion": 1,\n  "target": "codex-pet"\n}\n');
  assert.deepEqual(await entries[1].getData(new zip.Uint8ArrayWriter()), Uint8Array.from([0x52, 0x49, 0x46, 0x46]));
  await reader.close();
});

test('reports unavailable or malformed WebP encoder inputs with typed errors', async () => {
  await assert.rejects(
    () => encodeAnimatedWebp({ frames: [{ width: 2, height: 1, rgba: new Uint8Array(8) }], width: 2, height: 1 }, { sharpFactory: () => { throw new Error('missing sharp'); } }),
    (error) => error instanceof PackageBuildError && error.code === 'WEBP_ENCODER_FAILED',
  );
  await assert.rejects(
    () => encodeAnimatedWebp({ frames: [{ width: 2, height: 1, rgba: new Uint8Array(8) }], width: 2, height: 1 }, { sharpFactory: null }),
    (error) => error instanceof PackageBuildError && error.code === 'WEBP_ENCODER_UNAVAILABLE',
  );
  await assert.rejects(
    () => encodeAnimatedWebp({ frames: [], width: 2, height: 1 }, { sharpFactory: () => {} }),
    (error) => error instanceof PackageBuildError && error.code === 'INVALID_WEBP_INPUT',
  );
});

test('build outputs satisfy the target package validators with the real encoders', async () => {
  const codex = await buildCodexPet({ mapping: { mappings: mapping() }, candidatesByRow: candidatesByRow(), metadata: { id: 'validator-codex', displayName: 'Validator Codex', description: 'Synthetic validator pet.' } }, { package: true });
  const codexValidation = validateCodexPetPackage({ files: codex.package.files, manifest: codex.manifest, spritesheet: { bytes: codex.spritesheet } });
  assert.equal(codexValidation.ok, true);
  assert.equal(codexValidation.spritesheet.width, 1536);
  assert.equal(codexValidation.spritesheet.height, 1872);

  const clawd = await buildClawdTheme({ mapping: clawdMapping(), framesByMotion: clawdFrames(), metadata: { id: 'validator-clawd', name: 'Validator Clawd' } }, { package: true });
  const clawdValidation = validateClawdThemePackage({ themeId: clawd.themeId, manifest: clawd.manifest, assets: Object.fromEntries(clawd.assets.map((asset) => [asset.file, { byteLength: asset.byteLength }])), byteLength: clawd.package.byteLength });
  assert.equal(clawdValidation.ok, true);
  assert.equal(clawdValidation.assetCount, clawd.assets.length);
});

test('buildProjectTargets drives both target builders from one validated project', async () => {
  const project = createProject({
    projectId: 'multi-target',
    name: 'Multi-target fixture',
    source: { kind: 'standard-directory', name: 'fixture', fingerprint: 'sha256:fixture' },
    targets: {
      clawd: { profile: 'clawd', mappings: clawdMapping().states, reactions: clawdMapping().reactions, options: { sleepMode: 'direct' } },
      'codex-pet': { profile: 'codex-pet', mappings: mapping(), reactions: {}, options: {} },
    },
  });
  const events = [];
  const result = await buildProjectTargets({
    project,
    inputsByTarget: { clawd: { framesByMotion: clawdFrames() }, 'codex-pet': { candidatesByRow: candidatesByRow() } },
    optionsByTarget: { clawd: { sharpFactory: clawdSharpFactory() } },
    onProgress: (event) => events.push(`${event.target}:${event.stage}:${event.status}`),
  });
  assert.deepEqual(result.targets, ['clawd', 'codex-pet']);
  assert.equal(result.builds.clawd.target, 'clawd');
  assert.equal(result.builds['codex-pet'].target, 'codex-pet');
  assert.ok(events.includes('clawd:validate:completed'));
  assert.ok(events.includes('codex-pet:compose:completed'));
});

test('buildProjectTargets can render mapped Motions through the shared renderer contract', async () => {
  const renderer = new SyntheticRenderer();
  await renderer.load({ motions: [...new Set(['idle', 'thinking', 'working', 'error', 'attention', ...Object.values(mapping()).map((value) => value.slice(7))].map((id) => ({ id, duration: 0.2 }))) ] });
  const project = createProject({
    projectId: 'renderer-targets',
    name: 'Renderer targets',
    source: { kind: 'standard-directory', name: 'fixture', fingerprint: 'sha256:fixture' },
    targets: {
      clawd: { profile: 'clawd', mappings: clawdMapping().states, reactions: clawdMapping().reactions, options: { sleepMode: 'direct' } },
      'codex-pet': { profile: 'codex-pet', mappings: mapping(), reactions: {}, options: {} },
    },
  });
  const events = [];
  const result = await buildProjectTargets({
    project,
    inputsByTarget: {
      clawd: { renderer, render: { width: 2, height: 2, samples: 2 } },
      'codex-pet': { renderer, render: { width: 192, height: 208, samples: 8 } },
    },
    optionsByTarget: { clawd: { sharpFactory: clawdSharpFactory() } },
    onProgress: (event) => events.push(`${event.target}:${event.stage}:${event.status}`),
  });
  assert.equal(result.builds.clawd.assets.length, 5);
  assert.equal(Object.keys(result.builds['codex-pet'].selections).length, 9);
  assert.ok(events.includes('clawd:render:completed'));
  assert.ok(events.includes('codex-pet:render:completed'));
});

test('buildProjectTargets refuses a project with an unreviewed source change', async () => {
  const project = createProject({
    projectId: 'needs-review',
    name: 'Needs review',
    source: { kind: 'standard-directory', name: 'fixture', fingerprint: 'sha256:changed' },
    sourceReview: { required: true, reason: 'source-fingerprint-changed', affectedRecipeIds: ['recipe-1'] },
    recipes: [{ id: 'recipe-1', motionId: 'idle:0', expressionId: null }],
    targets: { clawd: { profile: 'clawd', mappings: clawdMapping().states, reactions: clawdMapping().reactions, options: {} } },
  });
  await assert.rejects(() => buildProjectTargets({ project, targets: ['clawd'], inputsByTarget: { clawd: { framesByMotion: clawdFrames() } }, optionsByTarget: { clawd: { sharpFactory: clawdSharpFactory() } } }), (error) => error instanceof ProjectValidationError && error.code === 'PROJECT_REVIEW_REQUIRED');
});
