const assert = require('node:assert/strict');
const test = require('node:test');

const {
  CodexValidationError,
  assertValidCodexPetPackage,
  composeCodexAtlasRgba,
  createCodexAtlasPlan,
  createCodexTarget,
  selectCodexFrameSets,
  validateAtlasGeometry,
  validateCodexMapping,
  validateCodexPetPackage,
} = require('../src/index.cjs');

function mapping() {
  return {
    mappings: {
      idle: 'motion:idle',
      'running-right': 'motion:running-right',
      'running-left': 'motion:running-left',
      waving: 'motion:waving',
      jumping: 'motion:jumping',
      failed: 'motion:failed',
      waiting: 'motion:waiting',
      running: 'motion:running',
      review: 'motion:review',
    },
  };
}

function selectedFrames() {
  return Object.fromEntries([
    ['idle', 6],
    ['running-right', 8],
    ['running-left', 8],
    ['waving', 4],
    ['jumping', 5],
    ['failed', 8],
    ['waiting', 6],
    ['running', 6],
    ['review', 6],
  ].map(([id, count]) => [id, Array.from({ length: count }, (_, index) => ({ id: `${id}-${index}`, index, time: index / 10 }))]));
}

function frameCandidates() {
  return Object.fromEntries([
    ['idle', 6],
    ['running-right', 8],
    ['running-left', 8],
    ['waving', 4],
    ['jumping', 5],
    ['failed', 8],
    ['waiting', 6],
    ['running', 6],
    ['review', 6],
  ].map(([id, count]) => [id, Array.from({ length: count + (id === 'idle' ? 1 : 0) }, (_, index) => ({ id: `${id}-candidate-${index}`, time: index / 10, visualChange: index === 1 ? 0.001 : index / 10 }))]));
}

function makeVp8xWebp({ width = 1536, height = 1872, animated = false } = {}) {
  const chunk = Buffer.alloc(18);
  chunk.write('VP8X', 0, 'ascii');
  chunk.writeUInt32LE(10, 4);
  chunk[8] = animated ? 0x02 : 0x00;
  const widthMinusOne = width - 1;
  const heightMinusOne = height - 1;
  chunk[12] = widthMinusOne & 0xff;
  chunk[13] = (widthMinusOne >> 8) & 0xff;
  chunk[14] = (widthMinusOne >> 16) & 0xff;
  chunk[15] = heightMinusOne & 0xff;
  chunk[16] = (heightMinusOne >> 8) & 0xff;
  chunk[17] = (heightMinusOne >> 16) & 0xff;
  const riff = Buffer.alloc(12);
  riff.write('RIFF', 0, 'ascii');
  riff.writeUInt32LE(4 + chunk.length, 4);
  riff.write('WEBP', 8, 'ascii');
  return Buffer.concat([riff, chunk]);
}

test('validates the official V1 atlas and all nine direct Motion mappings', () => {
  const result = validateCodexMapping(mapping());
  assert.equal(result.ok, true);
  assert.deepEqual(result.atlas, { width: 1536, height: 1872, columns: 8, rows: 9, cellWidth: 192, cellHeight: 208 });
  assert.deepEqual(result.rows.map((row) => row.frames), [6, 8, 8, 4, 5, 8, 6, 6, 6]);
  assert.deepEqual(createCodexTarget(mapping()).packageFiles, ['pet.json', 'spritesheet.webp']);
});

test('requires directional rows to be mapped separately and rejects fallback', () => {
  const input = mapping();
  input.mappings['running-left'] = 'fallback:running-right';
  const result = validateCodexMapping(input);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.code === 'INVALID_CODEX_MAPPING'));
  assert.throws(
    () => createCodexTarget(input),
    (error) => error instanceof CodexValidationError && error.code === 'INVALID_CODEX_MAPPING',
  );
});

test('reports missing rows and invalid geometry', () => {
  const result = validateCodexMapping({ mappings: { idle: 'motion:idle' }, atlas: { width: 100 } });
  assert.equal(result.ok, false);
  assert.equal(result.errors.filter((error) => error.code === 'REQUIRED_CODEX_SLOT_UNMAPPED').length, 8);
  assert.ok(result.errors.some((error) => error.code === 'INVALID_ATLAS_GEOMETRY'));
  assert.equal(validateAtlasGeometry().ok, true);
});

test('creates a fixed atlas plan with transparent unused cells', () => {
  const plan = createCodexAtlasPlan({ ...mapping(), framesByRow: selectedFrames() });
  assert.deepEqual(plan.atlas, { width: 1536, height: 1872, columns: 8, rows: 9, cellWidth: 192, cellHeight: 208 });
  assert.equal(plan.cells.length, 72);
  assert.deepEqual(plan.rows.map((row) => row.cells.filter((cell) => !cell.transparent).length), [6, 8, 8, 4, 5, 8, 6, 6, 6]);
  assert.deepEqual(plan.rows[0].cells.at(-1), { row: 0, column: 7, x: 1344, y: 0, width: 192, height: 208, transparent: true, frame: null });
  assert.equal(plan.rows[8].cells[5].frame.id, 'review-5');
});

test('rejects incomplete or malformed frame sets before rendering', () => {
  const frames = selectedFrames();
  frames.idle = frames.idle.slice(0, 5);
  assert.throws(
    () => createCodexAtlasPlan({ ...mapping(), framesByRow: frames }),
    (error) => error instanceof CodexValidationError && error.code === 'INVALID_CODEX_FRAME_SET',
  );
  const malformed = selectedFrames();
  malformed.waving[0] = { index: 0 };
  assert.throws(
    () => createCodexAtlasPlan({ ...mapping(), framesByRow: malformed }),
    (error) => error instanceof CodexValidationError && error.code === 'INVALID_CODEX_FRAME_SET',
  );
});

test('selects target-sized frame sets that feed the atlas plan', () => {
  const selection = selectCodexFrameSets({ ...mapping(), candidatesByRow: frameCandidates() });
  assert.equal(selection.selections.idle.requestedCount, 6);
  assert.equal(selection.frameSets.idle.length, 6);
  assert.equal(selection.frameSets['running-left'].length, 8);
  const plan = createCodexAtlasPlan({ ...mapping(), framesByRow: selection.frameSets });
  assert.equal(plan.cells.filter((cell) => cell.transparent).length, 15);
  assert.equal(plan.rows[0].frames[0].id, 'idle-candidate-0');
});

test('composes RGBA captures into the fixed atlas without touching transparent cells', () => {
  const plan = createCodexAtlasPlan({ ...mapping(), framesByRow: selectedFrames() });
  const captures = {};
  for (const row of plan.rows) for (const frame of row.frames) {
    const rgba = new Uint8Array(192 * 208 * 4);
    rgba.fill((frame.id.length * 7) % 255);
    rgba[3] = 255;
    captures[frame.id] = { width: 192, height: 208, rgba };
  }
  const atlas = composeCodexAtlasRgba(plan, captures);
  assert.deepEqual({ width: atlas.width, height: atlas.height, occupiedCells: atlas.occupiedCells, transparentCells: atlas.transparentCells }, { width: 1536, height: 1872, occupiedCells: 57, transparentCells: 15 });
  const occupiedOffset = 0;
  const emptyOffset = ((0 * 1536 + 7 * 192) * 4) + 3;
  assert.equal(atlas.rgba[occupiedOffset], ('idle-0'.length * 7) % 255);
  assert.equal(atlas.rgba[occupiedOffset + 3], 255);
  assert.equal(atlas.rgba[emptyOffset], 0);
  assert.equal(atlas.rgba[emptyOffset + 3], 0);
});

test('rejects missing or incorrectly sized RGBA captures', () => {
  const plan = createCodexAtlasPlan({ ...mapping(), framesByRow: selectedFrames() });
  assert.throws(
    () => composeCodexAtlasRgba(plan, {}),
    (error) => error instanceof CodexValidationError && error.code === 'INVALID_CODEX_CAPTURE',
  );
  const captures = { 'idle-0': { width: 1, height: 1, rgba: new Uint8Array(4) } };
  assert.throws(
    () => composeCodexAtlasRgba(plan, captures),
    (error) => error instanceof CodexValidationError && error.code === 'INVALID_CODEX_CAPTURE',
  );
});

test('validates an official V1 Codex Pet Package from manifest object and WEBP bytes', () => {
  const result = validateCodexPetPackage({
    files: ['pet.json', 'spritesheet.webp'],
    manifest: {
      id: 'saint-louis',
      displayName: 'Saint Louis',
      description: 'A holy knight who keeps watch over Codex.',
      spritesheetPath: 'spritesheet.webp',
    },
    spritesheet: {
      path: 'spritesheet.webp',
      bytes: makeVp8xWebp(),
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.errors.length, 0);
  assert.deepEqual(result.packageFiles, ['pet.json', 'spritesheet.webp']);
  assert.equal(result.spritesheet.width, 1536);
  assert.equal(result.spritesheet.height, 1872);
  assert.equal(result.spritesheet.frameCount, 1);
  assert.equal(result.spritesheet.byteLength, 30);
});

test('accepts manifest JSON text and metadata-only spritesheet validation', () => {
  const result = validateCodexPetPackage({
    manifest: JSON.stringify({
      id: 'vicious-khepri',
      displayName: 'Vicious Khepri',
      description: 'A vigilant insectoid companion.',
      spritesheetPath: 'spritesheet.webp',
    }),
    spritesheet: {
      format: 'webp',
      width: 1536,
      height: 1872,
      frameCount: 1,
      byteLength: 4096,
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.manifest.id, 'vicious-khepri');
  assert.equal(result.spritesheet.format, 'webp');
  assert.equal(result.spritesheet.byteLength, 4096);
});

test('rejects invalid manifest fields, missing files, and wrong spritesheet path', () => {
  const result = validateCodexPetPackage({
    files: ['pet.json', 'notes.txt'],
    manifest: {
      id: 'bad pet',
      displayName: '',
      description: '',
      spritesheetPath: 'atlas.webp',
    },
    spritesheet: {
      path: 'atlas.webp',
      format: 'png',
      width: 1536,
      height: 1872,
      frameCount: 2,
      byteLength: 10,
    },
  });

  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.code === 'MISSING_PACKAGE_FILE'));
  assert.ok(result.errors.some((error) => error.code === 'UNEXPECTED_PACKAGE_FILE'));
  assert.ok(result.errors.some((error) => error.code === 'INVALID_PET_ID'));
  assert.ok(result.errors.some((error) => error.code === 'INVALID_DISPLAY_NAME'));
  assert.ok(result.errors.some((error) => error.code === 'INVALID_DESCRIPTION'));
  assert.ok(result.errors.some((error) => error.code === 'INVALID_SPRITESHEET_PATH'));
  assert.ok(result.errors.some((error) => error.code === 'INVALID_SPRITESHEET_FORMAT'));
  assert.ok(result.errors.some((error) => error.code === 'INVALID_SPRITESHEET_FRAME_COUNT'));
});

test('rejects animated or wrong-sized WEBP bytes with typed package errors', () => {
  const animated = validateCodexPetPackage({
    manifest: {
      id: 'pet-name',
      displayName: 'Pet Name',
      description: 'One short sentence.',
      spritesheetPath: 'spritesheet.webp',
    },
    spritesheet: { bytes: makeVp8xWebp({ animated: true }) },
  });
  assert.equal(animated.ok, false);
  assert.ok(animated.errors.some((error) => error.code === 'INVALID_SPRITESHEET_FRAME_COUNT'));

  assert.throws(
    () => assertValidCodexPetPackage({
      manifest: {
        id: 'pet-name',
        displayName: 'Pet Name',
        description: 'One short sentence.',
        spritesheetPath: 'spritesheet.webp',
      },
      spritesheet: { bytes: makeVp8xWebp({ width: 1535, height: 1872 }) },
    }),
    (error) => error instanceof CodexValidationError && error.code === 'INVALID_CODEX_PACKAGE' && Array.isArray(error.details.errors),
  );
});
