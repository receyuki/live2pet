<h1 align="center">Live2Pet</h1>

<p align="center"><strong>Your favorite model. Your next desktop companion.</strong></p>
<p align="center">Turn Live2D and Spine animations into pets for Clawd on Desk and Codex.</p>

<p align="center">
  <a href="https://github.com/receyuki/live2pet/releases/latest"><img src="https://img.shields.io/github/v/release/receyuki/live2pet?style=flat-square&color=9087ff" alt="Latest release"></a>
  <a href="https://github.com/receyuki/live2pet/stargazers"><img src="https://img.shields.io/github/stars/receyuki/live2pet?style=flat-square&color=9087ff" alt="GitHub stars"></a>
  <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows-111118?style=flat-square&logo=electron&logoColor=white" alt="Platforms: macOS and Windows">
  <a href="LICENSE"><img src="https://img.shields.io/github/license/receyuki/live2pet?style=flat-square&color=9087ff" alt="License: Apache-2.0"></a>
</p>
<p align="center">
  <img src="https://img.shields.io/badge/Electron-111118?style=flat-square&logo=electron&logoColor=9feaf9" alt="Electron">
  <img src="https://img.shields.io/badge/React-111118?style=flat-square&logo=react&logoColor=61dafb" alt="React">
  <img src="https://img.shields.io/badge/TypeScript-111118?style=flat-square&logo=typescript&logoColor=3178c6" alt="TypeScript">
  <a href="https://www.heroui.com/"><img src="https://img.shields.io/badge/UI-HeroUI-111118?style=flat-square" alt="HeroUI"></a>
</p>

<p align="center">
  <a href="README.md">English</a> · <a href="README.zh-CN.md">简体中文</a><br>
  <a href="#get-started">Get started</a> · <a href="docs/guides/user-guide.md">User guide</a> · <a href="https://github.com/receyuki/live2pet/issues">Feedback</a>
</p>

<p align="center"><img src="docs/assets/app-preview.png" alt="Live2Pet mapping workspace: choose animations, preview a cat model, and assign Clawd pet states" width="100%"></p>

<p align="center"><sub>Browse → Preview → Map → Build. All on your computer.</sub></p>

## Contents

[Why Live2Pet](#why-live2pet) · [How it works](#how-it-works) · [Desktop preview](#desktop-preview) · [Get started](#get-started) · [Compatibility](#compatibility) · [Runtimes](#runtime-setup) · [More](#more)

## Why Live2Pet

| | Make it yours |
| --- | --- |
| **Find your character** | Drop anywhere to browse local collections, or open a GitHub folder and download one model or all of them. |
| **See every motion** | Play, pause, scrub, and compare animations in a live preview. |
| **Keep the character, hide the clutter** | Identify parts with thumbnails and hide separable backgrounds or effects. |
| **One project, two destinations** | Assign animations to Clawd or Codex states, then build ready-to-import packages. |
| **Interactive by default** | Unmapped Clawd drag and double-click reactions safely reuse Idle. |
| **Pick up where you left off** | Save projects, reuse runtimes, and work in English or Simplified Chinese. |

## How it works

1. **Choose a model** — drop a folder or supported PCK, or browse a GitHub collection.
2. **Make it your pet** — preview motions, hide unwanted parts, and assign pet states.
3. **Build and enjoy** — name your pet, choose quality, then save the ZIP or install it.

Your models stay local. Original source files stay unchanged.
Pointer tracking is preview-only; exported Live2D frames use a stable neutral focus and 60 Hz physics integration regardless of output frame rate.

## Desktop preview

<p align="center"><img src="docs/assets/live2pet-desktop-pet-preview.gif" alt="A Live2Pet-generated Miku desktop pet running beside Clawd on Desk" width="250"></p>

<p align="center"><sub>From an animated model to a working desktop companion.</sub></p>

## Get started

**Unsigned builds for macOS and Windows.**

Open the [latest GitHub Release](https://github.com/receyuki/live2pet/releases/latest) and download the build for your computer:

- `Live2Pet-macOS-x64.dmg` supports Intel Macs.
- `Live2Pet-macOS-arm64.dmg` supports Apple Silicon Macs.
- `Live2Pet-Windows-x64.zip` supports 64-bit Windows.

These builds are not signed with trusted developer certificates. On macOS, if Finder says Live2Pet is damaged or cannot be opened, first make sure the DMG came from this repository, move `Live2Pet.app` to Applications, then run:

```sh
xattr -r -d com.apple.quarantine /Applications/Live2Pet.app
```

On Windows, Microsoft Defender SmartScreen may show an unrecognized-app warning. Verify that the ZIP came from this repository, then use **More info → Run anyway** if you want to continue. Signing and notarization are planned for a later release.

To build the unsigned App from source instead, install Git, Node.js 22.12+, and pnpm 11:

```sh
git clone https://github.com/receyuki/live2pet.git
cd live2pet
corepack enable
pnpm install
pnpm --filter @live2pet/desktop package:mac
open apps/desktop/out/Live2Pet-darwin-*/Live2Pet.app
```

On first launch, add your runtime and choose a model. [Setup help and troubleshooting →](docs/guides/user-guide.md)

## Compatibility

**Supported inputs**

- Live2D Cubism 2–5 model folders
- Supported Live2D PCK files
- Spine 4.0–4.3 folders, with an optional renderer

**Export destinations** — choose either target for a supported model:

- **[Clawd on Desk](https://github.com/rullerzhou-afk/clawd-on-desk)** — themes with transparent animated WebP
- **Codex custom pets** — V2 sprite atlases

Save your work as a **.live2pet** project to continue editing later.

Spine and Windows support are in preview. PCK support depends on its contents and packaging. [Detailed support and limitations →](docs/guides/user-guide.md#compatibility)

<a id="runtime-setup"></a>

## Runtimes

**Add once. Reuse automatically.** Live2D runtime files are distributed separately under their own terms. Drop a downloaded runtime or extracted SDK folder into **Settings → Runtimes**.

| Your model | What to get |
| --- | --- |
| Cubism 3–5 | [Official Cubism SDK for Web](https://www.live2d.com/en/sdk/download/web/) → `Core/live2dcubismcore.min.js` |
| Cubism 2 | `live2d.min.js` from the [third-party legacy archive](https://github.com/dylanNew/live2d/tree/master/webgl/Live2D/lib) |
| Spine 4.0–4.3 | Click **Install** for the matching renderer in the App |

[Why a separate runtime? Setup details and licensing →](docs/guides/user-guide.md#runtimes)

## More

- **Using the App:** [User guide & FAQ](docs/guides/user-guide.md)
- **What's next:** [Issues](https://github.com/receyuki/live2pet/issues) · [V1 plan](docs/plans/live2pet-v1-implementation-plan.md)
- **Building together:** [Contributing](CONTRIBUTING.md) · [Developer guide](docs/guides/development.md)
- **Security:** [Report a vulnerability](SECURITY.md)

Built with Electron, React, TypeScript, and HeroUI. Licensed under [Apache-2.0](LICENSE).

<sub>Models and runtimes retain their own licenses. The preview image is illustrative; the pictured model is not included. See [third-party notices](NOTICE).</sub>
