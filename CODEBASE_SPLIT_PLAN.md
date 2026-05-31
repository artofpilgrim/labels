# Codebase Split Plan

## Summary

Split the current two large editor files into small, feature-owned modules without changing runtime behavior. `App.jsx` should become the shell/composition layer, and `Label.jsx` should become only the SVG renderer.

Current pressure points:
- `App.jsx` mixes state, UI primitives, panels, geometry, drag math, keyboard shortcuts, grid/zoom/pan, export, and properties.
- `Label.jsx` mixes rendering, geometry helpers, layer factory, format metadata, and all template builders.

## Target Structure

### `src/core/`

Pure non-React logic only.

Move stack helpers, design validation, geometry, resize math, snapping, pinning, coordinate conversion, export helpers, and constants here.

No component imports allowed.

### `src/templates/`

Move `FORMATS`, `PRESETS`, template builders, `newLayer`, `SHAPE_POINTS`, and template helper primitives here.

Keep templates in label/canvas units.

Export one stable surface:
- `FORMATS`
- `PRESETS`
- `newLayer`
- `starPoints`

### `src/renderer/`

Move `Label` and layer rendering functions here.

Keep `Label` responsible only for turning `design.layers` into SVG.

Move rectangle path/stroke helpers here only if they are renderer-specific; otherwise keep reusable geometry in `core`.

### `src/components/`

Move reusable UI primitives:
- `Field`
- `Section`
- `Row`
- `Seg`
- `NumberInput`
- `Slider`
- `ColorInput`

Move feature UI:
- Help modal
- Layer list
- Properties panel
- Symbol picker
- Format picker
- Export panel
- Canvas bottom bar
- Align toolbar

### `src/hooks/`

Move stateful editor behavior out of `App.jsx`.

Suggested hooks:
- history/undo
- keyboard shortcuts
- canvas viewport zoom/pan/rulers
- grid settings
- inline text editing
- clipboard/paste
- export status

### `src/styles.css`

Keep one CSS file for now.

Reorder sections to match component split only after JSX extraction is stable.

Do not create CSS modules in this pass.

## Implementation Order

1. **Baseline**
   - Run `npm run build`.
   - Manually note current behavior: create layer, drag, resize, rotate, pin-resize canvas, export, grid/smart snap, text edit, template apply.

2. **Extract Pure Core First**
   - Move pure helpers from `App.jsx`: stack helpers, `applyPins`, snap math, resize math, `layerAABB`, `niceStep`, slug/design validation.
   - Keep function names and signatures unchanged where possible.
   - Replace imports in `App.jsx`; no behavior changes.

3. **Extract Export And Persistence**
   - Move SVG/PNG export helpers into core/export.
   - Move localStorage keys and design/grid persistence helpers into core/persistence.
   - Keep `App.jsx` owning actual state.

4. **Split Templates From Renderer**
   - Move all template builders and layer factory code out of `Label.jsx`.
   - Keep `Label.jsx` importing only render-time helpers/constants.
   - Update imports in `App.jsx`, `Landing.jsx`, and renderer entrypoints.

5. **Split Renderer Internals**
   - Keep `Label` as the public component.
   - Move barcode/image/text/shape rendering helpers into renderer submodules if `Label` remains large after template extraction.
   - Preserve exported API: `Label`.

6. **Extract UI Components**
   - Move reusable controls first.
   - Then move self-contained feature panels: Help, SymbolPicker, PropertiesPanel, LayerList, ExportPanel, CanvasBottomBar.
   - Pass data and callbacks explicitly; do not move editor state into child components unless already local UI state.

7. **Extract Hooks**
   - Move keyboard handler, zoom/pan/ruler behavior, inline text editing, clipboard/paste, and history logic into hooks.
   - Keep `App.jsx` as the single owner of `design`, selection, preview, panels, and major callbacks.

8. **Final App Cleanup**
   - `App.jsx` should mostly contain top-level state composition, derived selections, callback wiring, and layout.
   - Target size: under roughly 700 lines.
   - `Label` renderer target: under roughly 350 lines after templates move out.

## Internal API Rules

- External app behavior and routes stay unchanged.
- Existing imports from `Label.jsx` should be replaced with narrower imports:
  - Templates from `src/templates`.
  - Renderer from `src/renderer/Label.jsx`.
  - Shared constants from `src/core/constants`.
- Pure core modules must not import React.
- Components may import core helpers, but core helpers must not import components.
- All coordinate conversion must go through shared helpers after extraction; avoid new inline `* fit` / `/ fit` math except inside those helpers.

## Test Plan

- Run `npm run build` after every extraction step.
- Manual regression checklist after each major phase:
  - Apply templates and verify layers render.
  - Add text, list, rect, shape, image, line, barcode.
  - Drag, resize, rotate single layer.
  - Multi-select, group drag, group resize/rotate.
  - Reorder layers from toolbar, keyboard, context menu, layer panel.
  - Resize canvas with pinned layers.
  - Grid snap, smart guides, Ctrl snap, Shift axis lock.
  - Inline text edit commit/cancel.
  - SVG export, PNG export, clipboard copy.
  - Landing page still renders template names.

## Assumptions

- This is a structure/refactor plan only, not a feature rewrite.
- Behavior should remain identical unless a regression is found and fixed during extraction.
- Keep JavaScript/React/Vite as-is; no TypeScript migration in this split.
- No CSS module migration in the first split.
