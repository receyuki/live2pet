## Problem Statement

The working Live2D-to-pet workflow has been proven through a browser mapper, a Destiny Child PCK extractor, a transparent frame exporter, and manually assembled Clawd themes. It is not yet a complete product: import and rendering logic are duplicated, Motion Mappings are not stored in a durable project format, package generation still depends on machine-specific tools and manual steps, and the current prototype is centered on Clawd even though Codex now supports custom pets.

A user who owns a Live2D Source Package needs one local application that can inspect and preview the original model, create user-confirmed Animation Recipes and Motion Mappings, build target-correct Clawd Theme Packages and Codex Pet Packages, preview the final behavior, validate it, and optionally install it. The same capability must be available to Codex through a small skill without duplicating the desktop runtime or requiring model assets to leave the computer.

## Solution

Build Live2Pet as a local-first Electron desktop application with a shared TypeScript domain and Package Build pipeline. The App imports standard Cubism Source Packages and the tested uncompressed Destiny Child PCK layout, previews the model through isolated modern and legacy renderer adapters, and provides a three-column workspace for creating Animation Recipes and target-specific Motion Mappings.

Live2Pet stores editable work in a reference-based `.live2pet` document and builds validated Pet Packages through versioned Target Profiles. V1 supports an animation-oriented Clawd Theme Package and the official Codex Pet V1 sprite-atlas contract. The App also ships a matching CLI and a one-click-installable Codex skill. The skill can perform headless inspection, validation, Package Builds, export, and explicitly authorized installation; visual mapping opens the shared mapper in an authenticated, short-lived loopback Mapper Session inside Codex, with the Electron App as fallback.

All model processing remains local. Cubism Core and legacy runtimes are selected by the user and are never bundled, uploaded, copied into projects, or included in generated packages. Source publication and public binary distribution remain separate release gates.

## User Stories

1. As a Live2D owner, I want to choose a standard Cubism Source Package, so that I can begin without manually reorganizing its files.
2. As a Destiny Child asset owner, I want to choose a supported PCK file, so that I can use the workflow that the prototype already proved.
3. As a user, I want unsupported compressed, encrypted, or unknown containers to fail clearly, so that the App never pretends it imported incomplete data.
4. As a user, I want Live2Pet to identify the Cubism generation, so that it can select the compatible renderer automatically.
5. As a user, I want Live2Pet to list every discovered Motion, so that I know which source animations are available.
6. As a user, I want Live2Pet to list every discovered Expression, so that I can combine facial changes with a Motion.
7. As a user, I want missing textures, motions, expressions, physics, poses, and model binaries reported by resource name, so that I can repair the Source Package.
8. As a user, I want the App to link to the official Cubism SDK download page, so that I can obtain Cubism Core through the proper license flow.
9. As a user, I want to select a downloaded Cubism Core file or SDK directory, so that I can run the installed App without rebuilding it.
10. As a user, I want Live2Pet to validate the selected runtime and show its detected version, so that incompatible Core files fail before model loading.
11. As a user, I want an actionable setup message when no runtime is configured, so that I know how to enable preview and Package Builds.
12. As a user, I want a runtime change to take effect after restarting the App, so that V1 avoids unsafe hot replacement while still avoiding recompilation.
13. As a user, I want all model processing to stay on my computer, so that private or licensed model assets are not uploaded.
14. As a user, I want a first-import rights reminder, so that the tool makes the asset-ownership boundary clear without interrupting every build.
15. As a user, I want to record an optional source-license note in my project, so that I retain provenance for future distribution decisions.
16. As a user, I want to play a Motion directly on the Live2D model, so that I can judge its meaning before mapping it.
17. As a user, I want to pause, restart, loop, and change preview speed, so that I can inspect short and subtle motions.
18. As a user, I want to apply and clear an Expression while a Motion plays, so that I can evaluate the complete Animation Recipe.
19. As a user, I want the preview to fit the full model without cropping, so that large costume, hair, weapon, and skirt movement remains visible.
20. As a user, I want preview failures isolated from the main App UI, so that a broken model cannot crash or gain filesystem access through the interface.
21. As a user, I want one Animation Recipe to contain one Motion and an optional Expression, so that recipes stay reusable and understandable.
22. As a user, I want to reuse an Animation Recipe across multiple target behavior slots, so that I do not render identical source motion repeatedly.
23. As a user, I want Clawd and Codex mappings to remain separate, so that their behavior vocabularies do not contaminate each other.
24. As a user, I want Live2Pet to avoid guessing semantic mappings, so that a visually plausible but incorrect Motion is never assigned silently.
25. As a user, I want required behavior slots identified visibly, so that I know what must be mapped before building.
26. As a user, I want optional behavior slots grouped by capability, so that I can choose the polish level without seeing an undifferentiated schema dump.
27. As a user, I want the Motion library, live preview, and target slots visible together, so that I can compare and map efficiently.
28. As a user, I want to assign the currently previewed Animation Recipe to a target slot, so that mapping takes one deliberate action.
29. As a user, I want to drag or select recipes for target slots, so that the mapper supports both exploratory and repetitive work.
30. As a user, I want mapping validation to update immediately, so that missing requirements and invalid fallbacks are visible before a build.
31. As a user, I want to undo and redo mapping changes, so that an accidental assignment or clear operation is recoverable.
32. As a user, I want unsaved-change indicators and recovery, so that closing the App does not silently discard a long mapping session.
33. As a returning user, I want to reopen a `.live2pet` document, so that I can continue editing without repeating import and mapping.
34. As a returning user, I want the project to reference rather than embed the Source Package, so that projects stay small and do not redistribute model assets.
35. As a returning user, I want Live2Pet to detect a changed or moved Source Package, so that stale data is never used silently.
36. As a returning user, I want to relink a moved Source Package, so that reorganizing my local files does not destroy the project.
37. As a returning user, I want stable recipes preserved after relinking, so that harmless moves do not erase work.
38. As a returning user, I want changed or missing source identities marked for mandatory review, so that preserved mappings cannot build until they are trustworthy again.
39. As a user, I want Package metadata such as display name, id, version, author, description, and license note stored in the project, so that builds are repeatable.
40. As a user, I want generated Pet Packages to remain outputs rather than editable projects, so that the source of truth stays unambiguous.
41. As a Clawd user, I want to map `idle`, `thinking`, `working`, and `sleeping`, so that I can build a valid core theme.
42. As a Clawd user, I want to choose direct or full sleep behavior, so that I can trade animation coverage for mapping effort.
43. As a Clawd user, I want to map `yawning`, `dozing`, `collapsing`, and `waking` for full sleep, so that sleep transitions can match the source character.
44. As a Clawd user, I want to map common states such as `error`, `attention`, `notification`, `sweeping`, `carrying`, `juggling`, and `roam`, so that agent activity can use distinct animations.
45. As a Clawd user, I want supported state fallbacks represented explicitly, so that omitted optional visuals still behave according to the Clawd contract.
46. As a Clawd user, I want to configure working and juggling tiers with mapped Animation Recipes, so that concurrent sessions and subagents can look different.
47. As a Clawd user, I want to map drag, directional click, annoyed, and rapid-click reactions, so that the generated pet remains interactive.
48. As a Clawd user, I want to map an optional idle animation pool, so that idle behavior is not repetitive.
49. As a Clawd user, I want an explicit roam Motion, so that free-roam movement uses authored animation rather than synthetic bobbing.
50. As a Clawd user, I want eye tracking disabled automatically for WebP output, so that the package does not claim an SVG-only capability it cannot provide.
51. As a Clawd user, I want Small, Standard, and Large display-size presets with Large as the default, so that detailed full-body models are visible on the desktop.
52. As a Clawd user, I want Compact, Balanced, and High Render Presets, so that I can trade package size, render time, and visual fidelity without editing codec parameters.
53. As a Clawd user, I want an over-80-MiB build to stop and identify the largest assets, so that I can select a lower preset without silent quality loss.
54. As a Clawd user, I want a final theme preview that follows Clawd state, fallback, timing, and loop behavior, so that I can catch errors before import.
55. As a Clawd user, I want the final theme schema and every referenced asset validated, so that the package can be accepted by the current Clawd runtime.
56. As a Codex user, I want all nine official V1 pet states presented as target slots, so that the package follows the documented custom-pet workflow.
57. As a Codex user, I want the output atlas fixed at 1536 by 1872 pixels with an 8-by-9 grid, so that Codex can address every frame correctly.
58. As a Codex user, I want each atlas cell fixed at 192 by 208 pixels with transparent unused cells, so that rows cannot bleed into one another.
59. As a Codex user, I want the full character prioritized over close cropping, so that the source model's body and animation remain complete.
60. As a Codex user, I want Live2Pet to render above final resolution and downsample cleanly, so that transparent edges remain as sharp as possible at pet size.
61. As a Codex user, I want motion-aware frame selection, so that a long Live2D Motion retains key poses instead of losing them to uniform sampling.
62. As a Codex user, I want state-specific frame counts and default timing to follow the official V1 behavior, so that playback matches Codex expectations.
63. As a Codex user, I want a true-size final preview, so that I can see whether fine details are readable in a 192-by-208 cell.
64. As a Codex user, I want atlas geometry, transparency, unused cells, manifest fields, frame references, and fallbacks validated, so that the package loads predictably.
65. As a user, I want Clawd and Codex outputs built from the same project, so that I can support both hosts without duplicate projects.
66. As a user, I want each Package Build to show inspect, render, encode, validate, preview, and package progress, so that long work is understandable.
67. As a user, I want to cancel a Package Build safely, so that large models do not trap the App in an unwanted render.
68. As a user, I want a failed step to retain safe reusable cache entries, so that fixing metadata does not force unrelated frames to render again.
69. As a user, I want a clear build report, so that I can see target version, runtime version, encoder version, warnings, output size, and validation outcome.
70. As a user, I want build reports and Pet Packages to omit absolute source paths, so that sharing an output does not reveal my filesystem.
71. As a user, I want output names derived from package id and version, so that different builds remain distinguishable.
72. As a user, I want builds to avoid overwriting an existing artifact by default, so that a known-good package is not lost.
73. As a user, I want to export a portable Pet Package even when I do not install it, so that I can archive or share it independently.
74. As a user, I want installation to be an explicit post-build action, so that building never writes into another application's data directory implicitly.
75. As a user, I want an existing installed id to produce upgrade, side-by-side, or cancel choices, so that conflicts are resolved deliberately.
76. As a user, I want explicit upgrades staged and recoverable, so that an interrupted install cannot corrupt the prior pet.
77. As a user, I want derived PCK files, sampled frames, and encoded assets stored in a bounded App cache, so that rebuilds are faster without polluting the project directory.
78. As a user, I want to inspect and clear the cache, so that I retain control over disk usage and derived copyrighted material.
79. As a user, I want Live2Pet to operate without an account, telemetry, or uploads, so that the tool remains local and private.
80. As a Codex user, I want to install the matching Live2Pet skill from the App, so that skill and runtime versions remain compatible.
81. As a Codex user, I want the skill to inspect, validate, build, and export through the installed CLI, so that automation uses the same pipeline as the App.
82. As a Codex user, I want the skill to open a Mapper Session inside Codex, so that I can preview and map Live2D without switching applications.
83. As a Codex user, I want the Mapper Session to fall back to the Electron App when an embedded browser is unavailable, so that visual mapping remains possible.
84. As a Codex user, I want installation through the skill to require explicit authorization, so that an agent cannot overwrite local pet data by inference.
85. As a security-conscious user, I want each Mapper Session bound to loopback with a random token and short lifetime, so that it cannot become a general local file server.
86. As a security-conscious user, I want imported paths constrained to the selected Source Package and project, so that path traversal cannot expose unrelated files.
87. As a user, I want errors to name the failed Source Package, Animation Recipe, target slot, or package asset without exposing unrelated internals, so that failures are actionable.
88. As an international user, I want the V1 UI in English with translation keys from the beginning, so that additional languages can be added without rewriting the interface.
89. As a keyboard user, I want the mapper and build workflow operable without drag-and-drop, so that drag is an enhancement rather than a requirement.
90. As a contributor, I want tests that do not require copyrighted examples or proprietary Core, so that the public repository can run CI legally.
91. As a contributor, I want optional renderer integration tests to use my own local runtime and fixtures, so that real compatibility can still be verified.
92. As a release maintainer, I want macOS to be the first required platform while the core remains Windows-compatible, so that the first release is bounded without causing a rewrite later.
93. As a release maintainer, I want native dependencies packaged per operating system and architecture, so that users do not need Homebrew or system codecs.
94. As a release maintainer, I want source publication separated from installer publication, so that development can be open while the Live2D release-license gate is unresolved.
95. As a release maintainer, I want copyrighted examples and Cubism runtimes excluded from repository and release artifacts, so that publication does not redistribute unapproved material.

## Implementation Decisions

### Product and application boundary

- Live2Pet is a conversion, authoring, validation, and packaging application. It does not replace Clawd, Codex, or another agent-pet host and does not monitor agent state itself.
- The product name, App, CLI, Codex skill, npm scope, and future repository use `Live2Pet` or `live2pet`. Clawd and Codex Pet remain Target Profile names.
- The Desktop App is the primary product. The CLI and Codex skill are automation entry points over the same installed runtime, not separate implementations.
- Processing is local-only. V1 has no account, cloud upload, remote rendering, telemetry, or automatic semantic mapping service.
- macOS is the first acceptance platform. Shared modules, path handling, cache behavior, archive handling, and native dependencies must remain compatible with Windows x64 as the next platform.

### Workspace and module boundaries

- Use an Electron Forge application with React and TypeScript in a pnpm workspace. The current development shell may remain dependency-light while the shared contracts stabilize; its future Forge makers must be added only after the source-release and native-module gates pass.
- Create a domain module for Source Package, Motion, Expression, Animation Recipe, Motion Mapping, Render Preset, Target Profile, Package Build, Live2Pet Project, and Pet Package schemas.
- Create a project module for versioned `.live2pet` serialization, migrations, source fingerprints, relinking, dirty state, autosave recovery, and validation.
- Create source-inspection adapters for standard Cubism directories and the tested Destiny Child PCK layout.
- Create one application-level renderer contract for inspection, preview, playback, Expression control, bounds analysis, deterministic frame stepping, and RGBA capture.
- Implement the modern renderer with the official Cubism Web Framework for Cubism 3, 4, and 5.
- Implement Cubism 2 as an isolated legacy adapter. Select the first community implementation only after it passes the shared renderer contract against the tested local Destiny Child fixture.
- Create target-neutral render, cache, encoding, validation, and package orchestration modules.
- Create separate versioned Clawd and Codex Pet Target Profile modules. Target modules own behavior slots, fallback rules, geometry, sampling, preset values, validation, previews, and package layout.
- Create one shared React mapper application that can run in Electron or an authenticated Mapper Session.
- Create a CLI that invokes application use cases through stable JSON output rather than scraping UI text.
- Ship the Codex skill as a thin client installed and updated by the App. The skill checks the App/CLI protocol version before performing work.

### Source Package inspection

- Standard import accepts a directory containing a valid Cubism 2 `model.json` or Cubism 3+ `.model3.json` plus referenced model, texture, Motion, Expression, physics, and pose resources.
- Preserve relative resource identities. Never infer semantics from filenames beyond presenting searchable labels to the user.
- The Destiny Child PCK adapter accepts the already-tested `PCK\0` container shape only when entry offsets are valid, entry count is within a defensive bound, compression/encryption flags are zero, and stored and original sizes match.
- PCK extraction happens in the bounded App cache. Reject path traversal, overlapping or out-of-range entries, unsupported flags, ambiguous required resources, and incomplete model settings.
- Unknown, compressed, or encrypted PCK variants return a structured unsupported-format result. V1 does not attempt decryption or heuristic repair.
- Source inspection produces a normalized manifest containing Cubism generation, stable resource ids, Motion and Expression metadata, durations where available, warnings, and a source fingerprint.

### Cubism runtime provisioning and isolation

- Do not bundle or silently download Cubism Core or a legacy runtime.
- First-run setup links to Live2D's official download flow and accepts either a compatible Core file or an SDK directory from which the App can locate it.
- Store runtime path, detected generation, detected version, and validation result in local App settings. Do not copy runtime bytes into a Live2Pet Project, cache artifact, diagnostic bundle, Pet Package, repository, or release artifact.
- A runtime change requires an App restart in V1. CLI invocations read the same setting.
- Execute both modern and legacy runtimes only in dedicated sandboxed render windows with Node integration disabled, context isolation enabled, a restrictive Content Security Policy, and a narrow typed IPC protocol.
- Destroy and recreate a render window after model failure, renderer protocol failure, or runtime mismatch rather than attempting to recover the compromised JavaScript realm.

### Live2Pet Project contract

- Use a versioned JSON document with the `.live2pet` extension.
- Store project schema version, project id, App version last written, package metadata, source kind, local source path, source fingerprint, normalized resource identities, Animation Recipes, per-target Motion Mappings, selected Render Presets, Clawd display-size preset, target-specific options, and optional rights/provenance notes.
- Do not embed model binaries, textures, Motion files, Expression files, Cubism runtimes, rendered frames, or built packages.
- Animation Recipe identity is determined by Motion id and optional Expression id. Framing, sampling, canvas, quality, and encoding belong to a target-specific Render Preset rather than the recipe.
- Save atomically. Maintain dirty state, explicit save, save-as, recent projects, autosave recovery, and schema migrations.
- When the source fingerprint changes, match stable resource identities, preserve only matching recipes, mark changed dependencies for review, and block Package Builds until all affected mappings are acknowledged.
- Relinking updates the source path and fingerprint only after successful inspection and compatibility review.
- Generated Pet Packages cannot be imported as editable projects. Re-editing requires the originating `.live2pet` document.

### Mapper and App workflow

- Use the sequence: Import, Inspect, Map, Configure, Build, Validate/Preview, Export/Install.
- Use a three-column mapping workspace: searchable Motion and Expression library on the left, live Live2D preview in the center, and Target Profile behavior slots on the right.
- Selecting a Motion starts preview. Selecting an Expression overlays it; clearing returns to the model's base parameters.
- Provide play/pause, restart, loop, speed, and keyboard-operable selection controls. V1 does not expose an editable multitrack timeline or arbitrary in/out points.
- Assignments are user-confirmed. The App may validate, filter compatible options, show reused recipes, and recommend that a slot needs attention, but it must not choose a semantically named Motion automatically.
- Provide undo/redo for project edits and confirmation before any bulk clear or source replacement.
- Keep source preview and target-result preview distinct. Target preview uses the generated frames, dimensions, timing, fallbacks, mirroring, and loop rules rather than replaying the source Motion as a proxy.
- UI copy is English in V1 and is defined through translation keys. No core workflow depends on drag-and-drop alone.

### Render Presets and framing

- Expose target-owned Compact, Balanced, and High Render Presets. Users choose named presets rather than arbitrary codec and canvas parameters.
- For Clawd, initialize the presets at 512 square pixels and 18 fps, 768 square pixels and 24 fps, and 1024 square pixels and 30 fps respectively. Use target-owned WebP quality and alpha-quality constants, record them in build provenance, and treat changes as Target Profile version changes.
- For Codex Pet, final atlas and cell dimensions never change. Compact, Balanced, and High vary only candidate sampling density and supersampling cost; Balanced is the default and renders candidate cells at four times final dimensions before downsampling.
- Full-model containment is the default framing policy. Analyze bounds across the entire Motion rather than fitting only its first frame.
- Clawd exposes Small, Standard, and Large display-size presets independently of render quality; Large is the project default. Target previews must show that these affect layout metadata rather than encoded resolution.
- Do not expose per-recipe continuous framing overrides in V1. A source whose full animation cannot fit receives a blocking bounds error rather than silent clipping.

### Clawd Target Profile

- Pin V1 to a documented Clawd theme schema revision and record that revision in Package Build provenance. Updating the target contract requires a Target Profile version change and fixture updates.
- Required core slots are `idle`, `thinking`, `working`, and `sleeping`.
- Support direct sleep and full sleep. Full sleep requires `yawning`, `dozing`, `collapsing`, and `waking`; direct sleep omits the transition requirements.
- Support common optional slots `error`, `attention`, `notification`, `sweeping`, `carrying`, `juggling`, and `roam`.
- Support only the fallback source states allowed by the pinned Clawd contract, and validate fallback targets and cycles.
- Support `workingTiers`, `jugglingTiers`, idle animation pools, and the animation-file reactions `drag`, `clickLeft`, `clickRight`, `annoyed`, and `double`.
- Generate transparent animated WebP or static WebP assets as appropriate. Disable eye tracking because generated WebP does not provide the required SVG document structure.
- Set mini mode unsupported and omit SVG object-channel features, accessories, mouth accessories, sounds, conditional idle easter eggs, updater-specific advanced visuals, and trusted runtime capabilities.
- Generate required theme metadata, view box, layout normalization, object scale, hitbox defaults, state bindings, fallbacks, sleep mode, tier tables, reactions, idle pools, and timing values from the Target Profile and project configuration.
- Validate schema, metadata, ids, semver, safe basenames, file existence, duplicate assets, fallbacks, required states, full-sleep completeness, reaction shapes, tiers, canvas consistency, alpha, WebP animation, and package root shape.
- Treat 83,886,080 bytes as the current maximum importable ZIP size. If the ZIP exceeds it, fail the Package Build, show total and per-asset sizes, and ask the user to choose a lower preset. Do not re-encode silently and do not present an oversized ZIP as importable.

### Codex Pet V1 Target Profile

- Follow the official V1 custom-pet contract: `pet.json` plus `spritesheet.webp` in a portable package.
- Generate a 1536-by-1872 transparent atlas with 8 columns, 9 rows, and 192-by-208 cells. The grid must have no gutters, labels, borders, or out-of-cell pixels. Every unused cell is fully transparent with normalized transparent RGB.
- Require mappings for `idle`, `running-right`, `running-left`, `waving`, `jumping`, `failed`, `waiting`, `running`, and `review`.
- Use the official V1 row order and default distinct-frame counts: 6 idle, 8 running-right, 8 running-left, 4 waving, 5 jumping, 8 failed, 6 waiting, 6 running, and 6 review frames. Remaining cells in a partially used row are transparent.
- Use the documented/default V1 animation timing and fallback behavior rather than encoding timing into an animated atlas.
- Render candidate frames above final resolution with alpha preserved, then downsample into each cell using a high-quality kernel. Full-body containment across the Motion is mandatory.
- Motion-aware sampling renders a candidate timeline, removes near-duplicates, preserves endpoints and loop continuity, retains major alpha-bounds displacement and visual-change extrema, and selects the required number of ordered frames. The algorithm is deterministic for the same source, runtime, target version, and preset.
- Do not mirror a directional row automatically. `running-right` and `running-left` remain separately user-confirmed mappings in V1.
- Validate atlas dimensions, cell geometry, row occupancy, transparent unused cells, alpha residue, frame readability contact sheet, manifest id/display name/description/path, safe package shape, and that every default animation reference is in range.
- Codex Pet V2, undocumented custom grids, and custom animation manifests are not V1 output contracts even if a current loader can parse additional fields.

### Package Build pipeline, cache, and artifacts

- Use one orchestrated pipeline: inspect and fingerprint source, validate project, resolve recipes, analyze bounds, render candidate frames, select/resample target frames, encode assets, assemble target metadata, validate, create target preview, package, and emit a build report.
- The App, CLI, and skill call this same Package Build service.
- Use `sharp` for image processing and transparent animated WebP encoding, and `@zip.js/zip.js` for archive reading and writing. V1 does not require FFmpeg, ImageMagick, libwebp commands, system ZIP, Homebrew, or a separately installed browser.
- Cache normalized PCK extraction, render candidates, selected frames, and encoded assets by source fingerprint, renderer version, runtime version, Animation Recipe, Target Profile version, and Render Preset.
- Store cache data in App-managed local storage with a default 5-GiB least-recently-used limit, per-project/source size reporting, and explicit clear actions. Cache bytes are never part of the project or repository.
- A cancelled or failed build may retain only entries that completed their integrity check. Staging directories and partial packages are removed recoverably.
- Build reports include deterministic inputs and versions, timings, cache hits, warnings, validation results, output paths and sizes, but replace source paths with a project-relative or redacted identifier.
- Artifact names include sanitized package id, target id, and semantic version. Existing outputs are not overwritten by default.

### Preview, export, and installation

- Build target previews from generated assets, not source runtime playback.
- Clawd preview simulates required and optional states, fallbacks, sleep sequence, idle pool, tiers, reactions, roam direction, display-size preset, timing, and loop behavior supported by V1.
- Codex preview displays the contact sheet and plays each row at its final cell size and default timing.
- A build is exportable only after blocking validation errors are resolved. Non-blocking warnings remain in the report and preview UI.
- Always support exporting a portable package to a user-selected location.
- Installation is a separate explicit action after a successful build. The App detects the platform's Clawd user-theme directory and the active Codex home/pets directory without embedding those absolute locations in the project.
- On id conflict, offer cancel, explicit upgrade, or side-by-side installation with a new id. Cancel is the default.
- Explicit upgrade stages a complete replacement, keeps a recoverable backup until verification succeeds, and restores the prior installation after failure.
- The Codex skill may install only when the user's prompt explicitly authorizes installation; a build or export request alone is insufficient.

### CLI, Codex skill, and Mapper Session

- Provide machine-readable CLI operations for runtime diagnosis, Source Package inspection, project creation/opening, Mapper Session start, project validation, Package Build, artifact validation, export, explicit install, cache status/clear, and skill install/status.
- Structured output includes protocol version, operation id, progress events, result, warnings, and typed error codes. Human-readable output is a presentation layer over the same result.
- The App installs or updates the matching Codex skill only after explicit confirmation and reports the installed skill and CLI protocol versions.
- The skill uses the CLI for nonvisual work. It does not bundle Electron, renderers, codecs, Core, or a second copy of the build pipeline.
- Visual work starts a Mapper Session bound only to loopback. Each session receives an unguessable bearer token, one project allowlist, Origin validation, strict Content Security Policy, no general filesystem API, an explicit close action, and a short idle expiry.
- The browser mapper writes through typed project operations and cannot invoke arbitrary shell commands or read paths outside the selected project and Source Package.
- If the Codex in-app browser cannot open the Mapper Session, the skill opens the same project in the Electron App and continues headless work after the project is saved.

The development Electron shell loads the shared Mapper from a fixed repository path, denies new-window navigation, and exposes only typed `live2pet:app` IPC methods through a sandboxed, context-isolated preload. It does not package Cubism Core, model content, example assets, or generated packages. Forge makers, local renderer assets, and signed installers remain release-gated work.

### Security, privacy, licensing, and release

- Treat Source Packages, PCK entries, project documents, imported archives, SVG/JSON content, and generated package names as untrusted input.
- Enforce archive-entry limits, decompressed-size limits, exact path containment, safe basenames, JSON depth/size limits, and render time/memory ceilings.
- Keep Electron main-process capabilities behind typed preload APIs. Disable Node integration in UI and render windows and do not expose raw filesystem or process objects.
- Diagnostics are opt-in and local. They include versions and sanitized errors but exclude model bytes, textures, rendered frames, Cubism runtimes, bearer tokens, and absolute source paths.
- Live2Pet's original code is Apache-2.0. Third-party dependencies, Cubism Framework, user-provided runtimes, Source Packages, and generated derivatives retain separate licenses and provenance.
- Do not commit example models, imported models, generated themes, Cubism Core, legacy runtimes, or unverified derivative assets. Public tests use synthetic fixtures and fake renderers.
- Source may be published before official installers. Do not publish ready-to-run macOS or Windows binaries until Live2D has clarified and, where required, approved the Expandable Application release arrangement.
- A public source release requires the Apache-2.0 license, third-party notices, dependency inventory, security review, and confirmation that ignored local assets are absent.

### Delivery sequence

1. Establish the pnpm workspace, Electron Forge shell, domain schemas, project schema, typed IPC, CLI protocol, synthetic fixtures, and the primary end-to-end acceptance harness.
2. Extract and test standard-folder and PCK source inspection from the prototypes, then implement source fingerprints, cache storage, runtime setup, and the renderer contract.
3. Implement the official modern renderer and complete its contract; implement and qualify the isolated Cubism 2 legacy adapter against the local tested fixture.
4. Build the shared React mapper, `.live2pet` save/relink/review workflow, undo/redo, autosave recovery, and Electron/Mapper Session hosts.
5. Implement deterministic frame analysis, fixed Render Presets, `sharp` encoding, target previews, build reporting, and bounded caching.
6. Implement and validate the Clawd Target Profile, including size failure behavior and optional animation capabilities selected for V1.
7. Implement and validate the Codex Pet V1 Target Profile, motion-aware sampling, contact sheet, and true-size playback.
8. Add export, atomic optional installation, cache management, App-installed Codex skill, CLI version handshake, and authenticated Mapper Sessions.
9. Complete macOS packaging smoke tests, accessibility and English-copy review, security checks, notices, source-release checks, and the external Live2D binary-release gate.
10. Qualify Windows x64 packaging and paths as the next platform milestone without changing shared project or Package Build contracts.

## Testing Decisions

- The primary acceptance seam is one external Live2Pet workflow: start through the public CLI and Mapper Session, import a synthetic Source Package through a test source adapter, preview through a deterministic test renderer, create Animation Recipes and Motion Mappings, save and reopen a `.live2pet` document, build both Target Profiles, validate the Pet Packages, and inspect the final previews and reports.
- This seam tests observable behavior rather than React component state, private functions, internal class structure, or implementation-specific call counts. A good test asserts what a user or host can observe: accepted input, visible validation, saved project behavior, deterministic assets, package shape, installation effects, and actionable errors.
- Use one copyright-safe synthetic Source Package generated from simple geometry and parameterized fake motions. It contains no Live2D model binary, proprietary runtime, third-party artwork, or derived example asset.
- The test renderer implements the same application-level renderer contract as modern and legacy renderers. Its deterministic RGBA output makes bounds, sampling, cache, WebP, atlas, and package assertions stable in public CI.
- Exercise the shared mapper through the Mapper Session/browser surface because it covers the same React UI used by Electron while also testing the skill-facing loopback boundary. Add one thin Electron smoke test that verifies the App boots, loads the shared UI, and can invoke the same application service; do not duplicate the full workflow in Electron.
- The primary seam covers direct and full Clawd sleep, explicit fallbacks, state and reaction mappings, tier tables, idle pool, roam, three Render Presets, Large display default, final preview, valid ZIP, and the blocking 80-MiB behavior using a deterministic oversized fake asset.
- The primary seam covers all nine Codex rows, exact V1 atlas and cell dimensions, distinct frame counts, transparent unused cells, full-body containment, deterministic motion-aware selection, final-size playback data, manifest shape, and package validation.
- Verify that a source move can be relinked without losing stable recipes, while a changed Motion or Expression blocks Package Build until review.
- Verify atomic save and autosave recovery using public project behavior, including interrupted writes and schema migration from every released project version.
- Verify deterministic Package Builds by comparing target metadata, selected frame identities, image dimensions, alpha invariants, and package inventory for the same recorded inputs. Do not require byte-identical WebP across an intentional encoder-version change; record the encoder version and update the Target Profile fixture deliberately.
- Verify cache behavior through observable hits, invalidation, size accounting, cancellation cleanup, and clear operations. Cache keys must change when source, runtime, renderer, recipe, target version, or preset changes.
- Verify archive and path security with traversal names, absolute paths, duplicate names, excessive entry counts, out-of-range PCK entries, unsupported flags, decompression limits, unsafe package ids, and symlink-like edge cases.
- Verify Mapper Session security from outside the process: non-loopback binding is impossible, a missing or wrong token is rejected, an unapproved Origin is rejected, unrelated filesystem paths are inaccessible, an expired session stops responding, and logs do not expose the token.
- Verify installation in temporary fake Clawd and Codex homes. Assert no implicit installation after build, conflict defaults to cancel, side-by-side creates a new id, upgrade is atomic, and a simulated failure restores the prior installation.
- Verify privacy by scanning project files, Pet Packages, reports, diagnostics, and logs for source absolute paths, Core bytes/names where prohibited, bearer tokens, and fixture payload leakage.
- Run one renderer contract suite against the test renderer in CI. The identical suite can run optionally against user-provided modern and legacy runtimes plus locally provided model fixtures. Those opt-in tests never download or publish Core or model assets.
- Add target-validator compatibility fixtures derived from public contracts rather than copied copyrighted themes or pets. Keep valid and invalid package inventories minimal and synthetic.
- Package smoke tests run for macOS arm64 and x64 where available and Windows x64 in its platform milestone. They verify application launch, `sharp` native loading outside ASAR as required, WebP encoding, ZIP creation, CLI protocol output, and App/skill version detection.
- Accessibility tests cover keyboard-only mapping, focus order, labeled controls, status announcements, error association, and reduced-motion behavior for UI chrome. They do not disable the user-requested model preview.
- Prior art in the repository is the prototype mapping reducer/validator/output boundary, the single-Motion frame-export CLI, and the PCK extraction CLI. These behaviors should be captured through the new high-level seam before the duplicated prototype logic is removed; there is currently no test framework to preserve.

## Out of Scope

- Automatically assigning a Motion or Expression to a semantic behavior slot.
- A multitrack animation editor, Motion sequencing, arbitrary trim points, or user-authored interpolation.
- Continuous expert controls for canvas, frame rate, crop, anchor, quality, alpha quality, timing, or codec flags; V1 uses fixed Target Profile presets.
- Editing or reconstructing a Live2Pet Project from a generated Clawd Theme Package or Codex Pet Package.
- Embedding Source Package assets in the project document.
- Decrypting, decompressing, reverse engineering, or heuristically repairing unknown PCK, LPK, ViewerEX, or other proprietary containers.
- Live2DViewerEX EXAPI control, VTube Studio control, screen capture, or converting a running external viewer into source assets.
- Replacing Clawd or Codex as the desktop pet runtime, reading agent task status directly, rendering approval UI, quota UI, or monitoring Codex conversations.
- Clawd eye tracking, scripted SVG, object-channel rendering, mini mode, head or mouth accessories, sounds, conditional idle easter eggs, theme variants, trusted runtime features, and updater-specific advanced visuals.
- Codex Pet V2, undocumented atlas geometries, custom frame grids, or custom animation manifests.
- Automatic mirroring of directional Codex rows.
- Cloud storage, remote rendering, collaboration, accounts, telemetry, analytics, or automatic update checks.
- Bundling, redistributing, or silently downloading Cubism Core or legacy runtimes.
- Publishing official ready-to-run installers before the Live2D Expandable Application release position is resolved.
- Linux packaging in the initial product scope.
- A Chinese UI in V1; the interface is English with an i18n-ready message system.
- Shipping example models or generated character themes without explicit redistribution permission.
- Providing legal advice or asserting that user-provided Core alone resolves Publication License Agreement obligations.

## Further Notes

- The dependency-ordered execution plan for this specification is maintained in `docs/plans/live2pet-v1-implementation-plan.md`.
- `hatch-pet` is first-party workflow and QA guidance for producing Codex-compatible custom pets. Live2Pet implements a Codex Pet Target Profile; it is not named after, bundled with, or represented as the official `hatch-pet` tool.
- The official Codex Pet V1 contract currently documents a transparent 1536-by-1872, 8-by-9 atlas with 192-by-208 cells: https://github.com/openai/skills/blob/main/skills/.curated/hatch-pet/references/codex-pet-contract.md
- The first-party Hatch Pet workflow documents the nine state rows and pet-size readability expectations: https://github.com/openai/skills/blob/main/skills/.curated/hatch-pet/SKILL.md
- The Clawd Target Profile must track the current theme guide and pin the supported contract revision: https://github.com/rullerzhou-afk/clawd-on-desk/blob/main/docs/guides/guide-theme-creation.md
- Cubism Core is proprietary and obtained from Live2D's official SDK flow: https://docs.live2d.com/en/cubism-sdk-manual/cubism-core/ and https://www.live2d.com/en/sdk/download/web/
- Expandable Applications require separate Live2D review before release: https://www.live2d.com/en/sdk/license/expandable/
- The official modern Web Framework is the canonical modern renderer: https://github.com/Live2D/CubismWebFramework
- The current browser mapper, frame exporter, and PCK extractor are prototypes and behavioral references. Production code should extract their proven behavior behind the new project, renderer, Package Build, and Target Profile contracts rather than extending the single-file prototype indefinitely.
- The GitHub issue should use the title `Build the Live2Pet desktop App, Package Build pipeline, and Codex skill` and the single triage label `ready-for-agent`.
