# Live2Pet

Live2Pet turns user-supplied animated 2D content into portable packages for agent-pet hosts. This glossary defines the language shared by its desktop application and command-line interface.

## Language

**Source Package**:
A user-selected collection containing one supported animated 2D model and the local resources needed to inspect and render its available animations. V1 recognizes Live2D and version-matched Spine 4.x source layouts.
_Avoid_: Resource pack, model pack, asset bundle

**Source Library**:
A local folder or public GitHub repository folder that may contain multiple Source Packages. Live2Pet scans at most two folder levels for candidates; a remote Source Package is downloaded only after the user selects it.
_Avoid_: Cloned repository, bundled examples

**Motion**:
A named animation available in a Source Package.
_Avoid_: Action, clip

**Expression**:
A named Live2D parameter overlay available in a Source Package that can be applied while a Motion plays. A renderer without Expressions exposes none rather than relabeling another concept.
_Avoid_: Emotion, face preset

**Visual Element**:
A stable, renderer-owned grouping that a user can show or hide without modifying the Source Package. V1 exposes Live2D Parts and Spine Slots through this common concept.
_Avoid_: Layer, mesh, background object

**Visual Settings**:
The project-scoped set of hidden Visual Element identities applied identically to source preview, bounds analysis, capture, and Package Builds. Temporary inspection actions such as Solo are not saved.
_Avoid_: Runtime settings, render preset

**Animation Recipe**:
A reusable visual definition that combines one Motion with an optional Expression. It is independent of output size and encoding.
_Avoid_: Render preset, animation asset

**Render Preset**:
A named, target-specific set of fixed framing, sampling, canvas, quality, and encoding rules used by a Package Build. V1 exposes supported presets rather than arbitrary render parameters.
_Avoid_: Animation recipe, advanced settings

**Motion Mapping**:
The user-confirmed associations between Animation Recipes and the behavior slots required by a Target Profile.
_Avoid_: Action mapping, state config

**Target Profile**:
The output contract that defines the required behavior slots, asset geometry, metadata, and package structure for one supported host.
_Avoid_: Export type, output adapter

**Package Build**:
One execution that transforms a Source Package and Motion Mapping into a validated Pet Package.
_Avoid_: Conversion, export job

**Live2Pet Project**:
A `.l2p` JSON document that reconnects a Source Package to its Animation Recipes, Visual Settings, Motion Mappings, Target Profiles, Render Presets, and package metadata without containing the source assets themselves. Legacy `.live2pet` files remain readable.
_Avoid_: Mapping file, project bundle

**Portable Project**:
An `.l2pack` ZIP container holding one `project.l2p` document and a copy of its selected Source Package. It excludes runtimes, caches, and generated Pet Packages.
_Avoid_: Pet Package, runtime bundle

**Pet Package**:
A portable artifact containing rendered animations, target metadata, and the files required by a supported agent-pet host.
_Avoid_: Theme file, output ZIP

**Clawd Theme Package**:
A Pet Package that follows the Clawd on Desk theme contract.
_Avoid_: Clawd ZIP

**Codex Pet Package**:
A Pet Package that follows the official Codex custom-pet manifest and sprite-atlas contract.
_Avoid_: Codex skin, pet ZIP
