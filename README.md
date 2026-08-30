# Live2Pet

Turn Live2D models into portable packages for agent-pet hosts.

Live2Pet is an early-stage local toolchain for loading Cubism models, previewing their original motions, mapping those motions to target-specific pet states, and building validated local packages. The first planned Target Profiles are Clawd themes and Codex custom pets; the current functional prototype focuses on the Clawd workflow.

## Components

- `apps/mapper/` — browser-based Live2D motion preview, Clawd mapping, Codex nine-row mapping, and local Codex ZIP build prototype.
- `packages/source-inspector/` — normalized Source Package inspection API and versioned `live2pet-inspect` CLI for standard Cubism directories and the supported Destiny Child PCK shape.
- `packages/project/` — reference-only `.live2pet` Project schema, validation, deterministic serialization, and atomic file I/O.
- `packages/runtime/` — user-provided Cubism runtime discovery, bounded validation, redacted diagnosis, and restart-required settings metadata.
- `packages/renderer/` — versioned playback/capture contract, deterministic motion candidate sampling, and copyright-safe synthetic renderer for CI.
- `packages/frame-selection/` — deterministic motion-aware candidate deduplication and ordered frame selection for target atlases.
- `packages/package-build/` — cancellable Codex Pet atlas builds and guide-shaped Clawd theme builds, including RGBA composition, Sharp WebP encoding, deterministic manifests, size limits, and zip.js package creation.
- `packages/clawd-target/` — guide-aligned Clawd Target Profile validation for states, sleep modes, fallbacks, and reactions.
- `packages/codex-target/` — Codex Pet V1 atlas geometry, nine-row mapping, frame-reference layout planning, RGBA composition, and package-shape validation.
- `packages/live2d-exporter/` — deterministic transparent-frame exporter and Destiny Child PCK unpacker.
- `docs/research/` — architecture, integration, and ecosystem research.
- `docs/agents/` — repository conventions consumed by engineering skills.

## Planning

- [`CONTEXT.md`](CONTEXT.md) — shared domain vocabulary.
- [`docs/adr/`](docs/adr/) — accepted architecture and product decisions.
- [`docs/specs/live2pet-v1.md`](docs/specs/live2pet-v1.md) — complete V1 product and engineering specification.
- [`docs/plans/live2pet-v1-implementation-plan.md`](docs/plans/live2pet-v1-implementation-plan.md) — dependency-ordered work packages, issue map, verification gates, and milestones.

## Local-only data

Character models, rendered frames, theme examples, and release ZIP files are intentionally excluded from Git. They remain local under `examples/`, `.work/`, `archive/`, and `artifacts/` and are not part of the open-source repository.

Live2Pet does not grant rights to any imported model, texture, motion, or derived animation. Cubism Core is also kept local and is not redistributed by this repository.

## Development status

The mapper and exporter are functional prototypes. Source inspection now has a versioned normalized-manifest seam shared by the CLI and browser mapper, covering standard Cubism model directories and the tested uncompressed, unencrypted Destiny Child Cubism 2 PCK layout. Runtime setup, deterministic motion-aware frame selection, target validation, Codex atlas packaging, and guide-shaped Clawd theme packaging are captured as reusable packages; official renderer adapters, sandboxed hosting, target-specific validators, target-preview integration, and the distributable App remain subsequent work packages.

## Local verification

```sh
pnpm test
pnpm typecheck
pnpm --filter @live2pet/source-inspector exec live2pet-inspect --input /path/to/source-package --pretty
```

Inspection output is metadata-only: it contains relative resource identities, fingerprints, warnings, and Motion/Expression catalogs, not model bytes, runtime binaries, bearer tokens, or unrelated absolute paths.
