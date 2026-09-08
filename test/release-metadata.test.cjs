const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  extractChangelogEntry,
  releaseMetadata,
  versionFromTag,
} = require('../scripts/release-metadata.cjs');

test('release tags use a v-prefixed semantic version', () => {
  assert.equal(versionFromTag('v1.2.3'), '1.2.3');
  assert.throws(() => versionFromTag('1.2.3'), /vX\.Y\.Z/);
  assert.throws(() => versionFromTag('vnext'), /vX\.Y\.Z/);
});

test('the matching changelog entry is extracted without adjacent versions', () => {
  const changelog = '# Changelog\n\n## [Unreleased]\n\nPending.\n\n## [1.2.3] - 2026-09-08\n\n- Shipped.\n\n## [1.2.2] - 2026-09-01\n\n- Older.\n';
  assert.equal(extractChangelogEntry(changelog, '1.2.3'), '- Shipped.');
  assert.throws(() => extractChangelogEntry(changelog, '2.0.0'), /does not contain/);
});

test('release metadata requires the tag, desktop version, and changelog to agree', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'live2pet-release-'));
  try {
    fs.mkdirSync(path.join(root, 'apps', 'desktop'), { recursive: true });
    fs.writeFileSync(path.join(root, 'apps', 'desktop', 'package.json'), '{"version":"1.2.3"}\n');
    fs.writeFileSync(path.join(root, 'CHANGELOG.md'), '# Changelog\n\n## [1.2.3] - 2026-09-08\n\n- Shipped.\n');
    assert.deepEqual(releaseMetadata({ root, tag: 'v1.2.3' }), {
      version: '1.2.3',
      title: 'Live2Pet 1.2.3',
      notes: '- Shipped.',
    });
    assert.throws(() => releaseMetadata({ root, tag: 'v1.2.4' }), /does not match/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
