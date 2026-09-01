const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { EventEmitter } = require('node:events');

const root = path.resolve(__dirname, '..');
const { cubismAdapter, createRendererWindowHost, hardenRendererWindow, waitForRendererReady } = require('../renderer-host.cjs');
const { createRendererPreviewService } = require('../renderer-preview-service.cjs');
const { createAppIpcRouter } = require('../../../packages/app-host/src/index.cjs');

test('desktop shell pins the mapper entrypoint and keeps navigation and IPC narrow', () => {
  const main = fs.readFileSync(path.join(root, 'main.cjs'), 'utf8');
  const preload = fs.readFileSync(path.join(root, 'preload.cjs'), 'utf8');
  assert.match(main, /const DEVELOPMENT_MAPPER_PATH = path\.resolve\(__dirname, '\.\.\/mapper\/index\.html'\);/);
  assert.match(main, /const PACKAGED_MAPPER_PATH = path\.join\(process\.resourcesPath, 'mapper-dist', 'index\.html'\);/);
  assert.match(main, /const DEVELOPMENT_RENDERER_PATH = path\.resolve\(__dirname, 'renderer\/index\.html'\);/);
  assert.match(main, /const PACKAGED_RENDERER_PATH = path\.join\(process\.resourcesPath, 'mapper-dist', 'renderer\.html'\);/);
  assert.match(main, /return app\.isPackaged \? PACKAGED_MAPPER_PATH : DEVELOPMENT_MAPPER_PATH;/);
  assert.match(main, /return app\.isPackaged \? PACKAGED_RENDERER_PATH : DEVELOPMENT_RENDERER_PATH;/);
  assert.match(main, /createRendererPreviewHost/);
  assert.match(main, /loadRuntimeForGeneration/);
  assert.match(main, /closeRendererPreviewHost/);
  assert.match(main, /mapperAssetRoot: app\.isPackaged \? path\.dirname\(documentPath\) : undefined,/);
  assert.match(main, /buildProjectService: buildProjectWithCaptureCache/);
  assert.match(main, /getCaptureCacheService/);
  assert.match(main, /DEVELOPMENT_SKILL_PATH = path\.resolve\(__dirname, '\.\.\/\.\.\/skills\/live2pet'\)/);
  assert.match(main, /PACKAGED_SKILL_PATH = path\.join\(process\.resourcesPath, 'live2pet-skill'\)/);
  assert.match(main, /getSkillStatus/);
  assert.match(main, /installSkill/);
  assert.match(main, /skillService/);
  assert.match(main, /APP_BUILD_PROGRESS_CHANNEL/);
  assert.match(main, /webContents\.send\(APP_BUILD_PROGRESS_CHANNEL/);
  assert.match(main, /installPackageService: installPackage/);
  assert.match(main, /installRootPickerService: chooseInstallRoot/);
  assert.match(main, /dialog\.showOpenDialog/);
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
  assert.match(preload, /const APP_BUILD_PROGRESS_CHANNEL = 'live2pet:build-progress';/);
  assert.match(preload, /webUtils\.getPathForFile/);
  assert.match(preload, /getFilePath,/);
  for (const method of ['getVersion', 'startMapperSession', 'getMapperProject', 'updateMapperProject', 'buildProject', 'cancelBuild', 'getBuildArtifact', 'chooseInstallRoot', 'installArtifact', 'closeMapperSession', 'getCaptureCacheStatus', 'getSkillStatus', 'installSkill', 'startRendererPreview', 'loadRendererSource', 'rendererCommand', 'getRendererPreviewStatus', 'restartRendererPreview', 'closeRendererPreview']) {
    assert.match(preload, new RegExp(`invoke\\('${method}'`));
  }
  assert.match(preload, /getBuildArtifact: \(artifactId, offset = 0\) => invoke\('getBuildArtifact', \{ artifactId, offset \}\)/);
  assert.match(preload, /onBuildProgress/);
  assert.doesNotMatch(preload, /require\(['"]\.\.\/\.\.\/packages\/app-host/);
  assert.doesNotMatch(preload, /exposeInMainWorld\([^,]+,\s*\{\s*ipcRenderer/);
});

test('desktop renderer page and preload remain capability-limited', () => {
  const renderer = fs.readFileSync(path.join(root, 'renderer', 'index.html'), 'utf8');
  const rendererPreload = fs.readFileSync(path.join(root, 'renderer-preload.cjs'), 'utf8');
  assert.match(renderer, /Content-Security-Policy/);
  assert.match(renderer, /nonce-live2pet-renderer-bootstrap/);
  assert.match(renderer, /127\.0\.0\.1/);
  assert.match(renderer, /__live2petRendererReady/);
  assert.doesNotMatch(rendererPreload, /ipcRenderer/);
  assert.doesNotMatch(rendererPreload, /require\(['"]node:/);
  assert.match(rendererPreload, /contextBridge\.exposeInMainWorld\('__live2petRenderer'/);
});

test('desktop package keeps Electron and future Forge settings explicit', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const forge = fs.readFileSync(path.join(root, 'forge.config.cjs'), 'utf8');
  assert.equal(manifest.devDependencies.electron, '44.0.0');
  assert.equal(manifest.scripts.start, 'electron .');
  assert.match(forge, /asar:\s*true/);
  assert.match(forge, /executableName:\s*'live2pet'/);
  assert.match(forge, /extraResource:\s*\[[\s\S]*path\.resolve\(__dirname, 'mapper-dist'\)[\s\S]*live2pet-skill/);
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
  assert.match(mapper, /function buildClawdThroughDesktop\(project, framesByMotion, captureCache, signal = null\)/);
  assert.match(mapper, /optionsByTarget: \{ clawd: \{ package: true/);
  assert.match(mapper, /id="buildClawd"/);
  assert.match(mapper, /id="downloadClawd"/);
  assert.match(mapper, /id="previewPause"/);
  assert.match(mapper, /id="previewResume"/);
  assert.match(mapper, /id="previewRestart"/);
  assert.match(mapper, /id="previewSpeed"/);
  assert.match(mapper, /id="previewLoop"/);
  assert.match(mapper, /function pauseSourcePreview\(\)/);
  assert.match(mapper, /function resumeSourcePreview\(\)/);
  assert.match(mapper, /function restartSourcePreview\(\)/);
  assert.match(mapper, /function updateSourcePreviewSettings\(\)/);
  assert.match(mapper, /rendererPreviewCommand\("setSpeed"/);
  assert.match(mapper, /rendererPreviewCommand\("setLoop"/);
  assert.match(mapper, /id="installCodex"/);
  assert.match(mapper, /id="installClawd"/);
  assert.match(mapper, /id="chooseCodexInstallRoot"/);
  assert.match(mapper, /id="chooseClawdInstallRoot"/);
  assert.match(mapper, /confirmInstall: true/);
  assert.match(mapper, /async function prepareClawdPreview\(artifact, generation\)/);
  assert.match(mapper, /function startClawdPreview\(artifact\)/);
  assert.match(mapper, /void prepareClawdPreview\(artifact, generation\)/);
  assert.doesNotMatch(mapper, /await prepareClawdPreview\(desktopArtifact\)/);
  assert.match(mapper, /id="clawdTargetPreview"/);
  assert.match(mapper, /id="clawdPreviewState"/);
  assert.match(mapper, /data-i18n-alt="preview\.clawd\.alt"/);
  assert.match(mapper, /@pixi\/unsafe-eval\/dist\/browser\/unsafe-eval\.min\.js/);
  assert.match(mapper, /connect-src 'self' blob: http:\/\/127\.0\.0\.1:\*/);
  assert.match(mapper, /function buildPreviewFiles\(files, modelFile, cubism, modelJson\)/);
  assert.match(mapper, /let activeLive2dAdapter = null/);
  assert.match(mapper, /function activateLive2dAdapter\(kind\)/);
  assert.match(mapper, /function ensureLive2dAdapter\(kind\)/);
  assert.match(mapper, /await ensureLive2dAdapter\(cubism === 2 \? "legacy" : "modern"\)/);
  assert.match(mapper, /function restorePersistedRuntimes\(\)/);
  assert.match(mapper, /function subscribeBuildProgress\(\)/);
  assert.match(mapper, /function beginBuildProgress\(target/);
  assert.match(mapper, /function setBuildProgressCapture\(target/);
  assert.match(mapper, /function handleBuildProgress\(event\)/);
  assert.match(mapper, /function requestBuildCancellation\(target\)/);
  assert.match(mapper, /typeof api\.cancelBuild/);
  assert.match(mapper, /id="cancelCodexBuild"/);
  assert.match(mapper, /id="cancelClawdBuild"/);
  assert.match(mapper, /BUILD_CANCELLED/);
  assert.match(mapper, /async function compressClawdChunk\(bytes, width, height, startFrame, frameCount\)/);
  assert.match(mapper, /<script src="\.\/clawd-capture-plan\.js"><\/script>/);
  assert.match(mapper, /Live2PetClawdCapture\.createClawdCapturePlan/);
  assert.match(mapper, /liveModel\.autoUpdate = false/);
  assert.match(mapper, /liveModel\.update\(index === 0 \? 1 : plan\.stepMs\)/);
  assert.ok((mapper.match(/liveModel\.elapsedTime = performance\.now\(\);/g) || []).length >= 2);
  assert.match(mapper, /CLAWD_CAPTURE_COMPRESSION_REQUIRED/);
  assert.match(mapper, /encodingConcurrency: Live2PetClawdCapture\.resolveClawdEncodingConcurrency/);
  assert.doesNotMatch(mapper, /maxFrames/);
  assert.match(mapper, /async function retrieveDesktopArtifact\(api, artifact, target, setStatus, signal = null\)/);
  assert.match(mapper, /getBuildArtifact\(artifact\.artifactId, offset\)/);
  assert.match(mapper, /build\.progress\.stage\.transfer/);
  assert.match(mapper, /new zipApi\.BlobReader\(artifact\.blob\)/);
  assert.match(mapper, /async function loadClawdPreviewAsset\(preview, file\)/);
  assert.match(mapper, /preview: build\.preview \|\| null/);
  assert.match(mapper, /function playClawdBehaviorScenario/);
  assert.match(mapper, /id="clawdPreviewScenario"/);
  assert.match(mapper, /id="clawdPreviewTimeline"/);
  assert.match(mapper, /preview\.behavior\.scenarios/);
  assert.match(mapper, /rgbaDeflate/);
  assert.match(mapper, /motion-completed/);
  assert.match(mapper, /subscribeBuildProgress\(\);/);
  assert.match(mapper, /build\.progress\.stage\.currentCount/);
  assert.match(mapper, /id="codexBuildProgressBar"/);
  assert.match(mapper, /id="clawdBuildProgressBar"/);
  assert.match(mapper, /id="clearSavedRuntimes"/);
  assert.match(mapper, /id="refreshSkillStatus"/);
  assert.match(mapper, /id="installSkill"/);
  assert.match(mapper, /function desktopSkillApi\(\)/);
  assert.match(mapper, /async function refreshSkillStatus\(\)/);
  assert.match(mapper, /async function installSkillFromApp\(\)/);
  assert.match(mapper, /id="chooseRuntime"/);
  assert.match(mapper, /id="chooseRuntimeFolder"/);
  assert.match(mapper, /id="runtimeFolderInput"[^>]+webkitdirectory/);
  assert.match(mapper, /function localDirectoryPath\(file\)/);
  assert.match(mapper, /function detectRuntimeKind\(source\)/);
  assert.doesNotMatch(mapper, /id="chooseModernRuntime"|id="chooseLegacyRuntime"/);
  assert.match(mapper, /const RUNTIME_DB_NAME = "live2pet-mapper-runtime"/);
  assert.match(mapper, /function desktopRendererApi\(\)/);
  assert.match(mapper, /function rendererPreviewAvailability\(\)/);
  assert.match(mapper, /runtime\.preview\.desktopOnly/);
  assert.match(mapper, /bridge\.getFilePath\(file\)/);
  assert.match(mapper, /function rendererPreviewSource\(\)/);
  assert.match(mapper, /id="openRendererPreview"/);
  assert.match(mapper, /id="restartRendererPreview"/);
  assert.match(mapper, /id="closeRendererPreview"/);
  assert.match(mapper, /startRendererPreview\(\{ sourceRoot:/);
  assert.match(mapper, /loadRendererSource\(\{/);
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
  assert.match(mapper, /const PROJECT_HISTORY_LIMIT = 100/);
  assert.match(mapper, /const PROJECT_EDIT_ACTIONS = new Set/);
  assert.match(mapper, /function recipeIdFor\(motionId, expressionId/);
  assert.match(mapper, /type:"ASSIGN_SELECTED_RECIPE"/);
  assert.match(mapper, /recipeMappings/);
  assert.match(mapper, /function recipeExpressionByMotion\(target\)/);
  assert.match(mapper, /function captureProjectHistoryState\(source = state\)/);
  assert.match(mapper, /function undoProjectEdit\(\)/);
  assert.match(mapper, /function redoProjectEdit\(\)/);
  assert.match(mapper, /id="undoProject"/);
  assert.match(mapper, /id="redoProject"/);
  assert.match(mapper, /window\.addEventListener\("keydown"/);
  assert.match(mapper, /project\.undo\.title/);
  assert.match(mapper, /project\.history\.status/);
  assert.match(mapper, /function restoreProjectDraft\(\)/);
  assert.match(mapper, /id="recoverProject"/);
  assert.match(mapper, /id="projectReview"/);
  assert.match(mapper, /id="ackSourceReview"/);
  assert.match(mapper, /function relinkSource\(\)/);
  assert.match(mapper, /window\.addEventListener\("beforeunload"/);
  assert.match(mapper, /if \(state\.sourceReview\?\.required\) return \{ ready: false/);
});

test('desktop renderer host selects an adapter by inspected Cubism generation', () => {
  assert.equal(cubismAdapter(2).kind, 'legacy-cubism2');
  assert.equal(cubismAdapter(4).kind, 'modern-cubism');
  assert.equal(cubismAdapter(4, { modernAdapter: 'official' }).kind, 'modern-cubism-official');
  assert.throws(
    () => cubismAdapter(1),
    (error) => error.code === 'UNSUPPORTED_CUBISM_VERSION',
  );
});

test('desktop renderer host owns a loopback asset server and isolated window lifecycle', async () => {
  const sourceRoot = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'live2pet-desktop-source-'));
  const runtimeRoot = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'live2pet-desktop-runtime-'));
  fs.writeFileSync(path.join(sourceRoot, 'model.json'), '{}');
  const runtimePath = path.join(runtimeRoot, 'live2dcubismcore.min.js');
  fs.writeFileSync(runtimePath, 'runtime');
  const frameworkPath = path.join(runtimeRoot, 'live2pet-framework-bridge.js');
  fs.writeFileSync(frameworkPath, 'framework');

  class FakeWindow extends EventEmitter {
    constructor(options) {
      super();
      this.options = options;
      this.destroyed = false;
      this.webContents = new EventEmitter();
      this.webContents.setWindowOpenHandler = (handler) => { this.windowOpenHandler = handler; };
      this.webContents.executeJavaScript = async (sourceText) => {
        if (sourceText.includes('__live2petRendererReady')) return { ready: true, error: null };
        return undefined;
      };
    }

    async loadURL(url) { this.url = url; }

    isDestroyed() { return this.destroyed; }

    destroy() {
      if (this.destroyed) return;
      this.destroyed = true;
      this.emit('closed');
    }
  }

  const host = createRendererWindowHost({
    BrowserWindow: FakeWindow,
    sourceRoot,
    runtimePath,
    cubismVersion: 2,
    rendererDocument: path.join(root, 'renderer', 'index.html'),
    preload: path.join(root, 'renderer-preload.cjs'),
  });
  await host.start();
  assert.equal(host.getStatus().state, 'ready');
  assert.equal(host.kind, 'legacy-cubism2');
  assert.deepEqual(host.getStatus().state, 'ready');
  assert.deepEqual(host.getStatus().hasWindow, true);
  assert.match(host.getAssetDescriptor().runtimeUrl, /^http:\/\/127\.0\.0\.1:\d+\/runtime\//);
  assert.match(host.modelUrl('model.json'), /^http:\/\/127\.0\.0\.1:\d+\/model\/model\.json$/);
  await host.loadSource({
    modelConfig: 'model.json',
    cubismVersion: 2,
    motions: [{ id: 'idle:0', group: 'idle', index: 0, duration: 1 }],
    expressions: [],
  });
  await assert.rejects(
    () => host.loadSource({ modelConfig: 'model.json', cubismVersion: 4, motions: [], expressions: [] }),
    (error) => error.code === 'RENDERER_RUNTIME_MISMATCH',
  );
  await host.close();
  assert.equal(host.getStatus().state, 'closed');
  assert.equal(host.getAssetDescriptor(), null);

  const officialHost = createRendererWindowHost({
    BrowserWindow: FakeWindow,
    sourceRoot,
    runtimePath,
    frameworkPath,
    cubismVersion: 4,
    modernAdapter: 'official',
    rendererDocument: path.join(root, 'renderer', 'index.html'),
    preload: path.join(root, 'renderer-preload.cjs'),
  });
  await officialHost.start();
  assert.equal(officialHost.kind, 'modern-cubism-official');
  assert.equal(officialHost.adapter, 'official');
  assert.match(officialHost.getAssetDescriptor().frameworkUrl, /^http:\/\/127\.0\.0\.1:\d+\/framework\//);
  await officialHost.close();
  assert.throws(
    () => createRendererWindowHost({
      BrowserWindow: FakeWindow,
      sourceRoot,
      runtimePath,
      cubismVersion: 4,
      modernAdapter: 'official',
      rendererDocument: path.join(root, 'renderer', 'index.html'),
      preload: path.join(root, 'renderer-preload.cjs'),
    }),
    (error) => error.code === 'OFFICIAL_FRAMEWORK_REQUIRED',
  );
});

test('renderer window hardening denies navigation, webviews, and new windows', () => {
  const window = new EventEmitter();
  window.webContents = new EventEmitter();
  window.webContents.setWindowOpenHandler = (handler) => { window.openHandler = handler; };
  const documentPath = path.join(root, 'renderer', 'index.html');
  hardenRendererWindow(window, documentPath);
  assert.deepEqual(window.openHandler(), { action: 'deny' });
  let prevented = false;
  window.webContents.emit('will-navigate', { preventDefault: () => { prevented = true; } }, 'https://example.invalid/');
  assert.equal(prevented, true);
  prevented = false;
  window.webContents.emit('will-attach-webview', { preventDefault: () => { prevented = true; } });
  assert.equal(prevented, true);
});

test('renderer preview service resolves the saved runtime and guards one session', async () => {
  const calls = [];
  let hostClosed = false;
  let generation = 1;
  const service = createRendererPreviewService({
    loadRuntime: async (cubismVersion) => {
      calls.push(['load', cubismVersion]);
      return { available: true, runtimePath: '/Users/RY/Library/Application Support/Live2Pet/runtimes/live2d.min.js', descriptor: { cubismGenerations: [2] } };
    },
    resolveRuntimeEntrypoint: (inputPath) => { calls.push(['resolve', inputPath]); return '/Users/RY/Downloads/cubism/live2d.min.js'; },
    createHost: (options) => {
      calls.push(['host', options]);
      return {
        kind: 'legacy-cubism2',
        start: async () => ({ state: 'ready' }),
        restart: async () => ({ state: 'ready', generation: ++generation }),
        close: async () => { hostClosed = true; return { state: 'closed', generation }; },
        getStatus: () => ({ state: 'ready', generation, hasWindow: true, hasRenderer: true }),
        loadSource: async (source) => ({ contractVersion: 1, motionCount: source.motions.length, expressionCount: 0 }),
        invoke: async (method) => method === 'getState' ? { loaded: true, motionId: null } : true,
      };
    },
  });
  const started = await service.start({ sourceRoot: '/Users/RY/Downloads/model', cubismVersion: 2, width: 512, height: 512, show: true });
  assert.equal(started.kind, 'legacy-cubism2');
  assert.equal(started.status.state, 'ready');
  assert.deepEqual(calls[0], ['load', 2]);
  assert.equal(calls[1][0], 'resolve');
  assert.deepEqual(calls[2][1], { sourceRoot: '/Users/RY/Downloads/model', runtimePath: '/Users/RY/Downloads/cubism/live2d.min.js', cubismVersion: 2, width: 512, height: 512, show: true });
  await assert.rejects(() => service.start({ sourceRoot: '/tmp/other', cubismVersion: 2 }), (error) => error.code === 'RENDERER_PREVIEW_ACTIVE');
  const loaded = await service.loadSource({
    sessionId: started.sessionId,
    source: { modelConfig: 'model.json', cubismVersion: 2, motions: [], expressions: [] },
  });
  assert.equal(loaded.result.motionCount, 0);
  const state = await service.command({ sessionId: started.sessionId, method: 'getState', args: [] });
  assert.deepEqual(state.result, { loaded: true, motionId: null });
  const restarted = await service.restart({ sessionId: started.sessionId });
  assert.equal(restarted.status.generation, 2);
  const closed = await service.close({ sessionId: started.sessionId });
  assert.equal(closed.closed, true);
  assert.equal(hostClosed, true);
  assert.equal(service.status().active, false);
});

test('App IPC preserves renderer source generation through the preview service', async () => {
  let loadedSource = null;
  const service = createRendererPreviewService({
    loadRuntime: async () => ({
      available: true,
      runtimePath: '/tmp/live2dcubismcore.min.js',
      descriptor: { cubismGenerations: [3] },
    }),
    createHost: () => ({
      kind: 'modern-cubism',
      start: async () => ({ state: 'ready' }),
      restart: async () => ({ state: 'ready', generation: 2 }),
      close: async () => ({ state: 'closed' }),
      getStatus: () => ({ state: 'ready', generation: 1, hasWindow: true, hasRenderer: true }),
      loadSource: async (source) => {
        if (source.cubismVersion !== 3) {
          const error = new Error('The selected renderer runtime does not match the Source Package Cubism generation.');
          error.code = 'RENDERER_RUNTIME_MISMATCH';
          throw error;
        }
        loadedSource = source;
        return { contractVersion: 1, motionCount: source.motions.length, expressionCount: source.expressions.length };
      },
      invoke: async () => true,
    }),
  });
  const router = createAppIpcRouter({ rendererPreviewService: service });
  const started = await router({
    protocolVersion: 1,
    method: 'startRendererPreview',
    args: [{ sourceRoot: '/tmp/source', cubismVersion: 3, show: false }],
  });
  assert.equal(started.ok, true);

  const loaded = await router({
    protocolVersion: 1,
    method: 'loadRendererSource',
    args: [{
      sessionId: started.result.sessionId,
      modelConfig: 'model3.json',
      cubismVersion: 3,
      motions: [],
      expressions: [],
    }],
  });
  assert.equal(loaded.ok, true, loaded.error && loaded.error.message);
  assert.equal(loadedSource.cubismVersion, 3);
  await service.close({ sessionId: started.result.sessionId });
});

test('renderer ready helper returns a typed timeout instead of hanging', async () => {
  await assert.rejects(
    () => waitForRendererReady({ executeJavaScript: async () => ({ ready: false, error: null }) }, { timeoutMs: 100, pollMs: 5 }),
    (error) => error.code === 'RENDERER_PAGE_BOOT_TIMEOUT',
  );
});
