# On-demand Visibility editor protocol v1

External desktop applications can open Live2Pet's existing Visibility editor
without replacing the user's ordinary project. This is a local, single-use file
protocol, not an HTTP service or a permanently running companion.

## Launch and capabilities

Launch the installed executable with
`--live2pet-visibility-edit /absolute/session-directory/request.json`.
The macOS App advertises integer `Live2PetVisibilityEditProtocol=1` in its
`Contents/Info.plist`. Callers must check this before launching an older App.

The editor uses a private temporary Chromium/workspace profile, shows Visibility
and the real model preview directly, and reuses Motion/Expression controls,
Parts/Drawables/Slots, Solo, the tree and bounded lazy thumbnails. Mapping,
building, project saving/recovery, recent projects and runtime writes are not
available. Existing configured runtimes and pinned Spine packs are read-only.

## Input

The caller owns a private session directory (0700 on POSIX) and `request.json`
(0600). Model assets are verified **copies** under `source/`, not references to
the user's library. No LPK unpacking is performed by this editor.

```json
{
  "protocol": "live2pet-visibility-edit",
  "version": 1,
  "sessionId": "0123456789abcdef0123456789abcdef",
  "model": {
    "id": "fedcba9876543210fedcba9876543210",
    "revision": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "name": "Example",
    "format": "live2d",
    "generation": 3,
    "entry": "source/model.model3.json"
  },
  "visualSettings": { "hiddenElementIds": [] },
  "runtime": null
}
```

- IDs: 32 lowercase hex characters. Revision: the caller's 64-character
  lowercase SHA-256 revision; it is echoed, not substituted with Live2Pet's
  Source Package fingerprint. The caller must reject stale revisions.
- Live2D generations: 2 and 3. An optional already-trusted runtime is
  `{"generation":3,"path":"runtime/core.js"}`. It is checked for the matching
  Cubism signature and used only by this session, never imported into Settings.
- Spine: `format: "spine"`, no `generation`, `runtimeLine: "2.1"`, `"3.5"`,
  `"3.6"`, `"3.7"`, `"3.8"`, `"4.0"`, `"4.1"`, `"4.2"` or `"4.3"`,
  and `runtime: null`. A 3.5 entry must be JSON; binary 3.5 is rejected.
  Optional `initialSkin` is preserved in preview. The exact inspected export
  version selects the verified runtime; 3.8.75 uses its local compatibility
  pack without changing the source header. Missing atlas attachments and
  deprecated exports produce visible warnings, not silently altered assets.
- Entry and runtime paths are relative and confined to `source/` and the fixed
  `runtime/core.js`. Resource symlinks and traversal are rejected. Model scripts
  are not executed, nor are arbitrary runtime URLs accepted.
- Request and result: at most 64 KiB each. Hidden IDs: at most 4096 unique
  strings, 1–256 characters each, with no control characters.

## Result and lifecycle

Only **Apply and return** applies changes. It verifies the Source Package has
not changed, validates IDs against the loaded model, replaces temporary Solo
with persistent visibility, and atomically publishes `result.json` beside the
request. An existing result is never overwritten. The editor releases its
preview view, renderer and asset server, then exits and attempts to remove its
private profile. That profile lives inside the caller-owned session directory;
any late Chromium cache writes remain confined there. The caller owns final
cleanup of the entire session after the editor process has exited.

```json
{
  "protocol": "live2pet-visibility-edit",
  "version": 1,
  "sessionId": "0123456789abcdef0123456789abcdef",
  "modelId": "fedcba9876543210fedcba9876543210",
  "modelRevision": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "status": "applied",
  "visualSettings": { "hiddenElementIds": ["PartBG"] }
}
```

Cancel/close returns the same identity with `status: "cancelled"` and no visual
settings. A validated session with a startup/renderer error may return
`status: "error"` and a bounded `error: {code,message}` without paths or stacks.
Malformed requests may exit without a result. A hard process crash may leave no
result/profile cleanup; it is **unconfirmed**, never implicitly applied. The
caller should clean up that abandoned session after confirming the process ended.

The caller must match session ID, model ID and the **current** manifest revision
before atomically updating only hidden IDs. Assets, UUID, click mappings, random
pool membership and initial skin remain caller-owned and unchanged.

## Acceptance

Boundary tests: `node --test apps/desktop/test/visibility-edit-session.test.cjs`.
The opt-in `apps/desktop/scripts/accept-visibility-edit.cjs` exercises real
Cubism 2/3 and Spine in hidden windows with temporary model/runtime copies.
Provide `LIVE2PET_MODERN_SOURCE`, `LIVE2PET_CUBISM2_SOURCE`, `LIVE2PET_SPINE_SOURCE`,
`LIVE2PET_RUNTIME_SETTINGS` and `LIVE2PET_SPINE_PACKS`; optional
`LIVE2PET_APP_EXECUTABLE` tests the packaged executable. Playwright must be in
the developer's tool environment or `NODE_PATH`, not added to the App bundle.

`LIVE2PET_HEADLESS=1` suppresses windows/dock and disables background throttling
only for invisible acceptance. Normal integration launches remain interactive.
