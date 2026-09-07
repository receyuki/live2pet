const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const test = require('node:test');

const { inspectSourcePackage } = require('../../source-inspector/src/index.cjs');
const { createRendererAssetServer, spineSourceFromManifest } = require('../src/index.cjs');

const sourceRoot = process.env.LIVE2PET_SPINE_SOURCE || '';
const packRoot = process.env.LIVE2PET_SPINE_PACK || '';
const electron = path.resolve(__dirname, '../../../apps/desktop/node_modules/.bin/electron');
const runner = path.resolve(__dirname, 'spine-runtime.electron.cjs');
const script = path.join(packRoot, 'spine-player.min.js');
const style = path.join(packRoot, 'spine-player.min.css');
const skipReason = !sourceRoot || !packRoot
  ? 'Set LIVE2PET_SPINE_SOURCE and LIVE2PET_SPINE_PACK to run the opt-in Spine test.'
  : (![electron, script, style].every((file) => fs.existsSync(file)) ? 'Electron or the local Spine renderer-pack files are unavailable.' : false);

function runElectron(environment) {
  return new Promise((resolve, reject) => {
    const child = spawn(electron, [runner], { cwd: path.resolve(__dirname, '../../..'), env: { ...process.env, ...environment }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('exit', (code) => code === 0 ? resolve({ stdout, stderr }) : reject(new Error(`Electron Spine runner exited ${code}.\n${stderr}`)));
  });
}

test('opt-in official Spine Player renders, hides a Slot, and builds both target packages', { skip: skipReason }, async () => {
  const manifest = inspectSourcePackage(sourceRoot, { modelConfig: process.env.LIVE2PET_SPINE_MODEL_CONFIG || null });
  assert.equal(manifest.model.format, 'spine');
  assert.ok(['4.0', '4.1', '4.2', '4.3'].includes(manifest.model.runtimeLine));
  const server = await createRendererAssetServer({ sourceRoot, spineAssets: { script, style } });
  try {
    const source = spineSourceFromManifest(manifest, { baseUrl: `${server.baseUrl}/model` });
    const { stdout } = await runElectron({ LIVE2PET_SPINE_PREVIEW_URL: server.previewUrl, LIVE2PET_SPINE_RENDER_SOURCE: JSON.stringify(source) });
    const marker = stdout.split(/\r?\n/).find((line) => line.startsWith('LIVE2PET_SPINE_RESULT='));
    assert.ok(marker, `Spine runner returned no result: ${stdout}`);
    const result = JSON.parse(marker.slice('LIVE2PET_SPINE_RESULT='.length));
    assert.ok(result.motionCount > 0);
    assert.ok(result.slotCount > 0);
    assert.ok(result.opaquePixels > 0, JSON.stringify(result));
    assert.ok(result.transparentPixels > 0, JSON.stringify(result));
    assert.ok(result.hiddenId);
    assert.ok(result.changedBytes > 0);
    assert.deepEqual(Object.keys(result.builds).sort(), ['clawd', 'codex-pet']);
    assert.equal(result.builds.clawd.valid, true);
    assert.equal(result.builds.clawd.preview, true);
    assert.ok(result.builds.clawd.bytes > 0, JSON.stringify(result.builds));
    assert.equal(result.builds['codex-pet'].valid, true);
    assert.equal(result.builds['codex-pet'].preview, true);
    assert.ok(result.builds['codex-pet'].bytes > 0, JSON.stringify(result.builds));
  } finally {
    await server.close();
  }
});
