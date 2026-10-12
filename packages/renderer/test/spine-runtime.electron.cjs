const { app, BrowserWindow } = require('electron');
const { createRendererAdapter, createElectronWebContentsPage, usesLegacySpine } = require('../src/index.cjs');
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
  const runtimeReady = await window.webContents.executeJavaScript(`({ spine: typeof window.spine, player: typeof window.spine?.SpinePlayer, legacy: typeof window.live2petLegacySpine?.runtime?.Spine, factory: typeof window.ryLegacySpineFactory })`, true);
  if (usesLegacySpine(source) ? runtimeReady.legacy !== 'function' && runtimeReady.factory !== 'function' : runtimeReady.player !== 'function') throw new Error(`Spine runtime did not load: ${JSON.stringify(runtimeReady)}`);
  const renderer = createRendererAdapter({ source, page: createElectronWebContentsPage({ webContents: window.webContents }), width: 256, height: 256, padding: 0.08, playbackMode: 'realtime' });
  const loaded = await renderer.load(source);
  if (source.runtimeLine === '3.7') {
    const hasScaledAtlas = await window.webContents.executeJavaScript(`Object.values(PIXI.utils.BaseTextureCache).some(texture => texture.resource?.source && (texture.width > (texture.resource.source.naturalWidth || texture.resource.source.width) || texture.height > (texture.resource.source.naturalHeight || texture.resource.source.height)))`);
    if (process.env.LIVE2PET_SPINE_EXPECT_SCALED_ATLAS === '1' && !hasScaledAtlas) throw new Error('Declared atlas dimensions were not retained for the downscaled texture.');
  }
  const motions = renderer.getMotions();
  const motion = motions.filter((entry) => entry.duration >= .5).sort((a, b) => a.duration - b.duration)[0] || motions.find(entry => entry.duration > 0) || motions[0];
  await renderer.playMotion(motion.id, { loop: true, speed: 1 });
  if (source.runtimeLine === '2.1' && process.env.LIVE2PET_SPINE_EXPECT_MESH === '1') {
    const result = await window.webContents.executeJavaScript(`(() => { const slots=window.__live2petSpine.player.skeleton.slots.filter(slot=>slot.currentMesh&&slot.attachment);return {count:slots.length,valid:slots.every(slot=>slot.currentMesh.blendMode===(slot.blendMode??PIXI.BLEND_MODES.NORMAL)&&slot.currentMesh.tint===PIXI.utils.rgb2hex([(slot.r??1)*(slot.attachment.r??1),(slot.g??1)*(slot.attachment.g??1),(slot.b??1)*(slot.attachment.b??1)])&&slot.currentMesh.alpha===(slot.attachment.a??1))};})()`);
    if (!result.count || !result.valid) throw new Error('Live Mesh blend/tint/alpha does not match authored Slot data.');
    const filtersMatch = await window.webContents.executeJavaScript(`Object.values(PIXI.utils.BaseTextureCache).filter(texture=>texture.resource?.source).every(texture=>texture.mipmap===PIXI.MIPMAP_MODES.OFF&&texture.scaleMode===PIXI.SCALE_MODES.LINEAR)`);
    if (!filtersMatch) throw new Error('The Linear,Linear atlas unexpectedly enabled mipmaps or nearest filtering.');
  }
  const before = await renderer.captureRgba({ width: 128, height: 128, motionId: motion.id, time: Math.min(0.25, motion.duration) });
  const scan = await renderer.scanVisualElements(motion.id);
  // Slots can belong to other animation levels or have authored alpha zero.
  // Select one that actually changes this pose instead of assuming the largest bounds is visible.
  let hiddenId = null;
  const candidates = [...new Set([...scan.candidates.map(candidate => candidate.id), ...renderer.getVisualElements().map(slot => slot.id)])];
  for (const candidate of candidates.slice(0, 64)) {
    await renderer.setVisualSettings({ hiddenElementIds: [candidate] });
    const hiddenCapture = await renderer.captureRgba({ width: 128, height: 128, motionId: motion.id, time: Math.min(0.25, motion.duration) });
    if (hiddenCapture.rgba.some((value, index) => value !== before.rgba[index])) { hiddenId = candidate; break; }
  }
  if (!hiddenId) throw new Error('No visible Slot was available to verify hiding in this fixture pose.');
  let realtime = null;
  if (usesLegacySpine(source) || source.runtimeLine === '3.8') {
    await renderer.playMotion(motion.id, { loop: true, start: 0 });
    await renderer.setActive(true);
    await window.webContents.executeJavaScript('new Promise(resolve => setTimeout(resolve, 200))');
    const playing = await renderer.readState();
    if (!(playing.time > 0)) throw new Error('Spine 3.8 realtime playhead did not advance.');
    const stillHidden = await window.webContents.executeJavaScript(`(() => {const slot = window.__live2petSpine.player.skeleton.slots.find(slot => 'slot:' + slot.data.name === ${JSON.stringify(hiddenId)}); return (slot.getAttachment ? slot.getAttachment() : slot.attachment) === null;})()`);
    if (!stillHidden) throw new Error('Spine 3.8 playback restored a hidden Slot.');
    await renderer.pause();
    const paused = await renderer.readState();
    await window.webContents.executeJavaScript('new Promise(resolve => setTimeout(resolve, 100))');
    if ((await renderer.readState()).time !== paused.time) throw new Error('Spine 3.8 pause did not freeze the playhead.');
    await renderer.seek(Math.min(.1, motion.duration));
    await renderer.resume();
    await window.webContents.executeJavaScript('new Promise(resolve => setTimeout(resolve, 100))');
    const resumed = await renderer.readState();
    if (!(resumed.time > Math.min(.1, motion.duration))) throw new Error('Spine 3.8 resume did not advance the playhead.');
    await renderer.setActive(false);
    realtime = { playing: true, pause: true, resume: true, hiddenSlotPreserved: true };
  } else await renderer.setActive(false);
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
    warnings: renderer.getWarnings?.() || [],
    motionCount: motions.length,
    slotCount: renderer.getVisualElements().length,
    opaquePixels: beforeAlpha.filter((value) => value > 0).length,
    transparentPixels: beforeAlpha.filter((value) => value === 0).length,
    hiddenId: hiddenId || null,
    realtime,
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
