const assert = require('node:assert/strict');
const test = require('node:test');
const { PixiLive2dAdapter, pageLoad, pageUnload, DEFAULT_OPTIONS } = require('../src/index.cjs');

async function withRealm(data, callback, { failLoad = false, invalidBounds = false } = {}) {
  const previous = { window: global.window, document: global.document };
  const created = [], calls = { destroyed: 0 };
  class Manager { createMotion(value) { created.push(value); return value; } }
  const original = Manager.prototype.createMotion;
  const manager = new Manager();
  const model = { scale: { set() {} }, getLocalBounds: () => ({ x: 0, y: 0, width: invalidBounds ? 0 : 10, height: 20 }), internalModel: { motionManager: manager } };
  const canvas = { style: {} };
  global.document = { querySelector: () => canvas, body: { appendChild() {} } };
  global.window = { PIXI: { Application: class {
    constructor(options) { this.ticker = {}; this.stage = { addChild() {} }; this.renderer = { width: options.width, height: options.height, render() {} }; }
    stop() {} destroy() { calls.destroyed++; }
  }, live2d: { Cubism4MotionManager: Manager, Live2DModel: { async from() { manager.createMotion(data, 'Idle', { File: 'idle.motion3.json' }); if (failLoad) throw new Error('load failed'); return model; } } } } };
  try { await callback({ created, calls, Manager, original, manager }); }
  finally { await pageUnload(); Object.assign(global, previous); }
}
const source = { modelUrl: '/model.json', cubismVersion: 3, motions: [], expressions: [] };
const curve = { Target: 'Parameter', Id: 'ParamAngleX', Segments: [0, 0, 0, 1, 1] };

test('corrects only stale valid CurveCount metadata in memory and restores the hook on unload', async () => {
  const data = { Version: 3, Meta: Object.freeze({ CurveCount: 2 }), Curves: [curve] };
  await withRealm(data, async ({ created, Manager, original }) => {
    const loaded = await pageLoad(source, DEFAULT_OPTIONS);
    assert.equal(created[0].Meta.CurveCount, 1);
    assert.equal(data.Meta.CurveCount, 2);
    assert.equal(created[0].Curves, data.Curves);
    assert.equal(loaded.warnings[0].code, 'CUBISM_MOTION_CURVE_COUNT');
    await pageUnload();
    assert.equal(Manager.prototype.createMotion, original);
  });
});

test('normal and malformed motion documents retain their original identity', async () => {
  for (const data of [
    { Version: 3, Meta: { CurveCount: 1 }, Curves: [curve] },
    { Version: 2, Meta: { CurveCount: 2 }, Curves: [curve] },
    { Version: 3, Meta: { CurveCount: -1 }, Curves: [curve] },
    { Version: 3, Meta: { CurveCount: 2 }, Curves: [{ Target: 'Parameter' }] },
  ]) await withRealm(data, async ({ created }) => {
    await pageLoad(source, DEFAULT_OPTIONS);
    assert.equal(created[0], data);
  });
});

test('failed model loading and post-load setup restore the prototype and release the App', async () => {
  for (const options of [{ failLoad: true }, { invalidBounds: true }]) await withRealm({ Version: 3, Meta: { CurveCount: 2 }, Curves: [curve] }, async ({ Manager, original, calls }) => {
    await assert.rejects(pageLoad(source, DEFAULT_OPTIONS));
    assert.equal(Manager.prototype.createMotion, original);
    assert.equal(calls.destroyed, 1);
  }, options);
});

test('lazy motion creation keeps the scoped correction and emits one warning per file', async () => {
  await withRealm({ Version: 3, Meta: { CurveCount: 1 }, Curves: [curve] }, async ({ manager, created }) => {
    await pageLoad(source, DEFAULT_OPTIONS);
    const data = { Version: 3, Meta: { CurveCount: 4 }, Curves: [curve] };
    manager.createMotion(data, 'Tap', { File: 'lazy.motion3.json' });
    manager.createMotion(data, 'Tap', { File: 'lazy.motion3.json' });
    assert.equal(created.at(-1).Meta.CurveCount, 1);
    assert.equal(data.Meta.CurveCount, 4);
    assert.equal(global.window.__live2petPixiLive2D.warnings.length, 1);
  });
});

test('failed Visual Element initialization releases the loaded model and motion hook', async () => {
  await withRealm({ Version: 3, Meta: { CurveCount: 2 }, Curves: [curve] }, async ({ Manager, original, calls }) => {
    const renderer = new PixiLive2dAdapter({ page: { evaluate(fn, ...args) {
      if (fn.name === 'pageInitializeVisualElements') throw new Error('element initialization failed');
      return fn(...args);
    } } });
    await assert.rejects(renderer.load(source), /element initialization failed/);
    assert.equal(Manager.prototype.createMotion, original);
    assert.equal(calls.destroyed, 1);
    assert.equal(renderer.getState().loaded, false);
  });
});
