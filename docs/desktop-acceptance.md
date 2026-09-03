# Local Desktop acceptance

The default development and packaged App uses HeroUI. The legacy browser Mapper is not the production entrypoint. `start` and `package:mac` build the renderer and stage its rendering dependencies automatically.

## Automated local workflow

`apps/desktop/scripts/accept-desktop.cjs` is an opt-in Electron acceptance harness, separate from synthetic public CI. It needs Playwright available in the developer's tool environment (direct module resolution or `NODE_PATH`) and permitted local models/runtimes. No browser download is required: it launches the existing Electron executable.

```sh
LIVE2PET_MODERN_RUNTIME=/path/to/live2dcubismcore.min.js \
LIVE2PET_CUBISM2_RUNTIME=/path/to/live2d.min.js \
LIVE2PET_MODERN_SOURCE=/path/to/modern-model \
LIVE2PET_CUBISM2_SOURCE=/path/to/legacy-model.pck \
node apps/desktop/scripts/accept-desktop.cjs
```

To exercise the packaged App, set `LIVE2PET_APP_EXECUTABLE` to its `Contents/MacOS/Live2Pet` executable. Otherwise the harness uses the installed development Electron. Build the renderer first when running the harness directly.

The harness uses a newly created temporary App profile and only replaces native file-picker/confirmation responses. Runtime provisioning, inspection, native embedded preview, mapping, project services, capture, encoding, ZIP packaging, and generated-asset loading are real. Neither installed target host is modified.

Checks cover:

- fresh Setup and one-time runtime import;
- modern folder and Cubism 2 folder/PCK inspection and center-column playback;
- explicit Clawd and nine-row Codex assignments;
- atomic save, reopen, Settings return, and retained mappings;
- compact builds for both targets, downloadable artifact handles, and decoded generated previews;
- changed-source review surviving save/reopen until acknowledged;
- unsaved-exit confirmation, local draft recovery, and moved-PCK relink;
- process restart without repeated Setup or runtime provisioning.

The temporary profile and screenshots remain local for diagnosis. They contain user-derived content and must not be committed or published.

## Packaged startup gate

```sh
pnpm --filter @live2pet/desktop package:mac
pnpm --filter @live2pet/desktop smoke:mac
```

The smoke test checks the bundle resources, loads main-process services from ASAR, verifies native Sharp, scans for prohibited assets, and waits for the actual HeroUI mount in a fresh profile. Loading an HTML file alone is not a passing result.

These checks do not establish real Clawd/Codex host installation acceptance, all-model compatibility, Spine/Visibility support, Windows support, or public binary distribution approval. Those remain separate V1/release gates.

## Recorded local result — 2026-09-03

The current x64 unsigned macOS App passed the full opt-in workflow with one permitted modern Cubism folder and one Cubism 2 PCK. Both sources produced Clawd and Codex ZIP artifacts, and their generated previews decoded successfully. Save/reopen, changed-source review, recovery, moved-PCK relink, and restart/runtime reuse passed. The packaged startup gate confirmed `renderer: heroui` and `mounted: true`, loaded the packaged services and Sharp, and found no prohibited assets.

The synthetic regression run passed 241 Node tests and 79 UI tests; two standalone opt-in renderer tests were skipped in that run because real-runtime verification was performed through the packaged Electron workflow instead. TypeScript and source-release checks passed.

Acceptance uncovered and fixed four migration defects: omitted ZIP packaging options in the UI build request, checkout-relative imports in the packaged preview service, design-only inventory fallback for empty real catalogs, and loss of pending review on reinspection. Native unsaved-exit confirmation and immediate draft flush were added after the real recovery test exposed a blocked unload.
