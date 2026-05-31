import { useRef, useState } from 'react';
import { canMoveInStack, isStackBoundary, moveStackLayers } from '../core/stack.js';
import { Field } from './ui.jsx';
import { LayerBadges, LayerGlyph } from './editorChrome.jsx';

export function LayerStack({
  design,
  selectedIds,
  setSelectedIds,
  setLayer,
  moveLayer,
  deleteLayer,
  moveLayersToTarget,
}) {
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

  return layerStackField;
}