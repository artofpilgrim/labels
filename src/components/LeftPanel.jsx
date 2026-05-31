import { useEffect, useState } from 'react';
import { SEVERITY } from '../core/constants.js';
import { FORMATS, newLayer } from '../templates/index.js';
import { idb } from '../core/idb.js';
import { Label } from '../renderer/Label.jsx';
import { Field, Row } from './ui.jsx';
import { FormatIcon } from './FormatIcon.jsx';
import { SymbolPicker } from './SymbolPicker.jsx';
import { SHAPES } from './editorChrome.jsx';

// "5m ago" / "2h ago" / "3d ago" / a date — last-edited stamp for the library.
function relTime(ts) {
  if (!ts) return '';
  const s = Math.max(0, (Date.now() - ts) / 1000);
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  if (s < 86400 * 7) return `${Math.round(s / 86400)}d ago`;
  return new Date(ts).toLocaleDateString();
}

// A faithful, scaled preview of a document — reuses the real renderer. The
// design is loaded lazily (the library is only mounted when its panel is open),
// re-fetching when the doc's updatedAt changes so the current row stays current.
function DocThumb({ docId, updatedAt, symbolsReady }) {
  const [design, setDesign] = useState(null);
  useEffect(() => {
    let alive = true;
    idb.getDoc(docId).then(d => { if (alive && d && d.design) setDesign(d.design); }).catch(() => {});
    return () => { alive = false; };
  }, [docId, updatedAt]);
  return (
    <span className="doc-thumb" aria-hidden="true">
      {design && <Label design={design} symbolsReady={symbolsReady} />}
    </span>
  );
}

// One card in the "My labels" library: thumbnail + name + last-edited. Click to
// open; double-click the name (or the pencil) to rename inline; × deletes.
function DocumentRow({ doc, current, symbolsReady, onOpen, onRename, onDelete }) {
  const [renaming, setRenaming] = useState(false);
  return (
    <div className={`doc-row ${current ? 'on' : ''}`}
         onClick={() => { if (!renaming) onOpen(doc.id); }}
         title={current ? 'Current label' : 'Open label'}>
      <DocThumb docId={doc.id} updatedAt={doc.updatedAt} symbolsReady={symbolsReady} />
      <div className="doc-main">
        {renaming ? (
          <input className="doc-rename" autoFocus defaultValue={doc.name}
                 onClick={e => e.stopPropagation()}
                 onBlur={e => { onRename(doc.id, e.target.value); setRenaming(false); }}
                 onKeyDown={e => {
                   e.stopPropagation();
                   if (e.key === 'Enter') e.currentTarget.blur();
                   else if (e.key === 'Escape') setRenaming(false);
                 }} />
        ) : (
          <span className="doc-name2" onDoubleClick={e => { e.stopPropagation(); setRenaming(true); }}>{doc.name}</span>
        )}
        <span className="doc-time">{relTime(doc.updatedAt)}</span>
      </div>
      <div className="doc-actions">
        <button className="icon-btn" title="Rename"
                onClick={e => { e.stopPropagation(); setRenaming(true); }}>
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor"
               strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10.5 2.5 13.5 5.5 5.5 13.5H2.5v-3z" />
          </svg>
        </button>
        <button className="icon-btn doc-del" title="Delete"
                onClick={e => { e.stopPropagation(); if (window.confirm(`Delete "${doc.name}"? This can't be undone.`)) onDelete(doc.id); }}>×</button>
      </div>
    </div>
  );
}

export function LeftPanel({
  leftPanel,
  setLeftPanel,
  query,
  setQuery,
  design,
  setSeverity,
  applyPreset,
  changeCanvasShape,
  userPresets,
  newPresetName,
  setNewPresetName,
  docName,
  saveCurrentAsPreset,
  activePresetId,
  applyUserPreset,
  updateUserPreset,
  deleteUserPreset,
  selectedLayer,
  symbolCache,
  addImageFromFile,
  setLayer,
  setDesign,
  setSelectedIds,
  addLayer,
  currentDocId,
  docs,
  newDocument,
  openDocument,
  renameDocument,
  deleteDocument,
}) {
  const bg = design.layers.find(l => l.syncCanvas === 'fill');

  const filesField = (
    <Field label="My labels">
      <button className="ghost dashed lp-new-doc" onClick={() => newDocument()}>+ New label</button>
      <div className="field-hint" style={{ marginTop: 6 }}>Saved locally to this browser.</div>
      {docs && docs.length > 0 && (
        <div className="doc-list">
          {docs.map(d => (
            <DocumentRow key={d.id} doc={d} current={d.id === currentDocId} symbolsReady={!!symbolCache}
                         onOpen={openDocument} onRename={renameDocument} onDelete={deleteDocument} />
          ))}
        </div>
      )}
    </Field>
  );

  const severityField = (
    <Field label="Severity">
      <div className="severity-grid">
        {Object.entries(SEVERITY).map(([id, s]) => (
          <button
            key={id}
            className={`severity ${design.severity === id ? 'on' : ''}`}
            aria-pressed={design.severity === id}
            onClick={() => setSeverity(id)}
            style={{
              background: design.severity === id ? s.band : 'transparent',
              color: design.severity === id ? s.bandInk : 'var(--ink)',
              borderColor: design.severity === id ? s.band : 'var(--line)',
            }}>
            <span className="sev-swatch" style={{ background: s.band, borderColor: s.bandInk }} />
            <span className="sev-word">{s.word}</span>
          </button>
        ))}
      </div>
    </Field>
  );

  const presetField = (
    <Field label="Common templates" hint="Replaces all layers with this format's starting set.">
      <div className="format-grid">
        {FORMATS
          .filter(f => !query || f.name.toLowerCase().includes(query.toLowerCase()))
          .map(f => (
            <button
              key={f.id}
              className={`format-tile ${design.format === f.id ? 'on' : ''}`}
              aria-pressed={design.format === f.id}
              onClick={() => applyPreset(f.id)}>
              <FormatIcon id={f.id} active={design.format === f.id} />
              <span>{f.name}</span>
            </button>
          ))}
      </div>
    </Field>
  );

  const blankShapeField = (
    <Field label="Canvas shape" hint="The base shape for your blank label — corners outside it export transparent.">
      <div className="picto-grid">
        {SHAPES.filter(s => s.type !== 'line' && s.type !== 'barcode').map(s => {
          const active = (bg?.shape || 'rect') === s.type;
          return (
            <button key={s.type} className={`picto-tile ${active ? 'on' : ''}`}
                    aria-pressed={active} title={s.name}
                    onClick={() => changeCanvasShape(s.type)}>
              <svg width="40" height="40" viewBox="0 0 16 16">{s.el}</svg>
              <span>{s.name}</span>
            </button>
          );
        })}
      </div>
    </Field>
  );

  const userPresetsField = (
    <Field label="Your presets" hint="Saved locally to this browser.">
      <Row>
        <input
          className="text-input"
          value={newPresetName}
          onChange={e => setNewPresetName(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') saveCurrentAsPreset(newPresetName || docName); }}
          placeholder={docName}
        />
        <button className="ghost"
                onClick={() => saveCurrentAsPreset(newPresetName || docName)}
                disabled={!(newPresetName.trim() || docName.trim())}>
          Save
        </button>
      </Row>
      {userPresets.length > 0 && (
        <div className="layer-list" style={{ marginTop: 8 }}>
          {userPresets.map(p => (
            <div key={p.id}
                 className={`layer-row ${p.id === activePresetId ? 'on' : ''}`}
                 onClick={() => applyUserPreset(p.id)}
                 title={p.id === activePresetId ? 'Loaded — click to reapply' : 'Apply preset'}>
              <span className="layer-glyph">
                <svg width="14" height="14" viewBox="0 0 14 14">
                  <path d="M3 2h6l2 2v8H3z" fill="none" stroke="currentColor" strokeWidth="1.2" />
                </svg>
              </span>
              <span className="layer-name">{p.name}</span>
              <span className="layer-meta">{p.design.width}×{p.design.height}</span>
              <button className="icon-btn" title="Update preset with current design"
                      onClick={e => { e.stopPropagation(); updateUserPreset(p.id); }}>
                <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor"
                     strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M13.6 8a5.6 5.6 0 1 1-1.7-4" />
                  <path d="M13.8 2.4V5.2h-2.8" />
                </svg>
              </button>
              <button className="icon-btn" title="Delete preset"
                      onClick={e => { e.stopPropagation(); deleteUserPreset(p.id); }}>×</button>
            </div>
          ))}
        </div>
      )}
    </Field>
  );

  const symbolsField = (
    <Field label="Symbols" hint="Click to apply to the selected symbol layer, or add a new one.">
      <SymbolPicker
        activeId={selectedLayer && selectedLayer.type === 'image' ? selectedLayer.symbol : null}
        cache={symbolCache}
        onUpload={addImageFromFile}
        onPick={(id) => {
          if (selectedLayer && selectedLayer.type === 'image') {
            setLayer(selectedLayer.id, { symbol: id, src: undefined });
          } else {
            const nl = newLayer('image', design.width, design.height);
            if (nl) {
              nl.symbol = id;
              setDesign(d => ({ ...d, layers: [...d.layers, nl] }));
              setSelectedIds([nl.id]);
            }
          }
        }}
      />
    </Field>
  );

  const shapesField = (
    <Field label="Shapes" hint="Click to add a shape, then style it in Properties.">
      <div className="picto-grid">
        {SHAPES.map(s => (
          <button key={s.type} className="picto-tile" onClick={() => addLayer(s.type)} title={`Add ${s.name.toLowerCase()}`}>
            <svg width="40" height="40" viewBox="0 0 16 16">{s.el}</svg>
            <span>{s.name}</span>
          </button>
        ))}
      </div>
    </Field>
  );

  return (
      <aside className="leftpanel">
        {leftPanel === 'templates' && (
          <div className="lp-search">
            <input className="text-input" placeholder="Search templates…" value={query} onChange={e => setQuery(e.target.value)} />
          </div>
        )}

        <div className="panel">
          {leftPanel === 'files' && filesField}

          {leftPanel === 'templates' && (
            <>
              {severityField}
              {presetField}
              {design.format === 'blank' && blankShapeField}
              {userPresetsField}
            </>
          )}

          {leftPanel === 'shapes' && shapesField}
          {leftPanel === 'symbols' && symbolsField}
        </div>
      </aside>
  );
}
