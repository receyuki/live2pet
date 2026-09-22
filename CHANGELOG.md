# Changelog

Notable user-facing changes to Live2Pet are recorded here. The version in
`apps/desktop/package.json` is the product version used by the Desktop App and
GitHub Releases.

## [Unreleased]

## [0.3.0] - 2026-09-22

### New features

- Search and sort model libraries without downloading the entire collection.
- Follow a short contextual first-run tutorial, with skip and replay controls.
- Match supported system languages on first launch, falling back to English.

### Improvements

- Install on macOS with a drag-to-Applications DMG layout.
- Keep Map focused on animation preview and assignments; model details remain
  in Models instead of a duplicate information row.
- Suspend inactive previews to reduce background CPU and memory work while
  keeping active Live2D preview at 60 FPS.

### Performance

- Avoid recompressing generated WebP media when assembling Clawd and Codex ZIPs,
  substantially reducing large cached rebuild times. Small archives may grow slightly.
- Skip unused Clawd frame scoring and batch small Live2D capture requests without
  changing output frame rate, quality or authored timing. Spine retains single-frame capture.
- Overlap capture and encoding within a memory budget, releasing completed frame
  sets promptly and capturing oversized animations alone.
- Reuse verified Clawd animations and Codex atlases before opening a renderer
  or decoding raw-frame caches. Metadata-only edits keep the same pixels;
  mixed Clawd builds capture only missing animations.
- Enable hosted Spine builds to use the bounded capture and encoded caches
  with pinned runtime identities. Cache revisions do not change project or
  Source Package fingerprints.
- Start build capture from a fixed hidden renderer state and measure hidden
  part bounds at the requested output dimensions, independently of preview size.
- Isolate native model state between captured animations so partial cache reuse
  cannot inherit a preceding Motion's parameter or physics state.

### Fixes

- Keep newer native preview status when an older open or polling response arrives
  late, so a reported renderer failure is not replaced by stale ready state.
- Keep preview commands attached to their owning page during rapid model
  switches and Settings navigation; hidden previews no longer restart their
  render loop when a playback or inspection command arrives.
- Preserve paused playback across frame capture and stop rendering when a
  non-looping animation finishes. Live2D retains its 60 FPS foreground limit;
  Spine's foreground animation timing is unchanged.
- Return keyboard focus to Settings after closing the Settings page.
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

- Windows x64 is no longer labelled as preview. Native packaging and startup
  checks pass in CI, alongside maintainer-reported workflow acceptance.
- Open legacy `.live2pet` projects without incorrectly treating a fingerprint
  algorithm update as a changed model. `.l2p` and `.l2pack` remain supported.

### Known limitations

- Desktop builds remain unsigned; macOS Gatekeeper and Windows SmartScreen
  may require the steps documented in the README.
- User models and separately licensed Live2D runtimes are not bundled. Spine
  support remains version-matched; this release does not add new runtime lines.

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
