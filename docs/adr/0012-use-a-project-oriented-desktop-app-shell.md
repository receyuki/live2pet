# Use a project-oriented desktop App shell

Date: 2026-09-02

## Status

Accepted

## Context

The working Desktop App hosts the complete Live2Pet workflow, but the current
renderer presents source selection, runtime provisioning, cache management,
project controls, source inspection, mapping, and both target builds in one
long document. App-global configuration and project work therefore compete for
attention, and the packaged product still behaves like a web page placed inside
an Electron window.

The personal-use V1 still needs one dependable path from Source Package to an
installed Clawd or Codex package. Replacing Electron, the renderer contracts,
or the build services would not improve that outcome. The required change is
an application-level information architecture that separates setup, global
preferences, project work, and build results while preserving the proven
three-column mapping interaction.

## Decision

Live2Pet V1 will use a project-oriented desktop application shell with four
top-level states:

1. a skippable Setup Assistant shown on first launch;
2. a Welcome surface for recent projects, opening a `.live2pet` document, or
   importing a Source Package;
3. one project workspace with Source, Map, and Build destinations; and
4. an App-global, full-page Settings destination opened from the application
   toolbar, application menu, or the standard Settings shortcut.

The project window uses the platform title bar, an application toolbar, one
visible project destination at a time, and a compact status bar. The Map
destination preserves the three-column Motion/Expression library, Live2D
preview, and target Assignment layout. Source inspection moves to Source, and
build readiness, progress, generated preview, download, and installation move
to Build.

Settings owns:

- language, appearance, and reopen behavior;
- the App-managed modern and Cubism 2 runtime library;
- Clawd and Codex installation destinations and conflict policy; and
- aggregate build-cache status and explicit cache clearing.

Settings replaces the project workspace while it is open and uses its own
section navigation for General, Runtimes, Targets & Installation, and Storage.
It is not presented as a modal, sheet, or separate child window. Leaving
Settings returns to the project destination and state from which it was opened.

The Setup Assistant reuses the same runtime-settings model and controls rather
than maintaining a second provisioning implementation. It detects already
saved runtimes, accepts one or both runtime families, allows setup to be
deferred, and remains available from Help. When an opened model needs a missing
runtime, the project shows an actionable message that opens Settings at the
matching runtime entry and returns to the project afterward.

Generated-package installation remains user initiated. The Build destination
may offer an explicit **Build & Install** command that uses a previously saved
destination, but an ordinary Build or Download never installs implicitly.

The V1 production shell uses the React, TypeScript, Vite, and HeroUI v3
interface foundation defined by ADR 0013. This does not replace Electron, the
domain packages, renderer adapters, or build services. The current Mapper may
remain as an internal behavioral reference while the production destinations
are migrated behind the existing application-service boundaries.

## Interaction and visual rules

- Use HeroUI components and semantic theme variables for standard controls,
  system typography, interaction states, and light/dark appearance.
- Use neutral surfaces, one violet-blue brand accent, thin dividers, and a
  compact 4/8-point spacing rhythm instead of landing-page typography and card
  grids.
- Limit custom styling to the App shell, three-column workspace, Live2D canvas,
  playback timeline, and restrained product branding. Do not mix general UI
  component systems.
- Keep one primary action per destination and show an actionable reason for an
  unavailable action.
- Provide native application menus and standard Open, Save, Undo, Redo,
  Settings, and Build shortcuts.
- Keep long work observable and cancellable without blocking navigation.
- Use inline recovery for missing configuration, sheets or dialogs for
  destructive actions, and short non-blocking confirmation for success.
- Preserve keyboard focus, logical reading order, English and Simplified
  Chinese layout, sufficient contrast, and reduced-motion behavior.
- Optimize for desktop window sizes rather than presenting a mobile or website
  responsive hierarchy. Narrow windows may collapse secondary inspectors, but
  must not create a second product workflow.

## Consequences

- Runtime and cache controls leave the project toolbar and become discoverable
  App preferences.
- The first launch explains the only external prerequisite without asking the
  user to classify runtime generations manually.
- Source, mapping, and build states become easier to test independently while
  continuing to share one project and renderer session.
- The browser-loadable Mapper may remain an internal development surface, but
  it is not the V1 product navigation or acceptance target.
- Existing project, renderer, build, cache, and installation contracts remain
  valid; the redesign primarily changes presentation and App-owned settings.
- A runnable production shell preview made with real HeroUI components is
  reviewed before the existing workflow is migrated, reducing the risk of
  completing another unsuitable page layout.

## Alternatives considered

### Restyle the existing single page

Rejected because different colors and components would leave global settings,
project editing, and build activity mixed in one scrolling document.

### Use a permanent application sidebar around every project destination

Rejected for V1 because it would create a fourth column beside the established
three-column Map workspace. A compact toolbar destination control preserves
more space for animation preview and Assignment.

### Build a multi-window editor with detachable panels

Rejected because panel docking and cross-window state add complexity without
improving the single-project V1 workflow. Settings remains a full in-window
destination outside project navigation.

### Present Settings as a modal or child window

Rejected because runtime provisioning, installation destinations, and storage
management are durable application tasks that need stable navigation, enough
space for recovery guidance, and an uninterrupted first-run reuse path.
