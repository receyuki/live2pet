// Opt-in local acceptance. Playwright comes from the developer tool environment.
// All model/runtime files are copied to temporary private sessions; no visible windows.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { _electron } = require('playwright');
const { inspectSourcePackage } = require('@live2pet/source-inspector');
const { loadRuntimeForGeneration } = require('@live2pet/runtime');
const { resolveSpinePack } = require('@live2pet/spine-pack');

const desktop = path.resolve(__dirname, '..');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'live2pet-visibility-accept-'));
const digest = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function snapshot(directory, prefix = '') {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const name = prefix + entry.name;
    return entry.isDirectory() ? snapshot(path.join(directory, entry.name), name + '/') : [[name, digest(path.join(directory, entry.name))]];
  });
}
let application;
async function scenario(fixture, action, hiddenElementIds = [], suppliedRuntime = false) {
  const session = path.join(root, crypto.randomBytes(12).toString('hex'));
  const ordinary = path.join(session, 'ordinary');
  fs.mkdirSync(session, { mode: 0o700 });
  fs.mkdirSync(ordinary, { mode: 0o700 });
  fs.writeFileSync(path.join(ordinary, 'ordinary-project-recovery.json'), 'untouched');
  fs.cpSync(fixture.source, path.join(session, 'source'), { recursive: true });
  const manifest = inspectSourcePackage(path.join(session, 'source'), { modelConfig: fixture.modelConfig });
  const request = { protocol: 'live2pet-visibility-edit', version: 1, sessionId: crypto.randomBytes(16).toString('hex'),
    model: { id: crypto.randomBytes(16).toString('hex'), revision: 'b'.repeat(64), name: 'Visibility acceptance', entry: `source/${manifest.source.modelConfig}`,
      ...(fixture.spine ? { format: 'spine', runtimeLine: manifest.model.runtimeLine, initialSkin: 'default' } : { format: 'live2d', generation: manifest.model.cubism }) },
    visualSettings: { hiddenElementIds }, runtime: null };
  if (!fixture.spine) {
    const runtime = await loadRuntimeForGeneration(process.env.LIVE2PET_RUNTIME_SETTINGS, manifest.model.cubism);
    assert.ok(runtime?.available, 'A configured runtime is required.');
    if (suppliedRuntime) {
      fs.mkdirSync(path.join(session, 'runtime'));
      fs.copyFileSync(runtime.runtimePath, path.join(session, 'runtime/core.js'));
      request.runtime = { generation: manifest.model.cubism, path: 'runtime/core.js' };
    } else {
      fs.mkdirSync(path.join(ordinary, 'settings'));
      await require('@live2pet/runtime').saveRuntimeSettings(path.join(ordinary, 'settings/runtime.json'), runtime.runtimePath);
    }
  } else {
    fs.mkdirSync(path.join(ordinary, 'renderer-packs'));
    const pack = resolveSpinePack(process.env.LIVE2PET_SPINE_PACKS, manifest.model.runtimeLine, { spineVersion: manifest.model.spineVersion });
    fs.cpSync(pack.directory, path.join(ordinary, 'renderer-packs', pack.id), { recursive: true });
  }
  const before = snapshot(ordinary), sourceBefore = snapshot(path.join(session, 'source'));
  const requestPath = path.join(session, 'request.json');
  fs.writeFileSync(requestPath, JSON.stringify(request), { mode: 0o600 });
  const executable = process.env.LIVE2PET_APP_EXECUTABLE;
  application = await _electron.launch({ executablePath: executable || require(path.join(desktop, 'node_modules/electron')),
    args: [...(executable ? [] : [desktop]), `--user-data-dir=${ordinary}`, '--live2pet-visibility-edit', requestPath],
    env: { ...process.env, LIVE2PET_HEADLESS: '1' }, timeout: 30000 });
  const editorProcess = application.process();
  let isolatedProfile;
  try {
    const page = await application.firstWindow();
    page.setDefaultTimeout(30000);
    page.on('pageerror', error => console.error('VISIBILITY_PAGE_ERROR', error.message));
    await page.locator('.visibility-edit-shell .visibility-panel').waitFor();
    await page.waitForFunction(async () => (await window.live2pet.getPreviewStatus()).result?.state === 'ready');
    const visibility = await application.evaluate(({ app, BrowserWindow }) => ({ profile: app.getPath('userData'), visible: BrowserWindow.getAllWindows().some(window => window.isVisible()) }));
    assert.equal(visibility.visible, false, 'Acceptance must never show a window.');
    isolatedProfile = visibility.profile;
    assert.notEqual(fs.realpathSync(isolatedProfile), fs.realpathSync(ordinary));
    assert.ok(fs.realpathSync(isolatedProfile).startsWith(fs.realpathSync(session) + path.sep), 'Late Chromium cache writes remain inside the caller-owned private session.');
    assert.equal(await page.locator('.assignment-panel').count(), 0);
    const denied = await page.evaluate(() => window.live2pet.saveProject({ project: {} }));
    assert.equal(denied.error.code, 'VISIBILITY_EDIT_READ_ONLY');
    const elementResponse = await page.evaluate(() => window.live2pet.getPreviewVisualElements());
    assert.equal(elementResponse.ok, true, JSON.stringify({ elementResponse, status: await page.evaluate(() => window.live2pet.getPreviewStatus()) }));
    const elements = elementResponse.result;
    assert.ok(elements.length > 0);
    if (!hiddenElementIds.length) {
      const painted = await application.evaluate(async ({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].contentView.children[0].webContents.executeJavaScript(`(() => {
        const r = window.__live2petPixiLive2D || window.__live2petSpine;
        let pixels;
        if (r.readPixels) { r.render(); pixels = r.readPixels(); }
        else { r.pose(r.state.time); r.draw(); const gl = r.player.context.gl; pixels = new Uint8Array(r.player.canvas.width * r.player.canvas.height * 4); gl.readPixels(0, 0, r.player.canvas.width, r.player.canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels); }
        return pixels.some((value, index) => index % 4 === 3 && value > 0);
      })()`));
      assert.equal(painted, true, 'The isolated model preview must render nontransparent pixels.');
    }
    if (action === 'apply' && request.model.generation === 3) await page.screenshot({ path: path.join(session, 'editor-preview.png') });
    const id = hiddenElementIds[0] || elements[0].id;
    await page.evaluate(() => window.live2pet.controlPreview({ action: 'pause' }));
    if (request.model.format === 'spine') {
      const skin = await application.evaluate(async ({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].contentView.children[0].webContents.executeJavaScript('window.__live2petSpine.player.skeleton.skin?.name'));
      assert.equal(skin, 'default');
    }
    if (hiddenElementIds.length) {
      await page.locator('.visibility-row').filter({ hasText: id }).locator('button[aria-label^="Show"],button[aria-label^="显示"]').first().waitFor();
    }
    if (action === 'apply') {
      const invalid = await page.evaluate(() => window.live2pet.finishVisibilityEdit({ status: 'applied', visualSettings: { hiddenElementIds: ['not-a-model-element'] } }));
      assert.equal(invalid.ok, false);
      assert.equal(fs.existsSync(path.join(session, 'result.json')), false);
      // Use the shared UI to edit settings; temporary Solo must not be persisted.
      const row = page.locator('.visibility-row').filter({ hasText: id }).first();
      if (!hiddenElementIds.length) await row.locator('button[aria-label^="Hide"],button[aria-label^="隐藏"]').click();
      await row.locator('button[aria-label^="Solo"],button[aria-label^="单独查看"]').click();
      await page.locator('button').filter({ hasText: /^(Apply and return|应用并返回)$/ }).click().catch(error => { if (!fs.existsSync(path.join(session, 'result.json'))) throw error; });
    } else if (action === 'cancel') await page.locator('button').filter({ hasText: /^(Cancel|取消)$/ }).click().catch(error => { if (!fs.existsSync(path.join(session, 'result.json'))) throw error; });
    else if (action === 'close') await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
    else if (action === 'crash') await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.forcefullyCrashRenderer());
    await new Promise((resolve, reject) => {
      const deadline = Date.now() + 15000;
      const poll = () => fs.existsSync(path.join(session, 'result.json')) && editorProcess.exitCode !== null ? resolve() : Date.now() > deadline ? reject(new Error('Session result/cleanup did not settle.')) : setTimeout(poll, 50);
      poll();
    });
    const result = JSON.parse(fs.readFileSync(path.join(session, 'result.json')));
    assert.equal(result.sessionId, request.sessionId); assert.equal(result.modelId, request.model.id); assert.equal(result.modelRevision, request.model.revision);
    assert.equal(result.status, action === 'apply' ? 'applied' : action === 'crash' ? 'error' : 'cancelled');
    if (action === 'apply') assert.deepEqual(result.visualSettings.hiddenElementIds, [id]);
    else assert.equal(result.visualSettings, undefined);
    assert.deepEqual(snapshot(ordinary), before);
    assert.deepEqual(snapshot(path.join(session, 'source')), sourceBefore);
    assert.equal(editorProcess.exitCode, 0);
    console.log(JSON.stringify({ format: request.model.format, generation: request.model.generation ?? request.model.runtimeLine, action, passed: true }));
    return id;
  } finally { await application.close().catch(() => {}); application = null; }
}

(async () => {
  const fixtures = process.env.LIVE2PET_VISIBILITY_FIXTURES ? JSON.parse(process.env.LIVE2PET_VISIBILITY_FIXTURES) : [
    { source: process.env.LIVE2PET_MODERN_SOURCE },
    { source: process.env.LIVE2PET_CUBISM2_SOURCE },
    { source: process.env.LIVE2PET_SPINE_SOURCE, modelConfig: process.env.LIVE2PET_SPINE_MODEL_CONFIG, spine: true },
  ];
  for (const fixture of fixtures) {
    assert.ok(fixture.source && fs.statSync(fixture.source).isDirectory(), 'Provide permitted standard model folders.');
    const id = await scenario(fixture, 'apply', [], !fixture.spine);
    await scenario(fixture, 'cancel', [id]);
  }
  await scenario(fixtures[0], 'close');
  await scenario(fixtures[0], 'crash');
  console.log(JSON.stringify({ visibilityEditProtocol: 1, passed: true, windowsShown: 0 }));
})().catch(async error => { console.error(error); await application?.close().catch(() => {}); process.exitCode = 1; });
