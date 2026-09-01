# Live2Pet

Turn Live2D models into portable packages for agent-pet hosts.

Live2Pet is an early-stage local desktop toolchain for loading Cubism models, previewing their original motions, mapping those motions to target-specific pet states, and building validated Clawd theme and Codex custom-pet packages. The current V1 milestone is deliberately limited to a personal-use macOS App.

## Components

- `apps/mapper/` — browser-based Live2D motion preview, Clawd mapping, user-configurable Clawd idle/tier behavior pools, Codex nine-row mapping, local Codex ZIP fallback build, shared-App Clawd Theme ZIP build, generated target previews, final-size Codex row playback, and explicit Desktop-App installation controls. The Mapper has no runtime CDN dependency: modern Core can be selected locally, and Cubism 2 preview requires a user-selected local `live2d.min.js`. Selected runtimes are saved only in the browser profile and restored on the next launch; the clear-saved control removes those local copies. Its first English/Chinese (`zh-CN`) locale layer is presentation-only and does not change project or package schemas.
- `packages/source-inspector/` — normalized Source Package inspection API and versioned `live2pet-inspect` CLI for standard Cubism directories and the supported Destiny Child PCK shape.
- `packages/project/` — reference-only `.live2pet` Project schema, reusable Motion-plus-Expression Animation Recipes, target Render Preset persistence, deterministic serialization, atomic file I/O, autosave recovery, source relinking, and review gating.
- `packages/runtime/` — user-provided Cubism runtime discovery, bounded validation, redacted diagnosis, persistent App-managed copies, and generation-aware selection metadata.
- `packages/renderer/` — versioned playback/capture contract, deterministic motion candidate sampling, copyright-safe synthetic renderer for CI, V1 Pixi modern/legacy adapters, automatic Cubism-generation adapter selection, a restartable isolated renderer-realm host, a loopback-confined asset server, and an experimental official Framework bridge seam.
- `packages/frame-selection/` — deterministic motion-aware candidate deduplication and ordered frame selection for target atlases.
- `packages/package-build/` — cancellable project-target builds for Codex Pet and guide-shaped Clawd themes, including shared-renderer RGBA capture, target-owned Render Presets, verified candidate-frame and encoded-WebP cache reuse, path-free build provenance and concise build reports, generated-asset target preview plans, pre-package Target Profile validation, safe versioned artifact names, RGBA composition, Sharp WebP encoding, deterministic manifests, size limits, zip.js package creation, review gating, and integrity-checked bounded disk caches for derived build assets.
- `packages/cli/` — stable JSON CLI envelope over source inspection, runtime diagnosis, `.live2pet` project validation, shared Package Build from transient pre-captured inputs, ZIP package validation, export/install, and cache management.
- `packages/skill-client/` and `packages/skill-manager/` — implemented Codex automation seams retained for post-V1 productization.
- `packages/installation/` — explicit, conflict-aware installation support retained as optional functionality; portable ZIP download is the V1 handoff.
- `packages/mapper-session/` — implemented authenticated browser-host seam retained for post-V1 Codex integration.
- `packages/app-host/` — typed IPC router, preload API, artifact download/install boundary, opaque native location handles, and hardened window defaults.
- `apps/desktop/` — Electron development App that loads the mapper, provides a separate sandboxed Live2D renderer window host, and builds/downloads artifacts without bundling user runtimes or models.
- `packages/clawd-target/` — guide-aligned Clawd Target Profile validation for states, sleep modes, fallbacks, and reactions.
- `packages/codex-target/` — Codex Pet V1 atlas geometry, nine-row mapping, frame-reference layout planning, RGBA composition, and package-shape validation.
- `packages/live2d-exporter/` — deterministic transparent-frame exporter and Destiny Child PCK unpacker.
- `docs/research/` — architecture, integration, and ecosystem research.
- `docs/agents/` — repository conventions consumed by engineering skills.
- `skills/live2pet/` — the existing thin Codex skill prototype, deferred from the personal-use V1 acceptance path.

## Planning

- [`CONTEXT.md`](CONTEXT.md) — shared domain vocabulary.
- [`docs/adr/`](docs/adr/) — accepted architecture and product decisions.
- [`docs/specs/live2pet-v1.md`](docs/specs/live2pet-v1.md) — scoped personal-use V1 product and acceptance specification.
- [`docs/specs/live2pet-skill-protocol.md`](docs/specs/live2pet-skill-protocol.md) — CLI handshake, skill boundaries, and authorization contract.
- [`docs/agents/project-workflow.md`](docs/agents/project-workflow.md) — save/recovery, source relinking, review gating, and project privacy rules.
- [`docs/plans/live2pet-v1-implementation-plan.md`](docs/plans/live2pet-v1-implementation-plan.md) — outcome-ordered remaining work, issue map, and verification gates.
- [`docs/dependency-inventory.md`](docs/dependency-inventory.md) — pinned runtime dependencies, native modules, and user-provided asset boundaries.
- [`docs/release-checklist.md`](docs/release-checklist.md) — source-publication, private macOS validation, and installer-release gates.

## Local-only data

Character models, rendered frames, theme examples, and release ZIP files are intentionally excluded from Git. They remain local under `examples/`, `.work/`, `archive/`, and `artifacts/` and are not part of the open-source repository.

Live2Pet does not grant rights to any imported model, texture, motion, or derived animation. Cubism Core is also kept local and is not redistributed by this repository.

The official modern Cubism Core download is available from [Live2D's SDK for Web page](https://www.live2d.com/en/sdk/download/web/). Cubism 2 Web runtime distribution was discontinued by Live2D; use a copy you are separately licensed to run for local development. Live2Pet does not download or redistribute either runtime.

## Development status

The core inspection, project, mapping, target-build, progress, cache, validation, generated-preview, and artifact-download seams are implemented. The remaining V1 work is to qualify saved modern and legacy runtimes with locally owned models, prove both generated ZIPs in their real target hosts, harden the long-build experience, and accept a locally built macOS App on a clean user profile.

The official Cubism Web Framework adapter, Codex skill/Mapper Session product surface, Windows qualification, automatic installation as the primary flow, and public signed binaries are explicitly post-V1. See the [implementation plan](docs/plans/live2pet-v1-implementation-plan.md) for the current order and close criteria.

## Local verification

```sh
pnpm test
pnpm typecheck
pnpm release:check
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

Inspection output is metadata-only: it contains relative resource identities, fingerprints, warnings, and Motion/Expression catalogs, not model bytes, runtime binaries, bearer tokens, or unrelated absolute paths. The browser preview uses the version-matched Pixi `@pixi/unsafe-eval` compatibility bundle and allows only generated `blob:` resource URLs under the existing strict CSP; it does not enable general `unsafe-eval`.
