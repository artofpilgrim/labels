// Hazard Label Studio — layer-based editor.
import { useState, useRef, useEffect, useCallback } from 'react';
import { SEVERITY, FORMATS, PRESETS, newLayer, Label } from './Label.jsx';
import { PICTOGRAMS } from './pictograms.js';
import { loadSymbols } from './symbols.js';
import { uid } from './uid.js';

// ----------- Initial design -----------
function makeInitialDesign() {
  const W = 640, H = 480;
  return {
    width: W,
    height: H,
    severity: 'danger',
    format: 'ansi-header',
    layers: PRESETS['ansi-header'](W, H, 'danger'),
  };
}

const DESIGN_AUTOSAVE_KEY = 'hazardLabelStudio.design';
const DOC_NAME_KEY = 'hazardLabelStudio.docName';
// Turn a free-text title into a safe file base: "High Voltage Label" → "high-voltage-label".
function slug(name) {
  const s = (name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return s || 'label';
}
// Restore the last working design from localStorage. Returns null when nothing
// is stored or the payload is unusable, so the caller falls back to a preset.
function loadSavedDesign() {
  try {
    const raw = localStorage.getItem(DESIGN_AUTOSAVE_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw);
    if (d && Array.isArray(d.layers) && d.layers.length
        && Number.isFinite(d.width) && Number.isFinite(d.height)) {
      return d;
    }
  } catch { /* corrupted storage — ignore */ }
  return null;
}

// ----------- Export helpers -----------
function svgToString(svgEl) {
  const clone = svgEl.cloneNode(true);
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
  return '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(clone);
}
function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function exportSvg(svgEl, name) {
  download(new Blob([svgToString(svgEl)], { type: 'image/svg+xml;charset=utf-8' }), `${name}.svg`);
}
function exportPng(svgEl, name, scale, onDone) {
  const str = svgToString(svgEl);
  const w = parseFloat(svgEl.getAttribute('width'));
  const h = parseFloat(svgEl.getAttribute('height'));
  const blob = new Blob([str], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  // Single exit point: always revoke the object URL and report ok/failure so
  // the caller can surface a message instead of throwing on a null blob.
  const done = (ok) => { URL.revokeObjectURL(url); if (onDone) onDone(ok); };
  const img = new Image();
  img.onload = () => {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(w * scale);
      canvas.height = Math.round(h * scale);
      const ctx = canvas.getContext('2d');
      if (!ctx) { done(false); return; }
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(b => {
        // An over-large canvas (e.g. big label @4×) yields a null blob.
        if (!b) { done(false); return; }
        download(b, `${name}@${scale}x.png`);
        done(true);
      }, 'image/png');
    } catch {
      done(false);
    }
  };
  img.onerror = () => done(false);
  img.src = url;
}

// ----------- UI primitives -----------
function Field({ label, hint, children }) {
  return (
    <div className="field">
      {label && <div className="field-label">{label}</div>}
      {children}
      {hint && <div className="field-hint">{hint}</div>}
    </div>
  );
}

// Collapsible accordion section for the right properties panel.
function Section({ title, children, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={`section${open ? '' : ' collapsed'}`}>
      <button className="section-head" onClick={() => setOpen(o => !o)}>
        <span>{title}</span>
        <span className="chev">▾</span>
      </button>
      <div className="section-body">{children}</div>
    </div>
  );
}
function Row({ children, gap = 8 }) { return <div className="row" style={{ gap }}>{children}</div>; }
function Seg({ value, onChange, options }) {
  return (
    <div className="seg">
      {options.map(o => (
        <button key={o.value} className={value === o.value ? 'on' : ''} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
function NumberInput({ value, onChange, min, max, step = 1, suffix }) {
  return (
    <div className="num-input">
      <input type="number" value={value} min={min} max={max} step={step}
             onChange={e => {
               // Ignore empty / NaN so clearing the field doesn't propagate
               // NaN into layer geometry. The caller's state is preserved
               // until the user commits a valid number.
               const raw = e.target.value;
               if (raw === '' || raw === '-') return;
               const n = Number(raw);
               if (Number.isFinite(n)) onChange(n);
             }} />
      {suffix && <span>{suffix}</span>}
    </div>
  );
}
function ColorInput({ value, onChange }) {
  return (
    <div className="color-input">
      <input type="color" value={value || '#000000'} onChange={e => onChange(e.target.value)} />
      <input type="text" value={value || ''} onChange={e => onChange(e.target.value)} spellCheck={false} />
    </div>
  );
}

// Range slider with an attached numeric readout/input. Replaces NumberInput
// where a sweep feels better than typing (radius, opacity-like dials, etc.).
function Slider({ value, onChange, min = 0, max = 100, step = 1, label }) {
  // Safe coercion: preserves a literal 0 (which `Number(value) || 0` would
  // also produce, but distinguishes NaN/undefined explicitly).
  const raw = Number(value);
  const v = Number.isFinite(raw) ? raw : 0;
  // Display precision matches step granularity — for step=0.5 we show 2.5,
  // not Math.round(2.5)=3 which would silently disagree with stored state.
  const display = Number.isInteger(step) ? Math.round(v) : Number(v.toFixed(2));
  const commit = (raw) => {
    if (raw === '' || raw === '-') return;
    const n = Number(raw);
    if (Number.isFinite(n)) onChange(n);
  };
  return (
    <div className={`slider${label ? ' has-label' : ''}`}>
      {label && <span className="slider-label">{label}</span>}
      <input
        className="slider-range"
        type="range"
        value={Math.min(max, Math.max(min, v))}
        onChange={e => commit(e.target.value)}
        min={min} max={max} step={step}
      />
      <input
        className="slider-num"
        type="number"
        value={display}
        onChange={e => commit(e.target.value)}
        min={min} step={step}
      />
    </div>
  );
}

// Four-edge toggle for layer anchors. Visualized as a small rectangle with
// a clickable dash on each side; an active edge gets a solid bar.
function PinSidesControl({ value, onChange }) {
  const v = value || {};
  function toggle(side) {
    const next = { ...v, [side]: !v[side] };
    // Strip empty so the layer doesn't carry meaningless { } around.
    const any = next.top || next.right || next.bottom || next.left;
    onChange(any ? next : null);
  }
  const sides = [
    { id: 'top',    label: 'Top' },
    { id: 'right',  label: 'Right' },
    { id: 'bottom', label: 'Bottom' },
    { id: 'left',   label: 'Left' },
  ];
  return (
    <div className="pin-control">
      <div className="pin-diagram">
        <div className={`pin-edge pin-top ${v.top ? 'on' : ''}`}
             onClick={() => toggle('top')} title="Pin top" />
        <div className={`pin-edge pin-right ${v.right ? 'on' : ''}`}
             onClick={() => toggle('right')} title="Pin right" />
        <div className={`pin-edge pin-bottom ${v.bottom ? 'on' : ''}`}
             onClick={() => toggle('bottom')} title="Pin bottom" />
        <div className={`pin-edge pin-left ${v.left ? 'on' : ''}`}
             onClick={() => toggle('left')} title="Pin left" />
        <div className="pin-center" />
      </div>
      <div className="pin-checks">
        {sides.map(s => (
          <label key={s.id} className="pin-check">
            <input type="checkbox" checked={!!v[s.id]} onChange={() => toggle(s.id)} />
            {s.label}
          </label>
        ))}
      </div>
    </div>
  );
}

// Editor for a rect's per-corner radius. The stored value is either a number
// (uniform) or { tl, tr, br, bl }; the toggle flips between the two.
function CornerRadius({ value, onChange, max }) {
  const linked = typeof value === 'number' || value == null;
  const cap = Math.max(0, max);
  const v = linked
    ? { tl: value || 0, tr: value || 0, br: value || 0, bl: value || 0 }
    : { tl: value.tl || 0, tr: value.tr || 0, br: value.br || 0, bl: value.bl || 0 };

  function setCorner(k, n) {
    onChange({ ...v, [k]: Math.max(0, n) });
  }
  function toggleLink() {
    if (linked) {
      onChange({ ...v });                       // split: keep current value
    } else {
      const allSame = v.tl === v.tr && v.tr === v.br && v.br === v.bl;
      if (!allSame) {
        const ok = window.confirm('Link corners will reset all four to the top-left value. Continue?');
        if (!ok) return;
      }
      onChange(Math.round(v.tl));               // collapse: use top-left
    }
  }

  return (
    <div className="corner-radius">
      <Slider label={linked ? 'All' : 'TL'} value={v.tl} onChange={n => linked ? onChange(n) : setCorner('tl', n)} max={cap} />
      {!linked && (
        <>
          <Slider label="TR" value={v.tr} onChange={n => setCorner('tr', n)} max={cap} />
          <Slider label="BL" value={v.bl} onChange={n => setCorner('bl', n)} max={cap} />
          <Slider label="BR" value={v.br} onChange={n => setCorner('br', n)} max={cap} />
        </>
      )}
      <button className="ghost" onClick={toggleLink}>
        {linked ? 'Split corners' : 'Link corners'}
      </button>
    </div>
  );
}

// ----------- Format icon -----------
function FormatIcon({ id, active }) {
  const w = 48, h = 36;
  const ink = '#1a1814';
  const accent = active ? '#C8102E' : '#bdb398';
  switch (id) {
    case 'ansi-header':
      return (<svg viewBox={`0 0 ${w} ${h}`} width={w} height={h}>
        <rect x="2" y="2" width={w - 4} height={h - 4} fill="none" stroke={ink} strokeWidth="1.2" />
        <rect x="2" y="2" width={w - 4} height="10" fill={accent} />
      </svg>);
    case 'ansi-side':
      return (<svg viewBox={`0 0 ${w} ${h}`} width={w} height={h}>
        <rect x="2" y="2" width={w - 4} height={h - 4} fill="none" stroke={ink} strokeWidth="1.2" />
        <rect x="2" y="2" width="12" height={h - 4} fill={accent} />
      </svg>);
    case 'banner':
      return (<svg viewBox="0 0 36 48" width={w} height={h}>
        <rect x="2" y="2" width="32" height="44" fill="none" stroke={ink} strokeWidth="1.2" />
        <rect x="2" y="2" width="32" height="8" fill={accent} />
        <line x1="8" y1="22" x2="28" y2="22" stroke={ink} strokeWidth="0.8" />
        <line x1="8" y1="28" x2="28" y2="28" stroke={ink} strokeWidth="0.8" />
        <line x1="8" y1="34" x2="22" y2="34" stroke={ink} strokeWidth="0.8" />
      </svg>);
    case 'plate':
      return (<svg viewBox={`0 0 ${w} ${h}`} width={w} height={h}>
        <path d={`M${w / 2} 4 L${w - 4} ${h - 4} L4 ${h - 4} Z`}
              fill={active ? '#F9A800' : '#e6dcc0'} stroke={ink} strokeWidth="1.6" strokeLinejoin="round" />
        <rect x={w / 2 - 1} y={h / 2 - 5} width="2" height="7" fill={ink} />
        <circle cx={w / 2} cy={h / 2 + 5} r="1.2" fill={ink} />
      </svg>);
    case 'stop':
      return (<svg viewBox={`0 0 ${w} ${h}`} width={w} height={h}>
        {(() => {
          const s = h - 4, off = s * 0.293, x0 = w / 2 - s / 2, y0 = 2;
          const pts = [
            [x0 + off, y0], [x0 + s - off, y0], [x0 + s, y0 + off],
            [x0 + s, y0 + s - off], [x0 + s - off, y0 + s], [x0 + off, y0 + s],
            [x0, y0 + s - off], [x0, y0 + off],
          ].map(p => p.join(',')).join(' ');
          return <polygon points={pts} fill={active ? '#C8102E' : '#d8c2bc'} />;
        })()}
      </svg>);
    case 'tag':
      return (<svg viewBox="0 0 28 48" width={w} height={h}>
        <rect x="2" y="2" width="24" height="44" fill="none" stroke={ink} strokeWidth="1.2" />
        <circle cx="14" cy="8" r="2.5" fill="none" stroke={ink} strokeWidth="1.2" />
        <rect x="4" y="14" width="20" height="6" fill={accent} />
      </svg>);
    case 'strip':
      return (<svg viewBox={`0 0 ${w} ${h}`} width={w} height={h}>
        <defs>
          <pattern id={`fi-pat-${active ? 'a' : 'b'}`} width="6" height="6"
                   patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="3" height="6" fill={ink} />
            <rect x="3" width="3" height="6" fill={accent} />
          </pattern>
        </defs>
        <rect x="2" y={h / 2 - 8} width={w - 4} height="16" fill={`url(#fi-pat-${active ? 'a' : 'b'})`} />
      </svg>);
    case 'blank':
      return (<svg viewBox={`0 0 ${w} ${h}`} width={w} height={h}>
        <rect x="2" y="2" width={w - 4} height={h - 4} fill="none" stroke={ink} strokeDasharray="3 3" strokeWidth="1.2" />
      </svg>);
    default:
      return <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} />;
  }
}

// ----------- Pictogram picker tile -----------
function PictoTile({ id, active, onClick, cache }) {
  const p = PICTOGRAMS[id];
  const src = cache && cache[id];
  return (
    <button className={`picto-tile ${active ? 'on' : ''}`} onClick={onClick} title={`${p.name} · ISO 7010 ${p.code}`}>
      {src ? <img src={src} alt={p.name} width="44" height="44" style={{ objectFit: 'contain' }} />
           : <div style={{ width: 44, height: 44 }} />}
      <span>{p.name}</span>
    </button>
  );
}

// ----------- Layer-type glyph (for layer list rows) -----------
function LayerGlyph({ type }) {
  const stroke = 'currentColor';
  switch (type) {
    case 'rect': return <svg width="14" height="14" viewBox="0 0 14 14"><rect x="2" y="2" width="10" height="10" fill="none" stroke={stroke} strokeWidth="1.4"/></svg>;
    case 'text': return <svg width="14" height="14" viewBox="0 0 14 14"><text x="7" y="11" fontFamily="serif" fontSize="12" fontWeight="700" textAnchor="middle" fill={stroke}>T</text></svg>;
    case 'image': return <svg width="14" height="14" viewBox="0 0 14 14"><path d="M7 2 L12 11 L2 11 Z" fill="none" stroke={stroke} strokeWidth="1.4"/></svg>;
    case 'bullets': return <svg width="14" height="14" viewBox="0 0 14 14"><circle cx="3" cy="4" r="1.2" fill={stroke}/><line x1="6" y1="4" x2="13" y2="4" stroke={stroke} strokeWidth="1.4"/><circle cx="3" cy="10" r="1.2" fill={stroke}/><line x1="6" y1="10" x2="13" y2="10" stroke={stroke} strokeWidth="1.4"/></svg>;
    case 'line': return <svg width="14" height="14" viewBox="0 0 14 14"><line x1="2" y1="7" x2="12" y2="7" stroke={stroke} strokeWidth="1.6"/></svg>;
    default: return null;
  }
}

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
    <svg viewBox="0 0 16 16" width="15" height="15">
      {axis === 'x'
        ? <line x1={G} y1="2" x2={G} y2="14" stroke="currentColor" strokeWidth="1.4" />
        : <line x1="2" y1={G} x2="14" y2={G} stroke="currentColor" strokeWidth="1.4" />}
      {bars.map((b, i) => <rect key={i} x={b.x} y={b.y} width={b.w} height={b.h} rx="1" fill="currentColor" />)}
    </svg>
  );
}

// ----------- Selection / drag handles (DOM overlay) -----------
const HANDLE_POSITIONS = [
  ['nw', 0, 0], ['n', 0.5, 0], ['ne', 1, 0],
  ['e', 1, 0.5], ['se', 1, 1], ['s', 0.5, 1],
  ['sw', 0, 1], ['w', 0, 0.5],
];

function Handles({ box, fit, onHandleDown, kind, rotation = 0 }) {
  // box in label coords {x,y,w,h}; positions in DOM coords (×fit). Everything
  // lives in a box-sized wrapper rotated about its centre so the outline and
  // handles track a rotated layer's edges. The wrapper is pointer-events:none
  // (it spans the box and would otherwise swallow canvas clicks); the handles
  // re-enable pointer events via CSS.
  const px = box.x * fit;
  const py = box.y * fit;
  const pw = box.w * fit;
  const ph = box.h * fit;
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
      <div className={`sel-outline ${kind}`} style={{ left: 0, top: 0, width: pw, height: ph }} />
      {HANDLE_POSITIONS.map(([name, fx, fy]) => (
        <div
          key={name}
          className={`handle handle-${name} ${kind}`}
          style={{ left: fx * pw, top: fy * ph }}
          onMouseDown={e => onHandleDown(e, name)}
        />
      ))}
    </div>
  );
}

// ----------- Pin / anchor math -----------
// A layer with `pinSides` declares which of its four edges follow the canvas.
// When the canvas resizes we adjust the layer's x/y/w/h so the named edges
// stay at the same offset from the corresponding canvas edge:
//   - top    pinned: y stays fixed from the top
//   - bottom pinned: y shifts so the bottom-edge offset is preserved
//   - top+bottom both pinned: layer stretches vertically
//   - same logic horizontally for left/right
// Layers without `pinSides` are unchanged on canvas resize (legacy behavior).
function applyPins(l, oldW, oldH, newW, newH) {
  const pin = l.pinSides;
  if (!pin) return l;
  let { x, y, w, h } = l;

  const right = pin.right, left = pin.left;
  if (left && right) {
    const rightOffset = oldW - (x + w);
    w = Math.max(1, newW - x - rightOffset);
  } else if (right && !left) {
    const rightOffset = oldW - (x + w);
    x = newW - w - rightOffset;
  }
  // left-only or neither: x stays

  const top = pin.top, bottom = pin.bottom;
  if (top && bottom) {
    const bottomOffset = oldH - (y + h);
    h = Math.max(1, newH - y - bottomOffset);
  } else if (bottom && !top) {
    const bottomOffset = oldH - (y + h);
    y = newH - h - bottomOffset;
  }

  return { ...l, x, y, w, h };
}

// ----------- Snap math (Ctrl-drag alignment) -----------
// Build snap targets: every visible non-locked layer's edges (except `excludeId`)
// plus the canvas itself. Each target contributes its left/center/right (X) and
// top/middle/bottom (Y) lines.
function snapTargets(design, excludeId) {
  const out = [];
  for (const l of design.layers) {
    if (l.id === excludeId || l.hidden) continue;
    out.push({ x: l.x, y: l.y, w: l.w, h: l.h });
  }
  out.push({ x: 0, y: 0, w: design.width, h: design.height });
  return out;
}

// Snap a box during a move: try each of the box's six edge positions
// (left, hCenter, right, top, vMiddle, bottom) against every target edge.
// Returns adjusted x/y plus the guides that activated.
function snapMove(box, targets, threshold) {
  const bxs = [box.x, box.x + box.w / 2, box.x + box.w];
  const bys = [box.y, box.y + box.h / 2, box.y + box.h];

  let bestX = null, bestY = null;
  for (const t of targets) {
    const txs = [t.x, t.x + t.w / 2, t.x + t.w];
    const tys = [t.y, t.y + t.h / 2, t.y + t.h];
    for (const bx of bxs) for (const tx of txs) {
      const d = tx - bx;
      if (Math.abs(d) <= threshold && (!bestX || Math.abs(d) < Math.abs(bestX.d))) {
        bestX = { d, value: tx };
      }
    }
    for (const by of bys) for (const ty of tys) {
      const d = ty - by;
      if (Math.abs(d) <= threshold && (!bestY || Math.abs(d) < Math.abs(bestY.d))) {
        bestY = { d, value: ty };
      }
    }
  }

  const out = { x: box.x, y: box.y, guides: [] };
  if (bestX) { out.x = box.x + bestX.d; out.guides.push({ orient: 'v', value: bestX.value }); }
  if (bestY) { out.y = box.y + bestY.d; out.guides.push({ orient: 'h', value: bestY.value }); }
  return out;
}

// Snap during resize: only the edge(s) of the box that the handle is dragging
// should snap. We anchor the OPPOSITE edge so width/height are recomputed.
function snapResize(box, mode, targets, threshold) {
  const right = box.x + box.w;
  const bottom = box.y + box.h;
  const movingLeft   = mode.includes('w');
  const movingRight  = mode.includes('e');
  const movingTop    = mode.includes('n');
  const movingBottom = mode.includes('s');

  let bestX = null, bestY = null;
  for (const t of targets) {
    const txs = [t.x, t.x + t.w / 2, t.x + t.w];
    const tys = [t.y, t.y + t.h / 2, t.y + t.h];

    if (movingRight) for (const tx of txs) {
      const d = tx - right;
      if (Math.abs(d) <= threshold && (!bestX || Math.abs(d) < Math.abs(bestX.d))) {
        bestX = { d, value: tx, edge: 'right' };
      }
    }
    if (movingLeft) for (const tx of txs) {
      const d = tx - box.x;
      if (Math.abs(d) <= threshold && (!bestX || Math.abs(d) < Math.abs(bestX.d))) {
        bestX = { d, value: tx, edge: 'left' };
      }
    }
    if (movingBottom) for (const ty of tys) {
      const d = ty - bottom;
      if (Math.abs(d) <= threshold && (!bestY || Math.abs(d) < Math.abs(bestY.d))) {
        bestY = { d, value: ty, edge: 'bottom' };
      }
    }
    if (movingTop) for (const ty of tys) {
      const d = ty - box.y;
      if (Math.abs(d) <= threshold && (!bestY || Math.abs(d) < Math.abs(bestY.d))) {
        bestY = { d, value: ty, edge: 'top' };
      }
    }
  }

  const out = { x: box.x, y: box.y, w: box.w, h: box.h, guides: [] };
  if (bestX) {
    if (bestX.edge === 'right') out.w = Math.max(4, box.w + bestX.d);
    else { out.x = box.x + bestX.d; out.w = Math.max(4, box.w - bestX.d); }
    out.guides.push({ orient: 'v', value: bestX.value });
  }
  if (bestY) {
    if (bestY.edge === 'bottom') out.h = Math.max(4, box.h + bestY.d);
    else { out.y = box.y + bestY.d; out.h = Math.max(4, box.h - bestY.d); }
    out.guides.push({ orient: 'h', value: bestY.value });
  }
  return out;
}

// ----------- Drag math -----------
// Apply a resize delta to a {x,y,w,h} rect based on which handle was grabbed.
// Modifiers:
//   shift = preserve aspect ratio (the perpendicular axis follows)
//   alt   = mirror — the opposite edge moves equally (scale from center)
// Default (no modifiers): only the dragged edge(s) move; everything else stays.
function resizeRect(start, mode, dx, dy, mods, minSize = 4) {
  const { shift, alt } = mods || {};
  const { x, y, w, h } = start;
  let nx = x, ny = y, nw = w, nh = h;
  const has = (c) => mode.includes(c);

  if (alt) {
    // Mirror: each grabbed edge moves by `d`, the opposite edge by `-d`.
    if (has('e')) { nw = Math.max(minSize, w + 2 * dx); nx = x - (nw - w) / 2; }
    if (has('w')) { nw = Math.max(minSize, w - 2 * dx); nx = x - (nw - w) / 2; }
    if (has('s')) { nh = Math.max(minSize, h + 2 * dy); ny = y - (nh - h) / 2; }
    if (has('n')) { nh = Math.max(minSize, h - 2 * dy); ny = y - (nh - h) / 2; }
  } else {
    if (has('e')) nw = Math.max(minSize, w + dx);
    if (has('w')) { nw = Math.max(minSize, w - dx); nx = x + (w - nw); }
    if (has('s')) nh = Math.max(minSize, h + dy);
    if (has('n')) { nh = Math.max(minSize, h - dy); ny = y + (h - nh); }
  }

  if (shift && w > 0 && h > 0) {
    const ratio = w / h;
    const dw = nw - w, dh = nh - h;
    // Pick the dominant axis as the driver, then scale the other to match.
    const hDriven = Math.abs(dw) > Math.abs(dh) || mode === 'e' || mode === 'w';
    if (hDriven) {
      const newH = nw / ratio;
      if (alt) ny = y - (newH - h) / 2;       // recenter on y
      else if (has('n')) ny = y + (h - newH); // anchored to opposite edge
      nh = newH;
    } else {
      const newW = nh * ratio;
      if (alt) nx = x - (newW - w) / 2;
      else if (has('w')) nx = x + (w - newW);
      nw = newW;
    }
  }
  return { x: nx, y: ny, w: nw, h: nh };
}

// Re-anchor a rotated layer after an axis-aligned resize. resizeRect holds the
// edge/corner opposite the grabbed handle fixed in the layer's LOCAL frame, but
// the layer is rendered rotated about its CENTER — and the resize moved that
// center, so the anchor drifts in world space. We compute the anchor's world
// position (rotation about center, matching the SVG `rotate()` render) for the
// box before and after the resize, then translate the new box so they coincide.
// A local-space shift of the box translates its world anchor by the same vector,
// so the world-space correction can be applied straight to x/y.
//   cos/sin describe the layer's rotation; `alt` (mirror) keeps the center fixed
//   instead of an edge, so its anchor is the center and the correction is ~0.
function reanchorRotated(before, after, mode, cos, sin, alt) {
  const ax = alt ? 0.5 : mode.includes('w') ? 1 : mode.includes('e') ? 0 : 0.5;
  const ay = alt ? 0.5 : mode.includes('n') ? 1 : mode.includes('s') ? 0 : 0.5;
  const anchorWorld = (b) => {
    const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
    const lx = b.x + ax * b.w - cx; // anchor offset from center, local frame
    const ly = b.y + ay * b.h - cy;
    return { x: cx + lx * cos - ly * sin, y: cy + lx * sin + ly * cos };
  };
  const w0 = anchorWorld(before);
  const w1 = anchorWorld(after);
  return { ...after, x: after.x + (w0.x - w1.x), y: after.y + (w0.y - w1.y) };
}

// Pick a "nice" ruler step (1/2/5 × 10ⁿ) closest to a target raw spacing so
// tick labels land on round pixel values regardless of zoom.
function niceStep(raw) {
  if (!isFinite(raw) || raw <= 0) return 100;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / pow;
  const m = n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10;
  return m * pow;
}

// ----------- Help / workflows dialog -----------
function HelpModal({ onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [onClose]);
  const K = ({ children }) => <kbd>{children}</kbd>;
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal help-modal" onMouseDown={e => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="modal-head">
          <h2>Help &amp; workflows</h2>
          <button className="icon-btn" title="Close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <section className="help-section">
            <h3>Build a label</h3>
            <ol>
              <li><b>Pick a severity</b> (Danger, Warning, …) — sets the banner colour and signal word.</li>
              <li><b>Choose a template</b> under Common Templates — this replaces all layers with a starting layout.</li>
              <li><b>Add elements</b> from the left rail (Text, Rect, Symbol, List, Line) or the Layers tab.</li>
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
              <li><b>Multi-select</b>: Shift-click layers, or drag a marquee on empty space. Drag any selected layer to move the whole group; with 3+ selected you can distribute.</li>
              <li><b>Pan</b>: hold <K>Space</K> and drag, or middle-mouse drag. <b>Zoom</b>: <K>Ctrl</K>/<K>⌘</K> + scroll, or the bottom-right slider.</li>
              <li><b>Snap</b>: hold <K>Ctrl</K>/<K>⌘</K> while dragging to align to other layers and the canvas.</li>
            </ul>
          </section>

          <section className="help-section">
            <h3>Keyboard</h3>
            <div className="kbd-grid">
              <span className="kbd-keys"><K>Ctrl</K>/<K>⌘</K> <K>Z</K></span><span className="kbd-label">Undo</span>
              <span className="kbd-keys"><K>Ctrl</K>/<K>⌘</K> <K>Shift</K> <K>Z</K></span><span className="kbd-label">Redo</span>
              <span className="kbd-keys"><K>Delete</K> / <K>Backspace</K></span><span className="kbd-label">Delete selected layer(s)</span>
              <span className="kbd-keys"><K>↑</K><K>↓</K><K>←</K><K>→</K></span><span className="kbd-label">Nudge (hold <K>Shift</K> for 10px)</span>
              <span className="kbd-keys"><K>Esc</K></span><span className="kbd-label">Deselect</span>
            </div>
          </section>

          <section className="help-section">
            <h3>Tips</h3>
            <ul>
              <li><b>Pin to canvas</b> (Constraints) keeps a layer's edges anchored when you resize the canvas.</li>
              <li>A rect's <b>“On top” stroke</b> draws its border above other layers; the background frame always stays topmost.</li>
              <li>Your design <b>autosaves</b> to this browser, and you can store reusable layouts under <b>Your presets</b>.</li>
              <li><b>Preview</b> (top bar) hides all the editing chrome to show the label on its own.</li>
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}

// ----------- Main App -----------
const HISTORY_LIMIT = 100;
const COMMIT_DEBOUNCE_MS = 400;

export function App() {
  // Single bundle so design / past / future stay consistent across one render.
  // Undo/redo pop from past/future; ordinary edits update `design` and a
  // debounced effect snapshots the previous-committed design into `past`.
  const [editor, setEditor] = useState(() => ({
    design: loadSavedDesign() || makeInitialDesign(),
    past: [],
    future: [],
  }));
  const design = editor.design;
  const setDesign = useCallback((updater) => {
    setEditor(e => ({
      ...e,
      design: typeof updater === 'function' ? updater(e.design) : updater,
    }));
  }, []);

  // Tracks the design we most recently committed to `past` so the debounce
  // effect knows whether a real change is pending. The ref decouples the
  // commit decision from React's render cycle.
  // Seed with the initial design so the very first render already agrees with
  // editor.design — otherwise the Undo button (which compares against this ref)
  // shows enabled on first paint before any effect runs.
  const lastCommittedDesign = useRef(editor.design);
  const commitTimerRef = useRef(null);
  // Suspend the debounced commit while a drag is in progress; we forceCommit()
  // at mousedown and rely on a single post-drag commit after mouseup settles.
  const inDragRef = useRef(false);

  // Push the previously-committed design onto `past` after the user has been
  // idle for COMMIT_DEBOUNCE_MS. Dragging suppresses commits via inDragRef.
  useEffect(() => {
    if (editor.design === lastCommittedDesign.current) return;
    if (inDragRef.current) return;
    if (commitTimerRef.current) clearTimeout(commitTimerRef.current);
    commitTimerRef.current = setTimeout(() => {
      commitTimerRef.current = null;
      setEditor(e => {
        if (e.design === lastCommittedDesign.current) return e;
        const snapshot = lastCommittedDesign.current;
        lastCommittedDesign.current = e.design;
        return {
          design: e.design,
          past: [...e.past, snapshot].slice(-HISTORY_LIMIT),
          future: [],
        };
      });
    }, COMMIT_DEBOUNCE_MS);
    return () => {};
  }, [editor.design]);

  // Force-commit any pending change immediately — call before a drag begins
  // or any other transactional action so the boundary lands on a clean stop.
  const forceCommit = useCallback(() => {
    if (commitTimerRef.current) {
      clearTimeout(commitTimerRef.current);
      commitTimerRef.current = null;
    }
    setEditor(e => {
      if (e.design === lastCommittedDesign.current) return e;
      const snapshot = lastCommittedDesign.current;
      lastCommittedDesign.current = e.design;
      return {
        design: e.design,
        past: [...e.past, snapshot].slice(-HISTORY_LIMIT),
        future: [],
      };
    });
  }, []);

  // Selection is a SET of layer ids (multi-select). Single-layer paths derive
  // `selectedId`/`selectedLayer` (non-null only when exactly one is selected);
  // group paths use `selectedLayers` + `selBounds` (axis-aligned union box).
  const [selectedIds, setSelectedIds] = useState([]);
  const [marquee, setMarquee] = useState(null); // rubber-band rect in label coords
  const selectedId = selectedIds.length === 1 ? selectedIds[0] : null;
  const selectedLayer = selectedId ? design.layers.find(l => l.id === selectedId) : null;
  const selectedLayers = selectedIds.length ? design.layers.filter(l => selectedIds.includes(l.id)) : [];
  const selBounds = selectedLayers.length ? {
    x: Math.min(...selectedLayers.map(l => l.x)),
    y: Math.min(...selectedLayers.map(l => l.y)),
    w: Math.max(...selectedLayers.map(l => l.x + l.w)) - Math.min(...selectedLayers.map(l => l.x)),
    h: Math.max(...selectedLayers.map(l => l.y + l.h)) - Math.min(...selectedLayers.map(l => l.y)),
  } : null;
  const editableSel = selectedLayers.filter(l => !l.locked);

  // ----- 4-zone shell state -----
  // leftPanel: which view the icon rail shows in the left panel.
  const [leftPanel, setLeftPanel] = useState('templates'); // 'templates' | 'layers'
  // rightTab: which tab the right properties panel shows.
  const [rightTab, setRightTab] = useState('properties');  // 'properties' | 'layers' | 'symbols'
  // Editable document title in the top bar; restored from + saved to localStorage.
  const [docName, setDocName] = useState(() => {
    try { return localStorage.getItem(DOC_NAME_KEY) || 'Untitled Label'; }
    catch { return 'Untitled Label'; }
  });
  const [exportOpen, setExportOpen] = useState(false);      // export popover
  const [preview, setPreview] = useState(false);            // chrome-free preview toggle
  const [helpOpen, setHelpOpen] = useState(false);          // help / workflows dialog
  const [query, setQuery] = useState('');                   // template search filter
  // Save status shown in the top bar; flips to 'saving' on edit, back after autosave.
  const [saveState, setSaveState] = useState('saved');      // 'saved' | 'saving'
  // Ruler geometry: label origin offset within each ruler strip + strip size,
  // recomputed from the live DOM on scroll/zoom/pan/resize. null until measured.
  const [rulers, setRulers] = useState(null);
  const [exportMsg, setExportMsg] = useState('');
  const [symbolCache, setSymbolCache] = useState(null);
  // Cumulative offset applied to the label-wrap to compensate for the grid
  // re-centering. Without this, when the canvas grows the wrap stays centered
  // and both edges appear to move; we offset the wrap by half the size delta
  // so the un-dragged edge stays visually pinned. Reset via "Center canvas".
  const [wrapOffset, setWrapOffset] = useState({ x: 0, y: 0 });
  // Active alignment guides shown while Ctrl-dragging. Each guide:
  // { orient: 'v' | 'h', value: number }  — value in label coordinates.
  const [snapGuides, setSnapGuides] = useState([]);
  const [userPresets, setUserPresets] = useState([]);
  const [newPresetName, setNewPresetName] = useState('');
  // Auto-fit value computed from the viewport; only updated while zoomMode
  // is 'fit'. zoomMode = 'fit' uses autoFit, otherwise it stores the manual
  // scale directly (1.0 = 100%).
  const [autoFit, setAutoFit] = useState(1);
  const [zoomMode, setZoomMode] = useState('fit');
  const fit = zoomMode === 'fit' ? autoFit : zoomMode;

  const labelRef = useRef(null);
  const canvasRef = useRef(null);
  const wrapRef = useRef(null);
  const rulerTopRef = useRef(null);
  const rulerLeftRef = useRef(null);

  // ----- Undo / Redo -----
  const undo = useCallback(() => {
    if (commitTimerRef.current) { clearTimeout(commitTimerRef.current); commitTimerRef.current = null; }
    setEditor(e => {
      // If there's an uncommitted live edit (design diverged from the last
      // committed snapshot), the first undo reverts THAT edit only — the
      // committed past stays intact for the next undo.
      if (e.design !== lastCommittedDesign.current) {
        return {
          ...e,
          design: lastCommittedDesign.current,
          future: [e.design, ...e.future].slice(0, HISTORY_LIMIT),
        };
      }
      // Otherwise pop one committed snapshot off `past`.
      if (e.past.length === 0) return e;
      const prev = e.past[e.past.length - 1];
      lastCommittedDesign.current = prev;
      return {
        design: prev,
        past: e.past.slice(0, -1),
        future: [e.design, ...e.future].slice(0, HISTORY_LIMIT),
      };
    });
    setWrapOffset({ x: 0, y: 0 });
    setSnapGuides([]);
  }, []);

  const redo = useCallback(() => {
    if (commitTimerRef.current) { clearTimeout(commitTimerRef.current); commitTimerRef.current = null; }
    setEditor(e => {
      if (e.future.length === 0) return e;
      const next = e.future[0];
      lastCommittedDesign.current = next;
      return {
        design: next,
        past: [...e.past, e.design].slice(-HISTORY_LIMIT),
        future: e.future.slice(1),
      };
    });
    setWrapOffset({ x: 0, y: 0 });
    setSnapGuides([]);
  }, []);

  useEffect(() => { loadSymbols().then(setSymbolCache); }, []);

  // Persist the working design (debounced) so a refresh doesn't lose work.
  // Independent of the undo history; only the current design is stored.
  useEffect(() => {
    setSaveState('saving');
    const t = setTimeout(() => {
      try {
        localStorage.setItem(DESIGN_AUTOSAVE_KEY, JSON.stringify(editor.design));
        localStorage.setItem(DOC_NAME_KEY, docName);
      } catch { /* quota or serialization failure — non-fatal */ }
      setSaveState('saved');
    }, 500);
    return () => clearTimeout(t);
  }, [editor.design, docName]);

  // Load any user presets stashed in localStorage on first render.
  useEffect(() => {
    try {
      const raw = localStorage.getItem('hazardLabelStudio.userPresets');
      if (raw) setUserPresets(JSON.parse(raw));
    } catch { /* corrupted storage — ignore */ }
  }, []);
  function persistUserPresets(next) {
    // Only commit to React state if storage accepted the write — otherwise
    // the UI shows a preset that won't survive a reload (silent drift).
    try {
      localStorage.setItem('hazardLabelStudio.userPresets', JSON.stringify(next));
      setUserPresets(next);
    } catch (err) {
      setExportMsg(
        err && err.name === 'QuotaExceededError'
          ? 'Storage full — delete some presets'
          : 'Could not save preset'
      );
      setTimeout(() => setExportMsg(''), 2800);
    }
  }
  function saveCurrentAsPreset(name) {
    const trimmed = (name || '').trim();
    if (!trimmed) return;
    const preset = {
      id: Math.random().toString(36).slice(2, 9),
      name: trimmed,
      design: {
        width: design.width,
        height: design.height,
        severity: design.severity,
        layers: JSON.parse(JSON.stringify(design.layers)), // deep clone
      },
    };
    persistUserPresets([...userPresets, preset]);
    setNewPresetName('');
  }
  function applyUserPreset(id) {
    const p = userPresets.find(x => x.id === id);
    if (!p) return;
    // Fresh layer IDs so nothing reuses stale references.
    const layers = p.design.layers.map(l => ({
      ...l,
      id: Math.random().toString(36).slice(2, 9),
    }));
    setDesign({
      width: p.design.width,
      height: p.design.height,
      severity: p.design.severity,
      format: 'custom',
      layers,
    });
    setDocName(p.name);
    setSelectedIds([]);
    setWrapOffset({ x: 0, y: 0 });
  }
  function deleteUserPreset(id) {
    persistUserPresets(userPresets.filter(p => p.id !== id));
  }

  // ----- helpers -----
  const setLayer = useCallback((id, patch) => {
    setDesign(d => ({
      ...d,
      layers: d.layers.map(l => l.id === id ? { ...l, ...patch } : l),
    }));
  }, []);
  const deleteLayer = useCallback((id) => {
    setDesign(d => {
      const layer = d.layers.find(l => l.id === id);
      if (!layer || layer.locked) return d; // respect lock — must unlock first
      return { ...d, layers: d.layers.filter(l => l.id !== id) };
    });
    setSelectedIds(ids => ids.filter(i => i !== id));
  }, [setDesign]);
  const moveLayer = useCallback((id, dir) => {
    setDesign(d => {
      const i = d.layers.findIndex(l => l.id === id);
      if (i < 0) return d;
      if (d.layers[i].locked) return d;     // locked layers don't reorder
      const j = dir === 'up' ? i + 1 : i - 1;
      if (j < 0 || j >= d.layers.length) return d;
      if (d.layers[j].locked) return d; // don't swap past a locked layer (e.g. background)
      const layers = d.layers.slice();
      [layers[i], layers[j]] = [layers[j], layers[i]];
      return { ...d, layers };
    });
  }, [setDesign]);
  const addLayer = useCallback((type) => {
    const nl = newLayer(type, design.width, design.height);
    if (!nl) return;
    setDesign(d => ({ ...d, layers: [...d.layers, nl] }));
    setSelectedIds([nl.id]);
    setRightTab('properties');
  }, [design.width, design.height]);

  // Align selected layers. With one selection we align to the canvas; with two
  // or more we align each layer to the selection's bounding box.
  const alignLayer = useCallback((kind) => {
    setDesign(d => {
      const sel = d.layers.filter(l => selectedIds.includes(l.id) && !l.locked);
      if (sel.length === 0) return d;
      const b = sel.length === 1
        ? { x: 0, y: 0, w: d.width, h: d.height }
        : (() => {
            const x0 = Math.min(...sel.map(l => l.x)), y0 = Math.min(...sel.map(l => l.y));
            const x1 = Math.max(...sel.map(l => l.x + l.w)), y1 = Math.max(...sel.map(l => l.y + l.h));
            return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
          })();
      const ids = new Set(sel.map(l => l.id));
      return { ...d, layers: d.layers.map(l => {
        if (!ids.has(l.id)) return l;
        const patch = {};
        if (kind === 'left') patch.x = b.x;
        else if (kind === 'cx') patch.x = Math.round(b.x + (b.w - l.w) / 2);
        else if (kind === 'right') patch.x = b.x + b.w - l.w;
        else if (kind === 'top') patch.y = b.y;
        else if (kind === 'cy') patch.y = Math.round(b.y + (b.h - l.h) / 2);
        else if (kind === 'bottom') patch.y = b.y + b.h - l.h;
        return { ...l, ...patch };
      }) };
    });
  }, [selectedIds, setDesign]);

  // Evenly distribute 3+ selected layers' centers along an axis ('x' | 'y'),
  // keeping the outermost two fixed.
  const distribute = useCallback((axis) => {
    setDesign(d => {
      const sel = d.layers.filter(l => selectedIds.includes(l.id) && !l.locked);
      if (sel.length < 3) return d;
      const k = axis === 'x' ? 'x' : 'y', s = axis === 'x' ? 'w' : 'h';
      const sorted = [...sel].sort((a, b) => (a[k] + a[s] / 2) - (b[k] + b[s] / 2));
      const c0 = sorted[0][k] + sorted[0][s] / 2;
      const c1 = sorted[sorted.length - 1][k] + sorted[sorted.length - 1][s] / 2;
      const step = (c1 - c0) / (sorted.length - 1);
      const patch = new Map();
      sorted.forEach((l, i) => { if (i > 0 && i < sorted.length - 1) patch.set(l.id, Math.round(c0 + step * i - l[s] / 2)); });
      return { ...d, layers: d.layers.map(l => patch.has(l.id) ? { ...l, [k]: patch.get(l.id) } : l) };
    });
  }, [selectedIds, setDesign]);

  // Duplicate every selected layer just above it in the stack, nudged 12px.
  const duplicateLayer = useCallback(() => {
    if (selectedIds.length === 0) return;
    const newIds = [];
    setDesign(d => {
      const layers = d.layers.slice();
      // Insert from the back so earlier splices don't shift later indices.
      const targets = selectedIds
        .map(id => layers.findIndex(l => l.id === id))
        .filter(i => i >= 0 && !layers[i].locked)
        .sort((a, b) => b - a);
      for (const i of targets) {
        const src = layers[i];
        const id = uid();
        newIds.push(id);
        layers.splice(i + 1, 0, {
          ...JSON.parse(JSON.stringify(src)),
          id, x: src.x + 12, y: src.y + 12,
          name: (src.name || src.type) + ' copy',
        });
      }
      return { ...d, layers };
    });
    if (newIds.length) { setSelectedIds(newIds); setRightTab('properties'); }
  }, [selectedIds, setDesign]);

  // Delete every (non-locked) selected layer.
  const deleteSelected = useCallback(() => {
    setDesign(d => ({ ...d, layers: d.layers.filter(l => !(selectedIds.includes(l.id) && !l.locked)) }));
    setSelectedIds([]);
  }, [selectedIds, setDesign]);

  // Drag-move every layer in `ids` together (no per-edge snap for groups).
  function startGroupDrag(e, ids) {
    const snaps = new Map();
    for (const id of ids) {
      const l = design.layers.find(x => x.id === id);
      if (l && !l.locked) snaps.set(id, { x: l.x, y: l.y });
    }
    beginDrag(e, (dx, dy) => {
      setDesign(d => ({ ...d, layers: d.layers.map(l => snaps.has(l.id) ? { ...l, x: snaps.get(l.id).x + dx, y: snaps.get(l.id).y + dy } : l) }));
    });
  }

  // Rubber-band selection: drag on empty canvas to select intersecting layers;
  // a click without movement clears the selection.
  function startMarquee(e) {
    e.preventDefault();
    const wrap = wrapRef.current;
    if (!wrap) { setSelectedIds([]); return; }
    const r0 = wrap.getBoundingClientRect();
    const f = fit;
    const sx = (e.clientX - r0.left) / f, sy = (e.clientY - r0.top) / f;
    let moved = false;
    const rectFrom = (ev) => {
      const wr = wrap.getBoundingClientRect();
      const cx = (ev.clientX - wr.left) / f, cy = (ev.clientY - wr.top) / f;
      return { x: Math.min(sx, cx), y: Math.min(sy, cy), w: Math.abs(cx - sx), h: Math.abs(cy - sy) };
    };
    function move(ev) {
      const r = rectFrom(ev);
      if (r.w > 3 || r.h > 3) moved = true;
      setMarquee(r);
    }
    function up(ev) {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      if (moved) {
        const r = rectFrom(ev);
        const hit = design.layers.filter(l => !l.locked && !l.hidden &&
          l.x < r.x + r.w && l.x + l.w > r.x && l.y < r.y + r.h && l.y + l.h > r.y).map(l => l.id);
        setSelectedIds(hit);
        if (hit.length) setRightTab('properties');
      } else {
        setSelectedIds([]);
      }
      setMarquee(null);
    }
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  }

  function applyPreset(formatId) {
    const f = FORMATS.find(x => x.id === formatId);
    const [W, H] = f.default;
    setDesign(d => ({
      width: W, height: H,
      severity: d.severity,
      format: formatId,
      layers: PRESETS[formatId](W, H, d.severity),
    }));
    setSelectedIds([]);
    setWrapOffset({ x: 0, y: 0 });
  }

  function setSeverity(id) {
    setDesign(d => {
      const sev = SEVERITY[id];
      // Re-color severity-bound layers automatically.
      const layers = d.layers.map(l => {
        if (l.bindSeverity === 'band') return { ...l, fill: sev.band };
        if (l.bindSeverity === 'bandInk') return { ...l, fill: sev.bandInk };
        return l;
      });
      // Also auto-update the text of "Signal word"-style text layers? Skip — we don't
      // know which layer the user considers the signal. The signal word is just the
      // current sev.word at preset time; subsequent severity changes leave the text alone.
      return { ...d, severity: id, layers };
    });
  }

  // ----- drag handling -----
  // We attach mousemove/mouseup on `document` so the user can drag outside the
  // handle. The handlers are local closures captured per drag so we can clean
  // them up correctly on mouseup.
  function beginDrag(e, onMove) {
    e.preventDefault(); e.stopPropagation();
    // Flush any pending typing/edit commits so the drag's pre-state is the
    // history anchor. inDragRef suspends the debounced commit while the
    // drag is live — we commit again on mouseup.
    forceCommit();
    inDragRef.current = true;
    const x0 = e.clientX, y0 = e.clientY, f = fit;
    function move(ev) {
      const dx = (ev.clientX - x0) / f;
      const dy = (ev.clientY - y0) / f;
      onMove(dx, dy, {
        shift: ev.shiftKey,
        alt: ev.altKey,
        ctrl: ev.ctrlKey || ev.metaKey, // accept Cmd on macOS
      });
    }
    function up() {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      setSnapGuides([]);                  // always clear guides on drag end
      inDragRef.current = false;
      // Commit the post-drag state as a single history step. setTimeout(0)
      // lets the final mousemove's state update flush first.
      setTimeout(forceCommit, 0);
    }
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  }

  function startLayerDrag(e, layer) {
    const snap = { x: layer.x, y: layer.y, w: layer.w, h: layer.h };
    beginDrag(e, (dx, dy, mods) => {
      let nx = snap.x + dx;
      let ny = snap.y + dy;
      let guides = [];
      if (mods.ctrl) {
        const threshold = 8 / fit; // ~8 screen pixels regardless of zoom
        const r = snapMove({ x: nx, y: ny, w: snap.w, h: snap.h },
                           snapTargets(design, layer.id), threshold);
        nx = r.x; ny = r.y; guides = r.guides;
      }
      setSnapGuides(guides);
      setLayer(layer.id, { x: nx, y: ny });
    });
  }
  function startLayerResize(e, mode) {
    const layer = design.layers.find(l => l.id === selectedId);
    if (!layer) return;
    const snap = { x: layer.x, y: layer.y, w: layer.w, h: layer.h };
    const rot = (layer.rotation || 0) * Math.PI / 180;
    const cos = Math.cos(rot), sin = Math.sin(rot);
    beginDrag(e, (dx, dy, mods) => {
      // The drag delta arrives in canvas (world) axes. For a rotated layer,
      // rotate it into the layer's local axes so the grabbed edge follows the
      // cursor, run the normal axis-aligned resize, then re-anchor so the
      // opposite corner stays put in world space.
      const dxL = rot ? dx * cos + dy * sin : dx;
      const dyL = rot ? -dx * sin + dy * cos : dy;
      const r = resizeRect(snap, mode, dxL, dyL, mods);
      let next = r, guides = [];
      // Snap only when Ctrl is held alone — shift/alt have geometric goals
      // (aspect lock, mirror) that conflict with snapping a single edge. Snap
      // math is axis-aligned, so skip it for rotated layers.
      if (mods.ctrl && !mods.shift && !mods.alt && !rot) {
        const s = snapResize(r, mode, snapTargets(design, layer.id), 8 / fit);
        next = s; guides = s.guides;
      }
      if (rot) next = reanchorRotated(snap, next, mode, cos, sin, mods.alt);
      setSnapGuides(guides);
      setLayer(layer.id, { x: next.x, y: next.y, w: next.w, h: next.h });
    });
  }
  function startCanvasResize(e, mode) {
    const snap = { w: design.width, h: design.height, fit };
    const startOffset = wrapOffset;
    // Snapshot every layer's geometry at drag-start so we always apply pins
    // against the ORIGINAL positions and the ORIGINAL canvas dims. Without
    // this, the second mousemove sees the layer already stretched from the
    // first frame and the right/bottom offsets drift every frame — text and
    // bands grow faster than the canvas.
    const layerSnap = new Map(
      design.layers.map(l => [l.id, {
        x: l.x, y: l.y, w: l.w, h: l.h,
        syncCanvas: l.syncCanvas,
        pinSides: l.pinSides,
      }])
    );

    beginDrag(e, (dx, dy, mods) => {
      const r = resizeRect({ x: 0, y: 0, w: snap.w, h: snap.h }, mode, dx, dy, mods, 40);
      const nw = Math.round(r.w), nh = Math.round(r.h);

      // In manual zoom mode the user's chosen scale is fixed — only update
      // autoFit when we're in 'fit' mode. Recompute imperatively so the
      // wrap-offset compensation uses the right scale for the new dims.
      let newFit = snap.fit;
      if (zoomMode === 'fit') {
        const stageEl = canvasRef.current;
        if (stageEl) {
          const rect = stageEl.getBoundingClientRect();
          const margin = 100;
          const sx = (rect.width - margin * 2) / nw;
          const sy = (rect.height - margin * 2) / nh;
          newFit = Math.max(0.05, Math.min(4, sx, sy));
        }
      }

      // Screen-space width/height delta. Counter the grid's re-centering by
      // translating the wrap +Δ/2 in the dragged direction so the opposite
      // edge stays pinned. Alt (mirror) opts out: center-scaling instead.
      let offX = startOffset.x, offY = startOffset.y;
      if (!mods.alt) {
        const dW = nw * newFit - snap.w * snap.fit;
        const dH = nh * newFit - snap.h * snap.fit;
        if (mode.includes('e')) offX = startOffset.x + dW / 2;
        else if (mode.includes('w')) offX = startOffset.x - dW / 2;
        if (mode.includes('s')) offY = startOffset.y + dH / 2;
        else if (mode.includes('n')) offY = startOffset.y - dH / 2;
      }
      if (zoomMode === 'fit') setAutoFit(newFit);   // batched — no flicker
      setWrapOffset({ x: offX, y: offY });
      setDesign(d => ({
        ...d,
        width: nw,
        height: nh,
        layers: d.layers.map(l => {
          const s = layerSnap.get(l.id);
          if (!s) return l; // layer added after drag-start — leave alone
          // The bg carries its own stroke/radius — fill mode is the only sync.
          if (s.syncCanvas === 'fill') return { ...l, x: 0, y: 0, w: nw, h: nh };
          // Constraint anchors: compute new geometry from the SNAPSHOT against
          // the new canvas dims (not the live, already-stretched layer state).
          if (s.pinSides) {
            const pinned = applyPins(s, snap.w, snap.h, nw, nh);
            return { ...l, x: pinned.x, y: pinned.y, w: pinned.w, h: pinned.h };
          }
          return l;
        }),
      }));
    });
  }

  // ----- canvas → layer event router -----
  function onLayerPointerDown(layerId, e) {
    const layer = design.layers.find(l => l.id === layerId);
    if (!layer) return;
    // Locked layers (incl. the canvas-fill background) aren't selectable here —
    // pressing one starts a marquee so you can rubber-band over the artwork.
    if (layer.locked) { startMarquee(e); return; }
    setRightTab('properties');
    if (e.shiftKey) {
      // Toggle this layer in/out of the selection; don't start a drag.
      setSelectedIds(ids => ids.includes(layerId) ? ids.filter(i => i !== layerId) : [...ids, layerId]);
      return;
    }
    const inSelection = selectedIds.includes(layerId);
    const dragIds = inSelection ? selectedIds : [layerId];
    if (!inSelection) setSelectedIds([layerId]);
    if (dragIds.length > 1) startGroupDrag(e, dragIds);
    else startLayerDrag(e, layer);
  }
  function onCanvasPointerDown(e) {
    startMarquee(e);
  }

  // ----- keyboard -----
  useEffect(() => {
    function onKey(e) {
      const t = e.target;
      const inField = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA');

      // Undo / Redo work globally (also while a text input is focused, so
      // the user can undo their last typed character) — match standard
      // editor shortcuts on both Win/Linux (Ctrl) and macOS (Cmd).
      const mod = e.ctrlKey || e.metaKey;
      if (mod && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        if (e.shiftKey) redo(); else undo();
        return;
      }
      if (mod && (e.key === 'y' || e.key === 'Y')) {
        e.preventDefault(); redo(); return;
      }

      if (selectedIds.length === 0) return;
      if (inField) return;
      if (e.key === 'Escape') { setSelectedIds([]); return; }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault(); deleteSelected();
      } else if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        setDesign(d => ({
          ...d,
          layers: d.layers.map(l => (selectedIds.includes(l.id) && !l.locked) ? { ...l, x: l.x + dx, y: l.y + dy } : l),
        }));
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [selectedIds, deleteSelected, undo, redo]);

  // If undo/redo restores a design that no longer contains a selected layer,
  // prune the selection so handles + property panel don't dangle.
  useEffect(() => {
    setSelectedIds(ids => {
      const next = ids.filter(id => design.layers.some(l => l.id === id));
      return next.length === ids.length ? ids : next;
    });
  }, [design.layers]);

  // ----- fit-to-viewport (only effective when zoomMode === 'fit') -----
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const compute = () => {
      const rect = el.getBoundingClientRect();
      const margin = 100;
      const sx = (rect.width - margin * 2) / design.width;
      const sy = (rect.height - margin * 2) / design.height;
      setAutoFit(Math.max(0.05, Math.min(4, sx, sy)));
    };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(el);
    return () => ro.disconnect();
  }, [design.width, design.height]);

  // Measure where the label's (0,0) sits inside each ruler strip so the ticks
  // line up with the on-screen label regardless of centering, pan, or zoom.
  const computeRulers = useCallback(() => {
    const wrap = wrapRef.current, rt = rulerTopRef.current, rl = rulerLeftRef.current;
    if (!wrap || !rt || !rl) return;
    const w = wrap.getBoundingClientRect();
    const t = rt.getBoundingClientRect();
    const l = rl.getBoundingClientRect();
    setRulers({ originX: w.left - t.left, originY: w.top - l.top, topW: t.width, leftH: l.height });
  }, []);

  useEffect(() => {
    if (preview) { setRulers(null); return; }
    computeRulers();
    const stage = canvasRef.current;
    let raf = 0;
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; computeRulers(); }); };
    const ro = new ResizeObserver(() => computeRulers());
    if (stage) { stage.addEventListener('scroll', onScroll, { passive: true }); ro.observe(stage); }
    return () => {
      if (stage) stage.removeEventListener('scroll', onScroll);
      ro.disconnect();
      if (raf) cancelAnimationFrame(raf);
    };
  }, [preview, fit, wrapOffset, design.width, design.height, computeRulers]);

  // Zoom helpers — step through a fixed ladder of magnifications.
  const ZOOM_STEPS = [0.05, 0.1, 0.15, 0.25, 0.5, 0.75, 1.0, 1.25, 1.5, 2.0, 3.0, 4.0];
  function zoomIn() {
    const cur = fit;
    const next = ZOOM_STEPS.find(s => s > cur * 1.001) || ZOOM_STEPS[ZOOM_STEPS.length - 1];
    setZoomMode(next);
  }
  function zoomOut() {
    const cur = fit;
    const next = [...ZOOM_STEPS].reverse().find(s => s < cur * 0.999) || ZOOM_STEPS[0];
    setZoomMode(next);
  }

  // Cursor-anchored zoom: keep the label point under the mouse pinned while
  // the scale changes. We capture the point's label-space coordinates before
  // setting the new zoom, then on the next frame (after React commits) read
  // where that point landed and offset the stage's scroll to compensate.
  function zoomAt(clientX, clientY, factor) {
    const stage = canvasRef.current;
    const wrap = wrapRef.current;
    if (!stage || !wrap) return;
    const wrapRect = wrap.getBoundingClientRect();
    const labelX = (clientX - wrapRect.left) / fit;
    const labelY = (clientY - wrapRect.top) / fit;
    const oldZoom = fit;
    const newZoom = Math.max(0.05, Math.min(4, oldZoom * factor));
    if (newZoom === oldZoom) return;
    setZoomMode(newZoom);
    requestAnimationFrame(() => {
      const w = wrapRef.current;
      if (!w) return;
      const newRect = w.getBoundingClientRect();
      const newCursorScreenX = newRect.left + labelX * newZoom;
      const newCursorScreenY = newRect.top + labelY * newZoom;
      stage.scrollLeft += newCursorScreenX - clientX;
      stage.scrollTop  += newCursorScreenY - clientY;
    });
  }

  // Ctrl/Cmd + wheel → zoom; plain wheel falls through to overflow:auto scroll.
  // Must be a NATIVE non-passive listener: React's onWheel is registered as a
  // passive listener (React 17+), so calling preventDefault there is ignored
  // and the browser would also page-zoom. Re-runs on `fit` change so zoomAt
  // closes over the current scale.
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const handler = (e) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      zoomAt(e.clientX, e.clientY, factor);
    };
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, [fit]);

  // Pan: drag the stage's scroll with middle-mouse or Space + left-mouse.
  const spaceHeldRef = useRef(false);
  function startPan(e) {
    e.preventDefault();
    const stage = canvasRef.current;
    if (!stage) return;
    const x0 = e.clientX, y0 = e.clientY;
    const sl0 = stage.scrollLeft, st0 = stage.scrollTop;
    document.body.style.cursor = 'grabbing';
    function move(ev) {
      stage.scrollLeft = sl0 - (ev.clientX - x0);
      stage.scrollTop  = st0 - (ev.clientY - y0);
    }
    function up() {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      document.body.style.cursor = '';
    }
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  }
  function onStagePointerDown(e) {
    // Middle-mouse or Space+left-mouse → pan.
    if (e.button === 1 || (e.button === 0 && spaceHeldRef.current)) {
      startPan(e);
      return;
    }
    // Left-press on the empty stage (the padding around the label) → marquee.
    if (e.button === 0 && e.target === e.currentTarget) startMarquee(e);
  }

  // Track Space key so left-drag pans like a hand tool.
  useEffect(() => {
    function down(e) {
      if (e.code !== 'Space') return;
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      e.preventDefault();
      if (!spaceHeldRef.current) {
        spaceHeldRef.current = true;
        document.body.classList.add('space-pan');
      }
    }
    function up(e) {
      if (e.code !== 'Space') return;
      spaceHeldRef.current = false;
      document.body.classList.remove('space-pan');
    }
    document.addEventListener('keydown', down);
    document.addEventListener('keyup', up);
    return () => {
      document.removeEventListener('keydown', down);
      document.removeEventListener('keyup', up);
      document.body.classList.remove('space-pan');
    };
  }, []);

  // ----- export -----
  function doExport(kind, scale) {
    const svg = labelRef.current && labelRef.current.getSvg();
    if (!svg) return;
    // Block until ISO symbol fetches finish — otherwise pictoHref returns ''
    // and the export silently omits every pictogram layer.
    if (!symbolCache) {
      setExportMsg('Loading symbols — try again in a moment');
      setTimeout(() => setExportMsg(''), 2200);
      return;
    }
    const name = slug(docName);
    if (kind === 'svg') {
      exportSvg(svg, name);
      setExportMsg('Exported SVG');
      setTimeout(() => setExportMsg(''), 2200);
    } else {
      setExportMsg('Rendering PNG…');
      exportPng(svg, name, scale, (ok) => {
        setExportMsg(ok ? `Exported PNG @${scale}×` : `PNG too large at ${scale}× — try a smaller scale`);
        setTimeout(() => setExportMsg(''), 2600);
      });
    }
  }

  // ----- Shared panel blocks (reused across the new 4-zone layout) -----
  const bg = design.layers.find(l => l.syncCanvas === 'fill');

  const severityField = (
    <Field label="Severity">
      <div className="severity-grid">
        {Object.entries(SEVERITY).map(([id, s]) => (
          <button
            key={id}
            className={`severity ${design.severity === id ? 'on' : ''}`}
            onClick={() => setSeverity(id)}
            style={{
              background: design.severity === id ? s.band : 'transparent',
              color: design.severity === id ? s.bandInk : 'var(--ink)',
              borderColor: design.severity === id ? s.band : 'var(--line)',
            }}>
            <span className="sev-swatch" style={{ background: s.band, borderColor: s.bandInk }} />
            <span className="sev-word">{s.word}</span>
          </button>
        ))}
      </div>
    </Field>
  );

  const presetField = (
    <Field label="Common templates" hint="Replaces all layers with this format's starting set.">
      <div className="format-grid">
        {FORMATS
          .filter(f => !query || f.name.toLowerCase().includes(query.toLowerCase()))
          .map(f => (
            <button
              key={f.id}
              className={`format-tile ${design.format === f.id ? 'on' : ''}`}
              onClick={() => applyPreset(f.id)}>
              <FormatIcon id={f.id} active={design.format === f.id} />
              <span>{f.name}</span>
            </button>
          ))}
      </div>
    </Field>
  );

  const userPresetsField = (
    <Field label="Your presets" hint="Saved locally to this browser.">
      <Row>
        <input
          className="text-input"
          value={newPresetName}
          onChange={e => setNewPresetName(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') saveCurrentAsPreset(newPresetName || docName); }}
          placeholder={docName}
        />
        <button className="ghost"
                onClick={() => saveCurrentAsPreset(newPresetName || docName)}
                disabled={!(newPresetName.trim() || docName.trim())}>
          Save
        </button>
      </Row>
      {userPresets.length > 0 && (
        <div className="layer-list" style={{ marginTop: 8 }}>
          {userPresets.map(p => (
            <div key={p.id} className="layer-row" onClick={() => applyUserPreset(p.id)} title="Apply preset">
              <span className="layer-glyph">
                <svg width="14" height="14" viewBox="0 0 14 14">
                  <path d="M3 2h6l2 2v8H3z" fill="none" stroke="currentColor" strokeWidth="1.2" />
                </svg>
              </span>
              <span className="layer-name">{p.name}</span>
              <span className="layer-meta">{p.design.width}×{p.design.height}</span>
              <button className="icon-btn" title="Delete preset"
                      onClick={e => { e.stopPropagation(); deleteUserPreset(p.id); }}>×</button>
            </div>
          ))}
        </div>
      )}
    </Field>
  );

  const dimensionsBody = (
    <>
      <Row>
        <NumberInput value={design.width} onChange={v => setDesign(d => ({ ...d, width: Math.max(40, v) }))} min={40} max={4000} suffix="W" />
        <NumberInput value={design.height} onChange={v => setDesign(d => ({ ...d, height: Math.max(40, v) }))} min={40} max={4000} suffix="H" />
      </Row>
      <Row>
        <button className="ghost" onClick={() => {
          // applyUserPreset stores format:'custom' which isn't in FORMATS — guard.
          const f = FORMATS.find(x => x.id === design.format);
          if (!f) return;
          setDesign(d => ({ ...d, width: f.default[0], height: f.default[1] }));
          setWrapOffset({ x: 0, y: 0 });
        }}>Reset</button>
        <button className="ghost" onClick={() => {
          setDesign(d => ({ ...d, width: d.height, height: d.width }));
          setWrapOffset({ x: 0, y: 0 });
        }}>Swap</button>
      </Row>
      <Row>
        <button className="ghost" onClick={() => setWrapOffset({ x: 0, y: 0 })}>Center canvas</button>
      </Row>
      <div className="field-hint">Or drag the handles around the label.</div>
    </>
  );

  const canvasPropsFields = (
    <>
      <Section title="Dimensions">{dimensionsBody}</Section>
      {bg && (() => {
        const maxR = Math.floor(Math.min(design.width, design.height) / 2);
        return (
          <>
            <Section title="Background">
              <Field label="Fill">
                <ColorInput value={bg.fill === 'none' ? '#FFFFFF' : (bg.fill || '#FFFFFF')}
                            onChange={v => setLayer(bg.id, { fill: v, bindSeverity: null })} />
              </Field>
            </Section>
            <Section title="Appearance">
              <Field label="Border">
                <Row>
                  <ColorInput value={bg.stroke || '#000000'} onChange={v => setLayer(bg.id, { stroke: v })} />
                </Row>
                <Row>
                  <Slider value={bg.strokeWidth || 0} onChange={v => setLayer(bg.id, { strokeWidth: v })} min={0} max={40} step={0.5} />
                </Row>
              </Field>
              <Field label="Corner radius">
                <CornerRadius value={bg.radius || 0} onChange={v => setLayer(bg.id, { radius: v })} max={maxR} />
              </Field>
            </Section>
          </>
        );
      })()}
    </>
  );

  const layerStackField = (
    <Field label="Layer stack" hint="Top of list = front of label. Click to select.">
      <div className="layer-list">
        {design.layers.slice().reverse().map((l) => (
          <div
            key={l.id}
            className={`layer-row ${selectedIds.includes(l.id) ? 'on' : ''} ${l.hidden ? 'hidden' : ''} ${l.locked ? 'locked' : ''}`}
            onClick={e => {
              if (e.shiftKey) setSelectedIds(ids => ids.includes(l.id) ? ids.filter(i => i !== l.id) : [...ids, l.id]);
              else setSelectedIds([l.id]);
              setRightTab('properties');
            }}
          >
            <span className="layer-glyph"><LayerGlyph type={l.type} /></span>
            <span className="layer-name">{l.name || l.type}</span>
            <button className="icon-btn" title={l.hidden ? 'Show' : 'Hide'}
                    onClick={e => { e.stopPropagation(); setLayer(l.id, { hidden: !l.hidden }); }}>
              {l.hidden ? '◌' : '●'}
            </button>
            <button className="icon-btn" title={l.locked ? 'Unlock' : 'Lock'}
                    onClick={e => { e.stopPropagation(); setLayer(l.id, { locked: !l.locked }); }}>
              {l.locked ? '🔒' : '🔓'}
            </button>
            <button className="icon-btn" title="Bring forward"
                    disabled={l.locked}
                    onClick={e => { e.stopPropagation(); if (!l.locked) moveLayer(l.id, 'up'); }}>▲</button>
            <button className="icon-btn" title="Send back"
                    disabled={l.locked}
                    onClick={e => { e.stopPropagation(); if (!l.locked) moveLayer(l.id, 'down'); }}>▼</button>
            <button className="icon-btn" title={l.locked ? 'Unlock first to delete' : 'Delete'}
                    disabled={l.locked}
                    onClick={e => { e.stopPropagation(); if (!l.locked) deleteLayer(l.id); }}>×</button>
          </div>
        ))}
      </div>
    </Field>
  );

  const symbolsField = (
    <Field label="Symbols" hint="Click to apply to the selected symbol layer, or add a new one.">
      <div className="picto-grid">
        {Object.keys(PICTOGRAMS).map(id => (
          <PictoTile
            key={id}
            id={id}
            active={!!selectedLayer && selectedLayer.type === 'image' && selectedLayer.symbol === id}
            onClick={() => {
              if (selectedLayer && selectedLayer.type === 'image') {
                setLayer(selectedLayer.id, { symbol: id });
              } else {
                const nl = newLayer('image', design.width, design.height);
                if (nl) {
                  nl.symbol = id;
                  setDesign(d => ({ ...d, layers: [...d.layers, nl] }));
                  setSelectedIds([nl.id]);
                  setRightTab('properties');
                }
              }
            }}
            cache={symbolCache}
          />
        ))}
      </div>
    </Field>
  );

  const exportBody = (
    <>
      <Field label="Filename" hint="From the document title — rename it in the top bar.">
        <div className="export-filename">{slug(docName)}</div>
      </Field>
      <Field label="Vector">
        <button className="export-btn primary" onClick={() => doExport('svg')}>
          <span>Download SVG</span>
          <span className="ext">{slug(docName)}.svg</span>
        </button>
      </Field>
      <Field label="Raster" hint={`Native ${design.width} × ${design.height}px.`}>
        <div className="export-grid">
          {[1, 2, 3, 4].map(s => (
            <button key={s} className="export-btn" onClick={() => doExport('png', s)}>
              <span className="scale">{s}×</span>
              <span className="px">{design.width * s} × {design.height * s}</span>
            </button>
          ))}
        </div>
      </Field>
    </>
  );

  const railBtns = [
    { id: 'templates', title: 'Templates', kind: 'panel', icon: 'M2 2h5v5H2zM9 2h5v5H9zM2 9h5v5H2zM9 9h5v5H9z' },
    { id: 'layers', title: 'Layers', kind: 'panel', icon: 'M8 2l6 3-6 3-6-3zM2 8l6 3 6-3M2 11l6 3 6-3' },
    { id: 'text', title: 'Add text', kind: 'add', type: 'text', icon: 'M3 3h10v2M8 5v8M6 13h4' },
    { id: 'rect', title: 'Add rectangle', kind: 'add', type: 'rect', icon: 'M2.5 4h11v8h-11z' },
    { id: 'image', title: 'Add symbol', kind: 'add', type: 'image', icon: 'M8 2l6 11H2z' },
    { id: 'list', title: 'Add list', kind: 'add', type: 'bullets', icon: 'M2 4h2M6 4h8M2 8h2M6 8h8M2 12h2M6 12h8' },
    { id: 'line', title: 'Add line', kind: 'add', type: 'line', icon: 'M2 8h12' },
  ];

  // ----- Pixel rulers (top + left) -----
  const RULER = 26;
  let topRuler = null, leftRuler = null;
  if (rulers) {
    const { originX, originY, topW, leftH } = rulers;
    const step = niceStep(64 / fit);   // ~64px target spacing between labels
    const minor = step / 5;
    const fmt = step >= 1 ? (p => Math.round(p)) : (p => p.toFixed(1));
    const tickColor = 'var(--line-strong)';
    const band = 'rgba(220, 38, 38, .14)';

    const i0t = Math.ceil(((0 - originX) / fit) / minor);
    const i1t = Math.floor(((topW - originX) / fit) / minor);
    const topEls = [];
    if (selBounds) topEls.push(<rect key="b" x={originX + selBounds.x * fit} y="0" width={Math.max(0, selBounds.w * fit)} height={RULER} fill={band} />);
    for (let i = i0t; i <= i1t; i++) {
      const p = i * minor, x = originX + p * fit, major = i % 5 === 0;
      topEls.push(<line key={i} x1={x} y1={major ? RULER - 9 : RULER - 5} x2={x} y2={RULER} stroke={tickColor} />);
      if (major) topEls.push(<text key={'t' + i} x={x + 3} y="11" fontSize="9" fill="var(--muted)">{fmt(p)}</text>);
    }
    topRuler = <svg className="ruler-svg" width="100%" height={RULER}>{topEls}</svg>;

    const i0l = Math.ceil(((0 - originY) / fit) / minor);
    const i1l = Math.floor(((leftH - originY) / fit) / minor);
    const leftEls = [];
    if (selBounds) leftEls.push(<rect key="b" x="0" y={originY + selBounds.y * fit} width={RULER} height={Math.max(0, selBounds.h * fit)} fill={band} />);
    for (let i = i0l; i <= i1l; i++) {
      const p = i * minor, y = originY + p * fit, major = i % 5 === 0;
      leftEls.push(<line key={i} x1={major ? RULER - 9 : RULER - 5} y1={y} x2={RULER} y2={y} stroke={tickColor} />);
      if (major) leftEls.push(<text key={'t' + i} x="3" y={y - 3} fontSize="9" fill="var(--muted)">{fmt(p)}</text>);
    }
    leftRuler = <svg className="ruler-svg" width={RULER} height="100%">{leftEls}</svg>;
  }

  return (
    <div className={`app${preview ? ' is-preview' : ''}`}>
      {/* ---------- Top bar ---------- */}
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">
            <svg viewBox="0 0 24 24" width="20" height="20">
              <path d="M12 2 L22 20 L2 20 Z" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinejoin="round" />
              <rect x="11" y="9" width="2" height="6" fill="currentColor" />
              <circle cx="12" cy="17.5" r="1.2" fill="currentColor" />
            </svg>
          </div>
          <div>
            <div className="brand-name">Hazard Label Studio</div>
            <div className="brand-sub">Professional Label Designer</div>
          </div>
        </div>

        <div className="doc-bar">
          <input className="doc-name" value={docName} onChange={e => setDocName(e.target.value)} spellCheck={false} />
          <span className={`save-state ${saveState}`}>{saveState === 'saving' ? 'Saving…' : '✓ Saved'}</span>
        </div>

        <div className="topbar-actions">
          <div className="tb-group">
            <button className="icon-btn" title="Undo (Ctrl+Z)" onClick={undo}
                    disabled={editor.past.length === 0 && editor.design === lastCommittedDesign.current}>↶</button>
            <button className="icon-btn" title="Redo (Ctrl+Shift+Z)" onClick={redo}
                    disabled={editor.future.length === 0}>↷</button>
          </div>
          <button className={`btn-lg${preview ? ' on' : ''}`} onClick={() => setPreview(p => !p)}>
            {preview ? 'Exit preview' : 'Preview'}
          </button>
          <div className="export-wrap">
            <button className="btn-lg primary" onClick={() => setExportOpen(o => !o)}>Export ▾</button>
            {exportOpen && <div className="export-pop">{exportBody}</div>}
          </div>
        </div>
      </header>

      {/* ---------- Icon rail ---------- */}
      <nav className="rail">
        {railBtns.map(b => (
          <button
            key={b.id}
            className={`rail-btn${b.kind === 'panel' && leftPanel === b.id ? ' on' : ''}`}
            title={b.title}
            onClick={() => b.kind === 'panel' ? setLeftPanel(b.id) : addLayer(b.type)}>
            <svg viewBox="0 0 16 16" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
              <path d={b.icon} />
            </svg>
          </button>
        ))}
        <div className="rail-spacer" />
        <button className="rail-btn" title="Help & workflows" onClick={() => setHelpOpen(true)}>
          <svg viewBox="0 0 16 16" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
            <circle cx="8" cy="8" r="6.5" /><path d="M6.2 6.2a1.8 1.8 0 1 1 2.4 1.7c-.6.3-.9.7-.9 1.3M8 11.6v.01" />
          </svg>
        </button>
      </nav>

      {/* ---------- Left panel ---------- */}
      <aside className="leftpanel">
        {leftPanel === 'templates' && (
          <div className="lp-search">
            <input className="text-input" placeholder="Search templates…" value={query} onChange={e => setQuery(e.target.value)} />
          </div>
        )}

        <div className="panel">
          {leftPanel === 'templates' && (
            <>
              {severityField}
              {presetField}
              {userPresetsField}
            </>
          )}

          {leftPanel === 'layers' && layerStackField}
        </div>
      </aside>

      {/* ---------- Canvas ---------- */}
      <main className="canvas-area">
        <div className={`canvas-rulers${preview ? ' no-rulers' : ''}`}>
          {!preview && <div className="ruler-corner" />}
          {!preview && <div className="ruler ruler-top" ref={rulerTopRef}>{topRuler}</div>}
          {!preview && <div className="ruler ruler-left" ref={rulerLeftRef}>{leftRuler}</div>}
          <div
            className="canvas-stage"
            ref={canvasRef}
            onMouseDown={onStagePointerDown}
          >
          <div
            ref={wrapRef}
            className="label-wrap"
            style={{
              width: design.width * fit,
              height: design.height * fit,
              position: 'relative',
              transform: `translate(${wrapOffset.x}px, ${wrapOffset.y}px)`,
            }}
          >
            <div style={{
              transform: `scale(${fit})`,
              transformOrigin: 'top left',
              width: design.width,
              height: design.height,
            }}>
              <Label
                ref={labelRef}
                design={design}
                selectedId={selectedId}
                onLayerPointerDown={onLayerPointerDown}
                onCanvasPointerDown={onCanvasPointerDown}
              />
            </div>

            {/* Canvas dimension handles (hidden in preview) */}
            {!preview && (
              <div className="overlay">
                <Handles
                  kind="canvas"
                  box={{ x: 0, y: 0, w: design.width, h: design.height }}
                  fit={fit}
                  onHandleDown={(e, mode) => startCanvasResize(e, mode)}
                />
              </div>
            )}

            {/* Snap guides (only during Ctrl-drag) */}
            {snapGuides.length > 0 && (
              <div className="overlay">
                {snapGuides.map((g, i) => g.orient === 'v' ? (
                  <div key={`v${i}`} className="snap-guide v"
                       style={{ left: g.value * fit }} />
                ) : (
                  <div key={`h${i}`} className="snap-guide h"
                       style={{ top: g.value * fit }} />
                ))}
              </div>
            )}

            {/* Selected-layer handles + dimension chip */}
            {selectedLayer && !selectedLayer.locked && !preview && (
              <div className="overlay">
                <div className="dim-chip" style={{
                  left: (selectedLayer.x + selectedLayer.w / 2) * fit,
                  top: (selectedLayer.y + selectedLayer.h) * fit + 8,
                }}>
                  {Math.round(selectedLayer.w)} × {Math.round(selectedLayer.h)}
                </div>
                <Handles
                  kind="layer"
                  box={selectedLayer}
                  fit={fit}
                  rotation={selectedLayer.rotation || 0}
                  onHandleDown={(e, mode) => startLayerResize(e, mode)}
                />
              </div>
            )}

            {/* Multi-select: group bounding box + per-layer outlines */}
            {!preview && selectedIds.length >= 2 && selBounds && (
              <div className="overlay">
                {selectedLayers.map(l => (
                  <div key={l.id} className="sel-thin" style={{
                    left: l.x * fit, top: l.y * fit, width: l.w * fit, height: l.h * fit,
                    transform: l.rotation ? `rotate(${l.rotation}deg)` : undefined,
                    transformOrigin: 'center',
                  }} />
                ))}
                <div className="group-box" style={{
                  left: selBounds.x * fit, top: selBounds.y * fit,
                  width: selBounds.w * fit, height: selBounds.h * fit,
                }} />
              </div>
            )}

            {/* Marquee rubber-band */}
            {marquee && (
              <div className="overlay">
                <div className="marquee" style={{
                  left: marquee.x * fit, top: marquee.y * fit,
                  width: marquee.w * fit, height: marquee.h * fit,
                }} />
              </div>
            )}
          </div>
          </div>
        </div>

        {/* ---------- Align / arrange toolbar ---------- */}
        {editableSel.length >= 1 && !preview && (
          <div className="align-toolbar">
            <button className="icon-btn" title="Align left" onClick={() => alignLayer('left')}><AlignIcon axis="x" pos="start" /></button>
            <button className="icon-btn" title="Align horizontal center" onClick={() => alignLayer('cx')}><AlignIcon axis="x" pos="center" /></button>
            <button className="icon-btn" title="Align right" onClick={() => alignLayer('right')}><AlignIcon axis="x" pos="end" /></button>
            <span className="tb-sep" />
            <button className="icon-btn" title="Align top" onClick={() => alignLayer('top')}><AlignIcon axis="y" pos="start" /></button>
            <button className="icon-btn" title="Align vertical center" onClick={() => alignLayer('cy')}><AlignIcon axis="y" pos="center" /></button>
            <button className="icon-btn" title="Align bottom" onClick={() => alignLayer('bottom')}><AlignIcon axis="y" pos="end" /></button>
            {editableSel.length >= 3 && (
              <>
                <span className="tb-sep" />
                <button className="icon-btn" title="Distribute horizontally" onClick={() => distribute('x')}>
                  <svg viewBox="0 0 16 16" width="15" height="15">
                    <rect x="1.5" y="3" width="2.5" height="10" rx="1" fill="currentColor" />
                    <rect x="6.75" y="3" width="2.5" height="10" rx="1" fill="currentColor" />
                    <rect x="12" y="3" width="2.5" height="10" rx="1" fill="currentColor" />
                  </svg>
                </button>
                <button className="icon-btn" title="Distribute vertically" onClick={() => distribute('y')}>
                  <svg viewBox="0 0 16 16" width="15" height="15">
                    <rect x="3" y="1.5" width="10" height="2.5" rx="1" fill="currentColor" />
                    <rect x="3" y="6.75" width="10" height="2.5" rx="1" fill="currentColor" />
                    <rect x="3" y="12" width="10" height="2.5" rx="1" fill="currentColor" />
                  </svg>
                </button>
              </>
            )}
            <span className="tb-sep" />
            <button className="icon-btn" title="Duplicate" onClick={duplicateLayer}>
              <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.4">
                <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
                <path d="M10.5 5.5V4A1.5 1.5 0 0 0 9 2.5H4A1.5 1.5 0 0 0 2.5 4v5A1.5 1.5 0 0 0 4 10.5h1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <button className="icon-btn danger" title="Delete" onClick={deleteSelected}>
              <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.6 4.5l.6 8.4a1 1 0 0 0 1 .9h3.6a1 1 0 0 0 1-.9l.6-8.4" />
              </svg>
            </button>
          </div>
        )}

        <div className="canvas-bottom">
          <span className="dim-readout">{design.width} × {design.height}px</span>
          <span className="canvas-credit">Symbols are official ISO 7010 plates from Wikimedia Commons.</span>
          <div className="canvas-zoom">
            <button className={`icon-btn${zoomMode === 'fit' ? ' on' : ''}`} title="Fit to viewport" onClick={() => setZoomMode('fit')}>⤢</button>
            <button className="icon-btn" title="Zoom out" onClick={zoomOut}>−</button>
            <input
              className="zoom-slider"
              type="range" min={0.05} max={4} step={0.01}
              value={fit}
              onChange={e => setZoomMode(Number(e.target.value))}
              title="Zoom"
            />
            <button className="icon-btn" title="Zoom in" onClick={zoomIn}>+</button>
            <button className="zoom-pct" title="Reset to 100%" onClick={() => setZoomMode(1)}>{Math.round(fit * 100)}%</button>
          </div>
        </div>
      </main>

      {/* ---------- Right panel ---------- */}
      <aside className="rightpanel">
        <div className="rp-tabs">
          {[['properties', 'Properties'], ['layers', 'Layers'], ['symbols', 'Symbols']].map(([k, l]) => (
            <button key={k} className={rightTab === k ? 'on' : ''} onClick={() => setRightTab(k)}>{l}</button>
          ))}
        </div>
        <div className="panel">
          {rightTab === 'properties' && (
            selectedLayer ? (
              <PropertiesPanel
                layer={selectedLayer}
                onChange={patch => setLayer(selectedLayer.id, patch)}
                cache={symbolCache}
              />
            ) : selectedIds.length >= 2 ? (
              <div className="pad">
                <Field label={`${selectedIds.length} layers selected`}>
                  <div className="empty-note">
                    Align or distribute from the toolbar, or duplicate / delete.
                    Shift-click a layer to add or remove it from the selection.
                  </div>
                </Field>
              </div>
            ) : (
              <>{canvasPropsFields}</>
            )
          )}
          {rightTab === 'layers' && <div className="pad">{layerStackField}</div>}
          {rightTab === 'symbols' && <div className="pad">{symbolsField}</div>}
        </div>
      </aside>

      {exportMsg && <div className="export-msg toast">{exportMsg}</div>}
      {helpOpen && <HelpModal onClose={() => setHelpOpen(false)} />}
    </div>
  );
}

// ----------- Properties panel (per layer type) -----------
function PropertiesPanel({ layer, onChange, cache }) {
  // When the layer is locked, every property is read-only. Show a notice and
  // the lock toggle only — the user has to unlock the layer to edit anything.
  if (layer.locked) {
    return (
      <div className="pad">
        <Field label={layer.name || layer.type}>
          <div className="empty-note">
            This layer is locked. Unlock it to edit position, color, text, or any other property.
          </div>
        </Field>
        <Field label="Layer">
          <Row>
            <Seg
              value="locked"
              onChange={v => onChange({ locked: v === 'locked' })}
              options={[
                { value: 'free', label: 'Editable' },
                { value: 'locked', label: 'Locked' },
              ]}
            />
          </Row>
        </Field>
      </div>
    );
  }
  return (
    <>
      <Section title="Dimensions">
        <Field label="Name">
          <input className="text-input" value={layer.name || ''}
                 onChange={e => onChange({ name: e.target.value })} />
        </Field>
        <Field label="Position">
          <Row>
            <NumberInput value={Math.round(layer.x)} onChange={v => onChange({ x: v })} suffix="X" />
            <NumberInput value={Math.round(layer.y)} onChange={v => onChange({ y: v })} suffix="Y" />
          </Row>
          <Row>
            <NumberInput value={Math.round(layer.w)} onChange={v => onChange({ w: Math.max(1, v) })} suffix="W" />
            <NumberInput value={Math.round(layer.h)} onChange={v => onChange({ h: Math.max(1, v) })} suffix="H" />
          </Row>
          <Row>
            <NumberInput value={layer.rotation || 0} onChange={v => onChange({ rotation: v })} min={-180} max={180} suffix="°" />
          </Row>
        </Field>
      </Section>

      {layer.type === 'text' && <Section title="Typography"><TextProps layer={layer} onChange={onChange} /></Section>}
      {layer.type === 'bullets' && <Section title="List"><BulletsProps layer={layer} onChange={onChange} /></Section>}
      {layer.type === 'rect' && <Section title="Appearance"><RectProps layer={layer} onChange={onChange} /></Section>}
      {layer.type === 'polygon' && <Section title="Appearance"><PolygonProps layer={layer} onChange={onChange} /></Section>}
      {layer.type === 'image' && <Section title="Symbol"><ImageProps layer={layer} onChange={onChange} cache={cache} /></Section>}
      {layer.type === 'line' && <Section title="Appearance"><LineProps layer={layer} onChange={onChange} /></Section>}

      <Section title="Constraints" defaultOpen={false}>
        <Field label="Pin to canvas" hint="When the canvas resizes, the pinned edges stay anchored.">
          <PinSidesControl value={layer.pinSides} onChange={v => onChange({ pinSides: v })} />
        </Field>
        <Field label="Clip to canvas" hint="Crop this layer to the background's rounded shape.">
          <Seg
            value={layer.clipToCanvas ? 'on' : 'off'}
            onChange={v => onChange({ clipToCanvas: v === 'on' })}
            options={[{ value: 'off', label: 'No clip' }, { value: 'on', label: 'Clip' }]}
          />
        </Field>
      </Section>

      <Section title="Layer" defaultOpen={false}>
        <Row>
          <Seg
            value={layer.hidden ? 'hidden' : 'shown'}
            onChange={v => onChange({ hidden: v === 'hidden' })}
            options={[{ value: 'shown', label: 'Visible' }, { value: 'hidden', label: 'Hidden' }]}
          />
        </Row>
        <Row>
          <Seg
            value={layer.locked ? 'locked' : 'free'}
            onChange={v => onChange({ locked: v === 'locked' })}
            options={[{ value: 'free', label: 'Editable' }, { value: 'locked', label: 'Locked' }]}
          />
        </Row>
      </Section>
    </>
  );
}

function TextProps({ layer, onChange }) {
  return (
    <>
      <Field label="Text">
        <textarea className="text-input" rows={3}
                  value={layer.text || ''} onChange={e => onChange({ text: e.target.value })} />
      </Field>
      <Field label="Font">
        <Seg
          value={layer.fontFamily || 'sans'}
          onChange={v => onChange({ fontFamily: v })}
          options={[
            { value: 'sans', label: 'Sans' },
            { value: 'serif', label: 'Serif' },
            { value: 'mono', label: 'Mono' },
          ]}
        />
      </Field>
      <Field label="Size · weight">
        <Row>
          <NumberInput value={Math.round(layer.fontSize || 16)} onChange={v => onChange({ fontSize: v })} min={4} max={400} suffix="PX" />
          <Seg
            value={String(layer.fontWeight || 400)}
            onChange={v => onChange({ fontWeight: Number(v) })}
            options={[
              { value: '400', label: 'R' },
              { value: '700', label: 'B' },
              { value: '900', label: 'XB' },
            ]}
          />
        </Row>
      </Field>
      <Field label="Align">
        <Seg
          value={layer.align || 'start'}
          onChange={v => onChange({ align: v })}
          options={[
            { value: 'start', label: 'Left' },
            { value: 'middle', label: 'Center' },
            { value: 'end', label: 'Right' },
          ]}
        />
      </Field>
      <Field label="Style">
        <Row>
          <Seg
            value={layer.italic ? 'i' : 'r'}
            onChange={v => onChange({ italic: v === 'i' })}
            options={[{ value: 'r', label: 'Roman' }, { value: 'i', label: 'Italic' }]}
          />
          <Seg
            value={layer.uppercase ? 'u' : 'mc'}
            onChange={v => onChange({ uppercase: v === 'u' })}
            options={[{ value: 'mc', label: 'Mixed' }, { value: 'u', label: 'CAPS' }]}
          />
        </Row>
      </Field>
      <Field label="Tracking · line-height">
        <Row>
          <NumberInput value={Number(((layer.letterSpacing || 0)).toFixed(3))} onChange={v => onChange({ letterSpacing: v })} step={0.01} suffix="EM" />
          <NumberInput value={Number(((layer.lineHeight || 1.2)).toFixed(2))} onChange={v => onChange({ lineHeight: v })} step={0.05} suffix="LH" />
        </Row>
      </Field>
      <Field label="Color">
        <ColorInput value={layer.fill || '#000000'} onChange={v => onChange({ fill: v, bindSeverity: null })} />
      </Field>
    </>
  );
}

function BulletsProps({ layer, onChange }) {
  // Items can be a legacy string[] (older saved presets) or {id, text}[].
  // Normalize to the object shape so React keys stay stable across delete /
  // reorder — using the array index as a key here used to drop focus and
  // mis-route in-progress IME composition onto a different bullet.
  const items = (layer.items || []).map(b =>
    typeof b === 'string'
      ? { id: uid(), text: b }
      : { id: b.id || uid(), text: b.text || '' }
  );
  return (
    <>
      <Field label="Items">
        <div className="bullets">
          {items.map((b, i) => (
            <div className="bullet-row" key={b.id}>
              <span className="bullet-dot">•</span>
              <input
                className="text-input"
                value={b.text}
                onChange={e => onChange({
                  items: items.map((x, j) => j === i ? { ...x, text: e.target.value } : x),
                })}
                placeholder={`Item ${i + 1}`}
              />
              <button className="icon-btn"
                      onClick={() => onChange({ items: items.filter((_, j) => j !== i) })}>×</button>
            </div>
          ))}
          <button className="ghost dashed"
                  onClick={() => onChange({ items: [...items, { id: uid(), text: '' }] })}>
            + Add item
          </button>
        </div>
      </Field>
      <Field label="Font">
        <Seg
          value={layer.fontFamily || 'sans'}
          onChange={v => onChange({ fontFamily: v })}
          options={[
            { value: 'sans', label: 'Sans' },
            { value: 'serif', label: 'Serif' },
            { value: 'mono', label: 'Mono' },
          ]}
        />
      </Field>
      <Field label="Size">
        <NumberInput value={Math.round(layer.fontSize || 16)} onChange={v => onChange({ fontSize: v })} min={4} max={120} suffix="PX" />
      </Field>
      <Field label="Color">
        <ColorInput value={layer.fill || '#000000'} onChange={v => onChange({ fill: v, bindSeverity: null })} />
      </Field>
    </>
  );
}

function RectProps({ layer, onChange }) {
  const maxR = Math.floor(Math.min(layer.w, layer.h) / 2);
  return (
    <>
      <Field label="Fill">
        <ColorInput value={layer.fill === 'none' ? '#FFFFFF' : (layer.fill || '#000000')}
                    onChange={v => onChange({ fill: v, bindSeverity: null })} />
        <div className="row" style={{ marginTop: 6 }}>
          <Seg
            value={layer.fill === 'none' ? 'none' : 'on'}
            onChange={v => onChange({ fill: v === 'none' ? 'none' : (layer.fill === 'none' ? '#FFFFFF' : layer.fill), bindSeverity: null })}
            options={[{ value: 'on', label: 'Filled' }, { value: 'none', label: 'None' }]}
          />
        </div>
      </Field>
      <Field label="Stroke">
        <ColorInput value={layer.stroke || '#000000'} onChange={v => onChange({ stroke: v })} />
        <Row><Slider value={layer.strokeWidth || 0} onChange={v => onChange({ strokeWidth: v })} min={0} max={40} step={0.5} /></Row>
        <Row>
          <Seg
            value={layer.strokeOnTop ? 'top' : 'normal'}
            onChange={v => onChange({ strokeOnTop: v === 'top' })}
            options={[
              { value: 'normal', label: 'Inline' },
              { value: 'top', label: 'On top' },
            ]}
          />
        </Row>
      </Field>
      <Field label="Corner radius">
        <CornerRadius value={layer.radius || 0} onChange={v => onChange({ radius: v })} max={maxR} />
      </Field>
    </>
  );
}

function ImageProps({ layer, onChange, cache }) {
  return (
    <>
      <Field label="Symbol" hint="Official ISO 7010 plates.">
        <div className="picto-grid">
          {Object.keys(PICTOGRAMS).map(id => (
            <PictoTile
              key={id}
              id={id}
              active={layer.symbol === id}
              onClick={() => onChange({ symbol: id })}
              cache={cache}
            />
          ))}
        </div>
      </Field>
      <Field label="Aspect">
        <Seg
          value={layer.preserveAspect === false ? 'stretch' : 'keep'}
          onChange={v => onChange({ preserveAspect: v === 'keep' })}
          options={[{ value: 'keep', label: 'Preserve' }, { value: 'stretch', label: 'Stretch' }]}
        />
      </Field>
    </>
  );
}

function PolygonProps({ layer, onChange }) {
  return (
    <>
      <Field label="Fill">
        <ColorInput value={layer.fill === 'none' ? '#FFFFFF' : (layer.fill || '#000000')}
                    onChange={v => onChange({ fill: v, bindSeverity: null })} />
        <div className="row" style={{ marginTop: 6 }}>
          <Seg
            value={layer.fill === 'none' ? 'none' : 'on'}
            onChange={v => onChange({ fill: v === 'none' ? 'none' : (layer.fill === 'none' ? '#FFFFFF' : layer.fill), bindSeverity: null })}
            options={[{ value: 'on', label: 'Filled' }, { value: 'none', label: 'None' }]}
          />
        </div>
      </Field>
      <Field label="Stroke">
        <ColorInput value={layer.stroke || '#000000'} onChange={v => onChange({ stroke: v })} />
        <Row><NumberInput value={layer.strokeWidth || 0} onChange={v => onChange({ strokeWidth: v })} min={0} max={40} step={0.5} suffix="PX" /></Row>
      </Field>
    </>
  );
}

function LineProps({ layer, onChange }) {
  return (
    <>
      <Field label="Color">
        <ColorInput value={layer.stroke || '#000000'} onChange={v => onChange({ stroke: v })} />
      </Field>
      <Field label="Weight">
        <NumberInput value={layer.strokeWidth || 2} onChange={v => onChange({ strokeWidth: v })} min={0.5} max={40} step={0.5} suffix="PX" />
      </Field>
      <Field label="Dash">
        <Seg
          value={layer.dasharray ? 'dash' : 'solid'}
          onChange={v => onChange({ dasharray: v === 'dash' ? '8 6' : null })}
          options={[{ value: 'solid', label: 'Solid' }, { value: 'dash', label: 'Dashed' }]}
        />
      </Field>
    </>
  );
}
