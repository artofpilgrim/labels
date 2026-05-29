# Hazard Label Studio

A browser-based editor for designing industrial hazard and safety labels (ANSI/ISO style) on an SVG canvas, then exporting them as crisp vector **SVG** or high-resolution **PNG**. Everything runs client-side — there is no backend, account, or upload; your work autosaves to the browser.

**▶ Live: https://artofpilgrim.github.io/labels/**

---

## Features

- **Layer-based canvas** — compose labels from text, rectangles, lists, lines, polygons, and official ISO 7010 hazard pictograms.
- **Ready-made templates** — ANSI Header, Side Bar, Tall Banner, ISO Plate, Stop sign, Lockout Tag, Barricade strip, and a Blank canvas.
- **Severity system** — Danger / Warning / Caution / Notice / Safety First; severity-bound layers recolor automatically when you switch.
- **Direct manipulation** — drag to move, handles to resize, rotate any layer; hold **Ctrl/⌘** while dragging to snap to other layers and the canvas.
- **Multi-select & arrange** — marquee or Shift-click, then align, distribute, duplicate, or delete as a group.
- **Constraints** — pin a layer's edges so it tracks the canvas on resize, and clip layers to the canvas's rounded shape.
- **Canvas tools** — pixel rulers, fit-to-viewport, cursor-anchored zoom (Ctrl/⌘ + scroll), and Space/middle-mouse panning.
- **Undo / redo** with a debounced history, plus reusable **user presets** saved locally.
- **Export** to SVG (vector) or PNG at 1×–4× scale. Pictograms are embedded as data URLs so exports are self-contained.

## Keyboard shortcuts

| Action | Shortcut |
| --- | --- |
| Undo | `Ctrl/⌘ + Z` |
| Redo | `Ctrl/⌘ + Shift + Z` (or `Ctrl/⌘ + Y`) |
| Delete selection | `Delete` / `Backspace` |
| Nudge | Arrow keys (`Shift` = 10px) |
| Deselect | `Esc` |
| Snap while dragging | hold `Ctrl/⌘` |
| Pan | hold `Space` + drag, or middle-mouse drag |
| Zoom | `Ctrl/⌘` + scroll |

## Tech stack

- [React 18](https://react.dev/) — UI, rendered to a single SVG document
- [Vite 5](https://vitejs.dev/) — dev server and production build
- No runtime dependencies beyond React; persistence via `localStorage`

## Getting started

Requires Node.js 18+ (CI builds on Node 20).

```bash
npm install      # install dependencies
npm run dev      # start the dev server (http://localhost:5173)
npm run build    # build to dist/
npm run preview  # serve the production build locally
```

## Project structure

```
labels/
├─ index.html              # Vite entry
├─ vite.config.js          # base '/labels/' for GitHub Pages; React plugin
├─ public/symbols/         # ISO 7010 pictogram SVGs (served as static assets)
└─ src/
   ├─ main.jsx             # React root
   ├─ App.jsx              # editor: state, undo/redo, drag/resize/snap, zoom/pan,
   │                       #         rulers, export, and all UI panels
   ├─ Label.jsx            # SVG renderer + layer factory + format presets
   ├─ symbols.js           # fetches + base64-caches the ISO symbol SVGs
   ├─ pictograms.js        # symbol manifest (id → file, name, code)
   ├─ uid.js               # short id generator
   └─ styles.css           # 4-zone app shell + component styles
```

## Deployment

Hosted on **GitHub Pages** as a project site under `/labels/`. The
[`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) workflow builds
the app and publishes `dist/` on every push to `main`, so deploys are automatic.

Because it's served from a sub-path, `vite.config.js` sets `base: '/labels/'`
for production builds (dev stays at `/`). The ISO symbol loader resolves files
through `import.meta.env.BASE_URL`, so the sub-path is handled transparently.

## Credits

Hazard pictograms are official **ISO 7010** plates sourced from
[Wikimedia Commons](https://commons.wikimedia.org/) (W-series warnings,
M-series mandatory, P-series prohibition).
