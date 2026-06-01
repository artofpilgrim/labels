import { useEffect, useId, useRef, useState } from 'react';
import { inkStrokePath } from '../core/ink.js';

// "Write in a box" capture. You draw with mouse / finger / stylus (Pointer
// Events, so all three work the same); each pen-down→up is one stroke, and
// lifting + drawing again adds another. On "Add to label" the raw strokes are
// handed back as [[{x,y}…], …] in surface-pixel coords; the caller (addInkLayer)
// tightens them to a bounding box, normalises, sizes and places the ink layer.
// Strokes are previewed as a smoothed curve (inkStrokePath) so what you see while
// writing matches the natural line that lands on the label — no recognition, no
// flattening: a faithful vector trace that prints crisp at any scale.
const PEN = 2.6;   // on-screen pen width; passed back so the placed stroke keeps this weight

export function HandwritingModal({ onCancel, onAdd }) {
  const ref = useRef(null);
  const surfaceRef = useRef(null);
  const drawingRef = useRef(false);
  const titleId = useId();
  const [strokes, setStrokes] = useState([]);   // [[{x,y}…], …], surface pixels

  // Isolate the modal from the editor's global shortcuts while it's open and let
  // Escape cancel — same approach as ConfirmDialog.
  useEffect(() => {
    const prevFocus = document.activeElement;
    if (ref.current) ref.current.focus();
    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); onCancel(); return; }
      e.stopPropagation();
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      if (prevFocus && prevFocus.focus) prevFocus.focus();
    };
  }, [onCancel]);

  const pt = (e) => {
    const r = surfaceRef.current.getBoundingClientRect();
    return { x: Math.round(e.clientX - r.left), y: Math.round(e.clientY - r.top) };
  };
  const down = (e) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    drawingRef.current = true;
    const p = pt(e);
    setStrokes(s => [...s, [p]]);                 // start a fresh stroke
  };
  const move = (e) => {
    if (!drawingRef.current) return;
    e.preventDefault();
    const p = pt(e);
    setStrokes(s => [...s.slice(0, -1), [...s[s.length - 1], p]]);
  };
  const up = (e) => {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
  };

  const hasInk = strokes.length > 0;

  return (
    <div className="modal-backdrop" onMouseDown={onCancel}>
      <div ref={ref} tabIndex={-1} className="modal hw-modal" role="dialog" aria-modal="true"
           aria-labelledby={titleId} onMouseDown={e => e.stopPropagation()}>
        <h2 id={titleId} className="confirm-title">Add handwriting</h2>
        <p className="confirm-msg">Write or draw with your mouse, finger, or stylus — it’s added as a layer you can move, resize and recolour.</p>
        <svg ref={surfaceRef} className="hw-surface"
             onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
          {strokes.map((s, i) => (
            s.length === 1
              ? <circle key={i} className="hw-dot" cx={s[0].x} cy={s[0].y} r={PEN / 2} />
              : <path key={i} className="hw-ink" strokeWidth={PEN} d={inkStrokePath(s)} />
          ))}
        </svg>
        <div className="hw-actions">
          <div className="hw-btns">
            <button type="button" className="ghost" disabled={!hasInk}
                    onClick={() => setStrokes(s => s.slice(0, -1))}>Undo</button>
            <button type="button" className="ghost" disabled={!hasInk}
                    onClick={() => setStrokes([])}>Clear</button>
          </div>
          <div className="hw-btns">
            <button type="button" className="btn-lg" onClick={onCancel}>Cancel</button>
            <button type="button" className="btn-lg on" disabled={!hasInk}
                    onClick={() => { if (hasInk) onAdd(strokes, PEN); }}>Add to label</button>
          </div>
        </div>
      </div>
    </div>
  );
}
