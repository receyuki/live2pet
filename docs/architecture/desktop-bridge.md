# Desktop bridge contract

The production preload is a dependency-free generated script. Its single maintained
implementation lives in `packages/app-host/src/preload-api.cjs`; the App Host tests
import that same factory. `apps/desktop/scripts/prepare-preload.cjs` embeds it into
`apps/desktop/preload.cjs` without runtime workspace imports or a bundler dependency.
The generated file remains checked in, and an executable regression checks that it
matches its source and runs with only Electron's sandbox-safe `require` available.

## Consolidation baseline

The previous production bridge, rather than the older test-only factory, defines
compatibility:

- `openGitHubLibrary(url)` wraps the URL in `{ url }` for the host router.
- Native Undo and Redo join the existing allowlisted application commands.
- Preview controls use the dedicated preview channel; no generic IPC access is exposed.
- Build events retain their bounded fields and request/project/snapshot identities.
- File paths come only from Electron's `webUtils.getPathForFile`.

The shared factory intentionally gains the production preview and capture-cache
methods and the corrected URL/Undo/Redo behavior. The renderer-facing API does not
change. Host-side request validation remains separate from preload event filtering.

Executable production tests cover project, model, runtime, build, output and install
envelopes, event filtering, idempotent cleanup, and denied arbitrary imports. Keep
Electron sandboxing, context isolation and the narrow bridge enabled; do not import
the Node App Host implementation from a sandboxed preload.
