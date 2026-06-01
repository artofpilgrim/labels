import { useEffect, useRef, useState } from 'react';
import { useMediaQuery } from '../hooks/useMediaQuery.js';
import {
  ColorInput,
  CornerRadius,
  Field,
  HelpModal,
  MultiSelectProps,
  NumberInput,
  PropertiesPanel,
  PropsHeader,
  Row,
  Section,
  Seg,
  Slider,
} from './editorComponents.jsx';
import { CanvasArea } from './CanvasArea.jsx';
import { ExportPanel } from './ExportPanel.jsx';
import { LeftPanel } from './LeftPanel.jsx';
import { LayerStack } from './LayerStack.jsx';
import { HandwritingModal } from './HandwritingModal.jsx';
import { SEVERITY } from '../core/constants.js';
import { toLabel, toScreen } from '../core/coordinates.js';
import { niceStep } from '../core/geometry.js';
import { FORMATS } from '../templates/index.js';
export function EditorShell({
  design,
  setDesign,
  docName,
  setDocName,
  saveState,
  canUndo,
  canRedo,
  undo,
  redo,
  theme,
  setTheme,
  preview,
  togglePreview,
  helpOpen,
  setHelpOpen,
  exportOpen,
  setExportOpen,
  leftPanel,
  setLeftPanel,
  query,
  setQuery,
  setSeverity,
  applyPreset,
  changeCanvasShape,
  userPresets,
  newPresetName,
  setNewPresetName,
  activePresetId,
  saveCurrentAsPreset,
  updateUserPreset,
  applyUserPreset,
  deleteUserPreset,
  setCanvasSize,
  setWrapOffset,
  setLayer,
  setLayers,
  selectedIds,
  setSelectedIds,
  selectedLayer,
  selectedLayers,
  selBounds,
  editableSel,
  symbolCache,
  addImageFromFile,
  addLayer,
  addInkLayer,
  moveLayer,
  deleteLayer,
  moveLayersToTarget,
  doExport,
  doCopyImage,
  slug,
  rulers,
  fit,
  zoomMode,
  setZoomMode,
  zoomIn,
  zoomOut,
  grid,
  setGrid,
  wrapOffset,
  rulerTopRef,
  rulerLeftRef,
  canvasRef,
  wrapRef,
  labelRef,
  editingTextId,
  onLayerPointerDown,
  onCanvasPointerDown,
  onLayerContextMenu,
  onLayerDoubleClick,
  onStagePointerDown,
  onStageContextMenu,
  startCanvasResize,
  snapGuides,
  hudLabel,
  startLayerResize,
  startRotate,
  startGroupResize,
  startGroupRotate,
  marquee,
  editingDraft,
  setEditingDraft,
  commitTextEdit,
  cancelTextEdit,
  alignLayer,
  distribute,
  flipSelected,
  duplicateLayer,
  deleteSelected,
  clipboardRef,
  pasteClipboardAt,
  selectAll,
  pasteClipboard,
  reorderSelected,
  exportMsg,
  ctxMenu,
  setCtxMenu,
  frameSelection,
  copySelected,
  currentDocId,
  docs,
  newDocument,
  openDocument,
  renameDocument,
  deleteDocument,
  onHome,
  padCanvas
}) {
  // ----- Shared panel blocks (reused across the new 4-zone layout) -----
  const bg = design.layers.find(l => l.syncCanvas === 'fill');
  // Mobile (≤900px): the side panels become slide-over drawers. null | 'left' | 'right'.
  const [mobileDrawer, setMobileDrawer] = useState(null);
  // The freehand handwriting capture modal (opened from the rail).
  const [hwOpen, setHwOpen] = useState(false);
  const uploadInputRef = useRef(null);
  const isMobile = useMediaQuery('(max-width: 900px)');
  // Drawers are a mobile-only concept: drop any open drawer when we grow back to
  // the desktop layout, and let Escape close an open drawer (the capturing
  // listener stops the global Esc so it doesn't also clear the selection).
  useEffect(() => { if (!isMobile && mobileDrawer) setMobileDrawer(null); }, [isMobile, mobileDrawer]);
  useEffect(() => {
    if (!mobileDrawer) return;
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); setMobileDrawer(null); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [mobileDrawer]);
  // Uniform outward-padding range, keyed off the (stable) unpadded content size
  // so the slider's max doesn't drift as you pad.
  const padMax = Math.max(20, Math.round((Math.min(design.width, design.height) - 2 * (design.padding || 0)) / 2));

  const dimensionsBody = (
    <>
      <Row>
        <NumberInput live={false} value={design.width} onChange={v => setCanvasSize(v, design.height)} min={40} max={4000} suffix="W" />
        <NumberInput live={false} value={design.height} onChange={v => setCanvasSize(design.width, v)} min={40} max={4000} suffix="H" />
      </Row>
      <Row>
        <Slider label="Padding" ariaLabel="Canvas padding" value={design.padding || 0}
                onChange={padCanvas} min={0} max={padMax} step={1} />
      </Row>
      <Row>
        <button className="ghost" onClick={() => {
          // applyUserPreset stores format:'custom' which isn't in FORMATS — guard.
          const f = FORMATS.find(x => x.id === design.format);
          if (!f) return;
          padCanvas(0);                       // drop any outward padding first so the reset can't desync
          setCanvasSize(f.default[0], f.default[1]);
          setWrapOffset({ x: 0, y: 0 });
        }}>Reset</button>
        <button className="ghost" onClick={() => {
          setCanvasSize(design.height, design.width);
          setWrapOffset({ x: 0, y: 0 });
        }}>Swap</button>
      </Row>
      <Row>
        <button className="ghost" onClick={() => setWrapOffset({ x: 0, y: 0 })}>Center canvas</button>
      </Row>
      <div className="field-hint">Or drag the handles around the label.</div>
    </>
  );

  const canvasPropsFields = (
    <>
      <Section title="Dimensions" id="canvas-dim">{dimensionsBody}</Section>
      {bg && (() => {
        const maxR = Math.floor(Math.min(design.width, design.height) / 2);
        return (
          <>
            <Section title="Background" id="canvas-bg">
              <Field label="Fill">
                <ColorInput value={bg.fill === 'none' ? '#FFFFFF' : (bg.fill || '#FFFFFF')}
                            onChange={v => setLayer(bg.id, { fill: v, bindSeverity: null })} />
              </Field>
            </Section>
            <Section title="Appearance" id="canvas-appearance">
              <Field label="Border">
                <Row>
                  <ColorInput value={bg.stroke || '#000000'} onChange={v => setLayer(bg.id, { stroke: v, strokeWidth: bg.strokeWidth || 2 })} />
                </Row>
                <Row>
                  <Slider label="Width" ariaLabel="Border width" value={bg.strokeWidth || 0} onChange={v => setLayer(bg.id, { strokeWidth: v })} min={0} max={40} step={0.5} />
                </Row>
                {(bg.strokeWidth || 0) > 0 && (
                  <Row>
                    <Slider label="Inset" ariaLabel="Border inset" value={bg.strokeInset || 0}
                            onChange={v => setLayer(bg.id, { strokeInset: v })} min={0} max={maxR} step={0.5} />
                  </Row>
                )}
              </Field>
              <Field label="Corner radius">
                <CornerRadius value={bg.radius || 0} onChange={v => setLayer(bg.id, { radius: v })} max={maxR}
                              corner={bg.corner} onCorner={c => setLayer(bg.id, { corner: c })} />
              </Field>
            </Section>
          </>
        );
      })()}
    </>
  );

  const layerStackField = (
    <LayerStack
      design={design}
      selectedIds={selectedIds}
      setSelectedIds={setSelectedIds}
      selectedLayer={selectedLayer}
      symbolsReady={!!symbolCache}
      setLayer={setLayer}
      moveLayer={moveLayer}
      deleteLayer={deleteLayer}
      moveLayersToTarget={moveLayersToTarget}
      addLayer={addLayer}
      duplicateLayer={duplicateLayer}
      deleteSelected={deleteSelected}
      reorderSelected={reorderSelected}
    />
  );

  const railBtns = [
    { id: 'files', title: 'My labels', kind: 'panel', icon: 'M2 4.5h4l1.4 1.6H14V12.5H2z' },
    { id: 'templates', title: 'Templates', kind: 'panel', icon: 'M2 2h5v5H2zM9 2h5v5H9zM2 9h5v5H2zM9 9h5v5H9z' },
    { id: 'shapes', title: 'Shapes', kind: 'panel', icon: 'M8 2 L14 6.5 L11.6 13.5 H4.4 L2 6.5 Z' },
    { id: 'symbols', title: 'Symbols', kind: 'panel', icon: 'M8 2l6 11H2z' },
    { id: 'text', title: 'Add text', kind: 'add', type: 'text', icon: 'M3 3h10v2M8 5v8M6 13h4' },
    { id: 'rect', title: 'Add rectangle', kind: 'add', type: 'rect', icon: 'M2.5 4h11v8h-11z' },
    { id: 'list', title: 'Add list', kind: 'add', type: 'bullets', icon: 'M2 4h2M6 4h8M2 8h2M6 8h8M2 12h2M6 12h8' },
    { id: 'line', title: 'Add line', kind: 'add', type: 'line', icon: 'M2 8h12' },
    { id: 'barcode', title: 'Add barcode', kind: 'add', type: 'barcode', icon: 'M2.5 3v10M5 3v10M6.5 3v10M9 3v10M10.5 3v10M13.5 3v10' },
    { id: 'handwriting', title: 'Add handwriting', kind: 'handwriting', icon: 'M10.8 2.7 13.3 5.2 5.5 13 3 13.5 3.5 11z M9.6 3.9 12.1 6.4' },
    { id: 'image', title: 'Upload image', kind: 'upload', icon: 'M2.5 3.5h11v9h-11z M3.2 11.5l3-3.2 2.2 2.2 2.8-3.2 2.6 3 M5.6 6.5a1.1 1.1 0 1 1-2.2 0 1.1 1.1 0 0 1 2.2 0' },
  ];

  // ----- Pixel rulers (top + left) -----
  const RULER = 26;
  let topRuler = null, leftRuler = null;
  if (rulers) {
    const { originX, originY, topW, leftH } = rulers;
    const step = niceStep(toLabel(64, fit));   // ~64px target spacing between labels
    const minor = step / 5;
    const fmt = step >= 1 ? (p => Math.round(p)) : (p => p.toFixed(1));
    const tickColor = 'var(--line-strong)';
    const band = 'var(--ring-fill)';

    const i0t = Math.ceil(toLabel(0 - originX, fit) / minor);
    const i1t = Math.floor(toLabel(topW - originX, fit) / minor);
    const topEls = [];
    if (selBounds) topEls.push(<rect key="b" x={originX + toScreen(selBounds.x, fit)} y="0" width={Math.max(0, toScreen(selBounds.w, fit))} height={RULER} fill={band} />);
    for (let i = i0t; i <= i1t; i++) {
      const p = i * minor, x = originX + toScreen(p, fit), major = i % 5 === 0;
      topEls.push(<line key={i} x1={x} y1={major ? RULER - 9 : RULER - 5} x2={x} y2={RULER} stroke={tickColor} />);
      if (major) topEls.push(<text key={'t' + i} x={x + 3} y="11" fontSize="9" fill="var(--muted)">{fmt(p)}</text>);
    }
    topRuler = <svg className="ruler-svg" width="100%" height={RULER}>{topEls}</svg>;

    const i0l = Math.ceil(toLabel(0 - originY, fit) / minor);
    const i1l = Math.floor(toLabel(leftH - originY, fit) / minor);
    const leftEls = [];
    if (selBounds) leftEls.push(<rect key="b" x="0" y={originY + toScreen(selBounds.y, fit)} width={RULER} height={Math.max(0, toScreen(selBounds.h, fit))} fill={band} />);
    for (let i = i0l; i <= i1l; i++) {
      const p = i * minor, y = originY + toScreen(p, fit), major = i % 5 === 0;
      leftEls.push(<line key={i} x1={major ? RULER - 9 : RULER - 5} y1={y} x2={RULER} y2={y} stroke={tickColor} />);
      if (major) leftEls.push(<text key={'t' + i} x="3" y={y - 3} fontSize="9" fill="var(--muted)">{fmt(p)}</text>);
    }
    leftRuler = <svg className="ruler-svg" width={RULER} height="100%">{leftEls}</svg>;
  }

  return (
    <div className={`app${preview ? ' is-preview' : ''}${mobileDrawer ? ` m-${mobileDrawer}` : ''}`}>
      {/* ---------- Top bar ---------- */}
      <header className="topbar">
        <div
          className="brand"
          role={onHome ? 'button' : undefined}
          tabIndex={onHome ? 0 : undefined}
          title={onHome ? 'Back to the start page' : undefined}
          style={onHome ? { cursor: 'pointer' } : undefined}
          onClick={onHome}
          onKeyDown={onHome ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onHome(); } } : undefined}
        >
          <div className="brand-mark">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinejoin="round" strokeLinecap="round">
              <path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z" />
              <circle cx="7.5" cy="7.5" r="1.3" fill="currentColor" stroke="none" />
            </svg>
          </div>
          <div>
            <div className="brand-name">Label Studio</div>
            <div className="brand-sub">Labels · Signs · Stickers</div>
          </div>
        </div>

        <div className="doc-bar">
          <input className="doc-name" aria-label="Label name"
                 title="The name of this label — used in your library and the export filename"
                 placeholder="Untitled Label"
                 value={docName} onChange={e => setDocName(e.target.value)} spellCheck={false} />
          <span className={`save-state ${saveState}`}
                title={saveState === 'error'
                  ? 'Could not save — your browser storage may be full'
                  : 'This label saves automatically to your browser'}>
            {saveState === 'saving' ? 'Saving…' : saveState === 'error' ? '⚠ Not saved' : '✓ Saved'}
          </span>
        </div>

        <div className="topbar-actions">
          <button className="icon-btn tb-mobile-only" title="Layers & properties"
                  aria-pressed={mobileDrawer === 'right'}
                  onClick={() => setMobileDrawer(d => (d === 'right' ? null : 'right'))}>
            <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="2.5" width="12" height="11" rx="1.5" /><path d="M10 2.5v11" />
            </svg>
          </button>
          <div className="tb-group">
            <button className="icon-btn" title="Undo (Ctrl+Z)" onClick={undo}
                    disabled={!canUndo}>↶</button>
            <button className="icon-btn" title="Redo (Ctrl+Shift+Z)" onClick={redo}
                    disabled={!canRedo}>↷</button>
          </div>
          <button className="icon-btn" aria-pressed={theme === 'dark'}
                  title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
                  onClick={() => setTheme(t => (t === 'dark' ? 'light' : 'dark'))}>
            {theme === 'dark' ? '☀' : '☾'}
          </button>
          <button className={`btn-lg tb-preview${preview ? ' on' : ''}`} onClick={togglePreview}>
            {preview ? 'Exit preview' : 'Preview'}
          </button>
          <div className="export-wrap">
            <button className="btn-lg primary" aria-expanded={exportOpen} aria-haspopup="true"
                    onClick={() => { setMobileDrawer(null); setExportOpen(o => !o); }}>Export ▾</button>
            {exportOpen && <>
              <div className="ctx-backdrop" style={{ zIndex: 39 }} onMouseDown={() => setExportOpen(false)} />
              <div className="export-pop"><ExportPanel docName={docName} design={design} doExport={doExport} doCopyImage={doCopyImage} slug={slug} /></div>
            </>}
          </div>
        </div>
      </header>

      {/* ---------- Icon rail ---------- */}
      <nav className="rail">
        {railBtns.map(b => (
          <button
            key={b.id}
            className={`rail-btn${b.kind === 'panel' && leftPanel === b.id ? ' on' : ''}`}
            title={b.title}
            aria-pressed={b.kind === 'panel' ? leftPanel === b.id : undefined}
            onClick={() => {
              if (b.kind === 'handwriting') { setHwOpen(true); return; }
              if (b.kind === 'upload') { uploadInputRef.current?.click(); return; }
              if (b.kind === 'add') { addLayer(b.type); return; }
              setLeftPanel(b.id);
              if (isMobile) setMobileDrawer(d => (d === 'left' && leftPanel === b.id) ? null : 'left');
            }}>
            <svg viewBox="0 0 16 16" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
              <path d={b.icon} />
            </svg>
          </button>
        ))}
        <div className="rail-spacer" />
        <button className="rail-btn" title="Help & workflows" onClick={() => setHelpOpen(true)}>
          <svg viewBox="0 0 16 16" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
            <circle cx="8" cy="8" r="6.5" /><path d="M6.2 6.2a1.8 1.8 0 1 1 2.4 1.7c-.6.3-.9.7-.9 1.3M8 11.6v.01" />
          </svg>
        </button>
        <input
          ref={uploadInputRef}
          type="file"
          accept="image/*,.svg"
          style={{ display: 'none' }}
          onChange={e => { const f = e.target.files && e.target.files[0]; if (f) addImageFromFile(f); e.target.value = ''; }}
        />
      </nav>

      <LeftPanel
        leftPanel={leftPanel}
        setLeftPanel={setLeftPanel}
        query={query}
        setQuery={setQuery}
        design={design}
        setSeverity={setSeverity}
        applyPreset={applyPreset}
        changeCanvasShape={changeCanvasShape}
        userPresets={userPresets}
        newPresetName={newPresetName}
        setNewPresetName={setNewPresetName}
        docName={docName}
        saveCurrentAsPreset={saveCurrentAsPreset}
        activePresetId={activePresetId}
        applyUserPreset={applyUserPreset}
        updateUserPreset={updateUserPreset}
        deleteUserPreset={deleteUserPreset}
        selectedLayer={selectedLayer}
        symbolCache={symbolCache}
        addImageFromFile={addImageFromFile}
        setLayer={setLayer}
        setDesign={setDesign}
        setSelectedIds={setSelectedIds}
        addLayer={addLayer}
        currentDocId={currentDocId}
        docs={docs}
        newDocument={newDocument}
        openDocument={openDocument}
        renameDocument={renameDocument}
        deleteDocument={deleteDocument}
      />
      <CanvasArea
        design={design}
        preview={preview}
        rulerTopRef={rulerTopRef}
        rulerLeftRef={rulerLeftRef}
        topRuler={topRuler}
        leftRuler={leftRuler}
        canvasRef={canvasRef}
        labelRef={labelRef}
        onStagePointerDown={onStagePointerDown}
        onStageContextMenu={onStageContextMenu}
        wrapRef={wrapRef}
        fit={fit}
        wrapOffset={wrapOffset}
        symbolCache={symbolCache}
        editingTextId={editingTextId}
        onLayerPointerDown={onLayerPointerDown}
        onCanvasPointerDown={onCanvasPointerDown}
        onLayerContextMenu={onLayerContextMenu}
        onLayerDoubleClick={onLayerDoubleClick}
        grid={grid}
        startCanvasResize={startCanvasResize}
        snapGuides={snapGuides}
        selectedLayer={selectedLayer}
        hudLabel={hudLabel}
        startLayerResize={startLayerResize}
        startRotate={startRotate}
        selectedIds={selectedIds}
        selBounds={selBounds}
        selectedLayers={selectedLayers}
        startGroupResize={startGroupResize}
        startGroupRotate={startGroupRotate}
        marquee={marquee}
        editingDraft={editingDraft}
        setEditingDraft={setEditingDraft}
        commitTextEdit={commitTextEdit}
        cancelTextEdit={cancelTextEdit}
        editableSel={editableSel}
        alignLayer={alignLayer}
        distribute={distribute}
        flipSelected={flipSelected}
        duplicateLayer={duplicateLayer}
        deleteSelected={deleteSelected}
        setGrid={setGrid}
        zoomMode={zoomMode}
        setZoomMode={setZoomMode}
        zoomOut={zoomOut}
        zoomIn={zoomIn}
      />

      {/* ---------- Right panel ---------- */}
      <aside className="rightpanel">
        <div className="panel">
          {/* Layers on top, then the "you are here" header, then the
              context-sensitive properties for the current selection. */}
          <Section title="Layers" id="layers">{layerStackField}</Section>
          <PropsHeader
            canvasW={design.width}
            canvasH={design.height}
            selectedLayer={selectedLayer}
            selectedLayers={selectedLayers}
            selectedIds={selectedIds}
            setLayer={setLayer}
            alignLayer={alignLayer}
            duplicateLayer={duplicateLayer}
            deleteSelected={deleteSelected}
          />
          {selectedLayer ? (
            <PropertiesPanel
              layer={selectedLayer}
              onChange={patch => setLayer(selectedLayer.id, patch)}
              cache={symbolCache}
              canvasW={design.width}
              canvasH={design.height}
            />
          ) : selectedIds.length >= 2 ? (
            <MultiSelectProps
              layers={selectedLayers}
              ids={selectedIds}
              setLayers={setLayers}
              alignLayer={alignLayer}
              distribute={distribute}
            />
          ) : (
            <>{canvasPropsFields}</>
          )}
        </div>
      </aside>

      {exportMsg && <div className="export-msg toast">{exportMsg}</div>}
      {mobileDrawer && <div className="m-backdrop" onClick={() => setMobileDrawer(null)} />}
      {mobileDrawer && (
        <button className="m-drawer-close" aria-label="Close panel" onClick={() => setMobileDrawer(null)}>✕</button>
      )}
      {helpOpen && <HelpModal onClose={() => setHelpOpen(false)} />}
      {hwOpen && (
        <HandwritingModal
          onCancel={() => setHwOpen(false)}
          onAdd={(strokes, pen) => { addInkLayer(strokes, pen); setHwOpen(false); }}
        />
      )}

      {ctxMenu && (
        <>
          <div className="ctx-backdrop"
               onMouseDown={() => setCtxMenu(null)}
               onContextMenu={e => { e.preventDefault(); setCtxMenu(null); }} />
          {ctxMenu.kind === 'canvas' ? (
          <div className="ctx-menu" style={{ left: ctxMenu.x, top: ctxMenu.y }}>
            <button disabled={!(clipboardRef.current && clipboardRef.current.length)} onClick={() => { pasteClipboardAt(ctxMenu.labelX, ctxMenu.labelY); setCtxMenu(null); }}>Paste here <span>Ctrl+V</span></button>
            <button onClick={() => { selectAll(); setCtxMenu(null); }}>Select all <span>Ctrl+A</span></button>
            <div className="ctx-sep" />
            <button onClick={() => { addLayer('text', { x: ctxMenu.labelX, y: ctxMenu.labelY }); setCtxMenu(null); }}>Add text</button>
            <button onClick={() => { addLayer('rect', { x: ctxMenu.labelX, y: ctxMenu.labelY }); setCtxMenu(null); }}>Add rectangle</button>
            <button onClick={() => { addLayer('ellipse', { x: ctxMenu.labelX, y: ctxMenu.labelY }); setCtxMenu(null); }}>Add ellipse</button>
            <button onClick={() => { addLayer('line', { x: ctxMenu.labelX, y: ctxMenu.labelY }); setCtxMenu(null); }}>Add line</button>
            <div className="ctx-sep" />
            <button onClick={() => { setZoomMode('fit'); setCtxMenu(null); }}>Fit to viewport</button>
            <button disabled={!selBounds || selBounds.w < 1 || selBounds.h < 1} onClick={() => { frameSelection(); setCtxMenu(null); }}>Zoom to selection <span>Shift+2</span></button>
          </div>
          ) : (
          <div className="ctx-menu" style={{ left: ctxMenu.x, top: ctxMenu.y }}>
            <button onClick={() => { duplicateLayer(); setCtxMenu(null); }}>Duplicate <span>Ctrl+D</span></button>
            <button onClick={() => { copySelected(); setCtxMenu(null); }}>Copy <span>Ctrl+C</span></button>
            <button onClick={() => { pasteClipboard(); setCtxMenu(null); }}>Paste <span>Ctrl+V</span></button>
            <div className="ctx-sep" />
            <button onClick={() => { reorderSelected('front'); setCtxMenu(null); }}>Bring to front</button>
            <button onClick={() => { reorderSelected('forward'); setCtxMenu(null); }}>Bring forward <span>Ctrl+]</span></button>
            <button onClick={() => { reorderSelected('backward'); setCtxMenu(null); }}>Send backward <span>Ctrl+[</span></button>
            <button onClick={() => { reorderSelected('back'); setCtxMenu(null); }}>Send to back</button>
            <div className="ctx-sep" />
            <button onClick={() => { setDesign(d => ({ ...d, layers: d.layers.map(l => selectedIds.includes(l.id) ? { ...l, locked: !l.locked } : l) })); setCtxMenu(null); }}>Lock / Unlock</button>
            <button onClick={() => { setDesign(d => ({ ...d, layers: d.layers.map(l => selectedIds.includes(l.id) ? { ...l, hidden: !l.hidden } : l) })); setCtxMenu(null); }}>Hide / Show</button>
            <div className="ctx-sep" />
            <button className="danger" onClick={() => { deleteSelected(); setCtxMenu(null); }}>Delete <span>Del</span></button>
          </div>
          )}
        </>
      )}
    </div>
  );
}
