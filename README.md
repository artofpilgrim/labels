# Hazard Label Studio

A browser-based editor for designing industrial hazard, safety, and chemical (GHS) labels (ANSI/ISO style) on an SVG canvas, then exporting them as crisp vector **SVG** or high-resolution **PNG**. Everything runs client-side — there is no backend, account, or upload; your work autosaves to the browser.

**▶ Live: https://artofpilgrim.github.io/labels/**

---

## Why?

For years, whenever I needed a warning or safety label I'd fire up Photoshop and
hand-make one from scratch, or put together a made-up one — every single time.
I got tired of repeating that slow, fiddly process. Hazard Label Studio is my
attempt to make it **quick, free, and open**: pick a template or a pictogram,
edit it in the browser, export, done — no Photoshop, no licences, no accounts.

## Features

- **Layer-based canvas** — compose labels from text, bullet lists, lines, and shapes (rectangle, circle/ellipse, triangle, diamond, pentagon, hexagon, star).
- **150+ pictograms** — a searchable library of **ISO 7010** safety signs (warning, mandatory, prohibition, safe-condition, fire), **GHS** hazard diamonds, and **ISO 7001** public-information symbols — plus upload your own image or SVG.
- **Ready-made templates** — ANSI Header, Side Bar, Tall Banner, ISO Plate, Stop sign, Lockout Tag, Barricade strip, GHS Chemical, PPE Required, Fire Point, First Aid, Prohibition, and a Blank canvas.
- **Severity system** — Danger / Warning / Caution / Notice / Safety First; severity-bound layers recolor automatically when you switch.
- **Direct manipulation** — drag to move, handles to resize, rotate any layer; hold **Ctrl/⌘** while dragging to snap to other layers and the canvas.
- **Multi-select & arrange** — marquee or Shift-click, then align, distribute, scale, rotate, reorder, duplicate, or delete as a group.
- **Constraints** — pin a layer's edges so it tracks the canvas on resize, keep it centered, and clip layers to the canvas's rounded shape.
- **Canvas tools** — pixel rulers, fit-to-viewport, cursor-anchored zoom (Ctrl/⌘ + scroll), Space/middle-mouse panning, and a right-click context menu.
- **Light & dark theme**, standard safety-color swatches, and slider-driven property controls.
- **Undo / redo** with a debounced history, plus reusable **user presets** saved locally.
- **Export** to SVG (vector) or PNG at 1×–4× scale, or copy the label to the clipboard as a PNG. Pictograms are embedded as data URLs so exports are self-contained.

## Keyboard shortcuts

| Action | Shortcut |
| --- | --- |
| Undo | `Ctrl/⌘ + Z` |
| Redo | `Ctrl/⌘ + Shift + Z` (or `Ctrl/⌘ + Y`) |
| Copy / Paste | `Ctrl/⌘ + C` / `Ctrl/⌘ + V` |
| Duplicate | `Ctrl/⌘ + D` |
| Select all | `Ctrl/⌘ + A` |
| Bring forward / to front | `Ctrl/⌘ + ]` / `Ctrl/⌘ + Shift + ]` |
| Send backward / to back | `Ctrl/⌘ + [` / `Ctrl/⌘ + Shift + [` |
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
├─ public/symbols/         # pictogram SVGs: ISO 7010, GHS, ISO 7001 (static assets)
└─ src/
   ├─ main.jsx             # React root
   ├─ App.jsx              # editor: state, undo/redo, drag/resize/rotate/snap,
   │                       #         zoom/pan, rulers, export, and all UI panels
   ├─ Label.jsx            # SVG renderer + layer factory + format presets
   ├─ symbols.js           # fetches + base64-caches the symbol SVGs
   ├─ pictograms.js        # symbol manifest (grouped: warning, prohibition,
   │                       #   mandatory, safe, fire, ghs, info)
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

Pictograms are official public-domain plates sourced from
[Wikimedia Commons](https://commons.wikimedia.org/):

- **ISO 7010** safety signs — W-series (warning), M-series (mandatory),
  P-series (prohibition), E-series (safe condition), F-series (fire).
- **GHS** hazard pictograms (the red-bordered chemical-hazard diamonds).
- **ISO 7001** public-information symbols.
