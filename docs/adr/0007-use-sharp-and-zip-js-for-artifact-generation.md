# Use sharp and zip.js for artifact generation

Date: 2026-08-30

## Status

Accepted

## Context

The prototype conversion workflow relies on machine-specific command-line tools including `img2webp`, FFmpeg, ImageMagick, and the system `zip` command. A desktop App and its headless CLI must produce transparent animated WebP assets and package archives on macOS arm64/x64 and Windows x64 without requiring users to install those tools.

## Decision

Live2Pet V1 will use:

- [`sharp`](https://sharp.pixelplumbing.com/api-output/#webp) as the primary transparent animated WebP encoder and image-processing library; and
- [`@zip.js/zip.js`](https://github.com/gildas-lormeau/zip.js) as the package archive writer and reader.

The application pipeline passes rendered RGBA frames and explicit timing metadata to the encoder. Target Profile builders own target-specific resampling, frame counts, output dimensions, and package layout.

FFmpeg is not a required V1 runtime dependency. It may be evaluated later only for a demonstrated encoding feature that `sharp` cannot provide.

## Consequences

- Users do not need Homebrew, FFmpeg, ImageMagick, libwebp commands, or a platform `zip` executable.
- Electron packaging must keep the `sharp` native module and its platform binaries out of the application bundle where required and unpack them correctly from ASAR.
- Release CI must build and smoke-test each supported architecture independently.
- Encoder versions become part of build provenance so the same project can explain artifact differences after dependency upgrades.
- ZIP output and extraction must enforce path safety; extraction retains bounded resource limits.

### Clawd output update (2026-09-04)

The host's 80 MiB import limit is a compatibility warning, not a ZIP-generation
gate. Live2Pet preserves the generated artifact and reports the warning in the
build report and UI. This does not change Clawd's own import policy. Explicit
project-owned Clawd resolution, FPS, and WebP quality overrides may augment a
default preset; selecting a preset removes overrides. Other target geometry
constraints and archive extraction safety checks remain unchanged.

## Alternatives considered

### Bundle FFmpeg

Rejected as the default because it increases installer size and licensing/distribution complexity without a current requirement that justifies it.

### Call system-installed tools

Rejected because it makes the App dependent on machine-specific setup and does not provide a reliable Windows path.

### Implement WebP and ZIP directly

Rejected as unnecessary codec and archive complexity.
