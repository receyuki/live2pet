const assert = require('node:assert/strict');
const test = require('node:test');

const clawdProfile = require('@live2pet/clawd-target/profile');
const codexProfile = require('@live2pet/codex-target/profile');
const {
  CLAWD_PACKAGE_LIMIT,
  TARGET_PROFILES,
  TARGET_RENDER_PRESETS,
  resolveTargetRenderPreset,
} = require('../src/index.cjs');

test('consumes target-owned render presets and package limits without local copies', () => {
  assert.equal(TARGET_PROFILES.clawd, clawdProfile);
  assert.equal(TARGET_PROFILES['codex-pet'], codexProfile);
  assert.equal(TARGET_RENDER_PRESETS.clawd, clawdProfile.renderPresets);
  assert.equal(TARGET_RENDER_PRESETS['codex-pet'], codexProfile.renderPresets);
  assert.equal(CLAWD_PACKAGE_LIMIT, clawdProfile.package.maxBytes);
  assert.deepEqual(resolveTargetRenderPreset('clawd'), { name: clawdProfile.defaultRenderPreset, settings: { ...clawdProfile.renderPresets.balanced } });
  assert.deepEqual(resolveTargetRenderPreset('codex-pet', { preset: 'high' }), { name: 'high', settings: { ...codexProfile.renderPresets.high } });
});
