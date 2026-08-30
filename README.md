# Live2Clawd

Turn Live2D models into themes for Clawd on Desk.

Live2Clawd is an early-stage local toolchain for loading Cubism models, previewing their original motions, mapping those motions to Clawd states, exporting transparent animated WebP assets, and packaging a Clawd theme.

## Components

- `apps/mapper/` — browser-based Live2D motion preview and Clawd state mapper.
- `packages/live2d-exporter/` — deterministic transparent-frame exporter and Destiny Child PCK unpacker.
- `docs/research/` — architecture, integration, and ecosystem research.
- `docs/agents/` — repository conventions consumed by engineering skills.

## Local-only data

Character models, rendered frames, theme examples, and release ZIP files are intentionally excluded from Git. They remain local under `examples/`, `.work/`, `archive/`, and `artifacts/` and are not part of the open-source repository.

Live2Clawd does not grant rights to any imported model, texture, motion, or derived animation. Cubism Core is also kept local and is not redistributed by this repository.

## Development status

The mapper and exporter are functional prototypes. The current workflow supports standard Cubism model directories and the tested Destiny Child Cubism 2 PCK layout.
