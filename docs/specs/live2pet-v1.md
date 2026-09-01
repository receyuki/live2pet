# Live2Pet Personal-Use V1 Specification

Status: Rescoped on 2026-09-01 — single visible preview surface

## Product outcome

V1 is successful when one macOS user can take a permitted local Live2D model from import to a validated Clawd theme ZIP or Codex custom-pet ZIP without rebuilding Live2Pet, manually running conversion commands, or repeatedly selecting the same renderer runtime.

The Desktop App is the V1 product. Existing CLI, installation, Mapper Session, Codex skill, and official Cubism Web Framework seams may remain in the repository, but they are not release gates for this milestone.

The center column of the Mapper is the only user-visible Source Package preview. Process isolation may remain behind that surface for crash recovery or Package Build capture, but V1 does not expose or require a separate preview window.

## Primary workflow

1. Open the macOS Desktop App.
2. Select a standard Cubism model directory or a supported Destiny Child PCK.
3. Let Live2Pet identify the Cubism generation and use a previously saved compatible runtime; select a runtime only when none is available.
4. Browse Motions and Expressions, play them in the center-column preview, and create a Motion-plus-optional-Expression Animation Recipe.
5. Assign the currently selected recipe to Clawd or Codex slots in the separate target mapping.
6. Review missing mappings and choose a fixed Render Preset.
7. Build while observing progress and, when needed, cancel safely.
8. Preview generated target assets, review validation results, and download a portable ZIP.

## V1 scope

### Platform and delivery

- macOS is the only required V1 platform.
- A locally built, unsigned personal-use App is sufficient for V1 acceptance.
- The App must run without system FFmpeg, ImageMagick, libwebp commands, a system ZIP tool, or Homebrew-installed codecs.
- English and Simplified Chinese UI are both required.
- Public signed/notarized installers, automatic updates, and public binary distribution are separate release work.

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
- The App copies an explicitly selected runtime into App-managed local storage, validates it, records its detected compatibility, and automatically reuses it for matching models on later launches.
- A user can replace or clear a saved runtime. Runtime changes do not require rebuilding Live2Pet.
- The App chooses modern or legacy rendering from inspected model generation; it must not ask the user to make that technical choice for every model.
- The center column is the only visible source preview and supports Motion play, pause, restart, loop, speed control, and optional Expression apply/clear.
- Preview fits the full animated model bounds instead of silently cropping it.
- A separate preview window, renderer selector, and duplicate playback controls are excluded from the V1 user workflow.
- Renderer failure must leave the project and Mapper usable and produce a recoverable error; process isolation is an internal implementation choice.
- The official Cubism Web Framework bridge remains experimental and is not selectable or required in V1.
- No Cubism Core, legacy runtime, model, texture, or copyrighted example is bundled in source or release artifacts.

### Project and mapper

- The primary UI remains a three-column workflow: Motion/Expression library, live preview, and target mapping.
- Selecting a Motion on the left defines the current recipe; assigning on the right uses that selected recipe rather than a second Motion dropdown.
- Clawd and Codex mappings are separate.
- Required slots and blocking validation update immediately.
- Semantic mappings are always user-confirmed; Live2Pet does not auto-assign them.
- A versioned `.live2pet` project stores references, recipes, target mappings, metadata, and Render Presets without embedding model or runtime bytes.
- Saving, reopening, autosave recovery, source relinking, and changed-source review preserve work safely.
- The mapping and build workflow is keyboard operable; drag and drop is optional.

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
- A successful build exposes generated preview and explicit ZIP download in the App.
- Installation into Clawd or Codex is optional existing functionality, not a V1 acceptance requirement. Build and download never install implicitly.

## V1 acceptance scenarios

### Modern model path

On a clean macOS user profile, select a permitted standard Cubism 3+ model and official Core once. Restart the App, reopen the model without selecting Core again, preview at least one Motion and Expression in the center column, map it, build one target, preview generated output, validate it, and download the ZIP.

### Legacy PCK path

On the same App, select the locally owned tested Destiny Child PCK and a compatible Cubism 2 runtime once. Reopen it without selecting the runtime again, preview a Motion in the same center column, map it, and complete at least one target build and ZIP download.

### Both-target project path

Save one `.live2pet` project with separate Clawd and Codex mappings. Reopen it, build both targets, confirm progress reaches a terminal state, confirm generated previews work, and validate both ZIPs. Import each ZIP into its pinned target host.

### Failure and privacy path

Verify that incompatible runtime, unsupported PCK, missing resource, cancelled build, oversized Clawd ZIP, and renderer crash all produce actionable errors without losing the saved project. Scan output packages, reports, and tracked files for runtimes, model assets, tokens, secrets, and unrelated absolute paths.

## Verification strategy

- Public CI uses synthetic fixtures and a deterministic renderer; it never requires proprietary Core or copyrighted model data.
- Optional local integration tests use user-provided runtimes and locally owned models.
- Shared renderer contract tests cover playback, bounds, deterministic stepping, RGBA capture, unload, and failure isolation.
- Target validators use minimal synthetic valid and invalid packages.
- A final manual macOS acceptance run uses the real Desktop App and installed Clawd/Codex hosts.
- Documentation-only changes run source-release scanning and link/path checks; implementation changes also run unit tests and type checking.

## Explicitly deferred until after V1

- Official Cubism Web Framework as the production renderer.
- A separate user-visible preview window, renderer chooser, or duplicated preview lifecycle controls.
- Codex skill installation, CLI automation as a product surface, and browser Mapper Session.
- Windows x64 qualification and platform installers.
- Automatic target-host installation as part of the happy path.
- Public signed/notarized binaries, automatic updates, and unresolved binary-distribution licensing work.
- A multi-gigabyte configurable cache; V1 keeps the implemented bounded cache and clear controls.
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
- Codex Pet workflow: <https://github.com/openai/skills/tree/main/skills/.curated/hatch-pet>
- Clawd theme guide: <https://github.com/rullerzhou-afk/clawd-on-desk/blob/main/docs/guides/guide-theme-creation.md>
- Cubism Core: <https://docs.live2d.com/en/cubism-sdk-manual/cubism-core/>
