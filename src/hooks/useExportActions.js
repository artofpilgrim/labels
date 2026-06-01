import { useCallback, useRef, useState } from 'react';
import { slug } from '../core/design.js';
import { exportSvg, exportPng, svgToPngBlob } from '../core/export.js';

export function useExportActions({ labelRef, symbolCache, design, docName, setExportOpen }) {
  const [exportMsg, setExportMsg] = useState('');
  // One shared clear-timer so a new toast cancels the previous one's timeout —
  // otherwise overlapping messages (the 2.2–4.2s holds below) clear each other
  // early. `flash` is the transient toast; `persist` is a status that stays until
  // the next message (but still cancels a pending clear so a stale timer can't
  // wipe it). Threaded to the other hooks in place of setExportMsg.
  const timerRef = useRef(null);
  const flash = useCallback((text, ms = 2600) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setExportMsg(text);
    timerRef.current = setTimeout(() => { timerRef.current = null; setExportMsg(''); }, ms);
  }, []);
  const persist = useCallback((text) => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    setExportMsg(text);
  }, []);

  function doExport(kind, scale) {
    const svg = labelRef.current && labelRef.current.getSvg();
    if (!svg) return;
    if (!symbolCache) {
      flash('Loading symbols - try again in a moment', 2200);
      return;
    }
    const missing = design.layers.filter(
      l => l.type === 'image' && !l.hidden && !l.src && l.symbol && !symbolCache[l.symbol]
    ).length;
    const note = missing
      ? ` - ${missing} symbol${missing > 1 ? 's' : ''} failed to load; reload and re-export`
      : '';
    const hold = missing ? 4200 : 2200;
    const name = slug(docName);
    setExportOpen(false);
    if (kind === 'svg') {
      exportSvg(svg, name);
      flash('Exported SVG' + note, hold);
    } else {
      persist('Rendering PNG...');
      exportPng(svg, name, scale, (ok) => {
        flash(ok ? `Exported PNG @${scale}x` + note : `PNG too large at ${scale}x - try a smaller scale`, ok ? hold : 2600);
      });
    }
  }

  function doCopyImage() {
    const svg = labelRef.current && labelRef.current.getSvg();
    if (!svg) return;
    if (!navigator.clipboard || typeof window.ClipboardItem === 'undefined') {
      flash('Clipboard not supported here - use Export instead', 2800);
      return;
    }
    setExportOpen(false);
    persist('Copying...');
    svgToPngBlob(svg, 2, (b) => {
      if (!b) {
        flash('Copy failed - try Export', 2600);
        return;
      }
      navigator.clipboard.write([new window.ClipboardItem({ 'image/png': b })])
        .then(() => flash('Copied to clipboard', 2200))
        .catch(() => flash('Copy failed - try Export', 2600));
    });
  }

  return { exportMsg, flash, doExport, doCopyImage };
}
