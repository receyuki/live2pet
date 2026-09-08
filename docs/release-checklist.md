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
- [ ] The source archive contains no downloaded Spine renderer pack, proprietary
      Spine model, or generated derivative; public tests use only synthetic or
      explicitly redistributable fixtures.

## Private macOS validation gate

- [x] The current x64 machine produces an unsigned `.app` with the default HeroUI renderer and internal rendering vendors,
      ASAR integrity metadata, an unpacked Sharp/libvips
      runtime, no prohibited character/runtime assets, and a passing packaged
      window smoke test.
- [x] The default packaged HeroUI App passes the local modern-folder and legacy-PCK preview, mapping, save/reopen, recovery, both-target build, generated-preview, and runtime-reuse acceptance workflow. See `docs/desktop-acceptance.md` for scope and exclusions.
- [ ] A clean current-machine user profile completes the personal-use V1 flow
      from runtime selection and model import through both ZIP downloads.
- [ ] A profile without Spine support can inspect a supported Spine source,
      explicitly download the exact version-matched optional pack, verify its integrity,
      reopen without another download, and remove it from Settings.
- [ ] Local and public GitHub Source Libraries discover candidates within two
      levels; GitHub downloads only the selected model and respects the
      user-configured bounded LRU cache.
- [ ] A permitted local Spine fixture and a permitted Live2D fixture each pass
      shared visibility, preview, bounds, capture, and both-target build checks.

## Cross-architecture binary validation gate

- [x] The GitHub Actions release workflow produces a downloadable Windows x64
      ZIP plus Intel and Apple Silicon macOS DMGs from a clean locked install,
      without bundled user
      models or separately licensed runtimes.
- [x] Both native macOS builds pass the packaged-App smoke test before their
      architecture-specific DMGs are uploaded.

- [ ] A clean arm64 account can select a permitted local runtime and model,
      inspect and preview it, save and recover a project, build both targets,
      preview and download both packages, then explicitly install
      each package.
- [ ] A clean x64 account passes the same workflow.
- [ ] Native `sharp` loading works without globally installed helper tools.
- [ ] Keyboard order, focus, labels, progress announcements, errors, and
      reduced-motion behavior have been reviewed.

## Installer release gate

- [ ] Live2D's Expandable Application position is documented for the exact
      runtime/model distribution plan.
- [ ] The Spine Runtime License, any required Spine Editor license, notices,
      download host, and optional-pack distribution model are reviewed for the
      exact public binary; local V1 acceptance alone does not satisfy this gate.
- [ ] Any required Live2D approval, signing identity, notarization, update
      channel, and privacy disclosures are recorded.
- [ ] Signing, notarization, bundled third-party runtimes, and an automatic
      update channel remain blocked until their applicable checks above pass.
      Unsigned GitHub Releases must disclose their unsigned status and must not
      bundle user models or separately licensed runtimes.
