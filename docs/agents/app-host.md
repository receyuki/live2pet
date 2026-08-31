# Desktop App host boundary

`@live2pet/app-host` is the Electron main/preload contract. It intentionally contains no Electron import, so protocol tests can run in CI without downloading a platform binary.

The main process creates one router and registers it on the fixed `live2pet:app` channel:

```js
const { ipcMain } = require('electron');
const { buildProjectTargets } = require('@live2pet/package-build');
const { createAppIpcRouter } = require('@live2pet/app-host');

const route = createAppIpcRouter({ buildProjectService: buildProjectTargets });
ipcMain.handle('live2pet:app', (_event, request) => route(request));
```

The preload exposes only the typed methods returned by `createAppPreloadApi`. Renderer code cannot access `ipcRenderer`, Node, filesystem paths, or child processes. The router owns the active Mapper Session handle and returns only its launch descriptor; the bearer token remains inside the host-side client closure.

`buildProject` is available when the main process injects the shared `buildProjectTargets` service. Its input is limited to a project, target inputs, metadata, and serializable build options; renderer callbacks and arbitrary services are not accepted. The response contains versioned progress events, a build summary, and short-lived artifact metadata, while RGBA buffers, spritesheet bytes, and ZIP buffers are deliberately omitted from that response. `getBuildArtifact` retrieves one artifact's bytes by its opaque id for an explicit UI download; the in-memory artifact store is cleared when the active session closes or a new build starts. Installation remains a separate explicit operation.

The shared Mapper uses the same seam for both target profiles. A Clawd build sends `framesByMotion` captured from the local Live2D preview, a project-owned metadata object, and the selected Render Preset; the App returns only the validated build summary and an opaque artifact handle. The Mapper's English/Chinese UI is presentation-only and does not alter the IPC schema or target contract.

`startMapperSession` accepts the same explicit options as `startMapperSessionHost` (`project`, `mapperPath` or `mapperHtml`, optional `mapperUrl`, and session lifetime). Only one session is active per App window. The host must call `closeMapperSession` when the mapping task ends.

This package is the seam for the future Electron Forge shell. The shell still needs to package local mapper dependencies and replace the prototype's development-relative scripts before it can be released as a runnable desktop installer.
