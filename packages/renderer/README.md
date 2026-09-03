# Live2Pet Live2D renderer adapters

The renderer package exposes one shared playback/capture contract over two
Pixi generations:

- `PixiLive2dAdapter` handles inspected Cubism 3, 4, and 5 sources.
- `LegacyPixiLive2dAdapter` handles only Cubism 2 sources and preserves legacy
  Expression indexes.

`selectRendererAdapter()` and `createRendererAdapter()` choose between these
adapters only from the inspected `cubismVersion`. File names and Motion names
are never used as generation heuristics. Both adapters reuse Pixi and
`pixi-live2d-display`; this package does not bundle Cubism Core, a legacy
runtime, a model, or a texture.

The host owns a browser page and passes an object with
`evaluate(function, ...args)`. Before calling `load`, it must load:

1. Pixi 6.x;
2. the matching `pixi-live2d-display` adapter; and
3. a user-provided, compatible Cubism runtime.

The page may contain a `#live2pet-stage` canvas. If it does not, the adapter
creates one and removes it on `unload`.

```js
const { createRendererAdapter } = require('@live2pet/renderer');

const renderer = createRendererAdapter({
  cubismVersion: 4,
  page,
  width: 512,
  height: 512,
  playbackMode: 'realtime',
});

await renderer.load({
  modelUrl: '/user-source/model.model3.json',
  cubismVersion: 4,
  motions: [
    { id: 'Base:idle', group: 'Base', index: 0, duration: 2 },
  ],
  expressions: [],
});
await renderer.playMotion('Base:idle');
const frame = await renderer.captureRgba({
  width: 256,
  height: 256,
  motionId: 'Base:idle',
  time: 0.5,
});
```

## Host integration

`createRendererWindowOptions` applies the required Electron isolation and
web-security defaults. `createRendererCsp` produces the restrictive document
policy. `createRendererIpcRouter` and `createRendererPreloadApi` expose only the
15 renderer-contract methods, including `getVisualElements` and
`setVisualSettings`, over the `live2pet:renderer` channel. Renderers with no
separable elements return an empty list and reject non-empty hidden settings.

`createRendererAssetServer` serves either the selected Source Package root or
an inspected PCK resource map, plus one explicitly selected runtime file, over
loopback. Directory sources use real-path containment checks; PCK resources are
copied into an exact normalized-path allowlist. The host is responsible for
serving `modelUrl` and its referenced files through this boundary.

Pixi adapters default to `playbackMode: 'manual'` for deterministic capture.
An embedded interactive preview opts into `playbackMode: 'realtime'`, which
owns the page-local Pixi ticker while playing. Explicit stepping and RGBA
capture suspend that ticker temporarily, so both modes continue to share the
same renderer contract.

`createRendererRealmHost` owns one BrowserWindow-like realm and destroys it on
page, process, or unknown renderer failures. `restart()` always creates a new
generation, so a model/runtime failure does not take down the main Mapper
window. `createElectronWebContentsPage` is the narrow fixed-function bridge
used by the desktop host.

## Optional integration tests

### Project visibility

Both production Pixi adapters expose `getVisualElements()` with stable Part
identities, optional parent identities and display-info names, and
`setVisualSettings({ hiddenElementIds })`. The Desktop Map lets users select
these manually; names never trigger automatic hiding. Solo is temporary and
preserves the selected Part's ancestor/descendant chain. It is never saved.

Hidden opacity is applied after animation/pose and before Core updates its
drawables. The next frame restores authored opacity before animation runs;
showing a Part therefore restores the model's authored value rather than
forcing opacity to one. Transparent-pixel bounds sampled at nine poses per source
Motion form a stable animation envelope; resize reuses those local bounds. This
is sampled framing, not proof of containment at every possible physics pose.
Preview and both target captures receive the same project settings, including
after renderer recovery.

Cubism 2 has no public Part enumeration method: its adapter finds stable ID
objects in bounded model-context tables and validates them through the runtime's
public Part lookup. No minifier-specific field names are assumed. Combined
background/character Parts cannot be split by these controls. No model or
runtime file is changed.

### Desktop pixel transfer

The Electron page explicitly advertises binary result support. Captures return
the extracted `Uint8Array` through `executeJavaScript` instead of expanding RGBA
into millions of JavaScript numbers. The adapter validates dimensions and byte
length and preserves typed-array offsets. Browser-only test hosts retain their
serializable-array path. No resolution, frame-count, timing, alpha, or encoding
quality change is part of this optimization; cancellation still checks each frame.

The integration tests exercise the real adapters only when separately licensed
runtime and model paths are supplied. They are skipped in clean CI and never
download or copy those inputs.

```sh
LIVE2PET_CUBISM2_RUNTIME=/path/to/live2d.min.js \
LIVE2PET_CUBISM2_SOURCE=/path/to/cubism2-model \
pnpm --filter @live2pet/renderer test

LIVE2PET_MODERN_RUNTIME=/path/to/live2dcubismcore.min.js \
LIVE2PET_MODERN_SOURCE=/path/to/cubism3-model \
pnpm --filter @live2pet/renderer test
```

Each test starts the loopback asset server, verifies Motion and Expression
playback, captures transparent RGBA, checks bounds, and unloads the adapter.
