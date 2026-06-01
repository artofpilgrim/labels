// Layer-based label renderer.
import { forwardRef, useId, useImperativeHandle, useRef, memo } from 'react';
import { SEVERITY } from '../core/constants.js';
import { polygonPoints, rectPath, rectStrokeRingPath, renderLayer, resolveFill, rotateTransform } from './renderLayer.jsx';

// ----------- Label component -----------
// Renders all layers and attaches per-layer mousedown handlers so the parent
// can drive selection + drag.

// Black geometry for a hole layer, painted into the knockout <mask> (white shows,
// black cuts). Only the area shapes punch — rect (honors radius/chamfer), ellipse
// and polygon. Rotation is matched to the on-canvas render.
function holeMaskNode(l) {
  const t = rotateTransform(l);
  if (l.type === 'rect') return <path key={l.id} d={rectPath(l.x, l.y, l.w, l.h, l.radius, 0, l.corner)} fill="black" transform={t} />;
  if (l.type === 'ellipse') return <ellipse key={l.id} cx={l.x + l.w / 2} cy={l.y + l.h / 2} rx={l.w / 2} ry={l.h / 2} fill="black" transform={t} />;
  if (l.type === 'polygon') {
    const pts = polygonPoints(l);
    return <polygon key={l.id} points={pts} fill="black" transform={t} />;
  }
  return null;
}

const Label = memo(forwardRef(function Label({ design, symbolsReady, onLayerPointerDown, onCanvasPointerDown, onLayerContextMenu, onLayerDoubleClick, editingId }, ref) {
  const svgRef = useRef(null);
  useImperativeHandle(ref, () => ({ getSvg: () => svgRef.current }));
  // Per-instance suffix so clip/mask element ids are unique — otherwise a second
  // <Label> on the page (e.g. a document thumbnail) collides with the canvas's
  // ids and url(#…) references resolve to the wrong shape. Colons from useId are
  // stripped so they're safe inside url(#…).
  const rid = useId().replace(/:/g, '');

  const sev = SEVERITY[design.severity] || SEVERITY.danger;

  // Build a clipPath from the canvas-fill background's shape. Any layer with
  // `clipToCanvas: true` is rendered through this clip, so it automatically
  // inherits the bg's rounded corners and stays inside the canvas outline.
  const bg = design.layers.find(l => l.syncCanvas === 'fill');
  const canvasClipId = `canvas-clip-${rid}`;
  // Inset the clip by the frame's stroke so clipToCanvas layers (bands) tuck
  // UNDER the strokeOnTop frame instead of reaching its antialiased outer edge —
  // otherwise a band's colour bleeds through that edge as a hairline (visible on
  // a coloured band under a dark frame; hidden when band ≈ frame colour). Passing
  // the stroke width to rectPath insets by sw/2 and shrinks the radius to match.
  const clipSW = (bg && bg.strokeOnTop && (bg.strokeWidth || 0) > 0 && bg.stroke && bg.stroke !== 'none')
    ? bg.strokeWidth : 0;
  // When the frame is inset, tuck clipToCanvas bands under its INNER edge so they
  // never spill into the blank margin outside the frame. rectPath insets by
  // (param / 2), so 2·inset + strokeWidth lands the clip at the frame's inner
  // edge (inset + sw/2 in from the canvas edge) and shrinks the radius to match.
  const bgInset = clipSW > 0 ? Math.max(0, bg.strokeInset || 0) : 0;
  const canvasClipD = bg
    ? rectPath(0, 0, design.width, design.height, bg.radius, 2 * bgInset + clipSW, bg.corner)
    : null;

  // Layers flagged `hole` knock a transparent cutout through the whole label via
  // a luminance mask. The white field is oversized so off-canvas content still
  // shows; the black hole shapes are the only thing removed.
  const holes = design.layers.filter(l => l.hole && !l.hidden);
  const holeMaskId = `hole-mask-${rid}`;
  const W = design.width, H = design.height;

  return (
    <svg
      ref={svgRef}
      xmlns="http://www.w3.org/2000/svg"
      xmlnsXlink="http://www.w3.org/1999/xlink"
      viewBox={`0 0 ${design.width} ${design.height}`}
      width={design.width}
      height={design.height}
      // isolate so layer mix-blend-modes blend only within the label, not with
      // the editor backdrop or the page behind it.
      style={{ display: 'block', isolation: 'isolate' }}
      onMouseDown={(e) => {
        // Background click → deselect (only if user clicked the SVG itself, not a layer)
        if (e.target === e.currentTarget && onCanvasPointerDown) onCanvasPointerDown(e);
      }}
    >
      {canvasClipD && (
        <defs>
          <clipPath id={canvasClipId}>
            <path d={canvasClipD} />
          </clipPath>
        </defs>
      )}
      {holes.length > 0 && (
        <defs>
          <mask id={holeMaskId} maskUnits="userSpaceOnUse" x={-W} y={-H} width={W * 3} height={H * 3}>
            <rect x={-W} y={-H} width={W * 3} height={H * 3} fill="white" />
            {holes.map(holeMaskNode)}
          </mask>
        </defs>
      )}
      <g mask={holes.length > 0 ? `url(#${holeMaskId})` : undefined}>
      {design.layers.map(l => {
        if (editingId && l.id === editingId) return null; // hidden while inline-editing
        const node = renderLayer(l, sev, symbolsReady);
        if (!node) return null;
        const interactive = !l.locked && !l.hidden;
        const clip = (l.clipToCanvas && canvasClipD) ? `url(#${canvasClipId})` : undefined;
        return (
          <g
            key={l.id}
            style={{
              cursor: interactive ? 'move' : 'default',
              pointerEvents: l.hidden ? 'none' : 'auto',
              mixBlendMode: l.blend || undefined,
              opacity: l.opacity == null ? undefined : l.opacity,
            }}
            clipPath={clip}
            onMouseDown={(e) => onLayerPointerDown && onLayerPointerDown(l.id, e)}
            onContextMenu={(e) => onLayerContextMenu && onLayerContextMenu(l.id, e)}
            onDoubleClick={(e) => onLayerDoubleClick && onLayerDoubleClick(l.id, e)}
          >
            {/* Invisible hit rect so the whole layer box is clickable
                (text/line glyphs don't fill their box on their own). For
                very thin layers (h=1 lines, h<8 dividers) we expand the
                hit area to ~8px and re-center it so the user can actually
                grab them on the canvas. */}
            {(() => {
              const HIT_MIN = 8;
              const hw = Math.max(l.w, HIT_MIN);
              const hh = Math.max(l.h, HIT_MIN);
              const hx = l.x - (hw - l.w) / 2;
              const hy = l.y - (hh - l.h) / 2;
              return (
                <rect
                  x={hx} y={hy} width={hw} height={hh}
                  fill="transparent"
                  transform={rotateTransform(l)}
                />
              );
            })()}
            {node}
          </g>
        );
      })}

      {/* Second pass: rects flagged strokeOnTop redraw their stroke here so
          the frame stays visible above all other content. Non-interactive.
          Falls back to 'none' when stroke is missing (matches the first pass)
          so an empty stroke field never produces a phantom black border. */}
      {design.layers
        .filter(l => l.type === 'rect' && l.strokeOnTop && !l.hidden && (l.strokeWidth || 0) > 0)
        // The canvas-fill background's frame is the label's outer edge — keep it
        // the topmost stroke so a later rect's "on top" border can't paint over
        // it. filter() returned a fresh array, so this sort is non-mutating; it's
        // stable, so any other on-top rects keep their stack order beneath it.
        .sort((a, b) => (a.syncCanvas === 'fill' ? 1 : 0) - (b.syncCanvas === 'fill' ? 1 : 0))
        .map(l => (
          <path
            key={`top-${l.id}`}
            d={rectStrokeRingPath(l, l.strokeWidth, l.strokeInset)}
            fill={resolveFill(l.stroke || 'none', l.bindSeverity, sev)}
            fillRule="evenodd"
            clipPath={(l.clipToCanvas && canvasClipD) ? `url(#${canvasClipId})` : undefined}
            style={{ pointerEvents: 'none', mixBlendMode: l.blend || undefined, opacity: l.opacity == null ? undefined : l.opacity }}
            transform={rotateTransform(l)}
          />
        ))}
      </g>
    </svg>
  );
}));

export { Label };
