const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const stageScript = path.join(root, 'scripts', 'stage-mapper-assets.cjs');

test('mapper asset staging creates a self-contained local document without Core', () => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'live2pet-mapper-stage-'));
  try {
    const output = path.join(temporaryRoot, 'mapper-dist');
    const result = JSON.parse(execFileSync(process.execPath, [stageScript, '--output', output], { encoding: 'utf8' }));
    const html = fs.readFileSync(path.join(output, 'index.html'), 'utf8');
    const manifest = JSON.parse(fs.readFileSync(path.join(output, 'asset-manifest.json'), 'utf8'));

    assert.equal(result.output, output);
    assert.deepEqual(manifest.assets.map((asset) => asset.path), [
      'vendor/pixi.min.js',
      'vendor/unsafe-eval.min.js',
      'vendor/cubism4.min.js',
      'vendor/cubism2.min.js',
      'vendor/zip-no-worker.min.js',
    ]);
    for (const asset of manifest.assets) {
      assert.ok(fs.statSync(path.join(output, asset.path)).isFile());
      assert.match(asset.sha256, /^[a-f0-9]{64}$/);
    }
    assert.match(html, /src="vendor\/pixi\.min\.js"/);
    assert.match(html, /src="\.\/clawd-capture-plan\.js"/);
    assert.ok(fs.statSync(path.join(output, 'clawd-capture-plan.js')).isFile());
    assert.deepEqual(manifest.supportFiles.map((file) => file.path), ['clawd-capture-plan.js']);
    assert.match(manifest.supportFiles[0].sha256, /^[a-f0-9]{64}$/);
    assert.match(html, /src="vendor\/unsafe-eval\.min\.js"/);
    assert.match(html, /vendor\/cubism4\.min\.js/);
    assert.match(html, /zip-no-worker\.min\.js/);
    assert.match(html, /vendor\/cubism2\.min\.js/);
    assert.doesNotMatch(html, /\.\.\/\.\.\/(?:packages|node_modules)\//);
    assert.doesNotMatch(html, /<script[^>]+live2dcubismcore/i);
    assert.match(html, /script-src 'self' 'unsafe-inline' blob:/);
    assert.ok(manifest.licenses.some((license) => license.packageName === 'pixi.js' && license.license === 'MIT'));
    assert.ok(manifest.licenses.some((license) => license.packageName === '@pixi/unsafe-eval' && license.license === 'MIT'));
    assert.ok(manifest.licenses.some((license) => license.packageName === '@zip.js/zip.js' && license.license === 'BSD-3-Clause'));
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});
