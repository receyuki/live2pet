// Opt-in local smoke: no model or runtime is committed or downloaded.
const assert = require('node:assert/strict');
const path = require('node:path');
const { app, BrowserWindow, WebContentsView } = require('electron');
const sharp = require('sharp');
const { createLibraryThumbnailRenderer } = require('../library-thumbnail-renderer.cjs');
const { loadRuntimeForGeneration } = require('@live2pet/runtime');
const { resolveSpinePack } = require('@live2pet/spine-pack');
app.whenReady().then(async () => {
  const ownerWindow = new BrowserWindow({ show: false });
  try {
    const render = createLibraryThumbnailRenderer({
      ownerWindow,
      createView: () => new WebContentsView({ webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } }),
      resolveRuntime: version => loadRuntimeForGeneration(process.env.LIVE2PET_RUNTIME_SETTINGS, version),
      ...(process.env.LIVE2PET_SPINE_SCRIPT && process.env.LIVE2PET_SPINE_STYLE
        ? { resolveSpinePack: async () => ({ scriptPath: process.env.LIVE2PET_SPINE_SCRIPT, stylePath: process.env.LIVE2PET_SPINE_STYLE }) }
        : process.env.LIVE2PET_SPINE_PACK_ROOT ? { resolveSpinePack: line => resolveSpinePack(process.env.LIVE2PET_SPINE_PACK_ROOT, line) } : {}),
      vendorPaths: version => {
        const root = path.resolve(__dirname, '../mapper-dist/vendor');
        return { pixi: path.join(root, 'pixi.min.js'), unsafeEval: path.join(root, 'unsafe-eval.min.js'), live2dAdapter: path.join(root, version === 2 ? 'cubism2.min.js' : 'cubism4.min.js') };
      },
    });
    const request = render({ inputPath: process.env.LIVE2PET_THUMBNAIL_SOURCE, ...(process.env.LIVE2PET_THUMBNAIL_MODEL_CONFIG ? { modelConfig: process.env.LIVE2PET_THUMBNAIL_MODEL_CONFIG } : {}) });
    const result = process.env.LIVE2PET_THUMBNAIL_TIMEOUT_MS
      ? await Promise.race([request, new Promise((_, reject) => setTimeout(() => reject(new Error('Thumbnail test timed out.')), Number(process.env.LIVE2PET_THUMBNAIL_TIMEOUT_MS)))])
      : await request;
    assert.ok(result.dataUrl?.startsWith('data:image/png;base64,'));
    const png = Buffer.from(result.dataUrl.split(',')[1], 'base64');
    const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    assert.equal(info.width, 256); assert.equal(info.height, 256);
    assert.ok(data.some((value, index) => index % 4 === 3 && value > 0));
    if (process.env.LIVE2PET_THUMBNAIL_OUTPUT) await sharp(png).toFile(process.env.LIVE2PET_THUMBNAIL_OUTPUT);
    console.log('LIBRARY_THUMBNAIL_PASS', png.length);
  } finally { ownerWindow.destroy(); }
  app.quit();
}).catch(error => { console.error(error); app.exit(1); });
