const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const test = require('node:test');
const { normalizeVisualSettings, pageInitializeVisualElements, pageSetVisualSettings } = require('../src/visual-settings.cjs');

test('Visual Settings normalize order/duplicates and reject malformed identities', () => {
  assert.deepEqual(normalizeVisualSettings({ hiddenElementIds: ['z', 'a', 'z'] }), { hiddenElementIds: ['a', 'z'] });
  for (const value of [null, {}, [], { hiddenElementIds: [''] }, { hiddenElementIds: ['a\0b'] }, { hiddenElementIds: Array(4097).fill('a') }]) {
    assert.throws(() => normalizeVisualSettings(value), { code: 'INVALID_VISUAL_SETTINGS' });
  }
});

for (const cubismVersion of [2, 4]) test(`Cubism ${cubismVersion}: hides after pose, reframes, and restores authored opacity`, async () => {
  const previousWindow = global.window;
  const opacity = { BG: 0.6, Body: 1 };
  const parameters = [0.5];
  let renderedParameter = parameters[0];
  const internal = new EventEmitter();
  internal.coreModel = {
    _model: { parts: { ids: ['BG', 'Body'] } },
    getPartOpacityById: id => opacity[id], setPartOpacityById: (id, value) => { opacity[id] = value; },
    getPartsOpacity: id => opacity[id], setPartsOpacity: (id, value) => { opacity[id] = value; },
    getPartsDataIndex: id => ['BG', 'Body'].indexOf(id),
    getModelContext: () => ({ arbitraryRuntimeTableName: [{ opaqueField: { id: 'BG' } }, { opaqueField: { id: 'Body' } }, { unrelated: { id: 'Parameter' } }] }),
    getParameterCount: () => parameters.length,
    getParameterValueByIndex: index => parameters[index], setParameterValueByIndex: (index, value) => { parameters[index] = value; },
    getParamFloat: index => parameters[index], setParamFloat: (index, value) => { parameters[index] = value; },
    update() { rendered = { ...opacity }; renderedParameter = parameters[0]; },
  };
  let pending = false;
  let advances = 0;
  let bodyRight = 6;
  let rendered = { ...opacity };
  const model = { internalModel: internal, scale: { x: 1, set(x) { this.x = x; } }, x: 0, y: 0, update: () => { pending = true; advances++; } };
  const runtime = {
    source: { cubismVersion, motions: [] }, options: {}, state: { time: 0, motionId: null },
    model, fit() { model.scale.x = this.visualBounds ? 2 : 1; model.x = model.y = 0; }, syncTicker() {},
    readPixels() { return this.app.renderer.extract.pixels(); },
    app: { stage: {}, stop() {}, renderer: { width: 8, height: 8, extract: { pixels() {
      const pixels = new Uint8Array(8 * 8 * 4);
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
        const localX = (x + 0.5 - model.x) / model.scale.x, localY = (y + 0.5 - model.y) / model.scale.x;
        if ((rendered.BG > 0 && localX >= 0 && localX < 8 && localY >= 0 && localY < 8) || (rendered.Body > 0 && localX >= 2 && localX < bodyRight && localY >= 2 && localY < 6)) pixels[(y * 8 + x) * 4 + 3] = 255;
      }
      return pixels;
    } } } },
    render() {
      if (pending) {
        internal.emit('beforeMotionUpdate');
        opacity.BG = 0.6; // authored pose/animation tries to restore the background
        const baseParameter = parameters[0];
        parameters[0] += 0.2; // pose differs from the saved animation baseline
        internal.emit('beforeModelUpdate');
        internal.coreModel.update();
        parameters[0] = baseParameter;
        pending = false;
      }
    },
  };
  global.window = { __live2petPixiLive2D: runtime, PIXI: { Rectangle: class {} } };
  try {
    assert.deepEqual((await pageInitializeVisualElements()).map(element => element.id), ['BG', 'Body']);
    await pageSetVisualSettings({ hiddenElementIds: ['BG'] });
    assert.equal(advances, 0, 'hiding only recalculates drawables, without advancing the pose');
    assert.equal(rendered.BG, 0);
    assert.equal(model.scale.x, 2);
    assert.deepEqual(runtime.visualBounds, { x: 2, y: 2, width: 4, height: 4 });
    model.update(10); runtime.render();
    assert.equal(rendered.BG, 0, 'motion/pose cannot unhide the Part');
    const previousDocument = global.document, previousImageData = global.ImageData;
    let failThumbnail = false;
    global.ImageData = class { constructor(data, width, height) { Object.assign(this, { data, width, height }); } };
    global.document = { createElement: () => ({ getContext: () => ({ putImageData() {}, drawImage() {} }), toDataURL() { if (failThumbnail) throw new Error('encode failed'); return 'data:image/png;base64,fixture'; } }) };
    try {
      const settings = { ...runtime.visualSettings };
      const framing = runtime.visualBounds;
      const previousAdvances = advances;
      assert.deepEqual(runtime.getVisualElementThumbnail('BG'), { id: 'BG', dataUrl: 'data:image/png;base64,fixture' });
      assert.equal(rendered.BG, 0, 'inspecting a hidden Part does not unhide it in preview');
      assert.deepEqual(runtime.visualSettings, settings);
      assert.deepEqual(runtime.visualBounds, framing);
      assert.equal(advances, previousAdvances, 'thumbnail inspection must not rerun motion or physics');
      assert.equal(renderedParameter, 0.7, 'inspection restores the rendered pose, not its unposed baseline');
      assert.equal(parameters[0], 0.5, 'inspection preserves base parameters for the next animation tick');
      failThumbnail = true;
      assert.throws(() => runtime.getVisualElementThumbnail('BG'), /encode failed/);
      assert.equal(rendered.BG, 0, 'thumbnail errors restore the project visibility');
      assert.throws(() => runtime.getVisualElementThumbnail('missing'), /not available/);
    } finally { global.document = previousDocument; global.ImageData = previousImageData; }
    await pageSetVisualSettings({ hiddenElementIds: [] });
    assert.equal(rendered.BG, 0.6, 'restore authored opacity, not a hard-coded 1');
    assert.equal(model.scale.x, 1);
    await assert.rejects(pageSetVisualSettings({ hiddenElementIds: ['missing'] }), /no longer available/);
    await pageSetVisualSettings({ hiddenElementIds: ['BG', 'Body'] });
    assert.equal(runtime.visualBounds, null);
    // A wider Motion must not shrink idle just because it exists in the source.
    runtime.source.motions = [{ id: 'idle', duration: 1 }, { id: 'reach', duration: 1 }];
    runtime.state = { motionId: 'idle', time: 0.25, playing: false };
    let current = 'idle', time = 0;
    let resets = 0;
    runtime.resetMotion = async motion => { resets++; current = motion.id; time = 0; model.update(0.001); runtime.render(); };
    const update = model.update;
    model.update = milliseconds => { time += milliseconds / 1000; update(); };
    const pixels = runtime.app.renderer.extract.pixels;
    runtime.app.renderer.extract.pixels = () => {
      bodyRight = current === 'reach' && time > 0.5 ? 8 : 6;
      return pixels();
    };
    await pageSetVisualSettings({ hiddenElementIds: ['BG'] });
    assert.equal(resets, 0, 'interactive toggles must not replay source motions');
    await runtime.prepareVisualCapture('idle');
    assert.deepEqual(runtime.visualBounds, { x: 2, y: 2, width: 4, height: 4 }, 'unrelated Motion bounds do not shrink idle');
    await runtime.prepareVisualCapture('reach');
    assert.deepEqual(runtime.visualBounds, { x: 2, y: 2, width: 6, height: 4 });
    assert.equal(current, 'idle', 'restore selected motion after measuring the source envelope');
    assert.deepEqual(runtime.state, { motionId: 'idle', time: 0.25, playing: false });
    const preparedResets = resets;
    await runtime.prepareVisualCapture('reach');
    assert.equal(resets, preparedResets, 'capture framing is prepared once per Motion and hidden set');
    await runtime.prepareVisualCapture('idle');
    assert.equal(resets, preparedResets, 'switching back reuses this Motion framing');
    assert.deepEqual(runtime.visualBounds, { x: 2, y: 2, width: 4, height: 4 });
    if (cubismVersion === 4) {
      model.getLocalBounds = () => ({ width: 8, height: 8 });
      internal.getDrawableVertices = index => index === 0 ? [0, 0, 20, 0, 20, 20, 0, 20] : [2, 2, 6, 6];
      internal.coreModel._model.drawables = {
        ids: ['overlay', 'body'], parentPartIndices: [0, 1],
        get opacities() { return [time > 0.5 ? rendered.BG : 0, rendered.Body]; },
      };
      const physics = internal.physics = { marker: 'unchanged' };
      runtime.getVisualElementThumbnail = id => ({ id, dataUrl: rendered[id] > 0 ? 'data:image/png;base64,late-pose' : null });
      await pageSetVisualSettings({ hiddenElementIds: [] });
      const scan = await runtime.scanVisualElements('reach');
      assert.equal(scan.candidates[0].id, 'BG', 'finds a large overlay absent from the first frame');
      assert.ok(scan.candidates[0].time >= 0.5);
      assert.equal(scan.candidates[0].dataUrl, 'data:image/png;base64,late-pose');
      assert.equal(internal.physics, physics);
      assert.equal(runtime.state.playing, false);
      assert.equal(runtime.state.time, 0);
      assert.deepEqual(runtime.visualSettings, { hiddenElementIds: [] });
      await pageSetVisualSettings({ hiddenElementIds: ['BG'] });
      assert.deepEqual((await runtime.scanVisualElements('reach')).candidates, [], 'already hidden Parts do not appear as visible suspects');
      await pageSetVisualSettings({ hiddenElementIds: [] });
      runtime.getVisualElementThumbnail = () => { throw new Error('thumbnail failed'); };
      await assert.rejects(runtime.scanVisualElements('reach'), /thumbnail failed/);
      assert.equal(internal.physics, physics, 'failed scans restore the live physics object');
      assert.deepEqual(runtime.visualSettings, { hiddenElementIds: [] });
    }
  } finally { global.window = previousWindow; }
});
