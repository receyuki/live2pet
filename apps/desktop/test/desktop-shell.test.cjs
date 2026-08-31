const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');

test('desktop shell pins the mapper entrypoint and keeps navigation and IPC narrow', () => {
  const main = fs.readFileSync(path.join(root, 'main.cjs'), 'utf8');
  const preload = fs.readFileSync(path.join(root, 'preload.cjs'), 'utf8');
  assert.match(main, /const DEVELOPMENT_MAPPER_PATH = path\.resolve\(__dirname, '\.\.\/mapper\/index\.html'\);/);
  assert.match(main, /const PACKAGED_MAPPER_PATH = path\.join\(process\.resourcesPath, 'mapper-dist', 'index\.html'\);/);
  assert.match(main, /return app\.isPackaged \? PACKAGED_MAPPER_PATH : DEVELOPMENT_MAPPER_PATH;/);
  assert.match(main, /mapperAssetRoot: app\.isPackaged \? path\.dirname\(documentPath\) : undefined,/);
  assert.match(main, /buildProjectService: buildProjectTargets/);
  assert.match(main, /installPackageService: installPackage/);
  assert.match(main, /event\.sender !== mainWindow\.webContents/);
  assert.match(main, /setWindowOpenHandler\(\(\) => \(\{ action: 'deny' \}\)\)/);
  assert.match(main, /mainWindow\.once\('ready-to-show', showWindow\);[\s\S]*await mainWindow\.loadFile\(documentPath\);[\s\S]*!mainWindow\.isVisible\(\)/);
  assert.match(main, /webContents\.on\('will-navigate'/);
  assert.match(main, /webContents\.on\('will-attach-webview'/);
  assert.match(main, /setPermissionRequestHandler/);
  assert.match(main, /setPermissionCheckHandler/);
  assert.doesNotMatch(main, /nodeIntegration:\s*true/);
  assert.match(preload, /contextBridge\.exposeInMainWorld\('live2pet'/);
  assert.match(preload, /const APP_IPC_CHANNEL = 'live2pet:app';/);
  assert.match(preload, /const APP_IPC_PROTOCOL_VERSION = 1;/);
  for (const method of ['getVersion', 'startMapperSession', 'getMapperProject', 'updateMapperProject', 'buildProject', 'getBuildArtifact', 'installArtifact', 'closeMapperSession']) {
    assert.match(preload, new RegExp(`invoke\\('${method}'`));
  }
  assert.match(preload, /getBuildArtifact: \(artifactId\) => invoke\('getBuildArtifact', \{ artifactId \}\)/);
  assert.doesNotMatch(preload, /require\(['"]\.\.\/\.\.\/packages\/app-host/);
  assert.doesNotMatch(preload, /exposeInMainWorld\([^,]+,\s*\{\s*ipcRenderer/);
});

test('desktop package keeps Electron and future Forge settings explicit', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const forge = fs.readFileSync(path.join(root, 'forge.config.cjs'), 'utf8');
  assert.equal(manifest.devDependencies.electron, '44.0.0');
  assert.equal(manifest.scripts.start, 'electron .');
  assert.match(forge, /asar:\s*true/);
  assert.match(forge, /executableName:\s*'live2pet'/);
  assert.match(forge, /extraResource:\s*\[path\.resolve\(__dirname, 'mapper-dist'\)\]/);
  assert.equal(manifest.scripts['prepare:mapper'], 'node scripts/stage-mapper-assets.cjs');
});

test('shared Mapper uses the App build seam when available and keeps browser fallback intact', () => {
  const mapper = fs.readFileSync(path.resolve(root, '../mapper/index.html'), 'utf8');
  assert.match(mapper, /function desktopBuildApi\(\)/);
  assert.match(mapper, /window\.live2pet\.buildProject/);
  assert.match(mapper, /window\.live2pet\.getBuildArtifact/);
  assert.match(mapper, /window\.live2pet\.installArtifact/);
  assert.match(mapper, /optionsByTarget: \{ "codex-pet": \{ package: true/);
  assert.match(mapper, /if \(desktopArtifact\) \{/);
  assert.match(mapper, /Encoding transparent WebP atlas/);
  assert.match(mapper, /function buildClawdThroughDesktop\(project, framesByMotion\)/);
  assert.match(mapper, /optionsByTarget: \{ clawd: \{ package: true/);
  assert.match(mapper, /id="buildClawd"/);
  assert.match(mapper, /id="downloadClawd"/);
  assert.match(mapper, /id="installCodex"/);
  assert.match(mapper, /id="installClawd"/);
  assert.match(mapper, /confirmInstall: true/);
  assert.match(mapper, /function prepareClawdPreview\(artifact\)/);
  assert.match(mapper, /id="clawdTargetPreview"/);
  assert.match(mapper, /id="clawdPreviewState"/);
  assert.match(mapper, /data-i18n-alt="preview\.clawd\.alt"/);
  assert.match(mapper, /@pixi\/unsafe-eval\/dist\/browser\/unsafe-eval\.min\.js/);
  assert.match(mapper, /connect-src 'self' blob: http:\/\/127\.0\.0\.1:\*/);
  assert.match(mapper, /function buildPreviewFiles\(files, modelFile, cubism, modelJson\)/);
  assert.match(mapper, /function restorePersistedRuntimes\(\)/);
  assert.match(mapper, /id="clearSavedRuntimes"/);
  assert.match(mapper, /const RUNTIME_DB_NAME = "live2pet-mapper-runtime"/);
  assert.match(mapper, /const I18n = \(\(\) =>/);
  assert.match(mapper, /id="languageSelect"/);
  assert.match(mapper, /class="mapping-scroll"/);
  assert.match(mapper, /\.mapping-panel \{ display: flex; flex-direction: column; max-height: min\(820px, calc\(100dvh - 190px\)\); \}/);
  assert.match(mapper, /\.mapping-scroll \{ min-height: 0; overflow-y: auto; overflow-x: hidden;/);
  assert.match(mapper, /\.motion-list, \.expression-list \{ display: grid; grid-template-columns: 1fr;/);
});

test('shared Mapper exposes project recovery, source review, and build-gate seams', () => {
  const mapper = fs.readFileSync(path.resolve(root, '../mapper/index.html'), 'utf8');
  assert.match(mapper, /function buildProjectDocument\(\)/);
  assert.match(mapper, /function parseProjectDocument\(textValue\)/);
  assert.match(mapper, /autosave/i, 'Mapper should expose an autosave or recovery entrypoint.');
  assert.match(mapper, /relink/i, 'Mapper should expose a source relink entrypoint.');
  assert.match(mapper, /sourceReview/i, 'Mapper should carry source-review state into the UI.');
  assert.match(mapper, /PROJECT_REVIEW_REQUIRED|review[^\n]{0,80}before[^\n]{0,80}build/i, 'Mapper should enforce review before a Package Build.');
  assert.match(mapper, /const PROJECT_DRAFT_STORAGE_KEY = "live2pet-mapper-project-draft-v1"/);
  assert.match(mapper, /function restoreProjectDraft\(\)/);
  assert.match(mapper, /id="recoverProject"/);
  assert.match(mapper, /id="projectReview"/);
  assert.match(mapper, /id="ackSourceReview"/);
  assert.match(mapper, /function relinkSource\(\)/);
  assert.match(mapper, /window\.addEventListener\("beforeunload"/);
  assert.match(mapper, /if \(state\.sourceReview\?\.required\) return \{ ready: false/);
});
