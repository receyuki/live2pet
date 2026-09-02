# Mapper integration

The shared Mapper runs directly in the sandboxed Electron renderer. Development loads `apps/mapper/index.html`; packaged builds load the self-contained staged copy under `process.resourcesPath`. V1 has no hosted Mapper Session and no separate preview window.

The Mapper UI includes an English-default, Chinese (`zh-CN`) translation layer. The language selector persists only the locale preference in browser storage; source assets, runtimes, and project contents remain local. In the Desktop App, validated Cubism runtimes are persisted only in the App-managed private library. Browser-only use may keep a bounded browser-profile runtime copy for preview. Target ids, project schema keys, and generated package metadata stay language-neutral.

Project edits have a bounded 100-step history. The project toolbar exposes keyboard-accessible **Undo** and **Redo** controls; `⌘Z`/`Ctrl+Z` undoes, `⇧⌘Z`/`Ctrl+Y` redoes, and edits made after an undo replace the redo branch. Source/package loads establish a new history boundary, while undoing back to a clean state removes the local autosave draft. History stores only project metadata, mappings, behavior settings, and review state; source files, runtime bytes, renderer objects, and generated artifacts are never copied into it.

The center-column source preview is the only V1 Live2D preview surface. It exposes Pause, Resume, Restart, Loop, and playback-speed controls. Both standard directories and supported PCK inputs use this surface. V1 uses the version-matched Pixi Cubism 2 or modern adapter and does not expose an official Cubism Web Framework bridge.

The browser preview loads the version-matched Pixi `@pixi/unsafe-eval` compatibility bundle after Pixi. This replaces Pixi's generated uniform functions with static upload functions for strict-CSP environments; the Mapper CSP allows `blob:` only for object URLs created from the user's local source files and does not add general `'unsafe-eval'`.

When the App preload exposes `buildProject` and `getBuildArtifact`, the Mapper captures the selected Motion ids and requests validated Codex Pet or Clawd Theme packages through the shared Package Build service. Browser-only use keeps the Clawd build action disabled because it does not provide the trusted App encoder; preview and mapping remain available.

When a target slot has a `recipeMappings` entry, the build resolves its Animation Recipe before capture. The renderer applies that recipe's Expression for every sampled frame, restores the previous preview Expression afterward, and records the Expression id in the capture metadata. Render-candidate and App capture-cache identities include the Expression, so a base-Expression capture can never be reused for a recipe that asks for a different Expression. Legacy projects without `recipeMappings` continue to capture with the model's base Expression.

After a successful App build, the Mapper reads the returned ZIP artifact in memory and exposes generated-target previews. Download and installation are separate explicit actions: neither building nor downloading installs anything. Installation requires confirmation and supports the target's default location or a location chosen through the App's opaque folder handle.
