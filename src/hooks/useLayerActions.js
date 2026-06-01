import { useCallback, useRef } from 'react';
import { layerAABB } from '../core/geometry.js';
import { moveStackLayers } from '../core/stack.js';
import { newLayer } from '../templates/index.js';
import { uid } from '../uid.js';
import { readImageFile } from '../components/SymbolPicker.jsx';

export function useLayerActions({ design, setDesign, selectedIds, setSelectedIds }) {
  // ----- helpers -----
  const setLayer = useCallback((id, patch) => {
    setDesign(d => ({
      ...d,
      layers: d.layers.map(l => l.id === id ? { ...l, ...patch } : l),
    }));
  }, []);
  // Apply one patch to many layers in a single history step (used by the
  // multi-select shared-property editor). Locked layers are skipped so a batch
  // recolour can't silently mutate something the user pinned.
  const setLayers = useCallback((ids, patch) => {
    const idset = new Set(ids);
    setDesign(d => ({
      ...d,
      layers: d.layers.map(l => (idset.has(l.id) && !l.locked) ? { ...l, ...patch } : l),
    }));
  }, [setDesign]);
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
  const addLayer = useCallback((type, at) => {
    const nl = newLayer(type, design.width, design.height);
    if (!nl) return;
    // Optional drop point (label coords) — centre the new layer there. Used by the
    // canvas right-click "Add …" items; the rail buttons omit it and add at centre.
    if (at) { nl.x = Math.round(at.x - nl.w / 2); nl.y = Math.round(at.y - nl.h / 2); }
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

  // Add a freehand signature as an ink layer. `strokes` is an array of strokes,
  // each a list of {x,y} points in the signature pad's pixel space. We tighten to
  // the strokes' bounding box, normalize the points 0..1 within it (like polygon),
  // size the layer to fit the canvas preserving aspect, and centre it. penWidth is
  // the pad's on-screen pen px, scaled by the same factor so the placed stroke
  // keeps the weight it had while drawing.
  const addInkLayer = useCallback((strokes, penWidth = 2.6) => {
    const all = (strokes || []).filter(s => s && s.length);
    const pts = all.flat();
    if (!pts.length) return;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of pts) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    const bw = Math.max(1, maxX - minX), bh = Math.max(1, maxY - minY);
    const norm = all.map(s => s.map(p => ({
      x: +((p.x - minX) / bw).toFixed(4),
      y: +((p.y - minY) / bh).toFixed(4),
    })));
    // Fit within ~55% of the canvas, preserving aspect; don't blow up a small doodle past 4×.
    const s = Math.min(design.width * 0.55 / bw, design.height * 0.55 / bh, 4);
    const w = Math.max(8, Math.round(bw * s));
    const h = Math.max(8, Math.round(bh * s));
    const nl = newLayer('ink', design.width, design.height);
    if (!nl) return;
    nl.strokes = norm;
    nl.w = w; nl.h = h;
    nl.x = Math.round(design.width / 2 - w / 2);
    nl.y = Math.round(design.height / 2 - h / 2);
    nl.strokeWidth = Math.min(14, Math.max(1.5, Math.round(penWidth * s * 2) / 2));
    setDesign(d => ({ ...d, layers: [...d.layers, nl] }));
    setSelectedIds([nl.id]);
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
        else if (kind === 'center') {   // both axes at once → one undo step
          patch.x = Math.round(b.x + (b.w - bb.w) / 2 + offX);
          patch.y = Math.round(b.y + (b.h - bb.h) / 2 + offY);
        }
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
        const a = l.align || 'start'; // renderer treats undefined as 'start'
        if (a === 'start') return { ...l, align: 'end' };
        if (a === 'end') return { ...l, align: 'start' };
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

  return {
    setLayer,
    setLayers,
    deleteLayer,
    moveLayer,
    addLayer,
    addImageFromFile,
    addInkLayer,
    alignLayer,
    distribute,
    flipSelected,
    duplicateLayer,
    deleteSelected,
    copySelected,
    pasteClipboard,
    pasteClipboardAt,
    selectAll,
    reorderSelected,
    moveLayersToTarget,
    clipboardRef,
  };
}
