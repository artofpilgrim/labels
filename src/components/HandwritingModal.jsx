import { useEffect, useId, useMemo, useReducer, useRef, useState } from 'react';
import { inkStrokePath } from '../core/ink.js';

// "Write in a box" capture. You draw with mouse / finger / stylus (Pointer
// Events, so all three work the same); each pen-down→up is one stroke, and
// lifting + drawing again adds another. On "Add to label" the strokes are handed
// back as [[{x,y}…], …] in surface-pixel coords; the caller (addInkLayer)
// simplifies, normalises, sizes and places the ink layer.
//
// Hot-path care: the in-progress stroke lives in a ref and is appended to
// directly (no per-move array cloning); a sub-pixel distance threshold drops
// redundant samples; and the preview repaints at most once per animation frame.
// React state only changes when a stroke is committed / undone / cleared, so a
// long scribble doesn't thrash React or history while you draw.
const PEN = 2.6;               // on-screen pen width; passed back so the placed stroke keeps this weight
const MIN_DIST = 1.5;          // px a finger must move before a new sample is kept
const MIN_DIST2 = MIN_DIST * MIN_DIST;

const PencilIcon = (props) => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"
       strokeLinecap="round" strokeLinejoin="round" {...props}>
    <path d="M10.8 2.7 13.3 5.2 5.5 13 3 13.5 3.5 11z" />
    <path d="M9.6 3.9 12.1 6.4" />
  </svg>
);

export function HandwritingModal({ onCancel, onAdd }) {
  const ref = useRef(null);
  const surfaceRef = useRef(null);
  const liveRef = useRef(null);                  // in-progress stroke ({x,y}[]) or null
  const rafRef = useRef(0);
  const titleId = useId();
  const [strokes, setStrokes] = useState([]);    // committed strokes (undo / clear / render)
  const [, tick] = useReducer(x => x + 1, 0);    // bump to re-read liveRef on an animation frame

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
  useEffect(() => () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); }, []);

  const scheduleRender = () => {
    if (rafRef.current) return;                  // coalesce: at most one repaint per frame
    rafRef.current = requestAnimationFrame(() => { rafRef.current = 0; tick(); });
  };
  const pt = (e) => {
    const r = surfaceRef.current.getBoundingClientRect();
    return { x: Math.round(e.clientX - r.left), y: Math.round(e.clientY - r.top) };
  };
  const down = (e) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    liveRef.current = [pt(e)];
    scheduleRender();
  };
  const move = (e) => {
    const live = liveRef.current;
    if (!live) return;
    e.preventDefault();
    const p = pt(e);
    const last = live[live.length - 1];
    const dx = p.x - last.x, dy = p.y - last.y;
    if (dx * dx + dy * dy < MIN_DIST2) return;   // too close to the last sample — skip it
    live.push(p);                                // append in place; no array clone
    scheduleRender();
  };
  const up = (e) => {
    const live = liveRef.current;
    if (!live) return;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    liveRef.current = null;
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = 0; }
    setStrokes(s => [...s, live]);               // commit the finished stroke to state
  };

  // Committed strokes' paths only recompute when a stroke is added / removed —
  // not on every animation frame while the live stroke grows.
  const committed = useMemo(() => strokes.map(s => ({
    dot: s.length === 1 ? s[0] : null,
    d: s.length >= 2 ? inkStrokePath(s) : '',
  })), [strokes]);
  const live = liveRef.current;
  const isEmpty = strokes.length === 0 && !live;

  return (
    <div className="modal-backdrop" onMouseDown={onCancel}>
      <div ref={ref} tabIndex={-1} className="modal hw-modal" role="dialog" aria-modal="true"
           aria-labelledby={titleId} onMouseDown={e => e.stopPropagation()}>
        <div className="hw-head">
          <span className="hw-head-chip" aria-hidden="true"><PencilIcon width="18" height="18" /></span>
          <div className="hw-head-text">
            <h2 id={titleId} className="hw-title">Add handwriting</h2>
            <p className="hw-sub">Write or draw with your mouse, finger, or stylus — it becomes a layer you can restyle.</p>
          </div>
        </div>

        <div className="hw-canvas-wrap">
          <svg ref={surfaceRef} className="hw-surface"
               onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
            {committed.map((c, i) => c.dot
              ? <circle key={i} className="hw-dot" cx={c.dot.x} cy={c.dot.y} r={PEN / 2} />
              : <path key={i} className="hw-ink" strokeWidth={PEN} d={c.d} />)}
            {live && (live.length === 1
              ? <circle className="hw-dot" cx={live[0].x} cy={live[0].y} r={PEN / 2} />
              : <path className="hw-ink" strokeWidth={PEN} d={inkStrokePath(live)} />)}
          </svg>
          {isEmpty && (
            <div className="hw-hint" aria-hidden="true">
              <PencilIcon width="15" height="15" />
              <span>Write or draw here</span>
            </div>
          )}
        </div>

        <div className="hw-actions">
          <div className="hw-tools">
            <button type="button" className="hw-tool" disabled={!strokes.length}
                    onClick={() => setStrokes(s => s.slice(0, -1))}>
              <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor"
                   strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M6 4 3 7l3 3M3.2 7H10a3.2 3.2 0 0 1 0 6.4H6.5" />
              </svg>
              Undo
            </button>
            <button type="button" className="hw-tool" disabled={!strokes.length}
                    onClick={() => setStrokes([])}>Clear</button>
          </div>
          <div className="hw-btns">
            <button type="button" className="btn-lg" onClick={onCancel}>Cancel</button>
            <button type="button" className="btn-lg on" disabled={!strokes.length}
                    onClick={() => { if (strokes.length) onAdd(strokes, PEN); }}>Add to label</button>
          </div>
        </div>
      </div>
    </div>
  );
}
