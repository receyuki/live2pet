# Live2Pet desktop shell

This Electron shell is the first desktop host for the shared mapper. It loads the local mapper page with a sandboxed, context-isolated window and exposes only the typed `window.live2pet` API from `@live2pet/app-host`.

The main process owns the Mapper Session host and resolves either the repository
Mapper during development or the staged Mapper bundle from `process.resourcesPath`
in a packaged build. Renderer requests cannot choose arbitrary mapper files,
invoke shell commands, or access the bearer token. Forge makers/signing are not
configured until the macOS source-release gates pass. `forge.config.cjs` records
the future packager resource path, but the Forge CLI is not a workspace
dependency yet because its current rebuild chain is rejected by the repository's
exotic-subdependency policy.

From the repository root, install workspace dependencies and run:

```text
pnpm --filter @live2pet/desktop start
```

Before a package build, stage the browser dependencies into a self-contained Mapper bundle:

```text
pnpm --filter @live2pet/desktop prepare:mapper
```

The staging step copies only Pixi, the Pixi Live2D adapter, and zip.js. It
rewrites the shared Mapper to use local `vendor/` paths and emits hashes and
third-party license notices. Cubism Core and legacy runtimes are never staged;
they remain user-provided and local.

The package does not include models, examples, or generated packages. Those
remain user-provided and local.
