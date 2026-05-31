import { useRef, useState } from 'react';
import { canMoveInStack, isStackBoundary, moveStackLayers } from '../core/stack.js';
import { SEVERITY } from '../core/constants.js';
import { layerAABB } from '../core/geometry.js';
import { renderLayer } from '../renderer/renderLayer.jsx';
import { BLEND_MODES } from './ui.jsx';
import { LayerBadges } from './editorChrome.jsx';

// Small stroke icons so the row chrome matches the app (not emoji).
const EyeIcon = ({ off }) => (
  <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
    {off
      ? <><path d="M2.5 8s2.2-3.6 5.5-3.6c1 0 1.9.2 2.6.6M13.5 8s-.7 1.2-2 2.2M6.4 6.6A2 2 0 0 0 8 10c.5 0 1-.2 1.4-.5" /><line x1="3" y1="3" x2="13" y2="13" /></>
      : <><path d="M1.5 8S4 4 8 4s6.5 4 6.5 4-2.5 4-6.5 4S1.5 8 1.5 8Z" /><circle cx="8" cy="8" r="1.8" /></>}
  </svg>
);
const LockIcon = ({ open }) => (
  <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3.5" y="7" width="9" height="6.2" rx="1.3" />
    {open ? <path d="M5.6 7V5.2a2.4 2.4 0 0 1 4.7-.6" /> : <path d="M5.6 7V5.2a2.4 2.4 0 0 1 4.8 0V7" />}
  </svg>
);

// Tiny rendered preview of a single layer, cropped to its (rotated) bounds.
function LayerThumb({ layer, sev, symbolsReady }) {
  const b = layerAABB(layer);
  const pad = Math.max(1, Math.max(b.w, b.h) * 0.08);
  const vb = `${b.x - pad} ${b.y - pad} ${Math.max(1, b.w + pad * 2)} ${Math.max(1, b.h + pad * 2)}`;
  // Render the content even for hidden layers (the row dims it via CSS), so the
  // thumbnail still tells you what the layer is.
  const node = renderLayer({ ...layer, hidden: false }, sev, symbolsReady);
  return (
    <span className="layer-thumb" aria-hidden="true">
      <svg viewBox={vb} preserveAspectRatio="xMidYMid meet" width="100%" height="100%">{node}</svg>
    </span>
  );
}

export function LayerStack({
  design,
  selectedIds,
  setSelectedIds,
  selectedLayer,
  symbolsReady,
  setLayer,
  moveLayer,
  deleteLayer,
  moveLayersToTarget,
  addLayer,
  duplicateLayer,
  deleteSelected,
  reorderSelected,
}) {
  const sev = SEVERITY[design.severity] || SEVERITY.danger;
  const dragLayerRef = useRef(null);
  const [dropTarget, setDropTarget] = useState(null);
  const [renaming, setRenaming] = useState(null); // id of the row being renamed
  const [opDraft, setOpDraft] = useState(null);   // local draft so the % field stays clearable
  const dropPlacementFromEvent = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    // The visible list is reversed: above a row means higher/front in stack.
    return e.clientY < r.top + r.height / 2 ? 'after' : 'before';
  };

  const active = selectedLayer;                       // single selection drives the header
  const canEdit = !!active && !active.locked;         // a locked layer is read-only here too
  const opacity = Math.round((active?.opacity ?? 1) * 100);
  const hasSel = selectedIds.length > 0;

  return (
    <div className="layers-panel">
      {/* Blend + opacity for the active layer — kept at the top, where the hand is.
          Disabled when the layer is locked, matching the read-only Properties view. */}
      <div className="layers-head">
        <select
          className="select-input blend-select" aria-label="Blend mode" disabled={!canEdit}
          value={active?.blend || 'normal'}
          onChange={e => canEdit && setLayer(active.id, { blend: e.target.value === 'normal' ? undefined : e.target.value })}
        >
          {BLEND_MODES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <div className="opacity-ctl" title="Layer opacity">
          <input
            type="range" min={0} max={100} step={1} aria-label="Layer opacity" disabled={!canEdit}
            value={active ? opacity : 100}
            onChange={e => { const n = Number(e.target.value); if (canEdit) setLayer(active.id, { opacity: n >= 100 ? null : n / 100 }); }}
          />
          <input
            className="opacity-num" type="number" min={0} max={100} aria-label="Layer opacity value"
            disabled={!canEdit} value={opDraft != null ? opDraft : (active ? opacity : '')}
            onChange={e => {
              const raw = e.target.value;
              setOpDraft(raw);                                 // keep the field clearable; don't snap empty back
              if (raw === '' || !canEdit) return;              // and don't read empty as 0%
              const n = Number(raw);
              if (!Number.isFinite(n)) return;
              setLayer(active.id, { opacity: n >= 100 ? null : Math.max(0, Math.min(100, n)) / 100 });
            }}
            onBlur={() => setOpDraft(null)}
          />
          <span className="opacity-pct" aria-hidden="true">%</span>
        </div>
      </div>

      <div className="layer-list" title="Top of list = front. Drag to reorder; double-click a name to rename.">
        {design.layers.slice().reverse().map((l) => {
          const selected = selectedIds.includes(l.id);
          const movable = canMoveInStack(l);
          const activeDrop = dropTarget && dropTarget.id === l.id;
          const dropClass = activeDrop ? ` drop-target ${dropTarget.placement === 'after' ? 'drop-above' : 'drop-below'}` : '';
          return (
            <div
              key={l.id}
              className={`layer-row ${selected ? 'on' : ''} ${l.hidden ? 'hidden' : ''} ${l.locked ? 'locked' : ''} ${isStackBoundary(l) ? 'stack-locked' : ''}${dropClass}`}
              draggable={movable && renaming !== l.id}
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
                const canDrop = moveStackLayers(design.layers, drag.ids, { kind: 'insert', targetId: l.id, placement }) !== design.layers;
                if (!canDrop) { if (dropTarget && dropTarget.id === l.id) setDropTarget(null); return; }
                e.preventDefault();
                if (!dropTarget || dropTarget.id !== l.id || dropTarget.placement !== placement) setDropTarget({ id: l.id, placement });
              }}
              onDragLeave={() => setDropTarget(t => (t && t.id === l.id ? null : t))}
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
                if (renaming === l.id) return;
                if (e.shiftKey) setSelectedIds(ids => ids.includes(l.id) ? ids.filter(i => i !== l.id) : [...ids, l.id]);
                else setSelectedIds([l.id]);
              }}
            >
              <button className="layer-eye" title={l.hidden ? 'Show' : 'Hide'}
                      onClick={e => { e.stopPropagation(); setLayer(l.id, { hidden: !l.hidden }); }}>
                <EyeIcon off={l.hidden} />
              </button>
              <LayerThumb layer={l} sev={sev} symbolsReady={symbolsReady} />
              {renaming === l.id ? (
                <input
                  className="layer-rename" autoFocus defaultValue={l.name || l.type}
                  onClick={e => e.stopPropagation()}
                  onBlur={e => { setLayer(l.id, { name: e.target.value.trim() || l.type }); setRenaming(null); }}
                  onKeyDown={e => {
                    e.stopPropagation();
                    if (e.key === 'Enter') e.currentTarget.blur();
                    else if (e.key === 'Escape') setRenaming(null);
                  }}
                />
              ) : (
                <span className="layer-name"
                      onDoubleClick={e => { e.stopPropagation(); if (!l.locked) setRenaming(l.id); }}>
                  {l.name || l.type}
                </span>
              )}
              <LayerBadges layer={l} />
              <button className="layer-lock" title={l.locked ? 'Unlock' : 'Lock'}
                      onClick={e => { e.stopPropagation(); setLayer(l.id, { locked: !l.locked }); }}>
                <LockIcon open={!l.locked} />
              </button>
            </div>
          );
        })}
      </div>

      {/* Footer toolbar — acts on the current selection. */}
      <div className="layers-foot">
        <button className="icon-btn" title="Add rectangle" onClick={() => addLayer('rect')}>＋</button>
        <button className="icon-btn" title="Duplicate" disabled={!hasSel} onClick={() => { if (hasSel) duplicateLayer(); }}>⧉</button>
        <span className="lf-sep" />
        <button className="icon-btn" title="Bring forward" disabled={!hasSel} onClick={() => { if (hasSel) reorderSelected('forward'); }}>▲</button>
        <button className="icon-btn" title="Send back" disabled={!hasSel} onClick={() => { if (hasSel) reorderSelected('backward'); }}>▼</button>
        <span className="lf-spacer" />
        <button className="icon-btn danger" title="Delete" disabled={!hasSel} onClick={() => { if (hasSel) deleteSelected(); }}>🗑</button>
      </div>
    </div>
  );
}
