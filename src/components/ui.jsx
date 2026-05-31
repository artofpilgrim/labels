import { useEffect, useId, useRef, useState } from 'react';
import { useSectionOpen } from '../hooks/useUiPrefs.js';

// ----------- UI primitives -----------
// Drag-to-change for a field's unit label (X/Y/W/H/°…). Horizontal drag steps
// the value — 1px ≈ one `step`, Shift ×10, Alt ×0.1 — reusing the field's own
// onChange so clamp/commit/history are untouched. A 3px threshold preserves a
// plain click. Returns an onPointerDown to spread on the handle element.
function usePointerScrub({ value, onChange, step = 1, min, max }) {
  const start = useRef(null);
  // Holds the active gesture's teardown so an unmount mid-drag (e.g. the layer
  // is deleted, or the selection switches) tears down the window listeners and
  // clears the global scrubbing cursor instead of leaking them.
  const cleanupRef = useRef(null);
  useEffect(() => () => { if (cleanupRef.current) cleanupRef.current(); }, []);
  return (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const base = Number(value);
    start.current = { x: e.clientX, base: Number.isFinite(base) ? base : 0, moved: false };
    const onMove = (ev) => {
      const s = start.current;
      if (!s) return;
      const dx = ev.clientX - s.x;
      if (!s.moved && Math.abs(dx) < 3) return;
      if (!s.moved) { s.moved = true; document.body.classList.add('scrubbing'); }
      const mult = ev.shiftKey ? 10 : (ev.altKey ? 0.25 : 1);
      let n = s.base + dx * step * mult;
      if (max != null) n = Math.min(max, n);
      if (min != null) n = Math.max(min, n);
      n = Math.round(n / step) * step;          // snap to step granularity
      n = Math.round(n * 1e6) / 1e6;             // tidy float drift
      onChange(n);
    };
    const onUp = () => {
      start.current = null;
      document.body.classList.remove('scrubbing');
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      window.removeEventListener('blur', onUp);
      cleanupRef.current = null;
    };
    cleanupRef.current = onUp;
    // pointercancel (touch/pen/OS) and window blur (button released off-window,
    // so pointerup never arrives) both end the gesture — same teardown the
    // canvas drag uses, so a stuck cursor / leaked listener can't happen.
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    window.addEventListener('blur', onUp);
  };
}

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

// Collapsible accordion section for the right properties panel. When given a
// stable `id`, its open/closed state persists (keyed by that group id) and
// survives selection changes; without one it falls back to local state.
function Section({ title, children, defaultOpen = true, id }) {
  const [openLocal, setOpenLocal] = useState(defaultOpen);
  const [openPersisted, togglePersisted] = useSectionOpen(id || '', defaultOpen);
  const open = id ? openPersisted : openLocal;
  const toggle = id ? togglePersisted : () => setOpenLocal(o => !o);
  return (
    <div className={`section${open ? '' : ' collapsed'}`}>
      <button className="section-head" onClick={toggle}>
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
function NumberInput({ value, onChange, min, max, step = 1, suffix, ariaLabel, title, live = true, scrub = live }) {
  // The unit label doubles as a scrub handle (drag to change the value).
  const onScrub = usePointerScrub({ value, onChange, step, min, max });
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
      {suffix && (
        <span className={`num-suffix${scrub ? ' scrub' : ''}`}
              onPointerDown={scrub ? onScrub : undefined}
              title={scrub ? 'Drag to change · Shift ×10 · Alt slower' : undefined}>
          {suffix}
        </span>
      )}
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
function Slider({ value, onChange, min = 0, max = 100, step = 1, label, ariaLabel, unit }) {
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
  const onScrub = usePointerScrub({ value: v, onChange, step, min, max });
  return (
    <div className={`slider${label ? ' has-label' : ''}${unit ? ' has-unit' : ''}`}>
      {label && <span className="slider-label scrub" onPointerDown={onScrub} title="Drag to change">{label}</span>}
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
      {unit && <span className="slider-unit scrub" aria-hidden="true" onPointerDown={onScrub} title="Drag to change">{unit}</span>}
    </div>
  );
}

export { Field, Section, Row, K, Seg, NumberInput, ColorInput, Slider, BLEND_MODES };
