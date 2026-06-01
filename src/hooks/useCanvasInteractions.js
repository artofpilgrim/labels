import { useCallback, useEffect, useRef } from 'react';
import { SEVERITY } from '../core/constants.js';
import { clientToLabel, labelToClient, screenThreshold } from '../core/coordinates.js';
import { applyPins, layerAABB, quantize, reanchorRotated, resizeRect, smartSpacing, snapMove, snapResize, snapTargets } from '../core/geometry.js';
import { FORMATS, PRESETS, newLayer } from '../templates/index.js';
export function useCanvasInteractions({
  design,
  setDesign,
  setLayer,
  forceCommit,
  inDragRef,
  selectedIds,
  setSelectedIds,
  selectedId,
  selBounds,
  setMarquee,
  grid,
  fit,
  wrapRef,
  canvasRef,
  wrapOffset,
  setWrapOffset,
  setAutoFit,
  zoomMode,
  setCtxMenu,
  spaceHeldRef,
  startPan,
  setActivePresetId,
  flash,
  setSnapGuides,
  setHud,
  editingTextId,
  setEditingTextId,
  editingDraft,
  setEditingDraft,
  editClosedRef
}) {
  // Drag-move every layer in `ids` together (no per-edge snap for groups).
  function startGroupDrag(e, ids, clickedId) {
    const snaps = new Map();
    for (const id of ids) {
      const l = design.layers.find(x => x.id === id);
      if (l && !l.locked) snaps.set(id, { x: l.x, y: l.y });
    }
    const g = selBounds;
    beginDrag(e, (dx, dy, mods) => {
      let lockX = false, lockY = false;
      if (mods.shift) { if (Math.abs(dx) >= Math.abs(dy)) { dy = 0; lockY = true; } else { dx = 0; lockX = true; } }
      // Snap the group's top-left to the grid (absolute reference), matching the
      // single-layer behaviour in startLayerDrag — not the raw delta, which would
      // shift the box by a grid-multiple from an arbitrary origin.
      if (grid.snap && !mods.ctrl && g) { dx = quantize(g.x + dx, grid.step) - g.x; dy = quantize(g.y + dy, grid.step) - g.y; }
      // Re-assert the axis lock — grid snapping must not move the frozen axis.
      if (lockY) dy = 0;
      if (lockX) dx = 0;
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
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
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
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
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
      const p = clientToLabel(e.clientX, e.clientY, r, fit);
      labelX = p.x;
      labelY = p.y;
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
    // Left-press on the empty stage padding: the mouse rubber-bands a selection;
    // a touch/pen drag pans the view instead (a no-move tap deselects).
    if (e.button === 0 && e.target === e.currentTarget) {
      if (e.pointerType === 'mouse') startMarquee(e);
      else startPan(e, () => setSelectedIds([]));
    }
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
    flash('Template applied — press Ctrl+Z to undo', 3000);
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
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
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
      // Commit the post-drag state as a single history step. setTimeout(0) lets
      // the final mousemove's state update flush first. up() is bound to mouseup
      // /pointercancel/blur independently of move(), so a throwing move() can't
      // strand this commit (and move() only does guarded arithmetic anyway).
      setTimeout(forceCommit, 0);
    }
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
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
      const threshold = screenThreshold(8, fit); // ~8 screen pixels regardless of zoom
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
      // A keep-aspect image is rendered "meet" (fit inside its box), so a free
      // resize would just letterbox it inside the box instead of scaling the
      // picture — the handles would appear to do nothing. Lock such images to
      // their box aspect so every handle visibly scales them, like a rect/ink
      // layer fills its box. "Stretch" images (preserveAspect === false) fill via
      // 'none' and keep resizing freely.
      const lockAspect = layer.type === 'image' && layer.preserveAspect !== false;
      const m = lockAspect ? { ...mods, shift: true } : mods;
      const r = resizeRect(snap, mode, dxL, dyL, m);
      let next = r, guides = [];
      // Snap only when Ctrl is held alone — shift/alt have geometric goals
      // (aspect lock, mirror) that conflict with snapping a single edge. Snap
      // math is axis-aligned, so skip it for rotated layers.
      if (m.ctrl && !m.shift && !m.alt && !rot) {
        const s = snapResize(r, mode, snapTargets(design, layer.id), screenThreshold(8, fit));
        next = s; guides = s.guides;
      }
      if (rot) next = reanchorRotated(snap, next, mode, cos, sin, m.alt);
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
    const center = labelToClient(layer.x + layer.w / 2, layer.y + layer.h / 2, r, fit);
    const cx = center.x;
    const cy = center.y;
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
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      document.removeEventListener('pointercancel', up);
      window.removeEventListener('blur', up);
      setHud(null);
      inDragRef.current = false;
      setTimeout(forceCommit, 0);
    }
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
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
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      document.removeEventListener('pointercancel', up);
      window.removeEventListener('blur', up);
      setHud(null);
      inDragRef.current = false;
      setTimeout(forceCommit, 0);
    }
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
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
    const center = labelToClient(gcx, gcy, r, fit);
    const scx = center.x, scy = center.y;
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
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      document.removeEventListener('pointercancel', up);
      window.removeEventListener('blur', up);
      setHud(null);
      inDragRef.current = false;
      setTimeout(forceCommit, 0);
    }
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
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
    const point = clientToLabel(e.clientX, e.clientY, rect, fit);
    const { x, y } = point;
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
    // Locked layers (incl. the full-bleed background) aren't selectable here. The
    // mouse rubber-bands over the artwork; touch/pen pans the view — drag the
    // background to move around (a no-move tap deselects).
    if (layer.locked) {
      if (e.pointerType === 'mouse') startMarquee(e);
      else startPan(e, () => setSelectedIds([]));
      return;
    }
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
    // Only a left-press acts here (middle falls through to the stage pan; right is
    // the context menu). Mouse rubber-bands; touch/pen pans the view (tap deselects).
    if (e.button !== 0) return;
    if (e.pointerType === 'mouse') startMarquee(e);
    else startPan(e, () => setSelectedIds([]));
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
    editClosedRef.current = false;
    setSelectedIds([layerId]);
    setEditingDraft(layer.text || '');
    setEditingTextId(layerId);
  };
  const onLayerDoubleClick = useCallback((layerId, e) => labelHandlers.current.onLayerDoubleClick(layerId, e), []);
  // commit/cancel each fire twice: once from the key/blur handler, then again
  // from the native blur React fires when setEditingTextId(null) unmounts the
  // textarea. editClosedRef makes the second call a no-op, so Enter doesn't write
  // twice and Esc discards cleanly.
  const commitTextEdit = () => {
    if (editClosedRef.current) return;
    editClosedRef.current = true;
    if (editingTextId) setLayer(editingTextId, { text: editingDraft });
    setEditingTextId(null);
    setTimeout(forceCommit, 0);
  };
  const cancelTextEdit = () => {
    if (editClosedRef.current) return;
    editClosedRef.current = true;
    setEditingTextId(null);
  };
  // Drop the inline editor if its layer disappears (undo / delete).
  useEffect(() => {
    if (editingTextId && !design.layers.some(l => l.id === editingTextId)) setEditingTextId(null);
  }, [design.layers, editingTextId]);
  return {
    setSeverity,
    applyPreset,
    changeCanvasShape,
    startCanvasResize,
    startLayerResize,
    startRotate,
    startGroupResize,
    startGroupRotate,
    onLayerPointerDown,
    onCanvasPointerDown,
    onLayerContextMenu,
    onLayerDoubleClick,
    onStagePointerDown,
    onStageContextMenu,
    commitTextEdit,
    cancelTextEdit,
  };
}
