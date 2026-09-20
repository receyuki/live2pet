# Capture-scoped renderer ownership

This is the first checkpoint of [#20](https://github.com/receyuki/live2pet/issues/20),
not the completed byte-bounded capture/encoding pipeline.

## Boundary

Desktop supplies each uncaptured target with `withCaptureRenderer(operation)`.
The shared Package Build calls it for Visual Settings, bounds preparation and
capture, then receives owned RGBA candidates. Encoding, atlas composition and ZIP
assembly run after that operation and its exclusive renderer lease settle.
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

## Verification and remaining work

Public build regressions verify byte-identical direct/leased output for Clawd and
Codex, capture bypass for supplied assets, late verified cache identity, and no
compose/encode/package stage under the lease. Desktop tests hold one encode open
while another capture completes, assert a single active capture, close a real
preview-session service during encoding, and exercise queued/active cancellation.
The existing planned-cache and runtime-change regressions remain applicable.

This checkpoint still collects all raw candidates required by a target before
encoding. It does not cap aggregate memory of concurrent downstream requests or
stream individual Motions through an encoder. The remaining #20 checkpoint must
add byte-budgeted admission/backpressure, release consumed raw frames, and measure
many-Motion and large-texture workloads before claiming bounded-memory speedups.

The measured ZIP recompression bottleneck remains separate work in #21.
