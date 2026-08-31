const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { inspectRuntime } = require('../../runtime/src/index.cjs');
const { inspectSourcePackage } = require('../../source-inspector/src/index.cjs');
const { createRendererAssetServer } = require('../src/asset-server.cjs');
const { LegacyPixiLive2dAdapter, pixiSourceFromManifest } = require('../src/index.cjs');

const runtimePath = process.env.LIVE2PET_CUBISM2_RUNTIME || '';
const sourceRoot = process.env.LIVE2PET_CUBISM2_SOURCE || '';

function existingAsset(...relativePaths) {
  for (const relativePath of relativePaths) {
    const candidate = path.resolve(__dirname, '../../live2d-exporter/node_modules', relativePath);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

let puppeteer = null;
try { puppeteer = require('puppeteer'); } catch {}

const skipReason = !runtimePath || !sourceRoot
  ? 'Set LIVE2PET_CUBISM2_RUNTIME and LIVE2PET_CUBISM2_SOURCE to run the opt-in Cubism 2 test.'
  : (!puppeteer ? 'Puppeteer is not installed in this environment; use the legacy exporter smoke command instead.' : null);

test('opt-in Cubism 2 adapter renders the local Destiny Child fixture through the shared contract', { skip: skipReason || false }, async () => {
  const runtime = await inspectRuntime(runtimePath);
  assert.equal(runtime.runtimeKind, 'legacy-cubism2');
  const manifest = inspectSourcePackage(sourceRoot);
  assert.equal(manifest.model.cubism, 2);

  const pixiPath = existingAsset('pixi.js/dist/browser/pixi.min.js');
  const unsafeEvalPath = existingAsset('@pixi/unsafe-eval/dist/browser/unsafe-eval.min.js');
  const adapterPath = existingAsset('pixi-live2d-display/dist/cubism2.min.js');
  assert.ok(pixiPath && unsafeEvalPath && adapterPath, 'Pinned Pixi/Cubism 2 adapter assets are required for the opt-in test.');

  const server = await createRendererAssetServer({ sourceRoot, runtimePath });
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--hide-scrollbars', '--ignore-gpu-blocklist', '--enable-webgl', '--use-angle=swiftshader', '--disable-background-timer-throttling'],
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 256, height: 256, deviceScaleFactor: 1 });
    await page.goto(`${server.baseUrl}/health`, { waitUntil: 'networkidle0' });
    await page.addScriptTag({ path: pixiPath });
    await page.addScriptTag({ path: unsafeEvalPath });
    await page.addScriptTag({ url: server.runtimeUrl });
    await page.addScriptTag({ path: adapterPath });

    const renderer = new LegacyPixiLive2dAdapter({ page, width: 256, height: 256, padding: 12 });
    const source = pixiSourceFromManifest(manifest, { baseUrl: `${server.baseUrl}/model` });
    await renderer.load(source);
    await renderer.playMotion('idle:0', { loop: true, speed: 1 });
    await renderer.setExpression('0');
    const frame = await renderer.captureRgba({ width: 128, height: 128, motionId: 'idle:0', time: 0.25 });
    assert.equal(frame.rgba.length, 128 * 128 * 4);
    assert.ok(frame.rgba.some((value, index) => index % 4 === 3 && value > 0));
    assert.ok(frame.rgba.some((value, index) => index % 4 === 3 && value === 0));
    const bounds = await renderer.getBounds({ motionId: 'idle:0' });
    assert.equal(bounds.normalized, true);
    assert.ok(bounds.width > 0 && bounds.height > 0);
    assert.equal(renderer.getState().expressionId, '0');
    await renderer.unload();
  } finally {
    if (browser) await browser.close();
    await server.close();
  }
});

