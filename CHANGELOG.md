# Changelog

Notable user-facing changes to Live2Pet are recorded here. The version in
`apps/desktop/package.json` is the product version used by the Desktop App and
GitHub Releases.

## [Unreleased]

## [0.1.0] - 2026-09-08

### Highlights

- Browse local model collections and GitHub folders with lazy previews and
  bounded downloads.
- Preview and map Live2D Cubism and supported Spine animations to Clawd on Desk
  and Codex pet states.
- Hide model parts, tune capture quality, save `.live2pet` projects, and build
  or install generated pet packages.
- Reuse separately downloaded Live2D runtimes and install version-matched Spine
  renderer packs from the App.
- Check the latest stable GitHub Release automatically or on demand, then open
  its release page without downloading or installing anything in the App.
- Run Live2Pet on Apple Silicon macOS, Intel macOS, and 64-bit Windows.

### Known limitations

- Desktop builds are unsigned. macOS Gatekeeper and Windows SmartScreen may
  require manual confirmation.
- Live2D runtimes and user models are not included in the App.
