# Use the official modern renderer with a legacy adapter

Date: 2026-08-30

## Status

Accepted

## Context

Live2Pet V1 must preview and render both modern Cubism Source Packages and tested legacy Destiny Child assets. The existing prototype uses `pixi-live2d-display`, whose stable release line is no longer an appropriate long-term base. Live2D maintains the [official Cubism Web Framework](https://github.com/Live2D/CubismWebFramework) for current Cubism models, while [Cubism 2.1 SDK downloads and updates ended in 2019](https://help.live2d.com/en/other/other_20/).

## Decision

Live2Pet will expose one internal renderer interface with two isolated implementations:

- the official Cubism Web Framework is the canonical implementation for Cubism 3, 4, and 5 models; and
- a replaceable legacy adapter handles Cubism 2.1 models and the tested Destiny Child input path.

The application selects the adapter after Source Package inspection. Preview, frame sampling, bounds calculation, and recipe rendering use the same application-level commands regardless of adapter. Modern and legacy runtimes execute in dedicated sandboxed render windows and do not execute in the main React UI.

The first legacy implementation may use an actively maintained community engine after a compatibility spike, but its package-specific API must remain behind the adapter boundary.

## Consequences

- Modern model support follows the currently maintained first-party framework.
- Cubism 2 compatibility risk and user-provided legacy runtime requirements stay isolated.
- Preview and export parity must be tested through a shared renderer contract suite.
- Two runtime paths increase integration testing, but removing or replacing legacy support does not require rewriting the project, mapping, or build layers.
- The old `pixi-live2d-display` prototype remains useful as a behavioral reference but is not the production renderer dependency.

## Alternatives considered

### Use one community engine for every Cubism generation

Rejected as the primary architecture because it would make modern support depend entirely on a third-party compatibility layer when a current official framework exists.

### Keep `pixi-live2d-display`

Rejected because its stable release line is stale relative to current Electron, Pixi, and Cubism releases.

### Drop Cubism 2 support

Rejected for V1 because the already-tested Destiny Child workflow is a core input case. Cubism 2 remains explicitly labeled legacy rather than defining the modern renderer architecture.
