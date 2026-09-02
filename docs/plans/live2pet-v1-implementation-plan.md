# Live2Pet Personal-Use V1 Implementation Plan

Status: Rescoped on 2026-09-02 — project-oriented desktop App shell

## Outcome and boundary

The only current release outcome is a dependable personal-use macOS Desktop App that completes one-time setup, converts a permitted standard Live2D model or supported Destiny Child PCK into a previewed, validated, downloadable Clawd or Codex ZIP, and explicitly installs the generated package when the user chooses Install or Build & Install.

V1 does not include the official Cubism Web Framework integration, a Codex skill, Mapper Session, Windows qualification, signing, notarization, or public binary distribution. Only Windows and public distribution remain possible future milestones; the other removed product surfaces are not part of the current roadmap.

The center column of the three-column Mapper is the only user-visible Source Package preview in V1. A separate renderer process may remain as an internal crash-isolation or capture mechanism, but a separate preview window, its lifecycle controls, and parity work are not product outcomes and are removed from V1 acceptance.

Success is measured by one continuous desktop workflow: skippable first-run setup, Welcome, Source inspection, center-column Motion/Expression playback in Map, direct target assignment, a terminal Package Build, generated-asset preview, ZIP download, and a user-triggered Install action. Runtime, cache, and installation-destination configuration live in Settings rather than inside the project workspace. Build and download must never install implicitly. The accepted workflow must contain zero prompts to choose between preview implementations and zero separate preview windows.

## Current baseline

The repository already contains:

- standard-folder and supported Destiny Child PCK inspection;
- versioned reference-only projects, recipes, separate target mappings, autosave, relinking, and review gates;
- Pixi-based modern and Cubism 2 adapters, an App-managed Desktop runtime library, and internal renderer isolation seams;
- Clawd and Codex target validators and builders;
- transparent WebP/atlas generation, build progress, cancellation, reports, and bounded caches;
- generated target previews, artifact download handles, and explicit post-build target installers;
- an Electron development shell and English/Simplified Chinese UI layer;
- a current-machine unsigned macOS App assembly command with packaged resource,
  Sharp/libvips, excluded-asset, and Mapper-window smoke checks;
- a shared CLI for build, validation, export, and explicit target-package installation; and
- release scans that exclude runtimes, models, copyrighted examples, and generated character packages.

The current renderer still exposes the implemented features as one long document, mixing App-global runtime/cache controls with project inspection, mapping, and two target build panels. The remaining work is therefore both a focused desktop-shell restructuring and real-runtime product-path hardening, not another renderer or build architecture expansion.

## Prioritized delivery sequence

### P0 — Establish the desktop App shell and Settings boundary

Issue: [#12](https://github.com/receyuki/live2pet/issues/12)

Outcome: a fresh or returning user sees an application lifecycle rather than a browser document, and App-global configuration no longer competes with project work.

Work:

1. Establish the React, TypeScript, and Vite production renderer with HeroUI v3 and its required Tailwind CSS v4 foundation. Use HeroUI as the only general-purpose component system.
2. Add a production App shell with platform title bar, application menu, compact toolbar, status bar, and Welcome versus Project states.
3. Provide Source, Map, and Build destinations that preserve one project and renderer session while changing the visible task surface.
4. Add a full in-window Settings destination with General, Runtimes, Targets & Installation, and Storage section navigation. Move the existing runtime and cache controls out of the project document and restore the previous project context when Settings closes.
5. Add a skippable full-page Setup Assistant that reuses runtime Settings, detects existing runtimes, supports one or both families, and remains available from Help.
6. Persist locale, appearance, recent projects, reopen behavior, installation destinations, and window bounds as App settings; do not put them in `.live2pet`.
7. Add native Open, Save, Undo, Redo, Settings, and Build menu commands and shortcuts.
8. Replace hand-written standard controls with HeroUI components; keep custom presentation limited to the shell, three-column workspace, Live2D canvas and timeline, and restrained brand surfaces.
9. Remove landing-page headings, explanatory banners, duplicate global bars, and footer content from the packaged App navigation.

First review gate:

- run the real Electron App with representative non-copyrighted data;
- first validate a small HeroUI integration slice through Vite packaging and the Electron content security policy;
- review a runnable HeroUI preview of Welcome, full-page first-run setup, full-page Settings, the project toolbar, Source/Map/Build switching, and the three-column Map layout before migrating all working controls;
- review English and Simplified Chinese layout, keyboard focus, reduced motion, and both light and dark appearance; and
- do not commit generated UI concept artwork or model examples as product assets without a separate approval.

Acceptance gate:

- a clean profile shows the Setup Assistant once and a returning profile does not;
- an existing saved runtime is detected without reselection;
- setup can be deferred without blocking Source inspection;
- a missing matching runtime opens Settings at the correct entry and returns to the project after configuration;
- `Cmd+,`, Open, Save, Undo, Redo, and Build commands reach the correct App state; and
- App-global configuration is absent from Source, Map, and Build content;
- Settings is a full in-window destination rather than a modal or child window; and
- no second general-purpose component system or duplicate local primitive set is present in the production renderer.

### P0 — Make one preview-and-mapping flow dependable

Issues: [#3](https://github.com/receyuki/live2pet/issues/3), [#4](https://github.com/receyuki/live2pet/issues/4), [#5](https://github.com/receyuki/live2pet/issues/5)

Outcome: after a one-time runtime selection, the user can preview a modern or supported legacy Source Package in the center column, create an Animation Recipe, assign it, and resume the saved project without choosing or managing a second preview implementation.

Work:

1. Make the App-managed runtime library in Settings the sole runtime source of truth in Desktop mode, remove any second Mapper-managed runtime copy, and automatically select saved runtimes by inspected Cubism generation.
2. Keep modern production rendering on the existing Pixi adapter with user-provided official Cubism Core.
3. Keep Cubism 2 behind its legacy adapter and qualify the locally owned Destiny Child fixture through the same visible preview controls.
4. Keep preview and capture in the center Map destination; do not maintain a separate preview window or its lifecycle API.
5. Complete center-column Motion/Expression controls, full-bounds framing, recoverable failure handling, and actionable mismatch errors.
6. Verify Motion-plus-Expression recipes, separate Clawd/Codex mappings, validation, undo/redo, keyboard operation, autosave, explicit save/reopen, and source relinking.
7. Keep the official Framework bridge out of the implementation.

Acceptance gate:

- one real standard modern model and the locally owned legacy PCK each pass import, reopen, center-column playback, mapping, and capture checks in the Desktop App;
- neither path asks for an already saved matching runtime again; and
- the accepted workflow exposes one visible source preview and no renderer-selection or separate-window controls;
- a real project saves and reopens with equivalent mappings and Render Presets;
- the right column always assigns the currently selected recipe; and
- no Source Package or runtime bytes are embedded.

### P0 — Prove both target packages in their hosts

Issues: [#6](https://github.com/receyuki/live2pet/issues/6), [#7](https://github.com/receyuki/live2pet/issues/7)

Outcome: both generated ZIP types pass internal validation, can be previewed from generated assets, and load in the pinned target host.

Clawd work:

1. Treat `idle`, `thinking`, `working`, and `sleeping` as the required V1 path.
2. Verify transparent WebP generation, `theme.json`, package-root shape, display size, and the 80-MiB rejection behavior.
3. Use the App's explicit post-build Install action for one locally generated ZIP and verify it in the pinned Clawd version.
4. Keep advanced sleep, fallbacks, reactions, tiers, idle pools, and roam available but non-blocking.

Codex work:

1. Verify all nine mapped rows, exact atlas geometry, transparent unused cells, deterministic sampling, and manifest shape.
2. Verify contact sheet and true-size playback use the generated atlas.
3. Use the App's explicit post-build Install action for one locally generated ZIP and verify it through the current Codex custom-pet workflow.

Acceptance gate:

- explicit post-build installation succeeds for both hosts without making build or download install implicitly;
- generated previews match the artifact rather than source playback; and
- any host mismatch is captured as a narrow compatibility fix, not a new framework project.

### P1 — Harden build, cache, progress, download, and installation

Issue: [#8](https://github.com/receyuki/live2pet/issues/8)

Outcome: long builds are understandable, cancellable, reusable, and always end in a clear terminal state with a portable artifact that the user can explicitly install.

Work:

1. Move both target builders into the Build destination and verify named stages, percentage progress, terminal success/failure/cancelled state, and build-control reset.
2. Keep renderer capture concurrency bounded; parallelize safe independent encoding/assembly only where measurements show a benefit.
3. Verify unchanged rebuilds use integrity-checked capture and WebP cache entries.
4. Verify cancellation and failure clean staging data and never expose a partial artifact.
5. Verify reports, path redaction, safe artifact naming, generated preview, and explicit ZIP download.
6. Verify a separate post-build Install action and explicit Build & Install command for each target, including success, actionable failure, and safe handling of an existing installed package.
7. Keep a 5-GiB cache policy outside V1 acceptance.

Acceptance gate:

- both targets finish with a visible terminal state and downloadable ZIP;
- each validated package installs into its selected target host only after the user explicitly chooses Install;
- a cancelled build can be followed immediately by a successful build;
- an unchanged rebuild reports cache hits and avoids equivalent capture work; and
- builds do not install or overwrite artifacts implicitly.

### P1 — Package and accept the personal-use macOS App

Issue: [#10](https://github.com/receyuki/live2pet/issues/10)

Outcome: the user can launch a local macOS App and complete the entire workflow without development commands after the App has been built.

Work:

1. Produce and smoke-test the current-machine macOS App bundle with packaged renderer assets and native image dependencies.
2. Run the first-launch, deferred-setup, Settings, modern, legacy, both-target, cancellation, restart, and runtime-reuse acceptance scenarios from the V1 specification.
3. Complete the required English/Chinese, keyboard, focus, contrast, reduced-motion, progress-announcement, and error-state review.
4. Verify the project window remains usable at the supported minimum size and restores its previous bounds.
5. Run dependency, source-release, path/privacy, and excluded-asset scans.
6. Write a short personal-build/run guide that clearly separates local use from public signed binary release.

Acceptance gate:

- a clean macOS user profile completes import through ZIP download and explicit installation for both targets;
- no system codec tool is required;
- all P0/P1 issues are closed with test or manual acceptance evidence; and
- the public binary release gate remains explicitly separate.

## Dependency graph

```mermaid
flowchart LR
    I2[#2 Source inspection - closed] --> I3[#3 Modern center preview and capture]
    I2 --> I4[#4 Legacy center preview and capture]
    UI[#12 Desktop shell and Settings] --> I5
    I3 --> I5[#5 Single-preview durable mapper]
    I5 --> I6
    I5 --> I7
    I6 --> I8[#8 Build and export]
    I7 --> I8
    I4 --> I10[#10 macOS personal-use V1]
    I5 --> I10
    I6 --> I10
    I7 --> I10
    I8 --> I10
```

[#11](https://github.com/receyuki/live2pet/issues/11) is post-V1 and is not on this dependency graph. #9 is closed as removed scope rather than carried as a hidden product surface.

## Issue status policy

| Issue | V1 role | Close when |
| --- | --- | --- |
| #2 Source inspection | Complete | Already closed |
| #12 Desktop shell | P0 | First-run, Settings, Welcome, and Source/Map/Build navigation pass the real App review |
| #3 Modern preview | P0 | Real modern model plays in the center column and captures with a saved runtime |
| #4 Legacy preview | P0 | Locally owned PCK plays in the center column and captures with a saved runtime |
| #5 Durable mapper | P0 | The single-preview three-column flow saves and reopens without mapping drift |
| #6 Clawd package | P0 | Core-state ZIP imports into pinned Clawd |
| #7 Codex package | P0 | Nine-row ZIP loads in Codex |
| #8 Build/export | P1 | Progress, cancel, cache, preview, download, and explicit install pass |
| #10 macOS V1 | Final | Clean-profile full workflow passes |
| #9 Codex skill/session | Removed scope | Close after the unused implementation and documentation are removed |
| #11 Windows x64 | Post-V1 | Reprioritize after macOS V1 |

An issue closes when its observable acceptance evidence exists, even if optional polish or post-V1 capability remains. Follow-up work becomes a narrower issue instead of keeping a broad issue open indefinitely.

## Verification matrix

| Surface | Automated evidence | Local acceptance evidence |
| --- | --- | --- |
| Source inspection | Synthetic standard/PCK contracts and malformed-input tests | Owned modern model and Destiny Child PCK |
| Runtime library | Validation, persistence, generation selection, clear/replace tests | Restart and reopen without reselection |
| Desktop shell | First-run state, Settings ownership, menu routing, destination-state, and window-bounds tests | Clean-profile setup and returning-project flow |
| Renderer | Shared deterministic playback/capture contract and failure-recovery tests | Center-column Motion/Expression playback on both generations |
| Project/mapper | Schema, save/recovery, relink, mapping validation tests | Electron save/reopen and keyboard flow |
| Clawd | Synthetic manifest/WebP/size/package validation | Import into pinned Clawd version |
| Codex | Synthetic atlas/manifest/transparency validation | Load through current custom-pet workflow |
| Build service | Progress, cancel, cache, path-redaction, artifact, and explicit-install tests | Repeat build, ZIP download, and user-triggered installation into both hosts |
| macOS App | Bundle launch and packaged-dependency smoke | Clean-profile end-to-end run |

## Deferred backlog

- [#11](https://github.com/receyuki/live2pet/issues/11): Windows x64 qualification.
- Public signed/notarized installers and update channel.
- Large configurable cache policy and cache-management UI beyond current bounded controls.
- Advanced Clawd behavior as mandatory target-host acceptance.
- Multi-window projects, panel docking, and a separate public browser workflow.

## Definition of done for V1 implementation issues

1. The issue stays within the V1 scope above.
2. Observable acceptance criteria are covered by automated tests where practical.
3. Any real-runtime or target-host evidence is recorded without committing proprietary inputs.
4. `pnpm test`, `pnpm typecheck`, and `pnpm release:check` pass for implementation changes.
5. English documentation and affected Simplified Chinese UI messages are updated.
6. No runtime, model, generated character package, secret, token, or unrelated absolute path is introduced.
7. The Issue body and native GitHub dependencies match the actual remaining work.

The desktop information architecture is recorded in ADR-0012, and the HeroUI
interface foundation is recorded in ADR-0013. The first UI review uses the
production Electron shell with synthetic representative data, not a separate
throwaway browser prototype.
