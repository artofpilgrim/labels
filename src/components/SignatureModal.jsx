import { useEffect, useId, useRef, useState } from 'react';

// DocuSign-style "sign in a box" capture. You draw with mouse / finger / stylus
// (Pointer Events, so all three work the same); each pen-down→up is one stroke,
// and lifting + drawing again adds another (so you can dot an i or sign in
// pieces). On "Add to label" the raw strokes are handed back as
// [[{x,y}…], …] in surface-pixel coords; the caller (addInkLayer) tightens them
// to a bounding box, normalises, sizes and places the ink layer. No smoothing,
// no recognition — it stays a faithful vector trace so it prints crisp at any
// scale and recolours/resizes like any other layer.
const PEN = 2.6;   // on-screen pen width; passed back so the placed stroke keeps this weight

export function SignatureModal({ onCancel, onAdd }) {
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
      <div ref={ref} tabIndex={-1} className="modal sig-modal" role="dialog" aria-modal="true"
           aria-labelledby={titleId} onMouseDown={e => e.stopPropagation()}>
        <h2 id={titleId} className="confirm-title">Add your signature</h2>
        <p className="confirm-msg">Sign with your mouse, finger, or stylus — it’s added as a layer you can move, resize and recolour.</p>
        <svg ref={surfaceRef} className="sig-surface"
             onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
          <line className="sig-baseline" x1="5%" y1="76%" x2="95%" y2="76%" />
          {strokes.map((s, i) => (
            s.length === 1
              ? <circle key={i} className="sig-dot" cx={s[0].x} cy={s[0].y} r={PEN / 2} />
              : <polyline key={i} className="sig-ink" strokeWidth={PEN}
                          points={s.map(p => `${p.x},${p.y}`).join(' ')} />
          ))}
        </svg>
        <div className="sig-actions">
          <div className="sig-btns">
            <button type="button" className="ghost" disabled={!hasInk}
                    onClick={() => setStrokes(s => s.slice(0, -1))}>Undo</button>
            <button type="button" className="ghost" disabled={!hasInk}
                    onClick={() => setStrokes([])}>Clear</button>
          </div>
          <div className="sig-btns">
            <button type="button" className="btn-lg" onClick={onCancel}>Cancel</button>
            <button type="button" className="btn-lg on" disabled={!hasInk}
                    onClick={() => { if (hasInk) onAdd(strokes, PEN); }}>Add to label</button>
          </div>
        </div>
      </div>
    </div>
  );
}
