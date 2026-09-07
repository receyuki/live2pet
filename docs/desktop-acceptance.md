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

Do not rebuild or replace the App bundle while an acceptance process is using
it. A reload reads its packaged resources again and can otherwise fail with
`ERR_FILE_NOT_FOUND` during replacement.

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

### Mapping requirements and compact build results

A user-reported follow-up was reproduced with the locally supplied `shengluyisi_4` source and two explicitly mapped motions. The image stage was already 360 × 360 CSS pixels, but the surrounding generated-result frame stretched to 652.5 pixels in a wide window. The complete result frame is now capped at 400 pixels, with wrapping animation choices and contained long filenames. The opt-in acceptance script checks the frame width, square stage, and visible progress track rather than only successful image decoding.

Mapping groups now carry explicit Required / Optional badges and short skip guidance in English and Simplified Chinese. Clawd core states and all Codex rows are required; full-sleep states become required only when that project mode is enabled. Other Clawd states and reactions remain optional. These labels do not change the target contracts or automatically assign motions.

The bottom status bar shares the existing build state with the Build destination, remains present in Settings, and offers navigation back to the build result. Both progress displays include HeroUI Track and Fill components; an empty ProgressBar root alone supplies accessibility state but no visible track. The result-header flex rule is restricted to the title row so it cannot collapse the progress component's grid track to zero width. Success, failure, and cancellation remain visible without triggering downloads or installation. The two-ear `BrandMark` is an existing CSS-drawn decorative mascot, not a loaded model or runtime indicator; it was not changed in this fix.

Verification passed 86 UI tests, TypeScript checking, and packaged startup/resource checks. A fresh-profile packaged Clawd build from `shengluyisi_4` passed at 1024-, 1280-, and 1600-pixel window widths, with a generated-result frame no wider than 400 pixels, a square stage, selectable animations, and no horizontal page overflow. The Settings footer was also checked during the actual build. Source files, runtimes, test profiles, generated packages, and screenshots remain local and are not published.

### Follow-up: project drops, queued builds, and responsive results

The subsequent user review superseded the fixed 400-pixel preview cap: the
result panel and square stage now follow the available card width. Intrinsic
image sizes and long animation names cannot widen the card or page.

Dropping a `.live2pet` file opens it through the same validated document service
as the picker, including recent-document registration and the existing
unsaved-project confirmation. Project files are not sent to model or runtime
inspection. The IPC contract accepts either a recent `documentId` or one
absolute `.live2pet` `inputPath`, never both.

Hosted renderer builds are serialized. Submitted requests now report Queue
and Prepare events before capture begins. Waiting targets show a localized
Queued explanation in Build and a matching footer label; a never-submitted
target remains Not built. Cancelling a queued request settles it immediately
and skips its renderer operation without breaking subsequent requests.

Desktop Codex builds now explicitly use sprite V2 with approved neutral-look
compatibility. See [Codex sprite V2 compatibility](codex-sprite-v2.md) for the
versioned dimensions, neutral-pose limitation, and local host verification.

The follow-up regression passed 248 Node tests (two opt-in skips), 91 UI tests,
type checking, and source/bundle asset scans. In the final packaged App, a
native-backed dropped project File opened without a picker; a real
`shengluyisi_4` Clawd build left Codex idle until it was submitted, then Codex
displayed Queued and automatically started after Clawd released the renderer.
Both builds completed, including the V2 neutral-look preview choice. At window
widths 1024, 1280, and 1600, the result frame matched its card content width,
the stage remained square, and the page had no horizontal overflow. A declined
project-replacement prompt preserved unsaved work in the UI regression.

### Localized runtime download guidance

The shared runtime panel in Setup and Settings now opens a language-specific
README runtime section in the system browser. English and Simplified Chinese
READMEs are maintained together, with a stable `runtime-setup` anchor. The
guide explains one-time local import, separate runtime licensing, the official
modern Web SDK source, and the user-supplied third-party Cubism 2 file source.
The legacy link is explicitly identified as unofficial; no runtime is bundled
or downloaded by the App.

The main window permits only the two exact help URLs through `shell.openExternal`;
all child windows and other external destinations remain denied. Regression
checks cover both entry points in both languages, README anchors, and rejected
URLs. All 93 UI tests, the two help-boundary tests, type checking, and the source
asset scan passed. A separate-profile packaged App probe clicked all four
entry-point/language combinations and confirmed delivery to the real Electron
system-browser boundary with no new App window. The probe replaced only the
final browser-opening side effect, so it did not open the user's browser or
claim network-page rendering acceptance.

### Remove decorative branding and align Settings chrome

The user approved removing BrandMark rather than replacing it with another
logo. Setup now presents the shared runtime controls in one centered column;
Welcome prioritizes import, project opening, and recent projects without a
decorative mock window. The toolbar uses text and emphasizes the open project
name. An unloaded design preview explains that it contains no real model,
instead of displaying a fictional character. The system App icon is unchanged.

Settings now shares the workspace's 56-pixel toolbar, native traffic-light
clearance, and bottom status bar. Done sits at the top right; the sidebar only
contains section navigation. The extra 40-pixel Settings drag strip and duplicate
sidebar title were removed. No new component system was introduced.

Verification passed 95 UI tests, type checking, source and packaged-asset scans.
A separate-profile packaged App probe checked English and Simplified Chinese
Setup, Welcome, preview empty states, and Settings at 1024-by-768 and 1440-by-900.
Settings and workspace toolbar heights matched; Done remained inside the toolbar
on the right, no horizontal page overflow occurred, and closing Settings returned
to the previous destination. Model playback and Package Build services were not
changed by this presentation-only update.

### Real target detection and durable installation preferences

Targets & Installation is no longer a placeholder. On macOS it checks the two
standard Applications directories (or a native-picker-selected App) against
the Clawd/Codex bundle identifiers, and displays the detected version and path.
Detection is explicitly bounded, not proof that an unmatched App is uninstalled;
other platforms currently report App detection as unsupported.

Package folder inspection is independent of App presence. It reports a writable
folder, a missing folder whose existing ancestor is writable, a file collision,
or an inaccessible destination. Read-only detection never creates a folder.
Manual App and folder choices persist atomically in private App settings;
cancelling the picker or resetting a preference never deletes host files.
Corrupt preferences fail explicitly instead of silently overwriting settings.

Build folder selection persists through the same service. Before installation,
the UI refreshes detection, confirms the exact path, and submits a target-bound
opaque location handle. Known inaccessible destinations are rejected before
confirmation. The App router also resolves saved preferences for callers that
omit a handle. Existing explicit confirmation and non-overwrite behavior remain.
Local paths are deliberately displayed by this settings-only API, not embedded
in project documents, build reports, or generated packages.

Verification: 255 Node tests passed with two opt-in skips; all 99 UI tests and
type checking passed. Source and packaged asset scans passed. Actual local
detection found Clawd on Desk 0.16.0 and Codex 26.901.20858 with writable default
pet directories. A disposable-profile packaged App test selected a scratch
folder and the real Clawd bundle through native-picker responses, restarted
the App, confirmed both preferences persisted, then reset them without deleting
the scratch folder or writing any package. The Chinese 1024-by-768 layout had
no horizontal overflow. This verifies detection/configuration and the shared
installation routing tests, not actual target-host pet loading or activation.

### Preview and mapping acceptance closeout

The 2026-09-03 audit found and fixed two actual gaps before closing #3, #4, and
#5: the HeroUI preview had fixed loop/speed options, and crash cleanup awaited
JavaScript unload in an already dead renderer. The latter prevented failure
notification and the Retry control. Dead-renderer cleanup now closes host
resources without asking the exited process to execute JavaScript. Normal
healthy teardown still unloads the adapter.

Map now exposes keyboard-accessible loop and 0.5x/1x/1.5x/2x preview speed.
Changing either replays the motion and does not change project mappings or
package timing. Codex's two format/timing explanations are collapsed behind
Format details; build blockers remain visible. Existing HeroUI components are
used for both changes.

The final packaged x64 App completed the acceptance harness with a permitted
modern folder and a legacy PCK: real playback controls, direct assignments,
both target builds and decoded generated previews, Settings return, save/reopen,
changed-source review, draft recovery, and moved-PCK relinking. Each renderer
was deliberately crashed and successfully retried without changing the saved
project. Imported runtime copies were moved inside the disposable test profile;
both projects reopened and played after process restart using private runtime
copies. Original user files were not moved or deleted. The harness exercises
the first two available motions, not every motion or a performance benchmark.

Regression: 256 Node tests passed (two opt-in skips), 102 UI tests passed,
type checking and source scans passed, and the final bundle passed startup,
native Sharp, and the current prohibited-asset checks. Keyboard assignment and
preview controls are covered by UI tests; full accessibility review remains #12.

An earlier long-motion Clawd run exceeded the harness's 180-second limit; this
does not establish throughput for all models and remains part of #8 performance
and long-build acceptance. No package was installed or activated in a target
host. The broader #6, #7, #8, #10, #12, #13, and #14 gates remain open.

### Lean macOS packaging — 2026-09-03

The current x64 package removes duplicate frontend npm trees, not frontend
features. React, React DOM, HeroUI, and Lucide are consumed at Vite build time;
the main process keeps its actual production dependencies, including ZIP and
Sharp/libvips. A Desktop `files` allowlist excludes local design drafts and
development assets. The system ICNS icon is still supplied directly to Packager.
Original icon drafts and all user models/runtimes remain untouched.

| Measurement | Before | After |
| --- | ---: | ---: |
| App disk usage (`du -sk`, converted to MiB) | 434.2 MiB | 315.7 MiB |
| `app.asar` file size | 122.4 MiB | 3.7 MiB |
| Production deployment package count | 82 | 18 |
| Files scanned inside ASAR | 30,372 | 246 |

Disk usage fell by 118.5 MiB (27.3%). Electron, its locale resources, the
compiled UI, and native image binaries were not trimmed. This is the installed
bundle size, not a compressed-download measurement. No dependency version changed.

The packaged renderer retains Vite's `THIRD-PARTY-LICENSES.md` and explicit
HeroUI stylesheet/Tailwind license copies. Packaging fails if the renderer
license report is absent or known duplicate frontend/design directories return.
Main/preload/service files inside ASAR were byte-compared with source.

Verification passed 258 Node tests (two opt-in skips), 102 UI tests, type checking,
source scanning, and packaged startup/native-dependency checks. A complete
disposable-profile run passed modern-folder and legacy-PCK preview, both target
builds and generated previews, save/reopen/recovery/relinking, and runtime reuse
after restart. No target-host package was installed or activated.

Known stability observation: the first forced-renderer-crash run timed out
waiting for Retry; a fresh full run passed crash/retry for both generations.
The intermittent failure is not qualified as resolved by this packaging change
and remains a renderer-stability follow-up under #12/#10. No renderer lifecycle
code was changed during the size reduction.

### Manual visibility and build-speed closeout — 2026-09-03

The crash follow-up above is now fixed separately from packaging: a renderer
exit rejects an in-flight `executeJavaScript` call so status polling cannot
block Retry behind the dead process. Both Cubism generations passed three
consecutive deliberate crashes/retries in each new acceptance run.

Map now lists model Parts with manual Hide/Show, search, transient Solo, and
Restore all. No name-based hiding occurs. Modern metadata names and parent
relationships are used when available; legacy IDs are validated through Part
lookup. Hidden opacity is reapplied after animation/pose. Schema 2 persists the
canonical hidden set and migrates schema 1 to an empty set. Nine poses per source
Motion contribute to visible framing; this is a sampled envelope, not an
all-physics containment guarantee. Undo/redo, save/reopen, failure recovery,
both target builders, and dependent cache identities carry the same settings.

The HeroUI hosted-build route previously omitted the old Mapper's precomputed
capture plan, which also bypassed persistent candidate/encoded cache injection.
It now derives the required context from the inspected renderer and reuses the
same integrity-checked CacheStore. Unchanged rebuilds report cache hits and emit
no equivalent frame-capture events; unrelated visibility identities remain intact.

Electron capture now returns a typed RGBA array instead of converting every
channel into a JavaScript number. A local 20-frame, 768-by-768 transport probe
took 5,828 ms with numeric arrays and 190 ms with typed arrays. This is transport
only, not a claim of 30-times-faster complete builds. Browser-only hosts retain
their serializable-array path. Frame timing, sample counts, dimensions, alpha,
and encoder settings are unchanged by the transport optimization.

Packaged x64 acceptance used the same two permitted models, first two Motion
assignments, Compact presets, hidden Part IDs, and fresh disposable profiles:

| Clawd build | Before binary transfer | After binary transfer |
| --- | ---: | ---: |
| Modern folder, cold | 96.7 s | 32.9 s |
| Legacy PCK, cold | 52.6 s | 19.5 s |

The new modern run spent approximately 18.9 s in capture/candidate-cache work,
12.3 s in encoding, and 1.6 s in ZIP assembly. The legacy run spent 6.8 s, 10.8 s,
and 1.6 s respectively. These are local measurements, not all-model guarantees.
The new visibility framing envelope is also included in the updated build.

Before/after WebP metadata confirms unchanged 512-by-512 pages, alpha, nominal
56-ms timing, and total durations (modern: 15,176/6,776 ms; legacy: 3,080/7,000 ms).
Modern encoded page counts match exactly. The legacy encoder coalesces different
numbers of repeated frames after reframing, but preserves the same total delays;
encoded page count alone is not an animation-speed measurement.

Final regression: 274 Node tests passed with two opt-in real-runtime skips;
106 UI tests, type checking, packaged startup, native Sharp/libvips loading, and
prohibited-asset checks passed. The complete packaged acceptance also passed
after the binary transport and sampled visibility envelope were enabled.

The harness now checks mid-capture cancellation followed by successful rebuilding,
complete ZIP downloads that parse successfully, generated previews, explicit
installation into disposable folders, and warm-cache rebuilds. It also verifies
runtime-copy reuse after restart, source review/recovery/relinking, and manual
visibility save/reopen. Run with `LIVE2PET_ACCEPT_BUILD_HARDENING=1` and optional
`LIVE2PET_MODERN_HIDDEN_ELEMENT` / `LIVE2PET_LEGACY_HIDDEN_ELEMENT`; progress
timestamps are saved only under the disposable profile. User source files,
production host profiles, and active pets are never changed by this harness.

Separate bounded host checks accepted modern and legacy ZIPs using Clawd on Desk
0.16.0's installed importer/schema modules in temporary roots. The installed Codex
26.901.20858 discovery/reader path accepted the generated V2 atlas; its actual
image reader also accepted V1 and V2 geometry. Pinned ASAR SHA-256 values:

- Clawd: `21b837c363577ca9567aed2442dc9343458f6d6eb21b4843fe5f9acdb1b465c4`
- Codex: `19b28d38d27fdeff49793263d539d57583f31806536a15ebb667f415a402b39b`

This establishes importer/parser compatibility, not visual host activation or
playback acceptance. Those user-facing host checks, final accessibility review,
remaining build/report/combined-install work, and Spine remain separately tracked.

### Source replacement and Part inspection — 2026-09-03

A fresh-profile reproduction hid a modern model's background, replaced the
Source Package with a legacy PCK, and previously failed with an unavailable
Part ID from the old source. Changed fingerprints now reset the hidden set;
relocating identical source bytes retains it. Mapping review still applies,
and the original saved project is not overwritten by relinking alone.

Interactive visibility changes now measure only the current pose, without
replaying source Motions. The sampled animation envelope described above is
prepared once at the first actual capture for a hidden set, rather than during
each toggle. Complete capture-cache hits skip that preparation. This moves
framing work out of interaction; it does not remove export framing analysis.

Inspect generates one transparent 192-by-192 Part thumbnail on demand, keeping
its ancestors and descendants when the model exposes those relationships.
The image reflects the current pose, not a raw atlas region: a Part can contain
multiple drawables, and authored-invisible Parts can have no visible pixels.
Inspection restores the prior hidden set, framing, and playback behavior even
if PNG generation fails. Thumbnails are not saved into projects or packages.

Local modern and legacy probes verified isolated thumbnails and restoration
after inspection and subsequent playback. Model files, generated images,
profiles, and detailed performance traces remain private test inputs/outputs.

Verification passed: 275 Node tests (two opt-in skips), 110 UI tests, type
checking, packaged startup/native dependency checks, and prohibited-asset scans.
Packaged acceptance covered both thumbnail buttons, hidden-Part Clawd/Codex
builds, downloads, scratch-folder installation, cancellation, warm-cache reuse,
crash/retry, save/reopen, and runtime reuse after restart. A separate packaged
reproduction also verified the visibility-reset notice and playable preview
after replacing a modern source with a legacy PCK.

### Viewport-coordinate framing correction — 2026-09-03

A pixel-level reproduction caught a missing assertion in the earlier acceptance:
successful thumbnails and package parsing did not establish centered geometry.
Pixi 6 `extract.pixels(stage, frame)` creates a texture whose origin follows the
stage bounds. Treating those pixels as viewport coordinates applied translation
twice, moving hidden-Part previews toward canvas edges and contaminating export
framing. Bounds analysis, thumbnails, and captures now share a screen-pixel
reader with explicit bottom-up to top-down row conversion. It reads the existing
framebuffer rather than generating another stage texture.

The packaged harness now pauses the Motion and independently measures the actual
canvas alpha after hiding and thumbnail restoration. It requires a nonempty
image centered within three pixels on each axis. A separate private reproduction
covers consecutive hides, restores, and differently located Parts in both
generations. Unit coverage checks the extraction target, asymmetric row order,
and misses for old capture-cache entries. Capture identity v4 also invalidates
downstream encoded caches without deleting user projects or generated packages;
previously exported packages require an explicit rebuild.

The same loop exposed two additional legacy cases: poses may extend beyond the
authored canvas, and even tiny visibility-update ticks may rerun motion/physics.
Framing now makes at most four zoom-out retries when alpha touches a viewport
edge. Visibility and thumbnails recalculate Core drawables from a captured pose,
then restore base parameters, without advancing animation or physics. Cubism 2's
public UtSystem clock follows the renderer's model time rather than wall time.

Verification passed: 276 Node tests (two opt-in skips), 110 UI tests, type
checking, source-release checks, and the packaged prohibited-asset scan.
Packaged acceptance passed for both generations, including the independent
canvas-centering assertion, hidden-Part Clawd/Codex builds, downloads,
scratch-folder installation, cancellation, cache reuse, crash recovery,
project reopen, source relinking, and saved-runtime reuse after restart.
Private consecutive-toggle/thumbnail probes also kept the paused model clocks
unchanged. No model files, runtimes, screenshots, or generated packages are
included in the source change.

### Pre-Spine build and Desktop closeout — 2026-09-07

The Build destination now offers **Build & Install** without weakening the
existing separation between building, saving, and installation. The combined
command waits for a successful validated artifact, then presents the normal
installation confirmation. A conflicting package is never overwritten by the
first confirmation: replacing it requires another explicit confirmation and
uses the installation service's atomic backup/rollback path. A failed or
cancelled build never starts installation.

Project-level build reports now include total and per-stage elapsed milliseconds
in addition to contract versions, render settings, cache hits/misses, validation,
warnings, and artifact sizes. The report remains path-redacted and excludes
captured pixels. UI coverage includes successful combined installation,
build failure/cancellation, and conflicting-package replacement.

The remaining pre-Spine manual gate is the user-visible host check: activate and
play current packages in Clawd and Codex, then review the packaged Desktop App's
final visual and accessibility behavior. Parser/importer checks do not substitute
for that host UI acceptance.

The packaged x64 App then passed the isolated full workflow with the local
`shengluyisi_4` modern folder and `c311_02.pck` legacy source: one-time runtime
copy/reuse, playback and mappings, three renderer crashes/retries per source,
mid-capture cancellation, successful rebuilding, generated previews, native ZIP
saving, scratch-folder installation, warm-cache rebuilding, project recovery and
legacy PCK relinking. Modern Compact builds took about 10.4 s for Clawd and 1.8 s
for Codex; legacy took about 13.4 s and 1.8 s respectively on this machine. Warm
rebuilds took about 1.4 s/0.2 s and 2.6 s/0.2 s. These measurements are evidence
for the tested fixtures, not universal performance promises.

Regression at this checkpoint: 290 Node tests passed with two opt-in renderer
tests skipped, 133 UI tests passed, type checking and source-release checks
passed, and the packaged App passed native Sharp/libvips loading, HeroUI mount,
and prohibited-asset scans. Local sources, runtimes, generated packages,
screenshots, progress traces, and disposable profiles remain uncommitted.

### Inline Part browsing and explicit package saving — 2026-09-03

The Map library now uses HeroUI Animations/Visibility tabs. Visible Part rows
request isolated thumbnail snapshots serially with a small scheduling gap;
offscreen rows do not fill the renderer queue. Selecting a row image retains
the larger preview above it. Thumbnail caches survive tab switches, are scoped
to source/Motion/Expression/retry, and ignore results belonging to an old source.
Empty and failed snapshots have explicit states; failed images can be retried.
Tests cover lazy row observation, serialized requests, tab keyboard navigation,
cache reuse, source replacement, and selecting the larger preview.

Build results now offer Save ZIP independently of installation. Settings Storage
includes native save-dialog mode (default) and a persistent native-picked output
folder. Fixed-folder saves use exclusive copies and numbered collision names;
dialog mode stages complete bytes before rename after native confirmation.
Tests cover cancellation, concurrent same-name saves, unavailable folders,
invalid settings, trusted artifact identities, and separation from installation.
The packaged harness saves via the native dialog seam, not a browser download.

### Per-Motion export framing — 2026-09-03

A supplied package exposed excessive transparent margins in its actual WebP
frames, independently of a Codex preview CSS sizing bug. The old visibility
capture scan combined every source Motion into one envelope: large effects in
other Motions shrank otherwise ordinary assets. Capture now samples only the
requested Motion and caches its fixed envelope by Motion/Expression until
visibility changes. This does not zoom each frame, crop out guessed background
elements, or change source assets. Different Motions can have different framing.
The previous all-source framing descriptions above are historical, superseded
by this correction. Capture cache identity v5 skips the old undersized frames.

Unit regressions require idle to retain its own bounds when another Motion
reaches farther. A real-renderer reproduction compares preview and capture
geometry. The opt-in packaged check `LIVE2PET_ACCEPT_MIN_FRAME_EXTENT` validates
the maximum normalized width/height of the first encoded idle frame, so a
successful ZIP or playable WebP alone cannot hide undersized content. Choose
this threshold for the permitted local fixture; it is not a universal model
validation rule. Generated Codex canvas previews also scale with their frame,
without changing atlas resolution or aspect ratio.

Final verification passed: 283 Node tests (two opt-in skips), 121 UI tests,
type checking, source-release checks, and macOS packaging. Packaged acceptance
passed for Cubism 2 and modern Cubism, including a 0.5 minimum visible extent
in the first encoded Clawd idle frame for the local fixtures, native ZIP saving,
scratch installation, cancellation, warm-cache builds, renderer crash recovery,
project reopen/relink, and runtime reuse after restarting the App. The supplied
old ZIP was inspected read-only; it must be rebuilt to receive corrected framing.
No local model, runtime, diagnostic image, or generated package is published.

### Clawd pointer and display geometry — 2026-09-04

Generated themes now declare a canvas-sized `hitBoxes.default` and neutral
`objectScale` values. Previously omitted metadata inherited Clawd's small
17-by-12 default click rectangle and an image top offset of -25 percent.
A private probe using the installed Clawd schema and hitbox resolver confirms
that the exported canvas center is clickable and its top is at zero with the
new metadata. This is a host-geometry check, not a native mouse-event acceptance
or verification of every user animation's captured pixels. Transparent canvas
margins remain clickable. Explicit build metadata is preserved, and package
validation rejects missing or invalid default rectangles. Existing ZIPs require
rebuild/reinstallation; no installed theme is modified automatically.
