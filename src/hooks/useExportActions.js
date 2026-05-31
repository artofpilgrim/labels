import { useState } from 'react';
import { slug } from '../core/design.js';
import { exportSvg, exportPng, svgToPngBlob } from '../core/export.js';

export function useExportActions({ labelRef, symbolCache, design, docName, setExportOpen }) {
  const [exportMsg, setExportMsg] = useState('');

  function doExport(kind, scale) {
    const svg = labelRef.current && labelRef.current.getSvg();
    if (!svg) return;
    if (!symbolCache) {
      setExportMsg('Loading symbols - try again in a moment');
      setTimeout(() => setExportMsg(''), 2200);
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
      setExportMsg('Exported SVG' + note);
      setTimeout(() => setExportMsg(''), hold);
    } else {
      setExportMsg('Rendering PNG...');
      exportPng(svg, name, scale, (ok) => {
        setExportMsg(ok ? `Exported PNG @${scale}x` + note : `PNG too large at ${scale}x - try a smaller scale`);
        setTimeout(() => setExportMsg(''), ok ? hold : 2600);
      });
    }
  }

  function doCopyImage() {
    const svg = labelRef.current && labelRef.current.getSvg();
    if (!svg) return;
    if (!navigator.clipboard || typeof window.ClipboardItem === 'undefined') {
      setExportMsg('Clipboard not supported here - use Export instead');
      setTimeout(() => setExportMsg(''), 2800);
      return;
    }
    setExportOpen(false);
    setExportMsg('Copying...');
    svgToPngBlob(svg, 2, (b) => {
      if (!b) {
        setExportMsg('Copy failed - try Export');
        setTimeout(() => setExportMsg(''), 2600);
        return;
      }
      navigator.clipboard.write([new window.ClipboardItem({ 'image/png': b })])
        .then(() => { setExportMsg('Copied to clipboard'); setTimeout(() => setExportMsg(''), 2200); })
        .catch(() => { setExportMsg('Copy failed - try Export'); setTimeout(() => setExportMsg(''), 2600); });
    });
  }

  return { exportMsg, setExportMsg, doExport, doCopyImage };
}
