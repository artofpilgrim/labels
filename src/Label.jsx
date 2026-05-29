// Layer-based label renderer.
import { forwardRef, useImperativeHandle, useRef } from 'react';
import { uid } from './uid.js';
import { pictoHref } from './symbols.js';

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
  return { id: uid(), rotation: 0, hidden: false, locked: false, ...props };
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
function rectPath(x, y, w, h, radius, strokeWidth) {
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

  return [
    `M ${xx + tl} ${yy}`,
    `H ${xx + ww - tr}`,
    tr > 0 ? `A ${tr} ${tr} 0 0 1 ${xx + ww} ${yy + tr}` : '',
    `V ${yy + hh - br}`,
    br > 0 ? `A ${br} ${br} 0 0 1 ${xx + ww - br} ${yy + hh}` : '',
    `H ${xx + bl}`,
    bl > 0 ? `A ${bl} ${bl} 0 0 1 ${xx} ${yy + hh - bl}` : '',
    `V ${yy + tl}`,
    tl > 0 ? `A ${tl} ${tl} 0 0 1 ${xx + tl} ${yy}` : '',
    'Z',
  ].filter(Boolean).join(' ');
}

// ----------- Layer renderer -----------
function renderLayer(l, sev) {
  if (l.hidden) return null;
  const transform = l.rotation
    ? `rotate(${l.rotation} ${l.x + l.w / 2} ${l.y + l.h / 2})`
    : undefined;

  switch (l.type) {
    case 'rect': {
      const sw = l.strokeWidth || 0;
      const drawStrokeHere = sw > 0 && !l.strokeOnTop;
      // When strokeOnTop is set, the stroke is drawn later in a second pass.
      // Render the FILL on the full-bounds path (sw=0) so it reaches the
      // layer's outer edge — the second-pass stroke then sits centered on
      // the inset path, with its outer half covering the layer boundary.
      // Without this, a strokeWidth/2 transparent gutter would appear
      // around the fill until the stroke painted over it.
      const fillPath = l.strokeOnTop
        ? rectPath(l.x, l.y, l.w, l.h, l.radius, 0)
        : rectPath(l.x, l.y, l.w, l.h, l.radius, sw);
      return (
        <g transform={transform}>
          <path
            d={fillPath}
            fill={resolveFill(l.fill, l.bindSeverity, sev)}
            stroke={drawStrokeHere ? (l.stroke || 'none') : 'none'}
            strokeWidth={drawStrokeHere ? sw : 0}
          />
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
      const href = pictoHref(l.symbol);
      if (!href) return null;
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
  const wordSize = H * 0.55;
  return [
    L({ name: 'Background', type: 'rect', x: 0, y: 0, w: W, h: H,
        fill: sev.band, bindSeverity: 'band',
        locked: true, syncCanvas: 'fill' }),
    L({ name: 'Center band', type: 'rect', x: 0, y: H * 0.22, w: W, h: H * 0.56, fill: '#FFFFFF',
        pinSides: { top: true, left: true, right: true, bottom: true } }),
    L({ name: 'Signal word', type: 'text',
        x: 0, y: H / 2 - wordSize / 2 + wordSize * 0.04,
        w: W, h: wordSize * 1.2,
        text: sev.word, fontSize: wordSize, fontWeight: 900,
        fill: '#000000', align: 'middle', uppercase: true, letterSpacing: 0.08,
        pinSides: { top: true, left: true, right: true, bottom: true } }),
  ];
}

function makeBlank(W, H) {
  return [
    L({ name: 'Background', type: 'rect', x: 0, y: 0, w: W, h: H, fill: '#FFFFFF', locked: true, syncCanvas: 'fill' }),
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
    default: return null;
  }
}

// ----------- Label component -----------
// Renders all layers and attaches per-layer mousedown handlers so the parent
// can drive selection + drag.
const Label = forwardRef(function Label({ design, selectedId, onLayerPointerDown, onCanvasPointerDown }, ref) {
  const svgRef = useRef(null);
  useImperativeHandle(ref, () => ({ getSvg: () => svgRef.current }));

  const sev = SEVERITY[design.severity] || SEVERITY.danger;

  // Build a clipPath from the canvas-fill background's shape. Any layer with
  // `clipToCanvas: true` is rendered through this clip, so it automatically
  // inherits the bg's rounded corners and stays inside the canvas outline.
  const bg = design.layers.find(l => l.syncCanvas === 'fill');
  const canvasClipId = 'canvas-clip';
  const canvasClipD = bg
    ? rectPath(0, 0, design.width, design.height, bg.radius, 0)
    : null;

  return (
    <svg
      ref={svgRef}
      xmlns="http://www.w3.org/2000/svg"
      xmlnsXlink="http://www.w3.org/1999/xlink"
      viewBox={`0 0 ${design.width} ${design.height}`}
      width={design.width}
      height={design.height}
      style={{ display: 'block' }}
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
      {design.layers.map(l => {
        const node = renderLayer(l, sev);
        if (!node) return null;
        const interactive = !l.locked && !l.hidden;
        const clip = (l.clipToCanvas && canvasClipD) ? `url(#${canvasClipId})` : undefined;
        return (
          <g
            key={l.id}
            style={{ cursor: interactive ? 'move' : 'default', pointerEvents: l.hidden ? 'none' : 'auto' }}
            clipPath={clip}
            onMouseDown={(e) => onLayerPointerDown && onLayerPointerDown(l.id, e)}
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
            d={rectPath(l.x, l.y, l.w, l.h, l.radius, l.strokeWidth)}
            fill="none"
            stroke={resolveFill(l.stroke || 'none', l.bindSeverity, sev)}
            strokeWidth={l.strokeWidth}
            clipPath={(l.clipToCanvas && canvasClipD) ? `url(#${canvasClipId})` : undefined}
            style={{ pointerEvents: 'none' }}
            transform={l.rotation
              ? `rotate(${l.rotation} ${l.x + l.w / 2} ${l.y + l.h / 2})`
              : undefined}
          />
        ))}
    </svg>
  );
});

export { SEVERITY, FONTS, FORMATS, PRESETS, newLayer, Label };
