# Live2Pet Personal-Use V1 Specification

Status: Rescoped on 2026-09-02 — project-oriented desktop App shell

## Product outcome

V1 is successful when one macOS user can complete first-run setup once, take a permitted local Live2D model from import to a validated Clawd theme ZIP or Codex custom-pet ZIP, then explicitly install the generated package into its target host, without rebuilding Live2Pet, manually running conversion commands, or repeatedly selecting the same renderer runtime.

The Desktop App is the V1 product. The repository keeps the shared build/install CLI for automation, but does not ship a Codex skill, Mapper Session, separate preview product surface, or official Cubism Web Framework adapter.

The center column of the Mapper is the only user-visible Source Package preview. Process isolation may remain behind that surface for crash recovery or Package Build capture, but V1 does not expose or require a separate preview window.

## Primary workflow

1. Open the macOS Desktop App and complete or skip the first-run Setup Assistant.
2. From Welcome, open a `.live2pet` project or select a standard Cubism model directory or supported Destiny Child PCK.
3. Let Live2Pet identify the Cubism generation and use a compatible runtime from App Settings; configure a missing runtime once through the matching Settings entry.
4. Review normalized model and resource results in Source.
5. In Map, browse Motions and Expressions, play them in the center-column preview, and create a Motion-plus-optional-Expression Animation Recipe.
6. Assign the currently selected recipe to Clawd or Codex slots in the separate target mapping.
7. In Build, review missing mappings and choose a fixed Render Preset.
8. Build while observing progress and, when needed, cancel safely.
9. Preview generated target assets, review validation results, and download a portable ZIP.
10. Explicitly choose Install or Build & Install to place the validated generated package into the configured Clawd or Codex host.

## V1 scope

### Platform and delivery

- macOS is the only required V1 platform.
- A locally built, unsigned personal-use App is sufficient for V1 acceptance.
- The App must run without system FFmpeg, ImageMagick, libwebp commands, a system ZIP tool, or Homebrew-installed codecs.
- English and Simplified Chinese UI are both required.
- Public signed/notarized installers, automatic updates, and public binary distribution are separate release work.

### Desktop application shell and settings

- The packaged Desktop App, not the browser-loadable Mapper document, is the V1 product surface.
- A skippable first-run Setup Assistant explains local runtime requirements, detects already saved runtimes, and reuses the same runtime controls as Settings.
- Welcome provides recent projects, Open Project, and Import Source Package without showing project-only controls before a project exists.
- One project window provides Source, Map, and Build destinations through a compact application toolbar and preserves project state when switching between them.
- Source owns inspection and resource compatibility, Map owns source playback and semantic Assignment, and Build owns readiness, progress, generated preview, download, and installation.
- Settings is a full in-window destination with General, Runtimes, Targets & Installation, and Storage sections. It is not a modal, sheet, or separate window, and leaving it restores the previous project destination and state.
- The App provides standard application menus and keyboard shortcuts for Open, Save, Undo, Redo, Settings, and Build.
- The production interface uses React, TypeScript, Vite, HeroUI v3, and HeroUI's Tailwind CSS v4 foundation. HeroUI is the only general-purpose component system in the production renderer.
- Standard controls use HeroUI components and semantic theme variables. Custom presentation is limited to the App shell, three-column workspace, Live2D canvas and timeline, and restrained Live2Pet branding.
- The window uses system typography, neutral surfaces with one violet-blue brand accent, semantic light/dark tokens, desktop control density, clear focus, and restrained motion. Large-area glass, persistent glow, website hero copy, marketing footers, and dashboard card grids are not part of the App shell.
- A runnable preview using real HeroUI components must validate Map, Settings, English and Simplified Chinese layout, keyboard focus, and light/dark appearance before the working Mapper controls are migrated.
- Unavailable actions state the missing requirement and recovery action rather than appearing as unexplained disabled controls.
- Long builds remain observable and cancellable without freezing project navigation; one terminal success, failure, or cancelled state replaces indefinite busy copy.

### Source Packages

- Accept a directory containing a valid Cubism 2 `model.json` or Cubism 3+ `.model3.json` and its referenced local resources.
- Accept the already-tested uncompressed and unencrypted Destiny Child `PCK\0` shape.
- List discovered Motions and Expressions without guessing their semantic meaning.
- Report missing or incompatible resources by actionable relative identity.
- Reject compressed, encrypted, malformed, oversized, or unknown containers explicitly. V1 does not decrypt or heuristically repair them.
- Keep model assets local and out of the repository, diagnostics, project documents, and generated package metadata.

### Runtime management and rendering

- Modern Cubism preview uses the existing Pixi renderer adapter with a user-provided official Cubism Core.
- Legacy Cubism 2 preview uses its legacy Pixi adapter with a user-provided compatible `live2d.min.js`.
- In Desktop mode, App-managed local storage is the sole runtime source of truth. The App copies an explicitly selected runtime there, validates it, records its detected compatibility, and automatically reuses it for matching models on later launches; the Mapper does not persist a second runtime copy.
- A user can add, verify, replace, or clear each saved runtime from Settings. Runtime changes do not require rebuilding Live2Pet.
- First-run setup may be deferred. Source inspection remains available without a runtime, while preview and build show a direct link to the required runtime Settings entry.
- The App chooses modern or legacy rendering from inspected model generation; it must not ask the user to make that technical choice for every model.
- The center column is the only visible source preview and supports Motion play, pause, restart, loop, speed control, and optional Expression apply/clear.
- Preview fits the full animated model bounds instead of silently cropping it.
- A separate preview window, renderer selector, and duplicate playback controls are excluded from the V1 user workflow.
- Renderer failure must leave the project and Mapper usable and produce a recoverable error; process isolation is an internal implementation choice.
- The official Cubism Web Framework bridge is not part of the product or V1 implementation.
- No Cubism Core, legacy runtime, model, texture, or copyrighted example is bundled in source or release artifacts.

### Project and mapper

- The Map destination remains a three-column workflow: Motion/Expression library, live preview, and target mapping.
- Source inspection and Package Build are separate destinations in the same project window rather than sections above or below the mapping workspace.
- Selecting a Motion on the left defines the current recipe; assigning on the right uses that selected recipe rather than a second Motion dropdown.
- Clawd and Codex mappings are separate.
- Required slots and blocking validation update immediately.
- Semantic mappings are always user-confirmed; Live2Pet does not auto-assign them.
- A versioned `.live2pet` project stores references, recipes, target mappings, metadata, and Render Presets without embedding model or runtime bytes.
- Saving, reopening, autosave recovery, source relinking, and changed-source review preserve work safely.
- The mapping and build workflow is keyboard operable; drag and drop is optional.
- App Settings, window state, recent projects, runtime descriptors, installation destinations, and cache status are not stored in `.live2pet` project documents.

### Clawd Target Profile

- The minimum V1 success path maps and builds `idle`, `thinking`, `working`, and `sleeping`.
- Generate transparent static or animated WebP assets plus a guide-shaped `theme.json` and portable ZIP.
- Use fixed Compact, Balanced, and High Render Presets and fixed Small, Standard, and Large display presets; Large remains the default display size.
- Preview generated output rather than only replaying the source model.
- Validate required states, referenced assets, metadata, canvas, alpha, WebP shape, package root, and the current 83,886,080-byte ZIP limit.
- A locally generated package must import into the pinned installed Clawd version.
- Already implemented sleep transitions, fallbacks, reactions, idle pools, tiers, and roam configuration remain available as advanced capabilities, but they do not block V1 unless they break the core theme path.

### Codex Pet V1 Target Profile

- Require mappings for `idle`, `running-right`, `running-left`, `waving`, `jumping`, `failed`, `waiting`, `running`, and `review`.
- Generate `pet.json` plus a transparent 1536-by-1872 `spritesheet.webp` with 8 columns, 9 rows, and 192-by-208 cells.
- Keep directional rows separately user-confirmed and leave unused cells fully transparent.
- Deterministically select important poses while preserving full-model bounds and cell containment.
- Provide a contact sheet and true-size row playback from the generated atlas.
- Validate manifest, geometry, occupancy, alpha, frame references, and safe ZIP shape.
- A locally generated package must load through the current documented Codex custom-pet workflow.

### Package Build and export

- Both targets use one build service: inspect, validate, analyze bounds, capture, select, encode, assemble, validate, preview, package, and report.
- The Desktop App shows a named current stage, percentage, and terminal success/failure/cancelled state.
- Cancellation leaves no partial package; only integrity-checked reusable cache entries may remain.
- Unchanged rebuilds reuse verified capture and encoding cache entries.
- Safe independent encoding and target assembly work may run in parallel. Live2D capture remains bounded by renderer stability rather than an arbitrary worker count.
- Build reports contain versions, timings, cache hits, warnings, validation results, and artifact sizes while redacting absolute source paths and secrets.
- Artifact names include a safe package id, target id, and version and do not overwrite existing output by default.
- A successful, validated build exposes generated preview, explicit ZIP download, and a separate explicit Install action in the App. An explicit Build & Install command may combine the two user-requested operations.
- The Install action places the generated package into the selected Clawd or Codex host and reports a clear success or actionable failure state.
- Build and download never install or overwrite a target-host package implicitly.

## V1 acceptance scenarios

### Modern model path

On a clean macOS user profile, complete the Setup Assistant with a permitted official Core, import a permitted standard Cubism 3+ model from Welcome, and confirm Source, Map, and Build preserve one project. Restart the App, reopen the model without selecting Core again, preview at least one Motion and Expression in the center column, map it, build one target, preview generated output, validate it, download the ZIP, and explicitly install it into the selected target host.

### Legacy PCK path

On the same App, select the locally owned tested Destiny Child PCK and a compatible Cubism 2 runtime once. Reopen it without selecting the runtime again, preview a Motion in the same center column, map it, and complete at least one target build, ZIP download, and explicit target-host installation.

### Both-target project path

Save one `.live2pet` project with separate Clawd and Codex mappings. Reopen it, build both targets, confirm progress reaches a terminal state, confirm generated previews work, and validate both ZIPs. Use the separate Install action for each generated package and confirm that each loads in its pinned target host; confirm that building or downloading alone does not install either package.

### Failure and privacy path

Verify that deferred setup, incompatible runtime, unsupported PCK, missing resource, cancelled build, oversized Clawd ZIP, and renderer crash all produce actionable recovery without losing the saved project. Confirm that configuring a missing runtime through Settings returns to the project and does not require another source import. Scan output packages, reports, and tracked files for runtimes, model assets, tokens, secrets, and unrelated absolute paths.

## Verification strategy

- Public CI uses synthetic fixtures and a deterministic renderer; it never requires proprietary Core or copyrighted model data.
- Optional local integration tests use user-provided runtimes and locally owned models.
- Shared renderer contract tests cover playback, bounds, deterministic stepping, RGBA capture, unload, and failure isolation.
- Target validators use minimal synthetic valid and invalid packages.
- A final manual macOS acceptance run uses the real Desktop App to explicitly install generated packages into installed Clawd/Codex hosts.
- Documentation-only changes run source-release scanning and link/path checks; implementation changes also run unit tests and type checking.

## Explicitly outside the product plan

- Official Cubism Web Framework as the production renderer.
- A separate user-visible preview window, renderer chooser, or duplicated preview lifecycle controls.
- Codex skill installation and browser Mapper Session. The ordinary CLI remains a shared build/install interface, not a second product workflow.
- Windows x64 qualification and platform installers.
- Public signed/notarized binaries, automatic updates, and unresolved binary-distribution licensing work.
- A multi-gigabyte configurable cache; V1 keeps the implemented bounded cache and clear controls.
- Multi-window project editing, detachable panels, docking, accounts, dashboards, or a plugin marketplace.
- Advanced Clawd behavior as mandatory acceptance: full sleep choreography, reactions, tiers, idle pools, roam, and other host-specific polish.
- Cloud storage, accounts, telemetry, collaboration, remote rendering, and automatic semantic mapping.
- Decryption or reverse engineering of unknown PCK, LPK, ViewerEX, or other proprietary containers.
- Live2DViewerEX/VTube Studio control, agent-state monitoring, approval UI, quota UI, or replacing Clawd/Codex as the desktop host.

## Release boundaries

- Live2Pet original code is Apache-2.0; imported models, generated derivatives, runtimes, and third-party libraries retain their own terms.
- Do not commit or publish example models, generated character themes, Cubism Core, or legacy runtimes without explicit redistribution permission.
- Source publication and personal local builds are distinct from public ready-to-run binary distribution.
- V1 completion does not itself authorize a public binary release.

## References

- Implementation order: `docs/plans/live2pet-v1-implementation-plan.md`
- Renderer decision: `docs/adr/0011-use-pixi-for-the-personal-use-v1-renderer.md`
- Desktop App shell decision: `docs/adr/0012-use-a-project-oriented-desktop-app-shell.md`
- Desktop interface system decision: `docs/adr/0013-use-heroui-for-the-desktop-interface.md`
- Codex Pet workflow: <https://github.com/openai/skills/tree/main/skills/.curated/hatch-pet>
- Clawd theme guide: <https://github.com/rullerzhou-afk/clawd-on-desk/blob/main/docs/guides/guide-theme-creation.md>
- Cubism Core: <https://docs.live2d.com/en/cubism-sdk-manual/cubism-core/>
