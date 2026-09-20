const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const script = path.join(root, 'scripts', 'workspace-checks.cjs');
const {
  collectJavaScriptFiles,
  discoverTestSuites,
  normalizeFiles,
  pnpmInvocation,
  relativeFiles,
  reportTestSuites,
} = require('../scripts/workspace-checks.cjs');

test('syntax verification checks every explicit file and leaves tracked files unchanged', () => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'live2pet-workspace-checks-'));
  const protectedFiles = [
    path.join(root, 'package.json'),
    path.join(root, 'apps', 'desktop', 'package.json'),
    script,
  ];
  const before = protectedFiles.map((file) => fs.readFileSync(file));
  try {
    const valid = path.join(temporaryRoot, 'valid.cjs');
    const invalid = path.join(temporaryRoot, 'invalid.cjs');
    fs.writeFileSync(valid, 'module.exports = 1;\n');
    fs.writeFileSync(invalid, 'module.exports = ;\n');
    assert.deepEqual(normalizeFiles([valid, invalid], root), [valid, invalid]);

    const result = spawnSync(process.execPath, [script, 'syntax', '--files', valid, invalid], {
      cwd: root,
      encoding: 'utf8',
    });
    assert.notEqual(result.status, 0, 'an invalid second module must fail syntax verification');
    assert.match(`${result.stdout}\n${result.stderr}`, /invalid\.cjs/);
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
  protectedFiles.forEach((file, index) => assert.deepEqual(fs.readFileSync(file), before[index], file));
});

test('syntax discovery covers supported JavaScript and Spine sources without generated output', () => {
  const files = relativeFiles(collectJavaScriptFiles(), root);
  assert.ok(files.includes('packages/spine-pack/src/index.cjs'));
  assert.ok(files.includes('packages/clawd-target/src/profile.js'));
  assert.ok(files.includes('apps/desktop/test/production-preload.test.cjs'));
  assert.equal(files.some((file) => file.startsWith('apps/desktop/renderer-dist/')), false);
  assert.equal(files.some((file) => file.startsWith('apps/desktop/renderer-vendor/')), false);
  assert.equal(files.some((file) => file.startsWith('apps/desktop/out/')), false);
  assert.equal(files.some((file) => file.startsWith('packages/live2d-exporter/')), false);
});

test('test discovery includes Spine and excludes the reference-only exporter package', () => {
  const suites = discoverTestSuites(root);
  const packageNames = new Set(suites.map((suite) => suite.packageName));
  const spine = suites.find((suite) => suite.packageName === '@live2pet/spine-pack' && suite.kind === 'node');
  assert.ok(spine);
  assert.deepEqual(relativeFiles(spine.files, root), ['packages/spine-pack/test/spine-pack.test.cjs']);
  assert.ok(packageNames.has('@live2pet/desktop'));
  assert.equal(packageNames.has('@live2pet/exporter'), false);

  let report = '';
  reportTestSuites(suites, { root, output: { write: (chunk) => { report += chunk; } } });
  assert.match(report, /@live2pet\/spine-pack Node tests/);
  assert.match(report, /@live2pet\/desktop UI tests/);
  assert.doesNotMatch(report, /@live2pet\/exporter/);
});

test('workspace entry points keep CommonJS syntax and UI TypeScript checks distinct', () => {
  const rootPackage = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const desktopPackage = JSON.parse(fs.readFileSync(path.join(root, 'apps', 'desktop', 'package.json'), 'utf8'));
  assert.equal(rootPackage.scripts.test, 'node scripts/workspace-checks.cjs test');
  assert.equal(rootPackage.scripts.typecheck, 'node scripts/workspace-checks.cjs typecheck');
  assert.match(desktopPackage.scripts.typecheck, /workspace-checks\.cjs syntax --scope desktop/);
  assert.match(desktopPackage.scripts.typecheck, /pnpm typecheck:ui/);
  assert.doesNotMatch(rootPackage.scripts.typecheck, /tsc .*packages/);
});

test('package-manager subprocesses reuse pnpm through the current Node executable', () => {
  assert.throws(() => pnpmInvocation({}), (error) => error.code === 'PNPM_REQUIRED');
  assert.deepEqual(pnpmInvocation({ npm_execpath: '/tmp/pnpm.cjs' }), {
    command: process.execPath,
    prefix: ['/tmp/pnpm.cjs'],
  });
});
