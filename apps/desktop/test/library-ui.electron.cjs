// Opt-in visual check against local assets; uses a disposable browser session.
const path = require('node:path');
const { app, BrowserWindow, WebContentsView, ipcMain } = require('electron');
const { discoverSourcePackages, inspectSourcePackage } = require('@live2pet/source-inspector');
const { createPreviewSessionService } = require('../preview-session-service.cjs');
const { loadRuntimeForGeneration } = require('@live2pet/runtime');
const { createLibraryThumbnailRenderer } = require('../library-thumbnail-renderer.cjs');
const { createSourceLibraryService } = require('../source-library-service.cjs');
const fs = require('node:fs');
const os = require('node:os');
app.whenReady().then(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'live2pet-library-ui-'));
  const window = new BrowserWindow({ show: false, width: 1200, height: 1000, webPreferences: { preload: path.resolve(__dirname, '../preload.cjs'), partition: 'library-ui-check', sandbox: true, contextIsolation: true } });
  let previewSource;
  const previewOptions = {
    ownerWindow: window,
    createView: () => new WebContentsView({ webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } }),
    resolveRuntime: version => loadRuntimeForGeneration(process.env.LIVE2PET_RUNTIME_SETTINGS, version),
    vendorPaths: version => { const vendor = path.resolve(__dirname, '../mapper-dist/vendor'); return { pixi: path.join(vendor, 'pixi.min.js'), unsafeEval: path.join(vendor, 'unsafe-eval.min.js'), live2dAdapter: path.join(vendor, version === 2 ? 'cubism2.min.js' : 'cubism4.min.js') }; },
  };
  const preview = createPreviewSessionService({ ...previewOptions, resolveSource: () => previewSource });
  ipcMain.handle('live2pet:preview', async (_event, request) => {
    try { return { protocolVersion: 1, ok: true, result: await preview[request.method](request.input) }; }
    catch (error) { return { protocolVersion: 1, ok: false, error: { code: error.code, message: error.message } }; }
  });
  const library = createSourceLibraryService({
    githubCacheRoot: path.join(root, 'cache'),
    showOpenDialog: async () => ({ filePaths: [process.env.LIVE2PET_LIBRARY_ROOT] }),
    discoverSources: input => { const result = discoverSourcePackages(input); result.candidates = result.candidates.filter(item => item.format === 'live2d').slice(0, 4); return result; },
    inspectSource: ({ inputPath, modelConfig }) => { const manifest = inspectSourcePackage(inputPath, { modelConfig }); previewSource = { inputPath, manifest, sourceFingerprint: manifest.source.fingerprint }; return manifest; },
    renderThumbnail: createLibraryThumbnailRenderer({
      ownerWindow: window,
      createView: () => new WebContentsView({ webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } }),
      resolveRuntime: version => loadRuntimeForGeneration(process.env.LIVE2PET_RUNTIME_SETTINGS, version),
      vendorPaths: version => { const vendor = path.resolve(__dirname, '../mapper-dist/vendor'); return { pixi: path.join(vendor, 'pixi.min.js'), unsafeEval: path.join(vendor, 'unsafe-eval.min.js'), live2dAdapter: path.join(vendor, version === 2 ? 'cubism2.min.js' : 'cubism4.min.js') }; },
    }),
  });
  ipcMain.handle('live2pet:app', async (_event, request) => {
    let result;
    switch (request.method) {
      case 'openSourceLibrary': result = await library.openLocal(); break;
      case 'getLibraryThumbnail': result = await library.thumbnail(request.args[0]); break;
      case 'inspectLibrarySource': result = await library.inspect(request.args[0]); break;
      case 'getRuntimeSettings': result = { schemaVersion: 2, runtimes: [] }; break;
      case 'getSpinePackStatus': result = { packs: [], installed: false }; break;
      case 'listRecentProjects': result = []; break;
      default: return { protocolVersion: 1, ok: false, error: { code: 'TEST_UNAVAILABLE', message: 'Not used by this visual check.' } };
    }
    return { protocolVersion: 1, ok: true, result };
  });
  try {
    await window.loadFile(path.resolve(__dirname, '../renderer-dist/index.html'));
    await window.webContents.executeJavaScript(`localStorage.setItem('live2pet.desktop.setup-completed','true');localStorage.setItem('live2pet.desktop.locale','en')`);
    await window.reload();
    await window.webContents.executeJavaScript(`new Promise((resolve,reject)=>{const end=Date.now()+10000;const check=()=>{const button=[...document.querySelectorAll('button')].find(item=>item.textContent.includes('Browse model folder'));if(button){button.click();resolve(true)}else if(Date.now()>end)reject(new Error('Missing library action'));else setTimeout(check,50)};check()})`);
    await window.webContents.executeJavaScript(`new Promise((resolve,reject)=>{const end=Date.now()+60000;const check=()=>{if(document.querySelectorAll('.model-library-cover img').length===4)resolve(true);else if(Date.now()>end)reject(new Error('Four model thumbnails did not load'));else setTimeout(check,100)};check()})`);
    fs.writeFileSync(process.env.LIVE2PET_LIBRARY_SCREENSHOT, (await window.webContents.capturePage()).toPNG());
    window.show();
    await window.webContents.executeJavaScript(`document.querySelector('.model-library-card').click()`);
    await window.webContents.executeJavaScript(`new Promise((resolve,reject)=>{const end=Date.now()+30000;const check=()=>{if(document.querySelector('.library-detail select'))resolve(true);else if(Date.now()>end)reject(new Error(document.querySelector('.library-detail')?.textContent || 'Missing live preview'));else setTimeout(check,100)};check()})`);
    if (preview.getStatus().state !== 'ready') throw new Error('Library live preview not ready');
    const modelView = window.contentView.children.find(view => view.webContents && view.webContents !== window.webContents);
    if (!modelView) throw new Error('Native model view was not attached');
    fs.writeFileSync(process.env.LIVE2PET_LIBRARY_SCREENSHOT.replace('.png', '-native.png'), (await modelView.webContents.capturePage()).toPNG());
    fs.writeFileSync(process.env.LIVE2PET_LIBRARY_SCREENSHOT.replace('.png', '-selected.png'), (await window.capturePage()).toPNG());
    console.log('LIBRARY_UI_PASS');
  } finally { await preview.close(); window.destroy(); fs.rmSync(root, { recursive: true, force: true }); }
  app.quit();
}).catch(error => { console.error(error); app.exit(1); });
