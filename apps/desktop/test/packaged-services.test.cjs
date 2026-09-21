const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { runServiceScenarios } = require('../scripts/accept-packaged-services.cjs');

test('packaged service scenarios verify rollback, concurrent save snapshots and portable boundaries', { timeout: 10000 }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'live2pet-service-scenarios-'));
  try {
    const result = await runServiceScenarios({
      installation: require('../../../packages/installation/src/index.cjs'),
      packageBuild: require('../../../packages/package-build/src/index.cjs'),
      project: require('../../../packages/project/src/index.cjs'),
      workspace: require('../project-workspace-service.cjs'),
    }, root);
    assert.deepEqual(result, { installRollback: true, projectReplacement: true, cancelledSavePreserved: true, saveSnapshotPreserved: true, concurrentSavesIsolated: true, portableReopen: true, portableReject: true });
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
