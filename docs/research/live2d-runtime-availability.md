# Live2D Runtime Availability

Checked 2026-08-31 for the local-first Mapper and exporter.

## Modern Cubism Web runtime

Live2D publishes the current Cubism SDK for Web through its official download page. The page requires the user to read and accept the Live2D Proprietary Software License Agreement and the Live2D Open Software License Agreement before downloading. The Cubism Core file is intentionally not published in the public framework repository; it is distributed with the SDK package.

Live2Pet therefore treats modern `live2dcubismcore.min.js` as a user-provided runtime. It may be selected in the Mapper or diagnosed through the CLI, but it is not checked into this repository, copied into a generated package, or downloaded by the App.

Official references:

- [Cubism SDK for Web download](https://www.live2d.com/en/sdk/download/web/)
- [Cubism SDK for Web manual](https://docs.live2d.com/en/cubism-sdk-manual/cubism-sdk-for-web/)
- [Cubism SDK release license](https://www.live2d.com/en/sdk/license/)

## Cubism 2 Web runtime

The `live2d.min.js` runtime used by Cubism 2.1 is no longer in the current official SDK download flow. The official older-version list currently covers later Cubism SDK releases, not the legacy Cubism 2 Web runtime. Live2Pet does not fetch a community CDN copy or guess at an archived file.

Cubism 2 support remains available as an explicit local-runtime path: a user may select a copy they are separately licensed to use, and Live2Pet validates its size and recognizable signature before loading it into the isolated preview page. If no such file is available, inspection still works but legacy preview and rendering remain unavailable with an actionable message.

This boundary keeps the public source release free of proprietary runtime bytes and avoids treating a third-party mirror as an authoritative or redistributable source.

## Implementation consequences

- The CLI accepts a local runtime file or SDK directory through `runtime-diagnose`.
- The exporter requires `--runtime` for Cubism 2 and never falls back to a CDN.
- The browser Mapper loads the modern Pixi adapter without requiring Cubism 2, then loads the legacy Pixi adapter only after a user-selected Cubism 2 runtime passes validation.
- Runtime paths and bytes remain outside `.live2pet` projects, diagnostics, caches intended for export, packages, and Git history.
