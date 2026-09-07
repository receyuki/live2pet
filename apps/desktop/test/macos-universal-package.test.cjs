const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { requireSlice, resolvePaths } = require('../scripts/merge-macos-universal.cjs');

test('universal package paths keep architecture slices separate', () => {
  const paths = resolvePaths('/tmp/live2pet-universal');
  assert.match(paths.x64AppPath, /Live2Pet-darwin-x64\/Live2Pet\.app$/);
  assert.match(paths.arm64AppPath, /Live2Pet-darwin-arm64\/Live2Pet\.app$/);
  assert.match(paths.outAppPath, /Live2Pet-darwin-universal\/Live2Pet\.app$/);
});

test('universal merge rejects a missing architecture slice', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'live2pet-universal-test-'));
  try {
    assert.throws(() => requireSlice(path.join(root, 'missing.app'), 'x64'), (error) => error.code === 'MACOS_SLICE_MISSING');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
