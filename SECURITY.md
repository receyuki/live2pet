# Security policy

Live2Pet processes Live2D Source Packages and user-provided runtimes locally.
Treat every imported archive, JSON document, path, model resource, and Motion
name as untrusted input.

## Reporting a vulnerability

Please use a private GitHub Security Advisory for this repository when that
feature is available. If it is not available, contact the repository
maintainers privately through the GitHub account that owns
`receyuki/live2pet`; do not disclose an unpatched vulnerability in a public
issue. Include the affected commit, operating system, reproduction steps, and
the smallest synthetic input that demonstrates the problem. Do not attach
models, runtime binaries, bearer tokens, credentials, or other copyrighted
assets.

We will acknowledge a valid report, assess impact and affected release
boundaries, and publish a coordinated fix or mitigation when practical.

## Security boundaries

- Electron renderer code runs with Node integration disabled, context
  isolation, sandboxing, strict CSP, and a narrow typed preload bridge.
- Source inspection, Mapper Sessions, archive extraction, cache entries, and
  package installation enforce size, path-containment, and authorization
  limits.
- Cubism Core, legacy runtimes, models, textures, and generated character
  assets are user-provided and are not redistributed by this repository.
- Build reports, IPC responses, projects, and diagnostics must not contain
  absolute source paths, runtime bytes, model bytes, frame buffers, or tokens.

The public source tree may be published before a ready-to-run installer. The
release checklist keeps binary distribution blocked until the separate Live2D
Expandable Application review is cleared.

