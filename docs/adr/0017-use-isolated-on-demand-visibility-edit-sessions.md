# Use isolated on-demand Visibility edit sessions

Date: 2026-10-12

## Status

Accepted

## Decision

External desktop integrations reuse the existing Map/Visibility UI and preview
service in a separate single-use process through the
[Visibility edit v1 protocol](../guides/visibility-edit-protocol.md).
The editing process has a temporary user-data/session-data profile and a narrow
IPC surface. It cannot save normal projects, update recent/recovery state, build,
install packages or alter runtime settings. Configured runtimes are verified and
read without legacy migration. A caller-provided runtime must be the already
trusted fixed session file, not a model-bundled script.

An explicit Apply validates current copied assets and loaded element IDs before
touching the renderer, clears Solo, and publishes a bounded identity-preserving
result atomically without overwriting a previous result. Cancel, close and
startup/renderer errors never return applied settings. Session preview resources
are released before exit; no edit service stays resident.

Source library/import discovery, Source Package fingerprints, project formats,
and normal App workspace/navigation remain unchanged. The session entry point
accepts standard unpacked model copies, not LPK files. The integration owner is
responsible for model authorization, stale revision checks and updating its own
manifest. Live2Pet does not copy the external application's library/editor logic.
