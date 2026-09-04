const assert = require('node:assert/strict');
const test = require('node:test');

const {
  CLAWD_PACKAGE_LIMIT,
  ClawdValidationError,
  assertValidClawdMapping,
  assertValidClawdThemePackage,
  createClawdTarget,
  validateClawdMapping,
  validateClawdThemePackage,
} = require('../src/index.cjs');

function directMapping() {
  return {
    sleepMode: 'direct',
    states: {
      idle: 'motion:idle',
      thinking: 'motion:thinking',
      working: 'motion:working',
      sleeping: 'fallback:idle',
      attention: 'motion:attention',
    },
    reactions: { drag: 'motion:drag' },
  };
}

function validThemePackage() {
  return {
    themeId: 'demo-theme',
    byteLength: 4096,
    manifest: {
      schemaVersion: 1,
      name: 'Demo Theme',
      version: '1.2.3',
      description: 'Synthetic Clawd theme fixture.',
      viewBox: { x: 0, y: 0, width: 384, height: 384 },
      hitBoxes: { default: { x: 0, y: 0, w: 384, h: 384 } },
      eyeTracking: { enabled: false, states: [] },
      miniMode: { supported: false },
      sleepSequence: { mode: 'direct' },
      states: {
        idle: ['demo-idle.webp'],
        thinking: ['demo-thinking.webp'],
        working: ['demo-working.webp'],
        sleeping: { fallbackTo: 'idle' },
        attention: ['demo-attention.webp'],
      },
      reactions: {
        drag: { file: 'demo-drag.webp' },
      },
    },
    assets: {
      'demo-idle.webp': Uint8Array.from([1]),
      'demo-thinking.webp': Uint8Array.from([2]),
      'demo-working.webp': Uint8Array.from([3]),
      'demo-attention.webp': Uint8Array.from([4]),
      'demo-drag.webp': Uint8Array.from([5]),
    },
  };
}

test('validates direct sleep, required states, fallback, and reactions', () => {
  const result = validateClawdMapping(directMapping());
  assert.equal(result.ok, true);
  assert.equal(result.sleepMode, 'direct');
  assert.equal(result.errors.length, 0);
  assert.ok(result.warnings.some((warning) => warning.code === 'OPTIONAL_STATE_UNMAPPED'));
  assert.deepEqual(createClawdTarget(directMapping()).sleepSequence, { mode: 'direct' });
});

test('requires all four transition Motions in full sleep mode', () => {
  const result = validateClawdMapping({
    ...directMapping(),
    sleepMode: 'full',
    states: { ...directMapping().states, yawning: 'motion:yawning', dozing: 'motion:dozing' },
  });
  assert.equal(result.ok, false);
  assert.deepEqual(result.errors.filter((error) => error.code === 'FULL_SLEEP_STATE_UNMAPPED').map((error) => error.slot), ['collapsing', 'waking']);
});

test('rejects fallback cycles, invalid fallback slots, and reaction fallbacks', () => {
  const result = validateClawdMapping({
    ...directMapping(),
    states: { ...directMapping().states, idle: 'fallback:thinking', thinking: 'fallback:idle', juggling: 'fallback:idle' },
    reactions: { drag: 'fallback:idle' },
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.code === 'FALLBACK_CYCLE'));
  assert.ok(result.errors.some((error) => error.code === 'FALLBACK_NOT_ALLOWED'));
  assert.ok(result.errors.some((error) => error.code === 'REACTION_FALLBACK_NOT_ALLOWED'));
});

test('assertion exposes typed errors and a target-compatible shape', () => {
  assert.throws(
    () => assertValidClawdMapping({ states: { idle: 'motion:idle' } }),
    (error) => error instanceof ClawdValidationError && error.code === 'INVALID_CLAWD_MAPPING' && Array.isArray(error.details.errors),
  );
  const target = createClawdTarget(directMapping());
  assert.equal(target.profile, 'clawd');
  assert.equal(target.contractVersion, 1);
  assert.equal(target.states.idle, 'motion:idle');
  assert.equal(target.reactions.drag, 'motion:drag');
});

test('validates a guide-shaped Clawd theme package with manifest, assets, and size', () => {
  const result = validateClawdThemePackage(validThemePackage());
  assert.equal(result.ok, true);
  assert.equal(result.assetCount, 5);
  assert.equal(result.referencedAssetCount, 5);
  assert.equal(result.byteLength, 4096);
  assert.equal(result.errors.length, 0);
  assert.deepEqual(assertValidClawdThemePackage(validThemePackage()).warnings, []);
});

test('reports missing assets, unsafe names, invalid reactions, and fallback cycles', () => {
  const input = validThemePackage();
  input.manifest.states.idle = [{ file: 'demo-idle.webp' }];
  input.manifest.states.sleeping = { fallbackTo: 'attention' };
  input.manifest.states.attention = { fallbackTo: 'sleeping' };
  input.manifest.reactions.drag = { fallbackTo: 'idle' };
  delete input.assets['demo-thinking.webp'];
  input.assets['../escape.webp'] = Uint8Array.from([9]);

  const result = validateClawdThemePackage(input);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.code === 'INVALID_CLAWD_STATE_BINDING' && error.slot === 'idle'));
  assert.ok(result.errors.some((error) => error.code === 'INVALID_CLAWD_REACTION' && error.slot === 'drag'));
  assert.ok(result.errors.some((error) => error.code === 'FALLBACK_CYCLE'));
  assert.ok(result.errors.some((error) => error.code === 'MISSING_CLAWD_ASSET' && error.asset === 'demo-thinking.webp'));
  assert.ok(result.errors.some((error) => error.code === 'INVALID_CLAWD_ASSET' && String(error.asset).includes('..')));
});

test('enforces full sleep assets, package size limits, and typed assertion failures', () => {
  const input = validThemePackage();
  input.byteLength = CLAWD_PACKAGE_LIMIT + 1;
  input.manifest.sleepSequence.mode = 'full';

  const result = validateClawdThemePackage(input);
  assert.equal(result.ok, false);
  assert.deepEqual(
    result.errors.filter((error) => error.code === 'FULL_SLEEP_STATE_UNMAPPED').map((error) => error.slot),
    ['yawning', 'dozing', 'collapsing', 'waking'],
  );
  assert.ok(result.warnings.some((error) => error.code === 'CLAWD_PACKAGE_TOO_LARGE' && error.maxBytes === CLAWD_PACKAGE_LIMIT));
  assert.throws(
    () => assertValidClawdThemePackage(input),
    (error) => error instanceof ClawdValidationError && error.code === 'INVALID_CLAWD_THEME_PACKAGE' && Array.isArray(error.details.errors),
  );
});

test('oversized valid packages remain valid with a human-readable host compatibility warning', () => {
  const result = validateClawdThemePackage({ ...validThemePackage(), byteLength: 89207688 });
  assert.equal(result.ok, true);
  const warning = result.warnings.find(w => w.code === 'CLAWD_PACKAGE_TOO_LARGE');
  assert.match(warning.message, /85.1 MiB/);
  assert.match(warning.message, /80 MiB/);
  assert.equal(warning.maxBytes, 83886080);
});

test('warns when packaged assets are not referenced by theme.json', () => {
  const input = validThemePackage();
  input.assets['unused.webp'] = Uint8Array.from([6]);
  const result = validateClawdThemePackage(input);
  assert.equal(result.ok, true);
  assert.ok(result.warnings.some((warning) => warning.code === 'UNUSED_CLAWD_ASSET' && warning.asset === 'unused.webp'));
});

test('validates working and juggling tiers, idle pools, roam orientation, and richer reactions', () => {
  const input = validThemePackage();
  input.manifest.states.roam = ['demo-roam.webp'];
  input.manifest.workingTiers = [
    { minSessions: 2, file: 'demo-working-2.webp' },
    { minSessions: 1, file: 'demo-working.webp' },
  ];
  input.manifest.jugglingTiers = [{ minSessions: 1, maxSessions: 3, file: 'demo-juggle.webp' }];
  input.manifest.idleAnimations = [{ file: 'demo-idle-look.webp', duration: 1200 }];
  input.manifest.roamFlipAssets = true;
  input.manifest.reactions = {
    drag: { file: 'demo-drag.webp', fileLeft: 'demo-drag-left.webp', fileRight: 'demo-drag-right.webp' },
    double: { files: ['demo-double-a.webp', 'demo-double-b.webp'], duration: 900 },
  };
  for (const name of [
    'demo-roam.webp', 'demo-working-2.webp', 'demo-working.webp', 'demo-juggle.webp',
    'demo-idle-look.webp', 'demo-drag-left.webp', 'demo-drag-right.webp',
    'demo-double-a.webp', 'demo-double-b.webp',
  ]) input.assets[name] = Uint8Array.from([7]);
  const result = validateClawdThemePackage(input);
  assert.equal(result.ok, true);
  assert.equal(result.errors.length, 0);
  assert.equal(result.referencedAssetCount, 13);
});

test('rejects malformed tier metadata and non-boolean roam orientation', () => {
  const input = validThemePackage();
  input.manifest.workingTiers = [{ minSessions: 0, maxSessions: 1, file: '../unsafe.webp' }];
  input.manifest.jugglingTiers = [{ minSessions: 2, maxSessions: 1, file: 'demo-juggle.webp' }];
  input.manifest.idleAnimations = [{ file: 'demo-idle.webp', duration: 0 }];
  input.manifest.roamFlipAssets = 'yes';
  const result = validateClawdThemePackage(input);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.field === 'workingTiers[0].minSessions'));
  assert.ok(result.errors.some((error) => error.code === 'INVALID_CLAWD_ASSET' && String(error.asset).includes('unsafe')));
  assert.ok(result.errors.some((error) => error.field === 'jugglingTiers[0].maxSessions'));
  assert.ok(result.errors.some((error) => error.field === 'idleAnimations[0].duration'));
  assert.ok(result.errors.some((error) => error.field === 'roamFlipAssets'));
});
