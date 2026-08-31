# Pixi Live2D renderer adapter

`PixiLive2dAdapter` is the temporary browser bridge for the shared renderer contract. `LegacyPixiLive2dAdapter` is an explicit Cubism 2 boundary over the same bridge; it accepts only `cubismVersion: 2` sources and preserves legacy Expression indexes. Both adapters reuse the Pixi and `pixi-live2d-display` versions already used by the prototype, but they do **not** bundle Cubism Core, a legacy runtime, a model, or a texture.

The same package exports host helpers for the Electron integration: `createRendererWindowOptions` applies the required `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`, and web-security defaults; `createRendererCsp` produces the restrictive document policy; and `createRendererIpcRouter`/`createRendererPreloadApi` expose only the 13 renderer-contract methods over the `live2pet:renderer` channel. `createRendererAssetServer` serves only the selected Source Package root plus one explicitly selected runtime file over loopback, with real-path containment checks. `createRendererRealmHost` owns one BrowserWindow-like realm and destroys it on page, process, or unknown renderer failures; `restart()` always creates a new generation. `createElectronWebContentsPage` is the narrow fixed-function bridge used by the desktop host.

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

The host is responsible for serving `modelUrl` and its referenced files. Keep that server loopback-only and path-confined to the user-selected Source Package. The desktop shell's `renderer-host.cjs` now wires this policy to an isolated Electron window, selects the legacy adapter only for inspected Cubism 2 sources, and waits for a dependency bootstrap marker before exposing the renderer contract. A model/runtime failure disposes the realm; the main Mapper window remains alive and the caller can explicitly restart it.

The adapter currently targets modern Cubism through the existing Pixi prototype. `selectPixiLive2dAdapter()` and `createPixiLive2dAdapter()` choose the modern or legacy boundary from the inspected `cubismVersion`; file names and Motion names are never used as a heuristic. Cubism 2 remains a separate compatibility adapter and is not silently mixed into this path. The opt-in integration test in `test/legacy-runtime.integration.test.cjs` exercises the real adapter against user-provided files when `LIVE2PET_CUBISM2_RUNTIME` and `LIVE2PET_CUBISM2_SOURCE` are set; it is skipped in clean CI and never downloads or copies those files.

For a local compatibility check (using a separately licensed runtime and
model directory), run:

```sh
LIVE2PET_CUBISM2_RUNTIME=/path/to/live2d.min.js \
LIVE2PET_CUBISM2_SOURCE=/path/to/c311_02 \
pnpm --filter @live2pet/renderer test
```

The test starts a loopback-only asset server, verifies Motion/Expression
playback, captures transparent RGBA, checks bounds, and unloads the adapter.
It does not add either input to the repository or any build/cache artifact.
