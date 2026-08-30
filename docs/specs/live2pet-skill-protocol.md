# Live2Pet Codex skill protocol

The Codex skill is a thin client of the installed Live2Pet CLI. It is not a second renderer or package builder. The skill may be shipped with the App or installed separately, but it must use the CLI that belongs to the selected App runtime.

## Discovery and handshake

The client resolves the CLI in this order: an explicit `LIVE2PET_CLI` path, a `live2pet` command on `PATH`, or the path supplied by the App. A programmatic client invokes a `.cjs`/`.js` entrypoint through the Node executable with `execFile` (no shell interpolation).

Before any operation other than `version`, the client calls:

```text
live2pet version
```

The response must have `protocolVersion: 1`, a non-empty `cliVersion`, and a `result.operations` array containing the requested operation. A mismatch stops the workflow with a typed compatibility error; the skill does not guess flags for another protocol.

## Supported headless operations

The client exposes typed methods over the current CLI operations:

| Skill method | CLI operation | Mutation boundary |
| --- | --- | --- |
| `inspect` | `inspect` | Read-only metadata inspection |
| `runtimeDiagnose` | `runtime-diagnose` | Read-only local runtime diagnosis |
| `projectValidate` / `projectRecover` | `project-validate` / `project-recover` | Read-only project checks |
| `packageBuild` | `package-build` | Writes only an explicitly selected export directory |
| `packageValidate` | `package-validate` | Read-only archive validation |
| `exportPackage` | `export` | Writes only the explicitly selected ZIP path |
| `cacheStatus` / `cacheClear` | `cache-status` / `cache-clear` | Cache inspection or user-requested cache deletion |
| `installPackage` | `install` | Requires `confirmInstall: true` and an explicit user authorization |

The Package Build input is the transient schema in [`package-build-cli-input.md`](package-build-cli-input.md). RGBA buffers are passed as temporary build-spec values and never returned in the skill response. The CLI's path-redacted response is the only output the skill should summarize to the user.

## Visual mapping boundary

Visual Motion Mapping is not performed by the headless client. The host starts an authenticated, short-lived Mapper Session for one Live2Pet Project and opens it in the Codex browser. The session is loopback-only, token-authenticated, Origin-checked, and has no general filesystem or command API. If a browser surface is unavailable, the host falls back to the Electron App and resumes through the saved project.

## Installation and licensing

Build and export never imply installation. The skill must explain the intended Target Profile and target root, receive explicit authorization in the current request, and then pass the CLI confirmation flag. It must not bundle or download Cubism Core, legacy runtimes, imported models, textures, or example themes. Those remain user-provided and separately licensed.
