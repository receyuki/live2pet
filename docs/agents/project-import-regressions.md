# Project Import Regression Scenarios

Use the scenarios relevant to the change. Prefer synthetic fixtures; keep user models and copyrighted sample assets out of the repository.

## Project compatibility

- Open schema v1/v2 `.live2pet` documents, current `.l2p` documents, and `.l2pack` containers through the actual document service.
- Preserve Animation Recipes, Motion Mappings, and Visual Settings when the Source Package is unchanged. Opening must not rewrite the original project file.
- When fingerprint semantics change, establish equivalence from inspected source bytes and the selected model identity. Do not bypass review solely because motion names still match.
- Verify that changed source bytes or a different selected model still trigger the required review. Preserve a previously pending review until the user acknowledges it.
- Cover existing inspection caches as well as fresh inspections when adding compatibility metadata.

## Drag and drop

- While a build is active, all project-replacement routes must ask the user to finish or cancel it first. After completion, opening another project must clear the old package, generated preview, and Save/Install actions.

- Exercise drag-enter, drag-over, drop, and drag-leave, including nested drop targets and asynchronous opening.
- Verify project documents are opened once through the document service and are not inspected as model resources.
- Verify overlays clear after success, failure, cancellation, and a declined project replacement.
- Check the resulting page and available actions when opening succeeds, source files are missing, or resource review is required. Avoid overlapping import, preview, and review flows.

## Source Library continuity

- Search and sort catalog metadata without downloading model resources or rendering offscreen thumbnails.
- Retain selection and reusable thumbnails when navigating to Map and returning to the library.
- Keep normal library browsing reachable after opening a project; a repair to the resource-review flow must not remove that capability.
- Keep download and cache limits effective regardless of the active search or sort order.

## Asynchronous document ownership

- Direct and Source Library confirmation must use the same project defaults and retain the chosen Motion when entering Map.
- Return from Settings without losing the selected model or current project, and restore a usable keyboard focus target in both locales.
- Delay preview opening or playback, leave the page, then open another preview. Old completion callbacks and queued commands must not hide, close, or update the new owner's surface.
- Hide an adapter, then issue playback, seek, or visual-inspection commands. Its automatic ticker must remain stopped until explicitly active; paused playback and manual capture are separate states.

- Delay Save/Save As, edit the name, mappings, or Visual Settings, and complete the save. Only the submitted snapshot becomes the saved baseline; newer edits and undo/redo history survive.
- Repeated Save commands are coalesced while a save is in flight. Cancel/failure leaves the current document and recovery draft intact.
- Switch or reopen a project before Save returns. The old result must not change the new session's document, filename, dirty state, or draft.
- A recovery draft is cleared only if it matches the saved snapshot. Build requests, progress, and results are correlated by request ID, project ID, and snapshot SHA-256; stale events cannot attach to another request.
- Reject the same malformed `.l2pack` on both first and repeated opens. Validate cached copies too, and preserve successful concurrent openers when cleaning failed staging directories.
