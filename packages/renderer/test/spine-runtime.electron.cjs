const { app, BrowserWindow } = require('electron');
const { SpinePlayerAdapter, createElectronWebContentsPage } = require('../src/index.cjs');
const { createProject } = require('../../project/src/index.cjs');
const { buildProjectTargets } = require('../../package-build/src/index.cjs');

async function run() {
  const previewUrl = process.env.LIVE2PET_SPINE_PREVIEW_URL;
  const source = JSON.parse(process.env.LIVE2PET_SPINE_RENDER_SOURCE || 'null');
  if (!previewUrl || !source) throw new Error('Spine integration runner requires a preview URL and renderer source.');
  await app.whenReady();
  const window = new BrowserWindow({
    show: false,
    width: 256,
    height: 256,
    webPreferences: { backgroundThrottling: false, contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  window.webContents.on('console-message', (_event, details) => {
    if (details?.message) process.stderr.write(`[renderer] ${details.message}\n`);
  });
  await window.loadURL(previewUrl);
  const runtimeReady = await window.webContents.executeJavaScript(`({ spine: typeof window.spine, player: typeof window.spine?.SpinePlayer })`, true);
  if (runtimeReady.player !== 'function') throw new Error(`Spine Player did not load: ${JSON.stringify(runtimeReady)}`);
  const renderer = new SpinePlayerAdapter({ page: createElectronWebContentsPage({ webContents: window.webContents }), width: 256, height: 256, padding: 0.08 });
  const loaded = await renderer.load(source);
  const motions = renderer.getMotions();
  const motion = motions.filter((entry) => entry.duration > 0).sort((a, b) => a.duration - b.duration)[0] || motions[0];
  await renderer.playMotion(motion.id, { loop: true, speed: 1 });
  const before = await renderer.captureRgba({ width: 128, height: 128, motionId: motion.id, time: Math.min(0.25, motion.duration) });
  const scan = await renderer.scanVisualElements(motion.id);
  const hiddenId = scan.candidates[0]?.id || renderer.getVisualElements()[0]?.id;
  if (hiddenId) await renderer.setVisualSettings({ hiddenElementIds: [hiddenId] });
  const after = await renderer.captureRgba({ width: 128, height: 128, motionId: motion.id, time: Math.min(0.25, motion.duration) });
  const alpha = (bytes) => bytes.filter((_, index) => index % 4 === 3);
  const beforeAlpha = alpha(before.rgba);
  const afterAlpha = alpha(after.rgba);
  const mapping = `motion:${motion.id}`;
  const project = createProject({
    projectId: 'spine-integration',
    appVersion: '0.1.0',
    name: 'Spine Integration',
    source: { kind: 'spine-directory', name: 'official-fixture', fingerprint: 'a'.repeat(64), modelConfig: 'spineboy-pro.json' },
    recipes: [{ id: 'spine-motion', motionId: motion.id, expressionId: null }],
    visualSettings: { hiddenElementIds: hiddenId ? [hiddenId] : [] },
    targets: {
      clawd: { profile: 'clawd', renderPreset: 'compact', mappings: { idle: mapping, thinking: mapping, working: mapping, sleeping: 'fallback:idle' }, reactions: {}, options: { sleepMode: 'direct', renderOverrides: { width: 128, height: 128, fps: 6, quality: 60 } } },
      'codex-pet': { profile: 'codex-pet', renderPreset: 'compact', mappings: Object.fromEntries(['idle', 'running-right', 'running-left', 'waving', 'jumping', 'failed', 'waiting', 'running', 'review'].map((row) => [row, mapping])), reactions: {}, options: {} },
    },
  });
  const built = await buildProjectTargets({
    project,
    targets: ['clawd', 'codex-pet'],
    inputsByTarget: { clawd: { renderer }, 'codex-pet': { renderer } },
    optionsByTarget: { clawd: { package: true }, 'codex-pet': { package: true } },
  });
  const result = {
    loaded,
    motionCount: motions.length,
    slotCount: renderer.getVisualElements().length,
    opaquePixels: beforeAlpha.filter((value) => value > 0).length,
    transparentPixels: beforeAlpha.filter((value) => value === 0).length,
    hiddenId: hiddenId || null,
    changedBytes: before.rgba.reduce((count, value, index) => count + Number(value !== after.rgba[index]), 0),
    builds: Object.fromEntries(Object.entries(built.builds).map(([target, build]) => [target, { valid: build.validation?.ok, bytes: build.package?.byteLength, preview: build.preview?.ready }])),
  };
  await renderer.unload();
  window.destroy();
  process.stdout.write(`LIVE2PET_SPINE_RESULT=${JSON.stringify(result)}\n`);
}

run().then(() => app.quit(), (error) => {
  process.stderr.write(`${error.stack || error.message || error}\n`);
  app.exit(1);
});
