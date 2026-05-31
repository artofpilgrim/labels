import { useMemo, useState } from 'react';
import { layerAABB } from '../core/geometry.js';

export function useSelection(layers) {
  const [selectedIds, setSelectedIds] = useState([]);
  const [marquee, setMarquee] = useState(null);
  const selectedId = selectedIds.length === 1 ? selectedIds[0] : null;

  const selectedLayer = useMemo(
    () => (selectedId ? layers.find(l => l.id === selectedId) : null),
    [layers, selectedId]);

  const selectedLayers = useMemo(
    () => (selectedIds.length ? layers.filter(l => selectedIds.includes(l.id)) : []),
    [layers, selectedIds]);

  const selBoxes = useMemo(() => selectedLayers.map(layerAABB), [selectedLayers]);
  const selBounds = useMemo(() => (selBoxes.length ? {
    x: Math.min(...selBoxes.map(b => b.x)),
    y: Math.min(...selBoxes.map(b => b.y)),
    w: Math.max(...selBoxes.map(b => b.x + b.w)) - Math.min(...selBoxes.map(b => b.x)),
    h: Math.max(...selBoxes.map(b => b.y + b.h)) - Math.min(...selBoxes.map(b => b.y)),
  } : null), [selBoxes]);

  const editableSel = useMemo(() => selectedLayers.filter(l => !l.locked), [selectedLayers]);

  return {
    selectedIds,
    setSelectedIds,
    marquee,
    setMarquee,
    selectedId,
    selectedLayer,
    selectedLayers,
    selBoxes,
    selBounds,
    editableSel,
  };
}
