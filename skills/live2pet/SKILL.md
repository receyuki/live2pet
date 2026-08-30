---
name: live2pet
description: Use Live2Pet to inspect user-provided Live2D Source Packages, map Motions, build or validate Clawd Theme Packages and Codex Pet Packages, export artifacts, or explicitly install a package through the installed local runtime.
---

# Live2Pet

Live2Pet is a local-only bridge for turning a user-selected Live2D Source Package into a validated Pet Package. It is a thin client of the installed Live2Pet App/CLI: do not implement a second renderer, bundle Cubism Core, copy model assets into the skill, or send source bytes to a remote service.

## Before any operation

1. Locate the installed CLI. Prefer `LIVE2PET_CLI`, then a `live2pet` command on `PATH`, then the path provided by the App. Invoke it without a shell when using a programmatic client.
2. Run `live2pet version` and require `protocolVersion: 1` plus the operation needed for the request. If the version or capability check fails, stop and report the setup problem; do not guess a compatible command.
3. Keep user paths, bearer tokens, model bytes, runtime binaries, and generated ZIP bytes out of chat messages and logs. The CLI response is the presentation-safe source of progress, warnings, reports, and validation.

## Headless workflow

- Use `inspect` for a metadata-only Source Package catalog. It supports standard model directories and the documented uncompressed, unencrypted Destiny Child PCK shape.
- Use `project-validate` or `project-recover` for a reference-only `.live2pet` document.
- Use `package-build` with the documented transient build spec for headless builds. It must contain pre-captured RGBA inputs; the CLI does not locate or execute a runtime on behalf of an unconfigured skill. Use `--output` only for a portable export directory.
- Use `package-validate` after a build or when the user supplies an existing ZIP. Use `export` to copy a validated artifact without installing it.
- Use `cache-status` and `cache-clear` only when the user asks to inspect or manage the local build cache.

## Visual mapping

Visual mapping belongs in the shared three-column Mapper Session. Ask the host to start a short-lived loopback session for the selected Live2Pet Project and open its authenticated URL in the Codex browser. Never expose the session token in a message or reuse a session for another project. If the embedded browser is unavailable, fall back to the installed Electron App and continue with the saved project through the CLI.

## Installation boundary

Building or exporting never implies installation. Call `install` only after the user explicitly authorizes installation in the current request, pass the intended Target Profile and target root, and require the CLI's `--confirm-install` flag. If authorization is missing, explain what would be installed and stop before invoking the operation.

For the transient Package Build shape, read [`docs/specs/package-build-cli-input.md`](../../docs/specs/package-build-cli-input.md) when the repository checkout is available. The App, CLI, and this skill must continue to use the same Package Build service and target validators.
