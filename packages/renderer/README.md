# Pixi Live2D renderer adapter

`PixiLive2dAdapter` is the temporary browser bridge for the shared renderer contract. It reuses the Pixi and `pixi-live2d-display` versions already used by the prototype, but it does **not** bundle Cubism Core, a legacy runtime, a model, or a texture.

The same package exports host helpers for the next Electron integration: `createRendererWindowOptions` applies the required `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`, and web-security defaults; `createRendererCsp` produces the restrictive document policy; and `createRendererIpcRouter`/`createRendererPreloadApi` expose only the 13 renderer-contract methods over the `live2pet:renderer` channel. `createRendererAssetServer` serves only the selected Source Package root plus one explicitly selected runtime file over loopback, with real-path containment checks.

The host owns the browser window (an Electron `webContents`, an embedded WebView, or a test page) and passes an object with `evaluate(function, ...args)`. Before calling `load`, the host must load:

1. Pixi 6.x;
2. `pixi-live2d-display`'s Cubism adapter; and
3. a user-provided, compatible Cubism Core/runtime script.

The page may contain a `#live2pet-stage` canvas. If it does not, the adapter creates one and removes it on `unload`.

```js
const { PixiLive2dAdapter } = require('@live2pet/renderer');

const renderer = new PixiLive2dAdapter({ page, width: 512, height: 512 });
await renderer.load({
  modelUrl: '/user-source/model.model3.json',
  cubismVersion: 4,
  motions: [
    { id: 'Base:idle', group: 'Base', index: 0, duration: 2 },
  ],
  expressions: [],
});
await renderer.playMotion('Base:idle');
const frame = await renderer.captureRgba({ width: 256, height: 256, motionId: 'Base:idle', time: 0.5 });
```

The host is responsible for serving `modelUrl` and its referenced files. Keep that server loopback-only and path-confined to the user-selected Source Package. A production App must put the page in an isolated renderer realm and destroy/recreate it when model or runtime code fails; this adapter deliberately leaves that policy to the host.

The adapter currently targets modern Cubism through the existing Pixi prototype. Cubism 2 remains a separate compatibility adapter and is not silently mixed into this path.
