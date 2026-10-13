# Renderer compatibility checkpoint — 2026-10-14

## Scope

Local macOS x64 Electron 44 checks against permitted RYutility model-library
copies and official Spine examples. No model bytes, optional runtimes, LPK
support, DragonBones support, source rewrites, push or Release publication.
Source Package fingerprints and project formats are unchanged.

## Already implemented before this checkpoint

- Version-matched optional Spine packs for 2.1, 3.5 JSON, 3.6, 3.7, 3.8 and
  4.0–4.3; exact deprecated 3.8.75 uses its separate compatibility reader.
- Legacy Mesh blend/tint/attachment-alpha synchronization, authored atlas
  coordinate preservation for downscaled textures, and atlas filtering.
- Official 3.8 straight-page GPU premultiplication, logical dimensions across
  Mesh UV recalculation, and independent framebuffer alpha blending.
- Shared preview/capture/Visual Settings and both pet-package targets.

## Reproduced and fixed here

| Problem | Before | Correction and check |
| --- | --- | --- |
| Official 4.x alpha policy | Unmarked real 4.1 atlas selected PMA; straight fixture read `[51,102,153,128]` instead of `[26,51,77,128]` | Explicit atlas-derived straight/PMA policy. All 4.0–4.3 fixtures now read `[26,51,77,128]`. Mixed-page policies are rejected before loading. |
| Official 3.8 region names | Exact lookup cannot resolve the authored `tiaodou ` name | Exact lookup first, then one unique trim-only alias with `SPINE_ATLAS_REGION_TRIMMED`. Ambiguous, case-different and missing names remain errors. |
| Modern Cubism Motion metadata | `resource-3.json` declared 465 curves but contained 464; requested Motion was absent from the loaded queue | Validate and shallow-copy stale count metadata in memory. Actual parser counts 464, 83 and 458 match all three malformed Motions; each builds both targets. |
| Failed model setup | A failed Visual Element initialization retained the Motion prototype hook | Failed load/setup and unload release the scoped hook and model; red/green regression covers post-load initialization failure. |
| Preview shutdown | Packaged 4.1 reopen/Cancel left a zero-byte Chromium preconnect socket alive after model unload | Close this renderer server's connections after stopping its listener. A real socket regression reproduces the old hang and passes after the fix. |

Capture identities changed to `pixi-live2d-capture-v10` and
`spine-player-capture-v5`; old rendered pixels are not reused. This does not
make an unchanged source model appear changed or require project migration.

## Actual model and package checks

The matrix covers 19 user-supplied models and two official examples. The modern
CurveCount model is additionally tested with two other malformed Motions.
Every model/Motion case captures visible RGBA pixels, checks controlled
play/pause/resume where duration allows, and builds validated Clawd and Codex
packages with ready generated previews and nonempty downloadable artifacts.

| Runtime/input | Samples |
| --- | --- |
| Cubism 2 | One current library model |
| Modern Cubism | One current library model; three malformed curve-count Motions |
| Spine 2.1.27 | Project QT binary model |
| Spine 3.5.51 | JSON model; binary remains unsupported |
| Spine 3.6.52 | Binary model |
| Spine 3.7.91 | Retained prior acceptance copy; original library entry is no longer present |
| Spine 3.8.75 | Deprecated binary model, with existing missing-attachment warnings |
| Official Spine 3.8 | .55/.79/.99 JSON and .69/.84/.95/.97/.99 binary models, including Claire, Crosscore, Sun Jian, Fu Shou and Secret Pie Airi |
| Spine 4.0.64 | Current library JSON model |
| Spine 4.1.11 | Current library binary cutscene model |
| Spine 4.2.22 | Official Spineboy JSON example |
| Spine 4.3 | Previously downloaded official Spineboy JSON example |

Additional quantitative checks:

- Eight distinct straight/PMA fixtures across 4.0–4.3; exact center-pixel
  readback, not screenshot inference. Straight variants also build both targets.
- All 1,210 Mesh attachments in ten official-3.8 sample runs retain identical
  UVs when recomputed against authored page dimensions (tolerance `1e-6`).
- Native 3.8 WebGL semitransparent blending reads `[25,51,76,128]`, within one
  channel value of `[26,51,77,128]`; alpha is not squared to 64.
- Real official 3.8 and 4.1 integration checks verify Slot hiding changes
  captured pixels and is retained in both target builds. The 3.8 check also
  exercises realtime play/pause/seek/resume and persistent hidden Slots.
- Before/after real 4.1 frame inspection agrees with the alpha-policy change.
- Input fingerprints remain identical after each matrix run.

The 4.2 example is fetched at immutable upstream revision
[`e7dc1435`](https://github.com/EsotericSoftware/spine-runtimes/tree/e7dc1435fa4a0083ab431f1b28e083c14a1f5c68/examples/spineboy/export),
not vendored or redistributed.

## Repeating the opt-in matrix

Build/stage the desktop renderer first. Provide already-verified private packs,
saved Cubism settings, and a JSON list of permitted local input folders:

```sh
LIVE2PET_SPINE_PACKS=/path/to/private/renderer-packs \
LIVE2PET_RUNTIME_SETTINGS=/path/to/settings/runtime.json \
LIVE2PET_PARITY_MODELS='[{"name":"My model","inputPath":"/path/to/model","modelConfig":"model.json","expectations":{"build":true}}]' \
node apps/desktop/scripts/accept-renderer-parity.cjs
```

The harness makes temporary source copies, checks source fingerprints, and
prints machine-readable `FIDELITY_CASE`/`FIDELITY_RESULT` observations. Optional
expectations include `motionId`, `expectedCurveCount`, `expectedPma` and
`expectedCenter`. Screenshots and copied inputs remain private temporary data;
do not publish them. Hidden views use controlled stepping because Chromium can
suspend rAF before a window is shown; this is not a realtime FPS benchmark.

## Limits and manual acceptance

- Sample success is not visual acceptance of every Motion, skin, export patch
  version or user model. Package validation is not actual target-host playback.
- Existing 3.8.75 missing-attachment warnings describe incomplete source data;
  a rendered preview does not mean the missing attachments were reconstructed.
- The separate requested Secret Pie Mei sample was not located by name; no
  acceptance claim is made for it.
- No new native Windows or Apple Silicon checks ran in this checkpoint.
- Modern Core support is not proof of individual Cubism 4/5 export coverage;
  the tested library model uses modern `.model3.json` settings.
- Optional Retina sizing and 3.8 mipmap enhancements remain out of scope.
  Legacy 2.1 Linear/Linear mipmaps and export pixel geometry were not changed.
- Original assets remain untouched, and user-facing Apps are not restarted.
