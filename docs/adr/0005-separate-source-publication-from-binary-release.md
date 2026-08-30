# Separate source publication from binary release

Date: 2026-08-30

## Status

Accepted

## Context

Live2Pet is intended for personal use first and may later be open source. It can load an indefinite number of user-provided Live2D models, which may make the runnable application an Expandable Application under [Live2D's SDK release-license terms](https://www.live2d.com/en/sdk/license/expandable/). The open-source portions of the rendering framework and Live2Pet's own code have different distribution boundaries from the proprietary Cubism Core runtime and from a ready-to-run application release.

## Decision

Live2Pet may publish its source repository before a public binary release, subject to the following boundary:

- Cubism Core, copyrighted example models, generated examples, and other non-redistributable assets are excluded from the repository and release artifacts.
- Developers and personal users provide their own officially downloaded Cubism runtime when building or running the application.
- The project does not publish official ready-to-run macOS or Windows installers until Live2D has clarified and, where required, approved the Expandable Application release arrangement.
- Documentation distinguishes source availability, local development, personal use, and supported binary distribution.

## Consequences

- Open-source development can proceed without representing that public binary distribution has been cleared.
- Contributors need a local Cubism runtime for full preview and render tests.
- CI must separate tests that do not require proprietary runtime files from opt-in runtime integration tests.
- The release checklist has an external licensing gate before signing and publishing installers.
- This decision is an engineering release policy, not a legal opinion; the project still needs confirmation from Live2D before public binary distribution.

## Alternatives considered

### Publish source and installers together immediately

Rejected because user-provided Core does not by itself resolve the possible Expandable Application publication requirement.

### Keep the entire project private

Rejected because source publication can be separated from proprietary runtime redistribution and supported binary release.

### Wait for licensing clarification before writing any code

Rejected because Live2D permits development and evaluation before release, and the licensing gate can be enforced at the installer-publication stage.
