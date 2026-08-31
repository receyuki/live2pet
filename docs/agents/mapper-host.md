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

This boundary is intentionally separate from Electron IPC. The eventual App must expose only typed preload methods to the renderer, keep Node integration disabled, and package the Mapper's local dependencies instead of relying on the prototype's development paths.

The Mapper UI includes an English-default, Chinese (`zh-CN`) translation layer. The language selector persists only the locale preference in browser storage; source assets, runtimes, and project contents remain local. A selected Cubism runtime is additionally stored as bounded source text in a browser-profile IndexedDB store and restored on the next launch; the **Clear saved runtimes** action deletes that store without unloading the active runtime. Target ids, project schema keys, and generated package metadata stay language-neutral.

The browser preview loads the version-matched Pixi `@pixi/unsafe-eval` compatibility bundle after Pixi. This replaces Pixi's generated uniform functions with static upload functions for strict-CSP environments; the Mapper CSP allows `blob:` only for object URLs created from the user's local source files and does not add general `'unsafe-eval'`.

When the App preload exposes `buildProject` and `getBuildArtifact`, the Mapper can capture the selected Clawd Motion ids and request a guide-shaped Clawd Theme ZIP through the shared Package Build service. Browser-only sessions intentionally keep this button disabled because the browser fallback is not an equivalent Clawd encoder; preview and mapping remain available.

After a successful App build, the Mapper reads only the returned ZIP artifact in memory, extracts the generated WebP assets with the staged zip.js reader, and offers a state/reaction picker for the target preview. The preview is derived from packaged assets and manifest fallbacks rather than replaying the source Live2D Motion; object URLs are revoked when a new source or build replaces it.
