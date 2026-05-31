import { useState } from 'react';
import { PICTOGRAMS } from '../pictograms.js';

// ----------- Pictogram picker tile -----------
function PictoTile({ id, active, onClick, cache }) {
  const p = PICTOGRAMS[id];
  const src = cache && cache[id];
  const std = p.kind === 'ghs' ? null : p.kind === 'info' ? 'ISO 7001' : 'ISO 7010';
  const ref = std ? `${std} ${p.code}` : p.code;
  return (
    <button className={`picto-tile ${active ? 'on' : ''}`} aria-pressed={active} onClick={onClick} title={`${p.name} · ${ref}`}>
      {src ? <img src={src} alt={p.name} width="44" height="44" loading="lazy" decoding="async" style={{ objectFit: 'contain' }} />
           : <div style={{ width: 44, height: 44 }} />}
      <span>{p.name}</span>
    </button>
  );
}

// Symbol categories in display order. The picker groups tiles under these so the
// full ISO 7010 catalog stays navigable; each PICTOGRAMS entry's `kind` maps here.
const PICTO_GROUPS = [
  ['warning', 'Warning'],
  ['prohibition', 'Prohibition'],
  ['mandatory', 'Mandatory'],
  ['safe', 'Safe condition'],
  ['fire', 'Fire equipment'],
  ['ghs', 'GHS chemical'],
  ['info', 'Public info'],
];

const KIND_LABEL = Object.fromEntries(PICTO_GROUPS);

// Grouped pictogram picker, shared by the Symbols tab and the image-layer
// properties panel. activeId highlights the current symbol; onPick(id) applies.
// A search box filters by symbol name, ISO code, or category label.
// Read an image file (PNG/JPG/SVG) as a base64 data URL, then probe its natural
// size; cb(dataUrl, naturalW, naturalH). Used for custom-image upload.
function readImageFile(file, cb) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    const src = reader.result;
    const probe = new Image();
    probe.onload = () => cb(src, probe.naturalWidth || 0, probe.naturalHeight || 0);
    probe.onerror = () => cb(src, 0, 0);
    probe.src = src;
  };
  reader.readAsDataURL(file);
}

function SymbolPicker({ activeId, onPick, cache, onUpload }) {
  const [q, setQ] = useState('');
  const query = q.trim().toLowerCase();
  const match = (id) => {
    if (!query) return true;
    const p = PICTOGRAMS[id];
    return p.name.toLowerCase().includes(query)
        || p.code.toLowerCase().includes(query)
        || (KIND_LABEL[p.kind] || '').toLowerCase().includes(query);
  };
  const ids = Object.keys(PICTOGRAMS).filter(match);
  return (
    <div className="symbol-picker">
      <input
        className="text-input picto-search"
        type="search"
        value={q}
        onChange={e => setQ(e.target.value)}
        placeholder="Search symbols…"
        aria-label="Search symbols"
        spellCheck={false}
      />
      {onUpload && (
        <label className="ghost dashed picto-upload">
          Upload image (PNG / JPG / SVG)
          <input type="file" accept="image/*,.svg" style={{ display: 'none' }}
                 onChange={e => { const f = e.target.files && e.target.files[0]; if (f) onUpload(f); e.target.value = ''; }} />
        </label>
      )}
      <div className="picto-groups">
        {PICTO_GROUPS.map(([kind, label]) => {
          const group = ids.filter(id => PICTOGRAMS[id].kind === kind);
          if (!group.length) return null;
          return (
            <div key={kind} className="picto-group">
              <div className="picto-group-label">{label}</div>
              <div className="picto-grid">
                {group.map(id => (
                  <PictoTile key={id} id={id} active={activeId === id} onClick={() => onPick(id)} cache={cache} />
                ))}
              </div>
            </div>
          );
        })}
        {ids.length === 0 && <div className="empty-note">No symbols match “{q}”.</div>}
      </div>
    </div>
  );
}

export { readImageFile, SymbolPicker };
