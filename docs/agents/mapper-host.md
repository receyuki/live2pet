# Mapper host integration

`@live2pet/mapper-session` contains the host boundary used by the future Electron main process and by local browser previews. It does not expose a general local web server.

```js
const { startMapperSessionHost } = require('@live2pet/mapper-session');

const host = await startMapperSessionHost({
  project,
  mapperPath: '/path/to/apps/mapper/index.html',
  mapperUrl: 'file:///path/to/apps/mapper/index.html',
  mapperAssetRoot: '/path/to/apps/mapper-dist',
});

const launch = host.getLaunchDescriptor();
// Pass launch.mapperUrl to the trusted browser host. Do not serialize a token.
```

The helper reads only the explicitly supplied Mapper document, enforces the 4 MiB document limit, and accepts only a `file:` URL or a loopback `http:` URL. `mapperAssetRoot` is optional and is intended for a packaged, pre-staged Mapper bundle: it recursively snapshots at most 128 regular files (16 MiB per file, 64 MiB total), rejects symlinks and traversal, and serves only those exact relative paths from the loopback session. It is an allowlisted asset map, not a general filesystem server. For a `file:` Mapper, it automatically allowlists the browser's opaque `null` Origin and still permits the session's own loopback origin for trusted programmatic clients. The URL fragment contains a one-time bootstrap code, not the bearer token. The Mapper exchanges it at `POST /bootstrap`, removes the fragment from its history entry, and keeps the returned token in memory.

The host descriptor contains only the protocol version, session id, loopback API origin, expiry, and launch URL. Keep the returned host handle private to the App main process; use `getClient()` for typed project operations and `close()` when the mapping task ends.

This boundary is intentionally separate from Electron IPC. The App shell now has a parallel Live2D renderer-realm host under `apps/desktop/renderer-host.cjs`: it creates a dedicated BrowserWindow with Node integration disabled, context isolation, sandboxing, strict CSP, and a loopback-only Source Package/runtime server. The main Mapper still exposes only typed preload methods and never receives model/runtime bytes. Renderer process, page-bootstrap, and unknown adapter failures unload the adapter and destroy the isolated window; `restart()` creates a fresh generation. The App IPC layer exposes a one-session `startRendererPreview` / `loadRendererSource` / `rendererCommand` / `restartRendererPreview` / `closeRendererPreview` flow. Commands are limited to playback, Expression selection, state, and bounds; binary capture stays in the build path. The Mapper's **Open isolated preview** control accepts standard local directories; PCK resources remain in the in-browser reconstructed preview. ADR-0011 makes the Pixi/Cubism bridge the personal-use V1 production path; the official modern Web Framework bridge remains experimental and post-V1.

The Mapper UI includes an English-default, Chinese (`zh-CN`) translation layer. The language selector persists only the locale preference in browser storage; source assets, runtimes, and project contents remain local. A selected Cubism runtime is additionally stored as bounded source text in a browser-profile IndexedDB store and restored on the next launch; the **Clear saved runtimes** action deletes that store without unloading the active runtime. Target ids, project schema keys, and generated package metadata stay language-neutral.

Project edits in the shared Mapper have a bounded 100-step history. The project toolbar exposes keyboard-accessible **Undo** and **Redo** controls; `⌘Z`/`Ctrl+Z` undoes, `⇧⌘Z`/`Ctrl+Y` redoes, and edits made after an undo replace the redo branch. Source/package loads establish a new history boundary, while undoing back to a clean state removes the local autosave draft. History stores only project metadata, mappings, behavior settings, and review state; source files, runtime bytes, renderer objects, and generated artifacts are never copied into it.

The source-preview panel exposes Pause, Resume, Restart, Loop, and playback-speed controls. When the isolated Desktop renderer is open, every control is forwarded through the typed renderer command boundary (`pause`, `resume`, `restart`, `setLoop`, `setSpeed`); the in-window Pixi preview keeps pause/resume/restart available as a local fallback, while speed and loop are explicitly reported as isolated-preview settings because the browser fallback does not alter its third-party motion clock.

The browser preview loads the version-matched Pixi `@pixi/unsafe-eval` compatibility bundle after Pixi. This replaces Pixi's generated uniform functions with static upload functions for strict-CSP environments; the Mapper CSP allows `blob:` only for object URLs created from the user's local source files and does not add general `'unsafe-eval'`.

When the App preload exposes `buildProject` and `getBuildArtifact`, the Mapper can capture the selected Clawd Motion ids and request a guide-shaped Clawd Theme ZIP through the shared Package Build service. Browser-only sessions intentionally keep this button disabled because the browser fallback is not an equivalent Clawd encoder; preview and mapping remain available.

When a target slot has a `recipeMappings` entry, the shared build resolves its Animation Recipe before capture. The renderer applies that recipe's Expression for every sampled frame, restores the previous preview Expression afterward, and records the Expression id in the capture metadata. Render-candidate and App capture-cache identities include the Expression, so a base-Expression capture can never be reused for a recipe that asks for a different Expression. Legacy projects without `recipeMappings` continue to capture with the model's base Expression.

After a successful App build, the Mapper reads only the returned ZIP artifact in memory, extracts the generated WebP assets with the staged zip.js reader, and offers a state/reaction picker for the target preview. The preview is derived from packaged assets and manifest fallbacks rather than replaying the source Live2D Motion; object URLs are revoked when a new source or build replaces it.
