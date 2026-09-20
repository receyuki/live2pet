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
- Supplied frames, candidates or custom renderer instances bypass the planned
  fast path: a model digest alone does not identify those inputs.

Full encoded hits need no native view, captures, raw-frame decoding or encoding.
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
| `LIVE2PET_BENCH_RUNTIME` | A local matching Live2D runtime, copied into the test profile |
| `LIVE2PET_BENCH_REVISION` | Revision label for the report |

`LIVE2PET_BENCH_REPETITIONS` defaults to 3. `LIVE2PET_APP_EXECUTABLE` optionally
selects a packaged App. The harness preserves Visual Settings, creates mappings
only in memory and never saves over the input or installs a Pet Package. Current
automated real-model setup is Live2D; native Spine setup and cancel/retry benchmark
scenarios remain follow-up acceptance work for #19.

Each repetition clears only its isolated cache, then measures a cold multi-motion
Clawd build, warm rebuild, metadata-only change, one-Motion change and a subsequent
Codex build. Output settings remain Balanced. The test profile is removed on exit;
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
phase-specific preparation/bounds/cache/ZIP/memory instrumentation is still part
of #19; this harness does not claim to measure uninstrumented subphases.
