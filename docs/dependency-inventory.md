# Dependency and native-binary inventory

This inventory describes the dependencies that cross a Live2Pet release
boundary. Versions are pinned in `pnpm-lock.yaml`; update this document and
the corresponding notices when a release dependency changes.

## Runtime dependencies

| Dependency | Version | Use | Release boundary |
| --- | --- | --- | --- |
| Electron | 44.0.0 | Desktop shell, sandboxed windows, and typed IPC | App packaging only; the Forge maker remains release-gated |
| `sharp` | 0.34.5 | Transparent WebP encoding and image composition | Package Build; uses platform-specific optional `@img/*` libvips packages |
| `@zip.js/zip.js` | 2.7.57 | ZIP reading, validation, export, and installation | CLI, Package Build, and staged Mapper bundle |
| `pixi.js` | 6.5.10 | Temporary browser Live2D bridge and preview host | Staged Mapper browser asset; MIT notice required |
| `@pixi/unsafe-eval` | 6.5.10 | Pixi compatibility uploader required by the preview bridge | Staged Mapper browser asset; MIT notice required |
| `pixi-live2d-display` | 0.4.0 | Cubism 2/modern compatibility adapter during the renderer transition | Staged Mapper browser asset; MIT notice required |

The shared packages otherwise use Node.js built-ins and local package links.
The legacy `packages/live2d-exporter/export.cjs` script may use a locally
installed Puppeteer for an opt-in smoke path; Puppeteer is not part of the
public App or CI dependency contract.

## User-provided runtime inputs

Modern Cubism Core and the legacy Cubism 2 JavaScript runtime are deliberately
not dependencies of this repository. Users select copies they are separately
licensed to run. Live2Pet validates and stores them in private local App or
browser-profile storage; it never commits, stages, packages, or publishes
those files.

Models, textures, Motion/Expression files, PCK/LPK archives, rendered frames,
and generated character packages follow the same user-provided boundary.

## Native and platform-specific files

- Electron distributes its platform binary through the package manager and is
  not checked into source.
- `sharp` resolves a platform-specific prebuilt libvips package when available;
  the Package Build service does not shell out to ImageMagick, FFmpeg,
  `libwebp`, or a system ZIP executable.
- No Cubism runtime, model, texture, generated WebP, or example package is a
  release asset.

See [`apps/desktop/THIRD-PARTY-NOTICES.md`](../apps/desktop/THIRD-PARTY-NOTICES.md)
for the notices shipped with the staged browser bundle.

