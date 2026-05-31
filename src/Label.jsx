// Layer-based label renderer.
import { forwardRef, useImperativeHandle, useRef, memo } from 'react';
import { uid } from './uid.js';
import { pictoHref } from './symbols.js';
import { buildLinearBarcode, qrModules } from './barcode.js';

const SEVERITY = {
  danger:  { word: 'DANGER',       band: '#C8102E', bandInk: '#FFFFFF' },
  warning: { word: 'WARNING',      band: '#F36F21', bandInk: '#000000' },
  caution: { word: 'CAUTION',      band: '#FFD200', bandInk: '#000000' },
  notice:  { word: 'NOTICE',       band: '#1057A8', bandInk: '#FFFFFF' },
  safety:  { word: 'SAFETY FIRST', band: '#0E7C4E', bandInk: '#FFFFFF' },
};

const FONTS = {
  sans: "'Helvetica Neue', Helvetica, Arial, sans-serif",
  serif: "Georgia, 'Times New Roman', serif",
  mono: "'Courier New', Courier, monospace",
};

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

// ----------- Layer factory -----------
function L(props) {
  const isCanvasFill = props.syncCanvas === 'fill';
  return {
    id: uid(),
    rotation: 0,
    hidden: false,
    locked: false,
    stackLocked: isCanvasFill,
    ...props,
  };
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
      const drawStrokeHere = sw > 0 && !l.strokeOnTop && stroke !== 'none';
      const fillPath = rectPath(l.x, l.y, l.w, l.h, l.radius, 0, l.corner);
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
        <g transform={transform}>
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

// ----------- Format presets -----------
// Each preset is a function (W, H, severity) => layers[]; called when user clicks
// a format tile. Resulting layers fully describe the label and can then be moved /
// resized / edited by the user.

const FORMATS = [
  { id: 'ansi-header', name: 'ANSI Header', default: [640, 480] },
  { id: 'ansi-side',   name: 'Side Bar',    default: [680, 360] },
  { id: 'banner',      name: 'Tall Banner', default: [540, 760] },
  { id: 'plate',       name: 'ISO Plate',   default: [520, 520] },
  { id: 'stop',        name: 'Stop',        default: [520, 520] },
  { id: 'tag',         name: 'Lockout Tag', default: [380, 720] },
  { id: 'strip',       name: 'Barricade',   default: [960, 140] },
  { id: 'ghs-label',   name: 'GHS Chemical', default: [600, 820] },
  { id: 'ppe',         name: 'PPE Required', default: [720, 460] },
  { id: 'fire-point',  name: 'Fire Point',   default: [480, 640] },
  { id: 'first-aid',   name: 'First Aid',    default: [540, 560] },
  { id: 'prohibition', name: 'Prohibition',  default: [480, 600] },
  { id: 'electrical-panel', name: 'Electrical Panel', default: [600, 760] },
  { id: 'confined-space',   name: 'Confined Space',   default: [600, 800] },
  { id: 'forklift-traffic', name: 'Forklift Traffic', default: [680, 480] },
  { id: 'emergency-exit',   name: 'Emergency Exit',   default: [760, 360] },
  { id: 'biohazard',        name: 'Biohazard',        default: [600, 800] },
  { id: 'laser-radiation',  name: 'Laser Radiation',  default: [600, 780] },
  { id: 'site-access',      name: 'Site Access',      default: [600, 780] },
  { id: 'barcode-label',  name: 'Barcode Label',  default: [620, 360] },
  { id: 'asset-tag',      name: 'Asset Tag',       default: [560, 380] },
  { id: 'shipping-label', name: 'Shipping Label',  default: [600, 800] },
  { id: 'shipping-handling', name: 'Shipping Handling', default: [600, 800] },
  { id: 'inspection-due', name: 'Inspection Due',   default: [600, 400] },
  { id: 'calibration',    name: 'Calibration',      default: [520, 340] },
  { id: 'blank',       name: 'Blank',       default: [520, 520] },
];

function makeAnsiHeader(W, H, severity) {
  const sev = SEVERITY[severity];
  const headerH = Math.max(64, H * 0.24);
  const pictoBox = headerH * 0.82;
  const pictoX = W * 0.04;
  const pictoY = (headerH - pictoBox) / 2;
  const signalSize = headerH * 0.52;
  const padX = W * 0.06;
  const contentW = W - padX * 2;
  const bodyTop = headerH + H * 0.05;

  return [
    L({ name: 'Background', type: 'rect', x: 0, y: 0, w: W, h: H,
        fill: '#FFFFFF', stroke: '#000000', strokeWidth: 3,
        locked: true, syncCanvas: 'fill', strokeOnTop: true }),
    L({ name: 'Signal band', type: 'rect', x: 0, y: 0, w: W, h: headerH,
        fill: sev.band, bindSeverity: 'band',
        pinSides: { top: true, left: true, right: true },
        clipToCanvas: true }),
    L({ name: 'Pictogram', type: 'image', x: pictoX, y: pictoY, w: pictoBox, h: pictoBox, symbol: 'bolt',
        pinSides: { top: true, left: true } }),
    L({ name: 'Signal word', type: 'text',
        x: pictoX + pictoBox + headerH * 0.18,
        y: headerH / 2 - signalSize / 2 + signalSize * 0.04,
        w: W - (pictoX + pictoBox + headerH * 0.18) - padX,
        h: signalSize * 1.2,
        text: sev.word, fontSize: signalSize, fontWeight: 900,
        fill: sev.bandInk, bindSeverity: 'bandInk',
        align: 'start', uppercase: true, letterSpacing: 0.04,
        pinSides: { top: true, left: true, right: true } }),
    L({ name: 'Title', type: 'text',
        x: padX, y: bodyTop,
        w: contentW, h: 60,
        text: 'High Voltage',
        fontSize: Math.min(contentW / 11, 44), fontWeight: 900,
        fill: '#000000', align: 'middle', uppercase: true,
        pinSides: { top: true, left: true, right: true } }),
    L({ name: 'Message', type: 'text',
        x: padX, y: bodyTop + 70,
        w: contentW, h: 60,
        text: 'Hazardous voltage inside.\nDisconnect power before servicing.',
        fontSize: Math.min(contentW / 24, 22), fontWeight: 500,
        fill: '#000000', align: 'middle',
        pinSides: { top: true, left: true, right: true } }),
    L({ name: 'Instructions', type: 'bullets',
        x: padX, y: bodyTop + 150,
        w: contentW, h: 80,
        items: [
          { id: uid(), text: 'Authorized personnel only.' },
          { id: uid(), text: 'Lock out before opening.' },
        ],
        fontSize: 16, fontWeight: 500, fill: '#000000',
        pinSides: { top: true, left: true, right: true } }),
  ];
}

function makeAnsiSide(W, H, severity) {
  const sev = SEVERITY[severity];
  const bandW = Math.max(80, W * 0.18);
  // The signal word is rotated -90° to run up the band, so its text flows along
  // the band's long (vertical) axis. Size the layout to that axis and shrink the
  // font just enough that the actual word (e.g. the multi-word "SAFETY FIRST")
  // fits on ONE line — otherwise it wraps and the extra lines stack sideways out
  // of the narrow band. 0.7 ≈ per-char glyph + letter-spacing budget, leaving
  // slack over wrapLines' 0.62 so it never breaks.
  const wordRun = H * 0.86;
  const signalSize = Math.min(bandW * 0.58, H * 0.18, wordRun / (sev.word.length * 0.7));
  const signalLH = signalSize * 1.2;
  const padX = W * 0.04;
  const pictoBox = Math.min(H * 0.7, (W - bandW) * 0.34);
  const pictoX = bandW + padX;
  const pictoY = (H - pictoBox) / 2;
  const textX = pictoX + pictoBox + padX;
  const textW = W - textX - padX;

  return [
    L({ name: 'Background', type: 'rect', x: 0, y: 0, w: W, h: H,
        fill: '#FFFFFF', stroke: '#000000', strokeWidth: 3,
        locked: true, syncCanvas: 'fill', strokeOnTop: true }),
    L({ name: 'Signal band', type: 'rect', x: 0, y: 0, w: bandW, h: H,
        fill: sev.band, bindSeverity: 'band',
        pinSides: { top: true, left: true, bottom: true },
        clipToCanvas: true }),
    L({ name: 'Signal word', type: 'text',
        x: bandW / 2 - wordRun / 2, y: H / 2 - signalLH / 2,
        w: wordRun, h: signalLH,
        text: sev.word, fontSize: signalSize, fontWeight: 900,
        fill: sev.bandInk, bindSeverity: 'bandInk',
        align: 'middle', uppercase: true, letterSpacing: 0.06,
        rotation: -90 }),
    L({ name: 'Pictogram', type: 'image', x: pictoX, y: pictoY, w: pictoBox, h: pictoBox, symbol: 'bolt',
        pinSides: { top: true, left: true } }),
    L({ name: 'Title', type: 'text',
        x: textX, y: H * 0.12,
        w: textW, h: 50,
        text: 'High Voltage',
        fontSize: Math.min(textW / 10, 36), fontWeight: 900,
        fill: '#000000', align: 'start', uppercase: true,
        pinSides: { top: true, left: true, right: true } }),
    L({ name: 'Message', type: 'text',
        x: textX, y: H * 0.12 + 56,
        w: textW, h: 80,
        text: 'Hazardous voltage inside.\nDisconnect power before servicing.',
        fontSize: Math.min(textW / 22, 18), fontWeight: 500,
        fill: '#000000', align: 'start',
        pinSides: { top: true, left: true, right: true } }),
  ];
}

function makeBanner(W, H, severity) {
  const sev = SEVERITY[severity];
  const headerH = Math.max(72, H * 0.16);
  const pictoSize = Math.min(W * 0.6, H * 0.3);
  const pictoX = W / 2 - pictoSize / 2;
  const pictoY = headerH + H * 0.04;
  const signalSize = headerH * 0.6;
  const padX = W * 0.07;
  const contentW = W - padX * 2;
  const bodyTop = pictoY + pictoSize + H * 0.04;

  return [
    L({ name: 'Background', type: 'rect', x: 0, y: 0, w: W, h: H,
        fill: '#FFFFFF', stroke: '#000000', strokeWidth: 3,
        locked: true, syncCanvas: 'fill', strokeOnTop: true }),
    L({ name: 'Signal band', type: 'rect', x: 0, y: 0, w: W, h: headerH,
        fill: sev.band, bindSeverity: 'band',
        pinSides: { top: true, left: true, right: true },
        clipToCanvas: true }),
    L({ name: 'Signal word', type: 'text',
        x: 0, y: headerH / 2 - signalSize / 2 + signalSize * 0.04,
        w: W, h: signalSize * 1.2,
        text: sev.word, fontSize: signalSize, fontWeight: 900,
        fill: sev.bandInk, bindSeverity: 'bandInk',
        align: 'middle', uppercase: true, letterSpacing: 0.04,
        pinSides: { top: true, left: true, right: true } }),
    L({ name: 'Pictogram', type: 'image', x: pictoX, y: pictoY, w: pictoSize, h: pictoSize, symbol: 'bolt' }),
    L({ name: 'Title', type: 'text',
        x: padX, y: bodyTop,
        w: contentW, h: 56,
        text: 'High Voltage',
        fontSize: Math.min(contentW / 10, 44), fontWeight: 900,
        fill: '#000000', align: 'middle', uppercase: true,
        pinSides: { top: true, left: true, right: true } }),
    L({ name: 'Message', type: 'text',
        x: padX, y: bodyTop + 70,
        w: contentW, h: 80,
        text: 'Hazardous voltage inside.\nDisconnect power before servicing.',
        fontSize: Math.min(contentW / 22, 22), fontWeight: 500,
        fill: '#000000', align: 'middle',
        pinSides: { top: true, left: true, right: true } }),
    L({ name: 'Instructions', type: 'bullets',
        x: padX, y: bodyTop + 170,
        w: contentW, h: 140,
        items: [
          { id: uid(), text: 'Authorized personnel only.' },
          { id: uid(), text: 'Lock out before opening.' },
          { id: uid(), text: 'Use insulated tools.' },
        ],
        fontSize: 18, fontWeight: 500, fill: '#000000',
        pinSides: { top: true, left: true, right: true } }),
  ];
}

function makePlate(W, H, severity) {
  const m = Math.max(4, Math.min(W, H) * 0.02);
  const captionH = 40;
  return [
    L({ name: 'Background', type: 'rect', x: 0, y: 0, w: W, h: H, fill: '#FFFFFF', locked: true, syncCanvas: 'fill' }),
    L({ name: 'Pictogram', type: 'image',
        x: m, y: m,
        w: W - m * 2, h: H - m * 2 - captionH,
        symbol: 'bolt' }),
    L({ name: 'Caption', type: 'text',
        x: m, y: H - m - captionH,
        w: W - m * 2, h: captionH,
        text: 'High Voltage',
        fontSize: Math.min(W / 22, 22), fontWeight: 900,
        fill: '#000000', align: 'middle', uppercase: true, letterSpacing: 0.1 }),
  ];
}

// Regular octagon as 8 points normalized to 0..1. The "1 - sqrt(2)/2" inset is
// where the cut corners hit the bounding box (≈0.293), giving equal-length edges.
const OCTAGON_POINTS = (() => {
  const k = 1 - Math.SQRT1_2; // ≈ 0.2929
  return [
    { x: k,     y: 0 },     { x: 1 - k, y: 0 },
    { x: 1,     y: k },     { x: 1,     y: 1 - k },
    { x: 1 - k, y: 1 },     { x: k,     y: 1 },
    { x: 0,     y: 1 - k }, { x: 0,     y: k },
  ];
})();

// Normalized (0..1) point sets for the shape tools. regularPoly inscribes a
// regular n-gon in the box (rotated so a vertex points up); the rest are
// hand-set so they fill the box edge-to-edge.
function regularPoly(n, rotDeg) {
  const rot = (rotDeg || 0) * Math.PI / 180;
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = rot + (i * 2 * Math.PI) / n;
    pts.push({ x: 0.5 + 0.5 * Math.cos(a), y: 0.5 + 0.5 * Math.sin(a) });
  }
  return pts;
}
// n-pointed star inscribed in the box: 2n vertices alternating between the outer
// radius (0.5) and `inner`. inner is the inner-radius as a fraction of 0.5, so
// smaller = spikier. Defaults reproduce the original 5-point star (0.21/0.5).
function starPoints(n, inner) {
  const pts = [];
  const r0 = 0.5, ri = (inner == null ? 0.42 : inner) * 0.5;
  for (let i = 0; i < n * 2; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / n;
    const r = i % 2 === 0 ? r0 : ri;
    pts.push({ x: 0.5 + r * Math.cos(a), y: 0.5 + r * Math.sin(a) });
  }
  return pts;
}
const SHAPE_POINTS = {
  triangle: [{ x: 0.5, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }],
  diamond: [{ x: 0.5, y: 0 }, { x: 1, y: 0.5 }, { x: 0.5, y: 1 }, { x: 0, y: 0.5 }],
  pentagon: regularPoly(5, -90),
  hexagon: regularPoly(6, -90),
  star: starPoints(5, 0.42),
};

function makeStop(W, H) {
  const size = Math.min(W, H) - 4;
  const sx = (W - size) / 2;
  const sy = (H - size) / 2;
  const inner = size * 0.92;
  const ix = (W - inner) / 2;
  const iy = (H - inner) / 2;
  const fontSize = size * 0.34;

  return [
    L({ name: 'Background', type: 'rect', x: 0, y: 0, w: W, h: H, fill: '#FFFFFF', locked: true, syncCanvas: 'fill' }),
    L({ name: 'Octagon (red)', type: 'polygon',
        x: sx, y: sy, w: size, h: size,
        points: OCTAGON_POINTS,
        fill: '#C8102E', stroke: '#FFFFFF', strokeWidth: 6 }),
    L({ name: 'Inner ring', type: 'polygon',
        x: ix, y: iy, w: inner, h: inner,
        points: OCTAGON_POINTS,
        fill: 'none', stroke: '#FFFFFF', strokeWidth: 3 }),
    L({ name: 'Stop word', type: 'text',
        x: 0, y: H / 2 - fontSize / 2 + fontSize * 0.04,
        w: W, h: fontSize * 1.2,
        text: 'STOP', fontSize, fontWeight: 900,
        fill: '#FFFFFF', align: 'middle', uppercase: true, letterSpacing: 0.04 }),
  ];
}

function makeTag(W, H, severity) {
  const sev = SEVERITY[severity];
  const holeR = W * 0.07;
  const topPad = holeR + W * 0.07;
  const headerY = topPad + holeR + W * 0.06;
  const headerH = H * 0.13;
  const signalSize = headerH * 0.66;
  const padX = W * 0.08;
  const contentW = W - padX * 2;
  const pictoBox = W * 0.55;
  const pictoX = W / 2 - pictoBox / 2;
  const pictoY = headerY + headerH + W * 0.05;
  const bodyTop = pictoY + pictoBox + W * 0.05;

  return [
    L({ name: 'Background', type: 'rect', x: 0, y: 0, w: W, h: H,
        fill: '#FFFFFF', stroke: '#000000', strokeWidth: 3,
        locked: true, syncCanvas: 'fill', strokeOnTop: true }),
    L({ name: 'Inset border', type: 'rect',
        x: padX * 0.5, y: topPad + holeR + W * 0.03,
        w: W - padX, h: H - (topPad + holeR + W * 0.06),
        fill: 'none', stroke: '#000', strokeWidth: 1, locked: true,
        pinSides: { top: true, left: true, right: true, bottom: true } }),
    L({ name: 'Signal band', type: 'rect',
        x: padX * 0.5, y: headerY,
        w: W - padX, h: headerH,
        fill: sev.band, bindSeverity: 'band',
        pinSides: { top: true, left: true, right: true } }),
    L({ name: 'Signal word', type: 'text',
        x: 0, y: headerY + headerH / 2 - signalSize / 2 + signalSize * 0.04,
        w: W, h: signalSize * 1.2,
        text: sev.word, fontSize: signalSize, fontWeight: 900,
        fill: sev.bandInk, bindSeverity: 'bandInk',
        align: 'middle', uppercase: true, letterSpacing: 0.05,
        pinSides: { top: true, left: true, right: true } }),
    L({ name: 'Pictogram', type: 'image', x: pictoX, y: pictoY, w: pictoBox, h: pictoBox, symbol: 'bolt' }),
    L({ name: 'Title', type: 'text',
        x: padX, y: bodyTop,
        w: contentW, h: 50,
        text: 'Do Not Operate',
        fontSize: W * 0.075, fontWeight: 900,
        fill: '#000000', align: 'middle', uppercase: true,
        pinSides: { top: true, left: true, right: true } }),
    L({ name: 'Message', type: 'text',
        x: padX, y: bodyTop + W * 0.13,
        w: contentW, h: 80,
        text: 'Equipment locked out for service.',
        fontSize: W * 0.045, fontWeight: 500,
        fill: '#000000', align: 'middle',
        pinSides: { top: true, left: true, right: true } }),
    L({ name: 'Signed label', type: 'text',
        x: padX, y: H - W * 0.42,
        w: contentW, h: 16, text: 'SIGNED',
        fontFamily: 'mono', fontSize: W * 0.03, fill: '#000000', letterSpacing: 0.1, uppercase: true,
        pinSides: { bottom: true, left: true, right: true } }),
    L({ name: 'Signed line', type: 'line',
        x: padX, y: H - W * 0.38, w: contentW, h: 1,
        stroke: '#000', strokeWidth: 1,
        pinSides: { bottom: true, left: true, right: true } }),
    L({ name: 'Date label', type: 'text',
        x: padX, y: H - W * 0.28,
        w: contentW, h: 16, text: 'DATE',
        fontFamily: 'mono', fontSize: W * 0.03, fill: '#000000', letterSpacing: 0.1, uppercase: true,
        pinSides: { bottom: true, left: true, right: true } }),
    L({ name: 'Date line', type: 'line',
        x: padX, y: H - W * 0.24, w: contentW, h: 1,
        stroke: '#000', strokeWidth: 1,
        pinSides: { bottom: true, left: true, right: true } }),
  ];
}

function makeStrip(W, H, severity) {
  const sev = SEVERITY[severity];
  const wordSize = H * 0.5;
  // Diagonal hazard stripes: white parallelograms over the severity colour,
  // clipped to the canvas. k is the 45° skew (equal px shift top-to-bottom);
  // each white stripe and the colour gap between are ~the same width.
  const k = H / W;
  const stripeW = (H * 0.55) / W;
  const period = stripeW * 2;
  const layers = [
    L({ name: 'Background', type: 'rect', x: 0, y: 0, w: W, h: H,
        fill: sev.band, bindSeverity: 'band',
        locked: true, syncCanvas: 'fill' }),
  ];
  for (let a = -k; a < 1 + period; a += period) {
    layers.push(L({ name: 'Stripe', type: 'polygon', x: 0, y: 0, w: W, h: H,
      points: [
        { x: a, y: 0 }, { x: a + stripeW, y: 0 },
        { x: a + stripeW - k, y: 1 }, { x: a - k, y: 1 },
      ],
      fill: '#FFFFFF', clipToCanvas: true }));
  }
  layers.push(L({ name: 'Center band', type: 'rect', x: 0, y: H * 0.25, w: W, h: H * 0.5, fill: '#FFFFFF',
      pinSides: { top: true, left: true, right: true, bottom: true } }));
  layers.push(L({ name: 'Signal word', type: 'text',
      x: 0, y: H / 2 - wordSize / 2 + wordSize * 0.04,
      w: W, h: wordSize * 1.2,
      text: sev.word, fontSize: wordSize, fontWeight: 900,
      fill: '#000000', align: 'middle', uppercase: true, letterSpacing: 0.08,
      pinSides: { top: true, left: true, right: true, bottom: true } }));
  return layers;
}

function makeBlank(W, H) {
  return [
    L({ name: 'Background', type: 'rect', shape: 'rect', x: 0, y: 0, w: W, h: H, fill: '#FFFFFF', locked: true, syncCanvas: 'fill' }),
  ];
}

// ----------- Expanded templates (leverage the GHS / mandatory / fire / safe-condition / prohibition symbol sets) -----------

// GHS / CLP chemical hazard label: product name, signal word, a row of hazard
// diamonds, hazard + precautionary statements, and a supplier footer.
function makeGhsLabel(W, H, severity) {
  const padX = W * 0.06;
  const contentW = W - padX * 2;
  const productY = H * 0.045;
  const productSize = Math.min(contentW / 11, 46);
  const signalY = productY + productSize * 1.5;
  const signalSize = Math.min(contentW / 8, 60);
  const diamondSize = W * 0.22;
  const diamondsRowY = signalY + signalSize * 1.4;
  const diamondGap = (contentW - diamondSize * 3) / 2;
  const d1X = padX;
  const d2X = padX + diamondSize + diamondGap;
  const d3X = padX + (diamondSize + diamondGap) * 2;
  const hazardLabelY = diamondsRowY + diamondSize + H * 0.035;
  const hazardLabelSize = Math.min(contentW / 22, 22);
  const hazardBulletsY = hazardLabelY + hazardLabelSize * 1.5;
  const bulletSize = Math.min(contentW / 30, 17);
  const hazardBlockH = bulletSize * 1.4 * 3;
  const precLabelY = hazardBulletsY + hazardBlockH + H * 0.025;
  const precBulletsY = precLabelY + hazardLabelSize * 1.5;
  const footerH = H * 0.07;
  const dividerY = H - footerH;
  const supplierSize = Math.min(contentW / 38, 15);
  return [
    L({ name: 'Background', type: 'rect', x: 0, y: 0, w: W, h: H, fill: '#FFFFFF', stroke: '#000000', strokeWidth: 3, locked: true, syncCanvas: 'fill', strokeOnTop: true }),
    L({ name: 'Product name', type: 'text', x: padX, y: productY, w: contentW, h: productSize * 1.3, text: 'PRODUCT NAME', fontSize: productSize, fontWeight: 900, fill: '#1a1814', align: 'middle', uppercase: true, letterSpacing: 0.02, pinSides: { top: true, left: true, right: true } }),
    L({ name: 'Signal word', type: 'text', x: padX, y: signalY, w: contentW, h: signalSize * 1.3, text: 'DANGER', fontSize: signalSize, fontWeight: 900, fill: '#1a1814', align: 'middle', uppercase: true, letterSpacing: 0.06, pinSides: { top: true, left: true, right: true } }),
    L({ name: 'Pictogram flammable', type: 'image', x: d1X, y: diamondsRowY, w: diamondSize, h: diamondSize, symbol: 'GHS02', preserveAspect: true, pinSides: { top: true } }),
    L({ name: 'Pictogram toxic', type: 'image', x: d2X, y: diamondsRowY, w: diamondSize, h: diamondSize, symbol: 'GHS06', preserveAspect: true, pinSides: { top: true } }),
    L({ name: 'Pictogram harmful', type: 'image', x: d3X, y: diamondsRowY, w: diamondSize, h: diamondSize, symbol: 'GHS07', preserveAspect: true, pinSides: { top: true } }),
    L({ name: 'Hazard heading', type: 'text', x: padX, y: hazardLabelY, w: contentW, h: hazardLabelSize * 1.3, text: 'Hazard statements', fontSize: hazardLabelSize, fontWeight: 700, fill: '#1a1814', align: 'start', pinSides: { top: true, left: true, right: true } }),
    L({ name: 'Hazard statements', type: 'bullets', x: padX, y: hazardBulletsY, w: contentW, h: hazardBlockH, items: [{ id: uid(), text: 'Highly flammable liquid and vapour.' }, { id: uid(), text: 'Toxic if swallowed.' }, { id: uid(), text: 'Causes skin irritation.' }], fontSize: bulletSize, fontWeight: 400, fill: '#1a1814', lineHeight: 1.4, fontFamily: 'sans', pinSides: { top: true, left: true, right: true } }),
    L({ name: 'Precaution heading', type: 'text', x: padX, y: precLabelY, w: contentW, h: hazardLabelSize * 1.3, text: 'Precautionary statements', fontSize: hazardLabelSize, fontWeight: 700, fill: '#1a1814', align: 'start', pinSides: { top: true, left: true, right: true } }),
    L({ name: 'Precautionary statements', type: 'bullets', x: padX, y: precBulletsY, w: contentW, h: hazardBlockH, items: [{ id: uid(), text: 'Keep away from heat/sparks/open flames.' }, { id: uid(), text: 'Wear protective gloves and eye protection.' }, { id: uid(), text: 'IF SWALLOWED: call a POISON CENTER.' }], fontSize: bulletSize, fontWeight: 400, fill: '#1a1814', lineHeight: 1.4, fontFamily: 'sans', pinSides: { top: true, left: true, right: true } }),
    L({ name: 'Footer divider', type: 'line', x: padX, y: dividerY, w: contentW, h: 2, stroke: '#1a1814', strokeWidth: 1.5, pinSides: { bottom: true, left: true, right: true } }),
    L({ name: 'Supplier', type: 'text', x: padX, y: dividerY + footerH * 0.3, w: contentW, h: supplierSize * 1.4, text: 'Supplier Name · Address · Tel', fontSize: supplierSize, fontWeight: 400, fill: '#1a1814', align: 'middle', pinSides: { bottom: true, left: true, right: true } }),
  ];
}

// Mandatory PPE sign: blue header/footer bands and a centered row of PPE pictograms.
function makePpe(W, H, severity) {
  const blue = '#1057A8';
  const headerH = Math.max(72, H * 0.22);
  const footerH = Math.max(40, H * 0.13);
  const padX = W * 0.05;
  const headerW = W - padX * 2;
  const count = 4;
  const symbols = ['hardHat', 'glasses', 'ears', 'M009'];
  const minGap = W * 0.025;
  const pictoBox = Math.min(H * 0.42, (W - (count + 1) * minGap) / count);
  const gap = (W - count * pictoBox) / (count + 1);
  const midZoneH = H - headerH - footerH;
  const pictoY = headerH + (midZoneH - pictoBox) / 2;
  const headerFont = Math.min(headerW / 28, headerH * 0.30);
  const footerFont = Math.min(W / 28, footerH * 0.5);
  return [
    L({ name: 'Background', type: 'rect', x: 0, y: 0, w: W, h: H, fill: '#FFFFFF', stroke: '#000000', strokeWidth: 3, locked: true, syncCanvas: 'fill', strokeOnTop: true }),
    L({ name: 'Header band', type: 'rect', x: 0, y: 0, w: W, h: headerH, fill: blue, clipToCanvas: true, pinSides: { top: true, left: true, right: true } }),
    L({ name: 'Header text', type: 'text', x: padX, y: 0, w: headerW, h: headerH, text: 'Personal Protective Equipment Required', fontSize: headerFont, fontWeight: 900, fill: '#FFFFFF', align: 'middle', uppercase: true, lineHeight: 1.15, pinSides: { top: true, left: true, right: true } }),
    L({ name: 'PPE head', type: 'image', x: gap + 0 * (pictoBox + gap), y: pictoY, w: pictoBox, h: pictoBox, symbol: symbols[0] }),
    L({ name: 'PPE eye', type: 'image', x: gap + 1 * (pictoBox + gap), y: pictoY, w: pictoBox, h: pictoBox, symbol: symbols[1] }),
    L({ name: 'PPE hearing', type: 'image', x: gap + 2 * (pictoBox + gap), y: pictoY, w: pictoBox, h: pictoBox, symbol: symbols[2] }),
    L({ name: 'PPE hands', type: 'image', x: gap + 3 * (pictoBox + gap), y: pictoY, w: pictoBox, h: pictoBox, symbol: symbols[3] }),
    L({ name: 'Footer band', type: 'rect', x: 0, y: H - footerH, w: W, h: footerH, fill: blue, clipToCanvas: true, pinSides: { bottom: true, left: true, right: true } }),
    L({ name: 'Footer text', type: 'text', x: padX, y: H - footerH, w: headerW, h: footerH, text: 'Mandatory in this area', fontSize: footerFont, fontWeight: 700, fill: '#FFFFFF', align: 'middle', uppercase: true, letterSpacing: 0.04, pinSides: { bottom: true, left: true, right: true } }),
  ];
}

// Fire-equipment location sign: solid red field (matched to the F-series plate
// colour) with a large white pictogram and title.
function makeFirePoint(W, H, severity) {
  const padX = W * 0.08;
  const contentW = W - padX * 2;
  const pictoBox = W * 0.55;
  const pictoX = W / 2 - pictoBox / 2;
  const pictoY = H * 0.13;
  const titleSize = Math.min(contentW / 8, H * 0.085, 52);
  const titleY = pictoY + pictoBox + H * 0.07;
  const subSize = Math.min(contentW / 16, titleSize * 0.45, 24);
  const subY = titleY + titleSize * 2.4 + H * 0.02;
  return [
    L({ name: 'Background', type: 'rect', x: 0, y: 0, w: W, h: H, fill: '#9B2423', stroke: '#FFFFFF', strokeWidth: 6, locked: true, syncCanvas: 'fill', strokeOnTop: true }),
    L({ name: 'Pictogram', type: 'image', x: pictoX, y: pictoY, w: pictoBox, h: pictoBox, symbol: 'F001', preserveAspect: true, pinSides: { top: true } }),
    L({ name: 'Title', type: 'text', x: padX, y: titleY, w: contentW, h: titleSize * 2.4, text: 'FIRE\nEXTINGUISHER', fontSize: titleSize, fontWeight: 900, fill: '#FFFFFF', align: 'middle', uppercase: true, letterSpacing: 0.02, lineHeight: 1.1, pinSides: { left: true, right: true, bottom: true } }),
    L({ name: 'Sub-text', type: 'text', x: padX, y: subY, w: contentW, h: subSize * 1.6, text: 'In case of fire', fontSize: subSize, fontWeight: 700, fill: '#FFFFFF', align: 'middle', uppercase: true, letterSpacing: 0.08, pinSides: { left: true, right: true, bottom: true } }),
  ];
}

// First-aid / emergency (safe condition) sign: solid green field (matched to the
// E-series plate colour) with the first-aid pictogram and a station caption.
function makeFirstAid(W, H, severity) {
  const green = '#237F52';
  const white = '#FFFFFF';
  const padX = W * 0.07;
  const contentW = W - padX * 2;
  const footerH = H * 0.11;
  const pictoBox = W * 0.5;
  const pictoX = W / 2 - pictoBox / 2;
  const pictoY = H * 0.1;
  const titleSize = Math.min(W * 0.13, 72);
  const titleY = H - footerH - H * 0.04 - titleSize * 1.1;
  return [
    L({ name: 'Background', type: 'rect', x: 0, y: 0, w: W, h: H, fill: green, stroke: white, strokeWidth: 10, locked: true, syncCanvas: 'fill', strokeOnTop: true }),
    L({ name: 'Pictogram', type: 'image', x: pictoX, y: pictoY, w: pictoBox, h: pictoBox, symbol: 'E003', preserveAspect: true }),
    L({ name: 'Title', type: 'text', x: padX, y: titleY, w: contentW, h: titleSize * 1.2, text: 'First Aid', fontSize: titleSize, fontWeight: 900, fill: white, align: 'middle', uppercase: true, letterSpacing: 0.04, pinSides: { left: true, right: true, bottom: true } }),
    L({ name: 'Footer band', type: 'rect', x: 0, y: H - footerH, w: W, h: footerH, fill: green, stroke: white, strokeWidth: 2, clipToCanvas: true, pinSides: { left: true, right: true, bottom: true } }),
    L({ name: 'Footer text', type: 'text', x: padX, y: H - footerH / 2 - (footerH * 0.34) / 2, w: contentW, h: footerH * 0.6, text: 'Location of first aid station', fontSize: Math.min(W * 0.045, 24), fontWeight: 700, fill: white, align: 'middle', uppercase: true, letterSpacing: 0.06, pinSides: { left: true, right: true, bottom: true } }),
  ];
}

// Prohibition sign: centered prohibition pictogram with a bold caption.
function makeProhibition(W, H, severity) {
  const symBox = W * 0.6;
  const symX = (W - symBox) / 2;
  const symY = H * 0.12;
  const padX = W * 0.08;
  const contentW = W - padX * 2;
  const titleSize = Math.min(contentW / 8, 56);
  const titleY = symY + symBox + H * 0.06;
  const titleBoxH = titleSize * 1.3;
  const subSize = Math.min(contentW / 22, 22);
  const subY = titleY + titleBoxH + H * 0.01;
  return [
    L({ name: 'Background', type: 'rect', x: 0, y: 0, w: W, h: H, fill: '#FFFFFF', stroke: '#000000', strokeWidth: 3, locked: true, syncCanvas: 'fill', strokeOnTop: true }),
    L({ name: 'Pictogram', type: 'image', x: symX, y: symY, w: symBox, h: symBox, symbol: 'noSmoking', preserveAspect: true }),
    L({ name: 'Title', type: 'text', x: padX, y: titleY, w: contentW, h: titleBoxH, text: 'No Smoking', fontSize: titleSize, fontWeight: 900, fill: '#1a1814', align: 'middle', uppercase: true, letterSpacing: 0.02, pinSides: { left: true, right: true, bottom: true } }),
    L({ name: 'Sub-text', type: 'text', x: padX, y: subY, w: contentW, h: subSize * 2.4, text: 'Smoking prohibited in this area', fontSize: subSize, fontWeight: 400, fill: '#1a1814', align: 'middle', lineHeight: 1.25, pinSides: { left: true, right: true, bottom: true } }),
  ];
}

// ----------- General-purpose label templates (not severity-driven) -----------

// Retail / barcode sticker: product name, a Code 128 barcode, and a price line.
function makeBarcodeLabel(W, H) {
  const padX = W * 0.06;
  const cw = W - padX * 2;
  const nameSize = Math.min(cw / 12, 38);
  return [
    L({ name: 'Background', type: 'rect', x: 0, y: 0, w: W, h: H, fill: '#FFFFFF', stroke: '#111111', strokeWidth: 2, locked: true, syncCanvas: 'fill', strokeOnTop: true }),
    L({ name: 'Product name', type: 'text', x: padX, y: H * 0.09, w: cw, h: nameSize * 1.3,
        text: 'PRODUCT NAME', fontSize: nameSize, fontWeight: 900, fill: '#111111',
        align: 'middle', uppercase: true, letterSpacing: 0.02, pinSides: { top: true, left: true, right: true } }),
    L({ name: 'Variant', type: 'text', x: padX, y: H * 0.09 + nameSize * 1.4, w: cw, h: 24,
        text: 'Variant · Size · Colour', fontSize: Math.min(cw / 30, 16), fontWeight: 500, fill: '#666666',
        align: 'middle', pinSides: { top: true, left: true, right: true } }),
    L({ name: 'Barcode', type: 'barcode', variant: 'code128', x: padX, y: H * 0.40, w: cw, h: H * 0.34,
        data: '0123456789012', fill: '#111111', background: '#FFFFFF', showText: true, quietZone: 10, density: 3,
        pinSides: { left: true, right: true } }),
    L({ name: 'Price', type: 'text', x: padX, y: H - H * 0.19, w: cw, h: Math.min(cw / 9, 46) * 1.2,
        text: '$0.00', fontSize: Math.min(cw / 9, 46), fontWeight: 900, fill: '#111111',
        align: 'middle', pinSides: { bottom: true, left: true, right: true } }),
  ];
}

// Equipment asset tag: dark owner header with a scannable Code 39 ID barcode.
function makeAssetTag(W, H) {
  const padX = W * 0.06;
  const cw = W - padX * 2;
  const headerH = H * 0.2;
  const ownerSize = Math.min(cw / 13, 28);
  return [
    L({ name: 'Background', type: 'rect', x: 0, y: 0, w: W, h: H, fill: '#FFFFFF', stroke: '#111111', strokeWidth: 3, radius: 16, locked: true, syncCanvas: 'fill', strokeOnTop: true }),
    L({ name: 'Header band', type: 'rect', x: 0, y: 0, w: W, h: headerH, fill: '#111111', clipToCanvas: true, pinSides: { top: true, left: true, right: true } }),
    L({ name: 'Owner', type: 'text', x: padX, y: headerH / 2 - ownerSize * 0.6, w: cw * 0.6, h: ownerSize * 1.3,
        text: 'ACME CORP', fontSize: ownerSize, fontWeight: 900, fill: '#FFFFFF',
        align: 'start', uppercase: true, letterSpacing: 0.03, pinSides: { top: true, left: true } }),
    L({ name: 'Kicker', type: 'text', x: padX, y: headerH / 2 - 11, w: cw, h: 22,
        text: 'ASSET TAG', fontFamily: 'mono', fontSize: Math.min(cw / 22, 18), fontWeight: 700, fill: '#FFD200',
        align: 'end', uppercase: true, letterSpacing: 0.12, pinSides: { top: true, right: true } }),
    L({ name: 'Barcode', type: 'barcode', variant: 'code39', x: padX, y: headerH + H * 0.08, w: cw, h: H * 0.34,
        data: 'AC-0042', fill: '#111111', background: '#FFFFFF', showText: true, quietZone: 10,
        pinSides: { left: true, right: true } }),
    L({ name: 'Asset ID', type: 'text', x: padX, y: H - H * 0.2, w: cw, h: 34,
        text: 'ASSET ID · 0042', fontSize: Math.min(cw / 16, 24), fontWeight: 700, fill: '#111111',
        align: 'middle', uppercase: true, letterSpacing: 0.05, pinSides: { bottom: true, left: true, right: true } }),
    L({ name: 'Footer', type: 'text', x: padX, y: H - H * 0.1, w: cw, h: 20,
        text: 'Property of ACME Corp — do not remove', fontSize: Math.min(cw / 30, 15), fontWeight: 500, fill: '#666666',
        align: 'middle', pinSides: { bottom: true, left: true, right: true } }),
  ];
}

// 4×6 shipping label: FROM / SHIP-TO address blocks + a Code 128 tracking barcode.
function makeShippingLabel(W, H) {
  const padX = W * 0.06;
  const cw = W - padX * 2;
  const toY = H * 0.27;
  return [
    L({ name: 'Background', type: 'rect', x: 0, y: 0, w: W, h: H, fill: '#FFFFFF', stroke: '#111111', strokeWidth: 3, locked: true, syncCanvas: 'fill', strokeOnTop: true }),
    L({ name: 'From label', type: 'text', x: padX, y: H * 0.04, w: cw, h: 18,
        text: 'FROM', fontFamily: 'mono', fontSize: 15, fontWeight: 700, fill: '#111111', uppercase: true, letterSpacing: 0.1,
        pinSides: { top: true, left: true } }),
    L({ name: 'From address', type: 'text', x: padX, y: H * 0.04 + 22, w: cw * 0.72, h: 72,
        text: 'Sender Name\n123 Warehouse Way\nCity, ST 00000', fontSize: 17, fontWeight: 500, fill: '#333333', lineHeight: 1.3,
        pinSides: { top: true, left: true } }),
    L({ name: 'Divider', type: 'line', x: padX, y: toY - H * 0.03, w: cw, h: 1, stroke: '#111111', strokeWidth: 2,
        pinSides: { top: true, left: true, right: true } }),
    L({ name: 'Ship-to label', type: 'text', x: padX, y: toY, w: cw, h: 22,
        text: 'SHIP TO', fontFamily: 'mono', fontSize: 19, fontWeight: 700, fill: '#111111', uppercase: true, letterSpacing: 0.12,
        pinSides: { top: true, left: true } }),
    L({ name: 'Ship-to address', type: 'text', x: padX, y: toY + 32, w: cw, h: 160,
        text: 'RECIPIENT NAME\n456 Delivery Road\nSuite 100\nBIG CITY, ST 11111', fontSize: 30, fontWeight: 800, fill: '#111111', lineHeight: 1.28, uppercase: true,
        pinSides: { top: true, left: true, right: true } }),
    L({ name: 'Tracking barcode', type: 'barcode', variant: 'code128', x: padX, y: H - H * 0.19, w: cw, h: H * 0.12,
        data: '1Z999AA10123456784', fill: '#111111', background: '#FFFFFF', showText: true, quietZone: 10, density: 4,
        pinSides: { bottom: true, left: true, right: true } }),
  ];
}

// Electrical-panel access sign: severity header + electrical pictogram, a
// working-clearance message, safe-work bullets, and a panel/circuit field.
function makeElectricalPanel(W, H, severity) {
  const sev = SEVERITY[severity];
  const headerH = Math.max(64, H * 0.18);
  const pictoBox = headerH * 0.82;
  const pictoX = W * 0.05;
  const pictoY = (headerH - pictoBox) / 2;
  const signalSize = headerH * 0.5;
  const padX = W * 0.07;
  const contentW = W - padX * 2;
  const bodyTop = headerH + H * 0.05;
  const fieldY = H - H * 0.12;
  return [
    L({ name: 'Background', type: 'rect', x: 0, y: 0, w: W, h: H,
        fill: '#FFFFFF', stroke: '#000000', strokeWidth: 3,
        locked: true, syncCanvas: 'fill', strokeOnTop: true }),
    L({ name: 'Signal band', type: 'rect', x: 0, y: 0, w: W, h: headerH,
        fill: sev.band, bindSeverity: 'band',
        pinSides: { top: true, left: true, right: true }, clipToCanvas: true }),
    L({ name: 'Pictogram', type: 'image', x: pictoX, y: pictoY, w: pictoBox, h: pictoBox,
        symbol: 'bolt', pinSides: { top: true, left: true } }),
    L({ name: 'Signal word', type: 'text',
        x: pictoX + pictoBox + headerH * 0.18,
        y: headerH / 2 - signalSize / 2 + signalSize * 0.04,
        w: W - (pictoX + pictoBox + headerH * 0.18) - padX, h: signalSize * 1.2,
        text: sev.word, fontSize: signalSize, fontWeight: 900,
        fill: sev.bandInk, bindSeverity: 'bandInk',
        align: 'start', uppercase: true, letterSpacing: 0.04,
        pinSides: { top: true, left: true, right: true } }),
    L({ name: 'Title', type: 'text', x: padX, y: bodyTop, w: contentW, h: 60,
        text: 'Electrical Panel', fontSize: Math.min(contentW / 10, 48), fontWeight: 900,
        fill: '#000000', align: 'middle', uppercase: true,
        pinSides: { top: true, left: true, right: true } }),
    L({ name: 'Message', type: 'text', x: padX, y: bodyTop + 78, w: contentW, h: 64,
        text: 'Keep clear. Maintain 36 in (915 mm)\nworking space in front of this panel.',
        fontSize: Math.min(contentW / 24, 22), fontWeight: 500, fill: '#000000',
        align: 'middle', lineHeight: 1.3,
        pinSides: { top: true, left: true, right: true } }),
    L({ name: 'Instructions', type: 'bullets', x: padX, y: bodyTop + 178, w: contentW, h: 150,
        items: [
          { id: uid(), text: 'Authorized personnel only.' },
          { id: uid(), text: 'Arc-flash PPE required.' },
          { id: uid(), text: 'De-energize and lock out before servicing.' },
        ],
        fontSize: 18, fontWeight: 500, fill: '#000000', lineHeight: 1.4,
        pinSides: { top: true, left: true, right: true } }),
    L({ name: 'Panel ID label', type: 'text', x: padX, y: fieldY, w: contentW, h: 16,
        text: 'PANEL / CIRCUIT', fontFamily: 'mono', fontSize: 14, fill: '#000000',
        letterSpacing: 0.1, uppercase: true, pinSides: { bottom: true, left: true } }),
    L({ name: 'Panel ID line', type: 'line', x: padX, y: fieldY + 30, w: contentW, h: 1,
        stroke: '#000000', strokeWidth: 1, pinSides: { bottom: true, left: true, right: true } }),
  ];
}

// Confined-space entry sign: severity header, a permit-only message, and a row
// of the ISO confined-space mandatory pictograms (ventilate / continuous
// ventilation / supervised entry) plus a permit-number field.
function makeConfinedSpace(W, H, severity) {
  const sev = SEVERITY[severity];
  const headerH = Math.max(64, H * 0.16);
  const signalSize = headerH * 0.5;
  const pictoBoxH = headerH * 0.82;
  const pictoXH = W * 0.05;
  const pictoYH = (headerH - pictoBoxH) / 2;
  const padX = W * 0.07;
  const contentW = W - padX * 2;
  const titleY = headerH + H * 0.045;
  const titleSize = Math.min(contentW / 9, 54);
  const msgY = titleY + titleSize * 1.5;
  const msgSize = Math.min(contentW / 20, 26);
  const count = 3;
  const symbols = ['M056', 'M057', 'M058'];
  const captions = ['Ventilate before entry', 'Continuous ventilation', 'Entry with supervisor'];
  const gap = W * 0.04;
  const rowBox = Math.min((contentW - gap * (count - 1)) / count, H * 0.2);
  const rowW = rowBox * count + gap * (count - 1);
  const rowX = (W - rowW) / 2;
  const rowY = msgY + msgSize * 2.2;
  const capSize = Math.min(rowBox * 0.16, 14);
  const fieldY = H - H * 0.12;
  const layers = [
    L({ name: 'Background', type: 'rect', x: 0, y: 0, w: W, h: H,
        fill: '#FFFFFF', stroke: '#000000', strokeWidth: 3,
        locked: true, syncCanvas: 'fill', strokeOnTop: true }),
    L({ name: 'Signal band', type: 'rect', x: 0, y: 0, w: W, h: headerH,
        fill: sev.band, bindSeverity: 'band',
        pinSides: { top: true, left: true, right: true }, clipToCanvas: true }),
    L({ name: 'Pictogram', type: 'image', x: pictoXH, y: pictoYH, w: pictoBoxH, h: pictoBoxH,
        symbol: 'exclamation', pinSides: { top: true, left: true } }),
    L({ name: 'Signal word', type: 'text',
        x: pictoXH + pictoBoxH + headerH * 0.18,
        y: headerH / 2 - signalSize / 2 + signalSize * 0.04,
        w: W - (pictoXH + pictoBoxH + headerH * 0.18) - padX, h: signalSize * 1.2,
        text: sev.word, fontSize: signalSize, fontWeight: 900,
        fill: sev.bandInk, bindSeverity: 'bandInk',
        align: 'start', uppercase: true, letterSpacing: 0.04,
        pinSides: { top: true, left: true, right: true } }),
    L({ name: 'Title', type: 'text', x: padX, y: titleY, w: contentW, h: titleSize * 1.3,
        text: 'Confined Space', fontSize: titleSize, fontWeight: 900,
        fill: '#000000', align: 'middle', uppercase: true,
        pinSides: { top: true, left: true, right: true } }),
    L({ name: 'Message', type: 'text', x: padX, y: msgY, w: contentW, h: msgSize * 2,
        text: 'Enter by permit only', fontSize: msgSize, fontWeight: 700,
        fill: '#000000', align: 'middle', uppercase: true, letterSpacing: 0.03,
        pinSides: { top: true, left: true, right: true } }),
  ];
  for (let i = 0; i < count; i++) {
    const cx = rowX + i * (rowBox + gap);
    layers.push(L({ name: `Pictogram ${i + 1}`, type: 'image', x: cx, y: rowY, w: rowBox, h: rowBox,
      symbol: symbols[i], preserveAspect: true }));
    layers.push(L({ name: `Caption ${i + 1}`, type: 'text', x: cx - gap / 2, y: rowY + rowBox + 6,
      w: rowBox + gap, h: capSize * 2.6, text: captions[i], fontSize: capSize, fontWeight: 500,
      fill: '#000000', align: 'middle', lineHeight: 1.2 }));
  }
  layers.push(L({ name: 'Permit label', type: 'text', x: padX, y: fieldY, w: contentW, h: 16,
    text: 'PERMIT NO.', fontFamily: 'mono', fontSize: 14, fill: '#000000',
    letterSpacing: 0.1, uppercase: true, pinSides: { bottom: true, left: true } }));
  layers.push(L({ name: 'Permit line', type: 'line', x: padX, y: fieldY + 30, w: contentW, h: 1,
    stroke: '#000000', strokeWidth: 1, pinSides: { bottom: true, left: true, right: true } }));
  return layers;
}

// Forklift-traffic warning: severity header with the industrial-truck
// pictogram beside a title and awareness message.
function makeForkliftTraffic(W, H, severity) {
  const sev = SEVERITY[severity];
  const headerH = Math.max(64, H * 0.2);
  const signalSize = headerH * 0.56;
  const padX = W * 0.06;
  const pictoSize = Math.min(W * 0.34, H * 0.46);
  const pictoX = padX;
  const pictoY = headerH + (H - headerH - pictoSize) / 2;
  const textX = pictoX + pictoSize + W * 0.04;
  const textW = W - textX - padX;
  const titleSize = Math.min(textW / 8, 52);
  const titleY = headerH + (H - headerH) * 0.26;
  const msgSize = Math.min(textW / 18, 22);
  // Title is hard-wrapped to two lines ('Forklift' / 'Traffic') because the
  // single string overflows the narrow side-column at titleSize. Budget the
  // message position for both title lines plus a small gap.
  const msgY = titleY + titleSize * 1.2 * 2 + titleSize * 0.3;
  return [
    L({ name: 'Background', type: 'rect', x: 0, y: 0, w: W, h: H,
        fill: '#FFFFFF', stroke: '#000000', strokeWidth: 3,
        locked: true, syncCanvas: 'fill', strokeOnTop: true }),
    L({ name: 'Signal band', type: 'rect', x: 0, y: 0, w: W, h: headerH,
        fill: sev.band, bindSeverity: 'band',
        pinSides: { top: true, left: true, right: true }, clipToCanvas: true }),
    L({ name: 'Signal word', type: 'text',
        x: 0, y: headerH / 2 - signalSize / 2 + signalSize * 0.04, w: W, h: signalSize * 1.2,
        text: sev.word, fontSize: signalSize, fontWeight: 900,
        fill: sev.bandInk, bindSeverity: 'bandInk',
        align: 'middle', uppercase: true, letterSpacing: 0.05,
        pinSides: { top: true, left: true, right: true } }),
    L({ name: 'Pictogram', type: 'image', x: pictoX, y: pictoY, w: pictoSize, h: pictoSize,
        symbol: 'forklift', preserveAspect: true, pinSides: { left: true } }),
    L({ name: 'Title', type: 'text', x: textX, y: titleY, w: textW, h: titleSize * 1.2 * 2,
        text: 'Forklift\nTraffic', fontSize: titleSize, fontWeight: 900,
        fill: '#000000', align: 'start', uppercase: true,
        pinSides: { left: true, right: true } }),
    L({ name: 'Message', type: 'text', x: textX, y: msgY, w: textW, h: msgSize * 4,
        text: 'Watch for moving vehicles and pedestrians in this area.',
        fontSize: msgSize, fontWeight: 500, fill: '#000000', align: 'start', lineHeight: 1.3,
        pinSides: { left: true, right: true } }),
  ];
}

// Emergency-exit (safe condition) sign: green field, running figure, the word
// EXIT, and a directional arrow.
function makeEmergencyExit(W, H) {
  const green = '#0E7C4E';
  const white = '#FFFFFF';
  const pad = Math.min(W, H) * 0.08;
  const manBox = Math.min(H - pad * 2, W * 0.32);
  const manX = pad;
  const manY = (H - manBox) / 2;
  const arrowW = W * 0.12;
  const arrowH = H * 0.4;
  const arrowX = W - pad - arrowW;
  const arrowY = (H - arrowH) / 2;
  const textX = manX + manBox + W * 0.04;
  const textW = arrowX - textX - W * 0.03;
  const exitSize = Math.min(textW / 4.2, H * 0.42);
  return [
    L({ name: 'Background', type: 'rect', x: 0, y: 0, w: W, h: H, fill: green,
        locked: true, syncCanvas: 'fill' }),
    L({ name: 'Running figure', type: 'image', x: manX, y: manY, w: manBox, h: manBox,
        symbol: 'E002', preserveAspect: true, pinSides: { left: true } }),
    L({ name: 'EXIT', type: 'text', x: textX, y: H / 2 - exitSize * 0.62, w: textW, h: exitSize * 1.25,
        text: 'EXIT', fontSize: exitSize, fontWeight: 900, fill: white,
        align: 'middle', uppercase: true, letterSpacing: 0.04, pinSides: { left: true, right: true } }),
    L({ name: 'Arrow', type: 'polygon', x: arrowX, y: arrowY, w: arrowW, h: arrowH,
        points: [
          { x: 0, y: 0.28 }, { x: 0.5, y: 0.28 }, { x: 0.5, y: 0 },
          { x: 1, y: 0.5 }, { x: 0.5, y: 1 }, { x: 0.5, y: 0.72 }, { x: 0, y: 0.72 },
        ],
        fill: white, pinSides: { right: true } }),
  ];
}

// Inspection record tag: green status header with a PASS pill and a four-field
// grid (equipment / inspected by / date / next due).
function makeInspectionDue(W, H) {
  const green = '#0E7C4E';
  const ink = '#1a1814';
  const padX = W * 0.06;
  const cw = W - padX * 2;
  const headerH = H * 0.22;
  const titleSize = Math.min(cw / 14, 30);
  const colGap = W * 0.05;
  const colW = (cw - colGap) / 2;
  const labelSize = Math.min(cw / 34, 15);
  const row1Y = headerH + H * 0.12;
  const row2Y = row1Y + H * 0.3;
  const pillW = cw * 0.28;
  const fields = [
    ['Equipment', padX, row1Y],
    ['Inspected by', padX + colW + colGap, row1Y],
    ['Inspection date', padX, row2Y],
    ['Next due', padX + colW + colGap, row2Y],
  ];
  const layers = [
    L({ name: 'Background', type: 'rect', x: 0, y: 0, w: W, h: H, fill: '#FFFFFF',
        stroke: ink, strokeWidth: 3, radius: 16, locked: true, syncCanvas: 'fill', strokeOnTop: true }),
    L({ name: 'Header band', type: 'rect', x: 0, y: 0, w: W, h: headerH, fill: green,
        clipToCanvas: true, pinSides: { top: true, left: true, right: true } }),
    L({ name: 'Header title', type: 'text', x: padX, y: headerH / 2 - titleSize * 0.62, w: cw * 0.6, h: titleSize * 1.3,
        text: 'Inspection', fontSize: titleSize, fontWeight: 900, fill: '#FFFFFF',
        align: 'start', uppercase: true, letterSpacing: 0.04, pinSides: { top: true, left: true } }),
    L({ name: 'Status pill', type: 'rect', x: W - padX - pillW, y: headerH / 2 - headerH * 0.18, w: pillW, h: headerH * 0.36,
        fill: '#FFFFFF', radius: 999, pinSides: { top: true, right: true } }),
    L({ name: 'Status text', type: 'text', x: W - padX - pillW, y: headerH / 2 - (headerH * 0.2) / 2, w: pillW, h: headerH * 0.2,
        text: 'PASS', fontSize: Math.min(headerH * 0.22, 22), fontWeight: 900, fill: green,
        align: 'middle', uppercase: true, letterSpacing: 0.06, pinSides: { top: true, right: true } }),
  ];
  for (const [label, fx, fy] of fields) {
    layers.push(L({ name: `${label} label`, type: 'text', x: fx, y: fy, w: colW, h: labelSize * 1.3,
      text: label, fontFamily: 'mono', fontSize: labelSize, fontWeight: 700, fill: green,
      letterSpacing: 0.08, uppercase: true }));
    layers.push(L({ name: `${label} line`, type: 'line', x: fx, y: fy + labelSize * 2.4, w: colW, h: 1,
      stroke: ink, strokeWidth: 1.5 }));
  }
  return layers;
}

// Calibration sticker: blue header with a four-field grid (cal date / due date
// / by / certificate number).
function makeCalibration(W, H) {
  const blue = '#1057A8';
  const ink = '#1a1814';
  const padX = W * 0.07;
  const cw = W - padX * 2;
  const headerH = H * 0.26;
  const titleSize = Math.min(cw / 13, 30);
  const colGap = W * 0.06;
  const colW = (cw - colGap) / 2;
  const labelSize = Math.min(cw / 28, 15);
  const row1Y = headerH + H * 0.14;
  const row2Y = row1Y + H * 0.32;
  const fields = [
    ['Cal date', padX, row1Y],
    ['Due date', padX + colW + colGap, row1Y],
    ['By', padX, row2Y],
    ['Cert no.', padX + colW + colGap, row2Y],
  ];
  const layers = [
    L({ name: 'Background', type: 'rect', x: 0, y: 0, w: W, h: H, fill: '#FFFFFF',
        stroke: ink, strokeWidth: 3, radius: 14, locked: true, syncCanvas: 'fill', strokeOnTop: true }),
    L({ name: 'Header band', type: 'rect', x: 0, y: 0, w: W, h: headerH, fill: blue,
        clipToCanvas: true, pinSides: { top: true, left: true, right: true } }),
    L({ name: 'Header title', type: 'text', x: padX, y: headerH / 2 - titleSize * 0.62, w: cw, h: titleSize * 1.3,
        text: 'Calibration', fontSize: titleSize, fontWeight: 900, fill: '#FFFFFF',
        align: 'middle', uppercase: true, letterSpacing: 0.08, pinSides: { top: true, left: true, right: true } }),
  ];
  for (const [label, fx, fy] of fields) {
    layers.push(L({ name: `${label} label`, type: 'text', x: fx, y: fy, w: colW, h: labelSize * 1.3,
      text: label, fontFamily: 'mono', fontSize: labelSize, fontWeight: 700, fill: blue,
      letterSpacing: 0.08, uppercase: true }));
    layers.push(L({ name: `${label} line`, type: 'line', x: fx, y: fy + labelSize * 2.4, w: colW, h: 1,
      stroke: ink, strokeWidth: 1.5 }));
  }
  return layers;
}

// Package-handling label: HANDLE WITH CARE header, a this-way-up arrow pair, a
// handling-instructions chip, and order / weight fields.
function makeShippingHandling(W, H) {
  const ink = '#111111';
  const amber = '#F36F21';
  const padX = W * 0.07;
  const cw = W - padX * 2;
  const headerH = H * 0.12;
  const headerFont = Math.min(cw / 14, 40);
  const arrowAreaY = headerH + H * 0.06;
  const arrowH = H * 0.26;
  const arrowW = arrowH * 0.62;
  const arrowGap = W * 0.06;
  const arrowsW = arrowW * 2 + arrowGap;
  const a1X = W / 2 - arrowsW / 2;
  const a2X = a1X + arrowW + arrowGap;
  const arrowUp = [
    { x: 0.5, y: 0 }, { x: 1, y: 0.42 }, { x: 0.72, y: 0.42 },
    { x: 0.72, y: 1 }, { x: 0.28, y: 1 }, { x: 0.28, y: 0.42 }, { x: 0, y: 0.42 },
  ];
  const twuY = arrowAreaY + arrowH + H * 0.025;
  const twuSize = Math.min(cw / 14, 30);
  const chipsY = twuY + twuSize * 2.2;
  const chipH = H * 0.09;
  // Sized with margin so the one-line instruction list clears the chip outline
  // even with letter-spacing (which wrapLines doesn't account for).
  const chipFont = Math.min(cw / 20, 24);
  const fieldY = H - H * 0.16;
  const labelSize = Math.min(cw / 30, 15);
  const colGap = W * 0.05;
  const colW = (cw - colGap) / 2;
  return [
    L({ name: 'Background', type: 'rect', x: 0, y: 0, w: W, h: H, fill: '#FFFFFF',
        stroke: ink, strokeWidth: 4, locked: true, syncCanvas: 'fill', strokeOnTop: true }),
    L({ name: 'Header band', type: 'rect', x: 0, y: 0, w: W, h: headerH, fill: ink,
        clipToCanvas: true, pinSides: { top: true, left: true, right: true } }),
    L({ name: 'Header text', type: 'text', x: padX, y: headerH / 2 - headerFont / 2 + headerFont * 0.04, w: cw, h: headerFont * 1.2,
        text: 'Handle With Care', fontSize: headerFont, fontWeight: 900, fill: '#FFFFFF',
        align: 'middle', uppercase: true, letterSpacing: 0.06, pinSides: { top: true, left: true, right: true } }),
    L({ name: 'Arrow up 1', type: 'polygon', x: a1X, y: arrowAreaY, w: arrowW, h: arrowH,
        points: arrowUp, fill: ink }),
    L({ name: 'Arrow up 2', type: 'polygon', x: a2X, y: arrowAreaY, w: arrowW, h: arrowH,
        points: arrowUp, fill: ink }),
    L({ name: 'This way up', type: 'text', x: padX, y: twuY, w: cw, h: twuSize * 1.4,
        text: 'This Way Up', fontSize: twuSize, fontWeight: 900, fill: ink,
        align: 'middle', uppercase: true, letterSpacing: 0.06 }),
    L({ name: 'Handling chip', type: 'rect', x: padX, y: chipsY, w: cw, h: chipH,
        fill: 'none', stroke: amber, strokeWidth: 3, radius: 8, strokeOnTop: true,
        pinSides: { left: true, right: true } }),
    L({ name: 'Handling text', type: 'text', x: padX, y: chipsY + chipH / 2 - chipFont * 0.62, w: cw, h: chipFont * 1.3,
        text: "Fragile · Keep Dry · Don't Stack", fontSize: chipFont, fontWeight: 800, fill: amber,
        align: 'middle', uppercase: true, letterSpacing: 0.03, pinSides: { left: true, right: true } }),
    L({ name: 'Order label', type: 'text', x: padX, y: fieldY, w: colW, h: labelSize * 1.3,
        text: 'Order no.', fontFamily: 'mono', fontSize: labelSize, fontWeight: 700, fill: ink,
        letterSpacing: 0.08, uppercase: true, pinSides: { bottom: true, left: true } }),
    L({ name: 'Order line', type: 'line', x: padX, y: fieldY + labelSize * 2.4, w: colW, h: 1,
        stroke: ink, strokeWidth: 1.5, pinSides: { bottom: true, left: true } }),
    L({ name: 'Weight label', type: 'text', x: padX + colW + colGap, y: fieldY, w: colW, h: labelSize * 1.3,
        text: 'Weight', fontFamily: 'mono', fontSize: labelSize, fontWeight: 700, fill: ink,
        letterSpacing: 0.08, uppercase: true, pinSides: { bottom: true, right: true } }),
    L({ name: 'Weight line', type: 'line', x: padX + colW + colGap, y: fieldY + labelSize * 2.4, w: colW, h: 1,
        stroke: ink, strokeWidth: 1.5, pinSides: { bottom: true, right: true } }),
  ];
}

// Biohazard / infection-control sign: severity header, the biohazard
// pictogram, a restricted-area message, and an infection-control PPE row
// (mask / gloves / wash hands).
function makeBiohazard(W, H, severity) {
  const sev = SEVERITY[severity];
  const headerH = Math.max(64, H * 0.15);
  const signalSize = headerH * 0.56;
  const padX = W * 0.07;
  const contentW = W - padX * 2;
  const pictoBox = Math.min(W * 0.46, H * 0.32);
  const pictoX = W / 2 - pictoBox / 2;
  const pictoY = headerH + H * 0.04;
  const titleSize = Math.min(contentW / 9, 56);
  const titleY = pictoY + pictoBox + H * 0.035;
  const msgSize = Math.min(contentW / 24, 22);
  const msgY = titleY + titleSize * 1.45;
  const count = 3;
  const symbols = ['M016', 'M009', 'M011'];
  const captions = ['Wear a mask', 'Wear gloves', 'Wash hands'];
  const ppeBox = Math.min(W * 0.18, H * 0.13);
  const gap = (contentW - ppeBox * count) / (count + 1);
  const ppeY = H - H * 0.18;
  const capSize = Math.min(ppeBox * 0.2, 14);
  const layers = [
    L({ name: 'Background', type: 'rect', x: 0, y: 0, w: W, h: H,
        fill: '#FFFFFF', stroke: '#000000', strokeWidth: 3,
        locked: true, syncCanvas: 'fill', strokeOnTop: true }),
    L({ name: 'Signal band', type: 'rect', x: 0, y: 0, w: W, h: headerH,
        fill: sev.band, bindSeverity: 'band',
        pinSides: { top: true, left: true, right: true }, clipToCanvas: true }),
    L({ name: 'Signal word', type: 'text',
        x: 0, y: headerH / 2 - signalSize / 2 + signalSize * 0.04, w: W, h: signalSize * 1.2,
        text: sev.word, fontSize: signalSize, fontWeight: 900,
        fill: sev.bandInk, bindSeverity: 'bandInk',
        align: 'middle', uppercase: true, letterSpacing: 0.05,
        pinSides: { top: true, left: true, right: true } }),
    L({ name: 'Pictogram', type: 'image', x: pictoX, y: pictoY, w: pictoBox, h: pictoBox,
        symbol: 'biohazard', preserveAspect: true, pinSides: { top: true } }),
    L({ name: 'Title', type: 'text', x: padX, y: titleY, w: contentW, h: titleSize * 1.3,
        text: 'Biohazard', fontSize: titleSize, fontWeight: 900,
        fill: '#000000', align: 'middle', uppercase: true,
        pinSides: { top: true, left: true, right: true } }),
    L({ name: 'Message', type: 'text', x: padX, y: msgY, w: contentW, h: msgSize * 3,
        text: 'Infection control area. Authorized personnel only.',
        fontSize: msgSize, fontWeight: 500, fill: '#000000', align: 'middle', lineHeight: 1.3,
        pinSides: { top: true, left: true, right: true } }),
  ];
  for (let i = 0; i < count; i++) {
    const cx = padX + gap + i * (ppeBox + gap);
    layers.push(L({ name: `PPE ${i + 1}`, type: 'image', x: cx, y: ppeY, w: ppeBox, h: ppeBox,
      symbol: symbols[i], preserveAspect: true, pinSides: { bottom: true } }));
    layers.push(L({ name: `PPE caption ${i + 1}`, type: 'text', x: cx - gap / 2, y: ppeY + ppeBox + 4,
      w: ppeBox + gap, h: capSize * 1.4, text: captions[i], fontSize: capSize, fontWeight: 600,
      fill: '#000000', align: 'middle', pinSides: { bottom: true } }));
  }
  return layers;
}

// Laser-radiation warning: severity header, a large laser pictogram, exposure
// message, and a class / wavelength / max-output spec block.
function makeLaserRadiation(W, H, severity) {
  const sev = SEVERITY[severity];
  const headerH = Math.max(64, H * 0.15);
  const signalSize = headerH * 0.56;
  const padX = W * 0.07;
  const contentW = W - padX * 2;
  const pictoBox = Math.min(W * 0.44, H * 0.3);
  const pictoX = W / 2 - pictoBox / 2;
  const pictoY = headerH + H * 0.035;
  const titleSize = Math.min(contentW / 10, 48);
  const titleY = pictoY + pictoBox + H * 0.03;
  const msgSize = Math.min(contentW / 24, 22);
  const msgY = titleY + titleSize * 1.4;
  const specY = H - H * 0.2;
  const specSize = Math.min(contentW / 30, 16);
  return [
    L({ name: 'Background', type: 'rect', x: 0, y: 0, w: W, h: H,
        fill: '#FFFFFF', stroke: '#000000', strokeWidth: 3,
        locked: true, syncCanvas: 'fill', strokeOnTop: true }),
    L({ name: 'Signal band', type: 'rect', x: 0, y: 0, w: W, h: headerH,
        fill: sev.band, bindSeverity: 'band',
        pinSides: { top: true, left: true, right: true }, clipToCanvas: true }),
    L({ name: 'Signal word', type: 'text',
        x: 0, y: headerH / 2 - signalSize / 2 + signalSize * 0.04, w: W, h: signalSize * 1.2,
        text: sev.word, fontSize: signalSize, fontWeight: 900,
        fill: sev.bandInk, bindSeverity: 'bandInk',
        align: 'middle', uppercase: true, letterSpacing: 0.05,
        pinSides: { top: true, left: true, right: true } }),
    L({ name: 'Pictogram', type: 'image', x: pictoX, y: pictoY, w: pictoBox, h: pictoBox,
        symbol: 'laser', preserveAspect: true, pinSides: { top: true } }),
    L({ name: 'Title', type: 'text', x: padX, y: titleY, w: contentW, h: titleSize * 1.3,
        text: 'Laser Radiation', fontSize: titleSize, fontWeight: 900,
        fill: '#000000', align: 'middle', uppercase: true,
        pinSides: { top: true, left: true, right: true } }),
    L({ name: 'Message', type: 'text', x: padX, y: msgY, w: contentW, h: msgSize * 4,
        text: 'Avoid eye or skin exposure to direct or scattered radiation.',
        fontSize: msgSize, fontWeight: 500, fill: '#000000', align: 'middle', lineHeight: 1.3,
        pinSides: { top: true, left: true, right: true } }),
    L({ name: 'Spec divider', type: 'line', x: padX, y: specY - H * 0.03, w: contentW, h: 2,
        stroke: '#000000', strokeWidth: 1.5, pinSides: { bottom: true, left: true, right: true } }),
    L({ name: 'Class', type: 'text', x: padX, y: specY, w: contentW, h: specSize * 1.4,
        text: 'CLASS — 3B / 4', fontFamily: 'mono', fontSize: specSize, fontWeight: 700,
        fill: '#000000', align: 'start', letterSpacing: 0.04, uppercase: true,
        pinSides: { bottom: true, left: true, right: true } }),
    L({ name: 'Wavelength', type: 'text', x: padX, y: specY + specSize * 2, w: contentW, h: specSize * 1.4,
        text: 'WAVELENGTH — ___ nm', fontFamily: 'mono', fontSize: specSize, fontWeight: 700,
        fill: '#000000', align: 'start', letterSpacing: 0.04, uppercase: true,
        pinSides: { bottom: true, left: true, right: true } }),
    L({ name: 'Max output', type: 'text', x: padX, y: specY + specSize * 4, w: contentW, h: specSize * 1.4,
        text: 'MAX OUTPUT — ___ mW', fontFamily: 'mono', fontSize: specSize, fontWeight: 700,
        fill: '#000000', align: 'start', letterSpacing: 0.04, uppercase: true,
        pinSides: { bottom: true, left: true, right: true } }),
  ];
}

// Parking / site-access control sign: blue header and footer bands, a parking
// pictogram, and an access ruleset.
function makeSiteAccess(W, H) {
  const blue = '#1057A8';
  const white = '#FFFFFF';
  const ink = '#1a1814';
  const headerH = Math.max(72, H * 0.16);
  const footerH = Math.max(44, H * 0.1);
  const padX = W * 0.07;
  const contentW = W - padX * 2;
  const headerFont = Math.min(contentW / 11, headerH * 0.42);
  const pictoBox = Math.min(W * 0.4, H * 0.26);
  const pictoX = W / 2 - pictoBox / 2;
  const pictoY = headerH + H * 0.05;
  const subY = pictoY + pictoBox + H * 0.03;
  const subSize = Math.min(contentW / 16, 28);
  const rulesY = subY + subSize * 1.8;
  const footerFont = Math.min(contentW / 26, footerH * 0.42);
  return [
    L({ name: 'Background', type: 'rect', x: 0, y: 0, w: W, h: H, fill: white,
        stroke: ink, strokeWidth: 3, locked: true, syncCanvas: 'fill', strokeOnTop: true }),
    L({ name: 'Header band', type: 'rect', x: 0, y: 0, w: W, h: headerH, fill: blue,
        clipToCanvas: true, pinSides: { top: true, left: true, right: true } }),
    L({ name: 'Header text', type: 'text',
        x: padX, y: headerH / 2 - headerFont / 2 + headerFont * 0.04, w: contentW, h: headerFont * 1.2,
        text: 'Site Access', fontSize: headerFont, fontWeight: 900, fill: white,
        align: 'middle', uppercase: true, letterSpacing: 0.06, pinSides: { top: true, left: true, right: true } }),
    L({ name: 'Pictogram', type: 'image', x: pictoX, y: pictoY, w: pictoBox, h: pictoBox,
        symbol: 'TF014', preserveAspect: true, pinSides: { top: true } }),
    L({ name: 'Subtitle', type: 'text', x: padX, y: subY, w: contentW, h: subSize * 1.4,
        text: 'Authorised access only', fontSize: subSize, fontWeight: 700,
        fill: ink, align: 'middle', uppercase: true, letterSpacing: 0.02,
        pinSides: { top: true, left: true, right: true } }),
    L({ name: 'Rules', type: 'bullets', x: padX, y: rulesY, w: contentW, h: H * 0.22,
        items: [
          { id: uid(), text: 'Report to the site office on arrival.' },
          { id: uid(), text: 'Permit holders only beyond this point.' },
          { id: uid(), text: 'Hi-vis clothing required on site.' },
          { id: uid(), text: 'Observe the 5 mph speed limit.' },
        ],
        fontSize: Math.min(contentW / 26, 19), fontWeight: 500, fill: ink, lineHeight: 1.45,
        pinSides: { top: true, left: true, right: true } }),
    L({ name: 'Footer band', type: 'rect', x: 0, y: H - footerH, w: W, h: footerH, fill: blue,
        clipToCanvas: true, pinSides: { bottom: true, left: true, right: true } }),
    L({ name: 'Footer text', type: 'text',
        x: padX, y: H - footerH / 2 - footerFont / 2 + footerFont * 0.04, w: contentW, h: footerFont * 1.2,
        text: 'All visitors must sign in', fontSize: footerFont, fontWeight: 700, fill: white,
        align: 'middle', uppercase: true, letterSpacing: 0.05, pinSides: { bottom: true, left: true, right: true } }),
  ];
}

const PRESETS = {
  'ansi-header': makeAnsiHeader,
  'ansi-side':   makeAnsiSide,
  'banner':      makeBanner,
  'plate':       makePlate,
  'stop':        makeStop,
  'tag':         makeTag,
  'strip':       makeStrip,
  'ghs-label':   makeGhsLabel,
  'ppe':         makePpe,
  'fire-point':  makeFirePoint,
  'first-aid':   makeFirstAid,
  'prohibition': makeProhibition,
  'electrical-panel': makeElectricalPanel,
  'confined-space':   makeConfinedSpace,
  'forklift-traffic': makeForkliftTraffic,
  'emergency-exit':   makeEmergencyExit,
  'biohazard':        makeBiohazard,
  'laser-radiation':  makeLaserRadiation,
  'site-access':      makeSiteAccess,
  'barcode-label':  makeBarcodeLabel,
  'asset-tag':      makeAssetTag,
  'shipping-label': makeShippingLabel,
  'shipping-handling': makeShippingHandling,
  'inspection-due': makeInspectionDue,
  'calibration':    makeCalibration,
  'blank':       makeBlank,
};

// ----------- New-layer prototypes (for the +Add menu) -----------
function newLayer(type, W, H) {
  const cx = W / 2, cy = H / 2;
  switch (type) {
    case 'text':
      return L({ name: 'Text', type: 'text', x: cx - 120, y: cy - 20, w: 240, h: 40,
        text: 'Text', fontSize: 32, fontWeight: 700, fill: '#000000', align: 'middle' });
    case 'rect':
      return L({ name: 'Rectangle', type: 'rect', x: cx - 80, y: cy - 60, w: 160, h: 120,
        fill: '#1057A8' });
    case 'image':
      return L({ name: 'Symbol', type: 'image', x: cx - 80, y: cy - 80, w: 160, h: 160,
        symbol: 'exclamation' });
    case 'bullets':
      return L({ name: 'List', type: 'bullets', x: cx - 140, y: cy - 40, w: 280, h: 80,
        items: [{ id: uid(), text: 'First item' }, { id: uid(), text: 'Second item' }],
        fontSize: 16, fill: '#000000' });
    case 'line':
      return L({ name: 'Line', type: 'line', x: cx - 100, y: cy, w: 200, h: 1,
        stroke: '#000000', strokeWidth: 2 });
    case 'ellipse':
      return L({ name: 'Circle', type: 'ellipse', x: cx - 80, y: cy - 80, w: 160, h: 160,
        fill: '#1057A8' });
    case 'barcode':
      return L({ name: 'Barcode', type: 'barcode', variant: 'code128',
        x: cx - 150, y: cy - 50, w: 300, h: 100,
        data: '012345678905', fill: '#000000', background: '#FFFFFF',
        showText: true, quietZone: 10, density: 3 });
    case 'star':
      return L({ name: 'Star', type: 'polygon', shape: 'star', sides: 5, inner: 0.42,
        x: cx - 80, y: cy - 80, w: 160, h: 160,
        points: starPoints(5, 0.42), fill: '#1057A8' });
    case 'triangle':
    case 'diamond':
    case 'pentagon':
    case 'hexagon':
      return L({ name: type.charAt(0).toUpperCase() + type.slice(1), type: 'polygon', shape: type,
        x: cx - 80, y: cy - 80, w: 160, h: 160,
        points: SHAPE_POINTS[type].map(p => ({ x: p.x, y: p.y })), fill: '#1057A8' });
    default: return null;
  }
}

// ----------- Label component -----------
// Renders all layers and attaches per-layer mousedown handlers so the parent
// can drive selection + drag.

// Black geometry for a hole layer, painted into the knockout <mask> (white shows,
// black cuts). Only the area shapes punch — rect (honors radius/chamfer), ellipse
// and polygon. Rotation is matched to the on-canvas render.
function holeMaskNode(l) {
  const t = l.rotation ? `rotate(${l.rotation} ${l.x + l.w / 2} ${l.y + l.h / 2})` : undefined;
  if (l.type === 'rect') return <path key={l.id} d={rectPath(l.x, l.y, l.w, l.h, l.radius, 0, l.corner)} fill="black" transform={t} />;
  if (l.type === 'ellipse') return <ellipse key={l.id} cx={l.x + l.w / 2} cy={l.y + l.h / 2} rx={l.w / 2} ry={l.h / 2} fill="black" transform={t} />;
  if (l.type === 'polygon') {
    const pts = (l.points || []).map(p => `${l.x + p.x * l.w},${l.y + p.y * l.h}`).join(' ');
    return <polygon key={l.id} points={pts} fill="black" transform={t} />;
  }
  return null;
}

const Label = memo(forwardRef(function Label({ design, symbolsReady, onLayerPointerDown, onCanvasPointerDown, onLayerContextMenu }, ref) {
  const svgRef = useRef(null);
  useImperativeHandle(ref, () => ({ getSvg: () => svgRef.current }));

  const sev = SEVERITY[design.severity] || SEVERITY.danger;

  // Build a clipPath from the canvas-fill background's shape. Any layer with
  // `clipToCanvas: true` is rendered through this clip, so it automatically
  // inherits the bg's rounded corners and stays inside the canvas outline.
  const bg = design.layers.find(l => l.syncCanvas === 'fill');
  const canvasClipId = 'canvas-clip';
  const canvasClipD = bg
    ? rectPath(0, 0, design.width, design.height, bg.radius, 0, bg.corner)
    : null;

  // Layers flagged `hole` knock a transparent cutout through the whole label via
  // a luminance mask. The white field is oversized so off-canvas content still
  // shows; the black hole shapes are the only thing removed.
  const holes = design.layers.filter(l => l.hole && !l.hidden);
  const holeMaskId = 'hole-mask';
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
                  transform={l.rotation
                    ? `rotate(${l.rotation} ${l.x + l.w / 2} ${l.y + l.h / 2})`
                    : undefined}
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
            d={rectStrokeRingPath(l, l.strokeWidth)}
            fill={resolveFill(l.stroke || 'none', l.bindSeverity, sev)}
            fillRule="evenodd"
            clipPath={(l.clipToCanvas && canvasClipD) ? `url(#${canvasClipId})` : undefined}
            style={{ pointerEvents: 'none', mixBlendMode: l.blend || undefined, opacity: l.opacity == null ? undefined : l.opacity }}
            transform={l.rotation
              ? `rotate(${l.rotation} ${l.x + l.w / 2} ${l.y + l.h / 2})`
              : undefined}
          />
        ))}
      </g>
    </svg>
  );
}));

export { SEVERITY, FORMATS, PRESETS, newLayer, starPoints, Label };
