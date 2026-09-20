# Changelog

Notable user-facing changes to Live2Pet are recorded here. The version in
`apps/desktop/package.json` is the product version used by the Desktop App and
GitHub Releases.

## [Unreleased]

### Fixes

- Keep newer edits and recovery drafts when an earlier project save completes,
  and ignore save responses belonging to a closed or reopened project.
- Keep generated packages attached to their project snapshot, label earlier
  results after edits, and require active builds to finish or cancel before
  project replacement. Failed rebuilds retain the last successful package.
- Validate Portable Project contents and cached working copies before opening,
  including source containment, file types, sizes, and SHA-256 digests.
- Preserve the installed pet when an upgrade fails during staging, backup,
  publication, or verification, including disk-full errors.
- Retain the previous package and show recovery instructions when automatic
  rollback fails. A leftover-backup cleanup failure no longer rolls back a
  verified new installation and is shown as a warning instead.

### Compatibility

- Windows x64 packaging and the supported desktop workflow have completed CI
  and real-device acceptance, so Windows is no longer labelled as preview.

## [0.2.0] - 2026-09-08

### New features

- Save lightweight `.l2p` projects with portable relative model references.
- Save an `.l2pack` Portable Project when you want to move an editable project
  and its selected model to another computer. Matching runtimes remain a
  separate one-time setup.

### Improvements

- Generated Clawd and Codex Pet ZIPs now use stable names without an internal
  package version suffix, making rebuilt packages easier to recognize and
  replace.
- Portable Projects validate their contents and checksums before opening and
  avoid recompressing media that is already compressed.

### Compatibility

- Existing `.live2pet` projects continue to open and can still be saved in
  place. New lightweight projects use the `.l2p` extension and schema v3.

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
