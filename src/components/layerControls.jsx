import { Seg, Slider } from './ui.jsx';
import { useConfirm } from './confirm.jsx';

// Four-edge toggle for layer anchors. Visualized as a small rectangle with
// a clickable dash on each side; an active edge gets a solid bar.
function PinSidesControl({ value, onChange }) {
  const v = value || {};
  function toggle(side) {
    const next = { ...v, [side]: !v[side] };
    // Center and edge pins on the same axis are mutually exclusive: a layer
    // either tracks the centre OR keeps an edge offset, not both. Clear the
    // conflicting pins so the UI can never express an ambiguous constraint.
    if (next[side]) {
      if (side === 'centerX') { next.left = false; next.right = false; }
      else if (side === 'left' || side === 'right') next.centerX = false;
      else if (side === 'centerY') { next.top = false; next.bottom = false; }
      else if (side === 'top' || side === 'bottom') next.centerY = false;
    }
    // Strip empty so the layer doesn't carry meaningless { } around.
    const any = next.top || next.right || next.bottom || next.left || next.centerX || next.centerY;
    onChange(any ? next : null);
  }
  const sides = [
    { id: 'top',     label: 'Top' },
    { id: 'right',   label: 'Right' },
    { id: 'bottom',  label: 'Bottom' },
    { id: 'left',    label: 'Left' },
    { id: 'centerX', label: 'Center ↔' },
    { id: 'centerY', label: 'Center ↕' },
  ];
  return (
    <div className="pin-control">
      {/* Decorative: every toggle here is also keyboard/AT-accessible via the
          real checkboxes in .pin-checks below, so hide the tiny diagram targets
          from assistive tech rather than duplicate them. */}
      <div className="pin-diagram" aria-hidden="true">
        <div className={`pin-edge pin-top ${v.top ? 'on' : ''}`}
             onClick={() => toggle('top')} title="Pin top" />
        <div className={`pin-edge pin-right ${v.right ? 'on' : ''}`}
             onClick={() => toggle('right')} title="Pin right" />
        <div className={`pin-edge pin-bottom ${v.bottom ? 'on' : ''}`}
             onClick={() => toggle('bottom')} title="Pin bottom" />
        <div className={`pin-edge pin-left ${v.left ? 'on' : ''}`}
             onClick={() => toggle('left')} title="Pin left" />
        <div className="pin-center" />
        <div className={`pin-cline pin-cx ${v.centerX ? 'on' : ''}`}
             onClick={() => toggle('centerX')} title="Center horizontally" />
        <div className={`pin-cline pin-cy ${v.centerY ? 'on' : ''}`}
             onClick={() => toggle('centerY')} title="Center vertically" />
      </div>
      <div className="pin-checks">
        {sides.map(s => (
          <label key={s.id} className="pin-check">
            <input type="checkbox" checked={!!v[s.id]} onChange={() => toggle(s.id)} />
            {s.label}
          </label>
        ))}
      </div>
    </div>
  );
}

// Editor for a rect's per-corner radius. The stored value is either a number
// (uniform) or { tl, tr, br, bl }; the toggle flips between the two.
// Compact per-corner style toggle: shows a box with that corner rounded or
// chamfered (oriented to the corner) and flips between the two on click.
function CornerStyleBtn({ corner, style, onToggle }) {
  const chamfer = style === 'chamfer';
  // Rotate a top-left glyph to the target corner: tl 0°, tr 90°, br 180°, bl 270°.
  const rot = { tl: 0, tr: 90, br: 180, bl: 270 }[corner] || 0;
  const d = chamfer ? 'M3 13 V7 L7 3 H13 V13 Z' : 'M3 13 V7 A4 4 0 0 1 7 3 H13 V13 Z';
  return (
    <button type="button" className="corner-style-btn"
            title={`${corner.toUpperCase()}: ${chamfer ? 'chamfer' : 'round'} — click to toggle`}
            aria-label={`${corner.toUpperCase()} corner: ${chamfer ? 'chamfer' : 'round'}`}
            onClick={onToggle}>
      <svg width="16" height="16" viewBox="0 0 16 16">
        <path d={d} fill="none" stroke="currentColor" strokeWidth="1.4"
              strokeLinejoin="round" transform={`rotate(${rot} 8 8)`} />
      </svg>
    </button>
  );
}

function CornerRadius({ value, onChange, max, corner, onCorner }) {
  const confirm = useConfirm();
  const linked = typeof value === 'number' || value == null;
  const cap = Math.max(0, max);
  const v = linked
    ? { tl: value || 0, tr: value || 0, br: value || 0, bl: value || 0 }
    : { tl: value.tl || 0, tr: value.tr || 0, br: value.br || 0, bl: value.bl || 0 };

  const norm = (x) => (x === 'chamfer' ? 'chamfer' : 'round');
  const styleOf = (k) => norm(corner && typeof corner === 'object' ? corner[k] : corner);

  function setCorner(k, n) {
    onChange({ ...v, [k]: Math.max(0, n) });
  }
  // Set one corner's style, collapsing back to a single string (or null for the
  // all-round default) when every corner ends up the same.
  function setStyle(k, style) {
    if (!onCorner) return;
    const cur = corner && typeof corner === 'object'
      ? { ...corner } : { tl: corner, tr: corner, br: corner, bl: corner };
    cur[k] = style;
    const s = { tl: norm(cur.tl), tr: norm(cur.tr), br: norm(cur.br), bl: norm(cur.bl) };
    const allSame = s.tl === s.tr && s.tr === s.br && s.br === s.bl;
    onCorner(allSame ? (s.tl === 'chamfer' ? 'chamfer' : null) : s);
  }
  async function toggleLink() {
    if (linked) {
      onChange({ ...v });                       // split sizes
    } else {
      const allSame = v.tl === v.tr && v.tr === v.br && v.br === v.bl;
      if (!allSame) {
        const ok = await confirm({
          title: 'Link corners?',
          message: 'All four corners will be reset to the top-left value.',
          confirmLabel: 'Link',
        });
        if (!ok) return;
      }
      onChange(Math.round(v.tl));               // collapse size to top-left
      if (onCorner) onCorner(styleOf('tl') === 'chamfer' ? 'chamfer' : null); // collapse style too
    }
  }

  return (
    <div className="corner-radius">
      {linked ? (
        <>
          {onCorner && (
            <Seg
              value={styleOf('tl')}
              onChange={c => onCorner(c === 'chamfer' ? 'chamfer' : null)}
              options={[{ value: 'round', label: 'Round' }, { value: 'chamfer', label: 'Chamfer' }]}
            />
          )}
          <Slider label="All" value={v.tl} onChange={n => onChange(n)} max={cap} />
        </>
      ) : (
        ['tl', 'tr', 'bl', 'br'].map(k => (
          <div className="corner-row" key={k}>
            {onCorner && (
              <CornerStyleBtn corner={k} style={styleOf(k)}
                              onToggle={() => setStyle(k, styleOf(k) === 'chamfer' ? 'round' : 'chamfer')} />
            )}
            <Slider label={k.toUpperCase()} value={v[k]} onChange={n => setCorner(k, n)} max={cap} />
          </div>
        ))
      )}
      <button className="ghost" onClick={toggleLink}>
        {linked ? 'Split corners' : 'Link corners'}
      </button>
    </div>
  );
}

export { PinSidesControl, CornerRadius };
