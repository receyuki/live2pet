// Opt-in quantitative rendering checks. Inputs are temporary model copies.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { app, BrowserWindow } = require('electron');
const { createRendererAdapter, createPixiLive2dAdapter, createElectronWebContentsPage, usesLegacySpine } = require('../src/index.cjs');
const { createProject } = require('../../project/src/index.cjs');
const { buildProjectTargets } = require('../../package-build/src/index.cjs');
app.on('window-all-closed', () => {});

async function run() {
  await app.whenReady();
  if (process.platform === 'darwin') { app.setActivationPolicy('prohibited'); app.dock.hide(); }
  const cases = JSON.parse(process.env.LIVE2PET_FIDELITY_CASES || '[]');
  const results = [];
  for (const entry of cases) {
    const window = new BrowserWindow({ show: false, width: 256, height: 256, webPreferences: { backgroundThrottling: false, contextIsolation: true, nodeIntegration: false, sandbox: true } });
    const options = { page: createElectronWebContentsPage({ webContents: window.webContents }), width: 256, height: 256, playbackMode: 'manual' };
    const renderer = entry.source.format === 'spine' ? createRendererAdapter({ source: entry.source, ...options }) : createPixiLive2dAdapter({ cubismVersion: entry.source.cubismVersion, ...options });
    try {
      await window.loadURL(entry.previewUrl);
      const loaded = await renderer.load(entry.source);
      const motions = renderer.getMotions?.() || entry.source.motions;
      const selected = entry.motionId ? motions.find(motion => motion.id === entry.motionId) : motions.find(motion => motion.duration > 0) || motions[0];
      assert.ok(selected, 'A test Motion is required.');
      await renderer.playMotion(selected.id, { loop: false });
      if (selected.duration > .3) {
        // Hidden Chromium views may suspend rAF. Exercise the same controlled
        // clock used by capture; visible realtime lifecycle has separate tests.
        await renderer.step(.1);
        assert.ok((await renderer.readState()).time > 0, `${entry.name}: preview clock did not advance`);
        await renderer.pause();
        const paused = (await renderer.readState()).time;
        await renderer.step(.1);
        assert.equal((await renderer.readState()).time, paused, `${entry.name}: pause did not freeze the clock`);
        await renderer.resume();
        await renderer.step(.1);
        assert.ok((await renderer.readState()).time > paused, `${entry.name}: resume did not advance the clock`);
      }
      await renderer.setActive(false);
      const capture = await renderer.captureRgba({ width: 128, height: 128, motionId: selected.id, time: Math.min(.25, selected.duration || 0) });
      const center = [...capture.rgba.slice((64 * 128 + 64) * 4, (64 * 128 + 64) * 4 + 4)];
      const painted = capture.rgba.filter((value, index) => index % 4 === 3 && value > 0).length;
      assert.ok(painted > 0, `${entry.name}: preview captured no visible pixels`);
      const result = { name: entry.name, loaded, center, painted, warnings: renderer.getWarnings?.() || [] };
      if (entry.source.format === 'spine' && !usesLegacySpine(entry.source)) {
        result.pma = await window.webContents.executeJavaScript('window.__live2petSpine.player.config.premultipliedAlpha');
        if (entry.source.runtimeLine === '3.8') {
          result.atlas = await window.webContents.executeJavaScript(`(() => {
            const r=window.__live2petSpine, atlas=r.player.assetManager.get(r.source.atlasUrl);
            let meshes=0,mismatches=0;
            for(const skin of r.player.skeleton.data.skins) for(const {attachment} of skin.getAttachments()) {
              if(!attachment.regionUVs) continue;
              meshes++;
              const before=[...attachment.uvs], texture=attachment.region.texture, page=atlas.pages.find(page=>page.texture===texture), original=texture.getImage;
              try {texture.getImage=()=>({width:page.width,height:page.height});attachment.updateUVs();if(before.some((value,index)=>Math.abs(value-attachment.uvs[index])>1e-6))mismatches++;}
              finally{texture.getImage=original;attachment.updateUVs();}
            }
            return {pages:atlas.pages.map(page=>({width:page.width,height:page.height})),meshes,mismatches};
          })()`);
          assert.equal(result.atlas.mismatches, 0, 'All Mesh UVs must agree with logical atlas dimensions.');
        }
      } else if (entry.source.format !== 'spine') {
        const counts = await window.webContents.executeJavaScript(`(() => {const manager=window.__live2petPixiLive2D.model.internalModel.motionManager;return Object.values(manager.motionGroups).flat().filter(Boolean).map(motion=>motion._motionData?.curveCount);})()`);
        result.motionCurveCounts = counts;
        if (entry.expectedCurveCount !== undefined) assert.ok(counts.includes(entry.expectedCurveCount), `Expected a loaded Motion with ${entry.expectedCurveCount} curves; got ${counts}`);
      }
      process.stdout.write(`FIDELITY_OBSERVATION=${JSON.stringify(result)}\n`);
      if (entry.expectedPma !== undefined) assert.equal(result.pma, entry.expectedPma, `${entry.name}: alpha mode`);
      if (entry.expectedCenter) assert.ok(center.every((value, index) => Math.abs(value - entry.expectedCenter[index]) <= 2), `${entry.name}: expected ${entry.expectedCenter}, got ${center}`);
      if (entry.pngPath) {
        await renderer.pause();
        fs.writeFileSync(entry.pngPath, (await window.webContents.capturePage()).toPNG());
      }
      if (entry.build) {
        const mapping = `motion:${selected.id}`;
        const project = createProject({ projectId: 'renderer-parity', appVersion: '0.3.0', name: 'Renderer Parity',
          source: { kind: entry.source.format === 'spine' ? 'spine-directory' : 'directory', name: 'temporary-fixture', fingerprint: 'a'.repeat(64), modelConfig: entry.source.format === 'spine' ? 'model.json' : 'model.model3.json' },
          recipes: [{ id: 'parity-motion', motionId: selected.id, expressionId: null }],
          targets: {
            clawd: { profile: 'clawd', renderPreset: 'compact', mappings: { idle: mapping, thinking: mapping, working: mapping, sleeping: 'fallback:idle' }, reactions: {}, options: { sleepMode: 'direct', renderOverrides: { width: 128, height: 128, fps: 6, quality: 60 } } },
            'codex-pet': { profile: 'codex-pet', renderPreset: 'compact', mappings: Object.fromEntries(['idle', 'running-right', 'running-left', 'waving', 'jumping', 'failed', 'waiting', 'running', 'review'].map(id => [id, mapping])), reactions: {}, options: {} },
          },
        });
        const built = await buildProjectTargets({ project, targets: ['clawd', 'codex-pet'], inputsByTarget: { clawd: { renderer }, 'codex-pet': { renderer } }, optionsByTarget: { clawd: { package: true }, 'codex-pet': { package: true } } });
        result.builds = {};
        for (const [target, build] of Object.entries(built.builds)) {
          assert.equal(build.validation?.ok, true, `${entry.name}: ${target} validation failed`);
          assert.equal(build.preview?.ready, true, `${entry.name}: ${target} preview missing`);
          assert.ok(build.package?.byteLength > 0, `${entry.name}: ${target} artifact missing`);
          result.builds[target] = { valid: true, preview: true, bytes: build.package.byteLength };
        }
        assert.equal(Object.keys(result.builds).length, 2);
      }
      if (entry.source.runtimeLine === '3.8' && !usesLegacySpine(entry.source)) {
        result.blendPixel = await window.webContents.executeJavaScript(`(() => {
          const gl=window.__live2petSpine.player.context.gl;
          const shader=(type,code)=>{const s=gl.createShader(type);gl.shaderSource(s,code);gl.compileShader(s);return s;};
          const vertex=shader(gl.VERTEX_SHADER,'attribute vec2 pos;void main(){gl_Position=vec4(pos,0.,1.);}');
          const fragment=shader(gl.FRAGMENT_SHADER,'precision mediump float;void main(){gl_FragColor=vec4(.2,.4,.6,.5);}');
          const program=gl.createProgram();gl.attachShader(program,vertex);gl.attachShader(program,fragment);gl.linkProgram(program);gl.useProgram(program);
          const buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),gl.STATIC_DRAW);
          const location=gl.getAttribLocation(program,'pos');gl.enableVertexAttribArray(location);gl.vertexAttribPointer(location,2,gl.FLOAT,false,0,0);
          for(const capability of [gl.SCISSOR_TEST,gl.DEPTH_TEST,gl.STENCIL_TEST,gl.CULL_FACE])gl.disable(capability);
          gl.viewport(0,0,1,1);gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);gl.enable(gl.BLEND);gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);gl.drawArrays(gl.TRIANGLES,0,3);
          const pixel=new Uint8Array(4);gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixel);
          gl.deleteBuffer(buffer);gl.deleteProgram(program);gl.deleteShader(vertex);gl.deleteShader(fragment);return [...pixel];
        })()`);
        assert.ok(result.blendPixel.every((value,index)=>Math.abs(value-[26,51,77,128][index])<=1), `Transparent alpha must not be squared: ${result.blendPixel}`);
      }
      results.push(result);
      process.stdout.write(`FIDELITY_CASE=${JSON.stringify(result)}\n`);
    } finally {
      await renderer.unload().catch(() => {});
      window.destroy();
    }
  }
  process.stdout.write(`FIDELITY_RESULT=${JSON.stringify(results)}\n`);
}
run().then(() => app.quit(), error => { process.stderr.write(`${error.stack || error}\n`); app.exit(1); });
