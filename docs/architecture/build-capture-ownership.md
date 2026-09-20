# Capture-scoped renderer ownership

[Issue #20](https://github.com/receyuki/live2pet/issues/20) adds byte-budgeted
Clawd capture/encoding. Measured results and platform limitations are below.

## Boundary

Desktop supplies each uncaptured target with `withCaptureRenderer(operation)`.
The shared Package Build calls it for Visual Settings, bounds preparation and
capture, then receives owned RGBA candidates. Multi-Motion Clawd encoding can
overlap subsequent captures; the final Motion waits for the lease to settle.
Atlas composition and ZIP assembly run outside the lease. Single-Motion Clawd
uses the same admission pool but still releases its lease before encoding;
Codex retains its capture-then-encode path.
Direct renderer inputs remain supported for headless callers. Already captured
inputs and complete encoded-cache hits do not acquire a lease.

One capture queue and the preview session's existing operation queue serialize
native access. Separate requests may overlap downstream processing with another
capture, but cannot mutate the renderer simultaneously. Each target acquires a
fresh matching session; multi-target requests still process their targets in
order. No second renderer, FPS change or new user-facing queue is introduced.

Cache identity is resolved after acquiring the native renderer, then verified
against the planned build identity before capture. The same verified cache
context continues into encoding, with canonical project Visual Settings. Existing
source/runtime freshness checks still run before persistence and publication.
No cache algorithm revision or project-format change is needed: pixels, sampling
and encoding are unchanged.

## Cancellation and preview changes

Cancellation can settle a request promptly, but the native queue remains occupied
until the in-flight capture actually unwinds. A retry cannot overtake it. Failed
acquisition or capture releases the queue through its existing promise cleanup.
After capture, closing or replacing the preview does not invalidate owned frames;
downstream code must not access the native renderer.

Queue progress describes only the target waiting for a capture lease and retains
the caller's request/snapshot ownership. It does not report another target as
queued while that target is encoding. Renderer queue/acquisition timings retain
their existing numeric report fields.

## Clawd admission and backpressure

One ordered producer hands off each missing Motion to its encoder and waits when
the shared admission pool is full. The default pool admits at most two raw Motion
sets across Clawd builds with capture misses, under an **estimated working-byte budget** of
one quarter of physical RAM, with a 512 MiB floor and a 3 GiB cap. Thus 4 / 8 /
16 GiB hosts use 1 / 2 / 3 GiB respectively; larger hosts retain the 3 GiB cap.
The estimate is four times sampled RGBA bytes plus 64 MiB per Motion, accounting
conservatively for frame storage, stack copies and codec/cache scratch space.
It is not a process RSS limit: textures, Chromium, encoded assets and native
allocator retention are outside this accounting. It is not a live system-memory
pressure monitor; do not interpret the estimate as a hard process-memory bound.

A Motion exceeding the budget is admitted alone, without changing resolution,
frame rate or full-duration atomic WebP encoding. Its reservation is reported
separately. Reservations cover capture, raw-cache persistence, encoding and
encoded-cache persistence, then release the frame references. Already encoded
assets bypass the producer. Cancellation removes waiting admissions, releases
unconsumed handoffs and waits for active capture to settle before cleanup.

`timings.pipeline` reports per-build `budgetBytes`, `peakReservedBytes`,
`peakResidentMotions`, `maxMotionReservationBytes`, `oversizedMotions`, `waitMs`
and final `reservedBytes`. The last field must be zero after success. The optional
core `captureBudgetBytes` override creates a separate pool for deterministic
tests/headless callers; the Desktop default shares one process-wide pool.
Externally supplied frames and the Codex path are not budgeted.

Pipelined progress carries independent `stageFractions` for capture, validation
and encoding. The Desktop sums their existing weights instead of assuming every
earlier stage is complete when encoding starts. Request/snapshot filtering and
the final success-only 100% transition remain unchanged.

## Verification and remaining work

Public build regressions verify byte-identical direct/leased output for Clawd and
Codex, capture bypass for supplied assets, late verified cache identity, and no
compose/package stage under the lease. Desktop tests hold one encode open
while another capture completes, assert a single active capture, close a real
preview-session service during encoding, and exercise queued/active cancellation.
The existing planned-cache and runtime-change regressions remain applicable.

Public pipeline tests cover early encoding, oversized admission, byte-identical
outputs, cancellation, storage/acquisition/capture failures and immediate retry.
Admission tests cover concurrent requests sharing the pool and single-Motion
misses, including renderer release before encoding. Native measurements below
exercise both one and two simultaneous encoders. They do not claim to bound
other App processes or unbudgeted Codex/external-frame inputs.

The measured ZIP recompression bottleneck remains separate work in #21.

### Native checkpoint

A permitted Spine 4.1 fixture completed cold Clawd, warm Clawd, sequential Codex
V2, and capture cancellation/retry through public Desktop IPC in an isolated
profile. Captured frame counts were 129 / 0 / 237 / 129 respectively. Every
scenario's WebP bytes, dimensions, alpha, delays and decoded sample pixels matched
the accepted #19 baseline exactly. This verifies output stability, not a new
throughput or memory bound. Private fixtures, runtimes and generated packages
remain outside the repository.

A second native check closed the preview from a Clawd encode-start event and then
submitted a Codex V2 request on the same Desktop instance. Preview closure
completed before the Clawd build settled. Both packages validated and matched
the #19 encoded bytes and decoded samples exactly, confirming that downstream
work no longer depends on the native view remaining alive.

First-checkpoint verification: 409 Node tests and 190 UI tests passed, with three
opt-in tests skipped. Typechecking, source-release asset checks and the macOS x64
packaged startup smoke passed. Independent Standards and Spec reviews reported
no remaining findings for that checkpoint. At that point #20 remained open for
memory/throughput acceptance.

Second-checkpoint Spine smoke: cold/warm/cancel-retry output bytes and decoded
samples matched the accepted baseline. Cold build took 22.00 s versus 22.62 s
in the previous checkpoint; sampled process-group peak was 1,694,220 versus
1,750,852 KiB. These are single runs, not a statistically established speedup.

The large Cubism fixture also matched all baseline WebP bytes, dimensions,
alpha, delays and decoded samples (512 captured frames). Its single cold run
regressed from 129.58 s to 149.68 s, while sampled process-group peak fell from
2,730,644 to 2,582,476 KiB. All three Motions exceeded the conservative budget
and ran alone; admission waits totalled 29.27 s, encoding 51.46 s and ZIP assembly
57.65 s. The previous baseline predates this checkpoint and is not a controlled
paired experiment. This is a memory/throughput tradeoff requiring follow-up,
not evidence of an overall acceleration, and did not justify closing #20.

### Admission calibration

The initial 512 MiB default made normal balanced-preset Motions oversized and
serialized them even on a 16 GiB host. The adaptive default retains the same
conservative per-Motion estimate and two-slot ceiling rather than assuming
smaller codec overhead to allow concurrency.

Fresh Node processes exercised the real sharp 0.34.5 / libvips 8.17.3 encoder
with one and two full-duration 768-square animations decoded from a permitted
generated package. With raw input already resident, 20 ms RSS sampling observed:

| Concurrent encodes | Raw input | Additional encode RSS | Reserved estimate |
| --- | ---: | ---: | ---: |
| 1 | 324 MiB | 358.6 MiB | 1,360 MiB |
| 2 | 679.5 MiB | 738.2 MiB | 2,846 MiB |

These samples include the mandatory stack copy and native codec work, but are not
an allocator-wide bound or proof for every model/platform. Source frames plus
the observed additional RSS fit within the retained four-times-RGBA-plus-64-MiB
estimate. The calibration used decoded output frames, not redistributed models;
fresh processes, explicit input lifetime and sampled RSS avoid claiming that
all native allocations are tracked by JavaScript counters. Raw-cache copies
and renderer textures are instead exercised by whole-App benchmarks. The final
calibration kept sharp's production-default cache settings enabled.

Three large-fixture cold runs with the 3 GiB budget took 131.46 / 129.06 /
126.00 s, with sampled process-group peaks of 2,955,552 / 3,016,224 / 3,133,372
KiB. All output image records matched the accepted pre-pipeline baseline exactly.
The two default-policy warm runs captured/encoded zero frames and also matched,
but still took 51.07 / 52.53 s because ZIP recompression is unchanged. Compared
with the 512 MiB checkpoint, throughput recovered at the cost of higher peak
memory. Lower-memory hosts retain lower admission limits; no universal speedup
or lower RSS is claimed for every source.

A 12-Motion Spine 4.1 fixture (345 captured frames) was measured twice per path
in fresh profiles on the same macOS x64 / 16 GiB host. The control uses Package
Build from `93b224a` with the current Desktop host and benchmark harness, not an
unchanged historical App. No heavy test suite ran alongside the measurements.

| Path | Cold seconds | Sampled process-group peak (KiB) |
| --- | --- | --- |
| Pre-pipeline control | 55.59 / 54.13 | 2,034,316 / 2,355,576 |
| Adaptive pipeline | 50.87 / 51.29 | 1,799,372 / 1,888,820 |

All twelve WebP files matched across all four runs: full encoded SHA, frame
count, dimensions, alpha, delays and decoded sample SHA. The mean elapsed time
fell about 6.9%, and mean sampled peak about 16%. The two resident-Motion ceiling
was retained, with no reservations remaining at completion. These are small
local comparisons, not cross-platform performance guarantees; Windows and
Apple Silicon acceptance remains a separate #22 gate.

A native 12-Motion cancellation/retry check acknowledged cancellation in 3.9 ms.
The retry completed all 345 frames in 53.71 s, released every reservation, and
matched all twelve baseline image records exactly. Acknowledgement latency is
not a claim that an in-flight native operation can be forcibly interrupted.
