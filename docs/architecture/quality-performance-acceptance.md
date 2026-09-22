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
| Interactive packaged checkpoints | Local modern Cubism and Cubism 2: playback/mapping, three crash recoveries each, both exports and generated previews, save/reopen, Settings return, source-review persistence and draft recovery passed; restart/runtime reuse separately passed | A single uninterrupted all-in-one harness pass, target-host/manual acceptance |
| Windows x64 and macOS arm64 CI | Workflow 35610945992 at `cccdfb2`: both native package/startup/service jobs passed | Real-model/manual acceptance or later product revisions |
| Maintainer acceptance | On 2026-09-22, confirmed runtime reuse, editing while saving, and Clawd/Codex playback, framing and interaction after confirming the Map cleanup | OS version, device and exact tested binary were not supplied; this is not separate manual acceptance on every platform |

## Repeatable checks

Local source verification passed 437 Node tests (three opt-in skips) and all 191
UI tests, plus syntax/TypeScript checks and the source asset scan. One initial
UI run timed out on a thumbnail test at the existing five-second limit; the full
UI suite passed on rerun with two workers, without changing assertions or timeouts.

[Artifact workflow 35610945992](https://github.com/receyuki/live2pet/actions/runs/35610945992)
completed successfully at `cccdfb2`: source verification, Windows x64, macOS
arm64 and macOS x64 jobs each passed. Both DMGs and the Windows ZIP are workflow
artifacts. **Publish GitHub Release was skipped**, as intended for a manual
branch run. Native dependency, ASAR transaction and HeroUI startup checks passed
on each runner. No private model or runtime was supplied to CI.
The final Linux source job passed 436 Node tests and 194 UI tests. Its four
skips were the macOS-only ImageIO icon check and three opt-in real-runtime/model
tests; native package jobs and local model evidence are recorded independently.

Native workflow revalidation found a same-session status-ordering race: a late
open/poll response could overwrite a newer pushed status. `cccdfb2` fixes this
with owner-scoped event revisions; three new regressions cover delayed poll,
opening failure and unrelated-project events. This is a verified ordering fix,
not proof that every possible renderer freeze has the same cause.

The all-in-one native harness initially stopped on outdated navigation locators,
system-language/tutorial assumptions and a Playwright dialog-handling exception
at restart. Those test boundaries were updated without changing App navigation
or language behavior. Both model workflows passed through recovery in the rebuilt
App; restart checks were then completed in a separate process against the same
temporary profile. No moved-PCK scenario was run in this final folder-based check.
The pre-existing local harness navigation edits were preserved but not included
in these commits. Private models, runtimes, captures and diagnostics remain local.

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

## Maintainer acceptance — 2026-09-22

After confirming the Map cleanup, the maintainer explicitly confirmed that the
remaining overall acceptance checks were normal: runtime reuse, continuing to
edit while saving, and playback, size/framing and interaction in Clawd and Codex.
This completes the maintainer acceptance gate for #22 together with the
automated and native evidence above.

The latest offered local candidate was rebuilt with the Map cleanup committed
as `9f18327`; the preceding cross-platform artifacts were built at `cccdfb2`.
The maintainer did not specify which binary, OS version, device or models were
used. Do not infer those details or claim manual acceptance on all three
platforms. The known model/version and measurement limitations above remain.
Release publication still requires separate authorization.
