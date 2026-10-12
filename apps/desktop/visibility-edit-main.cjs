const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { inspectSourcePackage } = require('@live2pet/source-inspector');
const { inspectRuntime, loadRuntimeForGeneration } = require('@live2pet/runtime');
const { resolveSpinePack } = require('@live2pet/spine-pack');
const { spineSourceFromManifest } = require('@live2pet/renderer');
const { createAppWindowOptions, APP_IPC_CHANNEL } = require('@live2pet/app-host');
const { createPreviewSessionService } = require('./preview-session-service.cjs');
const { createVisibilityEditSession, parseVisibilityEditArgument } = require('./visibility-edit-session.cjs');

const EDIT_CHANNEL = 'live2pet:visibility-edit';
const PREVIEW_CHANNEL = 'live2pet:preview';
const PREVIEW_METHODS = new Set(['open', 'layout', 'play', 'setExpression', 'control', 'close', 'getStatus', 'getVisualElements', 'getVisualElementThumbnail', 'scanVisualElements', 'setVisualSettings']);
const errorResponse = error => ({ protocolVersion: 1, ok: false, error: { code: /^[A-Z][A-Z0-9_]{0,63}$/.test(error?.code) ? error.code : 'VISIBILITY_EDIT_FAILED', message: 'The visibility edit command could not be completed.' } });
const ok = result => ({ protocolVersion: 1, ok: true, result });

function launchVisibilityEditor({ app, BrowserWindow, ipcMain, Menu, createView, vendorPaths, documentPath }) {
  const ordinaryRoot = app.getPath('userData');
  let session, profile, window, preview, finishing = false;
  try {
    session = createVisibilityEditSession(parseVisibilityEditArgument(process.argv));
    profile = fs.mkdtempSync(path.join(session.root, '.live2pet-workspace-'));
    fs.chmodSync(profile, 0o700);
    app.setPath('userData', profile);
    app.setPath('sessionData', profile);
  } catch (error) {
    console.error(errorResponse(error).error.code);
    if (session && !session.completed) {
      try { session.finish('error', { error }); } catch { /* An invalid/colliding session cannot publish a result. */ }
    }
    app.whenReady().then(() => {
      if (profile) fs.rmSync(profile, { recursive: true, force: true });
      app.exit(1);
    });
    return;
  }
  const headless = process.env.LIVE2PET_HEADLESS === '1';
  const projectId = `visibility-${session.request.sessionId}`;
  let inspection;
  async function complete(status, input = {}) {
    if (finishing) throw Object.assign(new Error(), { code: 'VISIBILITY_EDIT_COMPLETING' });
    finishing = true;
    try {
      let elements;
      if (status === 'applied') {
        if (preview?.getStatus().state !== 'ready') throw Object.assign(new Error(), { code: 'PREVIEW_NOT_READY' });
        const current = inspectSourcePackage(session.sourceRoot, { modelConfig: session.modelConfig });
        if (current.source.fingerprint !== inspection.source.fingerprint) throw Object.assign(new Error(), { code: 'VISIBILITY_EDIT_SOURCE_CHANGED' });
        elements = await preview.getVisualElements();
        input.visualSettings = session.validateSettings(input.visualSettings, elements);
        // Replace temporary Solo with the persistent choices before publishing.
        await preview.setVisualSettings(input.visualSettings);
      }
      if (preview) await preview.close();
      const result = session.finish(status, { ...input, elements });
      setImmediate(() => { window?.destroy(); app.quit(); });
      return result;
    } catch (error) {
      if (session.completed) setImmediate(() => { window?.destroy(); app.quit(); });
      else finishing = false;
      throw error;
    }
  }
  app.on('before-quit', event => {
    if (session.completed) return;
    event.preventDefault();
    if (!finishing) void complete('cancelled').catch(() => app.exit(1));
  });
  app.on('quit', () => {
    // Only the process-owned temporary profile is removed, never session assets.
    if (profile) {
      try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); }
      catch { /* Chromium may retain/recreate cache files; caller owns session cleanup. */ }
    }
  });
  app.whenReady().then(async () => {
    if (headless && process.platform === 'darwin') { app.setActivationPolicy('prohibited'); app.dock.hide(); }
    const defaultSession = require('electron').session.defaultSession;
    defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    defaultSession.setPermissionCheckHandler(() => false);
    inspection = inspectSourcePackage(session.sourceRoot, { modelConfig: session.modelConfig });
    const expected = session.request.model;
    if ((expected.format === 'spine' ? inspection.model.format !== 'spine' || inspection.model.runtimeLine !== expected.runtimeLine : inspection.model.format === 'spine' || inspection.model.cubism !== expected.generation)
      || inspection.warnings.some(warning => warning.code === 'MISSING_RESOURCE')) throw Object.assign(new Error(), { code: 'VISIBILITY_EDIT_MODEL_MISMATCH' });
    let runtime;
    if (session.runtimePath) {
      const descriptor = await inspectRuntime(session.runtimePath);
      if (!descriptor.cubismGenerations.includes(expected.generation)) throw Object.assign(new Error(), { code: 'VISIBILITY_EDIT_RUNTIME_MISMATCH' });
      runtime = { available: true, runtimePath: session.runtimePath, descriptor };
    } else if (expected.format === 'live2d') {
      runtime = await loadRuntimeForGeneration(path.join(ordinaryRoot, 'settings', 'runtime.json'), expected.generation, { readOnly: true });
      if (!runtime) throw Object.assign(new Error(), { code: 'PREVIEW_RUNTIME_UNAVAILABLE' });
    }
    const spinePack = expected.format === 'spine' ? resolveSpinePack(path.join(ordinaryRoot, 'renderer-packs'), expected.runtimeLine, { spineVersion: inspection.model.spineVersion }) : null;
    const windowOptions = createAppWindowOptions({ preload: path.join(__dirname, 'preload.cjs'), width: 1100, height: 840, show: false });
    if (headless) windowOptions.webPreferences.backgroundThrottling = false;
    window = new BrowserWindow({ ...windowOptions, minWidth: 800, minHeight: 640,
      ...(process.platform === 'darwin' ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 18, y: 19 } } : {}) });
    preview = createPreviewSessionService({ ownerWindow: window, createView: () => {
      const view = createView();
      if (headless) view.webContents.setBackgroundThrottling(false);
      return view;
    },
      resolveSource: input => input.projectId === projectId && input.sourceFingerprint === inspection.source.fingerprint ? { inputPath: session.sourceRoot, manifest: inspection, sourceFingerprint: inspection.source.fingerprint } : null,
      resolveRuntime: () => runtime, resolveSpinePack: () => spinePack, vendorPaths,
      createSpineRendererSource: (manifest, options) => ({ ...spineSourceFromManifest(manifest, options), ...(expected.initialSkin ? { initialSkin: expected.initialSkin } : {}) }),
      onStatus: status => { if (!window.isDestroyed()) window.webContents.send('live2pet:preview-status', status); },
    });
    const owned = event => !window.isDestroyed() && event.sender === window.webContents;
    ipcMain.handle(EDIT_CHANNEL, async (event, request) => {
      if (!owned(event)) return errorResponse({ code: 'APP_SENDER_NOT_ALLOWED' });
      try {
        if (request?.method === 'get') return ok({ projectId, name: expected.name, inspection, visualSettings: session.request.visualSettings, locale: /^zh(?:-|$)/i.test(app.getLocale()) ? 'zh-CN' : 'en' });
        if (request?.method !== 'finish' || !['applied', 'cancelled'].includes(request.input?.status)) throw Object.assign(new Error(), { code: 'INVALID_VISIBILITY_EDIT_COMMAND' });
        return ok(await complete(request.input.status, { visualSettings: request.input.visualSettings }));
      } catch (error) { return errorResponse(error); }
    });
    // The session cannot use ordinary project, build, runtime-write or file APIs.
    ipcMain.handle(APP_IPC_CHANNEL, () => errorResponse({ code: 'VISIBILITY_EDIT_READ_ONLY' }));
    ipcMain.handle(PREVIEW_CHANNEL, async (event, request) => {
      if (!owned(event)) return errorResponse({ code: 'APP_SENDER_NOT_ALLOWED' });
      try {
        if (finishing || request?.protocolVersion !== 1 || !PREVIEW_METHODS.has(request.method)) throw Object.assign(new Error(), { code: 'INVALID_PREVIEW_REQUEST' });
        if (request.method === 'getStatus') return ok(await preview.readStatus());
        return ok(await preview[request.method](request.input ?? {}));
      } catch (error) { return errorResponse(error); }
    });
    Menu.setApplicationMenu(Menu.buildFromTemplate(process.platform === 'darwin' ? [{ role: 'appMenu' }, { label: 'Edit', submenu: [{ role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] }] : []));
    const url = pathToFileURL(documentPath).href + '?visibilityEdit=1';
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (event, target) => { if (target !== url) event.preventDefault(); });
    window.webContents.on('will-attach-webview', event => event.preventDefault());
    window.webContents.on('render-process-gone', () => { if (!finishing) void complete('error', { error: { code: 'VISIBILITY_EDIT_RENDERER_EXITED' } }).catch(() => app.exit(1)); });
    window.on('close', event => { if (!session.completed) { event.preventDefault(); if (!finishing) void complete('cancelled').catch(() => app.exit(1)); } });
    window.on('closed', () => { if (!finishing) void complete('cancelled').catch(() => app.exit(1)); });
    await window.loadFile(documentPath, { query: { visibilityEdit: '1' } });
    if (!headless) window.show();
  }).catch(async error => {
    console.error(errorResponse(error).error.code);
    try { await complete('error', { error }); } catch { app.exit(1); }
  });
}

module.exports = { launchVisibilityEditor };
