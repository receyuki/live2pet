# Use `.l2p` projects and optional `.l2pack` containers

Live2Pet uses two representations of the same editable project. `.l2p` is a
UTF-8 JSON document and remains the default. Schema v3 identifies the document
with `format: "live2pet-project"` and stores the Source Package as a typed
relative or absolute location. Relative locations resolve from the project
directory. `.live2pet` schema v1/v2 documents remain supported and migrate in
memory without being renamed automatically.

`.l2pack` is a standard ZIP container for moving or sharing an editable project
with its selected model. Container version 1 contains `manifest.json`,
`project.l2p`, and `source/`. The manifest records file paths, sizes, and SHA-256
digests. The embedded project uses a relative source location. Opening a package
validates its version, bounds, paths, duplicate cross-platform names, and
digests before exposing an App-managed working copy.

The container includes one complete selected Source Package so unmapped
Motions and Expressions remain available for later editing. It does not include
Live2D runtimes, Spine renderer packs, caches, generated target packages, or an
entire Source Library. Text and model data use normal ZIP compression; formats
that are already compressed, including PNG, WebP, audio, PCK, and nested
archives, are stored without redundant compression.

Project schema and container structure are versioned independently. Generated
Clawd and Codex Pet package versions also remain independent and continue to be
stored inside their target manifests.
