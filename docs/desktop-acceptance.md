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

## Playback and usability follow-up — 2026-09-03

The initial gate verified rendering and package decoding, but did not establish correct playback timing. User testing exposed several gaps; the acceptance harness now checks native paused time, seeking, replay, intermediate capture progress, named artifacts, generated-animation selection, and Settings title-bar clearance.

- Capture advances by adjacent source timestamps. It no longer adds each absolute timestamp to an already-playing motion. Restart explicitly clears the current motion because Pixi refuses to restart an active identical motion even with force priority. Capture does not resume the wall-clock ticker between frames. Timing changes invalidate old capture cache identities.
- The Map timeline is interactive and reads native playback time. Scrubbing has its own pending value and coalesces input; status refreshes cannot overwrite a user's requested position. Paused seeking does not temporarily resume playback.
- Codex playback uses the host's per-frame delays, verified against the installed application's `app-initial` animation definitions on this date, rather than a guessed uniform 12 FPS. Its fixed-frame atlas cannot preserve a multi-second motion in full at original speed. Hosted builds sample the opening segment at host timestamps, holding the last available pose for shorter sources. Clawd retains full-length motion timing. The Build page explains this distinction.
- Build names come from the editable project name, survive save/reopen and undo/redo, and generate safe, distinct identifiers for non-ASCII names. Previously generated artifacts remain explicitly identified by their original filenames until rebuilt.
- Runtime import controls are grouped at the right edge, and each saved runtime has its own confirmed removal action. Removal affects the App's private copy, not the user's original file. Settings leaves a dedicated native title-bar region.
- Map and generated-preview surfaces have bounded widths. Generated-animation choices wrap instead of being hidden in a horizontal button group. Models without Expressions show a short explanation rather than fabricated choices.
- Source has a compact identity summary and a link to Map; the empty visual placeholder was not a functioning model thumbnail and has been removed. The only interactive source-model preview remains in Map, as specified by ADR-0012.

The updated real-model workflow passed for both the permitted modern folder and Cubism 2 PCK, including both target builds. Existing packages produced by the old capture path need to be rebuilt; this change does not modify or reinstall them automatically.

Additional two-motion checks confirmed selectable generated Clawd assets and all nine Codex rows in the packaged App. A legacy banner motion took longer in WebP encoding, not capture; encoding progress now advances by completed motion count as well. This is measured stage progress, not a promise of uniform wall-clock speed. The final regression run passed 243 Node tests (two opt-in skips) and 83 UI tests, plus type checking and packaged startup checks.
