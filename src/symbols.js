// ISO 7010 symbol loader + cache. Fetches each SVG once, encodes it as a
// base64 data URL so the rendered <image> tags stay self-contained for PNG
// export, and serves hrefs to the renderer via pictoHref().
import { PICTOGRAMS } from './pictograms.js';

// Module-scoped cache. loadSymbols() (called once by App) populates it; the
// renderer reads it through pictoHref(). App also stashes the result in React
// state so the re-render that reveals the pictograms is triggered.
let SYMBOL_CACHE = {};

function svgToDataUrl(text) {
  const utf8 = unescape(encodeURIComponent(text));
  return 'data:image/svg+xml;base64,' + btoa(utf8);
}

export async function loadSymbols() {
  const entries = Object.entries(PICTOGRAMS);
  const results = await Promise.all(entries.map(async ([id, p]) => {
    try {
      // BASE_URL (defaults to '/') keeps the fetch correct if the app is ever
      // deployed under a sub-path; public/symbols/ is served at <base>symbols/.
      const r = await fetch(`${import.meta.env.BASE_URL}symbols/${p.file}`);
      if (!r.ok) throw new Error(`${r.status}`);
      const text = await r.text();
      return [id, svgToDataUrl(text)];
    } catch (err) {
      // Surface load failures (404 / wrong BASE_URL / offline) so blank tiles
      // are diagnosable instead of silent. The empty entry degrades gracefully.
      console.warn(`Hazard Label Studio: failed to load symbol "${id}" (${p.file})`, err);
      return [id, ''];
    }
  }));
  SYMBOL_CACHE = Object.fromEntries(results);
  return SYMBOL_CACHE;
}

export function pictoHref(id) {
  return SYMBOL_CACHE[id] || '';
}
