# Copy user-provided runtimes into private App storage

Date: 2026-09-01

## Status

Accepted

## Context

Live2Pet must support both modern Cubism Core and the legacy Cubism 2 runtime without redistributing either runtime in the application. Keeping only the last selected external path makes the two runtime families overwrite each other, breaks when a download is moved, and repeatedly asks the user to resolve a concern the App can own locally.

## Decision

Live2Pet will keep a private runtime library under the Electron user-data directory.

When a user selects a JavaScript runtime or SDK directory, the runtime module will:

- validate the entrypoint and detect its runtime family from its contents;
- copy the validated entrypoint into App-owned storage;
- retain one active entry for modern Cubism generations 3–5 and one for Cubism 2;
- select the matching entry from the inspected Source Package generation; and
- migrate a valid schema-v1 external-path setting into the private library automatically.

The Mapper exposes one runtime picker rather than asking the user to classify a file. Runtime selection applies immediately and does not require an App rebuild or restart.

Runtime files remain user-provided. They are never committed, staged into the application bundle, embedded in a Live2Pet Project, copied into a generated Pet Package, or returned through App IPC. Clearing the runtime library is an explicit user action and removes the private copies.

## Consequences

- Moving or deleting the original download no longer breaks preview or Package Build.
- Modern and legacy Source Packages can be used in the same App installation without reconfiguration.
- The user-data directory contains proprietary files supplied by that user, so diagnostics and backups must continue to exclude their bytes and paths.
- A clean App profile still requires the user to obtain and select each runtime family once through its applicable license flow.
- Replacing a runtime family is explicit; Live2Pet does not silently download or update runtimes.

## Alternatives considered

### Keep external paths

Rejected because path lifetime and family switching repeatedly leak storage concerns into the user workflow.

### Bundle runtimes with Live2Pet

Rejected because it would turn a private user copy into redistribution by the project.

### Store runtime bytes in projects

Rejected because projects are reference-only, portable documents and must not become a runtime distribution mechanism.
