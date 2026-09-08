# Project Import Regression Scenarios

Use the scenarios relevant to the change. Prefer synthetic fixtures; keep user models and copyrighted sample assets out of the repository.

## Project compatibility

- Open schema v1/v2 `.live2pet` documents, current `.l2p` documents, and `.l2pack` containers through the actual document service.
- Preserve Animation Recipes, Motion Mappings, and Visual Settings when the Source Package is unchanged. Opening must not rewrite the original project file.
- When fingerprint semantics change, establish equivalence from inspected source bytes and the selected model identity. Do not bypass review solely because motion names still match.
- Verify that changed source bytes or a different selected model still trigger the required review. Preserve a previously pending review until the user acknowledges it.
- Cover existing inspection caches as well as fresh inspections when adding compatibility metadata.

## Drag and drop

- Exercise drag-enter, drag-over, drop, and drag-leave, including nested drop targets and asynchronous opening.
- Verify project documents are opened once through the document service and are not inspected as model resources.
- Verify overlays clear after success, failure, cancellation, and a declined project replacement.
- Check the resulting page and available actions when opening succeeds, source files are missing, or resource review is required. Avoid overlapping import, preview, and review flows.

## Source Library continuity

- Search and sort catalog metadata without downloading model resources or rendering offscreen thumbnails.
- Retain selection and reusable thumbnails when navigating to Map and returning to the library.
- Keep normal library browsing reachable after opening a project; a repair to the resource-review flow must not remove that capability.
- Keep download and cache limits effective regardless of the active search or sort order.
