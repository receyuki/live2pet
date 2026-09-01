# Use Pixi for the personal-use V1 renderer

Date: 2026-09-01

## Status

Accepted

## Context

ADR-0006 selected the official Cubism Web Framework as the canonical modern renderer. Since then, Live2Pet has implemented and exercised a shared renderer contract, a Pixi-based modern adapter, a separate Cubism 2 adapter, an isolated Electron render realm, saved user-provided runtime handling, and the build capture path. It also has an experimental seam for a future official Framework adapter, but not a complete production bridge.

The first release has been narrowed to a personal-use macOS App. Replacing the working modern path before validating real target packages would add integration, packaging, and maintenance work without improving the current user outcome. The user-provided Cubism Core can still be the official Live2D runtime even when Live2Pet's integration layer is Pixi-based; “official Core” and “official Web Framework” are separate choices.

## Decision

For the personal-use V1:

- `PixiLive2dAdapter` is the production modern renderer integration for Cubism 3–5 models;
- `LegacyPixiLive2dAdapter` remains the isolated Cubism 2 integration;
- the App automatically selects between them from Source Package inspection;
- users provide and explicitly save compatible runtimes in App-managed local storage;
- both adapters remain behind the shared renderer contract and isolated render-realm boundary; and
- the official Cubism Web Framework bridge remains experimental, hidden from the required workflow, and does not block V1.

The official Framework may replace the modern adapter after V1 only when a concrete compatibility, maintenance, performance, or distribution requirement justifies the migration and the replacement passes the same renderer contract and real-model acceptance suite.

## Consequences

- V1 can focus on renderer reliability, target-host compatibility, and a complete App workflow rather than a second rendering integration.
- Modern models still execute a user-provided official Cubism Core; Live2Pet does not claim that the surrounding Pixi integration is first-party Live2D Framework code.
- The existing renderer contract preserves a future migration path without changing projects, mappings, Target Profiles, or Package Builds.
- Community adapter compatibility risk is accepted for a personal-use V1 and must be measured with locally owned modern fixtures.
- Runtime, model, and example-asset distribution boundaries remain unchanged.
- Public binary distribution remains a separate licensing and release decision.

## Alternatives considered

### Finish the official Framework adapter before V1

Rejected for the current milestone because it would delay the already working personal-use path and does not resolve the remaining target-host acceptance work.

### Expose both modern renderers in V1

Rejected because a renderer chooser would transfer implementation complexity to users and multiply acceptance combinations.

### Remove the official Framework seam

Rejected because the small existing adapter boundary is useful for a later evidence-driven migration and does not burden the required workflow when kept experimental.
