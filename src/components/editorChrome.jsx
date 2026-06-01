import { useEffect, useId, useRef } from 'react';
import { isStackBoundary } from '../core/stack.js';
import { scaleRect } from '../core/coordinates.js';
import { K } from './ui.jsx';

// ----------- Layer-type glyph (for layer list rows) -----------
function LayerGlyph({ type }) {
  const stroke = 'currentColor';
  switch (type) {
    case 'rect': return <svg width="14" height="14" viewBox="0 0 14 14"><rect x="2" y="2" width="10" height="10" fill="none" stroke={stroke} strokeWidth="1.4"/></svg>;
    case 'text': return <svg width="14" height="14" viewBox="0 0 14 14"><text x="7" y="11" fontFamily="serif" fontSize="12" fontWeight="700" textAnchor="middle" fill={stroke}>T</text></svg>;
    case 'image': return <svg width="14" height="14" viewBox="0 0 14 14"><path d="M7 2 L12 11 L2 11 Z" fill="none" stroke={stroke} strokeWidth="1.4"/></svg>;
    case 'bullets': return <svg width="14" height="14" viewBox="0 0 14 14"><circle cx="3" cy="4" r="1.2" fill={stroke}/><line x1="6" y1="4" x2="13" y2="4" stroke={stroke} strokeWidth="1.4"/><circle cx="3" cy="10" r="1.2" fill={stroke}/><line x1="6" y1="10" x2="13" y2="10" stroke={stroke} strokeWidth="1.4"/></svg>;
    case 'line': return <svg width="14" height="14" viewBox="0 0 14 14"><line x1="2" y1="7" x2="12" y2="7" stroke={stroke} strokeWidth="1.6"/></svg>;
    case 'polygon': return <svg width="14" height="14" viewBox="0 0 14 14"><polygon points="7,2 12,11 2,11" fill="none" stroke={stroke} strokeWidth="1.4"/></svg>;
    case 'ellipse': return <svg width="14" height="14" viewBox="0 0 14 14"><ellipse cx="7" cy="7" rx="5.5" ry="4.5" fill="none" stroke={stroke} strokeWidth="1.4"/></svg>;
    case 'barcode': return <svg width="14" height="14" viewBox="0 0 14 14"><g fill={stroke}><rect x="2" y="3" width="1" height="8"/><rect x="3.8" y="3" width="2" height="8"/><rect x="6.6" y="3" width="1" height="8"/><rect x="8.4" y="3" width="1.6" height="8"/><rect x="11" y="3" width="1" height="8"/></g></svg>;
    default: return null;
  }
}

// Short, unambiguous labels for the blend badge (the full mode name stays in
// the tooltip). An explicit map avoids the collisions a naive truncation makes
// — color-dodge / color-burn / color all begin "colo".
const BLEND_ABBR = {
  multiply: 'mult', screen: 'scrn', overlay: 'ovr', darken: 'dark',
  lighten: 'lite', 'color-dodge': 'dodge', 'color-burn': 'burn',
  'hard-light': 'hard', 'soft-light': 'soft', difference: 'diff',
  exclusion: 'excl', hue: 'hue', saturation: 'sat', color: 'color',
  luminosity: 'lum', normal: 'norm',
};

function LayerBadges({ layer }) {
  const badges = [];
  const pins = layer.pinSides && Object.values(layer.pinSides).some(Boolean);
  if (isStackBoundary(layer)) badges.push(['base', 'base', 'Stack boundary']);
  if (layer.clipToCanvas) badges.push(['clip', 'clip', 'Clipped to canvas']);
  if (layer.blend) badges.push(['blend', BLEND_ABBR[layer.blend] || layer.blend, `Blend: ${layer.blend}`]);
  if (layer.opacity != null) badges.push(['opacity', `${Math.round(layer.opacity * 100)}%`, 'Opacity']);
  if (layer.hole) badges.push(['hole', 'hole', 'Transparent cutout']);
  if (layer.strokeOnTop) badges.push(['top', 'top', 'Stroke renders above the stack']);
  if (pins) badges.push(['pin', 'pin', 'Pinned to canvas']);
  if (!badges.length) return null;
  // Cap the visible chips and roll the rest into a "+N" badge (its tooltip
  // lists the hidden flags) so a flag is never silently clipped.
  const MAX = 4;
  const shown = badges.slice(0, MAX);
  const hidden = badges.slice(MAX);
  return (
    <span className="layer-badges" aria-label="Layer flags">
      {shown.map(([key, label, title]) => (
        <span key={key} className={`layer-badge ${key}`} title={title}>{label}</span>
      ))}
      {hidden.length > 0 && (
        <span className="layer-badge more" title={hidden.map(b => b[2]).join('\n')}>+{hidden.length}</span>
      )}
    </span>
  );
}

// ----------- Shape tools (Shapes panel) -----------
// Each adds a layer via addLayer(type); newLayer() builds the geometry.
const SHAPES = [
  { type: 'rect',     name: 'Rectangle', el: <rect x="2.5" y="3.5" width="11" height="9" fill="currentColor" /> },
  { type: 'ellipse',  name: 'Circle',    el: <ellipse cx="8" cy="8" rx="6" ry="5" fill="currentColor" /> },
  { type: 'triangle', name: 'Triangle',  el: <polygon points="8,2 14,14 2,14" fill="currentColor" /> },
  { type: 'diamond',  name: 'Diamond',   el: <polygon points="8,2 14,8 8,14 2,8" fill="currentColor" /> },
  { type: 'pentagon', name: 'Pentagon',  el: <polygon points="8,1.5 14.5,6.2 12,14 4,14 1.5,6.2" fill="currentColor" /> },
  { type: 'hexagon',  name: 'Hexagon',   el: <polygon points="8,1.5 14,5 14,11 8,14.5 2,11 2,5" fill="currentColor" /> },
  { type: 'star',     name: 'Star',      el: <polygon points="8,1.5 9.7,6 14.5,6 10.6,9 12,13.8 8,11 4,13.8 5.4,9 1.5,6 6.3,6" fill="currentColor" /> },
  { type: 'line',     name: 'Line',      el: <line x1="2.5" y1="13.5" x2="13.5" y2="2.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /> },
  { type: 'barcode',  name: 'Barcode',   el: <g fill="currentColor"><rect x="2" y="3" width="1.2" height="10"/><rect x="4" y="3" width="2.2" height="10"/><rect x="7" y="3" width="1" height="10"/><rect x="9" y="3" width="1.8" height="10"/><rect x="11.6" y="3" width="1.2" height="10"/></g> },
];

// ----------- Align toolbar glyph -----------
// One component draws all six align icons: a guide line on the chosen axis/edge
// plus two bars snapped to it. axis 'x' = horizontal align, 'y' = vertical.
function AlignIcon({ axis, pos }) {
  const G = pos === 'start' ? 2 : pos === 'center' ? 8 : 14;
  const place = (len) => pos === 'start' ? G + 1.5 : pos === 'center' ? 8 - len / 2 : G - 1.5 - len;
  const bars = axis === 'x'
    ? [{ x: place(9), y: 4, w: 9, h: 3 }, { x: place(6), y: 9, w: 6, h: 3 }]
    : [{ x: 4, y: place(9), w: 3, h: 9 }, { x: 9, y: place(6), w: 3, h: 6 }];
  return (
    <svg viewBox="0 0 16 16" width="18" height="18">
      {axis === 'x'
        ? <line x1={G} y1="2" x2={G} y2="14" stroke="currentColor" strokeWidth="1.4" />
        : <line x1="2" y1={G} x2="14" y2={G} stroke="currentColor" strokeWidth="1.4" />}
      {bars.map((b, i) => <rect key={i} x={b.x} y={b.y} width={b.w} height={b.h} rx="1" fill="currentColor" />)}
    </svg>
  );
}

function FlipIcon({ axis }) {
  if (axis === 'h') return (
    <svg viewBox="0 0 16 16" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.2">
      <line x1="8" y1="2" x2="8" y2="14" strokeDasharray="2 1.5" />
      <path d="M6.4 4.5 L2.6 8 L6.4 11.5 Z" fill="currentColor" stroke="none" />
      <path d="M9.6 4.5 L13.4 8 L9.6 11.5 Z" fill="currentColor" stroke="none" />
    </svg>
  );
  return (
    <svg viewBox="0 0 16 16" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.2">
      <line x1="2" y1="8" x2="14" y2="8" strokeDasharray="2 1.5" />
      <path d="M4.5 6.4 L8 2.6 L11.5 6.4 Z" fill="currentColor" stroke="none" />
      <path d="M4.5 9.6 L8 13.4 L11.5 9.6 Z" fill="currentColor" stroke="none" />
    </svg>
  );
}

// ----------- Selection / drag handles (DOM overlay) -----------
const HANDLE_POSITIONS = [
  ['nw', 0, 0], ['n', 0.5, 0], ['ne', 1, 0],
  ['e', 1, 0.5], ['se', 1, 1], ['s', 0.5, 1],
  ['sw', 0, 1], ['w', 0, 0.5],
];

function Handles({ box, fit, onHandleDown, kind, rotation = 0, onRotateDown, cornersOnly, showOutline = true }) {
  // box in label coords {x,y,w,h}; positions in DOM coords (×fit). Everything
  // lives in a box-sized wrapper rotated about its centre so the outline and
  // handles track a rotated layer's edges. The wrapper is pointer-events:none
  // (it spans the box and would otherwise swallow canvas clicks); the handles
  // re-enable pointer events via CSS.
  const { left: px, top: py, width: pw, height: ph } = scaleRect(box, fit);
  return (
    <div
      style={{
        position: 'absolute',
        left: px, top: py, width: pw, height: ph,
        transform: rotation ? `rotate(${rotation}deg)` : undefined,
        transformOrigin: 'center',
        pointerEvents: 'none',
      }}
    >
      {showOutline && <div className={`sel-outline ${kind}`} style={{ left: 0, top: 0, width: pw, height: ph }} />}
      {(cornersOnly ? HANDLE_POSITIONS.filter(([n]) => n.length === 2) : HANDLE_POSITIONS).map(([name, fx, fy]) => (
        <div
          key={name}
          className={`handle handle-${name} ${kind}`}
          style={{ left: fx * pw, top: fy * ph }}
          onPointerDown={e => onHandleDown(e, name)}
        />
      ))}
      {onRotateDown && (
        <>
          <div className="rotate-stem" style={{ left: pw / 2, top: -22 }} />
          <div className="handle-rotate" style={{ left: pw / 2, top: -22 }}
               onPointerDown={onRotateDown} title="Rotate (hold Shift for 15°)" />
        </>
      )}
    </div>
  );
}

// ----------- Help / workflows dialog -----------
function HelpModal({ onClose }) {
  const dialogRef = useRef(null);
  const titleId = useId();
  useEffect(() => {
    // Capture the trigger BEFORE moving focus, so we can restore it on close.
    const prevFocus = document.activeElement;
    const dialog = dialogRef.current;
    if (dialog) dialog.focus();   // move focus into the dialog on open
    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); return; }
      // Trap Tab inside the dialog — aria-modal alone doesn't move/confine focus.
      if (e.key !== 'Tab' || !dialog) return;
      const f = dialog.querySelectorAll(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      if (prevFocus && prevFocus.focus) prevFocus.focus();   // restore focus on close
    };
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div ref={dialogRef} tabIndex={-1} className="modal help-modal" onMouseDown={e => e.stopPropagation()}
           role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="modal-head">
          <div className="help-head-title">
            <span className="help-head-mark" aria-hidden="true">
              <svg viewBox="0 0 16 16" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="8" cy="8" r="6.5" /><path d="M6.2 6.2a1.8 1.8 0 1 1 2.4 1.7c-.6.3-.9.7-.9 1.3M8 11.6v.01" />
              </svg>
            </span>
            <div>
              <h2 id={titleId}>Help &amp; shortcuts</h2>
              <p className="help-head-sub">Build · arrange · export</p>
            </div>
          </div>
          <button className="icon-btn" title="Close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <section className="help-section">
            <h3>Build a label</h3>
            <ol className="help-steps">
              <li><b>Pick a severity</b> (Danger, Warning, …) — sets the banner colour and signal word.</li>
              <li><b>Choose a template</b> under Templates — this replaces all current layers with a starting layout.</li>
              <li><b>Add elements</b> from the left rail (Text, Rect, List, Line, Barcode), or browse the Shapes and Symbols panels.</li>
              <li><b>Select & edit</b> a layer — drag it on the canvas to move, drag its handles to resize, and tune everything in the Properties panel.</li>
              <li><b>Align &amp; arrange</b> with the floating toolbar; fine-tune with the Dimensions fields.</li>
              <li><b>Export</b> (top-right) as SVG (vector) or PNG at 1–4×.</li>
            </ol>
          </section>

          <section className="help-section">
            <h3>Canvas controls</h3>
            <ul>
              <li><b>Move</b>: drag a layer. <b>Resize</b>: drag its handles.</li>
              <li><b>Text size</b> is set in <b>Typography → Size</b> — a text layer's box only controls where it wraps, so dragging its handles reflows the text rather than scaling the glyphs.</li>
              <li><b>Rotate</b>: set the angle in Properties → Dimensions (° field).</li>
              <li><b>Multi-select</b>: Shift-click layers, drag a marquee on empty space, then drag any selected layer as a group. Alt-click overlapping artwork to cycle through layers under the cursor.</li>
              <li><b>Pan</b>: middle-mouse drag (or hold <K>Space</K> and drag). <b>Zoom</b>: scroll the mouse wheel, or the bottom-right slider.</li>
              <li><b>Edit text</b>: double-click a text layer to edit it directly on the canvas (<K>Enter</K> commits, <K>Esc</K> cancels).</li>
              <li><b>Flip</b>: mirror a layer with the flip buttons in the arrange toolbar.</li>
              <li><b>Snap</b>: hold <K>Ctrl</K>/<K>⌘</K> while dragging to align to other layers; or turn on the <b>grid</b> / <b>Smart guides</b> in the bottom bar for always-on snapping and equal spacing. Hold <K>Shift</K> while dragging to lock to one axis.</li>
            </ul>
          </section>

          <section className="help-section">
            <h3>Keyboard</h3>
            <div className="kbd-grid">
              <span className="kbd-keys"><K>Ctrl</K>/<K>⌘</K> <K>Z</K></span><span className="kbd-label">Undo</span>
              <span className="kbd-keys"><K>Ctrl</K>/<K>⌘</K> <K>Shift</K> <K>Z</K></span><span className="kbd-label">Redo</span>
              <span className="kbd-keys"><K>Delete</K> / <K>Backspace</K></span><span className="kbd-label">Delete selected layer(s)</span>
              <span className="kbd-keys"><K>↑</K><K>↓</K><K>←</K><K>→</K></span><span className="kbd-label">Nudge (hold <K>Shift</K> for 10px)</span>
              <span className="kbd-keys"><K>Ctrl</K>/<K>⌘</K> <K>C</K> · <K>V</K> · <K>D</K></span><span className="kbd-label">Copy · Paste · Duplicate</span>
              <span className="kbd-keys"><K>Ctrl</K>/<K>⌘</K> <K>A</K></span><span className="kbd-label">Select all</span>
              <span className="kbd-keys"><K>Ctrl</K>/<K>⌘</K> <K>[</K> · <K>]</K></span><span className="kbd-label">Send back · bring forward (<K>Shift</K> = to back / front)</span>
              <span className="kbd-keys"><K>Ctrl</K>/<K>⌘</K> <K>+</K> · <K>−</K> · <K>0</K></span><span className="kbd-label">Zoom in · out · 100%</span>
              <span className="kbd-keys"><K>Shift</K> <K>1</K> · <K>Shift</K> <K>2</K></span><span className="kbd-label">Fit · zoom to selection (needs a selection)</span>
              <span className="kbd-keys"><K>Alt</K> <K>A</K> <K>W</K> <K>S</K> · <K>Alt</K> <K>Shift</K> <K>D</K></span><span className="kbd-label">Align left · top · bottom · right</span>
              <span className="kbd-keys"><K>Alt</K> <K>H</K> · <K>V</K></span><span className="kbd-label">Align centre (<K>Shift</K> = distribute)</span>
              <span className="kbd-keys"><K>Double-click</K></span><span className="kbd-label">Edit a text layer on the canvas</span>
              <span className="kbd-keys"><K>Esc</K></span><span className="kbd-label">Deselect</span>
            </div>
          </section>

          <section className="help-section">
            <h3>Tips</h3>
            <ul>
              <li><b>Pin to canvas</b> (Constraints) keeps a layer's edges anchored when you resize the canvas.</li>
              <li>A rect's <b>“On top” stroke</b> draws its border above other layers; the background frame always stays topmost.</li>
              <li>Your label <b>autosaves</b> to this browser, and you can store reusable layouts under <b>My templates</b>.</li>
              <li><b>Preview</b> (top bar) hides all the editing chrome to show the label on its own.</li>
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}

export { LayerGlyph, LayerBadges, SHAPES, AlignIcon, FlipIcon, Handles, HelpModal };
