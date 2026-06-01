// Label Studio — layer-based label editor.
import { useState, useRef, useEffect, useCallback } from 'react';
import { EditorShell } from './components/EditorShell.jsx';
import { SwatchContext } from './components/swatches.js';
import { useCustomSwatches } from './hooks/useCustomSwatches.js';
import { PRESETS } from './templates/index.js';
import { slug } from './core/design.js';
import { applyPins } from './core/geometry.js';
import { loadInitialDocument } from './core/persistence.js';
import { useCanvasViewport } from './hooks/useCanvasViewport.js';
import { useDocuments } from './hooks/useDocuments.js';
import { useCanvasInteractions } from './hooks/useCanvasInteractions.js';
import { useExportActions } from './hooks/useExportActions.js';
import { useGridSettings } from './hooks/useGridSettings.js';
import { useHistoryState } from './hooks/useHistoryState.js';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts.js';
import { useLayerActions } from './hooks/useLayerActions.js';
import { useSelection } from './hooks/useSelection.js';
import { useSymbolCache } from './hooks/useSymbolCache.js';
import { useTheme } from './hooks/useTheme.js';
import { useUserPresets } from './hooks/useUserPresets.js';

// ----------- Initial design -----------
function makeInitialDesign() {
  const W = 640, H = 480;
  return {
    width: W,
    height: H,
    severity: 'danger',
    format: 'ansi-header',
    layers: PRESETS['ansi-header'](W, H, 'danger'),
  };
}

function Studio({ initialDoc, onHome }) {
  const {
    design,
    setDesign,
    resetHistory,
    forceCommit,
    inDragRef,
    undo: historyUndo,
    redo: historyRedo,
    canUndo,
    canRedo,
  } = useHistoryState(() => initialDoc.design);

  // Resize the canvas the same way the canvas-resize drag does: stretch the
  // synced background (its strokeOnTop border IS the label frame) and re-anchor
  // pinned layers, so the frame stroke and bands stay glued to the new edges.
  // Used by the W/H inputs, Reset and Swap — which previously set width/height
  // alone and left the frame detached from the canvas edge.
  const setCanvasSize = useCallback((nw, nh) => {
    nw = Math.max(40, Math.round(nw));
    nh = Math.max(40, Math.round(nh));
    setDesign(d => {
      if (nw === d.width && nh === d.height) return d;
      const ow = d.width, oh = d.height;
      return {
        ...d,
        width: nw,
        height: nh,
        layers: d.layers.map(l => {
          if (l.syncCanvas === 'fill') return { ...l, x: 0, y: 0, w: nw, h: nh };
          if (l.pinSides) {
            const p = applyPins({ x: l.x, y: l.y, w: l.w, h: l.h, pinSides: l.pinSides }, ow, oh, nw, nh);
            return { ...l, x: p.x, y: p.y, w: p.w, h: p.h };
          }
          return l;
        }),
      };
    });
  }, [setDesign]);

  // Extrude the whole label outward by uniform padding on every side: grow the
  // canvas (and the synced background) and shift ALL content by the same delta so
  // the interior layout is untouched — just more breathing room around it. Unlike
  // setCanvasSize this is a uniform translate, not a per-edge pin reflow. `padding`
  // is stored so the slider has a value and each change applies the delta.
  const padCanvas = useCallback((nextPad) => {
    setDesign(d => {
      const cur = d.padding || 0;
      const delta = Math.max(0, Math.round(nextPad)) - cur;
      if (delta === 0) return d;
      const nw = d.width + 2 * delta, nh = d.height + 2 * delta;
      if (nw < 40 || nh < 40) return d;
      return {
        ...d,
        width: nw,
        height: nh,
        padding: cur + delta,
        layers: d.layers.map(l => l.syncCanvas === 'fill'
          ? { ...l, x: 0, y: 0, w: nw, h: nh }
          : { ...l, x: l.x + delta, y: l.y + delta }),
      };
    });
  }, [setDesign]);

  const {
    selectedIds,
    setSelectedIds,
    marquee,
    setMarquee,
    selectedId,
    selectedLayer,
    selectedLayers,
    selBounds,
    editableSel,
  } = useSelection(design.layers);

  // ----- 4-zone shell state -----
  // leftPanel: which view the icon rail shows in the left panel.
  // The right panel shows Layers + Properties together (no tabs), so selecting a
  // layer reveals its properties without any tab switch.
  const [leftPanel, setLeftPanel] = useState('templates'); // 'templates' | 'shapes' | 'symbols'
  // Editable document title in the top bar; restored from + saved to localStorage.
  const [docName, setDocName] = useState(() => initialDoc.name);
  const [exportOpen, setExportOpen] = useState(false);      // export popover
  const [helpOpen, setHelpOpen] = useState(false);          // help / workflows dialog
  const [ctxMenu, setCtxMenu] = useState(null);             // right-click menu { x, y }
  const [theme, setTheme] = useTheme();
  const [query, setQuery] = useState('');                   // template search filter
  // Save status shown in the top bar; flips to 'saving' on edit, back after autosave.
  const [saveState, setSaveState] = useState('saved');      // 'saved' | 'saving'
  const symbolCache = useSymbolCache();
  const {
    preview,
    rulers,
    wrapOffset,
    setWrapOffset,
    fit,
    zoomMode,
    setZoomMode,
    setAutoFit,
    labelRef,
    canvasRef,
    wrapRef,
    rulerTopRef,
    rulerLeftRef,
    zoomIn,
    zoomOut,
    togglePreview,
    frameSelection,
    startPan,
    spaceHeldRef,
  } = useCanvasViewport({ design, selBounds });

  const { exportMsg, flash, doExport, doCopyImage } = useExportActions({
    labelRef,
    symbolCache,
    design,
    docName,
    setExportOpen,
  });

  // Active alignment guides shown while Ctrl-dragging. Each guide:
  // { orient: 'v' | 'h', value: number }  — value in label coordinates.
  const [snapGuides, setSnapGuides] = useState([]);
  // Transient on-canvas readout during a drag/resize/rotate gesture. UI-only —
  // never committed to the design (no history entry, no <Label> re-render).
  const [hud, setHud] = useState(null); // { kind: 'move'|'resize'|'rotate', x, y, w, h, deg }
  const hudLabel = (fw, fh) => {
    if (hud?.kind === 'move') return `X ${Math.round(hud.x)}   Y ${Math.round(hud.y)}`;
    if (hud?.kind === 'rotate') return `${Math.round(hud.deg)}°`;
    if (hud?.kind === 'resize') return `${Math.round(hud.w)} × ${Math.round(hud.h)}`;
    return `${Math.round(fw)} × ${Math.round(fh)}`;
  };
  const [grid, setGrid] = useGridSettings();
  // Inline (on-canvas) text editing: the edited layer is hidden in <Label> and
  // replaced by a positioned <textarea>; commit writes the draft text back.
  const [editingTextId, setEditingTextId] = useState(null);
  const [editingDraft, setEditingDraft] = useState('');
  // Set when Escape cancels an inline edit, so the unmount-triggered blur
  // (which would otherwise fire commitTextEdit and write the discarded draft)
  // becomes a no-op write.
  const editClosedRef = useRef(false);
  const {
    userPresets,
    newPresetName,
    setNewPresetName,
    activePresetId,
    setActivePresetId,
    saveCurrentAsPreset,
    updateUserPreset,
    applyUserPreset,
    deleteUserPreset,
  } = useUserPresets({
    design,
    setDesign,
    forceCommit,
    setDocName,
    setSelectedIds,
    setWrapOffset,
    flash,
  });

  // ----- Undo / Redo -----
  const undo = useCallback(() => {
    historyUndo();
    setWrapOffset({ x: 0, y: 0 });
    setSnapGuides([]);
  }, [historyUndo]);

  const redo = useCallback(() => {
    historyRedo();
    setWrapOffset({ x: 0, y: 0 });
    setSnapGuides([]);
  }, [historyRedo]);

  // Local "my labels" file system — owns the document list, the open document,
  // and the per-document autosave (which drives the top-bar save status).
  const {
    currentDocId,
    docs,
    newDocument,
    openDocument,
    renameDocument,
    deleteDocument,
  } = useDocuments({
    initialDoc,
    design,
    docName,
    setDocName,
    setSaveState,
    resetHistory,
    setSelectedIds,
    setWrapOffset,
    setActivePresetId,
    makeDefaultDesign: makeInitialDesign,
    flash,
  });

  const {
    setLayer,
    setLayers,
    deleteLayer,
    moveLayer,
    addLayer,
    addImageFromFile,
    alignLayer,
    distribute,
    flipSelected,
    duplicateLayer,
    deleteSelected,
    copySelected,
    pasteClipboard,
    pasteClipboardAt,
    selectAll,
    reorderSelected,
    moveLayersToTarget,
    clipboardRef,
  } = useLayerActions({ design, setDesign, selectedIds, setSelectedIds });

  const {
    setSeverity,
    applyPreset,
    changeCanvasShape,
    startCanvasResize,
    startLayerResize,
    startRotate,
    startGroupResize,
    startGroupRotate,
    onLayerPointerDown,
    onCanvasPointerDown,
    onLayerContextMenu,
    onLayerDoubleClick,
    onStagePointerDown,
    onStageContextMenu,
    commitTextEdit,
    cancelTextEdit,
  } = useCanvasInteractions({
    design,
    setDesign,
    setLayer,
    forceCommit,
    inDragRef,
    selectedIds,
    setSelectedIds,
    selectedId,
    selBounds,
    setMarquee,
    grid,
    fit,
    wrapRef,
    canvasRef,
    wrapOffset,
    setWrapOffset,
    setAutoFit,
    zoomMode,
    setCtxMenu,
    spaceHeldRef,
    startPan,
    setActivePresetId,
    flash,
    setSnapGuides,
    setHud,
    editingTextId,
    setEditingTextId,
    editingDraft,
    setEditingDraft,
    editClosedRef,
  });
  useKeyboardShortcuts({
    helpOpen,
    exportOpen,
    undo,
    redo,
    zoomIn,
    zoomOut,
    setZoomMode,
    selectAll,
    pasteClipboard,
    selectedIds,
    copySelected,
    duplicateLayer,
    reorderSelected,
    alignLayer,
    distribute,
    frameSelection,
    ctxMenu,
    setSelectedIds,
    deleteSelected,
    setDesign,
  });

  // Shared saved-colour palette for every ColorInput (provided below).
  const swatchApi = useCustomSwatches();

  // If undo/redo restores a design that no longer contains a selected layer,
  // prune the selection so handles + property panel don't dangle.
  useEffect(() => {
    setSelectedIds(ids => {
      const next = ids.filter(id => design.layers.some(l => l.id === id));
      return next.length === ids.length ? ids : next;
    });
  }, [design.layers]);

  // Close the right-click context menu on Escape (click-away is handled by its backdrop).
  useEffect(() => {
    if (!ctxMenu) return;
    const onEsc = (e) => { if (e.key === 'Escape') setCtxMenu(null); };
    window.addEventListener('keydown', onEsc);
    return () => window.removeEventListener('keydown', onEsc);
  }, [ctxMenu]);

  // Close the export popover on Escape (click-away is handled by its backdrop).
  useEffect(() => {
    if (!exportOpen) return;
    const onEsc = (e) => { if (e.key === 'Escape') setExportOpen(false); };
    window.addEventListener('keydown', onEsc);
    return () => window.removeEventListener('keydown', onEsc);
  }, [exportOpen]);

  return (
    <SwatchContext.Provider value={swatchApi}>
    <EditorShell
      design={design}
      setDesign={setDesign}
      docName={docName}
      setDocName={setDocName}
      saveState={saveState}
      canUndo={canUndo}
      canRedo={canRedo}
      undo={undo}
      redo={redo}
      theme={theme}
      setTheme={setTheme}
      preview={preview}
      togglePreview={togglePreview}
      helpOpen={helpOpen}
      setHelpOpen={setHelpOpen}
      exportOpen={exportOpen}
      setExportOpen={setExportOpen}
      leftPanel={leftPanel}
      setLeftPanel={setLeftPanel}
      query={query}
      setQuery={setQuery}
      setSeverity={setSeverity}
      applyPreset={applyPreset}
      changeCanvasShape={changeCanvasShape}
      userPresets={userPresets}
      newPresetName={newPresetName}
      setNewPresetName={setNewPresetName}
      activePresetId={activePresetId}
      saveCurrentAsPreset={saveCurrentAsPreset}
      updateUserPreset={updateUserPreset}
      applyUserPreset={applyUserPreset}
      deleteUserPreset={deleteUserPreset}
      setCanvasSize={setCanvasSize}
      padCanvas={padCanvas}
      setWrapOffset={setWrapOffset}
      setLayer={setLayer}
      setLayers={setLayers}
      selectedIds={selectedIds}
      setSelectedIds={setSelectedIds}
      selectedLayer={selectedLayer}
      selectedLayers={selectedLayers}
      selBounds={selBounds}
      editableSel={editableSel}
      symbolCache={symbolCache}
      addImageFromFile={addImageFromFile}
      addLayer={addLayer}
      moveLayer={moveLayer}
      deleteLayer={deleteLayer}
      moveLayersToTarget={moveLayersToTarget}
      doExport={doExport}
      doCopyImage={doCopyImage}
      slug={slug}
      rulers={rulers}
      fit={fit}
      zoomMode={zoomMode}
      setZoomMode={setZoomMode}
      zoomIn={zoomIn}
      zoomOut={zoomOut}
      grid={grid}
      setGrid={setGrid}
      wrapOffset={wrapOffset}
      rulerTopRef={rulerTopRef}
      rulerLeftRef={rulerLeftRef}
      canvasRef={canvasRef}
      wrapRef={wrapRef}
      labelRef={labelRef}
      editingTextId={editingTextId}
      onLayerPointerDown={onLayerPointerDown}
      onCanvasPointerDown={onCanvasPointerDown}
      onLayerContextMenu={onLayerContextMenu}
      onLayerDoubleClick={onLayerDoubleClick}
      onStagePointerDown={onStagePointerDown}
      onStageContextMenu={onStageContextMenu}
      startCanvasResize={startCanvasResize}
      snapGuides={snapGuides}
      hudLabel={hudLabel}
      startLayerResize={startLayerResize}
      startRotate={startRotate}
      startGroupResize={startGroupResize}
      startGroupRotate={startGroupRotate}
      marquee={marquee}
      editingDraft={editingDraft}
      setEditingDraft={setEditingDraft}
      commitTextEdit={commitTextEdit}
      cancelTextEdit={cancelTextEdit}
      alignLayer={alignLayer}
      distribute={distribute}
      flipSelected={flipSelected}
      duplicateLayer={duplicateLayer}
      deleteSelected={deleteSelected}
      clipboardRef={clipboardRef}
      pasteClipboardAt={pasteClipboardAt}
      selectAll={selectAll}
      pasteClipboard={pasteClipboard}
      reorderSelected={reorderSelected}
      exportMsg={exportMsg}
      ctxMenu={ctxMenu}
      setCtxMenu={setCtxMenu}
      frameSelection={frameSelection}
      copySelected={copySelected}
      currentDocId={currentDocId}
      docs={docs}
      newDocument={newDocument}
      openDocument={openDocument}
      renameDocument={renameDocument}
      deleteDocument={deleteDocument}
      onHome={onHome}
    />
    </SwatchContext.Provider>
  );

}

// Hydration gate: the open document loads from IndexedDB (async), so we resolve
// it before mounting the editor — keeping useHistoryState synchronous from an
// already-loaded design (no flash, no spurious undo step on first paint).
export function App({ onHome } = {}) {
  const [initialDoc, setInitialDoc] = useState(null);
  useEffect(() => {
    let alive = true;
    loadInitialDocument(makeInitialDesign).then(doc => { if (alive) setInitialDoc(doc); });
    return () => { alive = false; };
  }, []);
  if (!initialDoc) return <div className="app-booting" aria-hidden="true" />;
  return <Studio initialDoc={initialDoc} onHome={onHome} />;
}
