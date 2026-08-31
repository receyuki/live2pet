# Desktop App host boundary

`@live2pet/app-host` is the Electron main/preload contract. It intentionally contains no Electron import, so protocol tests can run in CI without downloading a platform binary.

`inspectSource` accepts only a selected local `inputPath` and an optional filename-safe `projectId`. The injected main-process service calls the shared Source Package inspector and may provide an App-owned bounded cache. The response is the same versioned, binary-free normalized manifest returned by the CLI, with a short `inspect` progress event and warnings. Absolute paths and binary values are rejected or redacted at the App boundary; the renderer never receives PCK resource bytes through this method.

`getRuntimeSettings`, `configureRuntime`, and `clearRuntimeSettings` are the
runtime provisioning boundary. The main process injects a service backed by the
App user-data directory; `configureRuntime` validates a user-selected local
Cubism Core or Cubism 2 runtime, detects its family, and copies the validated
entrypoint into a private App runtime library. The schema-v2 response lists at
most one modern and one legacy descriptor, deliberately omits all storage paths
and runtime bytes, and applies changes without an App restart. The renderer
selects the matching entry from the inspected Cubism generation. A valid
schema-v1 external path is migrated into this private library on first load, so
moving the original download afterward does not break rendering. The Mapper
may still keep its browser-profile copy for in-page preview, but App-owned
rendering uses the private library as its source of truth.

The main process creates one router and registers it on the fixed `live2pet:app` channel:

```js
const { ipcMain } = require('electron');
const { buildProjectTargets } = require('@live2pet/package-build');
const { installPackage } = require('@live2pet/installation');
const { createAppIpcRouter } = require('@live2pet/app-host');

const route = createAppIpcRouter({ buildProjectService: buildProjectTargets, installPackageService: installPackage });
ipcMain.handle('live2pet:app', (_event, request) => route(request));
```

The preload exposes only the typed methods returned by `createAppPreloadApi`. Renderer code cannot access `ipcRenderer`, Node, filesystem paths, or child processes. The router owns the active Mapper Session handle and returns only its launch descriptor; the bearer token remains inside the host-side client closure.

`buildProject` is available when the main process injects the shared `buildProjectTargets` service. Its input is limited to a project, target inputs, metadata, and serializable build options; renderer callbacks and arbitrary services are not accepted. The response contains buffered progress events, a build summary, and short-lived artifact metadata, while RGBA buffers, spritesheet bytes, and ZIP buffers are deliberately omitted from that response. During the build, the main process also forwards the same allowlisted events over `live2pet:build-progress`. Each event carries the protocol version, a build id, and a monotonically increasing sequence number so the Mapper can render stage and per-Motion progress without receiving paths or binary data. `getBuildArtifact` retrieves an artifact by opaque id and validated byte offset for an explicit UI download. Each response carries at most 1 MiB of bytes plus `offset`, `nextOffset`, and `done` metadata, so the renderer retrieves large artifacts sequentially without one oversized IPC reply. Omitting the offset starts at zero, and the in-memory artifact store is cleared when the active session closes or a new build starts.

`installArtifact` is available when the main process injects the shared `installPackage` service. It accepts only a current artifact id, its matching Target Profile, a `cancel`/`upgrade`/`side-by-side` conflict policy, and `confirmInstall: true`. The renderer cannot provide an arbitrary target path; the installation service resolves the documented platform default root. The response redacts the resolved path, returns only package metadata and progress, and installation is never triggered by `buildProject` or `getBuildArtifact`. The in-memory store replaces artifacts only for the Target Profiles included in a new build, so the latest Codex and Clawd artifacts can be downloaded or installed independently; closing the session clears both.

The shared Mapper uses the same seam for both target profiles. A Clawd build sends `framesByMotion` captured from the local Live2D preview, a project-owned metadata object, and the selected Render Preset; before crossing Electron IPC, captured RGBA frames are grouped into bounded `rgbaChunks` stacks and use the `deflate-stack-v1` transport when the local Web Platform `CompressionStream("deflate")` is available. The App validates dimensions, chunk contiguity, and decompressed sizes before WebP encoding. Captured stacks are also persisted in an App-private one-GiB LRU cache keyed by the source fingerprint, saved runtime, renderer, Motion recipe, Target Profile, and Render Preset, so repeat Clawd builds can skip renderer capture. The App returns only the validated build summary and an opaque artifact handle. The Mapper's English/Chinese UI is presentation-only and does not alter the IPC or target contract.

The Mapper can consume that opaque Clawd artifact in memory after the build: it extracts only the generated WebP entries for a target preview picker, while the IPC summary remains binary-free and installation remains a separate explicit operation. The shared Package Build preview now carries the Clawd behavior plan for idle pools, sleep transitions, reactions, working/juggling tiers, and free-roam orientation; the Mapper uses that plan to expose behavior scenarios without embedding the Clawd runtime. This remains a deterministic generated-asset simulation, not a replacement for clean-machine import acceptance in Clawd itself.

Live2D capture remains sequential because it is tied to one renderer and one animation clock. Once captures have crossed the App boundary, Clawd WebP encoding uses a bounded worker pool (two Motion assets by default, with a configurable limit of eight) and preserves mapping/manifest order. The progress stream reports capture, validation, per-Motion encoding, packaging, preview, and report stages; a failed progress delivery never fails the build itself.

`startMapperSession` accepts the same explicit options as `startMapperSessionHost` (`project`, `mapperPath` or `mapperHtml`, optional `mapperUrl`, and session lifetime). Only one session is active per App window. The host must call `closeMapperSession` when the mapping task ends.

This package is the seam for the future Electron Forge shell. The shell still needs to package local mapper dependencies and replace the prototype's development-relative scripts before it can be released as a runnable desktop installer.
