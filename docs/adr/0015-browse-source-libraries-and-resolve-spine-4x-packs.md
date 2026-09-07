# Browse source libraries and resolve Spine 4.x packs

Date: 2026-09-07

## Status

Accepted; supersedes ADR-0014 only where it limited V1 to one Spine runtime line.

## Context

Real model collections commonly contain several Live2D or Spine projects under one folder. Public GitHub collections may be much larger than the model a user wants, so cloning the repository is wasteful. Spine exports also require a matching runtime `major.minor`; a single 4.3 pack cannot load valid 4.0, 4.1, or 4.2 exports.

## Decision

Live2Pet introduces a Source Library boundary. It discovers candidate Source Packages from a selected local folder or public GitHub tree URL, scanning at most two folder levels. GitHub browsing reads repository tree metadata without cloning. It downloads only the selected candidate's model folder, excluding nested folders that are themselves detected Source Packages.

Downloaded GitHub models live in App-private storage. The default cache limit is 1 GiB, the user may configure 256 MiB through 20 GiB in Settings, and least-recently-used entries are removed before the limit is exceeded. A single model is additionally limited to 4 GiB and 10,000 files. Clearing the cache requires an explicit user action.

Spine inspection accepts detected version lines independently of renderer availability. The optional pack resolver is the support gate. V1 provides pinned, integrity-checked official Spine Player packs for 4.0, 4.1, 4.2, and 4.3. Each pack is installed only after an explicit click and runs in the existing isolated renderer realm. Other lines remain recognizable but produce an actionable unsupported-runtime result until a reproducible official pack is added.

## Consequences

### Preview confirmation and project entry

Library selection and direct imports use the same preview inspector before creating a project. The inspector owns inventory, resource warnings, runtime recovery, and animation preview. **Use and start mapping** requires a ready preview and no missing required resources, creates the project, and enters Map with the selected Motion. Cancelling replacement keeps the current project and inspector. Returning from Settings preserves the selected candidate.

Successfully reopened projects enter Map directly; missing or changed sources retain the repair/review flow. Routine source details are available in a compact Map summary instead of an extra Models accordion. Autosave persists the current document without offering it for recovery during the same session; recovery is offered for a draft found at startup.

- Users can browse large local collections without repeatedly opening individual folders.
- A GitHub repository is never cloned and unselected model assets are not downloaded.
- Cache growth is bounded and controlled by the user.
- Valid Spine 4.0–4.3 exports can select their matching renderer without cross-version loading.
- GitHub API rate limits and repository tree truncation can still require a more specific folder URL.

## Alternatives considered

### Clone the repository shallowly

Rejected because Git still downloads unrelated repository objects and creates a larger, less predictable cache.

### Use one Spine runtime for every export

Rejected because Spine requires matching `major.minor` runtime and export versions.

### Accept arbitrary runtime download URLs

Rejected because model browsing must not become a remote-code execution path. Runtime packs remain allowlisted, pinned, and verified.

## References

- Spine runtime versioning: <https://esotericsoftware.com/spine-versioning>
- Official Spine runtimes: <https://github.com/EsotericSoftware/spine-runtimes>
- GitHub Trees API: <https://docs.github.com/en/rest/git/trees>
