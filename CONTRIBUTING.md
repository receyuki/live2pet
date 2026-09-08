# Contributing to Live2Pet

Thank you for helping improve Live2Pet. The project is local-first: source
inspection, rendering, and package generation are expected to run on the
user's computer, and pull requests must not add user-provided model data.

## Before opening a change

1. Read [`AGENTS.md`](AGENTS.md), [`CONTEXT.md`](CONTEXT.md), the relevant
   architecture decision records, and the applicable package documentation.
2. Keep changes focused on one observable behavior. Make assumptions and
   trade-offs explicit in the pull request description.
3. Use synthetic fixtures for public tests. Do not commit models, textures,
   Motion or Expression files, Cubism Core, legacy runtimes, rendered frames,
   generated themes, or downloaded archives.

See the [developer guide](docs/guides/development.md) for local startup, packaging, and the repository map.

## Local verification

Install the pinned workspace dependencies with pnpm, then run:

```sh
pnpm test
pnpm typecheck
pnpm release:check
pnpm --filter @live2pet/desktop prepare:mapper
```

The Cubism 2 renderer integration test is opt-in and must use files that you
are licensed to run locally. Set `LIVE2PET_CUBISM2_RUNTIME` and
`LIVE2PET_CUBISM2_SOURCE` only in your local environment; never add those files
to the repository or CI artifacts.

## Code and documentation conventions

- Preserve the versioned contracts and typed error codes at package boundaries.
- Keep filesystem paths, runtime bytes, model bytes, bearer tokens, and frame
  buffers out of IPC responses, reports, snapshots, and logs.
- Add a focused test for a new behavior or failure mode. Prefer observable
  acceptance checks over implementation-specific call counts.
- Maintain the English and Simplified Chinese READMEs and user guides together.
  Issues and engineering documentation use English. Schema keys and error
  codes remain language-neutral.
- Record notable user-facing changes under `Unreleased` in `CHANGELOG.md`.
  Release preparation and tagging are documented in the developer guide.
- Update the relevant specification, plan, or agent guide when a contract or
  release boundary changes.

## Pull requests

Describe the user-visible outcome, affected packages, verification commands,
and any local-only or externally blocked acceptance step. Keep generated
packages and screenshots out of the pull request unless their provenance and
redistribution rights are documented and the release checklist permits them.
