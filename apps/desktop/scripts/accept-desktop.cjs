const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright');
// Opt-in local acceptance only: model/runtime paths come from the environment.
// Playwright must be installed in the caller's tool environment (or NODE_PATH).
const root = path.resolve(__dirname, '../../..');
const desktop = path.join(root, 'apps/desktop');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'live2pet-hero-accept-'));
const log = (step) => console.log(step);
let app;
(async () => {
  for (const name of ['LIVE2PET_MODERN_RUNTIME', 'LIVE2PET_CUBISM2_RUNTIME', 'LIVE2PET_MODERN_SOURCE', 'LIVE2PET_CUBISM2_SOURCE']) assert.ok(process.env[name] && fs.existsSync(process.env[name]), `Provide a permitted local input through ${name}.`);
  const packagedExecutable = process.env.LIVE2PET_APP_EXECUTABLE;
  app = await electron.launch({ executablePath: packagedExecutable || require(path.join(desktop, 'node_modules/electron')), args: [...(packagedExecutable ? [] : [desktop]), `--user-data-dir=${profile}`], timeout: 30000 });
  assert.equal(fs.realpathSync(await app.evaluate(({ app }) => app.getPath('userData'))), fs.realpathSync(profile));
  await app.evaluate(({ dialog }) => { dialog.showMessageBoxSync = () => 1; });
  const page = await app.firstWindow();
  page.setDefaultTimeout(20000);
  page.on('pageerror', (error) => console.error('PAGE_ERROR', error.message));
  page.on('dialog', (dialog) => { void dialog.accept().catch(() => undefined); });
  await page.getByRole('button', { name: 'Set up later', exact: true }).waitFor();
  log('fresh setup mounted');
  const downloads = path.join(profile, 'runtime-downloads');
  fs.mkdirSync(downloads);
  for (const runtime of [process.env.LIVE2PET_MODERN_RUNTIME, process.env.LIVE2PET_CUBISM2_RUNTIME]) {
    const copy = path.join(downloads, path.basename(runtime));
    fs.copyFileSync(runtime, copy);
    await page.locator('input[type=file]:not([webkitdirectory])').setInputFiles(copy);
    await page.locator('.runtime-item').filter({ hasText: path.basename(runtime) }).waitFor();
  }
  await page.getByRole('button', { name: 'Continue to Live2Pet', exact: true }).click();
  fs.renameSync(downloads, `${downloads}-moved`);
  log('both runtimes saved through Setup');
  const nav = (name) => page.getByRole('navigation', { name: 'Project', exact: true }).getByRole('button', { name, exact: true });
  const previewReady = () => page.waitForFunction(() => { const timeline = document.querySelector('.playback input[type=range]'); return timeline && !timeline.disabled; }, null, { timeout: 60000 });
  for (const [generation, source] of [['modern', process.env.LIVE2PET_MODERN_SOURCE], ['legacy', process.env.LIVE2PET_CUBISM2_SOURCE]]) {
    const isFolder = fs.statSync(source).isDirectory();
    await page.locator(isFolder ? 'input[webkitdirectory]' : 'input[accept=".pck"]').setInputFiles(source);
    await page.getByRole('heading', { name: 'Source Package', exact: true }).waitFor();
    await nav('Map').click();
    await previewReady();
    const hiddenElementId = process.env[generation === 'modern' ? 'LIVE2PET_MODERN_HIDDEN_ELEMENT' : 'LIVE2PET_LEGACY_HIDDEN_ELEMENT'];
    if (hiddenElementId) {
      await page.getByRole('button', { name: 'Visibility', exact: true }).click();
      await page.getByRole('textbox', { name: 'Search visual elements' }).fill(hiddenElementId);
      const rows = page.locator('.visibility-row').filter({ hasText: hiddenElementId });
      await rows.getByRole('button', { name: /^Hide ·/ }).first().click();
      await rows.getByRole('button', { name: /^Show ·/ }).first().waitFor();
      await page.getByRole('button', { name: 'Back to motions', exact: true }).click();
      log(`${generation}: manually selected a hidden Visual Element`);
    }
    assert.ok((await page.locator('.preview-stage').boundingBox()).width <= 560);
    await page.getByRole('button', { name: 'Pause motion', exact: true }).click();
    const readPlayback = () => app.evaluate(async ({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].contentView.children[0].webContents.executeJavaScript('({...window.__live2petPixiLive2D.state})'));
    const loop = page.getByRole('button', { name: 'Loop preview', exact: true });
    await loop.focus();
    await page.keyboard.press('Enter');
    await page.getByRole('button', { name: 'Preview speed: 1×', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.playback-options button[aria-label="Preview speed: 1.5×"]'));
    for (let attempt = 0; attempt < 50 && (await readPlayback()).speed !== 1.5; attempt += 1) await page.waitForTimeout(100);
    assert.equal((await readPlayback()).loop, false);
    assert.equal((await readPlayback()).speed, 1.5);
    for (const speed of [1.5, 2, 0.5]) await page.getByRole('button', { name: `Preview speed: ${speed}×`, exact: true }).click();
    await loop.click();
    for (let attempt = 0; attempt < 50 && ((await readPlayback()).speed !== 1 || !(await readPlayback()).loop); attempt += 1) await page.waitForTimeout(100);
    assert.equal((await readPlayback()).speed, 1);
    assert.equal((await readPlayback()).loop, true);
    await page.getByRole('button', { name: 'Pause motion', exact: true }).click();
    const paused = await readPlayback();
    await page.waitForTimeout(250);
    assert.equal((await readPlayback()).time, paused.time);
    await page.getByRole('slider', { name: 'Motion position' }).fill('0.5');
    for (let attempt = 0; attempt < 50 && Math.abs((await readPlayback()).time - 0.5) >= 0.01; attempt += 1) await page.waitForTimeout(100);
    assert.ok(Math.abs((await readPlayback()).time - 0.5) < 0.01);
    await page.getByRole('button', { name: 'Restart motion', exact: true }).click();
    assert.ok((await readPlayback()).time < 0.5);
    await page.getByRole('button', { name: 'Pause motion', exact: true }).click();
    await page.getByRole('button', { name: 'Play motion', exact: true }).click();
    if (await page.locator('.expression-grid button').count() > 1) await page.locator('.expression-grid button').nth(1).click();
    await page.screenshot({ path: path.join(profile, `${generation}.png`) });
    for (const slot of ['Idle', 'Thinking', 'Working', 'Sleeping']) await page.getByRole('button', { name: `Use selected · ${slot}`, exact: true }).click();
    const hasSecondMotion = await page.locator('.motion-item').count() > 1;
    if (hasSecondMotion) {
      const firstId = (await readPlayback()).motionId;
      await page.locator('.motion-item').nth(1).click();
      for (let attempt = 0; attempt < 50 && (await readPlayback()).motionId === firstId; attempt += 1) await page.waitForTimeout(100);
      assert.notEqual((await readPlayback()).motionId, firstId);
      await page.getByRole('button', { name: 'Use selected · Thinking', exact: true }).click();
      await page.locator('.motion-item').first().click();
    }
    await page.getByRole('button', { name: 'Codex Pet', exact: true }).click();
    for (const button of await page.getByRole('button', { name: /^Use selected ·/ }).all()) await button.click();
    const file = path.join(profile, `${generation}.live2pet`);
    await app.evaluate(({ dialog }, file) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
    }, file);
    await page.getByRole('button', { name: 'Save project', exact: true }).click();
    await page.getByText('Saved', { exact: true }).waitFor();
    const saved = JSON.parse(fs.readFileSync(file));
    assert.equal(Object.keys(saved.targets.clawd.mappings).length, 4);
    assert.equal(Object.keys(saved.targets['codex-pet'].mappings).length, 9);
    assert.equal(saved.recipes.length, hasSecondMotion ? 2 : 1);
    if (hiddenElementId) assert.deepEqual(saved.visualSettings.hiddenElementIds, [hiddenElementId]);
    log(`${generation}: real preview/playback, explicit mappings, and atomic save passed`);
    for (let attempt = 0; attempt < 3; attempt++) {
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].contentView.children[0].webContents.forcefullyCrashRenderer());
      await page.getByRole('button', { name: 'Try again', exact: true }).click();
      await previewReady();
    }
    assert.deepEqual(JSON.parse(fs.readFileSync(file)), saved, 'Renderer crash preserves the saved project');
    log(`${generation}: renderer-process failure recovered without losing the project`);
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    const done = await page.getByRole('button', { name: 'Done', exact: true }).boundingBox();
    assert.ok(done.x > 160 && done.y >= 0, 'Settings Done clears the native window controls');
    await page.getByRole('button', { name: 'Runtimes', exact: true }).click();
    await page.screenshot({ path: path.join(profile, `${generation}-settings.png`) });
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    await previewReady();
    await page.reload();
    await page.getByRole('button', { name: 'Open project', exact: true }).click();
    await page.getByRole('heading', { name: 'Source Package', exact: true }).waitFor();
    await nav('Map').click();
    await previewReady();
    assert.equal(await page.locator('button[aria-label^="Clear ·"]:not([disabled])').count(), 4);
    await nav('Build').click();
    await page.getByRole('textbox', { name: /Pet \/ theme name/ }).fill(`Acceptance ${generation}`);
    for (const targetName of ['Clawd Theme Package', 'Codex Pet Package']) {
      const card = page.locator('.build-card').filter({ has: page.getByRole('heading', { name: targetName, exact: true }) });
      await card.getByRole('button', { name: 'Compact', exact: true }).click();
      log(`${generation}: building ${targetName}`);
      await page.evaluate(() => { window.__acceptProgress = []; window.__acceptUnsubscribe = window.live2pet.onBuildProgress((event) => window.__acceptProgress.push({ ...event, timestamp: Date.now() })); });
      if (process.env.LIVE2PET_ACCEPT_BUILD_HARDENING === '1' && targetName.startsWith('Clawd')) {
        await card.getByRole('button', { name: 'Build Pet Package', exact: true }).click();
        await page.waitForFunction(() => window.__acceptProgress.some(event => event.stage === 'render' && event.status === 'frame-completed'), null, { timeout: 60000 });
        await card.getByRole('button', { name: 'Cancel build', exact: true }).click();
        await card.locator('.build-result-cancelled').waitFor();
        assert.equal(await card.locator('.artifact-panel').count(), 0, 'cancelled first build must not publish a partial artifact');
        await page.evaluate(() => { window.__acceptProgress = []; });
        log(`${generation}: mid-capture cancellation settled without a partial artifact`);
      }
      await card.getByRole('button', { name: 'Build Pet Package', exact: true }).click();
      const coldStart = Date.now();
      await card.locator('.build-result-succeeded, .build-result-failed').waitFor({ timeout: Number(process.env.LIVE2PET_BUILD_TIMEOUT_MS) || 180000 }).catch(async (error) => { throw new Error(`${error.message}\n${await card.innerText()}`); });
      const coldMs = Date.now() - coldStart;
      assert.equal(await card.locator('.build-result-failed').count(), 0, await card.locator('.build-result').innerText());
      const progress = await page.evaluate(() => { window.__acceptUnsubscribe(); return window.__acceptProgress; });
      const stageMs = Object.fromEntries([...new Set(progress.map(event => event.stage))].map(stage => {
        const times = progress.filter(event => event.stage === stage).map(event => event.timestamp);
        return [stage, Math.max(...times) - Math.min(...times)];
      }));
      log(`${generation}: ${targetName} timings ${JSON.stringify({ totalMs: coldMs, stageMs })}`);
      fs.writeFileSync(path.join(profile, `${generation}-${targetName.startsWith('Clawd') ? 'clawd' : 'codex'}-progress.json`), JSON.stringify(progress));
      assert.ok(progress.some((event) => event.stage === 'render' && event.fraction > 0 && event.fraction < 1), 'capture reports intermediate progress');
      assert.ok((await card.locator('.artifact-panel strong').innerText()).includes(`acceptance-${generation}`));
      await card.locator('.generated-preview').waitFor({ timeout: 60000 }).catch(async (error) => { throw new Error(`${error.message}\n${await card.innerText()}`); });
      await page.waitForFunction((title) => {
        const card = [...document.querySelectorAll('.build-card')].find((element) => element.querySelector('h2')?.textContent === title);
        const image = card?.querySelector('.generated-preview img');
        if (image) return image.complete && image.naturalWidth > 0;
        const canvas = card?.querySelector('.generated-preview canvas');
        return canvas && canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data.some((value, index) => index % 4 === 3 && value > 0);
      }, targetName);
      const previewBox = await card.locator('.generated-preview').boundingBox();
      const stageBox = await card.locator('.generated-preview-stage').boundingBox();
      const cardBox = await card.boundingBox();
      const contentBox = await card.locator('.build-result').boundingBox();
      assert.ok(Math.abs(previewBox.width - contentBox.width) < 1, 'Generated result follows the card content width');
      assert.ok(previewBox.x + previewBox.width <= cardBox.x + cardBox.width, 'Generated preview stays inside its card');
      assert.ok(Math.abs(stageBox.width - (previewBox.width - 26)) < 1 && Math.abs(stageBox.width - stageBox.height) < 1, 'Generated stage adapts to its frame and stays square');
      const trackBox = await card.locator('[data-slot="progress-bar-track"]').boundingBox();
      assert.ok(trackBox.width > 100 && trackBox.height > 0, 'Build progress has a visible width and height');
      const choices = card.locator('.generated-preview-choices button');
      if (await choices.count() > 1) {
        await choices.nth(1).click();
        await page.waitForTimeout(150);
        assert.ok((await choices.nth(1).getAttribute('class')).includes('primary'));
      }
      log(`${generation}: ${targetName} build succeeded`);
      if (process.env.LIVE2PET_ACCEPT_BUILD_HARDENING === '1') {
        const downloadPath = path.join(profile, `${generation}-${targetName.startsWith('Clawd') ? 'clawd' : 'codex'}.zip`);
        await app.evaluate(({ BrowserWindow }, destination) => {
          globalThis.__acceptDownloadState = 'pending';
          BrowserWindow.getAllWindows()[0].webContents.session.once('will-download', (_event, item) => {
            item.setSavePath(destination);
            item.once('done', (_event, state) => { globalThis.__acceptDownloadState = state; });
          });
        }, downloadPath);
        await card.getByRole('button', { name: `Download ${targetName}`, exact: true }).click();
        for (let attempt = 0; attempt < 100 && await app.evaluate(() => globalThis.__acceptDownloadState) === 'pending'; attempt++) await page.waitForTimeout(100);
        assert.equal(await app.evaluate(() => globalThis.__acceptDownloadState), 'completed');
        assert.ok(fs.statSync(downloadPath).size > 0, 'explicit Download writes a portable ZIP');
        const entries = await require(path.join(root, 'packages/installation/src/index.cjs')).readArchive(fs.readFileSync(downloadPath));
        assert.ok(entries.some(entry => /(?:theme|pet)\.json$/.test(entry.name)));
        const installRoot = path.join(profile, `install-${generation}-${targetName.startsWith('Clawd') ? 'clawd' : 'codex'}`);
        fs.mkdirSync(installRoot);
        await app.evaluate(({ dialog }, destination) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [destination] }); }, installRoot);
        await card.getByRole('button', { name: `Choose folder ${targetName}`, exact: true }).click();
        await card.getByRole('button', { name: `Install ${targetName}`, exact: true }).click();
        await card.getByText('Package installed', { exact: true }).waitFor();
        assert.equal(fs.readdirSync(installRoot).length, 1);
        await page.evaluate(() => { window.__acceptProgress = []; window.__acceptUnsubscribe = window.live2pet.onBuildProgress(event => window.__acceptProgress.push(event)); });
        const warmStart = Date.now();
        await card.getByRole('button', { name: 'Build Pet Package', exact: true }).click();
        await card.locator('.build-result-succeeded, .build-result-failed').waitFor({ timeout: 180000 });
        assert.equal(await card.locator('.build-result-failed').count(), 0);
        const warmMs = Date.now() - warmStart;
        const warm = await page.evaluate(() => { window.__acceptUnsubscribe(); return window.__acceptProgress; });
        assert.ok(warm.some(event => event.cache === 'hit' || event.cacheHits > 0), 'unchanged Desktop rebuild uses the real cache');
        assert.ok(!warm.some(event => event.stage === 'render' && event.status === 'frame-completed'), 'cache avoids equivalent renderer frames');
        log(`${generation}: ${targetName} download/scratch install/cache rebuild passed; cold=${coldMs}ms warm=${warmMs}ms`);
      }
    }
    await app.evaluate(({ dialog }, selected) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selected] }); }, file);
    await page.getByRole('button', { name: 'Save project', exact: true }).click();
    await page.getByText('Saved', { exact: true }).waitFor();
    const changed = JSON.parse(fs.readFileSync(file));
    changed.source.fingerprint = 'acceptance-stale-fingerprint';
    fs.writeFileSync(file, JSON.stringify(changed));
    await page.reload();
    await page.getByRole('button', { name: 'Open project', exact: true }).click();
    await page.getByRole('region', { name: 'Review changed Source Package', exact: true }).waitFor();
    assert.equal(await nav('Map').isDisabled(), true);
    await page.getByRole('button', { name: 'Save project', exact: true }).click();
    await page.getByText('Saved', { exact: true }).waitFor();
    await page.reload();
    await page.getByRole('button', { name: 'Open project', exact: true }).click();
    await page.getByRole('region', { name: 'Review changed Source Package', exact: true }).waitFor();
    await page.getByRole('button', { name: 'I reviewed these recipes', exact: true }).click();
    await nav('Map').click();
    await previewReady();
    await page.waitForFunction(() => Boolean(localStorage.getItem('live2pet.desktop.project-draft')));
    await page.reload();
    await page.getByRole('button', { name: 'Recover', exact: true }).click();
    await page.getByRole('heading', { name: 'Source Package', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Save project', exact: true }).click();
    await page.getByText('Saved', { exact: true }).waitFor();
    log(`${generation}: reopen, Settings return, review persistence, and recovery passed`);
    if (!isFolder) {
      const moved = path.join(profile, 'moved-source.pck');
      fs.copyFileSync(source, moved);
      await page.locator('input[accept=".pck"]').setInputFiles(moved);
      await page.getByText('Unsaved changes', { exact: true }).waitFor();
      await page.getByRole('button', { name: 'Save project', exact: true }).click();
      await page.getByText('Saved', { exact: true }).waitFor();
      const relinked = JSON.parse(fs.readFileSync(file));
      assert.equal(relinked.source.path, moved);
      assert.equal(relinked.source.fingerprint, saved.source.fingerprint);
      assert.equal(Boolean(relinked.sourceReview?.required), false);
      log('legacy: moved PCK relink preserved fingerprint and mappings');
    }
    await page.reload();
  }
  await app.evaluate(({ app }) => app.exit(0)).catch(() => undefined);
  app = await electron.launch({ executablePath: packagedExecutable || require(path.join(desktop, 'node_modules/electron')), args: [...(packagedExecutable ? [] : [desktop]), `--user-data-dir=${profile}`], timeout: 30000 });
  const reopened = await app.firstWindow();
  await reopened.getByRole('button', { name: 'Open project', exact: true }).waitFor();
  assert.equal(await reopened.locator('.setup-view').count(), 0);
  const runtimes = await reopened.evaluate(() => window.live2pet.getRuntimeSettings());
  assert.equal(runtimes.result.runtimes.filter((runtime) => runtime.available).length, 2);
  for (const generation of ['modern', 'legacy']) {
    await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, path.join(profile, `${generation}.live2pet`));
    await reopened.getByRole('button', { name: 'Open project', exact: true }).click();
    await reopened.getByRole('navigation', { name: 'Project', exact: true }).getByRole('button', { name: 'Map', exact: true }).click();
    await reopened.getByRole('button', { name: 'Pause motion', exact: true }).waitFor({ timeout: 60000 });
    assert.equal(await reopened.getByRole('button', { name: 'Pause motion', exact: true }).isEnabled(), true);
    await reopened.reload();
  }
  log('app restart: Setup stays completed and both saved runtimes are reused');
  console.log('PROFILE', profile);
})().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => { if (app) await app.evaluate(({ app }) => app.exit(0)).catch(() => undefined); });
