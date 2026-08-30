# Live2Pet desktop shell

This Electron shell is the first desktop host for the shared mapper. It loads the local mapper page with a sandboxed, context-isolated window and exposes only the typed `window.live2pet` API from `@live2pet/app-host`.

The main process owns the Mapper Session host and pins its document path to the repository mapper. Renderer requests cannot choose arbitrary mapper files, invoke shell commands, or access the bearer token. The shell is intentionally a development scaffold: the mapper still references prototype-relative local dependencies, and Forge makers/signing are not configured until the macOS source-release gates pass. `forge.config.cjs` records future packager settings, but the Forge CLI is not a workspace dependency yet because its current rebuild chain is rejected by the repository's exotic-subdependency policy.

From the repository root, install workspace dependencies and run:

```text
pnpm --filter @live2pet/desktop start
```

The package does not include Cubism Core, a legacy runtime, models, examples, or generated packages. Those remain user-provided and local.
