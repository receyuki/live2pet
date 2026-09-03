const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');
const { deflateSync } = require('node:zlib');

const {
  CLAWD_PACKAGE_LIMIT,
  DEFAULT_CLAWD_ENCODING_CONCURRENCY,
  MAX_RGBA_CHUNK_BYTES,
  MAX_STACKED_RGBA_BYTES,
  AssetCacheError,
  CacheStore,
  PackageBuildError,
  TARGET_RENDER_PRESETS,
  buildClawdTheme,
  buildCodexPet,
  buildProjectTargets,
  buildProvenance,
  createArtifactFilename,
  createBuildReport,
  createClawdThemeZip,
  createClawdPreview,
  createCodexPreview,
  createTargetPreview,
  createCodexPetZip,
  decodeCompressedRgbaFrame,
  decodeCompressedRgbaStack,
  decodeCaptureSet,
  decodeAsset,
  encodeAnimatedWebp,
  encodeAsset,
  encodeCaptureSet,
  decodeFrameSet,
  encodeFrameSet,
  renderMappedMotions,
  resolveTargetRenderPreset,
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
      assert.deepEqual(webpOptions, { quality: 82, alphaQuality: 100, lossless: false, loop: 0, delay: [100, 100] });
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
  assert.equal(result.manifest.version, '1.0.0');
  assert.deepEqual(result.manifest.states.idle, ['demo-theme-idle.webp']);
  assert.deepEqual(result.manifest.states.sleeping, { fallbackTo: 'idle' });
  assert.deepEqual(result.manifest.reactions.drag, { file: 'demo-theme-error.webp' });
  assert.equal(result.assets.length, 5);
  assert.equal(result.encoding.assetCount, 5);
  assert.equal(result.validation.ok, true);
  assert.equal(result.provenance.renderPreset, 'balanced');
  assert.deepEqual(result.provenance.render, { width: 768, height: 768, fps: 24, quality: 82, alphaQuality: 100 });
  assert.equal(result.preview.source, 'generated-assets');
  assert.equal(result.preview.ready, true);
  assert.equal(result.artifactName, 'demo-theme-clawd-1.0.0.zip');
  assert.equal(result.package.artifactName, result.artifactName);
  assert.deepEqual(result.preview.states.sleeping.files, ['assets/demo-theme-idle.webp']);
  assert.deepEqual(result.report.validation, { ok: true, errorCount: 0, warningCount: 0 });
  assert.equal(result.report.output.package.byteLength, result.package.byteLength);
  assert.deepEqual(events.find((event) => event.stage === 'preview' && event.status === 'completed'), {
    stage: 'preview', status: 'completed', ready: true, missingStates: 0, missingReactions: 0,
  });
  assert.deepEqual(events.find((event) => event.stage === 'report' && event.status === 'completed'), {
    stage: 'report', status: 'completed', packageByteLength: result.package.byteLength, previewReady: true,
  });
  assert.deepEqual(events.filter(({ status }) => status === 'started' || status === 'completed').map(({ stage, status }) => `${stage}:${status}`), ['validate:started', 'validate:completed', 'encode:started', 'encode:completed', 'manifest:started', 'manifest:completed', 'preview:started', 'preview:completed', 'package:started', 'package:completed', 'report:started', 'report:completed']);
  const motionStarted = events.filter(({ stage, status }) => stage === 'encode' && status === 'motion-started');
  const motionCompleted = events.filter(({ stage, status }) => stage === 'encode' && status === 'motion-completed');
  assert.equal(DEFAULT_CLAWD_ENCODING_CONCURRENCY, 2);
  assert.deepEqual(motionStarted.map(({ motionId }) => motionId), ['idle', 'thinking', 'working', 'error', 'attention']);
  assert.deepEqual(motionCompleted.map(({ motionId }) => motionId).sort(), ['attention', 'error', 'idle', 'thinking', 'working']);
  assert.equal(events.at(-1).status, 'completed');
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

test('derives guide tier metadata and a dedicated roam behavior from mapped Motions', async () => {
  const mapping = clawdMapping();
  mapping.states = { ...mapping.states, juggling: 'motion:juggling', roam: 'motion:roam' };
  const frames = { ...clawdFrames(), ...Object.fromEntries(['juggling', 'roam'].map((motionId, motionIndex) => [motionId, {
    frames: [0, 1].map((index) => ({
      width: 2,
      height: 2,
      rgba: Uint8Array.from([motionIndex + 20, index, 0, 255, motionIndex + 20, index, 1, 255, motionIndex + 20, index, 2, 255, motionIndex + 20, index, 3, 255]),
    })),
    fps: 10,
  }])) };
  const result = await buildClawdTheme({ mapping, framesByMotion: frames, metadata: { id: 'tiered-theme', name: 'Tiered Theme' } }, { sharpFactory: clawdSharpFactory() });
  assert.deepEqual(result.manifest.workingTiers, [{ minSessions: 1, file: 'tiered-theme-working.webp' }]);
  assert.deepEqual(result.manifest.jugglingTiers, [{ minSessions: 1, file: 'tiered-theme-juggling.webp' }]);
  assert.equal(result.preview.behavior.roam.dedicated, true);
  assert.equal(result.preview.behavior.roam.artFacing, 'right');
  assert.deepEqual(result.preview.behavior.scenarios.working.steps[0].tier, { id: 'working-tier-1', minSessions: 1 });
  assert.deepEqual(result.preview.behavior.scenarios.juggling.steps[0].tier, { id: 'juggling-tier-1', minSessions: 1 });
  assert.equal(result.preview.ready, true);
});

test('converts project behavior Motion references into generated Clawd asset names', async () => {
  const result = await buildClawdTheme({
    mapping: clawdMapping(),
    framesByMotion: clawdFrames(),
    behavior: {
      idleAnimations: [{ motion: 'motion:attention', duration: 2400 }],
      workingTiers: [{ minSessions: 3, motion: 'motion:error' }, { minSessions: 1, motion: 'motion:working' }],
      jugglingTiers: [{ minSessions: 1, maxSessions: 2, motion: 'motion:attention' }],
      roamFlipAssets: true,
    },
    metadata: { id: 'configured-theme', name: 'Configured Theme' },
  }, { sharpFactory: clawdSharpFactory() });
  assert.deepEqual(result.manifest.idleAnimations, [{ file: 'configured-theme-attention.webp', duration: 2400 }]);
  assert.deepEqual(result.manifest.workingTiers, [
    { minSessions: 3, file: 'configured-theme-error.webp' },
    { minSessions: 1, file: 'configured-theme-working.webp' },
  ]);
  assert.deepEqual(result.manifest.jugglingTiers, [{ minSessions: 1, maxSessions: 2, file: 'configured-theme-attention.webp' }]);
  assert.equal(result.manifest.roamFlipAssets, true);
  assert.equal(result.preview.behavior.roam.flipAssets, true);
  assert.equal(result.preview.ready, true);
});

test('keeps derived Clawd tiers when a project carries an empty behavior configuration', async () => {
  const mapping = clawdMapping();
  mapping.states = { ...mapping.states, juggling: 'motion:juggling' };
  const frames = {
    ...clawdFrames(),
    juggling: {
      frames: [0, 1].map((index) => ({
        width: 2,
        height: 2,
        rgba: Uint8Array.from([25, index, 0, 255, 25, index, 1, 255, 25, index, 2, 255, 25, index, 3, 255]),
      })),
      fps: 10,
    },
  };
  const result = await buildClawdTheme({
    mapping,
    framesByMotion: frames,
    behavior: { idleAnimations: [], workingTiers: [], jugglingTiers: [], roamFlipAssets: false },
    metadata: { id: 'empty-behavior-theme', name: 'Empty Behavior Theme' },
  }, { sharpFactory: clawdSharpFactory() });
  assert.deepEqual(result.manifest.workingTiers, [{ minSessions: 1, file: 'empty-behavior-theme-working.webp' }]);
  assert.deepEqual(result.manifest.jugglingTiers, [{ minSessions: 1, file: 'empty-behavior-theme-juggling.webp' }]);
  assert.equal(Object.hasOwn(result.manifest, 'idleAnimations'), false);
});

test('buildProjectTargets forwards Clawd behavior configuration from target options', async () => {
  const project = createProject({
    projectId: 'behavior-project',
    appVersion: '0.1.0',
    name: 'Behavior project',
    source: { kind: 'standard-directory', name: 'fixture', fingerprint: 'sha256:behavior' },
    targets: {
      clawd: {
        profile: 'clawd',
        mappings: clawdMapping().states,
        reactions: clawdMapping().reactions,
        options: {
          sleepMode: 'direct',
          behavior: {
            idleAnimations: [{ motion: 'motion:attention', duration: 1600 }],
            workingTiers: [{ minSessions: 2, motion: 'motion:error' }],
            roamFlipAssets: true,
          },
        },
      },
    },
  });
  const result = await buildProjectTargets({ project, targets: ['clawd'], inputsByTarget: { clawd: { framesByMotion: clawdFrames() } }, optionsByTarget: { clawd: { sharpFactory: clawdSharpFactory() } } });
  assert.deepEqual(result.builds.clawd.manifest.idleAnimations, [{ file: 'behavior-project-attention.webp', duration: 1600 }]);
  assert.deepEqual(result.builds.clawd.manifest.workingTiers, [{ minSessions: 2, file: 'behavior-project-error.webp' }]);
  assert.equal(result.builds.clawd.manifest.roamFlipAssets, true);
});

test('builds Clawd themes from deflate-compressed RGBA frame transport', async () => {
  const rawFrames = clawdFrames();
  const compressedFrames = Object.fromEntries(Object.entries(rawFrames).map(([motionId, frameSet]) => [motionId, {
    ...frameSet,
    frames: frameSet.frames.map((frame) => ({
      width: frame.width,
      height: frame.height,
      rgbaDeflate: deflateSync(Buffer.from(frame.rgba)),
      compression: 'deflate',
    })),
  }]));
  const result = await buildClawdTheme(
    { mapping: clawdMapping(), framesByMotion: compressedFrames, metadata: { id: 'compressed-theme', name: 'Compressed Theme' } },
    { sharpFactory: clawdSharpFactory(), encodingConcurrency: 1 },
  );
  assert.equal(result.target, 'clawd');
  assert.equal(result.assets.length, 5);
  assert.equal(result.validation.ok, true);
  assert.deepEqual(result.assets.map((asset) => asset.motionId), Object.keys(rawFrames));
});

test('builds Clawd themes from bounded stacked RGBA capture chunks', async () => {
  const rawFrames = clawdFrames();
  const stacked = Object.fromEntries(Object.entries(rawFrames).map(([motionId, frameSet]) => {
    const bytes = Buffer.concat(frameSet.frames.map((frame) => Buffer.from(frame.rgba)));
    const first = frameSet.frames[0];
    return [motionId, {
      ...frameSet,
      frames: frameSet.frames.map((frame, index) => ({ width: frame.width, height: frame.height, id: `${motionId}-${index}`, index })),
      rgbaChunks: [{ startFrame: 0, frameCount: frameSet.frames.length, width: first.width, height: first.height, rgbaDeflate: deflateSync(bytes), compression: 'deflate-stack-v1' }],
    }];
  }));
  const result = await buildClawdTheme(
    { mapping: clawdMapping(), framesByMotion: stacked, metadata: { id: 'stacked-theme', name: 'Stacked Theme' } },
    { sharpFactory: clawdSharpFactory(), encodingConcurrency: 1 },
  );
  assert.equal(result.assets.length, 5);
  assert.equal(result.validation.ok, true);
  assert.ok(MAX_RGBA_CHUNK_BYTES > 0);
  const raw = Buffer.concat(rawFrames.idle.frames.map((frame) => Buffer.from(frame.rgba)));
  assert.deepEqual(await decodeCompressedRgbaStack({ width: 2, height: 2, frameCount: 2, rgbaDeflate: deflateSync(raw), compression: 'deflate-stack-v1' }), raw);
});

test('round-trips persistent capture cache envelopes without storing frame paths', () => {
  const frames = clawdFrames().idle.frames.map((frame, index) => ({ ...frame, id: `idle-${index}`, time: index / 10 }));
  const bytes = encodeCaptureSet({ motionId: 'idle', frames, fps: 10, delay: [100, 100] });
  const decoded = decodeCaptureSet(bytes);
  assert.equal(decoded.motionId, 'idle');
  assert.equal(decoded.frames.length, 2);
  assert.deepEqual(decoded.frames.map((frame) => Array.from(frame.rgba)), frames.map((frame) => Array.from(frame.rgba)));
  assert.deepEqual(decoded.delay, [100, 100]);
});

test('rejects capture cache payload ranges before inflating untrusted bytes', () => {
  const frames = clawdFrames().idle.frames.map((frame, index) => ({ ...frame, id: `idle-${index}` }));
  const bytes = encodeCaptureSet({ motionId: 'idle', frames });
  const headerLength = bytes.readUInt32LE(0);
  const metadata = JSON.parse(bytes.toString('utf8', 4, 4 + headerLength));
  metadata.chunks[0].offset = 1;
  const header = Buffer.from(JSON.stringify(metadata), 'utf8');
  const prefix = Buffer.allocUnsafe(4);
  prefix.writeUInt32LE(header.byteLength, 0);
  assert.throws(
    () => decodeCaptureSet(Buffer.concat([prefix, header, bytes.subarray(4 + headerLength)])),
    (error) => error.code === 'INVALID_CAPTURE_CACHE',
  );
});

test('rejects malformed or oversized deflate RGBA frames before WebP encoding', async () => {
  const frames = clawdFrames();
  frames.idle.frames[0] = {
    width: 2,
    height: 2,
    rgbaDeflate: deflateSync(Buffer.alloc(17)),
    compression: 'deflate',
  };
  await assert.rejects(
    () => buildClawdTheme({ mapping: clawdMapping(), framesByMotion: frames }, { sharpFactory: clawdSharpFactory(), encodingConcurrency: 1 }),
    (error) => error instanceof PackageBuildError && error.code === 'RGBA_FRAME_SIZE_MISMATCH',
  );
  const invalidCompression = clawdFrames();
  invalidCompression.idle.frames[0] = {
    width: 2,
    height: 2,
    rgbaDeflate: deflateSync(Buffer.alloc(16)),
    compression: 'deflate-raw',
  };
  await assert.rejects(
    () => buildClawdTheme({ mapping: clawdMapping(), framesByMotion: invalidCompression }, { sharpFactory: clawdSharpFactory(), encodingConcurrency: 1 }),
    (error) => error instanceof PackageBuildError && error.code === 'INVALID_RGBA_FRAME',
  );
  await assert.rejects(
    () => decodeCompressedRgbaFrame({ width: 2, height: 2, rgbaDeflate: Uint8Array.from([1, 2, 3]), compression: 'deflate' }),
    (error) => error instanceof PackageBuildError && error.code === 'RGBA_DECOMPRESSION_FAILED',
  );
  const signal = {
    aborted: false,
    addEventListener(_event, listener) { this.aborted = true; listener(); },
    removeEventListener() {},
  };
  await assert.rejects(
    () => decodeCompressedRgbaFrame({ width: 2, height: 2, rgbaDeflate: deflateSync(Buffer.alloc(16)), compression: 'deflate' }, { signal }),
    (error) => error instanceof PackageBuildError && error.code === 'BUILD_CANCELLED',
  );
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

test('encodes Clawd Motion assets with bounded concurrent workers and stable output order', async () => {
  const frames = clawdFrames();
  const motionIds = Object.keys(frames);
  const started = [];
  const completed = [];
  const events = [];
  let active = 0;
  let maxActive = 0;
  const sharpFactory = (input) => ({
    webp() {
      const motionIndex = input[0];
      started.push(motionIndex);
      active += 1;
      maxActive = Math.max(maxActive, active);
      return {
        toBuffer: async () => {
          await new Promise((resolve) => setTimeout(resolve, motionIndex === 0 ? 20 : 5));
          active -= 1;
          completed.push(motionIndex);
          return { data: Buffer.from(`RIFF-concurrent-${motionIndex}`), info: { width: 2, height: 2, pages: 2 } };
        },
      };
    },
  });

  const result = await buildClawdTheme(
    { mapping: clawdMapping(), framesByMotion: frames, metadata: { id: 'concurrent-theme', name: 'Concurrent Theme' } },
    { sharpFactory, encodingConcurrency: 2, onProgress: (event) => events.push(event) },
  );

  assert.equal(maxActive, 2);
  assert.deepEqual(started, [0, 1, 2, 3, 4]);
  assert.notDeepEqual(completed, started);
  assert.deepEqual(result.assets.map((asset) => asset.motionId), motionIds);
  assert.deepEqual(result.assets.map((asset) => asset.file), motionIds.map((motionId) => `concurrent-theme-${motionId}.webp`));
  const motionEvents = events.filter(({ stage, status }) => stage === 'encode' && ['motion-started', 'motion-completed'].includes(status));
  assert.equal(motionEvents.length, motionIds.length * 2);
  assert.equal(events.filter(({ stage, status }) => stage === 'encode' && status === 'motion-started').length, motionIds.length);
  assert.equal(events.filter(({ stage, status }) => stage === 'encode' && status === 'motion-completed').length, motionIds.length);
  assert.deepEqual(events.find(({ stage, status }) => stage === 'encode' && status === 'started'), { stage: 'encode', status: 'started', motions: motionIds.length, total: motionIds.length, concurrency: 2 });
  assert.equal(events.find(({ stage, status }) => stage === 'encode' && status === 'completed').concurrency, 2);
});

test('builds a deterministic Codex atlas handoff with progress stages', async () => {
  const events = [];
  const first = await buildCodexPet({ mapping: { mappings: mapping() }, candidatesByRow: candidatesByRow() }, { onProgress: (event) => events.push(event) });
  const second = await buildCodexPet({ mapping: { mappings: mapping() }, candidatesByRow: candidatesByRow() });
  assert.deepEqual(events.map(({ stage, status }) => `${stage}:${status}`), ['select:started', 'select:completed', 'layout:started', 'layout:completed', 'compose:started', 'compose:completed', 'manifest:started', 'manifest:completed', 'preview:started', 'preview:completed', 'report:started', 'report:completed']);
  assert.equal(first.target, 'codex-pet');
  assert.equal(first.manifest.version, '1.0.0');
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
  assert.equal(first.validation.ok, true);
  assert.equal(first.provenance.renderPreset, 'balanced');
  assert.equal(first.preview.source, 'generated-assets');
  assert.equal(first.preview.spritesheet.cellWidth, 192);
  assert.deepEqual(first.preview.frameSize, { width: 192, height: 208 });
  assert.deepEqual(first.preview.rows.find((row) => row.id === 'idle').frameSize, { width: 192, height: 208 });
  assert.equal(first.preview.rows.find((row) => row.id === 'idle').playback.finalSize, true);
  assert.equal(first.preview.rows.find((row) => row.id === 'running-right').frames[0].cell.x, 0);
  assert.equal(first.artifactName, 'live2pet-codex-pet-codex-pet-1.0.0.zip');
  assert.equal(first.report.output.package, null);
  assert.deepEqual(events.find((event) => event.stage === 'preview' && event.status === 'completed'), {
    stage: 'preview', status: 'completed', ready: true, rows: 9,
  });
  assert.deepEqual(events.find((event) => event.stage === 'report' && event.status === 'completed'), {
    stage: 'report', status: 'completed', packageByteLength: 0, previewReady: true,
  });
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

test('rejects an animation whose stacked RGBA buffer exceeds the bounded encoder budget', async () => {
  assert.equal(MAX_STACKED_RGBA_BYTES, 1024 * 1024 * 1024);
  const frames = Array.from({ length: 17 }, () => ({ width: 4096, height: 4096, rgba: new Uint8Array() }));
  await assert.rejects(
    () => encodeAnimatedWebp({ frames, width: 4096, height: 4096 }),
    (error) => error instanceof PackageBuildError && error.code === 'RGBA_ANIMATION_TOO_LARGE',
  );
});

test('encodes and validates the bounded WebP asset cache envelope', () => {
  const bytes = encodeAsset({ format: 'webp', width: 2, height: 3, bytes: Uint8Array.from([1, 2, 3]) });
  const decoded = decodeAsset(bytes);
  assert.deepEqual({ format: decoded.format, width: decoded.width, height: decoded.height, frameCount: decoded.frameCount, delays: decoded.delays }, { format: 'webp', width: 2, height: 3, frameCount: 1, delays: [100] });
  assert.deepEqual(decoded.bytes, Buffer.from([1, 2, 3]));
  assert.throws(() => decodeAsset(bytes.subarray(0, 4)), (error) => error instanceof AssetCacheError && error.code === 'INVALID_ASSET_CACHE');
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
  assert.equal(result.package.artifactName, result.artifactName);
  assert.deepEqual(events.map(({ stage, status }) => `${stage}:${status}`), ['select:started', 'select:completed', 'layout:started', 'layout:completed', 'compose:started', 'compose:completed', 'encode:started', 'encode:completed', 'manifest:started', 'manifest:completed', 'preview:started', 'preview:completed', 'package:started', 'package:completed', 'report:started', 'report:completed']);
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
  assert.equal(result.builds.clawd.provenance.renderPreset, 'balanced');
  assert.equal(result.builds['codex-pet'].provenance.renderPreset, 'balanced');
  assert.equal(result.builds.clawd.report.projectId, 'multi-target');
  assert.equal(result.builds.clawd.report.sourceKind, 'standard-directory');
  assert.equal(JSON.stringify(result.builds.clawd.report).includes('/private/'), false);
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

test('buildProjectTargets applies project Animation Recipe Expressions during capture', async () => {
  const renderer = new SyntheticRenderer();
  await renderer.load({
    motions: ['idle', 'thinking', 'working', 'error', 'attention'].map((id) => ({ id, duration: 0.1 })),
    expressions: [{ id: 'smile', name: 'Smile' }],
  });
  const expressionCalls = [];
  const setExpression = renderer.setExpression.bind(renderer);
  renderer.setExpression = async (id) => { expressionCalls.push(id); return setExpression(id); };
  const project = createProject({
    projectId: 'recipe-target',
    name: 'Recipe target',
    source: { kind: 'standard-directory', name: 'fixture', fingerprint: 'sha256:fixture' },
    recipes: [{ id: 'idle-smile', motionId: 'idle', expressionId: 'smile' }],
    targets: {
      clawd: { profile: 'clawd', mappings: clawdMapping().states, reactions: clawdMapping().reactions, recipeMappings: { idle: 'idle-smile' }, options: { sleepMode: 'direct' } },
    },
  });
  const result = await buildProjectTargets({
    project,
    targets: ['clawd'],
    inputsByTarget: { clawd: { renderer, render: { width: 2, height: 2, samples: 2, fps: 10 } } },
    optionsByTarget: { clawd: { sharpFactory: clawdSharpFactory() } },
  });
  assert.equal(result.builds.clawd.target, 'clawd');
  assert.equal(expressionCalls[0], 'smile');
  assert.equal(expressionCalls[1], null);
  assert.equal(renderer.getState().expressionId, null);
});

test('buildProjectTargets rejects conflicting Expressions for one Motion', async () => {
  const project = createProject({
    projectId: 'recipe-conflict',
    name: 'Recipe conflict',
    source: { kind: 'standard-directory', name: 'fixture', fingerprint: 'sha256:fixture' },
    recipes: [
      { id: 'idle-smile', motionId: 'idle', expressionId: 'smile' },
      { id: 'idle-frown', motionId: 'idle', expressionId: 'frown' },
    ],
    targets: {
      clawd: {
        profile: 'clawd',
        mappings: clawdMapping().states,
        reactions: { drag: 'motion:idle' },
        recipeMappings: { idle: 'idle-smile', drag: 'idle-frown' },
        options: { sleepMode: 'direct' },
      },
    },
  });
  await assert.rejects(
    () => buildProjectTargets({ project, targets: ['clawd'], inputsByTarget: { clawd: { framesByMotion: clawdFrames() } }, optionsByTarget: { clawd: { sharpFactory: clawdSharpFactory() } } }),
    (error) => error instanceof PackageBuildError && error.code === 'CONFLICTING_RECIPE_EXPRESSIONS',
  );
});

test('renderer capture uses named target Render Presets', async () => {
  const renderer = new SyntheticRenderer();
  await renderer.load({ motions: [{ id: 'idle', duration: 0.1 }] });
  const result = await renderMappedMotions({ renderer, motionIds: ['idle'], render: { preset: 'compact' }, target: 'codex-pet' });
  assert.deepEqual(TARGET_RENDER_PRESETS['codex-pet'].compact, { width: 192, height: 208, samplesPerSecond: 32 });
  assert.equal(result.idle.frames.length, 4);
  assert.equal(result.idle.frames[0].width, 192);
  assert.equal(result.idle.frames[0].height, 208);
  await assert.rejects(
    () => renderMappedMotions({ renderer, motionIds: ['idle'], render: { preset: 'unknown' }, target: 'codex-pet' }),
    (error) => error instanceof PackageBuildError && error.code === 'INVALID_RENDER_PRESET',
  );
});

test('renderer capture applies the Expression selected by an Animation Recipe', async () => {
  const renderer = new SyntheticRenderer();
  await renderer.load({ motions: [{ id: 'idle', duration: 0.1 }], expressions: [{ id: 'smile' }] });
  const expressionCalls = [];
  const setExpression = renderer.setExpression.bind(renderer);
  renderer.setExpression = async (id) => { expressionCalls.push(id); return setExpression(id); };
  const result = await renderMappedMotions({ renderer, motionIds: ['idle'], expressionByMotion: { idle: 'smile' }, render: { preset: 'compact' }, target: 'codex-pet' });
  assert.equal(result.idle.expressionId, 'smile');
  assert.deepEqual(expressionCalls, ['smile', null]);
  assert.equal(renderer.getState().expressionId, null);
});

test('render candidate cache preserves the Animation Recipe Expression on a hit', async () => {
  const renderer = new SyntheticRenderer();
  await renderer.load({ motions: [{ id: 'idle', duration: 0.1 }], expressions: [{ id: 'smile' }] });
  let captureCount = 0;
  const capture = renderer.captureRgba.bind(renderer);
  renderer.captureRgba = (options) => { captureCount += 1; return capture(options); };
  const cache = new CacheStore({ rootDir: require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'live2pet-recipe-render-cache-')) });
  const cacheContext = { projectId: 'recipe-render-cache', sourceFingerprint: 'source-sha256', runtimeVersion: 'core-5', rendererVersion: 'renderer-1', targetVersion: '1' };
  const first = await renderMappedMotions({ renderer, motionIds: ['idle'], expressionByMotion: { idle: 'smile' }, target: 'codex-pet', render: { preset: 'compact' }, cache, cacheContext });
  const firstCaptureCount = captureCount;
  const second = await renderMappedMotions({ renderer, motionIds: ['idle'], expressionByMotion: { idle: 'smile' }, target: 'codex-pet', render: { preset: 'compact' }, cache, cacheContext });
  assert.equal(second.idle.expressionId, 'smile');
  assert.deepEqual(second.idle.frames.map((frame) => frame.id), first.idle.frames.map((frame) => frame.id));
  assert.equal(captureCount, firstCaptureCount);
});

test('reuses verified render candidates only with a complete cache identity', async () => {
  const renderer = new SyntheticRenderer();
  await renderer.load({ motions: [{ id: 'idle', duration: 0.1 }] });
  let captureCount = 0;
  const capture = renderer.captureRgba.bind(renderer);
  renderer.captureRgba = (options) => {
    captureCount += 1;
    return capture(options);
  };
  const cache = new CacheStore({ rootDir: require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'live2pet-render-cache-')) });
  const cacheContext = { projectId: 'cache-project', sourceFingerprint: 'source-sha256', runtimeVersion: 'core-5', rendererVersion: 'renderer-1', targetVersion: '1' };
  const first = await renderMappedMotions({ renderer, motionIds: ['idle'], target: 'codex-pet', render: { preset: 'compact' }, cache, cacheContext });
  const firstCaptureCount = captureCount;
  const second = await renderMappedMotions({ renderer, motionIds: ['idle'], target: 'codex-pet', render: { preset: 'compact' }, cache, cacheContext });
  assert.equal(captureCount, firstCaptureCount);
  assert.deepEqual(second.idle.frames.map((frame) => frame.id), first.idle.frames.map((frame) => frame.id));
  assert.equal(cache.status({ projectId: 'cache-project' }).entryCount, 1);
  await renderMappedMotions({ renderer, motionIds: ['idle'], target: 'codex-pet', render: { preset: 'high' }, cache, cacheContext });
  assert.ok(captureCount > firstCaptureCount);
  assert.equal(cache.status({ projectId: 'cache-project' }).entryCount, 2);
  const changedSizeCount = captureCount;
  await renderMappedMotions({ renderer, motionIds: ['idle'], target: 'codex-pet', render: { preset: 'compact', width: 128, height: 128 }, cache, cacheContext });
  assert.ok(captureCount > changedSizeCount);
  assert.equal(cache.status({ projectId: 'cache-project' }).entryCount, 3);
  const encoded = encodeFrameSet({ motionId: 'idle', ...first.idle });
  const decoded = decodeFrameSet(encoded);
  assert.equal(decoded.frames[0].rgba.byteLength, first.idle.frames[0].rgba.byteLength);
});

test('reuses encoded Clawd assets only with a complete cache identity', async () => {
  const cache = new CacheStore({ rootDir: require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'live2pet-encoded-clawd-cache-')) });
  const cacheContext = { projectId: 'encoded-clawd', sourceFingerprint: 'source-sha256', runtimeVersion: 'core-5', rendererVersion: 'renderer-1', encoderVersion: 'sharp-0.34.5' };
  let calls = 0;
  const sharpFactory = () => ({ webp() { calls += 1; return { toBuffer: async () => ({ data: Buffer.from(`RIFF-clawd-${calls}`), info: { width: 2, height: 2, pages: 2 } }) }; } });
  const first = await buildClawdTheme({ mapping: clawdMapping(), framesByMotion: clawdFrames() }, { cache, cacheContext, sharpFactory });
  assert.equal(first.cache.misses, 5);
  assert.equal(first.provenance.encoder.version, 'sharp-0.34.5');
  assert.deepEqual(first.report.cache, { enabled: true, hits: 0, misses: 5 });
  const second = await buildClawdTheme({ mapping: clawdMapping(), framesByMotion: clawdFrames() }, { cache, cacheContext, sharpFactory: () => { throw new Error('encoded cache miss'); } });
  assert.equal(second.cache.hits, 5);
  assert.equal(calls, 5);
  assert.equal(cache.status({ projectId: 'encoded-clawd' }).entryCount, 5);
});

test('reuses the encoded Codex atlas when frame selections and encoder settings match', async () => {
  const cache = new CacheStore({ rootDir: require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'live2pet-encoded-codex-cache-')) });
  const cacheContext = { projectId: 'encoded-codex', sourceFingerprint: 'source-sha256', runtimeVersion: 'core-5', rendererVersion: 'renderer-1', encoderVersion: 'sharp-0.34.5' };
  let calls = 0;
  const sharpFactory = () => ({ webp() { calls += 1; return { toBuffer: async () => ({ data: Buffer.from(`RIFF-codex-${calls}`), info: { width: 1536, height: 1872 } }) }; } });
  const first = await buildCodexPet({ mapping: { mappings: mapping() }, candidatesByRow: candidatesByRow() }, { encode: true, cache, cacheContext, sharpFactory });
  assert.equal(first.cache.misses, 1);
  assert.equal(first.provenance.encoder.version, 'sharp-0.34.5');
  const second = await buildCodexPet({ mapping: { mappings: mapping() }, candidatesByRow: candidatesByRow() }, { encode: true, cache, cacheContext, sharpFactory: () => { throw new Error('encoded cache miss'); } });
  assert.equal(second.cache.hits, 1);
  assert.equal(calls, 1);
  const changedEncoder = await buildCodexPet({ mapping: { mappings: mapping() }, candidatesByRow: candidatesByRow() }, { encode: true, cache, cacheContext: { ...cacheContext, encoderVersion: 'sharp-0.35.0' }, sharpFactory });
  assert.equal(changedEncoder.cache.misses, 1);
  assert.equal(calls, 2);
  assert.equal(cache.status({ projectId: 'encoded-codex' }).entryCount, 2);
});

test('a cancelled Codex WebP encode does not leave a partial cache entry', async () => {
  const cache = new CacheStore({ rootDir: require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'live2pet-cancelled-codex-cache-')) });
  const cacheContext = { projectId: 'cancelled-codex', sourceFingerprint: 'source-sha256', runtimeVersion: 'core-5', rendererVersion: 'renderer-1', encoderVersion: 'sharp-0.34.5' };
  const controller = new AbortController();
  const sharpFactory = () => ({
    webp() {
      return {
        toBuffer: async () => {
          controller.abort();
          return { data: Buffer.from('RIFF-cancelled'), info: { width: 1536, height: 1872 } };
        },
      };
    },
  });

  await assert.rejects(
    () => buildCodexPet({ mapping: { mappings: mapping() }, candidatesByRow: candidatesByRow() }, { encode: true, cache, cacheContext, sharpFactory, signal: controller.signal }),
    (error) => error instanceof PackageBuildError && error.code === 'BUILD_CANCELLED',
  );
  assert.equal(cache.status({ projectId: 'cancelled-codex' }).entryCount, 0);
});

test('target Render Preset controls Clawd WebP quality and provenance stays path-free', async () => {
  const calls = [];
  const sharpFactory = (input, options) => ({
    webp(webpOptions) {
      calls.push({ input, options, webpOptions });
      return { toBuffer: async () => ({ data: Buffer.from('RIFF-compact'), info: { width: 2, height: 2, pages: 2 } }) };
    },
  });
  const result = await buildClawdTheme({ mapping: clawdMapping(), framesByMotion: clawdFrames() }, { renderPreset: 'compact', sharpFactory });
  assert.equal(calls.length, 5);
  assert.equal(calls[0].webpOptions.quality, 76);
  assert.equal(calls[0].webpOptions.alphaQuality, 100);
  assert.deepEqual(result.provenance, {
    schemaVersion: 1,
    buildContractVersion: 1,
    targetProfile: 'clawd',
    targetContractVersion: 1,
    renderPreset: 'compact',
    render: { width: 512, height: 512, fps: 18, quality: 76, alphaQuality: 100 },
    encoder: { name: 'sharp', format: 'webp' },
  });
  assert.equal(JSON.stringify(result.provenance).includes('/'), false);
  assert.deepEqual(resolveTargetRenderPreset('codex-pet', { preset: 'HIGH' }), { name: 'high', settings: { width: 192, height: 208, samplesPerSecond: 96 } });
  assert.deepEqual(buildProvenance('codex-pet', 1, { preset: 'compact' }).render, { width: 192, height: 208, samplesPerSecond: 32 });
});

test('artifact filenames carry safe package id, target, and semantic version', () => {
  assert.equal(createArtifactFilename({ packageId: 'Vicious-Khepri', target: 'clawd', version: '1.2.3-beta.1' }), 'Vicious-Khepri-clawd-1.2.3-beta.1.zip');
  assert.throws(() => createArtifactFilename({ packageId: '../unsafe', target: 'clawd', version: '1.0.0' }), (error) => error instanceof PackageBuildError && error.code === 'INVALID_ARTIFACT_NAME');
  assert.throws(() => createArtifactFilename({ packageId: 'safe', target: 'clawd', version: 'v1.0.0' }), (error) => error instanceof PackageBuildError && error.code === 'INVALID_ARTIFACT_NAME');
});

test('target previews reject malformed generated output and dispatch by target', async () => {
  assert.throws(
    () => createCodexPreview({ manifest: { atlas: { ...{ ...require('../../codex-target/src/index.cjs').ATLAS, width: 1 } }, rows: [] } }),
    (error) => error.code === 'INVALID_TARGET_PREVIEW',
  );
  const clawd = { target: 'clawd', manifest: { states: { idle: ['idle.webp'], thinking: ['idle.webp'], working: ['idle.webp'], sleeping: { fallbackTo: 'idle' } }, reactions: {} }, assets: [{ file: 'idle.webp', frameCount: 2 }] };
  assert.deepEqual(createTargetPreview(clawd).states.sleeping.chain, ['sleeping', 'idle']);
  assert.equal(createClawdPreview({ manifest: clawd.manifest, assets: clawd.assets }).ready, true);
});

test('Clawd generated previews expose a deterministic behavior plan', () => {
  const manifest = {
    states: {
      idle: ['idle.webp'],
      thinking: ['thinking.webp'],
      working: ['working.webp'],
      sleeping: { fallbackTo: 'idle' },
      yawning: ['yawning.webp'],
      dozing: ['dozing.webp'],
      collapsing: ['collapsing.webp'],
      waking: ['waking.webp'],
      error: { fallbackTo: 'thinking' },
      attention: ['attention.webp'],
    },
    sleepSequence: { mode: 'full' },
    timings: {
      yawnDuration: 1234,
      wakeDuration: 567,
      minDisplay: { attention: 3210 },
      autoReturn: { attention: 6543 },
    },
    idleAnimations: [{ file: 'idle-look.webp', duration: 4444 }],
    reactions: {
      drag: { file: 'drag.webp', fileLeft: 'drag-left.webp' },
      clickLeft: { file: 'click.webp', duration: 2222 },
      double: { files: ['double.webp'], duration: 3333 },
    },
  };
  const assets = [
    'idle', 'thinking', 'working', 'yawning', 'dozing', 'collapsing', 'waking', 'attention',
    'idle-look', 'drag', 'drag-left', 'click', 'double',
  ].map((name) => ({ file: `${name}.webp`, frameCount: 2, delays: [100, 150] }));
  const preview = createClawdPreview({ manifest, assets });
  assert.equal(preview.ready, true);
  assert.deepEqual(preview.behavior.sleepSequence.enter.map((step) => step.logicalState), ['yawning', 'dozing', 'collapsing', 'sleeping']);
  assert.deepEqual(preview.behavior.states.sleeping.fallbackChain, ['sleeping', 'idle']);
  assert.equal(preview.behavior.states.sleeping.resolvedState, 'idle');
  assert.equal(preview.behavior.states.sleeping.visualState, 'idle');
  assert.equal(preview.behavior.sleepSequence.enter.at(-1).durationMs, null);
  assert.equal(preview.behavior.states.attention.minDisplayMs, 3210);
  assert.equal(preview.behavior.states.attention.autoReturnMs, 6543);
  assert.equal(preview.behavior.sleepSequence.enter[0].durationMs, 1234);
  assert.equal(preview.behavior.sleepSequence.wake.durationMs, 567);
  assert.deepEqual(preview.behavior.reactions.drag.files, {
    default: 'assets/drag.webp',
    left: 'assets/drag-left.webp',
    right: 'assets/drag.webp',
  });
  assert.equal(preview.behavior.reactions.drag.loop, true);
  assert.equal(preview.behavior.reactions.clickLeft.durationMs, 2222);
  assert.equal(preview.behavior.reactions.double.durationMs, 3333);
  assert.equal(preview.behavior.idlePool[0].durationMs, 4444);
  assert.deepEqual(preview.behavior.scenarios.sleep.steps.map((step) => step.logicalState), ['yawning', 'dozing', 'collapsing', 'sleeping']);
  assert.deepEqual(preview.behavior.scenarios.wake.steps.map((step) => step.logicalState), ['waking']);
});

test('build reports stay concise and never include RGBA buffers or source paths', async () => {
  const build = { target: 'codex-pet', buildContractVersion: 1, targetContractVersion: 1, provenance: { renderPreset: 'balanced' }, encoding: { status: 'pending' }, package: null, preview: { target: 'codex-pet', source: 'generated-assets', ready: true }, warnings: [], validation: { ok: true, errors: [], warnings: [] }, atlas: { rgba: new Uint8Array([1, 2, 3]) } };
  const report = createBuildReport({ build, projectId: 'demo', source: { kind: 'standard-directory', path: '/private/model', fingerprint: 'not-a-hash' } });
  assert.equal(report.projectId, 'demo');
  assert.equal(report.sourceKind, 'standard-directory');
  assert.equal(Object.hasOwn(report, 'sourceFingerprint'), false);
  assert.equal(JSON.stringify(report).includes('rgba'), false);
  assert.equal(JSON.stringify(report).includes('/private/'), false);
});

test('project target Render Presets flow into capture and provenance', async () => {
  const renderer = new SyntheticRenderer();
  const motionIds = [...new Set(['idle', 'thinking', 'working', 'error', 'attention', ...Object.values(mapping()).map((value) => value.slice(7))])];
  await renderer.load({ motions: motionIds.map((id) => ({ id, duration: 0.1 })) });
  const project = createProject({
    projectId: 'preset-project',
    name: 'Preset project',
    source: { kind: 'standard-directory', name: 'fixture', fingerprint: 'sha256:fixture' },
    targets: {
      clawd: { profile: 'clawd', renderPreset: 'compact', mappings: clawdMapping().states, reactions: clawdMapping().reactions, options: { sleepMode: 'direct' } },
      'codex-pet': { profile: 'codex-pet', renderPreset: 'high', mappings: mapping(), reactions: {}, options: {} },
    },
  });
  const result = await buildProjectTargets({ project, inputsByTarget: { clawd: { renderer }, 'codex-pet': { renderer } } });
  assert.equal(project.targets.clawd.renderPreset, 'compact');
  assert.equal(project.targets['codex-pet'].renderPreset, 'high');
  assert.equal(result.builds.clawd.provenance.renderPreset, 'compact');
  assert.equal(result.builds['codex-pet'].provenance.renderPreset, 'high');
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
