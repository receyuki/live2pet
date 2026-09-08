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

## Build desktop Apps

```sh
pnpm --filter @live2pet/desktop package:mac
pnpm --filter @live2pet/desktop smoke:mac
```

The bundle is unsigned. Public distribution, signing, and notarization are separate release work.

Windows x64 must be packaged on Windows:

```sh
pnpm --filter @live2pet/desktop package:win
```

The `Desktop CI and release` GitHub Actions workflow runs verification on pushes and pull requests. A manual run builds a Windows x64 ZIP plus separate Intel and Apple Silicon macOS DMGs, verifying each native App before packaging. A `v*` tag that matches the version in `apps/desktop/package.json` publishes those files as the latest GitHub Release. It does not create signed installers.

## Releases

`apps/desktop/package.json` is the single source of truth for the Live2Pet
product version. Internal workspace package versions are not release versions.

Record user-facing changes under `Unreleased` in the root `CHANGELOG.md`. To
publish a version:

1. Set `apps/desktop/package.json` to the new semantic version.
2. Rename the relevant `Unreleased` content to a dated
   `## [X.Y.Z] - YYYY-MM-DD` section and restore an empty `Unreleased` section.
3. Commit and push those changes.
4. Create and push an annotated `vX.Y.Z` tag.

The release job rejects a tag that does not match the Desktop App version or
has no matching Changelog section. That section is prepended to GitHub's
automatically generated notes, and the three platform downloads plus
`SHA256SUMS.txt` are attached. Published releases are never overwritten; ship a
new patch version for a correction.

```sh
git tag -a v0.1.0 -m "Live2Pet 0.1.0"
git push origin v0.1.0
```

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

The release, stars, and license badges use live GitHub data through [Shields.io](https://shields.io/).

The README screenshot at `docs/assets/app-preview.png` was supplied and explicitly selected by the repository owner for the public README. It is a UI illustration, not a distributable model. Do not add its source model or runtime files.
