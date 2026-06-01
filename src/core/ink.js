// Smooth SVG path 'd' through a freehand stroke. Draws a quadratic curve between
// the midpoints of successive segments, with each original sampled point as the
// control point — the standard way to turn raw pointer samples into natural
// handwriting instead of the angular ("blocky") line a plain polyline shows on a
// fast stroke. `pts` are absolute {x,y}; callers scale normalized points first.
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
