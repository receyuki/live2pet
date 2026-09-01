# Live2Pet desktop shell

This Electron shell is the first desktop host for the shared mapper. It loads the local mapper page with a sandboxed, context-isolated window and exposes only the typed `window.live2pet` API from `@live2pet/app-host`.

The main process owns the Mapper Session host and resolves either the repository
Mapper during development or the staged Mapper bundle from `process.resourcesPath`
in a packaged build. It also injects the shared Package Build service into the
typed `buildProject` IPC method; that response is a binary-free summary with
short-lived artifact handles, and `getBuildArtifact` retrieves each result in
validated chunks of at most 1 MiB. The Mapper reports this transfer separately
from the completed package build, then opens the ZIP through a Blob reader and
extracts only the currently previewed Clawd WebP. Building does not implicitly
install anything. Renderer requests cannot choose arbitrary mapper files,
invoke shell commands, or access the bearer token. Forge makers/signing are not
configured until the macOS source-release gates pass. `forge.config.cjs` records
the future packager resource path, but the Forge CLI is not a workspace
dependency yet because its current rebuild chain is rejected by the repository's
exotic-subdependency policy.

The main process also injects the shared Source Package inspector into the typed
`inspectSource` method. Standard directories and supported Destiny Child PCK
files therefore produce the same normalized manifest as the CLI. PCK-derived
resources are retained only in an App-owned bounded cache under the Electron
user-data directory; the renderer receives metadata and warnings, never source
or runtime bytes.

Runtime provisioning is exposed through `getRuntimeSettings`,
`configureRuntime`, and `clearRuntimeSettings`. One picker accepts either a
modern Core or Cubism 2 JavaScript runtime; the main process validates its
contents, detects the runtime family, and copies the entrypoint into a private
library under the App user-data directory. Modern and legacy entries coexist,
and the renderer selects one from the inspected Cubism generation. A valid
legacy path-based setting is migrated into this library automatically. The
renderer receives metadata, never runtime bytes or a path. The current Mapper
also keeps its bounded browser-profile copy so a selected runtime can refresh
the in-page preview; neither copy is part of a project, cache artifact, package,
source checkout, or release.

The Desktop App also exposes the repository's text-only Codex skill bundle
through `getSkillStatus` and `installSkill`. The Mapper shows whether the
bundled `live2pet` skill is available, missing, invalid, or out of date. An
installation or upgrade requires a separate user confirmation and is committed
atomically by the main process into the user's Codex skills directory. The
renderer receives only the skill id, digest, file count, and status; it never
receives the destination path or skill contents. Development builds read from
`skills/live2pet`; packaged builds stage the same source at the private
`live2pet-skill` resource path. User-provided skill edits are not overwritten
unless the user explicitly confirms an upgrade.

The desktop shell also includes a separate renderer-realm host for Live2D
preview. It creates a transparent BrowserWindow with Node integration off,
context isolation, sandboxing, strict CSP, and a loopback-only asset server for
the selected Source Package plus runtime file. Adapter selection follows the
inspected Cubism generation (legacy Cubism 2 versus modern Cubism 3–5). If the
model, runtime, page bootstrap, or renderer process fails, the host unloads the
adapter and destroys that window; the main Mapper window remains available and
an explicit restart creates a fresh realm. Its `loadSource()` helper accepts the
inspection manifest's relative `modelConfig`, resolves it through the same
loopback server, and rejects a mismatched Cubism generation before touching the
renderer.

Electron 44 no longer guarantees the legacy `File.path` property in a sandboxed
renderer. The App preload therefore exposes only the typed `webUtils.getPathForFile`
result needed to resolve the selected Source Package directory for the isolated
preview; browser-only Mapper sessions keep the helper unavailable.

The Mapper exposes this host through a narrow App IPC session: **Open isolated
preview**, **Restart preview**, and **Close preview**. Only a standard local
Source Package directory can be opened in this window; reconstructed PCK files
continue to use the browser preview because they do not have a directory that
the loopback server can safely serve. Preview commands are limited to Motion /
Expression playback, playback controls, state, and bounds; RGBA capture and
filesystem operations are not exposed through this UI. The saved runtime is
resolved in the main process, and neither runtime bytes nor absolute paths cross
the App boundary. Pixi remains the default modern renderer. An advanced host
integration can opt into the official Web Framework bridge by passing
`modernAdapter: 'official'` and a user-provided `frameworkPath`; the bundle is
served only through the same loopback asset server and must expose the
documented `createRenderer` bridge global. The official Framework and Cubism
Core are still user-provided and are never staged by `prepare:mapper`.

The shared Mapper exposes both Codex Pet and Clawd Theme build actions. Clawd
captures mapped Motion frames in the renderer and sends them through the same
typed `buildProject` service; the returned ZIP is available only through an
explicit `getBuildArtifact` download. Browser-only Mapper sessions keep the
Clawd build action disabled because they do not provide the trusted App encoder.
The UI starts in English and includes a persisted English/Chinese (`zh-CN`)
locale switch; locale text does not alter project, IPC, or package schemas.
After a successful App build, the Mapper can preview the generated Clawd WebP
assets by state or reaction directly from the in-memory ZIP artifact. This
preview follows manifest fallbacks; it does not yet replace a full Clawd runtime
behavior simulation. The same artifact can be installed from the Mapper through
an explicit confirmation step. The install control offers cancel, upgrade, and
side-by-side conflict policies and uses the platform adapter's default target
root by default. The Desktop App can also open a native folder picker; the
renderer receives only a short-lived opaque location id while the selected path
stays in the main process. Browser-only sessions continue to use download/export
instead of installation.

Build progress is streamed over a versioned, path-redacted IPC event channel and
shown in the Mapper for both targets. Live2D capture stays sequential on the
single preview renderer, but it now advances the animation with deterministic
fixed steps, reuses its capture surfaces, and batches Clawd RGBA frames into
bounded deflate stacks before the IPC handoff. The App keeps those validated
capture stacks in a private one-GiB LRU cache keyed by the source fingerprint,
saved runtime, renderer, Motion plus optional Animation Recipe Expression, Target
Profile, and Render Preset; a
repeat build can therefore skip the renderer capture entirely. After capture,
Clawd WebP assets are encoded with a bounded worker pool (two concurrent assets
by default) while output order stays stable. The event stream includes stage
transitions and per-Motion encoding updates, so long builds remain observable
without exposing frame bytes or local paths to the renderer.
While a build is active, the Mapper also exposes a target-scoped Cancel build
control. It aborts local renderer capture immediately and requests cancellation
from the main-process Package Build service through the active opaque build id.
Cancellation does not replace the last successful artifact, and it never
installs or downloads a partial package.

From the repository root, install workspace dependencies and run:

```text
pnpm --filter @live2pet/desktop start
```

Before a package build, stage the browser dependencies into a self-contained Mapper bundle:

```text
pnpm --filter @live2pet/desktop prepare:mapper
```

To compare the bounded stacked transport with the former per-frame transport
using a copyright-safe synthetic RGBA workload, run:

```text
pnpm --filter @live2pet/desktop benchmark:capture
```

The command reports compression calls, elapsed time, and payload size only; it
does not load a model or runtime and is not a substitute for an opt-in real
model capture smoke test.

The staging step copies only Pixi, the matching Pixi `@pixi/unsafe-eval`
compatibility bundle, the Pixi Live2D adapter, and zip.js. It
rewrites the shared Mapper to use local `vendor/` paths and emits hashes and
third-party license notices. Cubism Core and legacy runtimes are never staged;
they remain user-provided and local.

The package does not include models, examples, or generated packages. Those
remain user-provided and local.

The source-release policy and the separate installer gate are documented in
[`../../docs/release-checklist.md`](../../docs/release-checklist.md). The
dependency and native-binary boundary is recorded in
[`../../docs/dependency-inventory.md`](../../docs/dependency-inventory.md);
security reporting and contribution rules live in [`../../SECURITY.md`](../../SECURITY.md)
and [`../../CONTRIBUTING.md`](../../CONTRIBUTING.md).

The Mapper also keeps a bounded, reference-only draft in the browser profile
while a project is dirty. It offers explicit recovery on the next launch and
shows the affected recipe ids when a loaded Source Package fingerprint changes;
both Codex and Clawd builds stay disabled until the source review is
acknowledged. See [`docs/agents/project-workflow.md`](../../docs/agents/project-workflow.md)
for the project privacy and relinking contract.

The shared Mapper also keeps a bounded 100-step history for project edits. The
Undo and Redo buttons are keyboard accessible (`⌘Z`/`Ctrl+Z` and
`⇧⌘Z`/`Ctrl+Y`), and source/project loads start a fresh history boundary. Only
project metadata and mappings enter that history; source files, runtime bytes,
renderer objects, and generated packages remain outside it.

The source-preview panel exposes Pause, Resume, Restart, Loop, and speed
controls. With an isolated Desktop renderer open these use the typed renderer
command seam; the in-window browser fallback supports pause/resume/restart and
clearly reports that loop and speed settings apply to the isolated renderer.
