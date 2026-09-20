# Encoded-first Package Builds

The Desktop build service verifies the selected Source Package and installed
runtime before looking up generated assets. The cache stores individual Clawd
animations and whole Codex atlases; it does not store a finished ZIP. Every build
still regenerates names, metadata, manifests, previews and validated packages.

## Identity and ownership

- Keys contain the verified source digest, runtime digest, renderer/target/encoder
  versions, Motion and Expression, normalized Visual Settings, effective render
  parameters and an independent build-plan revision.
- Codex identity additionally includes actual row recipes, sprite version,
  selection rules and encoding options. Recipe labels and project/theme names
  are not pixel inputs. Duration comes from source bytes, so even a Spine binary
  can reuse an asset before its animation catalog is hydrated.
- Live2D runtime identity is the validated installed Core digest. Spine identity
  includes the selected pack's pinned version and verified file digests.
- Missing assets use the existing serialized native renderer operation, starting
  from a fresh hidden 768 × 768 session. Live2D resizes before bounds analysis;
  its per-Motion envelope cache also distinguishes output dimensions.
- Each missing Motion reloads the native model inside that same view, then
  reapplies visibility and expression. Stopping or rewinding a Motion alone
  does not restore every native physics/parameter state. Recipe isolation is
  required so skipping a cached predecessor cannot change subsequent pixels.
  This adds model-load work on misses; full hits still load no model. A cheaper
  state-reset path must prove equivalent pixels before replacing this baseline.
- Supplied frames, candidates or custom renderer instances bypass the planned
  fast path: a model digest alone does not identify those inputs.
- The plan revalidates identity after acquiring the renderer, before encoded
  cache writes and before publishing the result. Live2D also checks the runtime
  selected during loading. A changed input fails with `BUILD_INPUT_CHANGED`
  rather than saving new pixels under an earlier runtime key.
- Planned builds own encoded persistence; the inner encoded cache remains for
  supplied captures. One animation is not stored under both encoded identities.

Full encoded hits need no native view, captures, raw-frame decoding or encoding.
Cache misses now use a [capture-scoped renderer lease](build-capture-ownership.md);
encoding and ZIP assembly no longer retain exclusive native access.
Mixed Clawd hits only capture missing Motions. The normal capture cache can still
help rebuild a missing atlas. Both kinds share the existing bounded, SHA-256
checked LRU store. Corrupt records miss and oversize writes are skipped.

The build-plan revision and renderer cache revision are unrelated to `.l2p`,
`.l2pack` and Source Package versions. Algorithm updates must invalidate generated
assets, not mark the user's model as changed. No automatic installation or save
is introduced.

## Opt-in local benchmark

`pnpm --filter @live2pet/desktop benchmark:project` uses the real Desktop IPC flow
in a separate temporary profile. Supply Playwright in the caller's Node tool
environment (for example via `NODE_PATH`); it is not a shipping dependency.
Prepare renderer assets first with the regular desktop development commands.

Required environment:

| Variable | Meaning |
| --- | --- |
| `LIVE2PET_BENCH_PROJECT` | Absolute path to a permitted `.l2p`, `.l2pack` or legacy project |
| `LIVE2PET_BENCH_MOTIONS` | JSON array of four inspected Motion ids |
| `LIVE2PET_BENCH_RUNTIME` | For Live2D: a local matching runtime, copied into the test profile; Spine uses the pack variables below |
| `LIVE2PET_BENCH_REVISION` | Revision label for the report |

`LIVE2PET_BENCH_REPETITIONS` defaults to 3. `LIVE2PET_APP_EXECUTABLE` optionally
selects a packaged App. `LIVE2PET_BENCH_SCENARIOS=cold` can build a fresh reference
for a changed mapping; otherwise all six scenarios run. Warm and metadata-only
scenarios require a cold reference in the same run.
The harness preserves Visual Settings, creates mappings
only in memory and never saves over the input or installs a Pet Package. Native
setup supports modern/legacy Live2D and installed Spine packs, as described below.

Each repetition clears only its isolated cache, then measures a cold multi-motion
Clawd build, warm rebuild, metadata-only change, one-Motion change and a subsequent
Codex build, followed by capture cancellation and an immediate retry. Cancellation
clears only the test cache, requests cancellation after the first captured frame
through the public preload, and requires an acknowledged `BUILD_CANCELLED` result.
Retry timings exclude the cancelled attempt; the time from requesting cancellation
to `BUILD_CANCELLED` settlement is recorded separately as `responseMs`.
Acknowledgement is validated separately. If a cold reference is included, retry assets must match it.
Output settings remain Balanced. The test profile is removed on exit;
local ZIPs and a path-free report are retained in the printed temporary directory.
Do not commit those ZIPs or private input assets.

Wall time includes the public build IPC call. Electron's process-group working
set is sampled every 500 ms; this is a sampled peak, not an absolute peak. Artifact
download and image inspection happen after the timed interval. Reported stage
intervals distinguish parent stages from overlapping per-Motion encoding jobs;
they must not be summed into total duration. Capture counts come from actual
frame-completion events, not intended frame counts.

Warm and renamed builds must retain identical WebP bytes, dimensions, frame
delays and alpha. The report also records decoded RGBA digests and visible-pixel
counts at the first, middle and last encoded frames. CI uses public synthetic
models and checks behavior, never machine-dependent timing thresholds. Full
native timing fields are described below; the harness does not claim to measure
unobserved serialization overhead or every renderer preparation subphase.

For a local Spine fixture, set both `LIVE2PET_BENCH_SPINE_PACK_ROOT` (an existing
installed renderer-packs directory) and `LIVE2PET_BENCH_SPINE_RUNTIME_LINE`
(for example `4.1`). The harness verifies and copies only that pack into its
isolated profile, verifies it again, and hydrates the binary Motion catalog before
building. It does not download runtimes or modify the normal App profile.

For admission calibration, `LIVE2PET_BENCH_CAPTURE_BUDGET_MIB` overrides the
in-flight budget for the isolated benchmark only. Omit it to exercise the
production default. `LIVE2PET_BENCH_MOTION_COUNT` accepts 3–32 (default 3);
additional Clawd idle-pool Motions are selected deterministically from the
hydrated catalog, shortest first with a duration of at least one second. This
changes only the in-memory test snapshot and records the count, not Motion names.
`LIVE2PET_BENCH_APP_ENTRY` optionally selects an absolute local source App entry
for a controlled baseline bootstrap; report the exact substituted module/revision
and do not describe such a comparison as an unchanged historical whole App.

### Timing fields and overlap

The local build report preserves integer `timings.totalMs` and `timings.stages`,
now measured with a monotonic clock. Additional numeric fields have these scopes:

| Field | Measured work |
| --- | --- |
| `timings.capturePreparationMs` | Per-Motion model reload, excluding reapplying Visual Settings |
| `timings.rawCacheReadMs` / `rawCacheDecodeMs` | Raw-cache lookup and frame-envelope decoding |
| `timings.rawCacheWriteMs` | Frame-envelope encoding and raw-cache persistence |
| `timings.capturedRgbaBytes` | Newly captured pixel payload, not IPC serialization overhead |
| `timings.capture` | Capture roundtrip, alpha-bound scanning, candidate analysis and validated RGBA bytes; native draws/readback/bounds when measured |
| `timings.encodeMotions` | Completed Clawd operations, actual encodes, hits, sum and maximum operation durations |
| `desktopTimings.requestMs` | Entire successful Desktop planned build request, shared across its targets |
| `desktopTimings.identityChecksMs` | All freshness checks, including the separately recorded source inspection and runtime verification |
| `desktopTimings.encodedCacheReadMs` / `encodedCacheWriteMs` | Planned encoded-cache storage operations; byte counters count returned or successfully stored payloads, excluding cache metadata |
| `desktopTimings.rendererQueueMs` / `rendererAcquisitionMs` | Waiting for the serialized host, and acquiring the fresh renderer including its native preparation |
| `desktopTimings.queuedRequestsAhead` | Number of outstanding host requests ahead when submitted, not encoder-worker queue depth |

Encoding operations overlap under concurrency and include cache/callback work.
`encodeMotions.peakPending` counts the initially queued Clawd asset operations;
`peakActive` counts simultaneously started asset operations, including cache hits.
Neither is a count of native codec threads. `capture.captureRoundtripMs` encloses
the awaited renderer call; native timings are nested inside it, not additive.
`nativeBoundsPreparationMs` covers bounds work inside capture only (not earlier
model loading), `nativeRenderMs` the capture draw (not pose/reset/cleanup draws),
and `nativeReadbackMs` pixel readback including row normalization.
`nativeMeasuredFrames` counts complete native timing triples; all native fields
are absent when unavailable. `alphaBoundsMs` measures the separate RGBA alpha
scan; `candidateAnalysisMs` measures difference scoring and retained pixel copies.
Capture metrics count new captures only, not decoded raw-cache frames.
Their summed duration is not encoding wall time; `stages.encode` is the enclosing
elapsed duration. Codex atlas encoding uses that stage and has no per-Motion
encoding operations. Raw-cache writes overlap the enclosing render stage; identity
checks can be nested inside renderer acquisition or encoded-asset callbacks.
Never sum these fields into total wall time. Reports retain fixed numeric fields,
not private Motion IDs or unbounded per-frame timing records. The benchmark also
records actual artifact download bytes/chunks, separately from capture payload.

See the [2026-09-20 checkpoint](../research/encoded-cache-checkpoint.md) for
qualified local measurements, the native-state parity finding and remaining
acceptance work.
