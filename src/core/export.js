export function svgToString(svgEl) {
  const clone = svgEl.cloneNode(true);
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
  return '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(clone);
}

export function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function exportSvg(svgEl, name) {
  download(new Blob([svgToString(svgEl)], { type: 'image/svg+xml;charset=utf-8' }), `${name}.svg`);
}

export function svgToPngBlob(svgEl, scale, onBlob) {
  const str = svgToString(svgEl);
  const w = parseFloat(svgEl.getAttribute('width'));
  const h = parseFloat(svgEl.getAttribute('height'));
  const url = URL.createObjectURL(new Blob([str], { type: 'image/svg+xml;charset=utf-8' }));
  const done = (b) => { URL.revokeObjectURL(url); onBlob(b); };
  const img = new Image();
  img.onload = () => {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(w * scale);
      canvas.height = Math.round(h * scale);
      const ctx = canvas.getContext('2d');
      if (!ctx) { done(null); return; }
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(b => done(b), 'image/png');
    } catch {
      done(null);
    }
  };
  img.onerror = () => done(null);
  img.src = url;
}

export function exportPng(svgEl, name, scale, onDone) {
  svgToPngBlob(svgEl, scale, (b) => {
    if (!b) {
      if (onDone) onDone(false);
      return;
    }
    download(b, `${name}@${scale}x.png`);
    if (onDone) onDone(true);
  });
}
