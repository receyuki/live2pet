# Capture and archive optimizations

This records the independent checkpoints for #21. Output presets, active preview
60 FPS, authored timing and renderer/encoder versions remain unchanged. Native
performance observations are local macOS x64 measurements, not platform-wide
guarantees. Models, runtimes and generated archives are not redistributed.

## Store already-encoded media in generated archives

Clawd and Codex Package Builds now use ZIP method 0 (store) for `.webp` entries.
Manifests and documentation retain the normal zip.js compression. This changes
the outer archive, not the image encoding, transparency, frame count or delays.
Portable Projects use their existing independent compression policy.

This checkpoint was measured independently while capture batching was being
implemented. The #20 warm large-model profile spent about 51 seconds in archive
assembly, making redundant media compression a demonstrated bottleneck.

A local Node comparison fed the same extracted generated files to the public
archive APIs, first with the previous default compression, then with stored
media. Input extraction and output verification were outside the timed interval.
Both output archives were read back with CRC verification; every entry path and
decompressed byte matched the input. One final paired measurement per fixture:

| Generated package | Default compression | Stored media | Before bytes | After bytes |
| --- | ---: | ---: | ---: | ---: |
| Large Clawd, 3 animations | 50.938 s | 1.968 s | 51,098,674 | 51,089,631 |
| Small Clawd, 12 animations | 18.8 ms | 6.1 ms | 120,403 | 131,850 |
| Codex atlas | 4.1 ms | 1.4 ms | 33,974 | 53,512 |

The large archive avoided about 96% of assembly time. Tiny-package timings are
noise-sensitive and not a meaningful whole-build speed claim. Sparse images can
still compress further: the small fixtures grew by about 11 KiB and 19 KiB.
The Clawd 80 MiB compatibility warning continues to use the **final ZIP size**;
oversized valid packages remain saveable. No automatic installation is added.

Public Package Build tests verify compression methods, entry paths and exact
media readback, alongside existing real-codec target validators, cancellation,
archive-failure and oversized-output checks. Native whole-App measurements are
recorded separately from this isolated archive comparison.

With stored media and the initial 32 ms batch experiment, the same large fixture
completed a native Desktop cold build in 76.08 s and a warm rebuild in 2.54 s,
versus the #20 default-policy 126.00–129.06 s cold and 51.07–52.53 s warm runs.
All image records matched the pre-pipeline reference, including full encoded
SHA, frame delays, alpha and decoded sample SHA. The cold run still captured
512 frames; the warm run captured none. Only 11 capture round trips were avoided
in that experiment, so the whole-build improvement must not be attributed to
batching. The independent archive comparison above identifies the major saving.

## Rejected rendering shortcut

An isolated Spine experiment moved canvas-size restoration and its final draw
from each frame to each batch. It reduced capture round-trip time on the
12-Motion fixture from about 22 s to 13 s, but one of twelve animated assets no
longer matched the baseline pixel hashes. Matching dimensions, byte lengths,
visible-pixel counts and frame delays did **not** establish pixel parity.
The change and its synthetic-only tests were removed; per-frame restoration and
draws remain. Synthetic runtime doubles had passed, which is why native output
comparison is required before accepting this shortcut.

Live2D dimension setup already has an equality guard, and bounds are cached.
Hoisting focus neutralization would change a state boundary inside physics
integration without a demonstrated material benefit. That speculative change is
not retained either. Per-Motion reloads, physics settling, neutral pointer input,
and modern Cubism integration steps no larger than 1/60 second are preserved.

## Bounded small-frame capture

The optional binary adapter batch path is capped at four frames and 1 MiB, with
a 64 ms soft page-execution budget. One frame may exceed either bound and then
runs alone through the existing single-frame path. The timer is checked between
frames, not inside a native draw/readback; it is not a hard cancellation deadline.
Adapters without the capability and nonbinary hosts also use single captures.
Cancelled batches are discarded before candidate analysis; frame-level progress
is emitted only for consumed frames. Expression restoration remains in `finally`.

The initial 8 MiB / 32 ms experiment barely reduced large-frame requests
(344 requests for 345 Spine frames; 501 for 512 large Live2D frames). Increasing
the time budget to 64 ms reduced the Spine requests to 190, but did not establish
a capture-time improvement. Admission was therefore narrowed to small frames:
the current Clawd presets retain single captures, while Live2D's 192 × 208
Codex candidate frames can use four-frame batches. No high-resolution speedup is
claimed for batching itself.

Spine also retains single captures at small dimensions. Its native Codex atlas
failed exact baseline pixel parity even when batches retained every per-frame
draw. The Spine batch capability was therefore removed rather than introducing
new physics, viewport or wall-clock changes to force a speedup. Passing
synthetic tests alone was not treated as sufficient evidence. The optional
capability remains on modern/legacy Pixi adapters only; unsupported adapters use
the same fallback as before.

## Skip unused Clawd candidate scoring

Clawd consumes full animations rather than selecting representative candidates.
Its fresh captures omit `visualChange` and `boundsDelta`, avoiding a full RGBA
difference scan. Alpha bounds, owned pixel copies, timestamps, Expressions and
frame validation remain unchanged. Codex still computes and consumes selection
metrics. The existing frame cache already permits absent scores and separates
targets; old scored Clawd cache entries remain valid. This is not a source,
project-schema or pixel-input identity change.

## Final native checks

The final local macOS x64 runs used the same private fixtures and inspected the
complete image records (encoded SHA, dimensions, frame delays, alpha and decoded
sample SHA), not just successful archive creation. Seconds below are observations,
not minimum performance guarantees:

| Fixture | Cold Clawd | Warm | Rename only | One Motion changed | Cancel then retry |
| --- | ---: | ---: | ---: | ---: | ---: |
| Modern Cubism, 3 Motions / 512 frames | 84.26 | 2.63 | 2.65 | 35.96 | 80.47 |
| Cubism 2, 3 Motions / 220 frames | 16.62 | 0.37 | 0.43 | 11.67 | 16.10 |
| Spine 4.1, 12 Motions / 345 frames | 58.74 | 0.30 | 0.29 | 9.81 | 60.79 |

Every Clawd scenario matched its reference images; cancellation request-to-settlement
latency was 1.8–2.7 ms and the immediate retries matched cold output. Warm and rename-only
builds captured no frames. The Spine cold result did not beat the previous
50.87–51.29 s checkpoint: preparation and capture varied upward. No overall Spine
cold-build speedup is claimed. Peak observed working sets were about 2.81 GiB
(modern), 1.89 GiB (legacy), and 1.68 GiB (Spine); these are not hard process caps.

Same-version Codex single-frame controls separately checked the retained Live2D
batch path. Modern capture took 3.26 s in 63 requests versus 3.37–3.46 s in 237
requests; legacy took 1.10 s in 60 requests versus 1.12–1.17 s in 237 requests.
All image records matched both single-frame repetitions exactly. This is a modest
capture-stage improvement (roughly 4–5%), not a universal whole-build speedup:
legacy total times overlapped (2.44 s batched versus 2.37–2.59 s single).
The restored Spine single-frame Codex build took 16.97 s and matched its original
atlas record exactly. Spine does not use the batch path.

Clawd candidate-analysis time fell from 1.73 s to 0.61 s on the 12-Motion Spine
fixture and from about 2.63 s to 0.77 s on the modern fixture. That stage still
includes required pixel ownership work; it is not an isolated scoring benchmark.
The public sampler regression also compares scored/unscored pixels, timestamps
and bounds, while target tests retain Codex scoring and decode Clawd output.

These measurements are source-host native checks. Packaged platform startup and
manual workflow acceptance are tracked separately in #22; they cannot be inferred
from these macOS measurements.

The final source regression passed 432 Node tests (three opt-in skips) and 191
UI tests, plus syntax/TypeScript checks and the source-release asset scan.
