# Live2Pet Project Workflow

The `.l2p` document is the editable source of truth for a mapping session. It is a small, reference-only JSON document: it records the selected Source Package location and fingerprint, Animation Recipes, target mappings, Render Presets, package metadata, and rights notes without embedding model bytes. Schema v3 stores `format: "live2pet-project"` and a typed relative or absolute `source.location`; the App resolves that location into the in-memory `source.path`. Schema v1/v2 and legacy `.live2pet` filenames remain readable.

An `.l2pack` Portable Project is a standard ZIP container with `manifest.json`, `project.l2p`, and one `source/` tree. The manifest uses its own `containerVersion`, lists the packaged files, and records their sizes and SHA-256 digests. `project.l2p` points to the packaged source with a relative location. Portable Projects include the selected model source but exclude Cubism runtimes, Spine renderer packs, caches, rendered frames, built packages, and unrelated Source Library models. Archive paths must be traversal-safe, free of symbolic links and cross-platform name collisions, and bounded before extraction.

An Animation Recipe is a reusable `{ id, motionId, expressionId }` reference; `expressionId` may be `null` to use the model's base Expression. Target Profiles keep their direct `motion:<id>` mappings and may add a `recipeMappings` object that assigns a recipe id to a slot. This keeps older projects readable while making the selected Expression durable across save/reopen and build. A recipe must reference the same Motion as its target slot, and one target must not request different Expressions for the same Motion because capture and cache reuse are Motion-scoped. The Mapper creates or reuses a safe recipe id when the user assigns the currently previewed Motion/Expression; clearing or replacing a mapping removes the slot's recipe reference.

## Save and recovery

Schema revision 3 keeps the project-scoped `visualSettings.hiddenElementIds`
introduced in revision 2 and replaces the stored source path with a typed
`source.location`. Revision 1 migrates to an empty hidden set without changing
its mappings; revisions 1 and 2 migrate their existing source path into the v3
in-memory shape. Only manual hide/show decisions are
persisted; temporary Solo preview state is excluded. Undo/redo includes visibility.
Preview and both Package Builds apply the same settings, and their canonical
digest separates dependent capture and encoded-asset cache entries. Restoring
visibility does not delete source files or unrelated cached assets.

The App provides explicit Save and Portable Project actions. A dirty renderer session also writes a bounded, reference-only autosave draft to its local profile. Recovery is offered when a valid draft is present; an invalid or oversized draft is discarded and never presented as recoverable. Accepting a recovery loads the validated project document and marks it dirty so the user can save it explicitly. Opening another project or saving the current project clears the superseded draft.

The project service writes the primary document atomically with restrictive local-file permissions. Local-profile recovery is advisory: it never silently overwrites the primary project, installs a package, or copies Source Package and runtime bytes into the project directory. Portable Projects are extracted only after validation into an App-managed working directory keyed by archive digest.

## Source relinking and review

Opening a project does not imply that its Source Package is still available. The Mapper compares the current inspected source fingerprint with the project reference:

- A moved Source Package with the same fingerprint can be relinked after successful inspection without invalidating recipes.
- A changed fingerprint preserves the project document but creates `sourceReview.required` and records the affected recipe ids. The Mapper must show this state and require an explicit review acknowledgement.
- A changed fingerprint resets model-owned hidden Part IDs to an empty set: they cannot safely refer to the replacement model. A same-fingerprint move preserves visibility. The original saved project is not overwritten; mappings still follow their existing review rules.
- A project with no recipes can remain buildable after a source change because there are no preserved dependencies to review; the normalized `sourceReview.required` value remains `false` for auditability.
- A missing, unsupported, or uninspected replacement source must not be accepted as a relink.

The acknowledgement records the current source fingerprint in `sourceReview.reviewedFingerprint` and clears `sourceReview.required`. It does not guess new semantic mappings. Until acknowledgement, every Package Build must fail with the typed `PROJECT_REVIEW_REQUIRED` error and identify the affected recipe ids where available.

These rules are shared by the App and CLI. UI copy may be translated, but project keys and error codes remain language-neutral. Source paths and fingerprints may be used locally for relinking; build reports and exported packages must continue to redact absolute paths.

## Verification

The project contract is covered by `packages/project/test/project.test.cjs`, including atomic save, newer-autosave recovery, stale-autosave suppression, same-fingerprint relinking, changed-source review, review persistence after reload, and the build gate. The desktop shell test keeps a minimal static check that the shared Mapper exposes recovery, relinking, source-review, and pre-build review seams.
