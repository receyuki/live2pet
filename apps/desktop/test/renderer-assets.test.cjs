const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { stageRendererAssets, RENDERER_ASSETS } = require('../scripts/stage-renderer-assets.cjs');

test('production renderer staging does not need or ship the reference Mapper document', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'live2pet-renderer-assets-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const stat = fs.statSync;
  t.mock.method(fs, 'statSync', (file, ...args) => {
    if (String(file).endsWith('/mapper/index.html')) throw Object.assign(new Error('reference document absent'), { code: 'ENOENT' });
    return stat(file, ...args);
  });
  const output = path.join(root, 'vendor');
  const result = stageRendererAssets(output);
  assert.equal(result.assets.length, 4);
  assert.deepEqual(fs.readdirSync(path.join(output, 'vendor')).sort(), ['cubism2.min.js', 'cubism4.min.js', 'pixi.min.js', 'unsafe-eval.min.js']);
  assert.equal(fs.existsSync(path.join(output, 'index.html')), false);
  const manifest = JSON.parse(fs.readFileSync(path.join(output, 'asset-manifest.json'), 'utf8'));
  assert.ok(manifest.licenses.length > 0);
  for (const asset of [...manifest.assets, ...manifest.licenses]) assert.ok(fs.statSync(path.join(output, asset.path)).size > 0);
});

test('missing production renderer assets fail before replacing an existing stage', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'live2pet-renderer-missing-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const output = path.join(root, 'vendor');
  fs.mkdirSync(output);
  fs.writeFileSync(path.join(output, 'existing'), 'keep');
  const stat = fs.statSync;
  t.mock.method(fs, 'statSync', (file, ...args) => file === RENDERER_ASSETS[0].source ? undefined : stat(file, ...args));
  assert.throws(() => stageRendererAssets(output), { code: 'RENDERER_ASSET_STAGE_FAILED' });
  assert.equal(fs.readFileSync(path.join(output, 'existing'), 'utf8'), 'keep');
});
