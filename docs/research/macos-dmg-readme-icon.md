# README icon and macOS DMG layout research

Status: proposal only. No workflow or packaging code was changed by this research.

## Decision summary

1. Display `apps/desktop/assets/icon.png` at the top of both READMEs with a
   repository-relative image path. It is already a tracked packaging asset and
   is a browser-safe 1024 x 1024 RGBA PNG. Keep the path stable so replacing the
   asset updates the rendered README without another README edit.
2. Treat that PNG as the canonical visual source for future icon changes, then
   derive `icon.icns` and `icon.ico` from it. The macOS packager must continue to
   receive ICNS, but README rendering should not depend on ICNS.
3. Replace only the workflow's final raw `hdiutil -srcfolder` step with
   `create-dmg/create-dmg`. It exposes the exact App position, icon size,
   `/Applications` link, compression, and retry controls needed by the existing
   macOS jobs without adding a Node native-module chain.

## Current repository state

- [`apps/desktop/scripts/package-macos.cjs`](../../apps/desktop/scripts/package-macos.cjs)
  directly invokes `@electron/packager` and supplies
  `apps/desktop/assets/icon.icns` as the packaged App icon.
- [`apps/desktop/main.cjs`](../../apps/desktop/main.cjs) uses
  `apps/desktop/assets/icon.png` as the development-window icon.
- [`apps/desktop/scripts/package-windows.cjs`](../../apps/desktop/scripts/package-windows.cjs)
  uses `apps/desktop/assets/icon.ico` for Windows.
- The tracked PNG is 1024 x 1024 RGBA. ICNS and ICO are also tracked beside it.
- [`apps/desktop/forge.config.cjs`](../../apps/desktop/forge.config.cjs) exists,
  but its `makers` list is empty and the release workflow does not run Electron
  Forge.
- [`.github/workflows/desktop-release.yml`](../../.github/workflows/desktop-release.yml)
  currently turns each already-verified `.app` into a DMG with one
  `hdiutil create -srcfolder` command. Consequently, the mounted image contains
  the App but no Applications alias or intentional Finder layout.

## Reusing the packaged icon in README

GitHub recommends repository-relative paths for images stored in the same
repository and rewrites those paths for the branch being viewed. A centered
header can therefore use the stable path below in both language variants:

```html
<p align="center">
  <img src="apps/desktop/assets/icon.png" alt="Live2Pet" width="112">
</p>
```

Source: [GitHub Docs: relative links and image paths](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-readmes#relative-links-and-image-paths-in-markdown-files).

### Why not reference `icon.icns` directly?

ICNS is a macOS application-icon container, not a broadly supported web image
format. MDN's list of image types considered safe for web pages includes PNG,
JPEG, GIF, SVG, WebP, AVIF and APNG, but not ICNS. PNG is the appropriate shared
README asset because it supports transparency and all major browsers.

Source: [MDN: image file type and format guide](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Formats/Image_types).

This does not require copying an icon into `docs/assets`. The README reads the
existing packaging asset directly. The important operational convention is:

- replace `apps/desktop/assets/icon.png` when changing the product icon;
- regenerate the platform derivatives (`icon.icns` and `icon.ico`) in the same
  icon-update change;
- keep the three filenames stable.

The current repository does not yet automate that derivation, so merely
replacing ICNS alone would not update the README image. Automating derivation
can be a separate follow-up if desired; it is not required for the README or DMG
layout change.

## DMG tool comparison

All options below create DMGs only on macOS. That is compatible with the current
two native macOS GitHub Actions jobs.

| Tool | Requested layout | Maintenance and compatibility | Fit for Live2Pet |
| --- | --- | --- | --- |
| [`electron-installer-dmg`](https://github.com/electron-userland/electron-installer-dmg) | Default contents are the `.app` plus a link to `/Applications`; `contents`, `iconSize`, `background`, title and output format are configurable. | Electron-userland project; current main requires macOS and Node 22.12+, exactly matching Live2Pet's Node 22 CI. It has about 327 stars and delegates image creation to `appdmg`. | Good when Live2Pet needs custom coordinates or backgrounds, but unnecessary for the requested conventional layout. |
| [`create-dmg/create-dmg`](https://github.com/create-dmg/create-dmg) | Explicit `--add-file`, `--app-drop-link`, `--icon-size`, window and background controls provide the exact classic drag-to-install layout. | Mature shell project with about 2.6k stars and a current v1.3 line. It requires only macOS, has `hdiutil` retries, and is available as the Homebrew `create-dmg` formula. Finder styling is AppleScript-based; `--skip-jenkins` must not be enabled when the styled layout is required. | **Recommended.** It provides the required layout without a Node native-module chain and fits the existing macOS-only Action jobs. |
| [`appdmg`](https://github.com/LinusU/node-appdmg) | JSON specification supports an Applications link, App position, icon size, window size, background/color, Retina backgrounds and progress events. | Mature and widely used, but its latest tagged release is 0.6.6 from 2023. It includes native macOS helpers and is the underlying engine used by `electron-installer-dmg`. | Capable, but using the Electron-specific wrapper gives Live2Pet a smaller public API and the desired default layout. Direct use is unnecessary unless progress events or lower-level specification control becomes important. |
| [`@electron-forge/maker-dmg`](https://www.electronforge.io/config/makers/dmg) | Supports DMG backgrounds and passes the Electron installer DMG configuration, including custom contents and layout. | Official Electron Forge maker. Electron's packaging guide recommends Forge, and the current maker is maintained with Forge. It ultimately uses `electron-installer-dmg`; the maker itself can only run on macOS. | Good if Live2Pet later adopts Forge for the complete package/make lifecycle. For this change it would be disproportionate: the repo currently packages with a custom script, has no configured makers, and already performs its own smoke test before DMG creation. |
| [`sindresorhus/create-dmg`](https://github.com/sindresorhus/create-dmg) | Produces an attractive opinionated DMG whose source defines a 660 x 400 window, 160 px icons, the App at `(180, 170)`, and `/Applications` at `(480, 170)`. | Mature project with about 5.4k stars and Node 20+ support. Version 8.1.0 uses `appdmg`, whose alias helpers require native builds. | Rejected after local validation: pnpm did not produce the required `macos-alias` native module, so the Applications alias could not be generated reliably. |

Primary configuration references:

- [`electron-installer-dmg` options and default contents](https://github.com/electron-userland/electron-installer-dmg#createdmgopts)
- [`create-dmg/create-dmg` options and example](https://github.com/create-dmg/create-dmg#usage)
- [`appdmg` JSON specification](https://github.com/LinusU/node-appdmg#json-input)
- [Electron Forge DMG maker](https://www.electronforge.io/config/makers/dmg)
- [Electron's packaging recommendation](https://www.electronjs.org/docs/latest/tutorial/application-distribution#with-tooling)

## Proposed implementation after confirmation

Keep the implementation deliberately narrow:

1. Add the centered `apps/desktop/assets/icon.png` element above the title in
   both `README.md` and `README.zh-CN.md`.
2. Install the Homebrew `create-dmg` formula in each macOS job and add a small
   repository wrapper that receives an existing `.app`, applies the fixed
   centered-pair layout, and writes the existing architecture-specific filename.
3. Change only the `Create downloadable DMG` command in the macOS Action jobs to
   call that script. Preserve the preceding package and smoke-test steps and all
   release artifact names.
4. Use the native Finder background and a balanced 128 px icon layout. A custom
   background is deliberately deferred until there is a concrete design need.
5. Add an automated DMG-content check that mounts the image read-only and asserts
   both `Live2Pet.app` and the `Applications` link exist. Finder coordinate
   appearance should be confirmed once from a downloaded CI artifact because it
   is visual metadata.

### Acceptance criteria

- Both GitHub READMEs show the current tracked product icon above the title.
- Replacing `apps/desktop/assets/icon.png` changes the README image without a
  Markdown edit.
- Each architecture-specific DMG opens to a balanced App-to-Applications
  drag-to-install layout.
- The mounted DMG contains one `Live2Pet.app` and one link targeting
  `/Applications`.
- Existing App packaging, startup smoke tests, DMG filenames and release upload
  behavior remain unchanged.

## Recommendation to confirm

Proceed with `create-dmg/create-dmg`: a 660 x 400 window with 128 px icons, the
App at `(180, 185)`, and Applications at `(480, 185)`. The pair is centered as a
composition with a clear drag direction. Use the existing packaging PNG directly
at the top of both READMEs.
