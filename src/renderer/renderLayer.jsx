import { FONTS } from '../core/constants.js';
import { buildLinearBarcode, qrModules } from '../barcode.js';
import { pictoHref } from '../symbols.js';

// Normalize a bullets item — accept either a legacy string (saved presets,
// localStorage from older versions) or the {id, text} shape used now.
function bulletText(item) {
  if (item == null) return '';
  return typeof item === 'string' ? item : (item.text || '');
}

// Greedy word-wrap; charW is the average glyph width as a fraction of font size.
// Sans-serif Helvetica is ~0.55 for mixed case, ~0.62 for all-caps.
function wrapLines(text, maxWidth, fontSize, charW = 0.55) {
  if (!text) return [];
  const maxChars = Math.max(2, Math.floor(maxWidth / (fontSize * charW)));
  const out = [];
  for (const para of String(text).split('\n')) {
    const words = para.split(/\s+/).filter(Boolean);
    if (!words.length) { out.push(''); continue; }
    let line = '';
    for (const w of words) {
      const trial = line ? line + ' ' + w : w;
      if (trial.length > maxChars && line) { out.push(line); line = w; }
      else line = trial;
    }
    if (line) out.push(line);
  }
  return out;
}

// Resolve a possibly severity-bound color on a layer.
function resolveFill(value, bind, sev) {
  if (bind === 'band') return sev.band;
  if (bind === 'bandInk') return sev.bandInk;
  return value;
}

// Rounded-rectangle path with per-corner radii. When `strokeWidth` is passed,
// the path is inset by sw/2 so a stroke drawn on it stays fully inside the
// layer's w/h (box-sizing: border-box). The path radius is shrunk by sw/2
// too so the stroke's VISIBLE OUTER edge — which sits sw/2 outside the
// centerline — lands on the same curve the fill draws at radius `R`. Without
// this subtraction the stroke's outer escapes past the fill at corners.
function rectPath(x, y, w, h, radius, strokeWidth, corner) {
  const inset = (strokeWidth || 0) / 2;
  const xx = x + inset;
  const yy = y + inset;
  const ww = Math.max(0, w - inset * 2);
  const hh = Math.max(0, h - inset * 2);

  let tl = 0, tr = 0, br = 0, bl = 0;
  if (typeof radius === 'number') {
    tl = tr = br = bl = Math.max(0, radius - inset);
  } else if (radius && typeof radius === 'object') {
    tl = Math.max(0, (radius.tl || 0) - inset);
    tr = Math.max(0, (radius.tr || 0) - inset);
    br = Math.max(0, (radius.br || 0) - inset);
    bl = Math.max(0, (radius.bl || 0) - inset);
  }
  // Clamp so adjacent radii don't overlap on a side.
  const maxH = Math.max(0, ww);
  const maxV = Math.max(0, hh);
  const scaleTop    = (tl + tr) > maxH ? maxH / (tl + tr) : 1;
  const scaleBottom = (bl + br) > maxH ? maxH / (bl + br) : 1;
  const scaleLeft   = (tl + bl) > maxV ? maxV / (tl + bl) : 1;
  const scaleRight  = (tr + br) > maxV ? maxV / (tr + br) : 1;
  const s = Math.min(scaleTop, scaleBottom, scaleLeft, scaleRight);
  tl *= s; tr *= s; br *= s; bl *= s;

  // A chamfer cuts the corner straight between the same two points the arc would
  // connect, so per corner we just swap the arc command for a line — radius and
  // overlap clamping are shared. `corner` is a single style string OR a per-corner
  // map { tl, tr, br, bl } so styles can be mixed (e.g. top chamfered, bottom round).
  const isChamfer = (k) => (corner && typeof corner === 'object')
    ? corner[k] === 'chamfer'
    : corner === 'chamfer';
  const c = (r, ex, ey, ch) => r > 0 ? (ch ? `L ${ex} ${ey}` : `A ${r} ${r} 0 0 1 ${ex} ${ey}`) : '';
  return [
    `M ${xx + tl} ${yy}`,
    `H ${xx + ww - tr}`,
    c(tr, xx + ww, yy + tr, isChamfer('tr')),
    `V ${yy + hh - br}`,
    c(br, xx + ww - br, yy + hh, isChamfer('br')),
    `H ${xx + bl}`,
    c(bl, xx, yy + hh - bl, isChamfer('bl')),
    `V ${yy + tl}`,
    c(tl, xx + tl, yy, isChamfer('tl')),
    'Z',
  ].filter(Boolean).join(' ');
}

function insetRadius(radius, inset) {
  if (typeof radius === 'number') return Math.max(0, radius - inset);
  if (radius && typeof radius === 'object') {
    return {
      tl: Math.max(0, (radius.tl || 0) - inset),
      tr: Math.max(0, (radius.tr || 0) - inset),
      br: Math.max(0, (radius.br || 0) - inset),
      bl: Math.max(0, (radius.bl || 0) - inset),
    };
  }
  return 0;
}

function rectStrokeRingPath(l, strokeWidth) {
  const sw = Math.max(0, strokeWidth || 0);
  const outer = rectPath(l.x, l.y, l.w, l.h, l.radius, 0, l.corner);
  const iw = l.w - sw * 2;
  const ih = l.h - sw * 2;
  if (sw <= 0 || iw <= 0 || ih <= 0) return outer;
  const inner = rectPath(l.x + sw, l.y + sw, iw, ih, insetRadius(l.radius, sw), 0, l.corner);
  return `${outer} ${inner}`;
}

// Pseudo / Code-39 barcodes. Pure SVG <rect>s (+ an optional human-readable
// <text>), so the same node rasterizes correctly on PNG export. `data` drives
// the pattern; bars paint in `fill`, over an optional opaque `background` that
// is skipped when 'none' so the label colour shows through (transparent symbol).
function renderBarcode(l, transform) {
  const barColor = l.fill || '#000000';
  const bg = l.background == null ? '#FFFFFF' : l.background;
  const hasBg = bg && bg !== 'none';
  const els = [];

  // --- 2D matrix (decorative QR) ---
  if (l.variant === 'qr') {
    const grid = qrModules(l.data, l.qrSize);
    const n = grid.length;
    const side = Math.min(l.w, l.h);             // QR is square; centre it in the box
    const offX = l.x + (l.w - side) / 2;
    const offY = l.y + (l.h - side) / 2;
    const margin = side * 0.08;                  // quiet zone
    const m = (side - margin * 2) / n;           // module size
    // Background covers the FULL layer box (matches the linear branch) so a
    // non-square box doesn't leave transparent corners around the centred QR.
    if (hasBg) els.push(<rect key="bg" x={l.x} y={l.y} width={l.w} height={l.h} fill={bg} />);
    if (m > 0) {
      // Extend a module toward a neighbour ONLY when that neighbour is also set,
      // so the seam-closing overlap never bleeds dark into a light cell. Capped
      // at a fraction of the module so it stays subtle at small sizes.
      const overlap = Math.min(0.6, m * 0.06);
      for (let r = 0; r < n; r++) {
        for (let c = 0; c < n; c++) {
          if (!grid[r][c]) continue;
          const ow = m + (c + 1 < n && grid[r][c + 1] ? overlap : 0);
          const oh = m + (r + 1 < n && grid[r + 1][c] ? overlap : 0);
          els.push(
            <rect key={`m${r}-${c}`}
              x={offX + margin + c * m} y={offY + margin + r * m}
              width={ow} height={oh} fill={barColor} />
          );
        }
      }
    }
    return <g transform={transform}>{els}</g>;
  }

  // --- 1D linear (code128 pseudo / code39 real) ---
  const { elements, text, totalUnits, quietZone } =
    buildLinearBarcode(l.variant, l.data, l.density, l.quietZone);
  if (hasBg) els.push(<rect key="bg" x={l.x} y={l.y} width={l.w} height={l.h} fill={bg} />);
  const showText = l.showText !== false && !!text;
  const textH = showText ? Math.min(l.h * 0.28, 24) : 0;
  const barsH = Math.max(0, l.h - textH);
  const unit = totalUnits > 0 ? l.w / totalUnits : 0;
  if (unit > 0 && barsH > 0) {
    let x = l.x + quietZone * unit;
    elements.forEach((e, i) => {
      const w = e.units * unit;
      if (e.bar) els.push(<rect key={`b${i}`} x={x} y={l.y} width={w} height={barsH} fill={barColor} />);
      x += w;
    });
  }
  if (showText) {
    // Cap font to the text strip, then shrink further if the string is too wide
    // for the box (mono glyph ≈ 0.6em, +spacing budget).
    const fs = Math.min(textH * 0.82, (l.w * 0.92) / (Math.max(text.length, 1) * 0.65));
    els.push(
      <text key="hr"
        x={l.x + l.w / 2} y={l.y + barsH + textH * 0.78}
        fontFamily={FONTS.mono} fontSize={fs} fill={barColor}
        textAnchor="middle" letterSpacing={fs * 0.06}>
        {text}
      </text>
    );
  }
  return <g transform={transform}>{els}</g>;
}

// Compose a flipX/flipY mirror (about the layer centre) with the layer's
// rotation, for image layers — the one type whose flip can't be baked into
// geometry. The scale() applies to the image first (rightmost), then rotation.
function imageFlipTransform(l, transform) {
  if (!l.flipX && !l.flipY) return transform;
  const cx = l.x + l.w / 2, cy = l.y + l.h / 2;
  const flip = `translate(${cx} ${cy}) scale(${l.flipX ? -1 : 1} ${l.flipY ? -1 : 1}) translate(${-cx} ${-cy})`;
  return transform ? `${transform} ${flip}` : flip;
}

// ----------- Layer renderer -----------
function renderLayer(l, sev, symbolsReady) {
  if (l.hidden) return null;
  const transform = l.rotation
    ? `rotate(${l.rotation} ${l.x + l.w / 2} ${l.y + l.h / 2})`
    : undefined;

  switch (l.type) {
    case 'rect': {
      const sw = l.strokeWidth || 0;
      const stroke = resolveFill(l.stroke || 'none', l.bindSeverity, sev);
      const hasStroke = sw > 0 && stroke !== 'none';
      const drawStrokeHere = hasStroke && !l.strokeOnTop;
      // Inset the fill by sw/2 when there's a stroke so the fill's antialiased
      // edge tucks UNDER the opaque stroke ring. A full-bounds fill bleeds its
      // colour through the ring's antialiased outer edge — a hairline of fill /
      // underlying showing at fractional zoom. The ring still covers the inset
      // band, so no gutter appears.
      const fillPath = hasStroke
        ? rectPath(l.x, l.y, l.w, l.h, l.radius, sw, l.corner)
        : rectPath(l.x, l.y, l.w, l.h, l.radius, 0, l.corner);
      return (
        <g transform={transform}>
          <path
            d={fillPath}
            fill={resolveFill(l.fill, l.bindSeverity, sev)}
          />
          {drawStrokeHere && (
            <path
              d={rectStrokeRingPath(l, sw)}
              fill={stroke}
              fillRule="evenodd"
            />
          )}
        </g>
      );
    }
    case 'text': {
      const fontSize = Math.max(4, l.fontSize || 16);
      const charW = l.uppercase ? 0.62 : 0.55;
      const lines = wrapLines(l.text || '', l.w, fontSize, charW);
      const lh = (l.lineHeight || 1.2) * fontSize;
      const anchor = l.align || 'start';
      const ax = anchor === 'middle' ? l.x + l.w / 2 : anchor === 'end' ? l.x + l.w : l.x;
      const fill = resolveFill(l.fill, l.bindSeverity, sev);
      const family = FONTS[l.fontFamily] || FONTS.sans;
      // Baseline of first line: place so it sits with a small top inset.
      const baseY = l.y + fontSize * 0.92;
      return (
        <g transform={transform}>
          {lines.map((line, i) => (
            <text
              key={i}
              x={ax}
              y={baseY + i * lh}
              fontFamily={family}
              fontSize={fontSize}
              fontWeight={l.fontWeight || 400}
              fill={fill}
              textAnchor={anchor}
              fontStyle={l.italic ? 'italic' : 'normal'}
              letterSpacing={(l.letterSpacing || 0) * fontSize}>
              {l.uppercase ? line.toUpperCase() : line}
            </text>
          ))}
        </g>
      );
    }
    case 'bullets': {
      const fontSize = Math.max(4, l.fontSize || 16);
      const lh = (l.lineHeight || 1.35) * fontSize;
      const indent = fontSize * 1.4;
      const fill = resolveFill(l.fill, l.bindSeverity, sev);
      const family = FONTS[l.fontFamily] || FONTS.sans;
      const items = (l.items || [])
        .map(b => bulletText(b))
        .filter(b => b && b.trim());

      const out = [];
      let cy = l.y;
      items.forEach((item, bi) => {
        const lines = wrapLines(item, l.w - indent, fontSize);
        const startY = cy;
        out.push(
          <circle key={`dot-${bi}`}
            cx={l.x + fontSize * 0.5}
            cy={startY + fontSize * 0.78}
            r={fontSize * 0.22}
            fill={fill} />
        );
        lines.forEach((line, i) => {
          out.push(
            <text key={`txt-${bi}-${i}`}
              x={l.x + indent}
              y={startY + (i + 1) * lh - lh * 0.25}
              fontFamily={family}
              fontSize={fontSize}
              fontWeight={l.fontWeight || 500}
              fill={fill}
              textAnchor="start">
              {line}
            </text>
          );
        });
        cy += lines.length * lh + fontSize * 0.4;
      });
      return <g transform={transform}>{out}</g>;
    }
    case 'image': {
      // A layer carries either a built-in symbol id or its own uploaded data URL (l.src).
      const href = l.src || pictoHref(l.symbol);
      if (!href) {
        // No resolved symbol. While symbols are still loading, render nothing
        // (avoids a placeholder flash on first paint). Once loading is done an
        // empty href means the id is unknown or its fetch failed — draw a
        // visible placeholder so the layer isn't silently invisible AND keeps
        // its hit area (the map skips the whole <g> when this returns null).
        if (!symbolsReady) return null;
        return (
          <g transform={transform}>
            <rect x={l.x} y={l.y} width={l.w} height={l.h}
                  fill="none" stroke="#b91c1c" strokeWidth="2" strokeDasharray="6 4" />
            <line x1={l.x} y1={l.y} x2={l.x + l.w} y2={l.y + l.h} stroke="#b91c1c" strokeWidth="1" />
            <line x1={l.x + l.w} y1={l.y} x2={l.x} y2={l.y + l.h} stroke="#b91c1c" strokeWidth="1" />
          </g>
        );
      }
      return (
        <g transform={imageFlipTransform(l, transform)}>
          <image
            href={href} xlinkHref={href}
            x={l.x} y={l.y} width={l.w} height={l.h}
            preserveAspectRatio={l.preserveAspect === false ? 'none' : 'xMidYMid meet'}
          />
        </g>
      );
    }
    case 'line': {
      return (
        <g transform={transform}>
          <line
            x1={l.x} y1={l.y + l.h / 2}
            x2={l.x + l.w} y2={l.y + l.h / 2}
            stroke={resolveFill(l.stroke, l.bindSeverity, sev)}
            strokeWidth={l.strokeWidth || 2}
            strokeDasharray={l.dasharray || undefined}
          />
        </g>
      );
    }
    case 'polygon': {
      // Points are normalized (0..1) relative to the layer's box so the shape
      // resizes correctly with the handles.
      const pts = (l.points || []).map(p =>
        `${l.x + p.x * l.w},${l.y + p.y * l.h}`
      ).join(' ');
      return (
        <g transform={transform}>
          <polygon
            points={pts}
            fill={resolveFill(l.fill, l.bindSeverity, sev)}
            stroke={l.stroke || 'none'}
            strokeWidth={l.strokeWidth || 0}
            strokeLinejoin="miter"
          />
        </g>
      );
    }
    case 'ellipse': {
      return (
        <g transform={transform}>
          <ellipse
            cx={l.x + l.w / 2} cy={l.y + l.h / 2}
            rx={l.w / 2} ry={l.h / 2}
            fill={resolveFill(l.fill, l.bindSeverity, sev)}
            stroke={l.stroke || 'none'}
            strokeWidth={l.strokeWidth || 0}
          />
        </g>
      );
    }
    case 'barcode':
      return renderBarcode(l, transform);
    default:
      return null;
  }
}

export { rectPath, rectStrokeRingPath, renderLayer, resolveFill };
