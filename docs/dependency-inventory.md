# Dependency and native-binary inventory

This inventory describes the dependencies that cross a Live2Pet release
boundary. Versions are pinned in `pnpm-lock.yaml`; update this document and
the corresponding notices when a release dependency changes.

## Runtime dependencies

| Dependency | Version | Use | Release boundary |
| --- | --- | --- | --- |
| Electron | 44.0.0 | Desktop shell, sandboxed windows, and typed IPC | App packaging only; the Forge maker remains release-gated |
| `@electron/packager` | 20.3.0 | Current-machine local unsigned `.app` assembly | Build-time only; excluded from the packaged App |
| `sharp` | 0.34.5 | Transparent WebP encoding and image composition | Package Build; uses platform-specific optional `@img/*` libvips packages |
| `@zip.js/zip.js` | 2.7.57 | ZIP reading, validation, export, and installation | CLI, Package Build, and staged Mapper bundle |
| `pixi.js` | 6.5.10 | Browser Live2D preview and capture | Staged Mapper browser asset; MIT notice required |
| `@pixi/unsafe-eval` | 6.5.10 | Pixi compatibility uploader required by the preview bridge | Staged Mapper browser asset; MIT notice required |
| `pixi-live2d-display` | 0.4.0 | V1 Cubism 2/modern compatibility adapters | Staged Mapper browser asset; MIT notice required |

The shared packages otherwise use Node.js built-ins and local package links.
React, React DOM, HeroUI, and Lucide are Desktop build-time dependencies: Vite
embeds their used code in `renderer-dist`, so their complete npm trees are not
deployed as main-process dependencies. Their versions are unchanged by this
classification. The packaged renderer includes `THIRD-PARTY-LICENSES.md` generated
by Vite, plus the HeroUI styles and Tailwind CSS license texts in `licenses/`.
The Desktop `files` allowlist excludes local icon drafts and development inputs;
the system icon is supplied separately to Electron Packager. ZIP and Sharp stay
in the production dependency graph because the main process uses them.

The legacy `packages/live2d-exporter/export.cjs` script may use a locally
installed Puppeteer for an opt-in smoke path; Puppeteer is not part of the
public App or CI dependency contract.

## Optional downloaded renderer pack

Spine support is not part of the installed App or repository. After an explicit
user action, Live2Pet downloads the exact official
`@esotericsoftware/spine-player` 4.3.13 IIFE/CSS/license files from fixed HTTPS
URLs, enforces an 8 MiB aggregate limit, verifies pinned SHA-256 values, and
stores the pack in private App data. The pack is reused automatically and can
be removed in Settings. It is governed by the Spine Runtime License and is not
relicensed by Live2Pet's Apache-2.0 license.

## User-provided runtime inputs

Modern Cubism Core, the legacy Cubism 2 JavaScript runtime, and the optional
Spine renderer pack are deliberately not dependencies committed to this
repository. Users must have the licenses required for their use. Live2Pet
validates and stores runtime files in private local App or browser-profile
storage; it never commits, stages, packages, or publishes those files.

Models, textures, Motion/Expression files, PCK/LPK archives, rendered frames,
and generated character packages follow the same user-provided boundary.

## Native and platform-specific files

- Electron distributes its platform binary through the package manager and is
  not checked into source.
- Electron Packager is a development dependency used only to assemble the
  current-machine unsigned App. Forge makers, signing, notarization, and
  installer publication remain outside this dependency boundary.
- `sharp` resolves a platform-specific prebuilt libvips package when available;
  the Package Build service does not shell out to ImageMagick, FFmpeg,
  `libwebp`, or a system ZIP executable.
- No Cubism runtime, Spine renderer pack, model, texture, generated WebP, or
  example package is a release asset.

See [`apps/desktop/THIRD-PARTY-NOTICES.md`](../apps/desktop/THIRD-PARTY-NOTICES.md)
for the notices shipped with the staged browser bundle.
