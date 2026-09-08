# Using Live2Pet

[README](../../README.md) · [简体中文](user-guide.zh-CN.md)

## First launch

1. Build the macOS App using the commands in the README.
2. If macOS blocks the unsigned App, allow it in **System Settings → Privacy & Security**.
3. Add a runtime in Setup, or skip and configure it when previewing your first model.

<a id="compatibility"></a>

## Compatibility

| Source | Required files / limitations |
| --- | --- |
| Cubism 3–5 | `.model3.json`, `.moc3`, referenced textures and motions |
| Cubism 2 | `.model.json`, `.moc`, referenced textures and motions |
| Live2D PCK | Supported uncompressed, unencrypted layouts; PCK is a container, not one game's format |
| Spine 4.0–4.3 | JSON or binary skeleton, matching atlas and texture pages; default skin and Slot visibility |
| Codex output | V2 11-row atlas; nine animation mappings plus neutral look cells, without directional mouse following |
| Clawd output | Transparent animated WebP assets, required/optional states and reactions |

Spine 4.1 binary and 4.3 JSON have local integration coverage. Spine 4.0/4.2 and the complete packaged-App workflow still need real-model acceptance. Windows is planned after V1.

<a id="runtimes"></a>

## Runtimes

A model contains character data; its runtime makes it move. Live2D's proprietary runtime is obtained separately and is not bundled with Live2Pet.

| Model | Download |
| --- | --- |
| Cubism 3–5 | [Official Web SDK](https://www.live2d.com/en/sdk/download/web/) → `Core/live2dcubismcore.min.js` |
| Cubism 2 | [Third-party archive](https://github.com/dylanNew/live2d/tree/master/webgl/Live2D/lib) → `live2d.min.js` |
| Spine 4.0–4.3 | Install the matching optional renderer inside Live2Pet |

- Download the **Web SDK**, not the Editor, Unity SDK, or Native SDK.
- For Cubism 2, save the JavaScript file, not the GitHub page. The archive is third-party; [new Cubism 2.1 SDK downloads are no longer offered by Live2D](https://help.live2d.com/en/other/other_20/).
- Drag the file or extracted SDK folder into **Settings → Runtimes**.
- Live2Pet keeps a local copy and selects the matching version automatically. Removing that copy leaves your original file untouched.
- Spine packs download only when you choose Install. Their use is subject to the [Spine Runtime License](https://github.com/EsotericSoftware/spine-runtimes/blob/4.3/LICENSE).
- Resource inspection works without a renderer; playback and capture need one.

## Browse and choose

- **Local:** browse or drop a folder anywhere on the Models page. Live2Pet discovers models up to two folder levels below it and generates card thumbnails lazily as they enter view.
- **GitHub:** paste a public repository or folder URL. Browsing reads metadata; selecting a card downloads only that model. **Download all** fetches every detected model, shows determinate progress, continues past individual failures, and then reports downloaded, cached, and failed counts. Thumbnails still load lazily.
- **PCK:** import or drop a supported file directly.
- Review the version, inventory, warnings, and motions in the preview, then click **Use and start mapping**.

Browsing leaves the current project untouched until confirmation. Returning from Map keeps the model library available.

## Map and adjust

The three panels are **Animations**, **Model Preview**, and **Assignment**. Drag their dividers to adjust width; keyboard arrows also work.

| Control | Purpose |
| --- | --- |
| Motions | Choose an animation; Expressions appear only when supplied by the model |
| Playback | Play, pause, restart, seek, loop, and adjust preview speed |
| Visibility | Browse part thumbnails and parent/child relationships |
| Solo | Inspect one element temporarily |
| Hide / Show | Apply visibility to both preview and output |
| Detect large elements | Find broad geometry in modern Cubism motions |
| Reset preview | Recreate the model preview |

Map Clawd and Codex independently. Required states must be filled; optional states may remain empty. When Clawd Drag or double-click reactions are not mapped, generated themes reuse Idle so the pet remains interactive. Explicit reaction mappings always take precedence. Background and character pixels in the same mesh cannot be separated here.

## Build, save, install

1. Name the pet on **Build**.
2. For Clawd, choose **Compact**, **Balanced**, **High**, or **Custom** resolution, frame rate, and WebP quality.
3. Build and inspect the generated preview.
4. Choose **Save ZIP**, **Install**, or **Build & Install**.

**Settings → Storage** controls the output folder or asks where to save each time. **Settings → Targets** detects host Apps and supports manual App and package-folder selection.

Clawd's **80 MiB** limit is a warning: a larger ZIP can be saved, but Clawd may reject it. Lower quality, resolution, or frame rate to reduce size. Codex uses fixed-frame short loops; use Clawd for full-length motions.

Installation asks for confirmation. Replacing an installed package requires explicit confirmation and keeps a backup for rollback if installation fails.

## Updates

Live2Pet checks the public GitHub Releases page shortly after launch, at most once every 24 hours. Use **Settings → General** to turn automatic checks off, check immediately, or open the exact stable Release when a newer version is available. The App only shows a notification; it never downloads or installs an update for you.

## Projects and storage

- Save a lightweight `.l2p` project to keep mappings, render options, visibility, and a relative or absolute source reference. Keep the referenced model available when reopening it.
- Use **Portable project** to save an `.l2pack` containing the same project and a copy of its selected model. It can be moved to another computer, where the matching runtime must still be configured separately.
- Legacy `.live2pet` projects remain readable and are saved in place unless you choose a new filename.
- Neither project format includes runtimes, build caches, generated Clawd/Codex packages, or an entire model library.
- Unsaved edits are retained locally for recovery on the next launch.
- Clear recent history without deleting project files.
- GitHub downloads use a **1 GiB** default cache. Change it between **256 MiB and 20 GiB** in Settings → Storage.
- **Download all** checks that the detected collection fits the configured cache before it starts. Increase the limit or choose a narrower GitHub folder when needed.
- Older cache entries are evicted as needed. Sources in use are protected; restart to release them if necessary.
- If a cached GitHub source was removed, select the model again and relink the project.
- Build caches reuse captured frames and encoded assets; oversized entries are skipped without failing a build.

## Troubleshooting

| Problem | Try this |
| --- | --- |
| Model inspected but preview unavailable | Add the matching runtime; modern Core and Cubism 2 runtimes are not interchangeable |
| PCK rejected | Check that it contains a supported, complete, uncompressed, unencrypted model |
| Pet too small or cropped | Inspect large animated elements, hide separable clutter, and rebuild with the current App |
| Clawd pet cannot be clicked | Rebuild and reinstall with the current Live2Pet. It generates a hit box and Idle fallbacks for Drag and double-click reactions. Clawd click reactions use double-click, not single-click. |
| ZIP too large | Use Compact or lower Custom settings |
| Host App not detected | Settings → Targets → Locate App, or choose its package folder manually |

## Privacy and rights

Model processing happens locally. Live2Pet does not upload models, runtimes, rendered frames, generated packages, account data, or project data. GitHub model browsing, optional renderer installation, and update checks require network access.

Live2Pet's Apache-2.0 license covers its source code. Models, textures, motions, runtimes, and generated derivatives retain their applicable rights and terms. Only redistribute assets you have permission to share.

[Report a bug](https://github.com/receyuki/live2pet/issues) · [Security reporting](../../SECURITY.md)
