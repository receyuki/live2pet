# Desktop App host boundary

`@live2pet/app-host` is the Electron main/preload contract. It intentionally contains no Electron import, so protocol tests can run in CI without downloading a platform binary.

`inspectSource` accepts only a selected local `inputPath` and an optional filename-safe `projectId`. The injected main-process service calls the shared Source Package inspector and may provide an App-owned bounded cache. Its versioned response contains normalized metadata and warnings, never PCK resource bytes or absolute source paths.

`getRuntimeSettings`, `configureRuntime`, and `clearRuntimeSettings` form the runtime-provisioning boundary. The main process validates a user-selected Cubism Core or Cubism 2 runtime, detects its family, and copies it into the private App runtime library. The schema-v2 response lists at most one modern and one legacy descriptor and omits storage paths and runtime bytes. A valid schema-v1 external path is migrated on first load. This App-managed library is the Desktop source of truth; browser-only use may keep its own bounded preview copy.

The main process creates one router on the fixed `live2pet:app` channel. The preload exposes only typed methods; renderer code cannot access `ipcRenderer`, Node, filesystem paths, or child processes. V1 exposes no hosted Mapper Session, Codex Skill installer, separate preview window, or official Cubism Framework bridge.

`buildProject` accepts only a project, target inputs, metadata, and serializable build options. It returns buffered progress, a binary-free summary, and short-lived artifact metadata. The main process also forwards allowlisted progress over `live2pet:build-progress`; each event has a protocol version, opaque build id, and monotonically increasing sequence. `cancelBuild` aborts only the active build and preserves the last successful artifact.

`getBuildArtifact` retrieves an artifact by opaque id and validated offset in chunks of at most 1 MiB. RGBA buffers, ZIP bytes, cache paths, and absolute source paths are not included in ordinary IPC summaries. The App injects its private capture and encoded-asset caches, so renderer input cannot select a cache store or identity.

`chooseInstallRoot` and `installArtifact` are V1 features. The native picker returns a short-lived opaque location id; the absolute path remains in the main process. Installation accepts only a current artifact id, matching Target Profile, `cancel`/`upgrade`/`side-by-side` conflict policy, and `confirmInstall: true`. Building and downloading never install implicitly. Codex and Clawd artifacts can be downloaded or installed independently.

Clawd capture transports bounded deflate stacks when available, and the App validates dimensions, contiguity, and decompressed sizes before WebP encoding. Captures and encoded assets use the private integrity-checked LRU cache keyed by source fingerprint, runtime, renderer, Animation Recipe, Target Profile, Render Preset, and encoder identity. The Mapper sees aggregate cache status only.

For generated previews, the Mapper reads the opaque artifact in memory. Clawd preview uses packaged WebP files and manifest fallbacks; Codex preview uses target-sized captured frames and the 192 x 208 row layout. These are deterministic generated-asset checks, not replacements for importing each package into its real host during release acceptance.

The App shell ships a self-contained staged Mapper bundle. Public makers, signing, notarization, and distribution remain behind the release gates.
