# Capture-scoped renderer ownership

The second checkpoint of [#20](https://github.com/receyuki/live2pet/issues/20)
adds byte-budgeted Clawd capture/encoding. Full performance acceptance remains open.

## Boundary

Desktop supplies each uncaptured target with `withCaptureRenderer(operation)`.
The shared Package Build calls it for Visual Settings, bounds preparation and
capture, then receives owned RGBA candidates. Multi-Motion Clawd encoding can
overlap subsequent captures; the final Motion waits for the lease to settle.
Atlas composition and ZIP assembly run outside the lease. Single-Motion Clawd
and Codex retain their capture-then-encode path.
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
sets across multi-Motion builds, under a 512 MiB **estimated working-byte budget**.
The estimate is four times sampled RGBA bytes plus 64 MiB per Motion, accounting
conservatively for frame storage, stack copies and codec/cache scratch space.
It is not a process RSS limit: textures, Chromium, encoded assets and native
allocator retention are outside this accounting. Native overhead calibration is
still pending; do not interpret the estimate as a measured hard memory bound.

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
Externally supplied frames and the single-Motion/Codex paths are not budgeted.

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
The remaining #20 acceptance includes many-Motion and large-texture repeated
measurements, native overhead calibration and cross-request peak-memory evidence.

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
no remaining findings for that checkpoint. The full #20 issue remains open for
the remaining memory/throughput acceptance.

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
not evidence of an overall acceleration. Do not close #20 on this result.
