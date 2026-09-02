const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const profilePath = path.join(__dirname, '../src/profile.js');
const profile = require(profilePath);
const target = require('../src/index.cjs');

test('shares the immutable Codex profile between validators and package builders', () => {
  assert.equal(target.PROFILE, profile);
  assert.equal(target.CONTRACT_VERSION, profile.contractVersion);
  assert.equal(target.ATLAS, profile.atlas);
  assert.equal(target.ROWS, profile.rows);
  assert.equal(target.ROW_IDS, profile.rowIds);
  assert.equal(target.PACKAGE_FILES, profile.package.files);
  assert.equal(Object.isFrozen(profile.rows[0]), true);
});

test('publishes the Codex profile to a browser without CommonJS globals', () => {
  const context = {};
  vm.runInNewContext(fs.readFileSync(profilePath, 'utf8'), context);
  const browserProfile = context.Live2PetTargetProfiles.codexPet;
  assert.equal(browserProfile.id, 'codex-pet');
  assert.deepEqual([...browserProfile.rowIds], ['idle', 'running-right', 'running-left', 'waving', 'jumping', 'failed', 'waiting', 'running', 'review']);
  assert.deepEqual({ ...browserProfile.atlas }, { width: 1536, height: 1872, columns: 8, rows: 9, cellWidth: 192, cellHeight: 208 });
});
