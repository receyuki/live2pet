# Require a user-provided Cubism runtime

Date: 2026-08-30

## Status

Accepted

## Context

Live2Pet needs Cubism Core to preview and render Cubism 3 and newer models. [Cubism Core is proprietary and is not published on GitHub](https://docs.live2d.com/en/cubism-sdk-manual/cubism-core/); it is distributed through [Live2D's official SDK download flow](https://www.live2d.com/en/sdk/download/web/) after the downloader accepts the applicable license agreements. Bundling the runtime would add redistribution and release-license obligations to the application package.

## Decision

Live2Pet V1 will not bundle or silently download Cubism Core.

The App will:

- link to the official Cubism SDK for Web download page;
- let the user select a locally downloaded Cubism Core file or supported SDK directory;
- validate the selected runtime and record its local path and detected version in application settings; and
- keep the runtime out of Live2Pet projects, generated packages, diagnostics, and the source repository.

V1 will load the selected runtime on application startup. Changing the configured runtime requires an application restart; users never need to rebuild Live2Pet. The runtime executes only in a dedicated sandboxed render window, not in the main React UI, and communicates through a narrow typed IPC boundary.

The headless CLI used by the Codex skill will resolve the same application setting. It will fail with an actionable setup message when no compatible runtime is configured.

## Consequences

- Users must complete the official Live2D download and license-acceptance flow themselves.
- First-run setup has one additional step and must explain how to locate the required file.
- Changing the runtime requires an application restart in V1; restart-free hot swapping is deferred.
- Runtime compatibility checks and upgrade guidance become part of Live2Pet.
- Open-source releases and generated themes do not contain Cubism Core.
- This decision does not remove any Publication License Agreement or Expandable Application obligations that may apply to Live2Pet itself.

## Alternatives considered

### Bundle Cubism Core

Rejected for V1 because it requires explicit confidence in redistribution and publication rights before shipping binaries.

### Download Cubism Core silently

Rejected because the official flow requires the downloader to review and accept license agreements, and a moving latest-version URL would make builds less reproducible.

### Embed the official download flow in the App

Deferred because it increases compliance and maintenance scope without improving the core import, mapping, and build workflow.
