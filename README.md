# Live2Pet

Turn Live2D models into portable packages for agent-pet hosts.

Live2Pet is an early-stage local toolchain for loading Cubism models, previewing their original motions, mapping those motions to target-specific pet states, and building validated local packages. The first planned Target Profiles are Clawd themes and Codex custom pets; the current functional prototype focuses on the Clawd workflow.

## Components

- `apps/mapper/` — browser-based Live2D motion preview, Clawd mapping, Codex nine-row mapping, and local Codex ZIP build prototype. The Mapper has no runtime CDN dependency: modern Core can be selected locally, and Cubism 2 preview requires a user-selected local `live2d.min.js`.
- `packages/source-inspector/` — normalized Source Package inspection API and versioned `live2pet-inspect` CLI for standard Cubism directories and the supported Destiny Child PCK shape.
- `packages/project/` — reference-only `.live2pet` Project schema, validation, target Render Preset persistence, deterministic serialization, atomic file I/O, autosave recovery, source relinking, and review gating.
- `packages/runtime/` — user-provided Cubism runtime discovery, bounded validation, redacted diagnosis, and restart-required settings metadata.
- `packages/renderer/` — versioned playback/capture contract, deterministic motion candidate sampling, copyright-safe synthetic renderer for CI, a temporary Pixi/Cubism browser adapter, and a loopback-confined asset server for user-provided runtime/model files.
- `packages/frame-selection/` — deterministic motion-aware candidate deduplication and ordered frame selection for target atlases.
- `packages/package-build/` — cancellable project-target builds for Codex Pet and guide-shaped Clawd themes, including shared-renderer RGBA capture, target-owned Render Presets, verified candidate-frame and encoded-WebP cache reuse, path-free build provenance and concise build reports, generated-asset target preview plans, pre-package Target Profile validation, safe versioned artifact names, RGBA composition, Sharp WebP encoding, deterministic manifests, size limits, zip.js package creation, review gating, and an integrity-checked bounded disk cache.
- `packages/cli/` — stable JSON CLI envelope over source inspection, runtime diagnosis, `.live2pet` project validation, shared Package Build from transient pre-captured inputs, ZIP package validation, export/install, and cache management.
- `packages/skill-client/` — dependency-free protocol client for the installed CLI, with version handshake, capability checks, typed failures, safe argument construction, and explicit install authorization.
- `packages/skill-manager/` — text-only, bounded, symlink-free Codex skill bundle validation, status reporting, and atomic install/upgrade support.
- `packages/installation/` — portable ZIP export plus explicit, conflict-aware, atomic installation with side-by-side and rollback semantics, and platform adapters for the documented Clawd and Codex user-data roots.
- `packages/mapper-session/` — loopback-only, token-authenticated, short-lived project session for a shared visual mapper host.
- `packages/clawd-target/` — guide-aligned Clawd Target Profile validation for states, sleep modes, fallbacks, and reactions.
- `packages/codex-target/` — Codex Pet V1 atlas geometry, nine-row mapping, frame-reference layout planning, RGBA composition, and package-shape validation.
- `packages/live2d-exporter/` — deterministic transparent-frame exporter and Destiny Child PCK unpacker.
- `docs/research/` — architecture, integration, and ecosystem research.
- `docs/agents/` — repository conventions consumed by engineering skills.
- `skills/live2pet/` — the thin Codex skill entrypoint that calls the installed CLI and routes visual work to a protected Mapper Session.

## Planning

- [`CONTEXT.md`](CONTEXT.md) — shared domain vocabulary.
- [`docs/adr/`](docs/adr/) — accepted architecture and product decisions.
- [`docs/specs/live2pet-v1.md`](docs/specs/live2pet-v1.md) — complete V1 product and engineering specification.
- [`docs/specs/live2pet-skill-protocol.md`](docs/specs/live2pet-skill-protocol.md) — CLI handshake, skill boundaries, and authorization contract.
- [`docs/plans/live2pet-v1-implementation-plan.md`](docs/plans/live2pet-v1-implementation-plan.md) — dependency-ordered work packages, issue map, verification gates, and milestones.

## Local-only data

Character models, rendered frames, theme examples, and release ZIP files are intentionally excluded from Git. They remain local under `examples/`, `.work/`, `archive/`, and `artifacts/` and are not part of the open-source repository.

Live2Pet does not grant rights to any imported model, texture, motion, or derived animation. Cubism Core is also kept local and is not redistributed by this repository.

The official modern Cubism Core download is available from [Live2D's SDK for Web page](https://www.live2d.com/en/sdk/download/web/). Cubism 2 Web runtime distribution was discontinued by Live2D; use a copy you are separately licensed to run for local development. Live2Pet does not download or redistribute either runtime.

## Development status

The mapper and exporter are functional prototypes. Source inspection now has a versioned normalized-manifest seam shared by the CLI and browser mapper, covering standard Cubism model directories and the tested uncompressed, unencrypted Destiny Child Cubism 2 PCK layout. Runtime setup, deterministic motion-aware frame selection, target-owned Render Presets with persisted project selection and path-free build provenance, verified candidate-frame cache reuse, generated-asset preview plans, Clawd and Codex target validation, Codex atlas packaging, guide-shaped Clawd theme packaging, an integrity-checked build cache, stable JSON CLI operations, portable export, explicit installation, and the dependency-free Codex skill protocol client are captured as reusable packages. The renderer package now also contains a temporary Pixi/Cubism browser bridge for a host-provided page; it intentionally does not bundle Cubism Core, models, textures, or a browser runtime. Sandboxed hosting, UI preview integration, App-installed skill management, and the distributable App remain subsequent work packages.

## Local verification

```sh
pnpm test
pnpm typecheck
node packages/source-inspector/bin/live2pet-inspect.cjs --input /path/to/source-package --pretty
node packages/cli/bin/live2pet.cjs version --pretty
node packages/cli/bin/live2pet.cjs inspect --input /path/to/source-package --pretty
node packages/cli/bin/live2pet.cjs runtime-diagnose --input /path/to/CubismCore.js --pretty
node packages/cli/bin/live2pet.cjs project-validate --input /path/to/project.live2pet --pretty
node packages/cli/bin/live2pet.cjs project-recover --input /path/to/project.live2pet --pretty
node packages/cli/bin/live2pet.cjs package-build --input /path/to/build-spec.json --output /path/to/exports --pretty
node packages/cli/bin/live2pet.cjs package-validate --input /path/to/package.zip --pretty
node packages/cli/bin/live2pet.cjs export --input /path/to/package.zip --output /path/to/export.zip --pretty
node packages/cli/bin/live2pet.cjs install --input /path/to/package.zip --target codex-pet --target-root /path/to/pets --confirm-install --pretty
node packages/cli/bin/live2pet.cjs cache-status --cache-dir /path/to/cache --pretty
node packages/cli/bin/live2pet.cjs cache-clear --cache-dir /path/to/cache --project-id my-project --pretty
node packages/cli/bin/live2pet.cjs skill-status --input skills/live2pet --pretty
node packages/cli/bin/live2pet.cjs skill-install --input skills/live2pet --target-root /path/to/codex/skills --confirm-install --pretty
node --test packages/skill-client/test/*.test.cjs
```

Inspection output is metadata-only: it contains relative resource identities, fingerprints, warnings, and Motion/Expression catalogs, not model bytes, runtime binaries, bearer tokens, or unrelated absolute paths.
