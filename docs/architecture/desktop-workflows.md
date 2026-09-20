# Desktop workflow boundaries

The existing Models → Map → Build navigation and App reducer remain the
coordination boundary. No new global state store or project schema is needed.

| Boundary | Owns |
| --- | --- |
| `ModelsView` | Source browsing, drag feedback, recent-project actions and library download presentation |
| `projectFromSource` | Identical editable document defaults for confirmed direct and library imports |
| `SettingsView` / `SetupView` | Runtime setup and page-local settings controls; persistent preferences remain App-owned |
| `usePreviewSession` | The current surface's resize observer, subscriptions, status polling and cleanup |
| `createPreviewSession` | Serialized preview operations and an owner token shared across Models and Map |

A disposed preview owner cannot submit commands or publish asynchronous
results. Opening a replacement takes command ownership immediately. Native
surface ownership changes only when its open command actually runs. Old
cleanup can release the previous surface while a replacement waits for layout,
but cannot touch a replacement that has already opened. Closing the last owner
releases the native preview. Model thumbnails remain lazy and use their existing
bounded cache independently of the live surface.

Renderer activity is distinct from playback intent. Hiding stops the automatic
render loop without changing whether playback should resume when shown. Pause
and non-looping completion stop the loop; manual stepping/capture never
implicitly grants foreground ownership. Live2D retains its 60 FPS foreground
limit; Spine keeps its existing runtime-driven timing. Deterministic capture
timing is unchanged for both renderers.

Regression checks use the App UI, renderer-facing IPC, document services and
renderer adapters. Real-model performance/visual acceptance remains opt-in;
synthetic tests do not prove native Windows or every third-party runtime.
