# Research

This directory contains English research and decision material for Live2Pet.

## Current conclusions

- Live2Pet should treat a standard Cubism model directory as its primary input and support format-specific importers, such as the tested Destiny Child PCK layout, as adapters.
- The conversion pipeline should render transparent RGBA frames at deterministic time steps, encode animated WebP, and generate a state-mapping manifest and Clawd theme package.
- The mapper should remain separate from model rendering and Codex state collection so each layer can evolve independently.
- Live2DViewerEX and VTube Studio are useful runtime adapters, but neither should define the conversion architecture.
- Codex integration should prefer documented lifecycle hooks, JSON event streams, or app-server interfaces over scraping private process state.
- Cubism Core, user-provided models, textures, motions, rendered character assets, and packaged example themes must not be redistributed by this repository without the appropriate rights.

## Planned documents

- Conversion architecture and supported input formats
- Motion-to-state mapping model
- Clawd theme packaging contract
- Runtime adapter comparison
- Codex lifecycle and approval integration
- Licensing and redistribution boundaries
- [Live2D runtime availability](live2d-runtime-availability.md)

Earlier Chinese research drafts are retained locally under the ignored `archive/research-zh/` directory. They must be translated and reviewed before any material from them is published here.
