import { useCallback, useEffect, useRef, useState } from 'react';
import { clientToLabel, labelToClient } from '../core/coordinates.js';

export function useCanvasViewport({ design, selBounds }) {
  const [preview, setPreview] = useState(false);
  const [rulers, setRulers] = useState(null);
  const [wrapOffset, setWrapOffset] = useState({ x: 0, y: 0 });
  const wrapOffsetRef = useRef(wrapOffset);
  wrapOffsetRef.current = wrapOffset;
  const isPanningRef = useRef(false);
  const [autoFit, setAutoFit] = useState(1);
  const [zoomMode, setZoomMode] = useState('fit');
  const fit = zoomMode === 'fit' ? autoFit : zoomMode;
  const fitRef = useRef(fit);
  fitRef.current = fit;
  const selBoundsRef = useRef(selBounds);
  selBoundsRef.current = selBounds;

  const labelRef = useRef(null);
  const canvasRef = useRef(null);
  const wrapRef = useRef(null);
  const rulerTopRef = useRef(null);
  const rulerLeftRef = useRef(null);

  // ----- fit-to-viewport (only effective when zoomMode === 'fit') -----
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const compute = () => {
      const rect = el.getBoundingClientRect();
      // Responsive margin: keep the original 100px breathing room on roomy
      // stages, but on small (mobile) stages scale it down so the label isn't
      // dwarfed — a fixed 100px each side swallowed most of a phone's width.
      const minDim = Math.min(rect.width, rect.height);
      const margin = minDim < 500 ? Math.max(16, minDim * 0.1) : 100;
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
    const cur = fitRef.current;
    const next = ZOOM_STEPS.find(s => s > cur * 1.001) || ZOOM_STEPS[ZOOM_STEPS.length - 1];
    setZoomMode(next);
  }
  function zoomOut() {
    const cur = fitRef.current;
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
    const labelPoint = clientToLabel(clientX, clientY, wrapRect, fit);
    const oldZoom = fit;
    const newZoom = Math.max(0.05, Math.min(4, oldZoom * factor));
    if (newZoom === oldZoom) return;
    setZoomMode(newZoom);
    requestAnimationFrame(() => {
      const w = wrapRef.current;
      if (!w) return;
      const newRect = w.getBoundingClientRect();
      const newCursor = labelToClient(labelPoint.x, labelPoint.y, newRect, newZoom);
      const newCursorScreenX = newCursor.x;
      const newCursorScreenY = newCursor.y;
      stage.scrollLeft += newCursorScreenX - clientX;
      stage.scrollTop  += newCursorScreenY - clientY;
    });
  }

  // Frame the current selection: zoom so its bounds fill the viewport (with a
  // margin) and scroll it to the centre. No-op without a selection.
  function frameSelection() {
    const b = selBoundsRef.current;
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
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      document.removeEventListener('pointercancel', up);
      window.removeEventListener('blur', up);
      document.body.style.cursor = '';
      isPanningRef.current = false;
      // Commit the translate to state (so it survives the next render) and
      // refresh the rulers once now that the drag has settled.
      if (ox !== ox0 || oy !== oy0) setWrapOffset({ x: ox, y: oy });
      computeRulers();
    }
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
    document.addEventListener('pointercancel', up);
    window.addEventListener('blur', up);
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

  return {
    preview,
    setPreview,
    rulers,
    wrapOffset,
    setWrapOffset,
    fit,
    zoomMode,
    setZoomMode,
    setAutoFit,
    labelRef,
    canvasRef,
    wrapRef,
    rulerTopRef,
    rulerLeftRef,
    zoomIn,
    zoomOut,
    togglePreview,
    frameSelection,
    startPan,
    spaceHeldRef,
  };
}
