# Use HeroUI for the desktop interface

Date: 2026-09-02

## Status

Accepted

## Context

Live2Pet needs a polished consumer-facing desktop interface without maintaining
its own general-purpose component library. The current Mapper proves the
workflow, but its hand-written HTML and CSS make the packaged application feel
like a web document and make visual consistency, interaction states, and
accessibility expensive to maintain.

The V1 interface must support English and Simplified Chinese, keyboard and
pointer input, light and dark appearance, long-running build feedback, a
three-column mapping workspace, and a full Settings destination. Its visual
language should feel friendly and refined rather than like an enterprise
dashboard or a dense professional editor.

## Decision

The production Desktop App interface will use React, TypeScript, Vite, HeroUI
v3, and the Tailwind CSS v4 foundation required by HeroUI. HeroUI is the only
general-purpose component system in the production renderer.

HeroUI components own standard controls and interaction behavior, including
buttons, tabs, inputs, selects, progress, toasts, tooltips, drawers, menus,
cards, surfaces, and form feedback. The App will use HeroUI's semantic theme
variables and built-in light, dark, focus, disabled, and reduced-motion states
instead of recreating them in local components.

Custom presentation is limited to product-specific surfaces:

- the Electron window and application-toolbar composition;
- the three-column Motion/Expression, Live2D Preview, and Assignment workspace;
- the Live2D canvas and playback timeline;
- a small set of Live2Pet brand tokens and restrained decorative backgrounds;
  and
- layouts that connect HeroUI controls to existing project, renderer, build,
  and installation services.

The default visual direction uses neutral dark surfaces with one violet-blue
brand accent. Translucency may distinguish navigation or selected controls,
but large-area glass, persistent glow, and decorative motion are not the base
design language. The model and generated assets provide the primary visual
character.

Settings is a full in-window destination, not a modal, sheet, or separate
window. It provides section navigation for General, Runtimes, Targets &
Installation, and Storage. Opening Settings preserves the current project
destination so the user can return to the same Source, Map, or Build context.
The first-run Setup Assistant reuses the same runtime controls in a dedicated
full-page flow.

The first implementation step is a small, runnable Electron preview built with
real HeroUI components. It must validate Vite packaging, the Electron content
security policy, English and Simplified Chinese layout, keyboard focus, dark
and light appearance, and the Map and Settings layouts before the existing
workflow is migrated.

## Consequences

- The prototype Mapper remains useful as a behavioral reference, but its
  hand-written control styling is not the production UI foundation.
- HeroUI v3, React 19 or newer, Tailwind CSS v4, and the necessary Vite
  integration become production renderer dependencies.
- The App does not mix Mantine, Fluent UI, React Spectrum, Material UI,
  shadcn/ui, or another general-purpose component system into the same shell.
- Local wrapper components are permitted only when they encode Live2Pet
  behavior or repeated product composition; they must not duplicate HeroUI
  primitives solely to restyle them.
- A real-component preview replaces generated concept artwork as the visual
  acceptance source.

## Alternatives considered

### Maintain a custom Aurora Soft Glass system

Rejected because the distinctive material treatment would require Live2Pet to
own basic components, interaction states, accessibility, and cross-platform
visual behavior.

### Mantine

Rejected for the production shell because it is comprehensive but its default
visual character is closer to a general-purpose web application than the
consumer experience selected for Live2Pet.

### Fluent UI or React Spectrum

Rejected for V1 because their established visual identities lean toward
Microsoft productivity or Adobe professional tooling. They remain useful
references, but mixing them with HeroUI would weaken consistency.

### Copy-based component kits

Rejected because copied components transfer long-term ownership of updates,
accessibility fixes, and visual consistency to this repository.
