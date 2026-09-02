# Release checklist

This checklist separates a publishable source tree from a distributable
installer. Completing the source checks does not authorize a ready-to-run
macOS or Windows release.

## Source publication gate

- [ ] `LICENSE`, `NOTICE`, `SECURITY.md`, `CONTRIBUTING.md`, dependency
      inventory, and third-party notices are present and current.
- [ ] `pnpm test` passes with synthetic fixtures; opt-in renderer tests remain
      local and are not required by public CI.
- [ ] `pnpm typecheck` passes.
- [ ] `pnpm release:check` passes with no model, runtime, example, generated
      package, secret, token, binary, or unrelated absolute-path entry.
- [ ] `pnpm --filter @live2pet/desktop prepare:mapper` stages only the pinned
      browser assets and license notices.
- [ ] The source archive contains no `examples/`, `archive/`, `artifacts/`,
      `.pck`, `.lpk`, `.moc`, `.moc3`, `.webp`, or `.zip` input.

## Private macOS validation gate

- [x] The current x64 machine produces an unsigned `.app` with staged Mapper
      and skill resources, ASAR integrity metadata, an unpacked Sharp/libvips
      runtime, no prohibited character/runtime assets, and a passing packaged
      window smoke test.
- [ ] A clean current-machine user profile completes the personal-use V1 flow
      from runtime selection and model import through both ZIP downloads.

## Cross-architecture binary validation gate

- [ ] A clean arm64 account can select a permitted local runtime and model,
      inspect and preview it, save and recover a project, build both targets,
      preview and export both packages, use the skill, and explicitly install
      each package.
- [ ] A clean x64 account passes the same workflow.
- [ ] Native `sharp` loading works without globally installed helper tools.
- [ ] Keyboard order, focus, labels, progress announcements, errors, and
      reduced-motion behavior have been reviewed.

## Installer release gate

- [ ] Live2D's Expandable Application position is documented for the exact
      runtime/model distribution plan.
- [ ] Any required Live2D approval, signing identity, notarization, update
      channel, and privacy disclosures are recorded.
- [ ] Only after the previous items pass may Electron Forge makers and public
      installer publication be enabled.
