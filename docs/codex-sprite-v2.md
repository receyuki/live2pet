# Codex sprite V2 compatibility

## Verified host contract

The local Codex macOS client **26.901.20858** was inspected on 2026-09-03.
Its project-independent custom-pet loader accepts both sprite versions:

| Property | V1 | V2 |
| --- | --- | --- |
| `pet.json` field | `spriteVersionNumber: 1` (also the host default when absent) | `spriteVersionNumber: 2` |
| Static atlas dimensions | 1536 × 1872 | 1536 × 2288 |
| Grid | 8 columns × 9 rows | 8 columns × 11 rows |
| Cell dimensions | 192 × 208 | 192 × 208 |
| Animation rows | 9 | The same 9 |
| Additional cells | None | 16 static look directions, in rows 9 and 10 |

The host maps cursor angles clockwise from up in 22.5-degree steps to the
additional cells. These are **poses**, not two new animation states.

Evidence was read from the installed application's `app.asar`, specifically
`.vite/build/src-BXVxNf6C.js` (manifest and image validation) and
`webview/assets/app-initial-7a6c8787453d.js` (versioned grids and look-direction
selection). Public documentation reviewed during this change did not establish
this schema. This is a version-scoped compatibility finding, not a guarantee
about every future Codex release. No host source or built-in pet assets are
redistributed in this repository.

## Live2Pet behavior

- Desktop builds now explicitly request V2. Existing projects retain their
  nine confirmed animation mappings; no additional mapping is required.
- Following the approved compatibility-first scope, every look-direction
  cell contains the first captured idle pose. The UI clearly labels this as
  **neutral**, with no generated directional mouse following.
- This preserves atlas validity and avoids inventing gaze directions from
  unrelated motion frames. True directional control remains separate work
  requiring renderer controls and source-specific capability checks.
- Generated previews read both V1 and V2. V2 neutral output adds one static
  neutral-look preview choice alongside the nine animation choices.
- Package validation checks dimensions against the declared sprite version.
  Encoded-cache identities include the version and atlas geometry.
- The shared package-build API keeps its V1 default for existing callers;
  callers can request V2 through `options.spriteVersionNumber: 2`, or through
  `optionsByTarget['codex-pet'].spriteVersionNumber` in a project build.

## Verification

Regression tests encode a real static V2 WebP, check the sixteen copied idle
cells, reject mismatched versions/dimensions and unsupported versions, and
read the generated package through the Desktop preview path. A local-only
probe also passed generated V1 and V2 WebPs through the installed Codex
client's image-reader function; both were accepted with the matching version
and rejected with the opposite version. This did not install, upload, or
publish a pet to Codex.
