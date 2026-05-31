// Label Studio — layer-based label editor.
import { useState, useRef, useEffect, useCallback, useMemo, useId } from 'react';
import { SEVERITY, FONTS, FORMATS, PRESETS, newLayer, starPoints, Label } from './Label.jsx';
import { PICTOGRAMS } from './pictograms.js';
import { loadSymbols } from './symbols.js';
import { BARCODE_VARIANTS, sanitizeCode39 } from './barcode.js';
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
// Layer types the renderer knows how to draw — used to validate restored data.
const KNOWN_LAYER_TYPES = new Set(['rect', 'text', 'bullets', 'image', 'line', 'polygon', 'ellipse', 'barcode']);
// Turn a free-text title into a safe file base: "High Voltage Label" → "high-voltage-label".
function slug(name) {
  const s = (name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return s || 'label';
}
// A restored design (from the autosave OR a saved user preset) is safe to
// render only if the canvas dimensions are finite and every layer has a known
// type and finite geometry — a missing/unknown type or non-finite geometry
// would feed NaN into the SVG transform/path and silently break the canvas.
// Both restore paths gate on this single predicate.
function isRenderableDesign(d) {
  return !!(d && Array.isArray(d.layers) && d.layers.length
    && Number.isFinite(d.width) && Number.isFinite(d.height)
    && d.layers.every(l => l && KNOWN_LAYER_TYPES.has(l.type)
        && ['x', 'y', 'w', 'h'].every(k => Number.isFinite(l[k]))));
}

// `locked` means "do not edit this layer"; `stackLocked` means "do not cross
// this layer while reordering". Legacy saved designs did not have stackLocked,
// so the synced canvas fill remains a boundary by role.
function isStackBoundary(l) {
  return !!(l && (l.stackLocked || l.syncCanvas === 'fill'));
}
function canMoveInStack(l) {
  return !!(l && !l.locked && !isStackBoundary(l));
}
function uniqueIds(ids) {
  const seen = new Set();
  return (ids || []).filter(id => {
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}
function stackSegments(layers) {
  const segments = [];
  let start = 0;
  for (let i = 0; i < layers.length; i++) {
    // Locked layers split segments too, so drags cannot slide a layer past them.
    if (!canMoveInStack(layers[i])) {
      if (start < i) segments.push({ start, end: i });
      start = i + 1;
    }
  }
  if (start < layers.length) segments.push({ start, end: layers.length });
  return segments;
}
function segmentForIndex(layers, index) {
  return stackSegments(layers).find(s => s.start <= index && index < s.end) || null;
}
function segmentForSlot(layers, slot) {
  return stackSegments(layers).find(s => s.start <= slot && slot <= s.end) || null;
}
function sameSegment(a, b) {
  return !!(a && b && a.start === b.start && a.end === b.end);
}
function sameStackOrder(a, b) {
  return a.length === b.length && a.every((layer, i) => layer.id === b[i].id);
}
function stepStackLayers(layers, ids, dir) {
  const movable = uniqueIds(ids).filter(id => {
    const l = layers.find(x => x.id === id);
    return canMoveInStack(l);
  });
  if (!movable.length) return layers;

  // Only fellow movers block a swap; locked/boundary layers are handled below.
  const blockers = new Set(movable);
  const next = layers.slice();
  const idxOf = id => next.findIndex(l => l.id === id);
  const ordered = movable.slice().sort((a, b) => idxOf(a) - idxOf(b));
  const sequence = dir === 'up' ? ordered.reverse() : ordered;
  let moved = false;

  for (const id of sequence) {
    const i = idxOf(id);
    const j = dir === 'up' ? i + 1 : i - 1;
    if (j < 0 || j >= next.length) continue;
    // Do not cross a stack boundary, a user-locked layer, or a fellow mover.
    if (isStackBoundary(next[j]) || next[j].locked || blockers.has(next[j].id)) continue;
    [next[i], next[j]] = [next[j], next[i]];
    moved = true;
  }

  return moved ? next : layers;
}
function insertStackLayers(layers, ids, targetId, placement) {
  const targetIndex = layers.findIndex(l => l.id === targetId);
  if (targetIndex < 0) return layers;

  const targetSlot = placement === 'after' ? targetIndex + 1 : targetIndex;
  const targetSegment = segmentForSlot(layers, targetSlot);
  if (!targetSegment) return layers;

  const movableIds = uniqueIds(ids).filter(id => {
    const index = layers.findIndex(l => l.id === id);
    if (index < 0 || !canMoveInStack(layers[index])) return false;
    return sameSegment(segmentForIndex(layers, index), targetSegment);
  });
  if (!movableIds.length || movableIds.includes(targetId)) return layers;

  const moveSet = new Set(movableIds);
  const moving = layers.filter(l => moveSet.has(l.id));
  const rest = layers.filter(l => !moveSet.has(l.id));
  const restTargetIndex = rest.findIndex(l => l.id === targetId);
  if (restTargetIndex < 0) return layers;

  let insertAt = placement === 'after' ? restTargetIndex + 1 : restTargetIndex;
  const restSegment = segmentForSlot(rest, insertAt);
  if (!restSegment) return layers;
  insertAt = Math.max(restSegment.start, Math.min(restSegment.end, insertAt));

  const next = rest.slice();
  next.splice(insertAt, 0, ...moving);
  return sameStackOrder(layers, next) ? layers : next;
}
function moveStackLayers(layers, ids, action) {
  if (!action || !ids || !ids.length) return layers;
  if (action.kind === 'insert') {
    return insertStackLayers(layers, ids, action.targetId, action.placement);
  }
  if (action.kind === 'step') {
    return stepStackLayers(layers, ids, action.dir);
  }
  if (action.kind === 'edge') {
    const dir = action.to === 'front' ? 'up' : 'down';
    let next = layers;
    for (let guard = 0; guard < layers.length * layers.length; guard++) {
      const moved = stepStackLayers(next, ids, dir);
      if (moved === next) break;
      next = moved;
    }
    return next;
  }
  return layers;
}

// Restore the last working design from localStorage. Returns null when nothing
// is stored or the payload is unusable, so the caller falls back to a preset.
function loadSavedDesign() {
  try {
    const raw = localStorage.getItem(DESIGN_AUTOSAVE_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw);
    if (isRenderableDesign(d)) return d;
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
// Rasterize the live SVG to a PNG blob at `scale`. onBlob(blob|null). Shared by
// PNG export (download) and copy-to-clipboard. Always revokes the object URL.
function svgToPngBlob(svgEl, scale, onBlob) {
  const str = svgToString(svgEl);
  const w = parseFloat(svgEl.getAttribute('width'));
  const h = parseFloat(svgEl.getAttribute('height'));
  const url = URL.createObjectURL(new Blob([str], { type: 'image/svg+xml;charset=utf-8' }));
  const done = (b) => { URL.revokeObjectURL(url); onBlob(b); };
  const img = new Image();
  img.onload = () => {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(w * scale);
      canvas.height = Math.round(h * scale);
      const ctx = canvas.getContext('2d');
      if (!ctx) { done(null); return; }
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      // An over-large canvas (e.g. big label @4×) yields a null blob.
      canvas.toBlob(b => done(b), 'image/png');
    } catch {
      done(null);
    }
  };
  img.onerror = () => done(null);
  img.src = url;
}
function exportPng(svgEl, name, scale, onDone) {
  svgToPngBlob(svgEl, scale, (b) => {
    if (!b) { if (onDone) onDone(false); return; }
    download(b, `${name}@${scale}x.png`);
    if (onDone) onDone(true);
  });
}

// ----------- UI primitives -----------
function Field({ label, hint, children }) {
  // Expose the field's label/hint to assistive tech as a labelled group, since
  // the visible label is a <div> (not a <label htmlFor>) and a field can wrap
  // several controls. Screen readers then announce the field name on entry.
  const labelId = useId();
  const hintId = useId();
  return (
    <div className="field" role="group"
         aria-labelledby={label ? labelId : undefined}
         aria-describedby={hint ? hintId : undefined}>
      {label && <div className="field-label" id={labelId}>{label}</div>}
      {children}
      {hint && <div className="field-hint" id={hintId}>{hint}</div>}
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
function K({ children }) { return <kbd>{children}</kbd>; }
function Seg({ value, onChange, options }) {
  return (
    <div className="seg">
      {options.map(o => (
        <button key={o.value} className={value === o.value ? 'on' : ''}
                aria-pressed={value === o.value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
function NumberInput({ value, onChange, min, max, step = 1, suffix, ariaLabel, title, live = true }) {
  // While the field is focused we show a local draft string of exactly what the
  // user types. Clamping to [min,max] happens on commit (blur / Enter), NOT on
  // every keystroke — otherwise typing "1" on the way to "100" snaps up to the
  // minimum and the following digits append to it (40 -> 400). See draft below.
  // live=false suppresses per-keystroke onChange entirely (commit only on
  // blur/Enter) — used where a commit does expensive work (canvas resize
  // re-anchors every layer), so we don't run it on each intermediate digit.
  const [draft, setDraft] = useState(null);
  const display = draft != null ? draft : value;
  // Custom steppers replace the native spinner. preventDefault on mousedown keeps
  // the input from blurring so an in-progress draft is stepped, not discarded.
  const bump = (dir) => {
    const base = Number(draft != null ? draft : value);
    let n = (Number.isFinite(base) ? base : 0) + dir * step;
    if (max != null) n = Math.min(max, n);
    if (min != null) n = Math.max(min, n);
    n = Math.round(n * 1e6) / 1e6;   // tidy float drift for fractional steps
    setDraft(null);
    onChange(n);
  };
  return (
    <div className="num-input" title={title}>
      <input type="number" value={display} min={min} max={max} step={step}
             aria-label={ariaLabel || suffix || undefined}
             onChange={e => {
               const raw = e.target.value;
               setDraft(raw);
               // Live preview while typing, bounded only by max so the value can
               // pass through sub-min states ("1") without snapping. The min is
               // enforced on blur.
               if (!live) return;
               if (raw === '' || raw === '-') return;
               const n = Number(raw);
               if (Number.isFinite(n)) onChange(max != null ? Math.min(max, n) : n);
             }}
             onBlur={e => {
               const n = Number(e.target.value);
               if (Number.isFinite(n)) {
                 let r = n;
                 if (max != null) r = Math.min(max, r);
                 if (min != null) r = Math.max(min, r);
                 onChange(r);
               }
               setDraft(null);   // revert to the committed value
             }}
             onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }} />
      {suffix && <span className="num-suffix">{suffix}</span>}
      <span className="num-steppers" aria-hidden="true">
        <button type="button" tabIndex={-1} className="num-step" aria-label="Increment"
                onMouseDown={e => e.preventDefault()} onClick={() => bump(1)}>
          <svg viewBox="0 0 12 12" width="9" height="9"><path d="M2.5 7.5 6 4l3.5 3.5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
        <button type="button" tabIndex={-1} className="num-step" aria-label="Decrement"
                onMouseDown={e => e.preventDefault()} onClick={() => bump(-1)}>
          <svg viewBox="0 0 12 12" width="9" height="9"><path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
      </span>
    </div>
  );
}
// CSS mix-blend-mode values offered per layer. 'normal' clears the property.
const BLEND_MODES = [
  ['normal', 'Normal'], ['multiply', 'Multiply'], ['screen', 'Screen'], ['overlay', 'Overlay'],
  ['darken', 'Darken'], ['lighten', 'Lighten'], ['color-dodge', 'Color dodge'], ['color-burn', 'Color burn'],
  ['hard-light', 'Hard light'], ['soft-light', 'Soft light'], ['difference', 'Difference'], ['exclusion', 'Exclusion'],
  ['hue', 'Hue'], ['saturation', 'Saturation'], ['color', 'Color'], ['luminosity', 'Luminosity'],
];
// Standard safety / signage colours offered as one-click swatches in every
// colour picker (severity bands, ISO green, fire red, and neutrals).
const STANDARD_COLORS = [
  '#C8102E', '#F36F21', '#FFD200', '#1057A8', '#0E7C4E', '#237F52',
  '#9B2423', '#000000', '#1a1814', '#6b7280', '#FFFFFF',
];

function ColorInput({ value, onChange, ariaLabel = 'Color' }) {
  const cur = (value || '').toLowerCase();
  return (
    <div className="color-input">
      <div className="color-input-row">
        <input type="color" value={value || '#000000'} aria-label={`${ariaLabel} swatch`}
               onChange={e => onChange(e.target.value)} />
        <input type="text" value={value || ''} aria-label={`${ariaLabel} hex value`}
               onChange={e => onChange(e.target.value)} spellCheck={false} />
      </div>
      <div className="color-swatches">
        {STANDARD_COLORS.map(c => (
          <button key={c} type="button" title={c} aria-label={`Set colour ${c}`}
                  className={`swatch${cur === c.toLowerCase() ? ' on' : ''}`}
                  style={{ background: c }} onClick={() => onChange(c)} />
        ))}
      </div>
    </div>
  );
}

// Range slider with an attached numeric readout/input. Replaces NumberInput
// where a sweep feels better than typing (radius, opacity-like dials, etc.).
function Slider({ value, onChange, min = 0, max = 100, step = 1, label, ariaLabel }) {
  const name = label || ariaLabel || undefined;
  // Safe coercion: preserves a literal 0 (which `Number(value) || 0` would
  // also produce, but distinguishes NaN/undefined explicitly).
  const raw = Number(value);
  const v = Number.isFinite(raw) ? raw : 0;
  // Display precision matches step granularity — for step=0.5 we show 2.5,
  // not Math.round(2.5)=3 which would silently disagree with stored state.
  const display = Number.isInteger(step) ? Math.round(v) : Number(v.toFixed(2));
  const clamp = (n) => Math.min(max, Math.max(min, n));
  // The range track can never go out of bounds, so it clamps live. The numeric
  // companion holds a local draft while focused and only clamps to [min,max] on
  // commit (blur / Enter) — clamping mid-keystroke corrupts typed values when
  // min > 0 (the same snap-to-min bug as NumberInput).
  const [draft, setDraft] = useState(null);
  return (
    <div className={`slider${label ? ' has-label' : ''}`}>
      {label && <span className="slider-label">{label}</span>}
      <input
        className="slider-range"
        type="range"
        aria-label={name}
        value={Math.min(max, Math.max(min, v))}
        onChange={e => { const n = Number(e.target.value); if (Number.isFinite(n)) onChange(clamp(n)); }}
        min={min} max={max} step={step}
      />
      <input
        className="slider-num"
        type="number"
        aria-label={name ? `${name} value` : undefined}
        value={draft != null ? draft : display}
        onChange={e => {
          const next = e.target.value;
          setDraft(next);
          if (next === '' || next === '-') return;
          const n = Number(next);
          if (Number.isFinite(n)) onChange(Math.min(max, n));   // upper bound live; min on blur
        }}
        onBlur={e => {
          const n = Number(e.target.value);
          if (Number.isFinite(n)) onChange(clamp(n));
          setDraft(null);
        }}
        onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
        min={min} max={max} step={step}
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
    // Center and edge pins on the same axis are mutually exclusive: a layer
    // either tracks the centre OR keeps an edge offset, not both. Clear the
    // conflicting pins so the UI can never express an ambiguous constraint.
    if (next[side]) {
      if (side === 'centerX') { next.left = false; next.right = false; }
      else if (side === 'left' || side === 'right') next.centerX = false;
      else if (side === 'centerY') { next.top = false; next.bottom = false; }
      else if (side === 'top' || side === 'bottom') next.centerY = false;
    }
    // Strip empty so the layer doesn't carry meaningless { } around.
    const any = next.top || next.right || next.bottom || next.left || next.centerX || next.centerY;
    onChange(any ? next : null);
  }
  const sides = [
    { id: 'top',     label: 'Top' },
    { id: 'right',   label: 'Right' },
    { id: 'bottom',  label: 'Bottom' },
    { id: 'left',    label: 'Left' },
    { id: 'centerX', label: 'Center ↔' },
    { id: 'centerY', label: 'Center ↕' },
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
        <div className={`pin-cline pin-cx ${v.centerX ? 'on' : ''}`}
             onClick={() => toggle('centerX')} title="Center horizontally" />
        <div className={`pin-cline pin-cy ${v.centerY ? 'on' : ''}`}
             onClick={() => toggle('centerY')} title="Center vertically" />
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
// Compact per-corner style toggle: shows a box with that corner rounded or
// chamfered (oriented to the corner) and flips between the two on click.
function CornerStyleBtn({ corner, style, onToggle }) {
  const chamfer = style === 'chamfer';
  // Rotate a top-left glyph to the target corner: tl 0°, tr 90°, br 180°, bl 270°.
  const rot = { tl: 0, tr: 90, br: 180, bl: 270 }[corner] || 0;
  const d = chamfer ? 'M3 13 V7 L7 3 H13 V13 Z' : 'M3 13 V7 A4 4 0 0 1 7 3 H13 V13 Z';
  return (
    <button type="button" className="corner-style-btn"
            title={`${corner.toUpperCase()}: ${chamfer ? 'chamfer' : 'round'} — click to toggle`}
            aria-label={`${corner.toUpperCase()} corner: ${chamfer ? 'chamfer' : 'round'}`}
            onClick={onToggle}>
      <svg width="16" height="16" viewBox="0 0 16 16">
        <path d={d} fill="none" stroke="currentColor" strokeWidth="1.4"
              strokeLinejoin="round" transform={`rotate(${rot} 8 8)`} />
      </svg>
    </button>
  );
}

function CornerRadius({ value, onChange, max, corner, onCorner }) {
  const linked = typeof value === 'number' || value == null;
  const cap = Math.max(0, max);
  const v = linked
    ? { tl: value || 0, tr: value || 0, br: value || 0, bl: value || 0 }
    : { tl: value.tl || 0, tr: value.tr || 0, br: value.br || 0, bl: value.bl || 0 };

  const norm = (x) => (x === 'chamfer' ? 'chamfer' : 'round');
  const styleOf = (k) => norm(corner && typeof corner === 'object' ? corner[k] : corner);

  function setCorner(k, n) {
    onChange({ ...v, [k]: Math.max(0, n) });
  }
  // Set one corner's style, collapsing back to a single string (or null for the
  // all-round default) when every corner ends up the same.
  function setStyle(k, style) {
    if (!onCorner) return;
    const cur = corner && typeof corner === 'object'
      ? { ...corner } : { tl: corner, tr: corner, br: corner, bl: corner };
    cur[k] = style;
    const s = { tl: norm(cur.tl), tr: norm(cur.tr), br: norm(cur.br), bl: norm(cur.bl) };
    const allSame = s.tl === s.tr && s.tr === s.br && s.br === s.bl;
    onCorner(allSame ? (s.tl === 'chamfer' ? 'chamfer' : null) : s);
  }
  function toggleLink() {
    if (linked) {
      onChange({ ...v });                       // split sizes
    } else {
      const allSame = v.tl === v.tr && v.tr === v.br && v.br === v.bl;
      if (!allSame) {
        const ok = window.confirm('Link corners will reset all four to the top-left value. Continue?');
        if (!ok) return;
      }
      onChange(Math.round(v.tl));               // collapse size to top-left
      if (onCorner) onCorner(styleOf('tl') === 'chamfer' ? 'chamfer' : null); // collapse style too
    }
  }

  return (
    <div className="corner-radius">
      {linked ? (
        <>
          {onCorner && (
            <Seg
              value={styleOf('tl')}
              onChange={c => onCorner(c === 'chamfer' ? 'chamfer' : null)}
              options={[{ value: 'round', label: 'Round' }, { value: 'chamfer', label: 'Chamfer' }]}
            />
          )}
          <Slider label="All" value={v.tl} onChange={n => onChange(n)} max={cap} />
        </>
      ) : (
        ['tl', 'tr', 'bl', 'br'].map(k => (
          <div className="corner-row" key={k}>
            {onCorner && (
              <CornerStyleBtn corner={k} style={styleOf(k)}
                              onToggle={() => setStyle(k, styleOf(k) === 'chamfer' ? 'round' : 'chamfer')} />
            )}
            <Slider label={k.toUpperCase()} value={v[k]} onChange={n => setCorner(k, n)} max={cap} />
          </div>
        ))
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
    case 'ghs-label':
      return (<svg viewBox={`0 0 ${w} ${h}`} width={w} height={h}>
        <rect x={w / 2 - 10} y={h / 2 - 10} width="20" height="20" transform={`rotate(45 ${w / 2} ${h / 2})`}
              fill="#fff" stroke={active ? '#C8102E' : ink} strokeWidth="2.4" strokeLinejoin="round" />
        <rect x={w / 2 - 1} y={h / 2 - 6} width="2" height="6" fill={ink} />
        <circle cx={w / 2} cy={h / 2 + 5} r="1.2" fill={ink} />
      </svg>);
    case 'ppe':
      return (<svg viewBox={`0 0 ${w} ${h}`} width={w} height={h}>
        <rect x="2" y="2" width={w - 4} height={h - 4} fill="none" stroke={ink} strokeWidth="1.2" />
        <circle cx={w / 2} cy={h / 2 + 1} r="10" fill={active ? '#1057A8' : '#bdb398'} />
        <circle cx={w / 2} cy={h / 2 - 3} r="2.8" fill="#fff" />
        <path d={`M${w / 2 - 4.5} ${h / 2 + 6} a4.5 4.5 0 0 1 9 0 z`} fill="#fff" />
      </svg>);
    case 'fire-point':
      return (<svg viewBox={`0 0 ${w} ${h}`} width={w} height={h}>
        <rect x="2" y="2" width={w - 4} height={h - 4} fill={active ? '#9B2423' : '#d8c2bc'} />
        <rect x={w / 2 - 3.5} y={h / 2 - 7} width="7" height="13" rx="2" fill="#fff" />
        <rect x={w / 2 - 0.8} y={h / 2 - 10} width="1.6" height="4" fill="#fff" />
        <rect x={w / 2 + 1} y={h / 2 - 9.5} width="4" height="1.6" fill="#fff" />
      </svg>);
    case 'first-aid':
      return (<svg viewBox={`0 0 ${w} ${h}`} width={w} height={h}>
        <rect x="2" y="2" width={w - 4} height={h - 4} fill={active ? '#237F52' : '#bcd8c8'} />
        <rect x={w / 2 - 2.5} y={h / 2 - 8} width="5" height="16" fill="#fff" />
        <rect x={w / 2 - 8} y={h / 2 - 2.5} width="16" height="5" fill="#fff" />
      </svg>);
    case 'prohibition':
      return (<svg viewBox={`0 0 ${w} ${h}`} width={w} height={h}>
        <rect x="2" y="2" width={w - 4} height={h - 4} fill="none" stroke={ink} strokeWidth="1.2" />
        <circle cx={w / 2} cy={h / 2} r="10" fill="none" stroke={active ? '#C8102E' : '#bdb398'} strokeWidth="2.6" />
        <line x1={w / 2 - 7.1} y1={h / 2 - 7.1} x2={w / 2 + 7.1} y2={h / 2 + 7.1} stroke={active ? '#C8102E' : '#bdb398'} strokeWidth="2.6" />
      </svg>);
    case 'barcode-label':
      return (<svg viewBox={`0 0 ${w} ${h}`} width={w} height={h}>
        <rect x="2" y="2" width={w - 4} height={h - 4} fill="none" stroke={ink} strokeWidth="1.2" />
        {[7, 10, 12, 16, 19, 23, 26, 30, 33, 37, 40].map((x, i) => (
          <rect key={i} x={x} y="9" width={i % 3 === 0 ? 2 : 1} height="14" fill={ink} />))}
        <rect x={w / 2 - 7} y="27" width="14" height="3" fill={accent} />
      </svg>);
    case 'asset-tag':
      return (<svg viewBox={`0 0 ${w} ${h}`} width={w} height={h}>
        <rect x="3" y="4" width={w - 6} height={h - 8} rx="3" fill="none" stroke={ink} strokeWidth="1.2" />
        <rect x="4" y="5" width={w - 8} height="7" rx="2" fill={ink} />
        {[9, 12, 14, 18, 21, 25, 28, 32, 35].map((x, i) => (
          <rect key={i} x={x} y="17" width={i % 2 === 0 ? 2 : 1} height="11" fill={ink} />))}
        <rect x="11" y="31" width={w - 22} height="2.5" fill={accent} />
      </svg>);
    case 'shipping-label':
      return (<svg viewBox="0 0 36 48" width={w} height={h}>
        <rect x="2" y="2" width="32" height="44" fill="none" stroke={ink} strokeWidth="1.2" />
        <line x1="6" y1="9" x2="19" y2="9" stroke={ink} strokeWidth="0.8" />
        <line x1="6" y1="12.5" x2="15" y2="12.5" stroke={ink} strokeWidth="0.8" />
        <line x1="2" y1="18" x2="34" y2="18" stroke={ink} strokeWidth="1" />
        <line x1="6" y1="24" x2="28" y2="24" stroke={ink} strokeWidth="1.6" />
        <line x1="6" y1="29" x2="23" y2="29" stroke={ink} strokeWidth="1.6" />
        {[6, 9, 11, 14, 17, 20, 23, 26, 29].map((x, i) => (
          <rect key={i} x={x} y="38" width={i % 2 === 0 ? 1.6 : 1} height="6" fill={ink} />))}
      </svg>);
    case 'blank':
      return (<svg viewBox={`0 0 ${w} ${h}`} width={w} height={h}>
        <rect x="2" y="2" width={w - 4} height={h - 4} fill="none" stroke={ink} strokeDasharray="3 3" strokeWidth="1.2" />
      </svg>);
    case 'electrical-panel':
      return (<svg viewBox={`0 0 ${w} ${h}`} width={w} height={h}>
        <rect x="2" y="2" width={w - 4} height={h - 4} fill="none" stroke={ink} strokeWidth="1.2" />
        <rect x="2" y="2" width={w - 4} height="9" fill={accent} />
        <path d="M26 14 L19 25 L23.5 25 L21 33 L31 21 L25.5 21 Z" fill={ink} />
      </svg>);
    case 'confined-space':
      return (<svg viewBox={`0 0 ${w} ${h}`} width={w} height={h}>
        <rect x="2" y="2" width={w - 4} height={h - 4} fill="none" stroke={ink} strokeWidth="1.2" />
        <rect x="2" y="2" width={w - 4} height="9" fill={accent} />
        <path d={`M${w / 2} 14 L${w / 2 + 8} 30 L${w / 2 - 8} 30 Z`} fill="none" stroke={ink} strokeWidth="1.6" strokeLinejoin="round" />
        <rect x={w / 2 - 0.8} y="20" width="1.6" height="5" fill={ink} />
        <circle cx={w / 2} cy="28" r="1" fill={ink} />
      </svg>);
    case 'forklift-traffic':
      return (<svg viewBox={`0 0 ${w} ${h}`} width={w} height={h}>
        <rect x="2" y="2" width={w - 4} height={h - 4} fill="none" stroke={ink} strokeWidth="1.2" />
        <rect x="2" y="2" width={w - 4} height="9" fill={active ? '#F36F21' : '#bdb398'} />
        <path d="M16 27 v-7 h6 l3 5 v2 z" fill={ink} />
        <rect x="29" y="14" width="1.8" height="13" fill={ink} />
        <path d="M30.8 25.5 h6" fill="none" stroke={ink} strokeWidth="1.4" />
        <circle cx="19" cy="29" r="2" fill={ink} />
        <circle cx="26" cy="29" r="2" fill={ink} />
      </svg>);
    case 'emergency-exit':
      return (<svg viewBox={`0 0 ${w} ${h}`} width={w} height={h}>
        <rect x="2" y="2" width={w - 4} height={h - 4} fill={active ? '#0E7C4E' : '#bcd8c8'} />
        <circle cx="15" cy="12" r="2.4" fill="#fff" />
        <path d="M12 27 l3 -9 4 2 3 5 -2 1 -2.5 -3 -1 7 z" fill="#fff" />
        <path d="M29 18 h7 v-3 l5 5 -5 5 v-3 h-7 z" fill="#fff" />
      </svg>);
    case 'shipping-handling':
      return (<svg viewBox="0 0 36 48" width={w} height={h}>
        <rect x="2" y="2" width="32" height="44" fill="none" stroke={ink} strokeWidth="1.2" />
        <rect x="2" y="2" width="32" height="8" fill={ink} />
        <path d="M13 31 v-9 h-3 l4.5 -6 4.5 6 h-3 v9 z" fill={ink} />
        <path d="M22 31 v-9 h-3 l4.5 -6 4.5 6 h-3 v9 z" fill={ink} />
        <rect x="7" y="37" width="22" height="5" rx="1.5" fill="none" stroke={active ? '#F36F21' : '#bdb398'} strokeWidth="1.4" />
      </svg>);
    case 'inspection-due':
      return (<svg viewBox={`0 0 ${w} ${h}`} width={w} height={h}>
        <rect x="3" y="4" width={w - 6} height={h - 8} rx="3" fill="none" stroke={ink} strokeWidth="1.2" />
        <rect x="4" y="5" width={w - 8} height="8" rx="2" fill={active ? '#0E7C4E' : '#bcd8c8'} />
        <path d="M18 25 l4 4 8 -10" fill="none" stroke={active ? '#0E7C4E' : '#9bbfa9'} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>);
    case 'calibration':
      return (<svg viewBox={`0 0 ${w} ${h}`} width={w} height={h}>
        <rect x="3" y="4" width={w - 6} height={h - 8} rx="3" fill="none" stroke={ink} strokeWidth="1.2" />
        <rect x="4" y="5" width={w - 8} height="8" rx="2" fill={active ? '#1057A8' : '#bdb398'} />
        <path d="M16 30 a8 8 0 0 1 16 0" fill="none" stroke={ink} strokeWidth="1.4" />
        <path d="M24 30 l5 -6" fill="none" stroke={active ? '#C8102E' : ink} strokeWidth="1.4" strokeLinecap="round" />
        <circle cx="24" cy="30" r="1.5" fill={ink} />
      </svg>);
    case 'biohazard':
      return (<svg viewBox={`0 0 ${w} ${h}`} width={w} height={h}>
        <rect x="2" y="2" width={w - 4} height={h - 4} fill="none" stroke={ink} strokeWidth="1.2" />
        <rect x="2" y="2" width={w - 4} height="9" fill={accent} />
        <circle cx={w / 2} cy="19" r="3.6" fill="none" stroke={ink} strokeWidth="1.5" />
        <circle cx={w / 2 - 4.6} cy="27" r="3.6" fill="none" stroke={ink} strokeWidth="1.5" />
        <circle cx={w / 2 + 4.6} cy="27" r="3.6" fill="none" stroke={ink} strokeWidth="1.5" />
        <circle cx={w / 2} cy="24.5" r="1.6" fill={ink} />
      </svg>);
    case 'laser-radiation':
      return (<svg viewBox={`0 0 ${w} ${h}`} width={w} height={h}>
        <rect x="2" y="2" width={w - 4} height={h - 4} fill="none" stroke={ink} strokeWidth="1.2" />
        <rect x="2" y="2" width={w - 4} height="9" fill={accent} />
        <path d="M19 24 H38 M19 24 L35 17 M19 24 L35 31 M19 24 L31 14 M19 24 L31 34"
              fill="none" stroke={ink} strokeWidth="1.1" />
        <circle cx="18" cy="24" r="2.2" fill={ink} />
      </svg>);
    case 'site-access':
      return (<svg viewBox={`0 0 ${w} ${h}`} width={w} height={h}>
        <rect x="2" y="2" width={w - 4} height={h - 4} fill="none" stroke={ink} strokeWidth="1.2" />
        <rect x="2" y="2" width={w - 4} height="9" fill={active ? '#1057A8' : '#bdb398'} />
        <rect x={w / 2 - 8} y="15" width="16" height="17" rx="2.5" fill={active ? '#1057A8' : '#bdb398'} />
        <path d="M21 29 V18 H25.5 a3.2 3.2 0 0 1 0 6.4 H21" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinejoin="round" />
      </svg>);
    default:
      return <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} />;
  }
}

// ----------- Pictogram picker tile -----------
function PictoTile({ id, active, onClick, cache }) {
  const p = PICTOGRAMS[id];
  const src = cache && cache[id];
  const std = p.kind === 'ghs' ? null : p.kind === 'info' ? 'ISO 7001' : 'ISO 7010';
  const ref = std ? `${std} ${p.code}` : p.code;
  return (
    <button className={`picto-tile ${active ? 'on' : ''}`} aria-pressed={active} onClick={onClick} title={`${p.name} · ${ref}`}>
      {src ? <img src={src} alt={p.name} width="44" height="44" loading="lazy" decoding="async" style={{ objectFit: 'contain' }} />
           : <div style={{ width: 44, height: 44 }} />}
      <span>{p.name}</span>
    </button>
  );
}

// Symbol categories in display order. The picker groups tiles under these so the
// full ISO 7010 catalog stays navigable; each PICTOGRAMS entry's `kind` maps here.
const PICTO_GROUPS = [
  ['warning', 'Warning'],
  ['prohibition', 'Prohibition'],
  ['mandatory', 'Mandatory'],
  ['safe', 'Safe condition'],
  ['fire', 'Fire equipment'],
  ['ghs', 'GHS chemical'],
  ['info', 'Public info'],
];

const KIND_LABEL = Object.fromEntries(PICTO_GROUPS);

// Grouped pictogram picker, shared by the Symbols tab and the image-layer
// properties panel. activeId highlights the current symbol; onPick(id) applies.
// A search box filters by symbol name, ISO code, or category label.
// Read an image file (PNG/JPG/SVG) as a base64 data URL, then probe its natural
// size; cb(dataUrl, naturalW, naturalH). Used for custom-image upload.
function readImageFile(file, cb) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    const src = reader.result;
    const probe = new Image();
    probe.onload = () => cb(src, probe.naturalWidth || 0, probe.naturalHeight || 0);
    probe.onerror = () => cb(src, 0, 0);
    probe.src = src;
  };
  reader.readAsDataURL(file);
}

function SymbolPicker({ activeId, onPick, cache, onUpload }) {
  const [q, setQ] = useState('');
  const query = q.trim().toLowerCase();
  const match = (id) => {
    if (!query) return true;
    const p = PICTOGRAMS[id];
    return p.name.toLowerCase().includes(query)
        || p.code.toLowerCase().includes(query)
        || (KIND_LABEL[p.kind] || '').toLowerCase().includes(query);
  };
  const ids = Object.keys(PICTOGRAMS).filter(match);
  return (
    <div className="symbol-picker">
      <input
        className="text-input picto-search"
        type="search"
        value={q}
        onChange={e => setQ(e.target.value)}
        placeholder="Search symbols…"
        aria-label="Search symbols"
        spellCheck={false}
      />
      {onUpload && (
        <label className="ghost dashed picto-upload">
          Upload image (PNG / JPG / SVG)
          <input type="file" accept="image/*,.svg" style={{ display: 'none' }}
                 onChange={e => { const f = e.target.files && e.target.files[0]; if (f) onUpload(f); e.target.value = ''; }} />
        </label>
      )}
      <div className="picto-groups">
        {PICTO_GROUPS.map(([kind, label]) => {
          const group = ids.filter(id => PICTOGRAMS[id].kind === kind);
          if (!group.length) return null;
          return (
            <div key={kind} className="picto-group">
              <div className="picto-group-label">{label}</div>
              <div className="picto-grid">
                {group.map(id => (
                  <PictoTile key={id} id={id} active={activeId === id} onClick={() => onPick(id)} cache={cache} />
                ))}
              </div>
            </div>
          );
        })}
        {ids.length === 0 && <div className="empty-note">No symbols match “{q}”.</div>}
      </div>
    </div>
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
      {showOutline && <div className={`sel-outline ${kind}`} style={{ left: 0, top: 0, width: pw, height: ph }} />}
      {(cornersOnly ? HANDLE_POSITIONS.filter(([n]) => n.length === 2) : HANDLE_POSITIONS).map(([name, fx, fy]) => (
        <div
          key={name}
          className={`handle handle-${name} ${kind}`}
          style={{ left: fx * pw, top: fy * ph }}
          onMouseDown={e => onHandleDown(e, name)}
        />
      ))}
      {onRotateDown && (
        <>
          <div className="rotate-stem" style={{ left: pw / 2, top: -22 }} />
          <div className="handle-rotate" style={{ left: pw / 2, top: -22 }}
               onMouseDown={onRotateDown} title="Rotate (hold Shift for 15°)" />
        </>
      )}
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
//   - centerY pinned: size unchanged, the layer's centre keeps its offset from
//     the canvas centre (a centred layer stays centred). Mutually exclusive with
//     top/bottom in the UI; the branch order enforces it here too.
//   - same logic horizontally for left/right/centerX
// Layers without `pinSides` are unchanged on canvas resize (legacy behavior).
function applyPins(l, oldW, oldH, newW, newH) {
  const pin = l.pinSides;
  if (!pin) return l;
  let { x, y, w, h } = l;

  const right = pin.right, left = pin.left;
  if (left && right) {
    const rightOffset = oldW - (x + w);
    w = Math.max(1, newW - x - rightOffset);
  } else if (pin.centerX) {
    const offset = (x + w / 2) - oldW / 2;   // signed distance of layer centre from canvas centre
    x = newW / 2 + offset - w / 2;           // preserve that offset; width unchanged
  } else if (right && !left) {
    const rightOffset = oldW - (x + w);
    x = newW - w - rightOffset;
  }
  // left-only or neither: x stays

  const top = pin.top, bottom = pin.bottom;
  if (top && bottom) {
    const bottomOffset = oldH - (y + h);
    h = Math.max(1, newH - y - bottomOffset);
  } else if (pin.centerY) {
    const offset = (y + h / 2) - oldH / 2;
    y = newH / 2 + offset - h / 2;
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
// Axis-aligned bounding box of a layer's VISUAL extent, accounting for its
// rotation about center (same +θ matrix the SVG `rotate()` render uses). For an
// unrotated layer this returns its own {x,y,w,h} unchanged, so callers that
// align/select/measure stay correct for both rotated and axis-aligned layers.
function layerAABB(l) {
  const deg = l.rotation || 0;
  if (!deg) return { x: l.x, y: l.y, w: l.w, h: l.h };
  const rot = deg * Math.PI / 180;
  const cos = Math.cos(rot), sin = Math.sin(rot);
  const cx = l.x + l.w / 2, cy = l.y + l.h / 2;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [px, py] of [[l.x, l.y], [l.x + l.w, l.y], [l.x + l.w, l.y + l.h], [l.x, l.y + l.h]]) {
    const dx = px - cx, dy = py - cy;
    const rx = cx + dx * cos - dy * sin;
    const ry = cy + dx * sin + dy * cos;
    if (rx < minX) minX = rx;
    if (rx > maxX) maxX = rx;
    if (ry < minY) minY = ry;
    if (ry > maxY) maxY = ry;
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

function niceStep(raw) {
  if (!isFinite(raw) || raw <= 0) return 100;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / pow;
  const m = n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10;
  return m * pow;
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
              <li><b>Choose a template</b> under Common Templates — this replaces all layers with a starting layout.</li>
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

export function App({ onHome } = {}) {
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
    setEditor(e => {
      const nd = typeof updater === 'function' ? updater(e.design) : updater;
      // Skip the re-render when an updater returns the same design reference
      // (the reorder helpers preserve identity on a no-op).
      return nd === e.design ? e : { ...e, design: nd };
    });
  }, []);

  // Resize the canvas the same way the canvas-resize drag does: stretch the
  // synced background (its strokeOnTop border IS the label frame) and re-anchor
  // pinned layers, so the frame stroke and bands stay glued to the new edges.
  // Used by the W/H inputs, Reset and Swap — which previously set width/height
  // alone and left the frame detached from the canvas edge.
  const setCanvasSize = useCallback((nw, nh) => {
    nw = Math.max(40, Math.round(nw));
    nh = Math.max(40, Math.round(nh));
    setDesign(d => {
      if (nw === d.width && nh === d.height) return d;
      const ow = d.width, oh = d.height;
      return {
        ...d,
        width: nw,
        height: nh,
        layers: d.layers.map(l => {
          if (l.syncCanvas === 'fill') return { ...l, x: 0, y: 0, w: nw, h: nh };
          if (l.pinSides) {
            const p = applyPins({ x: l.x, y: l.y, w: l.w, h: l.h, pinSides: l.pinSides }, ow, oh, nw, nh);
            return { ...l, x: p.x, y: p.y, w: p.w, h: p.h };
          }
          return l;
        }),
      };
    });
  }, [setDesign]);

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
  // Selection-derived data is read on every render (and every drag frame). Memoize
  // it on [design.layers, selectedIds] so it isn't recomputed when unrelated state
  // changes (pan, zoom, docName, theme) and so the arrays keep a stable identity.
  const selectedLayer = useMemo(
    () => (selectedId ? design.layers.find(l => l.id === selectedId) : null),
    [design.layers, selectedId]);
  const selectedLayers = useMemo(
    () => (selectedIds.length ? design.layers.filter(l => selectedIds.includes(l.id)) : []),
    [design.layers, selectedIds]);
  // Use each layer's rotated visual bounds so the group box / ruler band hug
  // rotated layers correctly (not their unrotated, smaller boxes).
  const selBoxes = useMemo(() => selectedLayers.map(layerAABB), [selectedLayers]);
  const selBounds = useMemo(() => (selBoxes.length ? {
    x: Math.min(...selBoxes.map(b => b.x)),
    y: Math.min(...selBoxes.map(b => b.y)),
    w: Math.max(...selBoxes.map(b => b.x + b.w)) - Math.min(...selBoxes.map(b => b.x)),
    h: Math.max(...selBoxes.map(b => b.y + b.h)) - Math.min(...selBoxes.map(b => b.y)),
  } : null), [selBoxes]);
  const editableSel = useMemo(() => selectedLayers.filter(l => !l.locked), [selectedLayers]);

  // ----- 4-zone shell state -----
  // leftPanel: which view the icon rail shows in the left panel.
  // The right panel shows Layers + Properties together (no tabs), so selecting a
  // layer reveals its properties without any tab switch.
  const [leftPanel, setLeftPanel] = useState('templates'); // 'templates' | 'shapes' | 'symbols'
  // Editable document title in the top bar; restored from + saved to localStorage.
  const [docName, setDocName] = useState(() => {
    try { return localStorage.getItem(DOC_NAME_KEY) || 'Untitled Label'; }
    catch { return 'Untitled Label'; }
  });
  const [exportOpen, setExportOpen] = useState(false);      // export popover
  const [preview, setPreview] = useState(false);            // chrome-free preview toggle
  const [helpOpen, setHelpOpen] = useState(false);          // help / workflows dialog
  const [ctxMenu, setCtxMenu] = useState(null);             // right-click menu { x, y }
  const [theme, setTheme] = useState(() => {                // editor 'light' | 'dark'
    try {
      const saved = localStorage.getItem('hazardLabelStudio.theme');
      if (saved === 'dark' || saved === 'light') return saved;
      return (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
    } catch { return 'light'; }
  });
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
  // Mirror of wrapOffset for imperative readers (the native pan listener is bound
  // once with an empty-dep effect, so it must read the live value via this ref).
  const wrapOffsetRef = useRef(wrapOffset);
  wrapOffsetRef.current = wrapOffset;
  // True while a pan drag is live, so the stage's scroll listener doesn't
  // recompute rulers mid-drag — that re-render would reset the wrap's
  // imperatively-set transform and make translate-panning jitter.
  const isPanningRef = useRef(false);
  // Active alignment guides shown while Ctrl-dragging. Each guide:
  // { orient: 'v' | 'h', value: number }  — value in label coordinates.
  const [snapGuides, setSnapGuides] = useState([]);
  // Transient on-canvas readout during a drag/resize/rotate gesture. UI-only —
  // never committed to the design (no history entry, no <Label> re-render).
  const [hud, setHud] = useState(null); // { kind: 'move'|'resize'|'rotate', x, y, w, h, deg }
  const hudLabel = (fw, fh) => {
    if (hud?.kind === 'move') return `X ${Math.round(hud.x)}   Y ${Math.round(hud.y)}`;
    if (hud?.kind === 'rotate') return `${Math.round(hud.deg)}°`;
    if (hud?.kind === 'resize') return `${Math.round(hud.w)} × ${Math.round(hud.h)}`;
    return `${Math.round(fw)} × ${Math.round(fh)}`;
  };
  // Optional editing grid (overlay + snap). Persisted to localStorage.
  const [grid, setGrid] = useState(() => {
    try {
      const s = JSON.parse(localStorage.getItem('hazardLabelStudio.grid') || 'null');
      if (s && typeof s === 'object') return { show: !!s.show, snap: !!s.snap, step: Math.max(2, Math.min(200, s.step || 10)), smart: !!s.smart };
    } catch { /* ignore */ }
    return { show: false, snap: false, step: 10, smart: false };
  });
  const quantize = (v, step) => Math.round(v / Math.max(1, step)) * step;
  // Equalize the gap to the nearest neighbour on each side (Figma-style spacing).
  // Returns adjusted x/y plus gap-guide entries to render. Pure.
  const smartSpacing = (box, others, threshold) => {
    let { x, y } = box;
    const guides = [];
    {
      const band = others.filter(o => o.y < y + box.h && o.y + o.h > y);
      let L = null, R = null;
      for (const o of band) {
        if (o.x + o.w <= x) { if (!L || o.x + o.w > L.x + L.w) L = o; }
        else if (o.x >= x + box.w) { if (!R || o.x < R.x) R = o; }
      }
      if (L && R) {
        const gapL = x - (L.x + L.w), gapR = R.x - (x + box.w);
        if (Math.abs(gapL - gapR) <= threshold * 2) {
          x = (L.x + L.w) + ((R.x - (L.x + L.w)) - box.w) / 2;
          const yBar = y + box.h / 2;
          guides.push({ kind: 'gap', orient: 'h', y: yBar, x1: L.x + L.w, x2: x });
          guides.push({ kind: 'gap', orient: 'h', y: yBar, x1: x + box.w, x2: R.x });
        }
      }
    }
    {
      const band = others.filter(o => o.x < x + box.w && o.x + o.w > x);
      let T = null, B = null;
      for (const o of band) {
        if (o.y + o.h <= y) { if (!T || o.y + o.h > T.y + T.h) T = o; }
        else if (o.y >= y + box.h) { if (!B || o.y < B.y) B = o; }
      }
      if (T && B) {
        const gapT = y - (T.y + T.h), gapB = B.y - (y + box.h);
        if (Math.abs(gapT - gapB) <= threshold * 2) {
          y = (T.y + T.h) + ((B.y - (T.y + T.h)) - box.h) / 2;
          const xBar = x + box.w / 2;
          guides.push({ kind: 'gap', orient: 'v', x: xBar, y1: T.y + T.h, y2: y });
          guides.push({ kind: 'gap', orient: 'v', x: xBar, y1: y + box.h, y2: B.y });
        }
      }
    }
    return { x, y, guides };
  };
  // Inline (on-canvas) text editing: the edited layer is hidden in <Label> and
  // replaced by a positioned <textarea>; commit writes the draft text back.
  const [editingTextId, setEditingTextId] = useState(null);
  const [editingDraft, setEditingDraft] = useState('');
  // Set when Escape cancels an inline edit, so the unmount-triggered blur
  // (which would otherwise fire commitTextEdit and write the discarded draft)
  // becomes a no-op write.
  const cancelEditRef = useRef(false);
  const [userPresets, setUserPresets] = useState([]);
  const [newPresetName, setNewPresetName] = useState('');
  // The preset currently loaded into the canvas (if any). Lets "Update" save
  // edits back over the preset you applied instead of forcing a new duplicate.
  // Cleared whenever the design is replaced by a template (applyPreset).
  const [activePresetId, setActivePresetId] = useState(null);
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
        // The live edit is a NEW branch, so it invalidates any redo stack that
        // was still pending from a prior undo (future isn't cleared until a
        // commit lands). Replace future with just this edit — don't prepend
        // onto the now-stale entries, or Redo could resurrect an abandoned
        // branch the user already moved past.
        return {
          ...e,
          design: lastCommittedDesign.current,
          future: [e.design],
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
    // A pending (uncommitted) edit is a fresh branch that invalidates redo.
    // Commit it first so it lands in history — this also clears `future`, so
    // the redo below correctly becomes a no-op instead of discarding the edit.
    forceCommit();
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
  }, [forceCommit]);

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
      if (!raw) return;
      const v = JSON.parse(raw);
      // Guard the shape: a non-array value (string/null from a tampered or
      // future-version store) would throw on .length/.map during render and
      // white-screen the app. Drop malformed entries rather than trust them.
      if (Array.isArray(v)) {
        setUserPresets(v.filter(p => p && p.id && p.design && Array.isArray(p.design.layers)));
      }
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
      id: uid(),
      name: trimmed,
      design: {
        width: design.width,
        height: design.height,
        severity: design.severity,
        layers: JSON.parse(JSON.stringify(design.layers)), // deep clone
      },
    };
    persistUserPresets([...userPresets, preset]);
    setActivePresetId(preset.id);   // the just-saved preset becomes the active one
    setNewPresetName('');
  }
  // Overwrite an existing preset's stored design with the current canvas, so a
  // load → edit → save-back round-trip doesn't create a duplicate. Keeps the
  // preset's name; confirms first since it discards the previously saved layout.
  function updateUserPreset(id) {
    const p = userPresets.find(x => x.id === id);
    if (!p) return;
    if (!window.confirm(`Update preset “${p.name}” with the current design?`)) return;
    persistUserPresets(userPresets.map(x => x.id === id ? {
      ...x,
      design: {
        width: design.width,
        height: design.height,
        severity: design.severity,
        layers: JSON.parse(JSON.stringify(design.layers)), // deep clone
      },
    } : x));
    setActivePresetId(id);
    setExportMsg(`Updated “${p.name}”`);
    setTimeout(() => setExportMsg(''), 2200);
  }
  function applyUserPreset(id) {
    const p = userPresets.find(x => x.id === id);
    if (!p) return;
    // A preset comes from localStorage — the same trust boundary as the autosave
    // restore — so validate before applying. A tampered or stale entry with an
    // unknown layer type or non-finite geometry would feed NaN into the SVG and
    // break the canvas.
    if (!isRenderableDesign(p.design)) {
      setExportMsg('That preset is corrupted and could not be loaded');
      setTimeout(() => setExportMsg(''), 3000);
      return;
    }
    forceCommit();   // make the current design a clean undo point before replacing it
    // Fresh layer IDs so nothing reuses stale references.
    const layers = p.design.layers.map(l => ({
      ...l,
      id: uid(),
    }));
    setDesign({
      width: p.design.width,
      height: p.design.height,
      severity: p.design.severity,
      format: 'custom',
      layers,
    });
    setDocName(p.name);
    setActivePresetId(id);
    setSelectedIds([]);
    setWrapOffset({ x: 0, y: 0 });
    setExportMsg('Preset applied — press Ctrl+Z to undo');
    setTimeout(() => setExportMsg(''), 3000);
  }
  function deleteUserPreset(id) {
    persistUserPresets(userPresets.filter(p => p.id !== id));
    setActivePresetId(a => (a === id ? null : a));
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
      const layers = moveStackLayers(d.layers, [id], { kind: 'step', dir });
      return layers === d.layers ? d : { ...d, layers };
    });
  }, [setDesign]);
  const addLayer = useCallback((type) => {
    const nl = newLayer(type, design.width, design.height);
    if (!nl) return;
    setDesign(d => ({ ...d, layers: [...d.layers, nl] }));
    setSelectedIds([nl.id]);
  }, [design.width, design.height]);

  // Add an uploaded image as a new image layer (sized to fit, aspect preserved).
  const addImageFromFile = useCallback((file) => {
    readImageFile(file, (src, nw, nh) => {
      const maxDim = Math.min(design.width, design.height) * 0.5;
      let w = nw || 160, h = nh || 160;
      const s = Math.min(1, maxDim / Math.max(w, h)) || 1;
      w = Math.round(w * s) || 160; h = Math.round(h * s) || 160;
      const nl = newLayer('image', design.width, design.height);
      if (!nl) return;
      nl.symbol = undefined;
      nl.src = src;
      nl.name = (file.name || 'Image').replace(/\.[^.]+$/, '');
      nl.w = w; nl.h = h;
      nl.x = Math.round(design.width / 2 - w / 2);
      nl.y = Math.round(design.height / 2 - h / 2);
      setDesign(d => ({ ...d, layers: [...d.layers, nl] }));
      setSelectedIds([nl.id]);
    });
  }, [design.width, design.height, setDesign]);

  // Align selected layers. With one selection we align to the canvas; with two
  // or more we align each layer to the selection's bounding box.
  const alignLayer = useCallback((kind) => {
    setDesign(d => {
      const sel = d.layers.filter(l => selectedIds.includes(l.id) && !l.locked);
      if (sel.length === 0) return d;
      const b = sel.length === 1
        ? { x: 0, y: 0, w: d.width, h: d.height }
        : (() => {
            const boxes = sel.map(layerAABB);
            const x0 = Math.min(...boxes.map(bb => bb.x)), y0 = Math.min(...boxes.map(bb => bb.y));
            const x1 = Math.max(...boxes.map(bb => bb.x + bb.w)), y1 = Math.max(...boxes.map(bb => bb.y + bb.h));
            return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
          })();
      const ids = new Set(sel.map(l => l.id));
      return { ...d, layers: d.layers.map(l => {
        if (!ids.has(l.id)) return l;
        // Align the layer's VISUAL (rotated) bounds to the target edge, then map
        // back to x/y via the box→AABB offset. For an unrotated layer bb===box
        // and off===0, so this reduces to the original simple placement.
        const bb = layerAABB(l);
        const offX = l.x - bb.x, offY = l.y - bb.y;
        const patch = {};
        if (kind === 'left') patch.x = b.x + offX;
        else if (kind === 'cx') patch.x = Math.round(b.x + (b.w - bb.w) / 2 + offX);
        else if (kind === 'right') patch.x = b.x + b.w - bb.w + offX;
        else if (kind === 'top') patch.y = b.y + offY;
        else if (kind === 'cy') patch.y = Math.round(b.y + (b.h - bb.h) / 2 + offY);
        else if (kind === 'bottom') patch.y = b.y + b.h - bb.h + offY;
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

  // Mirror selected layers in place. Geometric where possible (polygon points,
  // rect per-corner radius/chamfer, text alignment); image layers carry flipX/
  // flipY flags consumed by the renderer. {x,y,w,h} never change, so hit-testing,
  // alignment, snapping and export are unaffected. One history step.
  const flipSelected = useCallback((axis) => {
    const H = axis === 'h';
    const flipOne = (l) => {
      if (l.type === 'polygon' && Array.isArray(l.points)) {
        return { ...l, points: l.points.map(p => H ? { ...p, x: 1 - p.x } : { ...p, y: 1 - p.y }) };
      }
      if (l.type === 'image') return H ? { ...l, flipX: !l.flipX } : { ...l, flipY: !l.flipY };
      if (l.type === 'rect') {
        const patch = {};
        if (l.radius && typeof l.radius === 'object') {
          const r = l.radius;
          patch.radius = H ? { tl: r.tr || 0, tr: r.tl || 0, br: r.bl || 0, bl: r.br || 0 }
                           : { tl: r.bl || 0, tr: r.br || 0, br: r.tr || 0, bl: r.tl || 0 };
        }
        if (l.corner && typeof l.corner === 'object') {
          const c = l.corner;
          patch.corner = H ? { tl: c.tr, tr: c.tl, br: c.bl, bl: c.br }
                           : { tl: c.bl, tr: c.br, br: c.tr, bl: c.tl };
        }
        return Object.keys(patch).length ? { ...l, ...patch } : l;
      }
      if (l.type === 'text' && H) {
        if (l.align === 'start') return { ...l, align: 'end' };
        if (l.align === 'end') return { ...l, align: 'start' };
      }
      return l;
    };
    setDesign(d => {
      const ids = new Set(selectedIds);
      if (!ids.size) return d;
      let changed = false;
      const layers = d.layers.map(l => {
        if (!ids.has(l.id) || l.locked) return l;
        const nl = flipOne(l);
        if (nl !== l) changed = true;
        return nl;
      });
      return changed ? { ...d, layers } : d;
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
    if (newIds.length) setSelectedIds(newIds);
  }, [selectedIds, setDesign]);

  // Delete every (non-locked) selected layer.
  const deleteSelected = useCallback(() => {
    // Remove only unlocked selected layers. We deliberately don't clear the
    // selection here: the prune effect drops the just-deleted ids, which leaves
    // any locked (undeletable) layers still selected instead of falsely
    // "deselecting" them and implying a deletion that didn't happen.
    setDesign(d => ({ ...d, layers: d.layers.filter(l => !(selectedIds.includes(l.id) && !l.locked)) }));
  }, [selectedIds, setDesign]);

  // Live ref to the current design so keyboard handlers read fresh layers
  // without re-binding the listener on every edit.
  const designRef = useRef(design);
  designRef.current = design;
  // In-memory clipboard for copy/paste of layers (deep-cloned objects).
  const clipboardRef = useRef([]);

  const copySelected = useCallback(() => {
    const copied = designRef.current.layers
      .filter(l => selectedIds.includes(l.id) && !l.locked)
      .map(l => JSON.parse(JSON.stringify(l)));
    if (copied.length) clipboardRef.current = copied;
  }, [selectedIds]);

  const pasteClipboard = useCallback(() => {
    const clip = clipboardRef.current;
    if (!clip || !clip.length) return;
    const newIds = [];
    setDesign(d => {
      const added = clip.map(src => {
        const id = uid();
        newIds.push(id);
        return { ...JSON.parse(JSON.stringify(src)), id, x: (src.x || 0) + 16, y: (src.y || 0) + 16 };
      });
      return { ...d, layers: [...d.layers, ...added] };
    });
    if (newIds.length) setSelectedIds(newIds);
  }, [setDesign]);

  // Paste the clipboard with its bounding-box top-left at a label point (used by
  // the canvas "Paste here" menu item).
  const pasteClipboardAt = useCallback((lx, ly) => {
    const clip = clipboardRef.current;
    if (!clip || !clip.length) return;
    const minX = Math.min(...clip.map(s => s.x || 0));
    const minY = Math.min(...clip.map(s => s.y || 0));
    const newIds = [];
    setDesign(d => {
      const added = clip.map(src => {
        const id = uid();
        newIds.push(id);
        return { ...JSON.parse(JSON.stringify(src)), id, x: (src.x || 0) - minX + lx, y: (src.y || 0) - minY + ly };
      });
      return { ...d, layers: [...d.layers, ...added] };
    });
    if (newIds.length) setSelectedIds(newIds);
  }, [setDesign]);

  const selectAll = useCallback(() => {
    const ids = designRef.current.layers.filter(l => !l.locked && !l.hidden).map(l => l.id);
    if (ids.length) setSelectedIds(ids);
  }, []);

  // Reorder selected layers within their stack segment. Locked layers are not
  // moved, while stack-locked boundaries such as the canvas background cannot be
  // crossed.
  const reorderSelected = useCallback((mode) => {
    const action = mode === 'forward'
      ? { kind: 'step', dir: 'up' }
      : mode === 'backward'
        ? { kind: 'step', dir: 'down' }
        : mode === 'front'
          ? { kind: 'edge', to: 'front' }
          : { kind: 'edge', to: 'back' };
    setDesign(d => {
      const layers = moveStackLayers(d.layers, selectedIds, action);
      return layers === d.layers ? d : { ...d, layers };
    });
  }, [selectedIds, setDesign]);

  // Move a dragged layer or multi-selection relative to another row in the
  // layer list. The helper preserves relative order and respects stack segments.
  const moveLayersToTarget = useCallback((ids, targetId, placement) => {
    setDesign(d => {
      const layers = moveStackLayers(d.layers, ids, { kind: 'insert', targetId, placement });
      return layers === d.layers ? d : { ...d, layers };
    });
  }, [setDesign]);

  // Drag-move every layer in `ids` together (no per-edge snap for groups).
  function startGroupDrag(e, ids, clickedId) {
    const snaps = new Map();
    for (const id of ids) {
      const l = design.layers.find(x => x.id === id);
      if (l && !l.locked) snaps.set(id, { x: l.x, y: l.y });
    }
    const g = selBounds;
    beginDrag(e, (dx, dy, mods) => {
      if (mods.shift) { if (Math.abs(dx) >= Math.abs(dy)) dy = 0; else dx = 0; }
      // Snap the group's top-left to the grid (absolute reference), matching the
      // single-layer behaviour in startLayerDrag — not the raw delta, which would
      // shift the box by a grid-multiple from an arbitrary origin.
      if (grid.snap && !mods.ctrl && g) { dx = quantize(g.x + dx, grid.step) - g.x; dy = quantize(g.y + dy, grid.step) - g.y; }
      setDesign(d => ({ ...d, layers: d.layers.map(l => snaps.has(l.id) ? { ...l, x: snaps.get(l.id).x + dx, y: snaps.get(l.id).y + dy } : l) }));
      if (g) setHud({ kind: 'move', x: g.x + dx, y: g.y + dy });
    }, clickedId ? () => setSelectedIds([clickedId]) : undefined);
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
      // Threshold in SCREEN pixels (r is in label units, so scale by f) — keeps
      // the click-vs-drag distinction consistent across zoom levels.
      if (r.w * f > 3 || r.h * f > 3) moved = true;
      setMarquee(r);
    }
    function up(ev) {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      document.removeEventListener('pointercancel', up);
      window.removeEventListener('blur', up);
      if (moved && ev && typeof ev.clientX === 'number') {
        const r = rectFrom(ev);
        const hit = design.layers.filter(l => {
          if (l.locked || l.hidden) return false;
          const b = layerAABB(l);   // test the rotated visual bounds, not the raw box
          return b.x < r.x + r.w && b.x + b.w > r.x && b.y < r.y + r.h && b.y + b.h > r.y;
        }).map(l => l.id);
        setSelectedIds(hit);
      } else if (!moved) {
        setSelectedIds([]);
      }
      setMarquee(null);
    }
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
    document.addEventListener('pointercancel', up);
    window.addEventListener('blur', up);
  }

  function applyPreset(formatId) {
    const f = FORMATS.find(x => x.id === formatId);
    if (!f) return;
    forceCommit();   // make the current design a clean undo point before replacing it
    const [W, H] = f.default;
    setDesign(d => ({
      width: W, height: H,
      severity: d.severity,
      format: formatId,
      layers: PRESETS[formatId](W, H, d.severity),
    }));
    setActivePresetId(null);   // a template replaces the design — no longer "your preset"
    setSelectedIds([]);
    setWrapOffset({ x: 0, y: 0 });
    setExportMsg('Template applied — press Ctrl+Z to undo');
    setTimeout(() => setExportMsg(''), 3000);
  }

  // Reshape the blank canvas's base layer (the syncCanvas:'fill' background)
  // into any of the SHAPES, in place — keeps fill/lock and any layers built on
  // top. newLayer() gives the right type + normalized polygon points; we just
  // stretch it to the full canvas and remember the choice for the picker.
  function changeCanvasShape(shape) {
    setDesign(d => {
      const W = d.width, H = d.height;
      const proto = newLayer(shape, W, H);
      if (!proto) return d;
      return {
        ...d,
        layers: d.layers.map(l => l.syncCanvas === 'fill'
          ? { ...l, type: proto.type, points: proto.points, x: 0, y: 0, w: W, h: H, shape }
          : l),
      };
    });
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
  function beginDrag(e, onMove, onClickNoMove) {
    e.preventDefault(); e.stopPropagation();
    // Flush any pending typing/edit commits so the drag's pre-state is the
    // history anchor. inDragRef suspends the debounced commit while the
    // drag is live — we commit again on mouseup.
    forceCommit();
    inDragRef.current = true;
    const x0 = e.clientX, y0 = e.clientY, f = fit;
    let moved = false;
    function move(ev) {
      if (Math.abs(ev.clientX - x0) > 3 || Math.abs(ev.clientY - y0) > 3) moved = true;
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
      // Safety net: if the button is released outside the window the document
      // 'mouseup' never fires, so we'd leak `move` and double-bind on the next
      // drag. window 'blur' / 'pointercancel' end the drag cleanly in that case.
      document.removeEventListener('pointercancel', up);
      window.removeEventListener('blur', up);
      setSnapGuides([]);                  // always clear guides on drag end
      setHud(null);
      inDragRef.current = false;
      // A press that never moved is a click — let the caller collapse a group
      // selection down to just the clicked layer.
      if (!moved && onClickNoMove) onClickNoMove();
      // Commit the post-drag state as a single history step. setTimeout(0)
      // lets the final mousemove's state update flush first.
      setTimeout(forceCommit, 0);
    }
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
    document.addEventListener('pointercancel', up);
    window.addEventListener('blur', up);
  }

  function startLayerDrag(e, layer) {
    const snap = { x: layer.x, y: layer.y, w: layer.w, h: layer.h };
    // Snapshot neighbours once for smart equal-spacing (only the dragged layer moves).
    const others = grid.smart
      ? design.layers.filter(l => l.id !== layer.id && !l.hidden && !l.locked).map(layerAABB)
      : null;
    beginDrag(e, (dx, dy, mods) => {
      // Shift constrains the move to the dominant axis.
      let lockX = false, lockY = false;
      if (mods.shift) { if (Math.abs(dx) >= Math.abs(dy)) { dy = 0; lockY = true; } else { dx = 0; lockX = true; } }
      let nx = snap.x + dx;
      let ny = snap.y + dy;
      let guides = [];
      const threshold = 8 / fit; // ~8 screen pixels regardless of zoom
      // Ctrl (manual) or Smart (always-on) → align snapping to layer edges/centres.
      if (mods.ctrl || grid.smart) {
        const r = snapMove({ x: nx, y: ny, w: snap.w, h: snap.h },
                           snapTargets(design, layer.id), threshold);
        nx = r.x; ny = r.y; guides = r.guides;
      }
      if (grid.smart && others) {
        const sp = smartSpacing({ x: nx, y: ny, w: snap.w, h: snap.h }, others, threshold);
        nx = sp.x; ny = sp.y; guides = guides.concat(sp.guides);
      } else if (grid.snap && !mods.ctrl) {
        nx = quantize(nx, grid.step); ny = quantize(ny, grid.step);
      }
      // Keep the axis lock strict — snapping/spacing must not move the frozen axis.
      if (lockY) ny = snap.y;
      if (lockX) nx = snap.x;
      setSnapGuides(guides);
      setLayer(layer.id, { x: nx, y: ny });
      setHud({ kind: 'move', x: nx, y: ny });
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
      setHud({ kind: 'resize', w: next.w, h: next.h });
    });
  }
  // Drag the rotate grip: set rotation from the angle between the box centre and
  // the cursor (grip points up = 0°). Shift snaps to 15°.
  function startRotate(e) {
    e.preventDefault(); e.stopPropagation();
    const layer = design.layers.find(l => l.id === selectedId);
    const wrap = wrapRef.current;
    if (!layer || !wrap) return;
    forceCommit();
    inDragRef.current = true;
    const r = wrap.getBoundingClientRect();
    const cx = r.left + (layer.x + layer.w / 2) * fit;
    const cy = r.top + (layer.y + layer.h / 2) * fit;
    function move(ev) {
      let deg = Math.atan2(ev.clientY - cy, ev.clientX - cx) * 180 / Math.PI + 90;
      if (ev.shiftKey) deg = Math.round(deg / 15) * 15;
      deg = Math.round(deg);
      while (deg > 180) deg -= 360;
      while (deg < -180) deg += 360;
      setLayer(layer.id, { rotation: deg });
      setHud({ kind: 'rotate', deg });
    }
    function up() {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      document.removeEventListener('pointercancel', up);
      window.removeEventListener('blur', up);
      setHud(null);
      inDragRef.current = false;
      setTimeout(forceCommit, 0);
    }
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
    document.addEventListener('pointercancel', up);
    window.addEventListener('blur', up);
  }
  // ----- group transform (multi-select) -----
  // Uniform scale of all selected layers about the opposite corner of the group
  // box. Scales geometry plus size-bound props (fontSize / strokeWidth / radius).
  function startGroupResize(e, mode) {
    e.preventDefault(); e.stopPropagation();
    const g = selBounds;
    if (!g || g.w < 1 || g.h < 1) return;
    const snaps = design.layers
      .filter(l => selectedIds.includes(l.id) && !l.locked)
      .map(l => ({ id: l.id, x: l.x, y: l.y, w: l.w, h: l.h, fontSize: l.fontSize, strokeWidth: l.strokeWidth, radius: l.radius }));
    if (!snaps.length) return;
    const ax = mode.includes('w') ? g.x + g.w : g.x;   // anchor = opposite corner
    const ay = mode.includes('n') ? g.y + g.h : g.y;
    const dcx = mode.includes('w') ? g.x : g.x + g.w;  // dragged corner
    const dcy = mode.includes('n') ? g.y : g.y + g.h;
    const oldDist = Math.hypot(dcx - ax, dcy - ay) || 1;
    const scaleR = (r, s) => typeof r === 'number' ? r * s
      : (r && typeof r === 'object' ? { tl: (r.tl || 0) * s, tr: (r.tr || 0) * s, br: (r.br || 0) * s, bl: (r.bl || 0) * s } : r);
    forceCommit();
    inDragRef.current = true;
    const x0 = e.clientX, y0 = e.clientY, f = fit;
    function move(ev) {
      const dx = (ev.clientX - x0) / f, dy = (ev.clientY - y0) / f;
      let s = Math.hypot(dcx + dx - ax, dcy + dy - ay) / oldDist;
      if (!isFinite(s) || s < 0.05) s = 0.05;
      setDesign(d => ({ ...d, layers: d.layers.map(l => {
        const sn = snaps.find(p => p.id === l.id);
        if (!sn) return l;
        const patch = {
          x: ax + (sn.x - ax) * s, y: ay + (sn.y - ay) * s,
          w: Math.max(1, sn.w * s), h: Math.max(1, sn.h * s),
        };
        if (sn.fontSize != null) patch.fontSize = Math.max(1, sn.fontSize * s);
        if (sn.strokeWidth != null) patch.strokeWidth = sn.strokeWidth * s;
        if (sn.radius != null) patch.radius = scaleR(sn.radius, s);
        return { ...l, ...patch };
      }) }));
      setHud({ kind: 'resize', w: g.w * s, h: g.h * s });
    }
    function up() {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      document.removeEventListener('pointercancel', up);
      window.removeEventListener('blur', up);
      setHud(null);
      inDragRef.current = false;
      setTimeout(forceCommit, 0);
    }
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
    document.addEventListener('pointercancel', up);
    window.addEventListener('blur', up);
  }

  // Rotate all selected layers about the group centre: each layer's centre
  // orbits the group centre and its own rotation gains the same delta.
  function startGroupRotate(e) {
    e.preventDefault(); e.stopPropagation();
    const g = selBounds;
    const wrap = wrapRef.current;
    if (!g || !wrap) return;
    const snaps = design.layers
      .filter(l => selectedIds.includes(l.id) && !l.locked)
      .map(l => ({ id: l.id, cx: l.x + l.w / 2, cy: l.y + l.h / 2, w: l.w, h: l.h, rotation: l.rotation || 0 }));
    if (!snaps.length) return;
    const gcx = g.x + g.w / 2, gcy = g.y + g.h / 2;
    const r = wrap.getBoundingClientRect();
    const scx = r.left + gcx * fit, scy = r.top + gcy * fit;
    const startAng = Math.atan2(e.clientY - scy, e.clientX - scx);
    forceCommit();
    inDragRef.current = true;
    function move(ev) {
      let dAng = Math.atan2(ev.clientY - scy, ev.clientX - scx) - startAng;
      if (ev.shiftKey) { const step = 15 * Math.PI / 180; dAng = Math.round(dAng / step) * step; }
      const cos = Math.cos(dAng), sin = Math.sin(dAng), deg = dAng * 180 / Math.PI;
      setDesign(d => ({ ...d, layers: d.layers.map(l => {
        const sn = snaps.find(p => p.id === l.id);
        if (!sn) return l;
        const ncx = gcx + (sn.cx - gcx) * cos - (sn.cy - gcy) * sin;
        const ncy = gcy + (sn.cx - gcx) * sin + (sn.cy - gcy) * cos;
        let rot = Math.round(sn.rotation + deg);
        while (rot > 180) rot -= 360;
        while (rot < -180) rot += 360;
        return { ...l, x: ncx - sn.w / 2, y: ncy - sn.h / 2, rotation: rot };
      }) }));
      setHud({ kind: 'rotate', deg });
    }
    function up() {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      document.removeEventListener('pointercancel', up);
      window.removeEventListener('blur', up);
      setHud(null);
      inDragRef.current = false;
      setTimeout(forceCommit, 0);
    }
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
    document.addEventListener('pointercancel', up);
    window.addEventListener('blur', up);
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

  function layerIdsAtPointer(e) {
    const wrap = wrapRef.current;
    if (!wrap) return [];
    const rect = wrap.getBoundingClientRect();
    const x = (e.clientX - rect.left) / fit;
    const y = (e.clientY - rect.top) / fit;
    return design.layers
      .slice()
      .reverse()
      .filter(l => !l.hidden && !l.locked)
      .filter(l => {
        // Match the canvas hit-rect (Label.jsx): inverse-rotate the pointer into
        // the layer's local frame and test the same HIT_MIN-expanded box, so a
        // rotated layer's empty AABB corners aren't counted as hits.
        const HIT_MIN = 8;
        const cx = l.x + l.w / 2, cy = l.y + l.h / 2;
        let px = x, py = y;
        if (l.rotation) {
          const r = -l.rotation * Math.PI / 180, c = Math.cos(r), s = Math.sin(r);
          const dx = x - cx, dy = y - cy;
          px = cx + dx * c - dy * s;
          py = cy + dx * s + dy * c;
        }
        const hw = Math.max(l.w, HIT_MIN), hh = Math.max(l.h, HIT_MIN);
        const hx = l.x - (hw - l.w) / 2, hy = l.y - (hh - l.h) / 2;
        return px >= hx && px <= hx + hw && py >= hy && py <= hy + hh;
      })
      .map(l => l.id);
  }

  // ----- canvas → layer event router -----
  // <Label> is memoized, so these props MUST keep a stable identity or the whole
  // SVG re-renders on every App state change (and every drag frame). Keep the
  // live logic in a ref refreshed each render (so it always sees the current
  // design/selection) and hand Label thin useCallback wrappers whose identity
  // never changes.
  const labelHandlers = useRef({});
  labelHandlers.current.onLayerPointerDown = (layerId, e) => {
    // Middle/right-button presses and Space-held (hand-tool) presses are PAN
    // gestures, not layer drags. Bail WITHOUT stopPropagation so the event
    // bubbles to the canvas stage's pan branch — otherwise beginDrag's
    // stopPropagation swallows it and we'd drag the layer instead of panning.
    if (e.button !== 0 || spaceHeldRef.current) return;
    const layer = design.layers.find(l => l.id === layerId);
    if (!layer) return;
    if (e.altKey) {
      const hits = layerIdsAtPointer(e);
      if (hits.length) {
        // Cycle from the CURRENT selection, not the pressed layer: the topmost
        // overlapping layer always receives the event, so keying off layerId
        // would never advance past the second layer. i = -1 (nothing under the
        // cursor is selected) falls back to the topmost hit.
        const cur = selectedIds.length === 1 ? selectedIds[0] : null;
        const i = cur ? hits.indexOf(cur) : -1;
        setSelectedIds([hits[(i + 1) % hits.length]]);
        e.preventDefault();
        e.stopPropagation();
        return;
      }
    }
    // Locked layers (incl. the canvas-fill background) aren't selectable here —
    // pressing one starts a marquee so you can rubber-band over the artwork.
    if (layer.locked) { startMarquee(e); return; }
    if (e.shiftKey) {
      // Toggle this layer in/out of the selection; don't start a drag.
      setSelectedIds(ids => ids.includes(layerId) ? ids.filter(i => i !== layerId) : [...ids, layerId]);
      return;
    }
    const inSelection = selectedIds.includes(layerId);
    const dragIds = inSelection ? selectedIds : [layerId];
    if (!inSelection) setSelectedIds([layerId]);
    if (dragIds.length > 1) startGroupDrag(e, dragIds, layerId);
    else startLayerDrag(e, layer);
  };
  labelHandlers.current.onCanvasPointerDown = (e) => {
    // Only a left-press rubber-bands a selection. Middle-press must fall through
    // to the stage's pan (a marquee here would add its own move listener and
    // preventDefault, fighting the pan); right-press is for the context menu.
    if (e.button !== 0) return;
    startMarquee(e);
  };
  // Right-click a layer → select it (if not already) and open the context menu.
  labelHandlers.current.onLayerContextMenu = (layerId, e) => {
    const layer = design.layers.find(l => l.id === layerId);
    if (!layer || layer.locked) return;   // let it bubble to the canvas menu
    e.preventDefault();
    e.stopPropagation();
    if (!selectedIds.includes(layerId)) setSelectedIds([layerId]);
    setCtxMenu({
      kind: 'layer',
      x: Math.min(e.clientX, window.innerWidth - 210),
      y: Math.min(e.clientY, window.innerHeight - 360),
    });
  };
  const onLayerPointerDown = useCallback((layerId, e) => labelHandlers.current.onLayerPointerDown(layerId, e), []);
  const onCanvasPointerDown = useCallback((e) => labelHandlers.current.onCanvasPointerDown(e), []);
  const onLayerContextMenu = useCallback((layerId, e) => labelHandlers.current.onLayerContextMenu(layerId, e), []);
  labelHandlers.current.onLayerDoubleClick = (layerId, e) => {
    const layer = design.layers.find(l => l.id === layerId);
    if (!layer || layer.type !== 'text' || layer.locked) return;
    e.preventDefault(); e.stopPropagation();
    forceCommit();
    setSelectedIds([layerId]);
    setEditingDraft(layer.text || '');
    setEditingTextId(layerId);
  };
  const onLayerDoubleClick = useCallback((layerId, e) => labelHandlers.current.onLayerDoubleClick(layerId, e), []);
  const commitTextEdit = () => {
    // A cancel (Escape) sets the flag, then unmounts the textarea; React fires a
    // native blur on the removed element which lands here with the stale closure.
    // Bail so the draft is discarded instead of written.
    if (cancelEditRef.current) { cancelEditRef.current = false; setEditingTextId(null); return; }
    if (editingTextId) setLayer(editingTextId, { text: editingDraft });
    setEditingTextId(null);
    setTimeout(forceCommit, 0);
  };
  const cancelTextEdit = () => { cancelEditRef.current = true; setEditingTextId(null); };
  // Drop the inline editor if its layer disappears (undo / delete).
  useEffect(() => {
    if (editingTextId && !design.layers.some(l => l.id === editingTextId)) setEditingTextId(null);
  }, [design.layers, editingTextId]);

  // ----- keyboard -----
  useEffect(() => {
    function onKey(e) {
      // A modal overlay owns the screen and brings its own Esc/Tab handling.
      // Suppress every editor shortcut so documented keys (Ctrl+D, Delete,
      // arrows, zoom) can't mutate the canvas behind it.
      if (helpOpen || exportOpen) return;
      const t = e.target;
      const inField = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA');

      // Undo / Redo work globally (also while a text input is focused, so
      // the user can undo their last typed character) — match standard
      // editor shortcuts on both Win/Linux (Ctrl) and macOS (Cmd).
      const mod = e.ctrlKey || e.metaKey;
      // Undo / redo work even while a field is focused (undo the typed char).
      if (mod && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        if (e.shiftKey) redo(); else undo();
        return;
      }
      if (mod && (e.key === 'y' || e.key === 'Y')) {
        e.preventDefault(); redo(); return;
      }
      // Zoom (global; gated on the modifier so it never blocks typing). Overrides
      // the browser's own Ctrl +/-/0 page zoom.
      if (mod && (e.key === '=' || e.key === '+' || e.code === 'Equal' || e.code === 'NumpadAdd')) { e.preventDefault(); zoomIn(); return; }
      if (mod && (e.key === '-' || e.key === '_' || e.code === 'Minus' || e.code === 'NumpadSubtract')) { e.preventDefault(); zoomOut(); return; }
      if (mod && (e.key === '0' || e.code === 'Digit0' || e.code === 'Numpad0')) { e.preventDefault(); setZoomMode(1); return; }
      // Zoom-to-fit lives on Shift+1 (below the inField guard, like Shift+2). Ctrl+9
      // is a browser tab-switch accelerator that page preventDefault can't intercept.
      if (inField) return;   // below: editor shortcuts, suppressed while typing
      // Work regardless of selection:
      if (mod && (e.key === 'a' || e.key === 'A')) { e.preventDefault(); selectAll(); return; }
      if (mod && (e.key === 'v' || e.key === 'V')) { e.preventDefault(); pasteClipboard(); return; }
      // Zoom-to-fit (Shift+1) works regardless of selection.
      if (e.shiftKey && !mod && !e.altKey && e.code === 'Digit1') { e.preventDefault(); setZoomMode('fit'); return; }
      if (selectedIds.length === 0) return;
      // Need a selection:
      if (mod && (e.key === 'c' || e.key === 'C')) { e.preventDefault(); copySelected(); return; }
      if (mod && (e.key === 'd' || e.key === 'D')) { e.preventDefault(); duplicateLayer(); return; }
      if (mod && e.key === ']') { e.preventDefault(); reorderSelected(e.shiftKey ? 'front' : 'forward'); return; }
      if (mod && e.key === '[') { e.preventDefault(); reorderSelected(e.shiftKey ? 'back' : 'backward'); return; }
      // Align (Alt + key); Alt+Shift on the centre keys distributes. Uses e.code
      // so it's layout-independent and unaffected by Alt producing glyphs.
      if (e.altKey && !mod) {
        const c = e.code;
        if (c === 'KeyA') { e.preventDefault(); alignLayer('left'); return; }
        // Align-right is Alt+Shift+D: plain Alt+D is a browser address-bar (omnibox)
        // accelerator that page preventDefault can't suppress, so it would steal focus.
        if (c === 'KeyD' && e.shiftKey) { e.preventDefault(); alignLayer('right'); return; }
        if (c === 'KeyW') { e.preventDefault(); alignLayer('top'); return; }
        if (c === 'KeyS') { e.preventDefault(); alignLayer('bottom'); return; }
        if (c === 'KeyH') { e.preventDefault(); if (e.shiftKey) distribute('x'); else alignLayer('cx'); return; }
        if (c === 'KeyV') { e.preventDefault(); if (e.shiftKey) distribute('y'); else alignLayer('cy'); return; }
      }
      // Zoom to selection (frameSelection no-ops without a selection).
      if (e.shiftKey && !mod && !e.altKey && e.code === 'Digit2') { e.preventDefault(); frameSelection(); return; }
      // If an overlay is open, let its own Esc handler close it and leave the
      // selection intact — otherwise one Escape both dismisses the overlay and
      // wipes the selection.
      if (e.key === 'Escape') {
        if (ctxMenu || exportOpen || helpOpen) return;
        setSelectedIds([]);
        return;
      }
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
  }, [selectedIds, deleteSelected, undo, redo, duplicateLayer, copySelected, pasteClipboard, selectAll, reorderSelected, alignLayer, distribute, fit, selBounds, ctxMenu, exportOpen, helpOpen]);

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
    const onScroll = () => { if (isPanningRef.current || raf) return; raf = requestAnimationFrame(() => { raf = 0; computeRulers(); }); };
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

  // Entering preview frames the label: drop any manual zoom back to fit and
  // clear the pan so the artwork is centred in the now chrome-free viewport.
  // (autoFit itself recomputes from the ResizeObserver once the rulers are gone.)
  function togglePreview() {
    const entering = !preview;
    setPreview(entering);
    if (entering) {
      setZoomMode('fit');
      setWrapOffset({ x: 0, y: 0 });
    }
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

  // Frame the current selection: zoom so its bounds fill the viewport (with a
  // margin) and scroll it to the centre. No-op without a selection.
  function frameSelection() {
    const b = selBounds;
    const stage = canvasRef.current;
    const wrap = wrapRef.current;
    if (!b || !stage || !wrap || b.w < 1 || b.h < 1) return;
    const margin = 80; // screen-px breathing room around the selection
    const sw = stage.clientWidth, sh = stage.clientHeight;
    const z = Math.max(0.05, Math.min(4, Math.min((sw - margin) / b.w, (sh - margin) / b.h)));
    setZoomMode(z);
    requestAnimationFrame(() => {
      const w = wrapRef.current, st = canvasRef.current;
      if (!w || !st) return;
      const wr = w.getBoundingClientRect(), sr = st.getBoundingClientRect();
      st.scrollLeft += (wr.left + (b.x + b.w / 2) * z) - (sr.left + sw / 2);
      st.scrollTop  += (wr.top  + (b.y + b.h / 2) * z) - (sr.top  + sh / 2);
    });
  }

  // Wheel → cursor-anchored zoom (no modifier needed; pinch-zoom, which arrives
  // as ctrl+wheel, lands here too). Panning is middle-mouse drag (or Space +
  // left-drag), so the wheel is free to zoom directly. Must be a NATIVE
  // non-passive listener: React's onWheel is passive (React 17+), so
  // preventDefault there is ignored and the browser would scroll/page-zoom.
  // Re-runs on `fit` change so zoomAt closes over the current scale.
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const handler = (e) => {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      zoomAt(e.clientX, e.clientY, factor);
    };
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, [fit]);

  // Pan with middle-mouse or Space + left-mouse. The stage's native scroll only
  // has range when the zoomed canvas overflows the viewport — when it fits, or
  // once a scroll edge is reached, scrolling does nothing. So we consume the drag
  // with scroll first and apply whatever's left over to the wrap's translate
  // (wrapOffset), giving free panning at any zoom. The translate is mutated on
  // the DOM during the drag (no per-move re-render) and committed to state on up.
  const spaceHeldRef = useRef(false);
  function startPan(e) {
    e.preventDefault();
    const stage = canvasRef.current;
    const wrap = wrapRef.current;
    if (!stage) return;
    const x0 = e.clientX, y0 = e.clientY;
    const sl0 = stage.scrollLeft, st0 = stage.scrollTop;
    // Scroll range is fixed for the duration of one pan (zoom/size can't change
    // mid-drag), so measure it once instead of reflowing on every move.
    const maxX = Math.max(0, stage.scrollWidth - stage.clientWidth);
    const maxY = Math.max(0, stage.scrollHeight - stage.clientHeight);
    const ox0 = wrapOffsetRef.current.x, oy0 = wrapOffsetRef.current.y;
    let ox = ox0, oy = oy0;
    isPanningRef.current = true;
    document.body.style.cursor = 'grabbing';
    function move(ev) {
      const dx = ev.clientX - x0, dy = ev.clientY - y0;
      const tx = Math.min(Math.max(sl0 - dx, 0), maxX);
      const ty = Math.min(Math.max(st0 - dy, 0), maxY);
      stage.scrollLeft = tx;
      stage.scrollTop  = ty;
      // Content shift the scroll couldn't absorb → translate the wrap to match.
      ox = ox0 + (dx - (sl0 - tx));
      oy = oy0 + (dy - (st0 - ty));
      if (wrap) wrap.style.transform = `translate(${ox}px, ${oy}px)`;
    }
    function up() {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      document.removeEventListener('pointercancel', up);
      window.removeEventListener('blur', up);
      document.body.style.cursor = '';
      isPanningRef.current = false;
      // Commit the translate to state (so it survives the next render) and
      // refresh the rulers once now that the drag has settled.
      if (ox !== ox0 || oy !== oy0) setWrapOffset({ x: ox, y: oy });
      computeRulers();
    }
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
    document.addEventListener('pointercancel', up);
    window.addEventListener('blur', up);
  }
  // Right-click empty canvas (or the label background) → canvas context menu.
  // Unlocked-layer right-clicks stopPropagation in onLayerContextMenu, so they
  // don't reach here; a locked layer (e.g. the background) falls through.
  function onStageContextMenu(e) {
    e.preventDefault();
    const wrap = wrapRef.current;
    let labelX = 0, labelY = 0;
    if (wrap) {
      const r = wrap.getBoundingClientRect();
      labelX = (e.clientX - r.left) / fit;
      labelY = (e.clientY - r.top) / fit;
    }
    setCtxMenu({
      kind: 'canvas', labelX, labelY,
      x: Math.min(e.clientX, window.innerWidth - 210),
      y: Math.min(e.clientY, window.innerHeight - 300),
    });
  }
  function onStagePointerDown(e) {
    // Space + left-mouse → pan. (Middle-mouse pan is bound as a native listener
    // below so it can cancel the browser's autoscroll in time.)
    if (e.button === 0 && spaceHeldRef.current) {
      startPan(e);
      return;
    }
    // Left-press on the empty stage (the padding around the label) → marquee.
    if (e.button === 0 && e.target === e.currentTarget) startMarquee(e);
  }

  // Middle-mouse pan MUST be a native non-passive listener. React delegates
  // events at the root, so a synthetic mousedown only reaches our handler after
  // Chrome has already kicked off its middle-click autoscroll — by then
  // preventDefault() is ignored and the gesture turns into autoscroll instead of
  // a pan. Binding mousedown directly on the stage lets preventDefault land in
  // time. startPan reads only refs/event coords, so an empty-dep bind is safe.
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const onDown = (e) => {
      if (e.button !== 1) return;
      e.preventDefault();
      startPan(e);
    };
    el.addEventListener('mousedown', onDown);
    return () => el.removeEventListener('mousedown', onDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    // If focus leaves the window while Space is held, the keyup is delivered
    // elsewhere and the pan state would stick on — clear it on blur.
    function blur() {
      spaceHeldRef.current = false;
      document.body.classList.remove('space-pan');
    }
    document.addEventListener('keydown', down);
    document.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      document.removeEventListener('keydown', down);
      document.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
      document.body.classList.remove('space-pan');
    };
  }, []);

  // Apply + persist the editor theme (the label artwork keeps its own colours).
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    try { localStorage.setItem('hazardLabelStudio.theme', theme); } catch { /* ignore */ }
  }, [theme]);

  // Persist grid preferences.
  useEffect(() => {
    try { localStorage.setItem('hazardLabelStudio.grid', JSON.stringify(grid)); } catch { /* ignore */ }
  }, [grid]);

  // Close the right-click context menu on Escape (click-away is handled by its backdrop).
  useEffect(() => {
    if (!ctxMenu) return;
    const onEsc = (e) => { if (e.key === 'Escape') setCtxMenu(null); };
    window.addEventListener('keydown', onEsc);
    return () => window.removeEventListener('keydown', onEsc);
  }, [ctxMenu]);

  // Close the export popover on Escape (click-away is handled by its backdrop).
  useEffect(() => {
    if (!exportOpen) return;
    const onEsc = (e) => { if (e.key === 'Escape') setExportOpen(false); };
    window.addEventListener('keydown', onEsc);
    return () => window.removeEventListener('keydown', onEsc);
  }, [exportOpen]);

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
    // A symbol whose fetch failed is cached as '' (symbols.js), so pictoHref
    // returns '' and that <image> layer renders to nothing — silently absent
    // from the export. Detect it so we don't report a clean success for a
    // hazard label that's missing its (safety-critical) pictograms.
    const missing = design.layers.filter(
      l => l.type === 'image' && !l.hidden && !l.src && l.symbol && !symbolCache[l.symbol]
    ).length;
    const note = missing
      ? ` — ${missing} symbol${missing > 1 ? 's' : ''} failed to load; reload and re-export`
      : '';
    const hold = missing ? 4200 : 2200;
    const name = slug(docName);
    setExportOpen(false);   // commit: close the popover (the toast reports status)
    if (kind === 'svg') {
      exportSvg(svg, name);
      setExportMsg('Exported SVG' + note);
      setTimeout(() => setExportMsg(''), hold);
    } else {
      setExportMsg('Rendering PNG…');
      exportPng(svg, name, scale, (ok) => {
        setExportMsg(ok ? `Exported PNG @${scale}×` + note : `PNG too large at ${scale}× — try a smaller scale`);
        setTimeout(() => setExportMsg(''), ok ? hold : 2600);
      });
    }
  }

  // Copy the label to the clipboard as a PNG (2× for crispness).
  function doCopyImage() {
    const svg = labelRef.current && labelRef.current.getSvg();
    if (!svg) return;
    if (!navigator.clipboard || typeof window.ClipboardItem === 'undefined') {
      setExportMsg('Clipboard not supported here — use Export instead');
      setTimeout(() => setExportMsg(''), 2800);
      return;
    }
    setExportOpen(false);   // commit: close the popover (the toast reports status)
    setExportMsg('Copying…');
    svgToPngBlob(svg, 2, (b) => {
      if (!b) { setExportMsg('Copy failed — try Export'); setTimeout(() => setExportMsg(''), 2600); return; }
      navigator.clipboard.write([new window.ClipboardItem({ 'image/png': b })])
        .then(() => { setExportMsg('Copied to clipboard'); setTimeout(() => setExportMsg(''), 2200); })
        .catch(() => { setExportMsg('Copy failed — try Export'); setTimeout(() => setExportMsg(''), 2600); });
    });
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
            aria-pressed={design.severity === id}
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
              aria-pressed={design.format === f.id}
              onClick={() => applyPreset(f.id)}>
              <FormatIcon id={f.id} active={design.format === f.id} />
              <span>{f.name}</span>
            </button>
          ))}
      </div>
    </Field>
  );

  const blankShapeField = (
    <Field label="Canvas shape" hint="The base shape for your blank label — corners outside it export transparent.">
      <div className="picto-grid">
        {SHAPES.filter(s => s.type !== 'line' && s.type !== 'barcode').map(s => {
          const active = (bg?.shape || 'rect') === s.type;
          return (
            <button key={s.type} className={`picto-tile ${active ? 'on' : ''}`}
                    aria-pressed={active} title={s.name}
                    onClick={() => changeCanvasShape(s.type)}>
              <svg width="40" height="40" viewBox="0 0 16 16">{s.el}</svg>
              <span>{s.name}</span>
            </button>
          );
        })}
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
            <div key={p.id}
                 className={`layer-row ${p.id === activePresetId ? 'on' : ''}`}
                 onClick={() => applyUserPreset(p.id)}
                 title={p.id === activePresetId ? 'Loaded — click to reapply' : 'Apply preset'}>
              <span className="layer-glyph">
                <svg width="14" height="14" viewBox="0 0 14 14">
                  <path d="M3 2h6l2 2v8H3z" fill="none" stroke="currentColor" strokeWidth="1.2" />
                </svg>
              </span>
              <span className="layer-name">{p.name}</span>
              <span className="layer-meta">{p.design.width}×{p.design.height}</span>
              <button className="icon-btn" title="Update preset with current design"
                      onClick={e => { e.stopPropagation(); updateUserPreset(p.id); }}>
                <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor"
                     strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M13.6 8a5.6 5.6 0 1 1-1.7-4" />
                  <path d="M13.8 2.4V5.2h-2.8" />
                </svg>
              </button>
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
        <NumberInput live={false} value={design.width} onChange={v => setCanvasSize(v, design.height)} min={40} max={4000} suffix="W" />
        <NumberInput live={false} value={design.height} onChange={v => setCanvasSize(design.width, v)} min={40} max={4000} suffix="H" />
      </Row>
      <Row>
        <button className="ghost" onClick={() => {
          // applyUserPreset stores format:'custom' which isn't in FORMATS — guard.
          const f = FORMATS.find(x => x.id === design.format);
          if (!f) return;
          setCanvasSize(f.default[0], f.default[1]);
          setWrapOffset({ x: 0, y: 0 });
        }}>Reset</button>
        <button className="ghost" onClick={() => {
          setCanvasSize(design.height, design.width);
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
                  <ColorInput value={bg.stroke || '#000000'} onChange={v => setLayer(bg.id, { stroke: v, strokeWidth: bg.strokeWidth || 2 })} />
                </Row>
                <Row>
                  <Slider ariaLabel="Border width" value={bg.strokeWidth || 0} onChange={v => setLayer(bg.id, { strokeWidth: v })} min={0} max={40} step={0.5} />
                </Row>
              </Field>
              <Field label="Corner radius">
                <CornerRadius value={bg.radius || 0} onChange={v => setLayer(bg.id, { radius: v })} max={maxR}
                              corner={bg.corner} onCorner={c => setLayer(bg.id, { corner: c })} />
              </Field>
            </Section>
          </>
        );
      })()}
    </>
  );

  const dragLayerRef = useRef(null);
  const [dropTarget, setDropTarget] = useState(null);
  const dropPlacementFromEvent = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    // The visible list is reversed: above a row means higher/front in stack.
    return e.clientY < r.top + r.height / 2 ? 'after' : 'before';
  };
  const layerStackField = (
    <Field hint="Top of list = front. Click to select, drag selected rows to reorder.">
      <div className="layer-list">
        {design.layers.slice().reverse().map((l) => {
          const selected = selectedIds.includes(l.id);
          const movable = canMoveInStack(l);
          const activeDrop = dropTarget && dropTarget.id === l.id;
          const dropClass = activeDrop
            ? ` drop-target ${dropTarget.placement === 'after' ? 'drop-above' : 'drop-below'}`
            : '';
          return (
            <div
              key={l.id}
              className={`layer-row ${selected ? 'on' : ''} ${l.hidden ? 'hidden' : ''} ${l.locked ? 'locked' : ''} ${isStackBoundary(l) ? 'stack-locked' : ''}${dropClass}`}
              draggable={movable}
              onDragStart={e => {
                if (!movable) { e.preventDefault(); return; }
                const ids = selected ? selectedIds : [l.id];
                dragLayerRef.current = { ids, sourceId: l.id };
                if (!selected) setSelectedIds([l.id]);
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', l.id);
              }}
              onDragOver={e => {
                const drag = dragLayerRef.current;
                if (!drag || drag.ids.includes(l.id)) return;
                const placement = dropPlacementFromEvent(e);
                const canDrop = moveStackLayers(design.layers, drag.ids, {
                  kind: 'insert',
                  targetId: l.id,
                  placement,
                }) !== design.layers;
                if (!canDrop) {
                  if (dropTarget && dropTarget.id === l.id) setDropTarget(null);
                  return;
                }
                e.preventDefault();
                if (!dropTarget || dropTarget.id !== l.id || dropTarget.placement !== placement) {
                  setDropTarget({ id: l.id, placement });
                }
              }}
              onDragLeave={() => {
                setDropTarget(t => (t && t.id === l.id ? null : t));
              }}
              onDrop={e => {
                e.preventDefault();
                const drag = dragLayerRef.current;
                const placement = dropPlacementFromEvent(e);
                dragLayerRef.current = null;
                setDropTarget(null);
                if (drag && !drag.ids.includes(l.id)) moveLayersToTarget(drag.ids, l.id, placement);
              }}
              onDragEnd={() => { dragLayerRef.current = null; setDropTarget(null); }}
              onClick={e => {
                if (e.shiftKey) setSelectedIds(ids => ids.includes(l.id) ? ids.filter(i => i !== l.id) : [...ids, l.id]);
                else setSelectedIds([l.id]);
              }}
            >
              <span className="layer-glyph"><LayerGlyph type={l.type} /></span>
              <span className="layer-name">{l.name || l.type}</span>
              <LayerBadges layer={l} />
              <button className="icon-btn" title={l.hidden ? 'Show' : 'Hide'}
                      onClick={e => { e.stopPropagation(); setLayer(l.id, { hidden: !l.hidden }); }}>
                {l.hidden ? '◌' : '●'}
              </button>
              <button className="icon-btn" title={l.locked ? 'Unlock' : 'Lock'}
                      onClick={e => { e.stopPropagation(); setLayer(l.id, { locked: !l.locked }); }}>
                {l.locked ? '🔒' : '🔓'}
              </button>
              <button className="icon-btn" title={isStackBoundary(l) ? 'Stack boundary' : 'Bring forward'}
                      disabled={!movable}
                      onClick={e => { e.stopPropagation(); if (movable) moveLayer(l.id, 'up'); }}>▲</button>
              <button className="icon-btn" title={isStackBoundary(l) ? 'Stack boundary' : 'Send back'}
                      disabled={!movable}
                      onClick={e => { e.stopPropagation(); if (movable) moveLayer(l.id, 'down'); }}>▼</button>
              <button className="icon-btn" title={l.locked ? 'Unlock first to delete' : 'Delete'}
                      disabled={l.locked}
                      onClick={e => { e.stopPropagation(); if (!l.locked) deleteLayer(l.id); }}>×</button>
            </div>
          );
        })}
      </div>
    </Field>
  );

  const symbolsField = (
    <Field label="Symbols" hint="Click to apply to the selected symbol layer, or add a new one.">
      <SymbolPicker
        activeId={selectedLayer && selectedLayer.type === 'image' ? selectedLayer.symbol : null}
        cache={symbolCache}
        onUpload={addImageFromFile}
        onPick={(id) => {
          if (selectedLayer && selectedLayer.type === 'image') {
            setLayer(selectedLayer.id, { symbol: id, src: undefined });
          } else {
            const nl = newLayer('image', design.width, design.height);
            if (nl) {
              nl.symbol = id;
              setDesign(d => ({ ...d, layers: [...d.layers, nl] }));
              setSelectedIds([nl.id]);
            }
          }
        }}
      />
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
      <Field label="Clipboard" hint="Paste straight into email, docs or chat.">
        <button className="export-btn" onClick={doCopyImage}>
          <span>Copy image (PNG)</span>
          <span className="ext">@2×</span>
        </button>
      </Field>
    </>
  );

  const shapesField = (
    <Field label="Shapes" hint="Click to add a shape, then style it in Properties.">
      <div className="picto-grid">
        {SHAPES.map(s => (
          <button key={s.type} className="picto-tile" onClick={() => addLayer(s.type)} title={`Add ${s.name.toLowerCase()}`}>
            <svg width="40" height="40" viewBox="0 0 16 16">{s.el}</svg>
            <span>{s.name}</span>
          </button>
        ))}
      </div>
    </Field>
  );

  const railBtns = [
    { id: 'templates', title: 'Templates', kind: 'panel', icon: 'M2 2h5v5H2zM9 2h5v5H9zM2 9h5v5H2zM9 9h5v5H9z' },
    { id: 'shapes', title: 'Shapes', kind: 'panel', icon: 'M8 2 L14 6.5 L11.6 13.5 H4.4 L2 6.5 Z' },
    { id: 'symbols', title: 'Symbols', kind: 'panel', icon: 'M8 2l6 11H2z' },
    { id: 'text', title: 'Add text', kind: 'add', type: 'text', icon: 'M3 3h10v2M8 5v8M6 13h4' },
    { id: 'rect', title: 'Add rectangle', kind: 'add', type: 'rect', icon: 'M2.5 4h11v8h-11z' },
    { id: 'list', title: 'Add list', kind: 'add', type: 'bullets', icon: 'M2 4h2M6 4h8M2 8h2M6 8h8M2 12h2M6 12h8' },
    { id: 'line', title: 'Add line', kind: 'add', type: 'line', icon: 'M2 8h12' },
    { id: 'barcode', title: 'Add barcode', kind: 'add', type: 'barcode', icon: 'M2.5 3v10M5 3v10M6.5 3v10M9 3v10M10.5 3v10M13.5 3v10' },
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
        <div
          className="brand"
          role={onHome ? 'button' : undefined}
          tabIndex={onHome ? 0 : undefined}
          title={onHome ? 'Back to the start page' : undefined}
          style={onHome ? { cursor: 'pointer' } : undefined}
          onClick={onHome}
          onKeyDown={onHome ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onHome(); } } : undefined}
        >
          <div className="brand-mark">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinejoin="round" strokeLinecap="round">
              <path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z" />
              <circle cx="7.5" cy="7.5" r="1.3" fill="currentColor" stroke="none" />
            </svg>
          </div>
          <div>
            <div className="brand-name">Label Studio</div>
            <div className="brand-sub">Labels · Signs · Stickers</div>
          </div>
        </div>

        <div className="doc-bar">
          <input className="doc-name" aria-label="Document name" value={docName} onChange={e => setDocName(e.target.value)} spellCheck={false} />
          <span className={`save-state ${saveState}`}>{saveState === 'saving' ? 'Saving…' : '✓ Saved'}</span>
        </div>

        <div className="topbar-actions">
          <div className="tb-group">
            <button className="icon-btn" title="Undo (Ctrl+Z)" onClick={undo}
                    disabled={editor.past.length === 0 && editor.design === lastCommittedDesign.current}>↶</button>
            <button className="icon-btn" title="Redo (Ctrl+Shift+Z)" onClick={redo}
                    disabled={editor.future.length === 0}>↷</button>
          </div>
          <button className="icon-btn" aria-pressed={theme === 'dark'}
                  title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
                  onClick={() => setTheme(t => (t === 'dark' ? 'light' : 'dark'))}>
            {theme === 'dark' ? '☀' : '☾'}
          </button>
          <button className={`btn-lg${preview ? ' on' : ''}`} onClick={togglePreview}>
            {preview ? 'Exit preview' : 'Preview'}
          </button>
          <div className="export-wrap">
            <button className="btn-lg primary" aria-expanded={exportOpen} aria-haspopup="true"
                    onClick={() => setExportOpen(o => !o)}>Export ▾</button>
            {exportOpen && <>
              <div className="ctx-backdrop" style={{ zIndex: 39 }} onMouseDown={() => setExportOpen(false)} />
              <div className="export-pop">{exportBody}</div>
            </>}
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
            aria-pressed={b.kind === 'panel' ? leftPanel === b.id : undefined}
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
              {design.format === 'blank' && blankShapeField}
              {userPresetsField}
            </>
          )}

          {leftPanel === 'shapes' && shapesField}
          {leftPanel === 'symbols' && symbolsField}
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
            onContextMenu={onStageContextMenu}
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
                symbolsReady={!!symbolCache}
                editingId={editingTextId}
                onLayerPointerDown={onLayerPointerDown}
                onCanvasPointerDown={onCanvasPointerDown}
                onLayerContextMenu={onLayerContextMenu}
                onLayerDoubleClick={onLayerDoubleClick}
              />
            </div>

            {grid.show && (
              <div className="overlay" style={{
                backgroundImage: 'linear-gradient(to right, var(--line-strong) 1px, transparent 1px), linear-gradient(to bottom, var(--line-strong) 1px, transparent 1px)',
                backgroundSize: `${grid.step * fit}px ${grid.step * fit}px`,
                opacity: 0.5,
              }} />
            )}

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
                {snapGuides.map((g, i) => {
                  if (g.kind === 'gap') {
                    return g.orient === 'h' ? (
                      <div key={`g${i}`} className="gap-guide h" style={{ left: Math.min(g.x1, g.x2) * fit, top: g.y * fit, width: Math.abs(g.x2 - g.x1) * fit }} />
                    ) : (
                      <div key={`g${i}`} className="gap-guide v" style={{ left: g.x * fit, top: Math.min(g.y1, g.y2) * fit, height: Math.abs(g.y2 - g.y1) * fit }} />
                    );
                  }
                  return g.orient === 'v' ? (
                    <div key={`v${i}`} className="snap-guide v" style={{ left: g.value * fit }} />
                  ) : (
                    <div key={`h${i}`} className="snap-guide h" style={{ top: g.value * fit }} />
                  );
                })}
              </div>
            )}

            {/* Selected-layer handles + dimension chip */}
            {selectedLayer && !selectedLayer.locked && !preview && editingTextId !== selectedLayer.id && (
              <div className="overlay">
                <div className="dim-chip" style={{
                  left: (selectedLayer.x + selectedLayer.w / 2) * fit,
                  top: (selectedLayer.y + selectedLayer.h) * fit + 8,
                }}>
                  {hudLabel(selectedLayer.w, selectedLayer.h)}
                </div>
                <Handles
                  kind="layer"
                  box={selectedLayer}
                  fit={fit}
                  rotation={selectedLayer.rotation || 0}
                  onHandleDown={(e, mode) => startLayerResize(e, mode)}
                  onRotateDown={startRotate}
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
                <div className="dim-chip" style={{
                  left: (selBounds.x + selBounds.w / 2) * fit,
                  top: (selBounds.y + selBounds.h) * fit + 8,
                }}>
                  {hudLabel(selBounds.w, selBounds.h)}
                </div>
                <div className="group-box" style={{
                  left: selBounds.x * fit, top: selBounds.y * fit,
                  width: selBounds.w * fit, height: selBounds.h * fit,
                }} />
                <Handles
                  kind="group"
                  box={selBounds}
                  fit={fit}
                  cornersOnly
                  showOutline={false}
                  onHandleDown={(e, mode) => startGroupResize(e, mode)}
                  onRotateDown={startGroupRotate}
                />
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

            {/* Inline text editor — a positioned textarea over the (hidden) text layer */}
            {editingTextId && !preview && (() => {
              const l = design.layers.find(x => x.id === editingTextId);
              if (!l || l.type !== 'text') return null;
              const sev = SEVERITY[design.severity] || SEVERITY.danger;
              const fontSize = Math.max(4, l.fontSize || 16);
              const color = l.bindSeverity === 'band' ? sev.band
                : l.bindSeverity === 'bandInk' ? sev.bandInk
                : (l.fill || '#000000');
              return (
                <div className="overlay">
                  <textarea
                    className="inline-edit"
                    autoFocus
                    value={editingDraft}
                    onChange={e => setEditingDraft(e.target.value)}
                    onKeyDown={e => {
                      e.stopPropagation();
                      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commitTextEdit(); }
                      else if (e.key === 'Escape') { e.preventDefault(); cancelTextEdit(); }
                    }}
                    onBlur={commitTextEdit}
                    style={{
                      left: l.x * fit, top: l.y * fit,
                      width: l.w * fit, height: l.h * fit,
                      transform: l.rotation ? `rotate(${l.rotation}deg)` : undefined,
                      transformOrigin: 'center',
                      fontFamily: FONTS[l.fontFamily] || FONTS.sans,
                      fontSize: fontSize * fit,
                      fontWeight: l.fontWeight || 400,
                      fontStyle: l.italic ? 'italic' : 'normal',
                      lineHeight: l.lineHeight || 1.2,
                      letterSpacing: (l.letterSpacing || 0) * fontSize * fit,
                      textAlign: l.align === 'middle' ? 'center' : l.align === 'end' ? 'right' : 'left',
                      textTransform: l.uppercase ? 'uppercase' : 'none',
                      color,
                    }}
                  />
                </div>
              );
            })()}
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
                  <svg viewBox="0 0 16 16" width="18" height="18">
                    <rect x="1.5" y="3" width="2.5" height="10" rx="1" fill="currentColor" />
                    <rect x="6.75" y="3" width="2.5" height="10" rx="1" fill="currentColor" />
                    <rect x="12" y="3" width="2.5" height="10" rx="1" fill="currentColor" />
                  </svg>
                </button>
                <button className="icon-btn" title="Distribute vertically" onClick={() => distribute('y')}>
                  <svg viewBox="0 0 16 16" width="18" height="18">
                    <rect x="3" y="1.5" width="10" height="2.5" rx="1" fill="currentColor" />
                    <rect x="3" y="6.75" width="10" height="2.5" rx="1" fill="currentColor" />
                    <rect x="3" y="12" width="10" height="2.5" rx="1" fill="currentColor" />
                  </svg>
                </button>
              </>
            )}
            <span className="tb-sep" />
            <button className="icon-btn" title="Flip horizontal" onClick={() => flipSelected('h')}><FlipIcon axis="h" /></button>
            <button className="icon-btn" title="Flip vertical" onClick={() => flipSelected('v')}><FlipIcon axis="v" /></button>
            <span className="tb-sep" />
            <button className="icon-btn" title="Duplicate" onClick={duplicateLayer}>
              <svg viewBox="0 0 16 16" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.4">
                <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
                <path d="M10.5 5.5V4A1.5 1.5 0 0 0 9 2.5H4A1.5 1.5 0 0 0 2.5 4v5A1.5 1.5 0 0 0 4 10.5h1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <button className="icon-btn danger" title="Delete" onClick={deleteSelected}>
              <svg viewBox="0 0 16 16" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.6 4.5l.6 8.4a1 1 0 0 0 1 .9h3.6a1 1 0 0 0 1-.9l.6-8.4" />
              </svg>
            </button>
          </div>
        )}

        <div className="canvas-bottom">
          <span className="dim-readout">{design.width} × {design.height}px</span>
          <span className="canvas-credit" title="Labels are provided as-is — you are responsible for ensuring they meet applicable safety regulations. Symbols from Wikimedia Commons (ISO 7010, GHS, ISO 7001).">
            Provided as-is — you're responsible for meeting applicable safety regulations. Symbols: Wikimedia Commons (ISO 7010 · GHS · ISO 7001).
          </span>
          <div className="canvas-grid-ctl">
            <button className={`icon-btn${grid.show ? ' on' : ''}`} aria-pressed={grid.show} title="Show grid"
                    onClick={() => setGrid(g => ({ ...g, show: !g.show }))}>
              <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.2">
                <rect x="2" y="2" width="12" height="12" rx="1" /><line x1="6" y1="2" x2="6" y2="14" /><line x1="10" y1="2" x2="10" y2="14" /><line x1="2" y1="6" x2="14" y2="6" /><line x1="2" y1="10" x2="14" y2="10" />
              </svg>
            </button>
            <button className={`icon-btn${grid.snap ? ' on' : ''}`} aria-pressed={grid.snap} title="Snap to grid"
                    onClick={() => setGrid(g => ({ ...g, snap: !g.snap }))}>
              <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor">
                {[3, 8, 13].flatMap(x => [3, 8, 13].map(y => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.3" />))}
              </svg>
            </button>
            <button className={`icon-btn${grid.smart ? ' on' : ''}`} aria-pressed={grid.smart} title="Smart guides (align + equal spacing)"
                    onClick={() => setGrid(g => ({ ...g, smart: !g.smart }))}>
              <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.3">
                <line x1="2.5" y1="3" x2="2.5" y2="13" /><line x1="13.5" y1="3" x2="13.5" y2="13" /><line x1="8" y1="5" x2="8" y2="11" />
                <path d="M4 8 H6.5 M9.5 8 H12" strokeWidth="1" />
              </svg>
            </button>
            <NumberInput value={grid.step} min={2} max={200} step={1} live={false} ariaLabel="Grid size (px)" title="Grid size (px)"
                         onChange={v => setGrid(g => ({ ...g, step: Math.max(2, Math.min(200, Math.round(v) || g.step)) }))} />
          </div>
          <div className="canvas-zoom">
            <button className={`icon-btn${zoomMode === 'fit' ? ' on' : ''}`} aria-pressed={zoomMode === 'fit'} title="Fit to viewport" onClick={() => setZoomMode('fit')}>⤢</button>
            <button className="icon-btn" title="Zoom out" onClick={zoomOut}>−</button>
            <input
              className="zoom-slider"
              type="range" min={0.05} max={4} step={0.01}
              value={fit}
              onChange={e => setZoomMode(Number(e.target.value))}
              aria-label="Zoom level"
              aria-valuetext={`${Math.round(fit * 100)}%`}
              title="Zoom"
            />
            <button className="icon-btn" title="Zoom in" onClick={zoomIn}>+</button>
            <button className="zoom-pct" title="Reset to 100%" onClick={() => setZoomMode(1)}>{Math.round(fit * 100)}%</button>
          </div>
        </div>
      </main>

      {/* ---------- Right panel ---------- */}
      <aside className="rightpanel">
        <div className="panel">
          {/* Layers on top, then the context-sensitive properties below. */}
          <Section title="Layers">{layerStackField}</Section>
          {selectedLayer ? (
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
          )}
        </div>
      </aside>

      {exportMsg && <div className="export-msg toast">{exportMsg}</div>}
      {helpOpen && <HelpModal onClose={() => setHelpOpen(false)} />}

      {ctxMenu && (
        <>
          <div className="ctx-backdrop"
               onMouseDown={() => setCtxMenu(null)}
               onContextMenu={e => { e.preventDefault(); setCtxMenu(null); }} />
          {ctxMenu.kind === 'canvas' ? (
          <div className="ctx-menu" style={{ left: ctxMenu.x, top: ctxMenu.y }}>
            <button disabled={!(clipboardRef.current && clipboardRef.current.length)} onClick={() => { pasteClipboardAt(ctxMenu.labelX, ctxMenu.labelY); setCtxMenu(null); }}>Paste here <span>Ctrl+V</span></button>
            <button onClick={() => { selectAll(); setCtxMenu(null); }}>Select all <span>Ctrl+A</span></button>
            <div className="ctx-sep" />
            <button onClick={() => { addLayer('text'); setCtxMenu(null); }}>Add text</button>
            <button onClick={() => { addLayer('rect'); setCtxMenu(null); }}>Add rectangle</button>
            <button onClick={() => { addLayer('ellipse'); setCtxMenu(null); }}>Add ellipse</button>
            <button onClick={() => { addLayer('line'); setCtxMenu(null); }}>Add line</button>
            <div className="ctx-sep" />
            <button onClick={() => { setZoomMode('fit'); setCtxMenu(null); }}>Fit to viewport</button>
            <button disabled={!selBounds} onClick={() => { frameSelection(); setCtxMenu(null); }}>Zoom to selection <span>Shift+2</span></button>
          </div>
          ) : (
          <div className="ctx-menu" style={{ left: ctxMenu.x, top: ctxMenu.y }}>
            <button onClick={() => { duplicateLayer(); setCtxMenu(null); }}>Duplicate <span>Ctrl+D</span></button>
            <button onClick={() => { copySelected(); setCtxMenu(null); }}>Copy <span>Ctrl+C</span></button>
            <button onClick={() => { pasteClipboard(); setCtxMenu(null); }}>Paste <span>Ctrl+V</span></button>
            <div className="ctx-sep" />
            <button onClick={() => { reorderSelected('front'); setCtxMenu(null); }}>Bring to front</button>
            <button onClick={() => { reorderSelected('forward'); setCtxMenu(null); }}>Bring forward <span>Ctrl+]</span></button>
            <button onClick={() => { reorderSelected('backward'); setCtxMenu(null); }}>Send backward <span>Ctrl+[</span></button>
            <button onClick={() => { reorderSelected('back'); setCtxMenu(null); }}>Send to back</button>
            <div className="ctx-sep" />
            <button onClick={() => { setDesign(d => ({ ...d, layers: d.layers.map(l => selectedIds.includes(l.id) ? { ...l, locked: !l.locked } : l) })); setCtxMenu(null); }}>Lock / Unlock</button>
            <button onClick={() => { setDesign(d => ({ ...d, layers: d.layers.map(l => selectedIds.includes(l.id) ? { ...l, hidden: !l.hidden } : l) })); setCtxMenu(null); }}>Hide / Show</button>
            <div className="ctx-sep" />
            <button className="danger" onClick={() => { deleteSelected(); setCtxMenu(null); }}>Delete <span>Del</span></button>
          </div>
          )}
        </>
      )}
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
      <Section title="Blend">
        <Field label="Blend mode">
          <select className="select-input" value={layer.blend || 'normal'}
                  onChange={e => onChange({ blend: e.target.value === 'normal' ? null : e.target.value })}>
            {BLEND_MODES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </Field>
      </Section>

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
        </Field>
        <Field label="Rotation">
          <Slider ariaLabel="Rotation" value={Math.round(layer.rotation || 0)} onChange={v => onChange({ rotation: v })} min={-180} max={180} step={1} />
        </Field>
      </Section>

      {layer.type === 'text' && <Section title="Typography"><TextProps layer={layer} onChange={onChange} /></Section>}
      {layer.type === 'bullets' && <Section title="List"><BulletsProps layer={layer} onChange={onChange} /></Section>}
      {layer.type === 'rect' && <Section title="Appearance"><RectProps layer={layer} onChange={onChange} /></Section>}
      {layer.type === 'polygon' && <Section title="Appearance"><PolygonProps layer={layer} onChange={onChange} /></Section>}
      {layer.type === 'ellipse' && <Section title="Appearance"><PolygonProps layer={layer} onChange={onChange} /></Section>}
      {layer.type === 'image' && <Section title="Symbol"><ImageProps layer={layer} onChange={onChange} cache={cache} /></Section>}
      {layer.type === 'line' && <Section title="Appearance"><LineProps layer={layer} onChange={onChange} /></Section>}
      {layer.type === 'barcode' && <Section title="Barcode"><BarcodeProps layer={layer} onChange={onChange} /></Section>}

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
        <Field label="Opacity">
          <Slider ariaLabel="Layer opacity"
                  value={Math.round((layer.opacity == null ? 1 : layer.opacity) * 100)}
                  min={0} max={100} step={1}
                  onChange={v => onChange({ opacity: v >= 100 ? null : v / 100 })} />
        </Field>
        {['rect', 'ellipse', 'polygon'].includes(layer.type) && (
          <Field label="Hole" hint="Punch this shape through the whole label as a transparent cutout (e.g. a tag hole).">
            <Seg
              value={layer.hole ? 'hole' : 'solid'}
              onChange={v => onChange({ hole: v === 'hole' })}
              options={[{ value: 'solid', label: 'Solid' }, { value: 'hole', label: 'Hole' }]}
            />
          </Field>
        )}
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
      <Field label="Size">
        <Slider ariaLabel="Font size" value={Math.round(layer.fontSize || 16)} onChange={v => onChange({ fontSize: v })} min={4} max={200} step={1} />
      </Field>
      <Field label="Weight">
        <Seg
          value={String(layer.fontWeight || 400)}
          onChange={v => onChange({ fontWeight: Number(v) })}
          options={[
            { value: '400', label: 'Regular' },
            { value: '700', label: 'Bold' },
            { value: '900', label: 'Extra' },
          ]}
        />
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
      <Field label="Tracking">
        <Slider ariaLabel="Letter spacing" value={Number(((layer.letterSpacing || 0)).toFixed(2))} onChange={v => onChange({ letterSpacing: v })} min={-0.05} max={0.5} step={0.01} />
      </Field>
      <Field label="Line height">
        <Slider ariaLabel="Line height" value={Number(((layer.lineHeight || 1.2)).toFixed(2))} onChange={v => onChange({ lineHeight: v })} min={0.8} max={2.5} step={0.05} />
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
        <Slider ariaLabel="Font size" value={Math.round(layer.fontSize || 16)} onChange={v => onChange({ fontSize: v })} min={4} max={120} step={1} />
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
        <ColorInput value={layer.stroke || '#000000'} onChange={v => onChange({ stroke: v, strokeWidth: layer.strokeWidth || 2 })} />
        <Row><Slider ariaLabel="Stroke width" value={layer.strokeWidth || 0} onChange={v => onChange({ strokeWidth: v })} min={0} max={40} step={0.5} /></Row>
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
        <CornerRadius value={layer.radius || 0} onChange={v => onChange({ radius: v })} max={maxR}
                      corner={layer.corner} onCorner={c => onChange({ corner: c })} />
      </Field>
    </>
  );
}

function ImageProps({ layer, onChange, cache }) {
  return (
    <>
      <Field label={layer.src ? 'Image' : 'Symbol'} hint={layer.src ? 'Custom uploaded image. Pick a symbol to replace it.' : 'Built-in plates, or upload your own.'}>
        <SymbolPicker activeId={layer.src ? null : layer.symbol} cache={cache}
          onPick={(id) => onChange({ symbol: id, src: undefined })}
          onUpload={(file) => readImageFile(file, (src) => onChange({ src, symbol: undefined }))} />
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
  const isStar = layer.shape === 'star';
  const sides = layer.sides || 5;
  const inner = layer.inner == null ? 0.42 : layer.inner;
  return (
    <>
      {isStar && (
        <Field label="Star">
          <Row><Slider ariaLabel="Star points" label="Points"
                       value={sides} min={3} max={12} step={1}
                       onChange={v => onChange({ sides: v, points: starPoints(v, inner) })} /></Row>
          <Row><Slider ariaLabel="Star spikiness" label="Spikiness"
                       value={Number((1 - inner).toFixed(2))} min={0.1} max={0.85} step={0.01}
                       onChange={v => { const ni = 1 - v; onChange({ inner: ni, points: starPoints(sides, ni) }); }} /></Row>
        </Field>
      )}
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
        <ColorInput value={layer.stroke || '#000000'} onChange={v => onChange({ stroke: v, strokeWidth: layer.strokeWidth || 2 })} />
        <Row><Slider ariaLabel="Stroke width" value={layer.strokeWidth || 0} onChange={v => onChange({ strokeWidth: v })} min={0} max={40} step={0.5} /></Row>
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
        <Slider ariaLabel="Line weight" value={layer.strokeWidth || 2} onChange={v => onChange({ strokeWidth: v })} min={0.5} max={40} step={0.5} />
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

function BarcodeProps({ layer, onChange }) {
  const variant = layer.variant || 'code128';
  const isLinear = variant !== 'qr';
  // 'none' OR a missing value both mean "transparent background".
  const bgNone = !layer.background || layer.background === 'none';
  return (
    <>
      <Field label="Data" hint={variant === 'code39'
        ? 'Scannable. Allowed: 0-9 A-Z space - . $ / + % — lower-case is upper-cased, anything else is dropped.'
        : 'Any text — it seeds the bar pattern (decorative, not scannable).'}>
        <input className="text-input" value={layer.data || ''}
               onChange={e => onChange({ data: e.target.value })}
               placeholder="012345678905" />
        {variant === 'code39' && (layer.data || '').trim() !== '' &&
          sanitizeCode39(layer.data) !== layer.data.toUpperCase() && (
          <div className="field-hint" style={{ marginTop: 4 }}>Encodes: {sanitizeCode39(layer.data)}</div>
        )}
      </Field>
      <Field label="Type">
        {/* Switching variant never touches geometry — the renderer letterboxes a
            square QR centred in whatever box the layer has, so a round-trip can't
            lose the box's width. Resize the layer for a bigger QR. */}
        <Seg value={variant} onChange={v => onChange({ variant: v })} options={BARCODE_VARIANTS} />
      </Field>
      {isLinear && (
        <Field label="Caption" hint="Show the value as text beneath the bars.">
          <Seg
            value={layer.showText === false ? 'off' : 'on'}
            onChange={v => onChange({ showText: v === 'on' })}
            options={[{ value: 'on', label: 'Shown' }, { value: 'off', label: 'Hidden' }]}
          />
        </Field>
      )}
      {variant === 'code128' && (
        <Field label="Density" hint="Roughly how many bars to pack in.">
          <Slider ariaLabel="Barcode density" value={layer.density || 3}
                  min={1} max={8} step={1} onChange={v => onChange({ density: v })} />
        </Field>
      )}
      <Field label="Bars">
        <ColorInput value={layer.fill || '#000000'} onChange={v => onChange({ fill: v, bindSeverity: null })} />
      </Field>
      <Field label="Background">
        <ColorInput value={bgNone ? '#FFFFFF' : layer.background}
                    onChange={v => onChange({ background: v })} />
        <div className="row" style={{ marginTop: 6 }}>
          <Seg
            value={bgNone ? 'none' : 'on'}
            onChange={v => onChange({ background: v === 'none' ? 'none' : (bgNone ? '#FFFFFF' : layer.background) })}
            options={[{ value: 'on', label: 'Solid' }, { value: 'none', label: 'None' }]}
          />
        </div>
      </Field>
    </>
  );
}
