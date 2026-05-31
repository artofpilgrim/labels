import { Label } from '../renderer/Label.jsx';
import { SEVERITY, FONTS } from '../core/constants.js';
import { toScreen } from '../core/coordinates.js';
import { AlignToolbar } from './AlignToolbar.jsx';
import { CanvasBottomBar } from './CanvasBottomBar.jsx';
import { Handles } from './editorChrome.jsx';

export function CanvasArea({
  design,
  preview,
  rulerTopRef,
  rulerLeftRef,
  topRuler,
  leftRuler,
  canvasRef,
  labelRef,
  onStagePointerDown,
  onStageContextMenu,
  wrapRef,
  fit,
  wrapOffset,
  symbolCache,
  editingTextId,
  onLayerPointerDown,
  onCanvasPointerDown,
  onLayerContextMenu,
  onLayerDoubleClick,
  grid,
  startCanvasResize,
  snapGuides,
  selectedLayer,
  hudLabel,
  startLayerResize,
  startRotate,
  selectedIds,
  selBounds,
  selectedLayers,
  startGroupResize,
  startGroupRotate,
  marquee,
  editingDraft,
  setEditingDraft,
  commitTextEdit,
  cancelTextEdit,
  editableSel,
  alignLayer,
  distribute,
  flipSelected,
  duplicateLayer,
  deleteSelected,
  setGrid,
  zoomMode,
  setZoomMode,
  zoomOut,
  zoomIn
}) {
  return (
      <main className="canvas-area">
        <div className={`canvas-rulers${preview ? ' no-rulers' : ''}`}>
          {!preview && <div className="ruler-corner" />}
          {!preview && <div className="ruler ruler-top" ref={rulerTopRef}>{topRuler}</div>}
          {!preview && <div className="ruler ruler-left" ref={rulerLeftRef}>{leftRuler}</div>}
          <div
            className="canvas-stage"
            ref={canvasRef}
            onMouseDown={onStagePointerDown}
            onContextMenu={onStageContextMenu}
          >
          <div
            ref={wrapRef}
            className="label-wrap"
            style={{
              width: toScreen(design.width, fit),
              height: toScreen(design.height, fit),
              position: 'relative',
              transform: `translate(${wrapOffset.x}px, ${wrapOffset.y}px)`,
            }}
          >
            <div style={{
              transform: `scale(${fit})`,
              transformOrigin: 'top left',
              width: design.width,
              height: design.height,
            }}>
              <Label
                ref={labelRef}
                design={design}
                symbolsReady={!!symbolCache}
                editingId={editingTextId}
                onLayerPointerDown={onLayerPointerDown}
                onCanvasPointerDown={onCanvasPointerDown}
                onLayerContextMenu={onLayerContextMenu}
                onLayerDoubleClick={onLayerDoubleClick}
              />
            </div>

            {grid.show && (
              <div className="overlay" style={{
                backgroundImage: 'linear-gradient(to right, var(--line-strong) 1px, transparent 1px), linear-gradient(to bottom, var(--line-strong) 1px, transparent 1px)',
                backgroundSize: `${toScreen(grid.step, fit)}px ${toScreen(grid.step, fit)}px`,
                opacity: 0.5,
              }} />
            )}

            {/* Canvas dimension handles (hidden in preview) */}
            {!preview && (
              <div className="overlay">
                <Handles
                  kind="canvas"
                  box={{ x: 0, y: 0, w: design.width, h: design.height }}
                  fit={fit}
                  onHandleDown={(e, mode) => startCanvasResize(e, mode)}
                />
              </div>
            )}

            {/* Snap guides (only during Ctrl-drag) */}
            {snapGuides.length > 0 && (
              <div className="overlay">
                {snapGuides.map((g, i) => {
                  if (g.kind === 'gap') {
                    return g.orient === 'h' ? (
                      <div key={`g${i}`} className="gap-guide h" style={{ left: toScreen(Math.min(g.x1, g.x2), fit), top: toScreen(g.y, fit), width: toScreen(Math.abs(g.x2 - g.x1), fit) }} />
                    ) : (
                      <div key={`g${i}`} className="gap-guide v" style={{ left: toScreen(g.x, fit), top: toScreen(Math.min(g.y1, g.y2), fit), height: toScreen(Math.abs(g.y2 - g.y1), fit) }} />
                    );
                  }
                  return g.orient === 'v' ? (
                    <div key={`v${i}`} className="snap-guide v" style={{ left: toScreen(g.value, fit) }} />
                  ) : (
                    <div key={`h${i}`} className="snap-guide h" style={{ top: toScreen(g.value, fit) }} />
                  );
                })}
              </div>
            )}

            {/* Selected-layer handles + dimension chip */}
            {selectedLayer && !selectedLayer.locked && !preview && editingTextId !== selectedLayer.id && (
              <div className="overlay">
                <div className="dim-chip" style={{
                  left: toScreen(selectedLayer.x + selectedLayer.w / 2, fit),
                  top: toScreen(selectedLayer.y + selectedLayer.h, fit) + 8,
                }}>
                  {hudLabel(selectedLayer.w, selectedLayer.h)}
                </div>
                <Handles
                  kind="layer"
                  box={selectedLayer}
                  fit={fit}
                  rotation={selectedLayer.rotation || 0}
                  onHandleDown={(e, mode) => startLayerResize(e, mode)}
                  onRotateDown={startRotate}
                />
              </div>
            )}

            {/* Multi-select: group bounding box + per-layer outlines */}
            {!preview && selectedIds.length >= 2 && selBounds && (
              <div className="overlay">
                {selectedLayers.map(l => (
                  <div key={l.id} className="sel-thin" style={{
                    left: toScreen(l.x, fit), top: toScreen(l.y, fit), width: toScreen(l.w, fit), height: toScreen(l.h, fit),
                    transform: l.rotation ? `rotate(${l.rotation}deg)` : undefined,
                    transformOrigin: 'center',
                  }} />
                ))}
                <div className="dim-chip" style={{
                  left: toScreen(selBounds.x + selBounds.w / 2, fit),
                  top: toScreen(selBounds.y + selBounds.h, fit) + 8,
                }}>
                  {hudLabel(selBounds.w, selBounds.h)}
                </div>
                <div className="group-box" style={{
                  left: toScreen(selBounds.x, fit), top: toScreen(selBounds.y, fit),
                  width: toScreen(selBounds.w, fit), height: toScreen(selBounds.h, fit),
                }} />
                <Handles
                  kind="group"
                  box={selBounds}
                  fit={fit}
                  cornersOnly
                  showOutline={false}
                  onHandleDown={(e, mode) => startGroupResize(e, mode)}
                  onRotateDown={startGroupRotate}
                />
              </div>
            )}

            {/* Marquee rubber-band */}
            {marquee && (
              <div className="overlay">
                <div className="marquee" style={{
                  left: toScreen(marquee.x, fit), top: toScreen(marquee.y, fit),
                  width: toScreen(marquee.w, fit), height: toScreen(marquee.h, fit),
                }} />
              </div>
            )}

            {/* Inline text editor — a positioned textarea over the (hidden) text layer */}
            {editingTextId && !preview && (() => {
              const l = design.layers.find(x => x.id === editingTextId);
              if (!l || l.type !== 'text') return null;
              const sev = SEVERITY[design.severity] || SEVERITY.danger;
              const fontSize = Math.max(4, l.fontSize || 16);
              const color = l.bindSeverity === 'band' ? sev.band
                : l.bindSeverity === 'bandInk' ? sev.bandInk
                : (l.fill || '#000000');
              return (
                <div className="overlay">
                  <textarea
                    className="inline-edit"
                    autoFocus
                    value={editingDraft}
                    onChange={e => setEditingDraft(e.target.value)}
                    onKeyDown={e => {
                      e.stopPropagation();
                      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commitTextEdit(); }
                      else if (e.key === 'Escape') { e.preventDefault(); cancelTextEdit(); }
                    }}
                    onBlur={commitTextEdit}
                    style={{
                      left: toScreen(l.x, fit), top: toScreen(l.y, fit),
                      width: toScreen(l.w, fit), height: toScreen(l.h, fit),
                      transform: l.rotation ? `rotate(${l.rotation}deg)` : undefined,
                      transformOrigin: 'center',
                      fontFamily: FONTS[l.fontFamily] || FONTS.sans,
                      fontSize: toScreen(fontSize, fit),
                      fontWeight: l.fontWeight || 400,
                      fontStyle: l.italic ? 'italic' : 'normal',
                      lineHeight: l.lineHeight || 1.2,
                      letterSpacing: toScreen((l.letterSpacing || 0) * fontSize, fit),
                      textAlign: l.align === 'middle' ? 'center' : l.align === 'end' ? 'right' : 'left',
                      textTransform: l.uppercase ? 'uppercase' : 'none',
                      color,
                    }}
                  />
                </div>
              );
            })()}
          </div>
          </div>
        </div>

        <AlignToolbar
          editableSel={editableSel}
          preview={preview}
          alignLayer={alignLayer}
          distribute={distribute}
          flipSelected={flipSelected}
          duplicateLayer={duplicateLayer}
          deleteSelected={deleteSelected}
        />

        <CanvasBottomBar
          design={design}
          grid={grid}
          setGrid={setGrid}
          zoomMode={zoomMode}
          setZoomMode={setZoomMode}
          zoomOut={zoomOut}
          zoomIn={zoomIn}
          fit={fit}
        />
      </main>
  );
}
