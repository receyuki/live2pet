# Live2Pet desktop shell

This Electron shell is the first desktop host for the shared mapper. It loads the local mapper page with a sandboxed, context-isolated window and exposes only the typed `window.live2pet` API from `@live2pet/app-host`.

The main process owns the Mapper Session host and resolves either the repository
Mapper during development or the staged Mapper bundle from `process.resourcesPath`
in a packaged build. It also injects the shared Package Build service into the
typed `buildProject` IPC method; that response is a binary-free summary with
short-lived artifact handles, and `getBuildArtifact` is an explicit download
step. Building does not implicitly install anything. Renderer requests cannot choose arbitrary mapper files,
invoke shell commands, or access the bearer token. Forge makers/signing are not
configured until the macOS source-release gates pass. `forge.config.cjs` records
the future packager resource path, but the Forge CLI is not a workspace
dependency yet because its current rebuild chain is rejected by the repository's
exotic-subdependency policy.

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
root; the renderer never supplies an arbitrary filesystem path.

Build progress is streamed over a versioned, path-redacted IPC event channel and
shown in the Mapper for both targets. Live2D capture stays sequential on the
single preview renderer; captured Clawd RGBA frames are deflate-compressed before
the IPC handoff and restored with bounded validation in the App. After capture,
Clawd WebP assets are encoded with a bounded worker pool (two concurrent assets
by default) while output order stays stable. The event stream includes stage
transitions and per-Motion encoding updates, so long builds remain observable
without exposing frame bytes or local paths to the renderer.

From the repository root, install workspace dependencies and run:

```text
pnpm --filter @live2pet/desktop start
```

Before a package build, stage the browser dependencies into a self-contained Mapper bundle:

```text
pnpm --filter @live2pet/desktop prepare:mapper
```

The staging step copies only Pixi, the matching Pixi `@pixi/unsafe-eval`
compatibility bundle, the Pixi Live2D adapter, and zip.js. It
rewrites the shared Mapper to use local `vendor/` paths and emits hashes and
third-party license notices. Cubism Core and legacy runtimes are never staged;
they remain user-provided and local.

When a user selects a Cubism Core or legacy runtime, the Mapper stores its
source text in a browser-profile IndexedDB store (bounded to 16 MiB per runtime)
so the next launch can restore it without another file-picker step. The stored
copy is local-only and can be removed with **Clear saved runtimes**; it is never
included in a Project, cache, package, or release artifact.

The package does not include models, examples, or generated packages. Those
remain user-provided and local.

The Mapper also keeps a bounded, reference-only draft in the browser profile
while a project is dirty. It offers explicit recovery on the next launch and
shows the affected recipe ids when a loaded Source Package fingerprint changes;
both Codex and Clawd builds stay disabled until the source review is
acknowledged. See [`docs/agents/project-workflow.md`](../../docs/agents/project-workflow.md)
for the project privacy and relinking contract.
