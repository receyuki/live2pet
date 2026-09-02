const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const profilePath = path.join(__dirname, '../src/profile.js');
const profile = require(profilePath);
const target = require('../src/index.cjs');

test('shares the immutable Clawd profile between validators and package builders', () => {
  assert.equal(target.PROFILE, profile);
  assert.equal(target.CONTRACT_VERSION, profile.contractVersion);
  assert.equal(target.CLAWD_PACKAGE_LIMIT, profile.package.maxBytes);
  assert.equal(target.CORE_STATES, profile.states.core);
  assert.equal(target.ALL_STATES, profile.states.all);
  assert.equal(target.REACTIONS, profile.reactions);
  assert.equal(Object.isFrozen(profile.renderPresets.balanced), true);
});

test('publishes the Clawd profile to a browser without CommonJS globals', () => {
  const context = {};
  vm.runInNewContext(fs.readFileSync(profilePath, 'utf8'), context);
  assert.equal(context.Live2PetTargetProfiles.clawd.id, 'clawd');
  assert.deepEqual([...context.Live2PetTargetProfiles.clawd.states.requiredDirect], ['idle', 'thinking', 'working']);
});
