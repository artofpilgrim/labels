// ---- Freehand ink stroke geometry ----
//
// Points in a saved stroke are stored compactly as [x, y] pairs (no repeated
// object keys, to keep documents and exported data small). Older saved docs and
// the live capture buffer use { x, y }; inkX/inkY read either so nothing needs a
// migration.
export const inkX = (p) => (Array.isArray(p) ? p[0] : p.x);
export const inkY = (p) => (Array.isArray(p) ? p[1] : p.y);

// Smooth SVG path 'd' through a freehand stroke. Draws a quadratic curve between
// the midpoints of successive segments, with each original sampled point as the
// control point — the standard way to turn raw pointer samples into natural
// handwriting instead of the angular ("blocky") line a plain polyline shows on a
// fast stroke. `pts` are absolute { x, y }; callers scale normalized points first.
export function inkStrokePath(pts) {
  const n = pts.length;
  if (n < 2) return '';                                  // caller renders a dot
  if (n === 2) return `M${pts[0].x},${pts[0].y} L${pts[1].x},${pts[1].y}`;
  let d = `M${pts[0].x},${pts[0].y}`;
  for (let i = 1; i < n - 1; i++) {
    const xc = (pts[i].x + pts[i + 1].x) / 2;
    const yc = (pts[i].y + pts[i + 1].y) / 2;
    d += ` Q${pts[i].x},${pts[i].y} ${xc},${yc}`;
  }
  d += ` L${pts[n - 1].x},${pts[n - 1].y}`;
  return d;
}

// Perpendicular distance from p to the infinite line through a→b (all { x, y }).
function lineDist(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  return Math.abs((p.x - a.x) * dy - (p.y - a.y) * dx) / len;
}

// Ramer–Douglas–Peucker: drop points that sit within `eps` of the line between
// their kept neighbours, preserving the stroke's visual shape with far fewer
// points. Iterative (explicit stack) so a very long stroke can't blow the call
// stack. Returns a subset of the input points, order preserved.
export function rdpSimplify(pts, eps) {
  const n = pts.length;
  if (n <= 2) return pts.slice();
  const keep = new Uint8Array(n);
  keep[0] = keep[n - 1] = 1;
  const stack = [[0, n - 1]];
  while (stack.length) {
    const [lo, hi] = stack.pop();
    let maxD = 0, idx = -1;
    for (let i = lo + 1; i < hi; i++) {
      const d = lineDist(pts[i], pts[lo], pts[hi]);
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (maxD > eps && idx !== -1) {
      keep[idx] = 1;
      stack.push([lo, idx], [idx, hi]);
    }
  }
  const out = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(pts[i]);
  return out;
}
