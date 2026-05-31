export function isStackBoundary(l) {
  return !!(l && (l.stackLocked || l.syncCanvas === 'fill'));
}

export function canMoveInStack(l) {
  return !!(l && !l.locked && !isStackBoundary(l));
}

export function uniqueIds(ids) {
  const seen = new Set();
  return (ids || []).filter(id => {
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

export function stackSegments(layers) {
  const segments = [];
  let start = 0;
  for (let i = 0; i < layers.length; i++) {
    if (!canMoveInStack(layers[i])) {
      if (start < i) segments.push({ start, end: i });
      start = i + 1;
    }
  }
  if (start < layers.length) segments.push({ start, end: layers.length });
  return segments;
}

export function segmentForIndex(layers, index) {
  return stackSegments(layers).find(s => s.start <= index && index < s.end) || null;
}

export function segmentForSlot(layers, slot) {
  return stackSegments(layers).find(s => s.start <= slot && slot <= s.end) || null;
}

export function sameSegment(a, b) {
  return !!(a && b && a.start === b.start && a.end === b.end);
}

export function sameStackOrder(a, b) {
  return a.length === b.length && a.every((layer, i) => layer.id === b[i].id);
}

export function stepStackLayers(layers, ids, dir) {
  const movable = uniqueIds(ids).filter(id => {
    const l = layers.find(x => x.id === id);
    return canMoveInStack(l);
  });
  if (!movable.length) return layers;

  const blockers = new Set(movable);
  const next = layers.slice();
  const idxOf = id => next.findIndex(l => l.id === id);
  const ordered = movable.slice().sort((a, b) => idxOf(a) - idxOf(b));
  const sequence = dir === 'up' ? ordered.reverse() : ordered;
  let moved = false;

  for (const id of sequence) {
    const i = idxOf(id);
    const j = dir === 'up' ? i + 1 : i - 1;
    if (j < 0 || j >= next.length) continue;
    if (isStackBoundary(next[j]) || next[j].locked || blockers.has(next[j].id)) continue;
    [next[i], next[j]] = [next[j], next[i]];
    moved = true;
  }

  return moved ? next : layers;
}

export function insertStackLayers(layers, ids, targetId, placement) {
  const targetIndex = layers.findIndex(l => l.id === targetId);
  if (targetIndex < 0) return layers;

  const targetSlot = placement === 'after' ? targetIndex + 1 : targetIndex;
  const targetSegment = segmentForSlot(layers, targetSlot);
  if (!targetSegment) return layers;

  const movableIds = uniqueIds(ids).filter(id => {
    const index = layers.findIndex(l => l.id === id);
    if (index < 0 || !canMoveInStack(layers[index])) return false;
    return sameSegment(segmentForIndex(layers, index), targetSegment);
  });
  if (!movableIds.length || movableIds.includes(targetId)) return layers;

  const moveSet = new Set(movableIds);
  const moving = layers.filter(l => moveSet.has(l.id));
  const rest = layers.filter(l => !moveSet.has(l.id));
  const restTargetIndex = rest.findIndex(l => l.id === targetId);
  if (restTargetIndex < 0) return layers;

  let insertAt = placement === 'after' ? restTargetIndex + 1 : restTargetIndex;
  const restSegment = segmentForSlot(rest, insertAt);
  if (!restSegment) return layers;
  insertAt = Math.max(restSegment.start, Math.min(restSegment.end, insertAt));

  const next = rest.slice();
  next.splice(insertAt, 0, ...moving);
  return sameStackOrder(layers, next) ? layers : next;
}

export function moveStackLayers(layers, ids, action) {
  if (!action || !ids || !ids.length) return layers;
  if (action.kind === 'insert') {
    return insertStackLayers(layers, ids, action.targetId, action.placement);
  }
  if (action.kind === 'step') {
    return stepStackLayers(layers, ids, action.dir);
  }
  if (action.kind === 'edge') {
    const dir = action.to === 'front' ? 'up' : 'down';
    let next = layers;
    for (let guard = 0; guard < layers.length * layers.length; guard++) {
      const moved = stepStackLayers(next, ids, dir);
      if (moved === next) break;
      next = moved;
    }
    return next;
  }
  return layers;
}
