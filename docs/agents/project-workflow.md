# Live2Pet Project Workflow

The `.live2pet` document is the editable source of truth for a mapping session. It is a small, reference-only JSON document: it may record the selected Source Package path, source fingerprint, Animation Recipes, target mappings, Render Presets, package metadata, and rights notes, but it must never embed model bytes, textures, Motion or Expression files, Cubism runtimes, rendered frames, or built packages.

## Save and recovery

The Mapper provides an explicit Save action. A dirty browser session also writes a bounded, reference-only autosave draft to the browser profile. Recovery is offered when a valid draft is present; an invalid or oversized draft is discarded and never presented as recoverable. Accepting a recovery loads the validated project document and marks it dirty so the user can save it explicitly. Opening another project or saving the current project clears the superseded browser draft.

The project service writes the primary document atomically with restrictive local-file permissions. Browser-profile recovery is advisory: it never silently overwrites the primary project, installs a package, or copies Source Package and runtime bytes into the project directory. A future Electron host may move the same draft envelope to its project service, but the current Mapper keeps it local to the browser profile.

## Source relinking and review

Opening a project does not imply that its Source Package is still available. The Mapper compares the current inspected source fingerprint with the project reference:

- A moved Source Package with the same fingerprint can be relinked after successful inspection without invalidating recipes.
- A changed fingerprint preserves the project document but creates `sourceReview.required` and records the affected recipe ids. The Mapper must show this state and require an explicit review acknowledgement.
- A project with no recipes can remain buildable after a source change because there are no preserved dependencies to review; the normalized `sourceReview.required` value remains `false` for auditability.
- A missing, unsupported, or uninspected replacement source must not be accepted as a relink.

The acknowledgement records the current source fingerprint in `sourceReview.reviewedFingerprint` and clears `sourceReview.required`. It does not guess new semantic mappings. Until acknowledgement, every Package Build must fail with the typed `PROJECT_REVIEW_REQUIRED` error and identify the affected recipe ids where available.

These rules are shared by the App, CLI, Mapper Session, and Codex skill. UI copy may be translated, but project keys and error codes remain language-neutral. Source paths and fingerprints may be used locally for relinking; build reports and exported packages must continue to redact absolute paths.

## Verification

The project contract is covered by `packages/project/test/project.test.cjs`, including atomic save, newer-autosave recovery, stale-autosave suppression, same-fingerprint relinking, changed-source review, review persistence after reload, and the build gate. The desktop shell test keeps a minimal static check that the shared Mapper exposes recovery, relinking, source-review, and pre-build review seams.
