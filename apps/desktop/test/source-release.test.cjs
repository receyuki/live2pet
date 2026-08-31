const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const test = require('node:test');

const root = path.resolve(__dirname, '../../..');
const checker = path.join(root, 'apps/desktop/scripts/check-source-release.cjs');

test('source-release check passes without tracked models, runtimes, examples, or generated packages', () => {
  const output = execFileSync(process.execPath, [checker], { cwd: root, encoding: 'utf8' });
  const report = JSON.parse(output);
  assert.equal(report.contractVersion, 1);
  assert.equal(report.ok, true);
  assert.equal(report.errors.length, 0);
  assert.ok(report.scannedFiles > 20);
  assert.deepEqual(report.ignoredLocalInputs.slice(0, 3), ['examples/', 'archive/', 'artifacts/']);
});
