# Quality and performance acceptance

Tracking: [#22](https://github.com/receyuki/live2pet/issues/22), following completed
reliability/performance work in #15–#21. Release publication is not part of this
acceptance. This record separates reproducible automated checks from manual
platform evidence and is not an all-model compatibility guarantee.

## Evidence boundaries

| Check | Current evidence | What it does not prove |
| --- | --- | --- |
| Source regression | Node and UI suites, syntax/TypeScript checks and asset scan | Packaged platform execution |
| macOS x64 packaged startup | Local rebuilt App: Sharp/libvips, ASAR service loading, HeroUI mount, Spine/cache IPC passed | Real target-host installation |
| Packaged transactions | Local ASAR: synthetic upgrade rollback, project replacement/cancel, save snapshot isolation, reversed concurrent saves and Portable Project reopen/rejection passed | UI stale-response handling, rendered-pet visuals or every filesystem failure |
| Native output/performance | Modern Cubism, Cubism 2 and Spine 4.1, both targets; exact image records checked | Windows/Apple Silicon performance, Spine 4.0/4.2 compatibility |
| Full interactive packaged workflow | Revalidation in progress; not yet accepted | Cannot be inferred from startup or service tests |
| Windows x64 and macOS arm64 CI | Workflow 35609840814 at `d6bac06`: both native package/startup/service jobs passed | Real-model/manual acceptance or later revisions |
| Maintainer Windows testing | Previously reported as passed | OS version, device, build identity and latest-change coverage were not supplied |

## Repeatable checks

Local source verification passed 437 Node tests (three opt-in skips) and all 191
UI tests, plus syntax/TypeScript checks and the source asset scan. One initial
UI run timed out on a thumbnail test at the existing five-second limit; the full
UI suite passed on rerun with two workers, without changing assertions or timeouts.

[Artifact workflow 35609840814](https://github.com/receyuki/live2pet/actions/runs/35609840814)
completed successfully at `d6bac06`: source verification, Windows x64, macOS
arm64 and macOS x64 jobs each passed. Both DMGs and the Windows ZIP are workflow
artifacts. **Publish GitHub Release was skipped**, as intended for a manual
branch run. Native dependency, ASAR transaction and HeroUI startup checks passed
on each runner. No private model or runtime was supplied to CI.

- `pnpm test`, `pnpm typecheck`, `pnpm release:check`.
- On each native platform: `package:mac` / `smoke:mac`, or `package:win` /
  `smoke:win` in `@live2pet/desktop`. Smoke checks run synthetic service scenarios
  with modules resolved from that App's ASAR, not checkout services.
- The opt-in [Desktop workflow](../desktop-acceptance.md) uses a fresh profile and
  user-permitted local models/runtimes. Tutorial and system-language behavior are
  separate UI regressions, not part of its English-locator workflow.
- [Encoded-cache measurements](encoded-build-cache.md),
  [bounded pipeline](build-capture-ownership.md) and
  [capture/archive results](build-capture-optimizations.md) document cold, warm,
  metadata-only, changed-Motion, many-Motion and cancellation/retry evidence.

Active Live2D preview remains at 60 FPS. Output presets, timing, transparency and
project/source identity rules remain unchanged. Memory admission is bounded, but
an oversized Motion runs alone and native renderer/encoder memory is not a hard
process cap. The largest final local fixture peaked at about 2.81 GiB.

## Remaining manual gate

Use the candidate App on Windows x64 and/or macOS Apple Silicon, recording the
App revision and OS/architecture. Check runtime reuse after restart, model
preview/mapping, both output targets and saving the resulting packages. During a
save, edit the project and verify newer edits are retained; during a build, verify
project replacement is guarded. Import the generated package in the installed
target host and inspect playback, framing and interaction. Report any failure
with its model/runtime version and operation, without uploading unlicensed assets.

Until those results and the pending automated checks are recorded, #22 stays
open. Do not treat prior unspecified Windows testing as acceptance of this build.
