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
- Native bounds-analysis, lower-level transport overhead, and encoder queue-depth
  instrumentation. Existing numeric timings describe their measured boundaries,
  not every internal operation.
- Expand the native scenario matrix beyond the cold/warm fixtures below, including
  mixed mappings and cancellation/retry on legacy Cubism and Spine. Synthetic
  adapter/cache tests alone do not establish those native outcomes.

The user subsequently accepted the generated Clawd theme visually. That check
is complete for this fixture; it does not substitute for native Cubism 2/Spine
acceptance. Follow-up implementation adds monotonic operation aggregates,
Desktop preparation/cache measurements and a public-preload cancel/retry scenario.
The timing table above still describes the original qualified checkpoint, not
new runs of those expanded scenarios.

### Verified measurement follow-up — `72f7063`

The real modern-model cancel/retry scenario completed through public Desktop IPC
in a separate temporary profile. Cancellation was acknowledged; a retry on the
same host produced exactly the earlier qualified cold build's three WebP payloads,
dimensions, alpha, delays and inspected sample pixels. Request-correlated progress
reports exactly 512 captured frames, matching 1,207,959,552 newly captured RGBA
bytes. Artifact download transferred 51,102,362 bytes in 49 chunks.

The first attempt revealed that a late event from the cancelled request could
inflate the benchmark's retry counter. Distinct verified request identities now
filter both cancellation listeners and retry summaries; the corrected native
rerun passed. Output bytes were unaffected by the earlier counting error.

The retry took 158.38 s while regression tests were running concurrently. This is
correctness evidence, not a comparable throughput measurement. Cancellation
settlement latency is not a promise that all in-flight native work stops instantly.
The final regression passed 400 Node tests and 190 UI tests, with three opt-in
checks skipped. Type/source-release gates and the final production macOS x64
packaged startup/resource smoke passed. Standards and Spec reviews have no
remaining actionable findings. #19 remains open for the outstanding matrix above.

One earlier extended benchmark stopped because its main page closed; no system
crash report was found. Whether that closure was user-initiated is unconfirmed,
so the interrupted run is not counted as complete. A separate reproducible
destroyed-owner preview-cleanup error was fixed and its native close smoke passed;
that does not establish the cause of the earlier interruption.

### Native Cubism 2 and Spine follow-up — `eadf446`

The user identified an existing local Source Library containing both generations.
Read-only inspection found a Cubism 2 directory, a Cubism 2 PCK, a Spine 4.1.11
binary model and a Spine 3.8.95 binary model. The directory and Spine 4.1 model
were used for native builds; the PCK was inspected but not built in this run.
Spine 3.8 remains outside the installed/supported 4.x runtime-pack scope and
returns `UNSUPPORTED_SPINE_VERSION`; this is not evidence of damaged model data.

All builds used isolated App profiles, verified existing local runtimes, public
Desktop build IPC, Balanced output and in-memory mappings. Original model files
were not changed. The Spine driver copied only the installed 4.1 pack into the
temporary profile and verified it against the App's pinned digests before loading.
Native loading hydrated 171 Motions from the binary model. It then exercised
three selected Motions, not all 171; the figures are not all-model guarantees.

| Native target | Cold seconds (three repetitions) | Warm seconds (same repetitions) | Cold / warm captured frames | Warm encoded hits |
| --- | --- | --- | --- | --- |
| Cubism 2 → Clawd | 22.14 / 25.64 / 31.33 | 4.20 / 6.14 / 5.17 | 220 / 0 | 3 |
| Spine 4.1 → Clawd | 25.23 / 23.93 / 26.78 | 0.37 / 0.47 / 0.44 | 129 / 0 | 3 |

Every warm build performed zero equivalent capture/encoding. All three Clawd
WebP payloads matched across all six builds within each fixture, including
dimensions, alpha, delays and decoded sample pixels. Samples were nonempty.
These are local repeated observations, not controlled cross-machine benchmarks;
the legacy series partly overlapped the separate Spine catalog probe.

A further Spine → Codex sprite-V2 pair completed in 20.48 s cold and 0.35 s warm.
Cold captured 237 frames and encoded one atlas; warm captured/encoded none and
reused one atlas. Atlas bytes and inspected pixels/metadata matched exactly.
This pair is one repetition, not three. No installed target host was modified.

The fixture-availability blocker is resolved. #19 remains open for the outstanding
instrumentation and broader per-renderer scenario matrix; no production code or
runtime distribution policy was changed by this acceptance run. Models, runtimes,
temporary drivers and generated packages remain local and are not published.
