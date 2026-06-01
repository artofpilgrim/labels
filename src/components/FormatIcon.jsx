// ----------- Format icon -----------
// Shared outline frame for the 48×36 thumbnails — constant geometry (w-4 / h-4
// on the fixed tile, themed ink), so a single element used in place of re-typing
// the rect across most cases. Module scope keeps it from being re-created per render.
const FRAME = <rect x="2" y="2" width="44" height="32" fill="none" stroke="var(--ink)" strokeWidth="1.2" />;

function FormatIcon({ id, active }) {
  const w = 48, h = 36;
  // Tile outlines/marks track the theme so thumbnails stay legible on dark tiles.
  // inkOnLight stays fixed-dark for marks that sit on a baked-light inner shape
  // (the plate, the GHS white diamond), which don't invert with the theme.
  const ink = 'var(--ink)';
  const inkOnLight = '#1a1814';
  const accent = active ? '#C8102E' : '#bdb398';
  switch (id) {
    case 'ansi-header':
      return (<svg viewBox={`0 0 ${w} ${h}`} width={w} height={h}>
        {FRAME}
        <rect x="2" y="2" width={w - 4} height="10" fill={accent} />
      </svg>);
    case 'ansi-side':
      return (<svg viewBox={`0 0 ${w} ${h}`} width={w} height={h}>
        {FRAME}
        <rect x="2" y="2" width="12" height={h - 4} fill={accent} />
      </svg>);
    case 'banner':
      return (<svg viewBox="0 0 36 48" width={w} height={h}>
        <rect x="2" y="2" width="32" height="44" fill="none" stroke={ink} strokeWidth="1.2" />
        <rect x="2" y="2" width="32" height="8" fill={accent} />
        <line x1="8" y1="22" x2="28" y2="22" stroke={ink} strokeWidth="0.8" />
        <line x1="8" y1="28" x2="28" y2="28" stroke={ink} strokeWidth="0.8" />
        <line x1="8" y1="34" x2="22" y2="34" stroke={ink} strokeWidth="0.8" />
      </svg>);
    case 'plate':
      return (<svg viewBox={`0 0 ${w} ${h}`} width={w} height={h}>
        <path d={`M${w / 2} 4 L${w - 4} ${h - 4} L4 ${h - 4} Z`}
              fill={active ? '#F9A800' : '#e6dcc0'} stroke={inkOnLight} strokeWidth="1.6" strokeLinejoin="round" />
        <rect x={w / 2 - 1} y={h / 2 - 5} width="2" height="7" fill={inkOnLight} />
        <circle cx={w / 2} cy={h / 2 + 5} r="1.2" fill={inkOnLight} />
      </svg>);
    case 'stop':
      return (<svg viewBox={`0 0 ${w} ${h}`} width={w} height={h}>
        {(() => {
          const s = h - 4, off = s * 0.293, x0 = w / 2 - s / 2, y0 = 2;
          const pts = [
            [x0 + off, y0], [x0 + s - off, y0], [x0 + s, y0 + off],
            [x0 + s, y0 + s - off], [x0 + s - off, y0 + s], [x0 + off, y0 + s],
            [x0, y0 + s - off], [x0, y0 + off],
          ].map(p => p.join(',')).join(' ');
          return <polygon points={pts} fill={active ? '#C8102E' : '#d8c2bc'} />;
        })()}
      </svg>);
    case 'tag':
      return (<svg viewBox="0 0 28 48" width={w} height={h}>
        <rect x="2" y="2" width="24" height="44" fill="none" stroke={ink} strokeWidth="1.2" />
        <circle cx="14" cy="8" r="2.5" fill="none" stroke={ink} strokeWidth="1.2" />
        <rect x="4" y="14" width="20" height="6" fill={accent} />
      </svg>);
    case 'strip':
      return (<svg viewBox={`0 0 ${w} ${h}`} width={w} height={h}>
        <defs>
          <pattern id={`fi-pat-${active ? 'a' : 'b'}`} width="6" height="6"
                   patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="3" height="6" fill={ink} />
            <rect x="3" width="3" height="6" fill={accent} />
          </pattern>
        </defs>
        <rect x="2" y={h / 2 - 8} width={w - 4} height="16" fill={`url(#fi-pat-${active ? 'a' : 'b'})`} />
      </svg>);
    case 'ghs-label':
      return (<svg viewBox={`0 0 ${w} ${h}`} width={w} height={h}>
        <rect x={w / 2 - 10} y={h / 2 - 10} width="20" height="20" transform={`rotate(45 ${w / 2} ${h / 2})`}
              fill="#fff" stroke={active ? '#C8102E' : inkOnLight} strokeWidth="2.4" strokeLinejoin="round" />
        <rect x={w / 2 - 1} y={h / 2 - 6} width="2" height="6" fill={inkOnLight} />
        <circle cx={w / 2} cy={h / 2 + 5} r="1.2" fill={inkOnLight} />
      </svg>);
    case 'ppe':
      return (<svg viewBox={`0 0 ${w} ${h}`} width={w} height={h}>
        {FRAME}
        <circle cx={w / 2} cy={h / 2 + 1} r="10" fill={active ? '#1057A8' : '#bdb398'} />
        <circle cx={w / 2} cy={h / 2 - 3} r="2.8" fill="#fff" />
        <path d={`M${w / 2 - 4.5} ${h / 2 + 6} a4.5 4.5 0 0 1 9 0 z`} fill="#fff" />
      </svg>);
    case 'fire-point':
      return (<svg viewBox={`0 0 ${w} ${h}`} width={w} height={h}>
        <rect x="2" y="2" width={w - 4} height={h - 4} fill={active ? '#9B2423' : '#d8c2bc'} />
        <rect x={w / 2 - 3.5} y={h / 2 - 7} width="7" height="13" rx="2" fill="#fff" />
        <rect x={w / 2 - 0.8} y={h / 2 - 10} width="1.6" height="4" fill="#fff" />
        <rect x={w / 2 + 1} y={h / 2 - 9.5} width="4" height="1.6" fill="#fff" />
      </svg>);
    case 'first-aid':
      return (<svg viewBox={`0 0 ${w} ${h}`} width={w} height={h}>
        <rect x="2" y="2" width={w - 4} height={h - 4} fill={active ? '#237F52' : '#bcd8c8'} />
        <rect x={w / 2 - 2.5} y={h / 2 - 8} width="5" height="16" fill="#fff" />
        <rect x={w / 2 - 8} y={h / 2 - 2.5} width="16" height="5" fill="#fff" />
      </svg>);
    case 'prohibition':
      return (<svg viewBox={`0 0 ${w} ${h}`} width={w} height={h}>
        {FRAME}
        <circle cx={w / 2} cy={h / 2} r="10" fill="none" stroke={active ? '#C8102E' : '#bdb398'} strokeWidth="2.6" />
        <line x1={w / 2 - 7.1} y1={h / 2 - 7.1} x2={w / 2 + 7.1} y2={h / 2 + 7.1} stroke={active ? '#C8102E' : '#bdb398'} strokeWidth="2.6" />
      </svg>);
    case 'barcode-label':
      return (<svg viewBox={`0 0 ${w} ${h}`} width={w} height={h}>
        {FRAME}
        {[7, 10, 12, 16, 19, 23, 26, 30, 33, 37, 40].map((x, i) => (
          <rect key={i} x={x} y="9" width={i % 3 === 0 ? 2 : 1} height="14" fill={ink} />))}
        <rect x={w / 2 - 7} y="27" width="14" height="3" fill={accent} />
      </svg>);
    case 'asset-tag':
      return (<svg viewBox={`0 0 ${w} ${h}`} width={w} height={h}>
        <rect x="3" y="4" width={w - 6} height={h - 8} rx="3" fill="none" stroke={ink} strokeWidth="1.2" />
        <rect x="4" y="5" width={w - 8} height="7" rx="2" fill={ink} />
        {[9, 12, 14, 18, 21, 25, 28, 32, 35].map((x, i) => (
          <rect key={i} x={x} y="17" width={i % 2 === 0 ? 2 : 1} height="11" fill={ink} />))}
        <rect x="11" y="31" width={w - 22} height="2.5" fill={accent} />
      </svg>);
    case 'shipping-label':
      return (<svg viewBox="0 0 36 48" width={w} height={h}>
        <rect x="2" y="2" width="32" height="44" fill="none" stroke={ink} strokeWidth="1.2" />
        <line x1="6" y1="9" x2="19" y2="9" stroke={ink} strokeWidth="0.8" />
        <line x1="6" y1="12.5" x2="15" y2="12.5" stroke={ink} strokeWidth="0.8" />
        <line x1="2" y1="18" x2="34" y2="18" stroke={ink} strokeWidth="1" />
        <line x1="6" y1="24" x2="28" y2="24" stroke={ink} strokeWidth="1.6" />
        <line x1="6" y1="29" x2="23" y2="29" stroke={ink} strokeWidth="1.6" />
        {[6, 9, 11, 14, 17, 20, 23, 26, 29].map((x, i) => (
          <rect key={i} x={x} y="38" width={i % 2 === 0 ? 1.6 : 1} height="6" fill={ink} />))}
      </svg>);
    case 'blank':
      return (<svg viewBox={`0 0 ${w} ${h}`} width={w} height={h}>
        <rect x="2" y="2" width={w - 4} height={h - 4} fill="none" stroke={ink} strokeDasharray="3 3" strokeWidth="1.2" />
      </svg>);
    case 'electrical-panel':
      return (<svg viewBox={`0 0 ${w} ${h}`} width={w} height={h}>
        {FRAME}
        <rect x="2" y="2" width={w - 4} height="9" fill={accent} />
        <path d="M26 14 L19 25 L23.5 25 L21 33 L31 21 L25.5 21 Z" fill={ink} />
      </svg>);
    case 'confined-space':
      return (<svg viewBox={`0 0 ${w} ${h}`} width={w} height={h}>
        {FRAME}
        <rect x="2" y="2" width={w - 4} height="9" fill={accent} />
        <path d={`M${w / 2} 14 L${w / 2 + 8} 30 L${w / 2 - 8} 30 Z`} fill="none" stroke={ink} strokeWidth="1.6" strokeLinejoin="round" />
        <rect x={w / 2 - 0.8} y="20" width="1.6" height="5" fill={ink} />
        <circle cx={w / 2} cy="28" r="1" fill={ink} />
      </svg>);
    case 'forklift-traffic':
      return (<svg viewBox={`0 0 ${w} ${h}`} width={w} height={h}>
        {FRAME}
        <rect x="2" y="2" width={w - 4} height="9" fill={active ? '#F36F21' : '#bdb398'} />
        <path d="M16 27 v-7 h6 l3 5 v2 z" fill={ink} />
        <rect x="29" y="14" width="1.8" height="13" fill={ink} />
        <path d="M30.8 25.5 h6" fill="none" stroke={ink} strokeWidth="1.4" />
        <circle cx="19" cy="29" r="2" fill={ink} />
        <circle cx="26" cy="29" r="2" fill={ink} />
      </svg>);
    case 'emergency-exit':
      return (<svg viewBox={`0 0 ${w} ${h}`} width={w} height={h}>
        <rect x="2" y="2" width={w - 4} height={h - 4} fill={active ? '#0E7C4E' : '#bcd8c8'} />
        <circle cx="15" cy="12" r="2.4" fill="#fff" />
        <path d="M12 27 l3 -9 4 2 3 5 -2 1 -2.5 -3 -1 7 z" fill="#fff" />
        <path d="M29 18 h7 v-3 l5 5 -5 5 v-3 h-7 z" fill="#fff" />
      </svg>);
    case 'shipping-handling':
      return (<svg viewBox="0 0 36 48" width={w} height={h}>
        <rect x="2" y="2" width="32" height="44" fill="none" stroke={ink} strokeWidth="1.2" />
        <rect x="2" y="2" width="32" height="8" fill={ink} />
        <path d="M13 31 v-9 h-3 l4.5 -6 4.5 6 h-3 v9 z" fill={ink} />
        <path d="M22 31 v-9 h-3 l4.5 -6 4.5 6 h-3 v9 z" fill={ink} />
        <rect x="7" y="37" width="22" height="5" rx="1.5" fill="none" stroke={active ? '#F36F21' : '#bdb398'} strokeWidth="1.4" />
      </svg>);
    case 'inspection-due':
      return (<svg viewBox={`0 0 ${w} ${h}`} width={w} height={h}>
        <rect x="3" y="4" width={w - 6} height={h - 8} rx="3" fill="none" stroke={ink} strokeWidth="1.2" />
        <rect x="4" y="5" width={w - 8} height="8" rx="2" fill={active ? '#0E7C4E' : '#bcd8c8'} />
        <path d="M18 25 l4 4 8 -10" fill="none" stroke={active ? '#0E7C4E' : '#9bbfa9'} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>);
    case 'calibration':
      return (<svg viewBox={`0 0 ${w} ${h}`} width={w} height={h}>
        <rect x="3" y="4" width={w - 6} height={h - 8} rx="3" fill="none" stroke={ink} strokeWidth="1.2" />
        <rect x="4" y="5" width={w - 8} height="8" rx="2" fill={active ? '#1057A8' : '#bdb398'} />
        <path d="M16 30 a8 8 0 0 1 16 0" fill="none" stroke={ink} strokeWidth="1.4" />
        <path d="M24 30 l5 -6" fill="none" stroke={active ? '#C8102E' : ink} strokeWidth="1.4" strokeLinecap="round" />
        <circle cx="24" cy="30" r="1.5" fill={ink} />
      </svg>);
    case 'biohazard':
      return (<svg viewBox={`0 0 ${w} ${h}`} width={w} height={h}>
        {FRAME}
        <rect x="2" y="2" width={w - 4} height="9" fill={accent} />
        <circle cx={w / 2} cy="19" r="3.6" fill="none" stroke={ink} strokeWidth="1.5" />
        <circle cx={w / 2 - 4.6} cy="27" r="3.6" fill="none" stroke={ink} strokeWidth="1.5" />
        <circle cx={w / 2 + 4.6} cy="27" r="3.6" fill="none" stroke={ink} strokeWidth="1.5" />
        <circle cx={w / 2} cy="24.5" r="1.6" fill={ink} />
      </svg>);
    case 'laser-radiation':
      return (<svg viewBox={`0 0 ${w} ${h}`} width={w} height={h}>
        {FRAME}
        <rect x="2" y="2" width={w - 4} height="9" fill={accent} />
        <path d="M19 24 H38 M19 24 L35 17 M19 24 L35 31 M19 24 L31 14 M19 24 L31 34"
              fill="none" stroke={ink} strokeWidth="1.1" />
        <circle cx="18" cy="24" r="2.2" fill={ink} />
      </svg>);
    case 'site-access':
      return (<svg viewBox={`0 0 ${w} ${h}`} width={w} height={h}>
        {FRAME}
        <rect x="2" y="2" width={w - 4} height="9" fill={active ? '#1057A8' : '#bdb398'} />
        <rect x={w / 2 - 8} y="15" width="16" height="17" rx="2.5" fill={active ? '#1057A8' : '#bdb398'} />
        <path d="M21 29 V18 H25.5 a3.2 3.2 0 0 1 0 6.4 H21" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinejoin="round" />
      </svg>);
    default:
      return <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} />;
  }
}

export { FormatIcon };
