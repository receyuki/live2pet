# Encoded-cache checkpoint — 2026-09-20

This is a partial delivery of [#19](https://github.com/receyuki/live2pet/issues/19),
not completion of its acceptance matrix or a release performance guarantee.
Implementation: `a85c4bd`, measured against the preceding `51dcde8` baseline.

## Method

- One permitted modern Cubism project, in a separate temporary Desktop profile.
- Intel macOS; real native rendering, public build IPC, Sharp encoding and ZIP
  validation. Balanced output: 768 × 768, 24 FPS. No quality reduction.
- Three distinct animations mapped to four required Clawd states; the changed
  mapping replaces one animation. Source files and saved mappings are untouched.
- Wall time surrounds the build IPC call, excluding artifact download and
  decoding. Electron process-group working sets are sampled every 500 ms.
  Reported memory is a sampled peak, not an absolute allocation bound.
- Private models, installed runtimes, generated ZIPs and local paths are not
  included in this repository. Reproduce with the opt-in
  [project benchmark](../architecture/encoded-build-cache.md#opt-in-local-benchmark).

## Current measurements

One completed repetition after Motion-state isolation:

| Scenario | Wall time | Captured frames | Encoded animations | Encoded hits / misses | Sampled peak working set |
| --- | ---: | ---: | ---: | ---: | ---: |
| Cold | 129.58 s | 512 | 3 | 0 / 3 | 2,667 MiB |
| Unchanged rebuild | 54.53 s | 0 | 0 | 3 / 0 | 788 MiB |
| One animation changed | 96.77 s | 185 | 1 | 2 / 1 | 2,032 MiB |

The warm build retains exactly the cold build's encoded animation bytes,
dimensions, alpha, frame delays and decoded first/middle/last sample pixels.
An independent fully uncached build of the changed mapping completed in 132.53 s
(539 captured frames). All three encoded WebP payloads and their inspected
metadata/sample pixels exactly match the mixed-cache result. This specifically
checks that skipping previously cached animations does not change later output.
The warm build's ZIP stage accounts for 53.92 s of 54.53 s total: avoiding unnecessary ZIP
recompression remains a separate follow-up in #21.

## Correctness finding

Early measurements before `a85c4bd` are superseded. A fully uncached reference
of the changed mapping exposed different pixels in two animations, despite
matching frame counts and durations. Native parameter/physics state inherited
from preceding animations made those results order-dependent.

Missing capture recipes now reload the model inside the existing native view
and restore Visual Settings and Expression before sampling. Encoded and raw
capture revisions invalidate the earlier results, without changing project or
Source Package identity. This adds loading work on misses; full encoded hits
still acquire no renderer. Any cheaper reset must first prove equivalent output.

## Automated checks

- Full workspace suite: 395 Node tests and 190 UI tests passed; three opt-in Node
  checks were skipped, not counted as passes.
- JavaScript syntax, UI TypeScript and source-release asset checks passed.
- The final macOS x64 bundle passed the real packaged startup smoke: HeroUI
  mounted, native Sharp loaded, Spine/cache IPC responded, and no prohibited
  source/model/runtime assets were bundled. This is not Windows acceptance.
- Independent Standards and Spec reviews found no remaining blockers in the
  delivered checkpoint. The incomplete #19 criteria below remain open.

## Acceptance still required

- Three comparable repetitions on the final implementation, including renamed
  output and sequential targets. Older order-dependent measurements do not count.
- Fine-grained preparation, model loading, bounds, cache I/O and validation
  instrumentation; actual transferred bytes and queue depth.
- Cancellation/retry scenarios and current permitted native Cubism 2 and Spine
  fixtures. Synthetic adapter/cache tests are not native-model acceptance.
- Visual acceptance of the generated theme in the target host, especially motion
  starts, framing and hidden parts.

One earlier extended benchmark stopped because its main page closed; no system
crash report was found. Whether that closure was user-initiated is unconfirmed,
so the interrupted run is not counted as complete. A separate reproducible
destroyed-owner preview-cleanup error was fixed and its native close smoke passed;
that does not establish the cause of the earlier interruption.
