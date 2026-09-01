const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { inspectRuntime } = require('../../runtime/src/index.cjs');
const { inspectSourcePackage } = require('../../source-inspector/src/index.cjs');
const { createRendererAssetServer } = require('../src/asset-server.cjs');
const { PixiLive2dAdapter, pixiSourceFromManifest } = require('../src/index.cjs');

const runtimePath = process.env.LIVE2PET_MODERN_RUNTIME || '';
const sourceRoot = process.env.LIVE2PET_MODERN_SOURCE || '';

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
  ? 'Set LIVE2PET_MODERN_RUNTIME and LIVE2PET_MODERN_SOURCE to run the opt-in modern Cubism test.'
  : (!puppeteer ? 'Puppeteer is not installed in this environment; use the Desktop App smoke path instead.' : null);

test('opt-in modern Pixi adapter renders a local Cubism 3+ fixture through the shared contract', { skip: skipReason || false }, async () => {
  const runtime = await inspectRuntime(runtimePath);
  assert.equal(runtime.runtimeKind, 'modern-cubism-core');
  assert.deepEqual(runtime.cubismGenerations, [3, 4, 5]);
  const manifest = inspectSourcePackage(sourceRoot);
  assert.ok([3, 4, 5].includes(manifest.model.cubism));
  assert.ok(manifest.motions.length > 0, 'The opt-in modern fixture must contain a Motion.');

  const pixiPath = existingAsset('pixi.js/dist/browser/pixi.min.js');
  const unsafeEvalPath = existingAsset('@pixi/unsafe-eval/dist/browser/unsafe-eval.min.js');
  const adapterPath = existingAsset('pixi-live2d-display/dist/cubism4.min.js');
  assert.ok(pixiPath && unsafeEvalPath && adapterPath, 'Pinned Pixi/modern adapter assets are required for the opt-in test.');

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

    const renderer = new PixiLive2dAdapter({ page, width: 256, height: 256, padding: 12 });
    const source = pixiSourceFromManifest(manifest, { baseUrl: `${server.baseUrl}/model` });
    const motion = manifest.motions[0];
    const expression = manifest.expressions[0];
    await renderer.load(source);
    await renderer.playMotion(motion.id, { loop: true, speed: 1 });
    if (expression) await renderer.setExpression(expression.id);
    const frame = await renderer.captureRgba({ width: 128, height: 128, motionId: motion.id, time: 0.25 });
    assert.equal(frame.rgba.length, 128 * 128 * 4);
    assert.ok(frame.rgba.some((value, index) => index % 4 === 3 && value > 0));
    assert.ok(frame.rgba.some((value, index) => index % 4 === 3 && value === 0));
    const bounds = await renderer.getBounds({ motionId: motion.id });
    assert.equal(bounds.normalized, true);
    assert.ok(bounds.width > 0 && bounds.height > 0);
    if (expression) assert.equal(renderer.getState().expressionId, expression.id);
    await renderer.unload();
  } finally {
    if (browser) await browser.close();
    await server.close();
  }
});
