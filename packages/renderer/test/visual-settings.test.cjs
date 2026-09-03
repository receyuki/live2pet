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
  const internal = new EventEmitter();
  internal.coreModel = {
    _model: { parts: { ids: ['BG', 'Body'] } },
    getPartOpacityById: id => opacity[id], setPartOpacityById: (id, value) => { opacity[id] = value; },
    getPartsOpacity: id => opacity[id], setPartsOpacity: (id, value) => { opacity[id] = value; },
    getPartsDataIndex: id => ['BG', 'Body'].indexOf(id),
    getModelContext: () => ({ arbitraryRuntimeTableName: [{ opaqueField: { id: 'BG' } }, { opaqueField: { id: 'Body' } }, { unrelated: { id: 'Parameter' } }] }),
  };
  let pending = false;
  let rendered = { ...opacity };
  const model = { internalModel: internal, scale: { x: 1 }, x: 0, y: 0, update: () => { pending = true; } };
  const runtime = {
    source: { cubismVersion, motions: [] }, options: {}, state: { time: 0, motionId: null },
    model, fit() { model.scale.x = this.visualBounds ? 2 : 1; }, syncTicker() {},
    app: { stage: {}, stop() {}, renderer: { width: 8, height: 8, extract: { pixels() {
      const pixels = new Uint8Array(8 * 8 * 4);
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
        if (rendered.BG > 0 || (rendered.Body > 0 && x >= 2 && x <= 5 && y >= 2 && y <= 5)) pixels[(y * 8 + x) * 4 + 3] = 255;
      }
      return pixels;
    } } } },
    render() {
      if (pending) {
        internal.emit('beforeMotionUpdate');
        opacity.BG = 0.6; // authored pose/animation tries to restore the background
        internal.emit('beforeModelUpdate');
        rendered = { ...opacity };
        pending = false;
      }
    },
  };
  global.window = { __live2petPixiLive2D: runtime, PIXI: { Rectangle: class {} } };
  try {
    assert.deepEqual((await pageInitializeVisualElements()).map(element => element.id), ['BG', 'Body']);
    await pageSetVisualSettings({ hiddenElementIds: ['BG'] });
    assert.equal(rendered.BG, 0);
    assert.equal(model.scale.x, 2);
    assert.deepEqual(runtime.visualBounds, { x: 2, y: 2, width: 4, height: 4 });
    model.update(10); runtime.render();
    assert.equal(rendered.BG, 0, 'motion/pose cannot unhide the Part');
    await pageSetVisualSettings({ hiddenElementIds: [] });
    assert.equal(rendered.BG, 0.6, 'restore authored opacity, not a hard-coded 1');
    assert.equal(model.scale.x, 1);
    await assert.rejects(pageSetVisualSettings({ hiddenElementIds: ['missing'] }), /no longer available/);
    await pageSetVisualSettings({ hiddenElementIds: ['BG', 'Body'] });
    assert.equal(runtime.visualBounds, null);
    // The second motion reaches farther than the first. Framing must include
    // it even while the UI is paused on the first motion.
    runtime.source.motions = [{ id: 'idle', duration: 1 }, { id: 'reach', duration: 1 }];
    runtime.state = { motionId: 'idle', time: 0.25, playing: false };
    let current = 'idle', time = 0;
    runtime.resetMotion = async motion => { current = motion.id; time = 0; model.update(0.001); runtime.render(); };
    const update = model.update;
    model.update = milliseconds => { time += milliseconds / 1000; update(); };
    const pixels = runtime.app.renderer.extract.pixels;
    runtime.app.renderer.extract.pixels = () => {
      const result = pixels();
      if (current === 'reach' && time > 0.5 && rendered.Body > 0) result[(4 * 8 + 7) * 4 + 3] = 255;
      return result;
    };
    await pageSetVisualSettings({ hiddenElementIds: ['BG'] });
    assert.deepEqual(runtime.visualBounds, { x: 2, y: 2, width: 6, height: 4 });
    assert.equal(current, 'idle', 'restore selected motion after measuring the source envelope');
    assert.deepEqual(runtime.state, { motionId: 'idle', time: 0.25, playing: false });
  } finally { global.window = previousWindow; }
});
