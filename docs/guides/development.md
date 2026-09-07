# Development

[README](../../README.md) · [Contributing](../../CONTRIBUTING.md)

## Run locally

Requires Git, Node.js 22.12+, and pnpm 11.

```sh
corepack enable
pnpm install
pnpm --filter @live2pet/desktop start
```

## Verify changes

```sh
pnpm test
pnpm typecheck
pnpm release:check
```

## Build a macOS App

```sh
pnpm --filter @live2pet/desktop package:mac
pnpm --filter @live2pet/desktop smoke:mac
```

The bundle is unsigned. Public distribution, signing, and notarization are separate release work.

## Repository map

| Location | Responsibility |
| --- | --- |
| `apps/desktop` | Electron host and React/HeroUI interface |
| `packages/*` | Inspection, projects, runtimes, rendering, targets, builds, installation, CLI |
| `apps/mapper` | Development reference; not the production App entrypoint |

## References

- [V1 specification](../specs/live2pet-v1.md) and [implementation plan](../plans/live2pet-v1-implementation-plan.md)
- [Architecture decisions](../adr/)
- [Desktop acceptance](../desktop-acceptance.md)
- [Release checklist](../release-checklist.md)
- [Dependency inventory](../dependency-inventory.md)
- [Agent conventions](../../AGENTS.md)

## README maintenance

Keep both READMEs aligned and preserve their `runtime-setup` anchors. Keep detailed behavior in the user guides.

The release badge currently says **coming soon** because no GitHub Release exists. When publishing the first release, replace its image URL in both READMEs with:

```text
https://img.shields.io/github/v/release/receyuki/live2pet?include_prereleases&style=flat-square&color=9087ff
```

Stars and license badges use live GitHub data through [Shields.io](https://shields.io/).

The README screenshot at `docs/assets/app-preview.png` was supplied and explicitly selected by the repository owner for the public README. It is a UI illustration, not a distributable model. Do not add its source model or runtime files.
