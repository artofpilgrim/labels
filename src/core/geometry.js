export function applyPins(l, oldW, oldH, newW, newH) {
  const pin = l.pinSides;
  if (!pin) return l;
  let { x, y, w, h } = l;

  const right = pin.right;
  const left = pin.left;
  if (left && right) {
    const rightOffset = oldW - (x + w);
    w = Math.max(1, newW - x - rightOffset);
  } else if (pin.centerX) {
    const offset = (x + w / 2) - oldW / 2;
    x = newW / 2 + offset - w / 2;
  } else if (right && !left) {
    const rightOffset = oldW - (x + w);
    x = newW - w - rightOffset;
  }

  const top = pin.top;
  const bottom = pin.bottom;
  if (top && bottom) {
    const bottomOffset = oldH - (y + h);
    h = Math.max(1, newH - y - bottomOffset);
  } else if (pin.centerY) {
    const offset = (y + h / 2) - oldH / 2;
    y = newH / 2 + offset - h / 2;
  } else if (bottom && !top) {
    const bottomOffset = oldH - (y + h);
    y = newH - h - bottomOffset;
  }

  return { ...l, x, y, w, h };
}

export function snapTargets(design, excludeId) {
  const out = [];
  for (const l of design.layers) {
    if (l.id === excludeId || l.hidden) continue;
    out.push({ x: l.x, y: l.y, w: l.w, h: l.h });
  }
  out.push({ x: 0, y: 0, w: design.width, h: design.height });
  return out;
}

export function snapMove(box, targets, threshold) {
  const bxs = [box.x, box.x + box.w / 2, box.x + box.w];
  const bys = [box.y, box.y + box.h / 2, box.y + box.h];

  let bestX = null;
  let bestY = null;
  for (const t of targets) {
    const txs = [t.x, t.x + t.w / 2, t.x + t.w];
    const tys = [t.y, t.y + t.h / 2, t.y + t.h];
    for (const bx of bxs) for (const tx of txs) {
      const d = tx - bx;
      if (Math.abs(d) <= threshold && (!bestX || Math.abs(d) < Math.abs(bestX.d))) {
        bestX = { d, value: tx };
      }
    }
    for (const by of bys) for (const ty of tys) {
      const d = ty - by;
      if (Math.abs(d) <= threshold && (!bestY || Math.abs(d) < Math.abs(bestY.d))) {
        bestY = { d, value: ty };
      }
    }
  }

  const out = { x: box.x, y: box.y, guides: [] };
  if (bestX) {
    out.x = box.x + bestX.d;
    out.guides.push({ orient: 'v', value: bestX.value });
  }
  if (bestY) {
    out.y = box.y + bestY.d;
    out.guides.push({ orient: 'h', value: bestY.value });
  }
  return out;
}

export function snapResize(box, mode, targets, threshold) {
  const right = box.x + box.w;
  const bottom = box.y + box.h;
  const movingLeft = mode.includes('w');
  const movingRight = mode.includes('e');
  const movingTop = mode.includes('n');
  const movingBottom = mode.includes('s');

  let bestX = null;
  let bestY = null;
  for (const t of targets) {
    const txs = [t.x, t.x + t.w / 2, t.x + t.w];
    const tys = [t.y, t.y + t.h / 2, t.y + t.h];

    if (movingRight) for (const tx of txs) {
      const d = tx - right;
      if (Math.abs(d) <= threshold && (!bestX || Math.abs(d) < Math.abs(bestX.d))) {
        bestX = { d, value: tx, edge: 'right' };
      }
    }
    if (movingLeft) for (const tx of txs) {
      const d = tx - box.x;
      if (Math.abs(d) <= threshold && (!bestX || Math.abs(d) < Math.abs(bestX.d))) {
        bestX = { d, value: tx, edge: 'left' };
      }
    }
    if (movingBottom) for (const ty of tys) {
      const d = ty - bottom;
      if (Math.abs(d) <= threshold && (!bestY || Math.abs(d) < Math.abs(bestY.d))) {
        bestY = { d, value: ty, edge: 'bottom' };
      }
    }
    if (movingTop) for (const ty of tys) {
      const d = ty - box.y;
      if (Math.abs(d) <= threshold && (!bestY || Math.abs(d) < Math.abs(bestY.d))) {
        bestY = { d, value: ty, edge: 'top' };
      }
    }
  }

  const out = { x: box.x, y: box.y, w: box.w, h: box.h, guides: [] };
  if (bestX) {
    if (bestX.edge === 'right') out.w = Math.max(4, box.w + bestX.d);
    else {
      out.x = box.x + bestX.d;
      out.w = Math.max(4, box.w - bestX.d);
    }
    out.guides.push({ orient: 'v', value: bestX.value });
  }
  if (bestY) {
    if (bestY.edge === 'bottom') out.h = Math.max(4, box.h + bestY.d);
    else {
      out.y = box.y + bestY.d;
      out.h = Math.max(4, box.h - bestY.d);
    }
    out.guides.push({ orient: 'h', value: bestY.value });
  }
  return out;
}

export function resizeRect(start, mode, dx, dy, mods, minSize = 4) {
  const { shift, alt } = mods || {};
  const { x, y, w, h } = start;
  let nx = x;
  let ny = y;
  let nw = w;
  let nh = h;
  const has = (c) => mode.includes(c);

  if (alt) {
    if (has('e')) { nw = Math.max(minSize, w + 2 * dx); nx = x - (nw - w) / 2; }
    if (has('w')) { nw = Math.max(minSize, w - 2 * dx); nx = x - (nw - w) / 2; }
    if (has('s')) { nh = Math.max(minSize, h + 2 * dy); ny = y - (nh - h) / 2; }
    if (has('n')) { nh = Math.max(minSize, h - 2 * dy); ny = y - (nh - h) / 2; }
  } else {
    if (has('e')) nw = Math.max(minSize, w + dx);
    if (has('w')) { nw = Math.max(minSize, w - dx); nx = x + (w - nw); }
    if (has('s')) nh = Math.max(minSize, h + dy);
    if (has('n')) { nh = Math.max(minSize, h - dy); ny = y + (h - nh); }
  }

  if (shift && w > 0 && h > 0) {
    const ratio = w / h;
    const dw = nw - w;
    const dh = nh - h;
    const hDriven = Math.abs(dw) > Math.abs(dh) || mode === 'e' || mode === 'w';
    if (hDriven) {
      const newH = nw / ratio;
      if (alt) ny = y - (newH - h) / 2;
      else if (has('n')) ny = y + (h - newH);
      nh = newH;
    } else {
      const newW = nh * ratio;
      if (alt) nx = x - (newW - w) / 2;
      else if (has('w')) nx = x + (w - newW);
      nw = newW;
    }
  }
  return { x: nx, y: ny, w: nw, h: nh };
}

export function reanchorRotated(before, after, mode, cos, sin, alt) {
  const ax = alt ? 0.5 : mode.includes('w') ? 1 : mode.includes('e') ? 0 : 0.5;
  const ay = alt ? 0.5 : mode.includes('n') ? 1 : mode.includes('s') ? 0 : 0.5;
  const anchorWorld = (b) => {
    const cx = b.x + b.w / 2;
    const cy = b.y + b.h / 2;
    const lx = b.x + ax * b.w - cx;
    const ly = b.y + ay * b.h - cy;
    return { x: cx + lx * cos - ly * sin, y: cy + lx * sin + ly * cos };
  };
  const w0 = anchorWorld(before);
  const w1 = anchorWorld(after);
  return { ...after, x: after.x + (w0.x - w1.x), y: after.y + (w0.y - w1.y) };
}

export function layerAABB(l) {
  const deg = l.rotation || 0;
  if (!deg) return { x: l.x, y: l.y, w: l.w, h: l.h };
  const rot = deg * Math.PI / 180;
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);
  const cx = l.x + l.w / 2;
  const cy = l.y + l.h / 2;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [px, py] of [[l.x, l.y], [l.x + l.w, l.y], [l.x + l.w, l.y + l.h], [l.x, l.y + l.h]]) {
    const dx = px - cx;
    const dy = py - cy;
    const rx = cx + dx * cos - dy * sin;
    const ry = cy + dx * sin + dy * cos;
    if (rx < minX) minX = rx;
    if (rx > maxX) maxX = rx;
    if (ry < minY) minY = ry;
    if (ry > maxY) maxY = ry;
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

export function niceStep(raw) {
  if (!isFinite(raw) || raw <= 0) return 100;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / pow;
  const m = n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10;
  return m * pow;
}

export function quantize(v, step) {
  return Math.round(v / Math.max(1, step)) * step;
}

export function smartSpacing(box, others, threshold) {
  let { x, y } = box;
  const guides = [];
  {
    const band = others.filter(o => o.y < y + box.h && o.y + o.h > y);
    let L = null;
    let R = null;
    for (const o of band) {
      if (o.x + o.w <= x) {
        if (!L || o.x + o.w > L.x + L.w) L = o;
      } else if (o.x >= x + box.w) {
        if (!R || o.x < R.x) R = o;
      }
    }
    if (L && R) {
      const gapL = x - (L.x + L.w);
      const gapR = R.x - (x + box.w);
      if (Math.abs(gapL - gapR) <= threshold * 2) {
        x = (L.x + L.w) + ((R.x - (L.x + L.w)) - box.w) / 2;
        const yBar = y + box.h / 2;
        guides.push({ kind: 'gap', orient: 'h', y: yBar, x1: L.x + L.w, x2: x });
        guides.push({ kind: 'gap', orient: 'h', y: yBar, x1: x + box.w, x2: R.x });
      }
    }
  }
  {
    const band = others.filter(o => o.x < x + box.w && o.x + o.w > x);
    let T = null;
    let B = null;
    for (const o of band) {
      if (o.y + o.h <= y) {
        if (!T || o.y + o.h > T.y + T.h) T = o;
      } else if (o.y >= y + box.h) {
        if (!B || o.y < B.y) B = o;
      }
    }
    if (T && B) {
      const gapT = y - (T.y + T.h);
      const gapB = B.y - (y + box.h);
      if (Math.abs(gapT - gapB) <= threshold * 2) {
        y = (T.y + T.h) + ((B.y - (T.y + T.h)) - box.h) / 2;
        const xBar = x + box.w / 2;
        guides.push({ kind: 'gap', orient: 'v', x: xBar, y1: T.y + T.h, y2: y });
        guides.push({ kind: 'gap', orient: 'v', x: xBar, y1: y + box.h, y2: B.y });
      }
    }
  }
  return { x, y, guides };
}
