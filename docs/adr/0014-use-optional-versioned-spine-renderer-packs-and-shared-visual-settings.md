# Use optional versioned Spine renderer packs and shared visual settings

Date: 2026-09-03

## Status

Accepted

## Context

Live2Pet currently inspects and renders Live2D Source Packages through modern
and legacy adapters. Its Package Build services already consume transparent
RGBA frames and should not need a second target-specific pipeline for another
source format. Users also need to hide oversized backgrounds or decorations
that make a desktop pet appear too small.

Live2D and Spine expose different model structures. Live2D provides Parts and
part opacity, while Spine organizes drawables through Slots and Attachments.
Animation and pose updates may restore their authored values, and hiding a
large element without recomputing visible bounds does not fix framing.

The official Spine runtimes require the runtime `major.minor` version to match
the editor/export version. The current Live2D adapter uses PixiJS 6, while the
current official Spine Pixi integration uses a newer PixiJS line. Spine Runtime
licensing is also distinct from Live2Pet's Apache-2.0 license. Installing Spine
support for every user would therefore add cost, download, compatibility, and
licensing surface that most Live2D-only users do not need.

## Decision

Live2Pet will add renderer-neutral Visual Elements and Visual Settings before
adding Spine. The adapter lists stable element identities and applies one
atomic set of hidden identities. V1 maps Live2D Parts and Spine Slots to Visual
Elements. Project-hidden elements are reapplied after animation and pose
updates, participate in visible-bounds calculation, and are included in
capture-cache identity. Temporary Solo state is a preview aid and is not saved.

The Map preview owns a searchable Visibility drawer with show/hide, Solo, and
Restore all actions. Visual Settings are stored in the next project schema
revision with migration from existing projects, then used unchanged by Clawd
and Codex Package Builds. If a character and background share one ArtMesh or
Attachment, Live2Pet explains that runtime visibility cannot separate them;
source editing remains necessary.

Spine support will be a separate renderer adapter in an isolated renderer
realm behind the existing playback, stepping, bounds, and RGBA-capture
contract. V1 supports one pinned Spine `major.minor` line and the standard
folder shape: a skeleton `.json` or `.skel`, an `.atlas`, and referenced texture
pages. The supported line is selected from the first permitted validation
fixture; if no fixture establishes a requirement, implementation begins with
the current official 4.3 line. Unsupported export versions fail with an
actionable mismatch rather than invoking a universal loader.

Spine is an optional renderer pack. Import inspection detects a Spine source
before downloading anything. If the matching pack is absent, Source and Map
show one inline user action to download it; Settings also allows proactive
install, verification, and removal. A refusal or dismissal does not produce
repeated modal prompts and does not prevent resource inspection.

Every download requires an explicit click and uses a fixed HTTPS URL for an
exact version, a maximum byte limit, pinned SHA-256 or equivalent integrity
metadata, and an atomic install into App-private storage. Installed packs are
automatically reused. Live2Pet does not accept arbitrary runtime URLs,
model-supplied JavaScript, or silent first-run downloads.

The first bounded implementation spike evaluates the official `spine-player`
distribution as the pack implementation because it is available as versioned
web assets. If it cannot satisfy deterministic stepping, transparent capture,
or per-frame Slot visibility, the pack internally uses the official
`spine-pixi-v8` integration with its matching PixiJS version. That fallback
does not change project files, UI, build services, or the renderer contract.

Live2Pet code remains Apache-2.0. Optional Spine pack artifacts, notices, and
license obligations remain separate. Public source publication may include the
adapter interface and integration code, but public binary or pack distribution
is blocked until the Spine Runtime License and any required Spine Editor
license are reviewed for the exact packaging model.

## Consequences

- Preview, visible bounds, capture, and both targets share one persisted
  visibility decision instead of format-specific export controls.
- Oversized removable backgrounds no longer dictate pet framing.
- Live2D-only users incur no Spine download or setup cost.
- Supporting one explicit Spine version line keeps V1 testable but rejects
  otherwise valid assets exported by another Spine line.
- The isolated renderer realm avoids PixiJS conflicts and contains runtime
  crashes, at the cost of another internal renderer package and contract suite.
- Binary release remains a separate legal and packaging gate even when local
  personal-use acceptance succeeds.

## Alternatives considered

### Bundle Spine support for every installation

Rejected because most users do not need it and because it expands every binary
release's size, compatibility surface, and licensing obligations.

### Let users paste any runtime URL

Rejected because remote executable code would make model import a supply-chain
and reproducibility boundary.

### Mix Spine and Live2D into one PixiJS page

Rejected because their selected adapters require incompatible PixiJS lines and
would couple unrelated renderer failures.

### Hide output pixels after capture

Rejected because it cannot identify semantic model elements, does not correct
animation behavior, and gives preview/export parity only after expensive
capture.

### Support every Spine version and edit skins in V1

Rejected as disproportionate to the first usable path. More runtime lines,
skin selection, and attachment-level authoring require real user fixtures and
separate acceptance work.

## References

- Spine runtimes and license: <https://github.com/EsotericSoftware/spine-runtimes>
- Spine runtime versioning: <https://esotericsoftware.com/spine-versioning>
- Spine Player: <https://esotericsoftware.com/spine-player>
- Spine Pixi integration: <https://esotericsoftware.com/spine-pixi>
- Live2D model parameter and Part APIs: <https://docs.live2d.com/en/cubism-sdk-manual/parameters/>
