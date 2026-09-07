# Live2Pet

[English](README.md) | [简体中文](README.zh-CN.md)

Turn Live2D models into portable packages for agent-pet hosts.

Live2Pet is an early-stage local desktop toolchain for loading Cubism models, previewing their original motions, mapping those motions to target-specific pet states, and building validated Clawd theme and Codex custom-pet packages. The current V1 milestone is deliberately limited to a personal-use macOS App.

The interface focuses on your project: Setup and Welcome contain task controls
rather than decorative mascots, and empty previews explain what is missing.
Settings uses the same top toolbar as the workspace, with Done at the top right.
The system App icon is unchanged.

<a id="runtime-setup"></a>

## Runtime setup: why a separate download?

A model contains the character data; a runtime is the code that makes it move.
Live2Pet includes its interface and rendering adapters, but deliberately does
not bundle or download Live2D's proprietary runtime. Its license is separate
from this repository's source code. Obtain it from the appropriate source and
review its terms yourself; importing it does not grant rights to your models
or to publish derived pets.

| Your model | Runtime to import | Where to get it |
| --- | --- | --- |
| Cubism 3 and later (`.model3.json` / `.moc3`) | Cubism Core for Web, typically `Core/live2dcubismcore.min.js` | [Official Cubism SDK for Web download](https://www.live2d.com/en/sdk/download/web/) — download the SDK and extract it first. |
| Cubism 2 (`.model.json` / `.moc`, including some PCK packages) | Legacy Web runtime `live2d.min.js` | Third-party legacy source: [dylanNew/live2d runtime directory](https://github.com/dylanNew/live2d/tree/master/webgl/Live2D/lib), or [open the raw JavaScript file](https://raw.githubusercontent.com/dylanNew/live2d/master/webgl/Live2D/lib/live2d.min.js) and save it as `live2d.min.js`. |

For Cubism 2, save the JavaScript file itself, not the GitHub HTML page, then
drag that file into Live2Pet. The linked repository is a **third-party copy**,
not an official or maintained Live2D download channel. [Live2D's notice](https://help.live2d.com/en/other/other_20/)
states that new Cubism 2.1 SDK downloads are no longer available. Check the
source and applicable runtime license before using the copy; public GitHub
availability is not a grant of rights. Live2Pet only links to it and does not
bundle, automatically download, or redistribute it.

The SDK download page asks you to review Live2D's software licenses. Use the
**Web** SDK, not the Editor, Unity SDK, or Native SDK. A modern Core does not
replace the Cubism 2 runtime. PCK is a container, not a runtime generation or a
guarantee that its contents are supported.

1. Extract the downloaded SDK locally.
2. In first-time Setup or **Settings → Runtimes**, drag in the JavaScript runtime
   file or extracted SDK folder, or use **Add runtime / Choose SDK folder**.
3. Live2Pet detects the generation and saves its own local copy. You do not need
   to rebuild the App or import the runtime every launch. Both generations can
   be saved together and selected automatically for the model.

Only import trusted runtime code. Removing a saved runtime from Settings does
not delete your original file. You can skip this step to inspect resources,
but model playback and capture require a matching saved runtime. This guide
covers the current Live2D workflow; it does not imply Spine support is complete.

The App's download-guide button opens this section in your system browser,
using the English or Chinese README according to the App's current language.

## Components

### Save packages without installing

After a successful build, choose **Save ZIP** to save the portable package
separately from **Install**. **Settings → Storage → Package output** defaults to
asking for a location each time using the native save dialog. You can instead
choose a default output folder; same-name files receive numbered suffixes and
existing files are preserved. The App shows the saved path. Output preferences
stay on this device, not in projects or packages. Saving remains an explicit
action after building and never installs a pet.

Choose **Build & Install** when you want one continuous operation. The build must
still finish and validate before the App asks for installation confirmation. If
the same package already exists, replacement requires a second explicit
confirmation and uses the installer's rollback-safe upgrade path. Build reports
include total and per-stage timing alongside cache, validation, warning, and
artifact-size information.

### Custom Clawd output

Build retains **Compact / Balanced / High** as defaults. **Custom** starts from
the selected preset and exposes square resolution (128–2048 px), frame rate
(1–60 FPS), and WebP quality (1–100). Overrides are saved in the project; choosing
any preset clears them. Lower settings usually reduce size, but trade detail or
smoothness. Frame sampling and playback timing change together. Codex retains
its target-defined atlas geometry and presets. Custom controls appear immediately
when Custom is selected and are hidden when a default preset is selected.

Clawd's **80 MiB** ZIP import limit is a compatibility warning, not a build
failure. Oversized ZIPs remain available to save, with their size and the limit
shown in readable units. Clawd itself may still reject them; lower settings and
rebuild for compatibility. Archive extraction safety limits remain enforced.

### Hide model backgrounds manually

In **Map**, switch between the **Animations** and **Visibility** tabs.
Under Visibility, search the model's elements and choose **Hide / Show**.
Parts follow the model's collapsible parent/child hierarchy; search results keep
their ancestor path visible. Root ArtMeshes that belong to no Part appear in one
**Unattached meshes** group, which can also be hidden or shown together. Use
**Solo** to identify an element temporarily, or **Restore all** to undo hiding.
Small isolated element images appear beside their names as rows enter the visible
list. Select an image to enlarge it in the preview above. Images are generated
one at a time and reused across tab switches; changing the source, Motion, or
Expression resets them. Empty elements and failed previews are labeled; select a
failed image to retry. These are pose snapshots, not original atlas tiles.
Live2Pet never hides an element automatically based on its name. Friendly names
are used when the model supplies them; otherwise original IDs are shown. Modern
Cubism models therefore keep backgrounds authored outside the Part hierarchy
hideable without inventing a false parent relationship.

For modern Cubism models, **Detect large elements** samples nine poses in the
selected Motion and puts up to eight large visible elements first. Their images
come from the sampled pose, so overlays absent at the start can be identified.
**Solo** on a detected Part jumps to that sampled time. Detection does not hide
anything; inspect each candidate before choosing **Hide**. It pauses at the
Motion's start when finished. This geometry-based aid can miss brief effects
and cannot classify a Part as background or foreground. Cubism 2 retains manual
inspection. Thumbnail checkerboards make translucent overlays easier to see.

The project saves your hidden elements and applies them to preview and both target
builds. Toggling visibility updates the current pose immediately; sampled
animation framing runs only when capture is needed, independently per Motion
so a large effect in another Motion cannot shrink the whole package. Solo is not saved. Older
projects open with every Part visible. A background painted into the same mesh
as the character cannot be separated by this control.
Visibility changes center the current visible content using the actual viewport.
After upgrading from the earlier shifted-framing build, rebuild affected packages;
Desktop skips the incompatible old capture cache automatically.
Modern Cubism capture settles physics at the opening pose before recording,
without dropping opening frames. Rebuild older packages to remove captured
startup jolts. If only some Motions look tiny, preview those Motions under
Visibility: a large overlay may appear only during playback and still control
framing until you explicitly hide its Part.

Use **Reset preview** beside the current Motion name to recreate the Live2D
preview when its pose or renderer state looks wrong. It returns the current
Motion to the beginning, clears temporary Solo inspection, and reapplies the
project's saved visibility; it does not alter mappings or saved hidden elements.

Use **New project** in the toolbar or **File → New Project** (`⌘N` / `Ctrl+N`)
to return to import without restarting Live2Pet. Unsaved work receives the same
recovery confirmation as opening another project; active builds must finish or
be cancelled first.

The bounded disk cache automatically evicts the least recently used entries
when space is needed. An individual entry larger than the entire cache budget
is skipped without failing the build or discarding other useful entries;
rebuilding that uncached content may take longer.

Generated Clawd themes include a default clickable rectangle covering their
logical canvas. Transparent margins inside it also receive pointer input.
Rebuild and reinstall older packages that lack this rectangle; custom hit boxes
provided through build metadata are preserved.
They also declare neutral `objectScale` values so Clawd does not apply its
built-in overscan and upward offset to the exported canvas.
Replacing source contents resets model-specific hidden IDs, while moving the
same unchanged source keeps them. The original source and saved project are not
silently modified by relinking.

### Targets and installation

**Settings → Targets & Installation** detects the Clawd on Desk and Codex macOS
Apps in `/Applications` and `~/Applications`, validating each bundle identifier
and displaying its version. **Locate App** supports another location or a renamed
bundle. A missing result means only that the checked locations did not match;
other platforms currently report App detection as unavailable.

App presence and package-folder readiness are separate checks. The page shows
the resolved folder, whether it is writable, or whether it will be created only
on confirmed installation. Clawd's default macOS folder is
`~/Library/Application Support/clawd-on-desk/themes`, as documented in the
[host's theme guide](https://github.com/rullerzhou-afk/clawd-on-desk/blob/main/docs/guides/guide-theme-creation.md).
Codex defaults to `$CODEX_HOME/pets`, or `~/.codex/pets` when `CODEX_HOME` is unset.
The existing `LIVE2PET_CLAWD_ROOT` / `LIVE2PET_CODEX_ROOT` overrides remain supported.

Choose a custom package folder to save it on this device. Build uses that folder
and confirms the exact destination before installing; existing packages are not
silently overwritten. The Build page's folder picker also remembers its choice.
Resetting a location removes only the preference, not any installed files.
Selecting an App does not change its data folder or prove pet-format compatibility.
Detection never launches an App, creates a package folder, or installs a pet.

Absolute installation paths are visible only in local settings/confirmation UI;
these preferences are not stored in projects or exported pet packages.

### Workspace packages

- `apps/mapper/` — browser-based Live2D motion preview, Clawd mapping, user-configurable Clawd idle/tier behavior pools, Codex nine-row mapping, local Codex ZIP fallback build, shared-App Clawd Theme ZIP build, generated target previews, final-size Codex row playback, and explicit Desktop-App installation controls. The Mapper has no runtime CDN dependency: modern Core can be selected locally, and Cubism 2 preview requires a user-selected local `live2d.min.js`. Selected runtimes are saved only in the browser profile and restored on the next launch; the clear-saved control removes those local copies. Its first English/Chinese (`zh-CN`) locale layer is presentation-only and does not change project or package schemas.
- `packages/source-inspector/` — normalized Source Package inspection API and versioned `live2pet-inspect` CLI for standard Cubism directories and supported Live2D PCK files.
- `packages/project/` — reference-only `.live2pet` Project schema, reusable Motion-plus-Expression Animation Recipes, target Render Preset persistence, deterministic serialization, atomic file I/O, autosave recovery, source relinking, and review gating.
- `packages/runtime/` — user-provided Cubism runtime discovery, bounded validation, redacted diagnosis, persistent App-managed copies, and generation-aware selection metadata.
- `packages/renderer/` — versioned playback/capture contract, deterministic motion candidate sampling, copyright-safe synthetic renderer for CI, and automatic selection between the V1 Pixi modern and legacy adapters.
- `packages/frame-selection/` — deterministic motion-aware candidate deduplication and ordered frame selection for target atlases.
- `packages/package-build/` — cancellable project-target builds for Codex Pet and guide-shaped Clawd themes, including shared-renderer RGBA capture, target-owned Render Presets, verified candidate-frame and encoded-WebP cache reuse, path-free build provenance and concise build reports, generated-asset target preview plans, pre-package Target Profile validation, safe versioned artifact names, RGBA composition, Sharp WebP encoding, deterministic manifests, size limits, zip.js package creation, review gating, and integrity-checked bounded disk caches for derived build assets.
- `packages/cli/` — stable JSON CLI envelope over source inspection, runtime diagnosis, `.live2pet` project validation, shared Package Build from transient pre-captured inputs, ZIP package validation, export/install, and cache management.
- `packages/installation/` — explicit, conflict-aware installation for generated Codex Pet and Clawd Theme packages; building and downloading never install implicitly.
- `packages/app-host/` — typed IPC router, preload API, artifact download/install boundary, opaque native location handles, and hardened window defaults.
- `apps/desktop/` — Electron App with the default React/TypeScript/HeroUI interface: first-run Setup, Welcome, full-page Settings, and Source/Map/Build destinations. It saves projects, previews models, builds ZIPs, and explicitly installs generated artifacts without bundling user runtimes or models. The center column is the only Source Package preview; `apps/mapper/` remains a development reference, not the App entrypoint.
- `packages/clawd-target/` — guide-aligned Clawd Target Profile validation for states, sleep modes, fallbacks, and reactions.
- `packages/codex-target/` — versioned Codex Pet V1/V2 atlas geometry, nine-row mapping, frame-reference layout planning, RGBA composition, and package-shape validation. Desktop builds use [V2 with neutral look poses](docs/codex-sprite-v2.md).
- `packages/live2d-exporter/` — deterministic transparent-frame exporter and Live2D PCK unpacker.
- `docs/research/` — architecture, integration, and ecosystem research.
- `docs/agents/` — repository conventions consumed by engineering skills.

## Planning

- [`CONTEXT.md`](CONTEXT.md) — shared domain vocabulary.
- [`docs/adr/`](docs/adr/) — accepted architecture and product decisions.
- [`docs/specs/live2pet-v1.md`](docs/specs/live2pet-v1.md) — scoped personal-use V1 product and acceptance specification.
- [`docs/agents/project-workflow.md`](docs/agents/project-workflow.md) — save/recovery, source relinking, review gating, and project privacy rules.
- [`docs/plans/live2pet-v1-implementation-plan.md`](docs/plans/live2pet-v1-implementation-plan.md) — outcome-ordered remaining work, issue map, and verification gates.
- [`docs/dependency-inventory.md`](docs/dependency-inventory.md) — pinned runtime dependencies, native modules, and user-provided asset boundaries.
- [`docs/release-checklist.md`](docs/release-checklist.md) — source-publication, private macOS validation, and installer-release gates.

## Local-only data

Character models, rendered frames, theme examples, and release ZIP files are intentionally excluded from Git. They remain local under `examples/`, `.work/`, `archive/`, and `artifacts/` and are not part of the open-source repository.

Live2Pet does not grant rights to any imported model, texture, motion, or derived animation. Cubism Core is also kept local and is not redistributed by this repository.

For runtime sources and one-time import instructions, see [Runtime setup](#runtime-setup).

## Development status

Map provides keyboard-accessible loop and 0.5×/1×/1.5×/2× speed controls for
source preview. Changing either replays the motion; these temporary controls do
not change saved mappings or generated-package timing.
Codex compatibility and timing notes are collapsed under Format details on
the Build page; missing requirements and build errors remain visible.

The core inspection, project, mapping, center-column source preview, manual model Visibility, target-build, progress, cache, validation, generated-preview, artifact-download, and explicit package-install seams are implemented in the default HeroUI App. Remaining V1 work includes target-host UI activation/playback acceptance, optional versioned Spine support, and final macOS accessibility and release qualification.

Codex Skill integration, a hosted Mapper Session, a separate preview window, the official Cubism Web Framework bridge, Windows qualification, and public signed binaries are outside the V1 product. See the [implementation plan](docs/plans/live2pet-v1-implementation-plan.md) for the current order and close criteria.

## Local verification

Start the default Desktop App or build a local unsigned macOS bundle:

```sh
pnpm --filter @live2pet/desktop start
pnpm --filter @live2pet/desktop package:mac
pnpm --filter @live2pet/desktop smoke:mac
```

Start and package commands build the HeroUI assets and stage the internal rendering vendors automatically. The packaged App does not require a Vite server or a preview flag. `preview:shell` is retained as an alias for `start`.

The macOS package includes compiled UI assets, not duplicate React/HeroUI/icon
library source trees or local icon drafts. Vite emits the bundled dependency
license report; stylesheet licenses are copied alongside it. Electron and native
image dependencies remain intact. The current x64 bundle measures about 316 MiB
on disk (down from 434 MiB); this is installed size, not a compressed download.

For opt-in real-model Desktop acceptance, see [the local acceptance guide](docs/desktop-acceptance.md).

```sh
pnpm test
pnpm typecheck
pnpm release:check
node packages/source-inspector/bin/live2pet-inspect.cjs --input /path/to/source-package --pretty
node packages/cli/bin/live2pet.cjs version --pretty
node packages/cli/bin/live2pet.cjs inspect --input /path/to/source-package --pretty
node packages/cli/bin/live2pet.cjs runtime-diagnose --input /path/to/CubismCore.js --pretty
node packages/cli/bin/live2pet.cjs project-validate --input /path/to/project.live2pet --pretty
node packages/cli/bin/live2pet.cjs project-recover --input /path/to/project.live2pet --pretty
node packages/cli/bin/live2pet.cjs package-build --input /path/to/build-spec.json --output /path/to/exports --pretty
node packages/cli/bin/live2pet.cjs package-validate --input /path/to/package.zip --pretty
node packages/cli/bin/live2pet.cjs export --input /path/to/package.zip --output /path/to/export.zip --pretty
node packages/cli/bin/live2pet.cjs install --input /path/to/package.zip --target codex-pet --target-root /path/to/pets --confirm-install --pretty
node packages/cli/bin/live2pet.cjs cache-status --cache-dir /path/to/cache --pretty
node packages/cli/bin/live2pet.cjs cache-clear --cache-dir /path/to/cache --project-id my-project --pretty
# Optional real-runtime smoke tests (local inputs only; never commit these paths)
LIVE2PET_MODERN_RUNTIME=/path/to/live2dcubismcore.min.js LIVE2PET_MODERN_SOURCE=/path/to/modern-model \
  node --test packages/renderer/test/modern-runtime.integration.test.cjs
LIVE2PET_CUBISM2_RUNTIME=/path/to/live2d.min.js LIVE2PET_CUBISM2_SOURCE=/path/to/destiny-child-model \
  node --test packages/renderer/test/legacy-runtime.integration.test.cjs
```

Inspection output is metadata-only: it contains relative resource identities, fingerprints, warnings, and Motion/Expression catalogs, not model bytes, runtime binaries, bearer tokens, or unrelated absolute paths. The browser preview uses the version-matched Pixi `@pixi/unsafe-eval` compatibility bundle and allows only generated `blob:` resource URLs under the existing strict CSP; it does not enable general `unsafe-eval`.
