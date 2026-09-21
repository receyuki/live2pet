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
