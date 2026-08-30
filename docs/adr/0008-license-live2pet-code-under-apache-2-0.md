# License Live2Pet code under Apache-2.0

Date: 2026-08-30

## Status

Accepted

## Context

Live2Pet is intended to publish its own source code while depending on components and user assets that retain separate licenses. The project does not need to use MIT, but it should have a familiar international open-source license with an explicit patent grant and clear notice obligations.

## Decision

Live2Pet's original project code will be licensed under Apache License 2.0.

The repository and release process will keep separate license and provenance records for:

- Live2D Cubism Framework components;
- user-provided Cubism Core and legacy runtimes;
- npm and native binary dependencies;
- imported Source Packages and generated derivative assets; and
- examples, which must use assets with explicit redistribution permission and remain excluded until that permission is documented.

An Apache-2.0 `LICENSE` and a third-party `NOTICE`/attribution process will be added before the first public source release.

## Consequences

- Contributors and downstream users receive the permissions and patent terms of Apache-2.0 for Live2Pet's own code.
- Apache-2.0 does not relicense third-party components, models, runtimes, or generated themes.
- Dependency review and generated-package provenance remain required.
- The public-source checklist must verify license headers, the dependency inventory, and excluded copyrighted examples.

## Alternatives considered

### MIT

Rejected because the project prefers the more explicit patent grant and notice structure of Apache-2.0.

### MPL-2.0

Rejected because file-level reciprocity is not a current project requirement.

### Defer the project license

Rejected because a clear license is needed before the repository can accurately call itself open source. Live2D publication review remains a separate binary-release gate.
