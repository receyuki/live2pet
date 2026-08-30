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
- `packages/package-build/` — cancellable Codex Pet atlas builds and guide-shaped Clawd theme builds, including RGBA composition, Sharp WebP encoding, deterministic manifests, size limits, zip.js package creation, and an integrity-checked bounded disk cache.
- `packages/cli/` — stable JSON CLI envelope over source inspection, runtime diagnosis, `.live2pet` project validation, ZIP package validation, export/install, and cache management.
- `packages/installation/` — portable ZIP export plus explicit, conflict-aware, atomic installation with side-by-side and rollback semantics.
- `packages/mapper-session/` — loopback-only, token-authenticated, short-lived project session for a shared visual mapper host.
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

The mapper and exporter are functional prototypes. Source inspection now has a versioned normalized-manifest seam shared by the CLI and browser mapper, covering standard Cubism model directories and the tested uncompressed, unencrypted Destiny Child Cubism 2 PCK layout. Runtime setup, deterministic motion-aware frame selection, Clawd and Codex target validation, Codex atlas packaging, guide-shaped Clawd theme packaging, an integrity-checked build cache, stable JSON CLI operations, portable export, and explicit installation are captured as reusable packages; official renderer adapters, sandboxed hosting, target-preview integration, and the distributable App remain subsequent work packages.

## Local verification

```sh
pnpm test
pnpm typecheck
node packages/source-inspector/bin/live2pet-inspect.cjs --input /path/to/source-package --pretty
node packages/cli/bin/live2pet.cjs version --pretty
node packages/cli/bin/live2pet.cjs inspect --input /path/to/source-package --pretty
node packages/cli/bin/live2pet.cjs runtime-diagnose --input /path/to/CubismCore.js --pretty
node packages/cli/bin/live2pet.cjs project-validate --input /path/to/project.live2pet --pretty
node packages/cli/bin/live2pet.cjs package-validate --input /path/to/package.zip --pretty
node packages/cli/bin/live2pet.cjs export --input /path/to/package.zip --output /path/to/export.zip --pretty
node packages/cli/bin/live2pet.cjs install --input /path/to/package.zip --target codex-pet --target-root /path/to/pets --confirm-install --pretty
node packages/cli/bin/live2pet.cjs cache-status --cache-dir /path/to/cache --pretty
node packages/cli/bin/live2pet.cjs cache-clear --cache-dir /path/to/cache --project-id my-project --pretty
```

Inspection output is metadata-only: it contains relative resource identities, fingerprints, warnings, and Motion/Expression catalogs, not model bytes, runtime binaries, bearer tokens, or unrelated absolute paths.
