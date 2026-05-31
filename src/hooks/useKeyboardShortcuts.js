import { useEffect } from 'react';

export function useKeyboardShortcuts({
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
}) {
  // ----- keyboard -----
  useEffect(() => {
    function onKey(e) {
      // A modal overlay owns the screen and brings its own Esc/Tab handling.
      // Suppress every editor shortcut so documented keys (Ctrl+D, Delete,
      // arrows, zoom) can't mutate the canvas behind it.
      if (helpOpen || exportOpen) return;
      const t = e.target;
      const inField = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA');

      // Undo / Redo work globally (also while a text input is focused, so
      // the user can undo their last typed character) — match standard
      // editor shortcuts on both Win/Linux (Ctrl) and macOS (Cmd).
      const mod = e.ctrlKey || e.metaKey;
      // Undo / redo work even while a field is focused (undo the typed char).
      if (mod && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        if (e.shiftKey) redo(); else undo();
        return;
      }
      if (mod && (e.key === 'y' || e.key === 'Y')) {
        e.preventDefault(); redo(); return;
      }
      // Zoom (global; gated on the modifier so it never blocks typing). Overrides
      // the browser's own Ctrl +/-/0 page zoom.
      if (mod && (e.key === '=' || e.key === '+' || e.code === 'Equal' || e.code === 'NumpadAdd')) { e.preventDefault(); zoomIn(); return; }
      if (mod && (e.key === '-' || e.key === '_' || e.code === 'Minus' || e.code === 'NumpadSubtract')) { e.preventDefault(); zoomOut(); return; }
      if (mod && (e.key === '0' || e.code === 'Digit0' || e.code === 'Numpad0')) { e.preventDefault(); setZoomMode(1); return; }
      // Zoom-to-fit lives on Shift+1 (below the inField guard, like Shift+2). Ctrl+9
      // is a browser tab-switch accelerator that page preventDefault can't intercept.
      if (inField) return;   // below: editor shortcuts, suppressed while typing
      // Work regardless of selection:
      if (mod && (e.key === 'a' || e.key === 'A')) { e.preventDefault(); selectAll(); return; }
      if (mod && (e.key === 'v' || e.key === 'V')) { e.preventDefault(); pasteClipboard(); return; }
      // Zoom-to-fit (Shift+1) works regardless of selection.
      if (e.shiftKey && !mod && !e.altKey && e.code === 'Digit1') { e.preventDefault(); setZoomMode('fit'); return; }
      if (selectedIds.length === 0) return;
      // Need a selection:
      if (mod && (e.key === 'c' || e.key === 'C')) { e.preventDefault(); copySelected(); return; }
      if (mod && (e.key === 'd' || e.key === 'D')) { e.preventDefault(); duplicateLayer(); return; }
      if (mod && e.key === ']') { e.preventDefault(); reorderSelected(e.shiftKey ? 'front' : 'forward'); return; }
      if (mod && e.key === '[') { e.preventDefault(); reorderSelected(e.shiftKey ? 'back' : 'backward'); return; }
      // Align (Alt + key); Alt+Shift on the centre keys distributes. Uses e.code
      // so it's layout-independent and unaffected by Alt producing glyphs.
      if (e.altKey && !mod) {
        const c = e.code;
        if (c === 'KeyA') { e.preventDefault(); alignLayer('left'); return; }
        // Align-right is Alt+Shift+D: plain Alt+D is a browser address-bar (omnibox)
        // accelerator that page preventDefault can't suppress, so it would steal focus.
        if (c === 'KeyD' && e.shiftKey) { e.preventDefault(); alignLayer('right'); return; }
        if (c === 'KeyW') { e.preventDefault(); alignLayer('top'); return; }
        if (c === 'KeyS') { e.preventDefault(); alignLayer('bottom'); return; }
        if (c === 'KeyH') { e.preventDefault(); if (e.shiftKey) distribute('x'); else alignLayer('cx'); return; }
        if (c === 'KeyV') { e.preventDefault(); if (e.shiftKey) distribute('y'); else alignLayer('cy'); return; }
      }
      // Zoom to selection (frameSelection no-ops without a selection).
      if (e.shiftKey && !mod && !e.altKey && e.code === 'Digit2') { e.preventDefault(); frameSelection(); return; }
      // If an overlay is open, let its own Esc handler close it and leave the
      // selection intact — otherwise one Escape both dismisses the overlay and
      // wipes the selection.
      if (e.key === 'Escape') {
        if (ctxMenu || exportOpen || helpOpen) return;
        setSelectedIds([]);
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault(); deleteSelected();
      } else if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        setDesign(d => ({
          ...d,
          layers: d.layers.map(l => (selectedIds.includes(l.id) && !l.locked) ? { ...l, x: l.x + dx, y: l.y + dy } : l),
        }));
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [selectedIds, deleteSelected, undo, redo, duplicateLayer, copySelected, pasteClipboard, selectAll, reorderSelected, alignLayer, distribute, ctxMenu, exportOpen, helpOpen]);
}
