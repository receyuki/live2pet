# Live2Pet

Turn Live2D models into portable packages for agent-pet hosts.

Live2Pet is an early-stage local desktop toolchain for loading Cubism models, previewing their original motions, mapping those motions to target-specific pet states, and building validated Clawd theme and Codex custom-pet packages. The current V1 milestone is deliberately limited to a personal-use macOS App.

## Components

- `apps/mapper/` — browser-based Live2D motion preview, Clawd mapping, user-configurable Clawd idle/tier behavior pools, Codex nine-row mapping, local Codex ZIP fallback build, shared-App Clawd Theme ZIP build, generated target previews, final-size Codex row playback, and explicit Desktop-App installation controls. The Mapper has no runtime CDN dependency: modern Core can be selected locally, and Cubism 2 preview requires a user-selected local `live2d.min.js`. Selected runtimes are saved only in the browser profile and restored on the next launch; the clear-saved control removes those local copies. Its first English/Chinese (`zh-CN`) locale layer is presentation-only and does not change project or package schemas.
- `packages/source-inspector/` — normalized Source Package inspection API and versioned `live2pet-inspect` CLI for standard Cubism directories and supported Live2D PCK files.
- `packages/project/` — reference-only `.live2pet` Project schema, reusable Motion-plus-Expression Animation Recipes, target Render Preset persistence, deterministic serialization, atomic file I/O, autosave recovery, source relinking, and review gating.
- `packages/runtime/` — user-provided Cubism runtime discovery, bounded validation, redacted diagnosis, persistent App-managed copies, and generation-aware selection metadata.
- `packages/renderer/` — versioned playback/capture contract, deterministic motion candidate sampling, copyright-safe synthetic renderer for CI, and automatic selection between the V1 Pixi modern and legacy adapters.
- `packages/frame-selection/` — deterministic motion-aware candidate deduplication and ordered frame selection for target atlases.
- `packages/package-build/` — cancellable project-target builds for Codex Pet and guide-shaped Clawd themes, including shared-renderer RGBA capture, target-owned Render Presets, verified candidate-frame and encoded-WebP cache reuse, path-free build provenance and concise build reports, generated-asset target preview plans, pre-package Target Profile validation, safe versioned artifact names, RGBA composition, Sharp WebP encoding, deterministic manifests, size limits, zip.js package creation, review gating, and integrity-checked bounded disk caches for derived build assets.
- `packages/cli/` — stable JSON CLI envelope over source inspection, runtime diagnosis, `.live2pet` project validation, shared Package Build from transient pre-captured inputs, ZIP package validation, export/install, and cache management.
- `packages/installation/` — explicit, conflict-aware installation for generated Codex Pet and Clawd Theme packages; building and downloading never install implicitly.
- `packages/app-host/` — typed IPC router, preload API, artifact download/install boundary, opaque native location handles, and hardened window defaults.
- `apps/desktop/` — Electron App with the default React/TypeScript/HeroUI interface: first-run Setup, Welcome, full-page Settings, and Source/Map/Build destinations. It saves projects, previews models, builds ZIPs, and explicitly installs generated artifacts without bundling user runtimes or models. The center column is the only Source Package preview; `apps/mapper/` remains a development reference, not the App entrypoint.
- `packages/clawd-target/` — guide-aligned Clawd Target Profile validation for states, sleep modes, fallbacks, and reactions.
- `packages/codex-target/` — Codex Pet V1 atlas geometry, nine-row mapping, frame-reference layout planning, RGBA composition, and package-shape validation.
- `packages/live2d-exporter/` — deterministic transparent-frame exporter and Live2D PCK unpacker.
- `docs/research/` — architecture, integration, and ecosystem research.
- `docs/agents/` — repository conventions consumed by engineering skills.

## Planning

- [`CONTEXT.md`](CONTEXT.md) — shared domain vocabulary.
- [`docs/adr/`](docs/adr/) — accepted architecture and product decisions.
- [`docs/specs/live2pet-v1.md`](docs/specs/live2pet-v1.md) — scoped personal-use V1 product and acceptance specification.
- [`docs/agents/project-workflow.md`](docs/agents/project-workflow.md) — save/recovery, source relinking, review gating, and project privacy rules.
- [`docs/plans/live2pet-v1-implementation-plan.md`](docs/plans/live2pet-v1-implementation-plan.md) — outcome-ordered remaining work, issue map, and verification gates.
- [`docs/dependency-inventory.md`](docs/dependency-inventory.md) — pinned runtime dependencies, native modules, and user-provided asset boundaries.
- [`docs/release-checklist.md`](docs/release-checklist.md) — source-publication, private macOS validation, and installer-release gates.

## Local-only data

Character models, rendered frames, theme examples, and release ZIP files are intentionally excluded from Git. They remain local under `examples/`, `.work/`, `archive/`, and `artifacts/` and are not part of the open-source repository.

Live2Pet does not grant rights to any imported model, texture, motion, or derived animation. Cubism Core is also kept local and is not redistributed by this repository.

The official modern Cubism Core download is available from [Live2D's SDK for Web page](https://www.live2d.com/en/sdk/download/web/). Cubism 2 Web runtime distribution was discontinued by Live2D; use a copy you are separately licensed to run for local development. Live2Pet does not download or redistribute either runtime.

## Development status

The core inspection, project, mapping, center-column source preview, target-build, progress, cache, validation, generated-preview, artifact-download, and explicit package-install seams are implemented in the default HeroUI App. Remaining V1 work includes actual target-host installation acceptance, shared model Visibility, optional versioned Spine support, and final macOS accessibility and release qualification.

Codex Skill integration, a hosted Mapper Session, a separate preview window, the official Cubism Web Framework bridge, Windows qualification, and public signed binaries are outside the V1 product. See the [implementation plan](docs/plans/live2pet-v1-implementation-plan.md) for the current order and close criteria.

## Local verification

Start the default Desktop App or build a local unsigned macOS bundle:

```sh
pnpm --filter @live2pet/desktop start
pnpm --filter @live2pet/desktop package:mac
pnpm --filter @live2pet/desktop smoke:mac
```

Start and package commands build the HeroUI assets and stage the internal rendering vendors automatically. The packaged App does not require a Vite server or a preview flag. `preview:shell` is retained as an alias for `start`.

For opt-in real-model Desktop acceptance, see [the local acceptance guide](docs/desktop-acceptance.md).

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
# Optional real-runtime smoke tests (local inputs only; never commit these paths)
LIVE2PET_MODERN_RUNTIME=/path/to/live2dcubismcore.min.js LIVE2PET_MODERN_SOURCE=/path/to/modern-model \
  node --test packages/renderer/test/modern-runtime.integration.test.cjs
LIVE2PET_CUBISM2_RUNTIME=/path/to/live2d.min.js LIVE2PET_CUBISM2_SOURCE=/path/to/destiny-child-model \
  node --test packages/renderer/test/legacy-runtime.integration.test.cjs
```

Inspection output is metadata-only: it contains relative resource identities, fingerprints, warnings, and Motion/Expression catalogs, not model bytes, runtime binaries, bearer tokens, or unrelated absolute paths. The browser preview uses the version-matched Pixi `@pixi/unsafe-eval` compatibility bundle and allows only generated `blob:` resource URLs under the existing strict CSP; it does not enable general `unsafe-eval`.
