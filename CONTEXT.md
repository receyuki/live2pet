# Live2Pet

Live2Pet turns user-supplied Live2D content into portable packages for agent-pet hosts. This glossary defines the language shared by its desktop application and command-line interface.

## Language

**Source Package**:
A user-selected collection containing one Live2D model and the resources needed to inspect its available animations.
_Avoid_: Resource pack, model pack, asset bundle

**Motion**:
A named animation available in a Source Package.
_Avoid_: Action, clip

**Expression**:
A named parameter overlay available in a Source Package that can be applied while a Motion plays.
_Avoid_: Emotion, face preset

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
A `.live2pet` JSON document that reconnects a Source Package to its Animation Recipes, Motion Mappings, Target Profiles, Render Presets, and package metadata without containing the source assets themselves. Generated Pet Packages are not editable project sources.
_Avoid_: Mapping file, project bundle

**Pet Package**:
A portable artifact containing rendered animations, target metadata, and the files required by a supported agent-pet host.
_Avoid_: Theme file, output ZIP

**Clawd Theme Package**:
A Pet Package that follows the Clawd on Desk theme contract.
_Avoid_: Clawd ZIP

**Codex Pet Package**:
A Pet Package that follows the official Codex custom-pet manifest and sprite-atlas contract.
_Avoid_: Codex skin, pet ZIP
