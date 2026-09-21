# Use Electron and a shared TypeScript core

Live2Pet will use Electron for the desktop application, Electron Forge for development and packaging, React and TypeScript for the interactive UI, and a pnpm TypeScript workspace for the domain, import, rendering, target, pipeline, and CLI modules shared with the Codex skill. Electron was selected because the proven preview and frame-export paths already depend on Chromium WebGL; using the same browser engine for interactive preview and deterministic rendering reduces visual drift. Electron Forge was selected as the maintained first-party path for platform makers and later signing/notarization integration. Tauri and a browser-only application were rejected for V1 because they would still require a separate Chromium or native rendering path, offsetting their smaller shell size and increasing cross-platform variance.

The larger application bundle is accepted. Electron integrations must use a narrow typed IPC surface, context isolation, and no renderer access to arbitrary filesystem or process APIs.

## Implementation update — 2026-09-21

The Electron and isolated-IPC decision remains in effect. The shipped UI uses
React/TypeScript; production service packages currently use CommonJS. Packaging
uses `@electron/packager`, with `create-dmg` for macOS installers, rather than
Forge makers. A Codex skill is not a shipped product surface. These implementation
choices supersede those details in the original paragraph, not the shared
Chromium rendering or isolation boundary. See [development](../guides/development.md)
for the current commands.
