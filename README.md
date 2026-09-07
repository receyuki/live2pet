# Live2Pet

[English](README.md) | [简体中文](README.zh-CN.md)

Turn your Live2D or Spine model into a desktop pet package—locally, visually, and without editing the original model.

Live2Pet is a macOS desktop app for people who already have a permitted Live2D or Spine model and want to use its original animations in [Clawd on Desk](https://github.com/rullerzhou-afk/clawd-on-desk) or Codex custom pets. Import a model, preview its motions, map them to pet states, hide unwanted visual elements, and build a validated ZIP from one project workspace.

> [!IMPORTANT]
> Live2Pet is currently a personal-use, unsigned macOS project. There is no public prebuilt release yet. The complete Live2D workflow is accepted; optional Spine 4.x and multi-model library browsing are under in-App acceptance. Windows support is planned after V1.

## Highlights

- Import standard Cubism model folders and supported uncompressed, unencrypted Live2D PCK files.
- Browse local model collections or public GitHub folders up to two levels deep; GitHub downloads only the model you select, never the whole repository.
- Import standard Spine 4.0–4.3 folders containing JSON or binary skeleton data, an atlas, and its texture pages.
- Save Cubism 2 and Cubism 3–5 runtimes once; Live2Pet selects the matching version automatically.
- Preview motions and expressions with play, pause, restart, seek, loop, and preview-speed controls.
- Map the selected motion directly to required and optional Clawd or Codex pet states.
- Inspect model elements with thumbnails and hierarchy, then hide unwanted backgrounds or effects without changing source files.
- Save and reopen portable `.live2pet` project files. Projects contain references and settings, not model or runtime bytes.
- Build Clawd Theme Packages and Codex Pet V2 packages with progress, cancellation, generated-result previews, cache reuse, and validation.
- Save ZIPs anywhere, install them explicitly, or use **Build & Install**. Existing packages are never silently replaced.
- Use the App in English or Simplified Chinese.

## Supported formats

| Input or target | Current support |
| --- | --- |
| Cubism 3, 4, and 5 | Standard folders containing `.model3.json` and `.moc3` |
| Cubism 2 | Standard folders containing `.model.json` and `.moc` |
| Live2D PCK | Tested uncompressed and unencrypted layouts containing a supported Cubism model |
| Clawd on Desk | Core states, optional states/reactions, transparent animated WebP assets, theme validation, preview, and installation |
| Codex custom pets | V2 11-row atlas by default, including the nine required animation mappings and neutral look cells |
| Spine 4.0–4.3 | Standard folders containing one `.json` or `.skel` skeleton, a matching `.atlas`, and referenced texture pages; matching optional renderer pack, default skin, and Slot visibility |
| Windows | Not yet qualified; planned after V1 |

PCK is a container, not a specific game's format and not a guarantee of compatibility. Encrypted, compressed, proprietary, or incomplete packages are rejected with an explanation.

## Quick start

There is no signed downloadable build yet. To try the current App, build the local unsigned macOS bundle from source.

### Requirements

- macOS on the current supported architecture
- Git
- Node.js 22.12 or newer
- pnpm 11 through Corepack
- A legally obtained model and the matching Live2D runtime, or the licenses required for your Spine use

### Build the App

```sh
git clone https://github.com/receyuki/live2pet.git
cd live2pet
corepack enable
pnpm install
pnpm --filter @live2pet/desktop package:mac
open apps/desktop/out/Live2Pet-darwin-*/Live2Pet.app
```

The local App is unsigned. macOS may require you to approve it in **System Settings → Privacy & Security**. Public signed and notarized installers are a separate release milestone.

## Using Live2Pet

1. On first launch, add the Live2D runtime files you already own, or skip setup and inspect a model first.
2. Browse a local model folder, paste a public GitHub repository/folder URL, or import a supported Live2D PCK file. Local drag and drop remains available.
3. In **Models**, browse the gallery or import a model directly. Select a card to preview its animations without replacing your project, then choose **Use this model**. The current model's expandable details contain resource checks and runtime actions, including **Install Spine support** when needed.
4. In **Map**, choose an animation, preview it, and assign it separately to Clawd or Codex states.
5. Use **Visibility** when you need to inspect and hide a background, overlay, or other separable model element.
6. Enter a package name in **Build**, choose a render preset, and build either target.
7. Preview the generated result, then choose **Save ZIP**, **Install**, or **Build & Install**.
8. Save the `.live2pet` project if you want to reopen or revise the mapping later.

Global runtime, output, cache, language, and installation-location preferences live in **Settings**. Model choices and mappings stay in the project.

<a id="runtime-setup"></a>

## Runtime setup

A model contains character data; a runtime is the code that makes it move. Live2Pet includes its interface and renderer adapters, but does not bundle or silently download Live2D's proprietary runtime. Obtain the appropriate runtime separately and review its terms.

| Model generation | Runtime to import | Source |
| --- | --- | --- |
| Cubism 3–5 (`.model3.json` / `.moc3`) | Cubism Core for Web, usually `Core/live2dcubismcore.min.js` | [Official Cubism SDK for Web](https://www.live2d.com/en/sdk/download/web/) |
| Cubism 2 (`.model.json` / `.moc`) | Legacy Web runtime `live2d.min.js` | Third-party archive: [dylanNew/live2d](https://github.com/dylanNew/live2d/tree/master/webgl/Live2D/lib) |

For modern models, download and extract the **Web SDK**, not the Editor, Unity SDK, or Native SDK. For Cubism 2, save the JavaScript file itself rather than the GitHub HTML page. The linked Cubism 2 repository is a third-party copy, not an official maintained download channel; [Live2D states](https://help.live2d.com/en/other/other_20/) that new Cubism 2.1 SDK downloads are no longer available.

In first-time Setup or **Settings → Runtimes**, drag in the runtime JavaScript file or extracted SDK folder. Live2Pet validates it, detects the supported generation, and stores a private local copy. Both generations can coexist and are reused automatically after restart, even if the original download is moved.

Only import runtime code from a source you trust. Removing a runtime from Live2Pet does not delete the original file. Inspection works without a runtime; playback and capture require a matching one. The in-App help button opens this section in the language currently selected in Live2Pet.

### Optional Spine support

Live2Pet recognizes Spine export versions before installing a renderer. For Spine 4.0–4.3, an explicit **Install** action downloads the matching pinned official `@esotericsoftware/spine-player` distribution, verifies its SHA-256 values, and saves it in private App storage for reuse. Packs are not bundled with this repository or downloaded during first-run setup. Other detected Spine lines remain unsupported until a reproducible official pack is available.

### Model libraries and GitHub cache

The **Models** page combines project opening, source import, and library browsing. Dragging in a model folder opens it as a model library, while a dropped PCK file is imported directly; folder drops work whether Electron exposes the folder itself or its nested files. This keeps multi-model collections from being misread as one Source Package. Local cards show a supplied `preview`/`cover` image when available, otherwise a 256 px rendered thumbnail using your installed runtime. Visible cards are queued first, then offscreen cards fill in automatically in the background. At most two thumbnails render concurrently; hidden Spine thumbnail views are advanced without relying on animation frames, and a stuck render still times out after 15 seconds so it cannot freeze or block the rest of the library. The in-memory thumbnail cache is capped at 16 MiB and resets when the App quits. Missing runtimes are reported rather than downloaded automatically, while detected unsupported Spine lines are labeled directly. Selecting a card opens one live preview with a Motion selector; only **Use this model** replaces the current project. The library stays available when switching to Map or Build.

GitHub cards do not automatically download models to generate thumbnails. Click a card to download only its selected model and open the live preview. Source diagnostics are part of Models, not a separate navigation tab.

Projects created from a model library retain the selected local source location and model configuration for reopening. GitHub model locations are cache entries, not permanent project assets: if an entry is cleared or evicted, select the model again and relink its source. Saving a `.live2pet` project does not embed the model files.

Cache cleanup preserves sources still registered in the current App session, including loaded PCK files. If these prevent lowering the limit, restart the App to release them or choose a higher limit. Downloads and cleanup run sequentially, and downloaded size is checked again before committing a cache entry.

Local Electron integration checks cover Spine 4.1 binary and 4.3 JSON rendering, Slot hiding, and both target exports. Spine 4.0/4.2 and the packaged-App workflow still need real-model acceptance; version detection alone is not a compatibility guarantee.

**Browse model folder** discovers Live2D and Spine Source Packages up to two folder levels below a selected local folder. A public GitHub repository or `/tree/<branch>/<folder>` URL is browsed from metadata without cloning; Live2Pet downloads only the model card you select. Downloaded models use a 1 GiB cache by default. Change the limit (256 MiB–20 GiB), inspect its current usage, or clear it in **Settings → Storage**. Least-recently-used models are removed automatically when the configured limit is reached.

Spine runtimes are governed by the [Spine Runtime License](https://github.com/EsotericSoftware/spine-runtimes/blob/4.3/LICENSE). Live2Pet's Apache-2.0 license does not grant a Spine Editor license or relicense the runtime, models, or generated assets. Confirm that your Spine use satisfies the applicable terms before installing the pack or distributing output.

## Mapping and model visibility

Clawd and Codex mappings are independent. The App clearly labels required states; optional states may remain empty. Live2Pet never guesses directional Codex rows or automatically maps animations on your behalf.

The **Animations** and **Visibility** tabs share the Map library. Visibility provides:

- a collapsible parent/child hierarchy when the model exposes one;
- an **Unattached meshes** group for root ArtMeshes outside the Part hierarchy;
- lazy thumbnails beside visible rows and a larger selected-element preview;
- search that retains the ancestor path;
- temporary **Solo**, persistent **Hide / Show**, and **Restore all**;
- **Detect large elements** for finding broad geometry in modern Cubism motions; and
- **Reset preview** when a model pose or renderer state needs to be recreated.

Hidden identities are saved in the project and applied consistently to preview, bounds, cache identity, Clawd output, and Codex output. Replacing a source with different content resets old model-specific visibility choices; moving the same unchanged source keeps them.

Live2Pet cannot separate a background and character painted into the same ArtMesh. Large motion-driven effects may still affect framing until their separable element is hidden.

## Building, saving, and installing

Clawd provides **Compact**, **Balanced**, and **High** presets plus **Custom** resolution, frame rate, and WebP quality. Codex retains its target-defined atlas geometry. Lower Clawd values usually reduce file size at the cost of detail or smoothness.

Clawd's 80 MiB import limit is shown as a compatibility warning rather than a build failure. Live2Pet still lets you save the ZIP, but Clawd may reject it. Reduce resolution, frame rate, or quality and rebuild when necessary.

The build cache reuses verified captured frames and encoded assets. Least-recently-used entries are removed as the cache fills; a single oversized entry is skipped without failing the build. Build reports include validation, warnings, artifact sizes, cache hits, and total/per-stage timings without exposing source paths or captured pixels.

**Save ZIP** never installs. **Install** always asks for confirmation. **Build & Install** waits for a successful validated build and then asks for confirmation. If the same package already exists, replacement requires a second confirmation and uses an atomic backup/rollback path.

**Settings → Targets & Installation** detects standard macOS locations for Clawd on Desk and Codex, or lets you select another App and package folder. Detection never launches an App or installs anything. Resetting a saved location does not remove installed packages.

## Projects, privacy, and rights

Live2Pet is local-first. Models, runtimes, rendered frames, generated packages, and absolute paths are not uploaded by the App. Runtime copies, preferences, caches, and install locations remain private App data.

This repository intentionally excludes character models, generated pets, runtime binaries, and copyrighted examples. A `.live2pet` file stores source references, fingerprints, mappings, render settings, and visibility choices; it does not embed model or runtime files.

Live2Pet does not grant rights to any model, texture, motion, game asset, runtime, or derived animation. You are responsible for confirming that you may use and redistribute your inputs and generated packages. The repository's Apache-2.0 license applies to Live2Pet's source code, not to imported assets or third-party runtimes.

## Troubleshooting

### The model can be inspected but not previewed

Add the matching Live2D runtime in **Settings → Runtimes**, or install the optional pack matching a supported Spine 4.0–4.3 source. A modern Cubism Core cannot render Cubism 2, and the legacy runtime cannot render modern `.moc3` models.

### A PCK file is rejected

Only bounded, uncompressed, unencrypted layouts containing supported Live2D resources are accepted. Live2Pet does not decrypt proprietary packages.

### The generated pet is too small or cropped

Rebuild with the current version, preview the affected motion, and inspect large or animated visual elements. Old cached framing is invalidated automatically, but previously exported ZIPs do not change until rebuilt.

### Clawd does not respond when the pet is clicked

Rebuild and reinstall the theme. Current packages include a canvas-sized default hit box and neutral display scaling; older generated themes may not.

### Clawd rejects a large ZIP

Select **Compact** or reduce the Custom resolution, frame rate, or WebP quality until the result is below the host's displayed limit.

### The target App is not detected

Use **Settings → Targets & Installation → Locate App** or select the package folder manually. “Not found” means the standard locations did not match; it does not prove the App is absent.

## Project status and roadmap

The Live2D-only desktop workflow through #12 is implemented and accepted. Optional version-pinned Spine 4.0–4.3 packs and Source Library browsing are implemented and awaiting final packaged-App acceptance. Clean-profile macOS release qualification follows that acceptance. Windows x64, public signed/notarized binaries, auto-update, and Codex Skill automation are post-V1 work.

See the [V1 specification](docs/specs/live2pet-v1.md), [implementation plan](docs/plans/live2pet-v1-implementation-plan.md), and [GitHub Issues](https://github.com/receyuki/live2pet/issues) for normative scope and progress.

## Contributing and development

Contributions and focused bug reports are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md), search existing issues, and avoid attaching models or runtime files unless you have clear redistribution rights.

```sh
corepack enable
pnpm install
pnpm test
pnpm typecheck
pnpm release:check
pnpm --filter @live2pet/desktop start
```

Useful engineering references:

- [Architecture decisions](docs/adr/)
- [Desktop acceptance guide](docs/desktop-acceptance.md)
- [Dependency inventory](docs/dependency-inventory.md)
- [Release checklist](docs/release-checklist.md)
- [Repository agent conventions](AGENTS.md)

The main implementation areas are `apps/desktop` for the Electron/HeroUI App and the `packages/*` modules for inspection, projects, runtimes, rendering, targets, builds, installation, and the CLI. `apps/mapper` is retained as a development reference and is not the production App entrypoint.

## License

Live2Pet source code is licensed under [Apache License 2.0](LICENSE). Third-party components and their notices are listed in [NOTICE](NOTICE), [the dependency inventory](docs/dependency-inventory.md), and the packaged App's third-party notices.

Please report security-sensitive problems according to [SECURITY.md](SECURITY.md), not through a public issue.
