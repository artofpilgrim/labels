// Pseudo-barcode + (real) Code 39 generation for the 'barcode' layer.
//
// Everything here is PURE and DOM-free so the SVG renderer (Label.jsx) and the
// PNG exporter (which rasterizes that same SVG) share one source of geometry.
// Bars are emitted in abstract "module units"; the renderer scales them to the
// layer's pixel box. Output is deterministic — a given data string always maps
// to the same pattern (no Math.random, which would reshuffle on every paint).

export const BARCODE_VARIANTS = [
  { value: 'code128', label: 'Bars' },     // dense decorative linear (default)
  { value: 'code39',  label: 'Code 39' },  // real, scannable for its charset
  { value: 'qr',      label: 'QR' },        // decorative 2D matrix
];

// ---------- deterministic hash + PRNG ----------
// FNV-1a over the data string, then mulberry32 to expand it into a stream of
// reproducible [0,1) values. Used by the decorative (non-Code-39) generators.
function hash32(str) {
  let h = 2166136261 >>> 0;
  const s = String(str == null ? '' : str);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// ---------- Code 39 (real) ----------
// Each character is 9 elements — bar,space,bar,…,bar (index 0 is a bar) — where
// '1' is a wide element and '0' is narrow; every glyph has exactly three wides.
// '*' is the start/stop sentinel. This is a genuine Code 39 symbology, so the
// output scans for the supported charset (0-9 A-Z space - . $ / + %).
const CODE39 = {
  '0': '000110100', '1': '100100001', '2': '001100001', '3': '101100000',
  '4': '000110001', '5': '100110000', '6': '001110000', '7': '000100101',
  '8': '100100100', '9': '001100100', 'A': '100001001', 'B': '001001001',
  'C': '101001000', 'D': '000011001', 'E': '100011000', 'F': '001011000',
  'G': '000001101', 'H': '100001100', 'I': '001001100', 'J': '000011100',
  'K': '100000011', 'L': '001000011', 'M': '101000010', 'N': '000010011',
  'O': '100010010', 'P': '001010010', 'Q': '000000111', 'R': '100000110',
  'S': '001000110', 'T': '000010110', 'U': '110000001', 'V': '011000001',
  'W': '111000000', 'X': '010010001', 'Y': '110010000', 'Z': '011010000',
  '-': '010000101', '.': '110000100', ' ': '011000100', '$': '010101000',
  '/': '010100010', '+': '010001010', '%': '000101010', '*': '010010100',
};
const CODE39_WIDE = 3; // wide:narrow ratio (3:1 — crisp and well within spec)

// Keep only characters Code 39 can encode (uppercased); '*' is reserved for the
// sentinels so it's stripped from the payload. Empty input falls back to '0' so
// the symbol is never just two touching guards.
export function sanitizeCode39(raw) {
  const up = String(raw == null ? '' : raw).toUpperCase();
  let out = '';
  for (const ch of up) if (CODE39[ch] && ch !== '*') out += ch;
  return out || '0';
}

function code39Elements(raw) {
  const text = sanitizeCode39(raw);
  const chars = ('*' + text + '*').split('');
  const elements = [];
  chars.forEach((ch, ci) => {
    const pat = CODE39[ch];
    for (let i = 0; i < 9; i++) {
      elements.push({ bar: i % 2 === 0, units: pat[i] === '1' ? CODE39_WIDE : 1 });
    }
    if (ci < chars.length - 1) elements.push({ bar: false, units: 1 }); // inter-char gap
  });
  return { elements, text };
}

// ---------- Decorative dense linear ("Bars") ----------
// A realistic-looking but non-meaningful sequence of alternating bars/spaces of
// width 1–4 units, seeded by the data so it stays stable. `density` nudges the
// bar count. The count is forced odd so the pattern starts AND ends on a bar.
function pseudoElements(raw, density) {
  const rnd = mulberry32(hash32(raw && String(raw).length ? raw : 'barcode'));
  const len = raw ? String(raw).length : 8;
  const d = Number(density);
  const dens = Number.isFinite(d) && d > 0 ? d : 3;   // tolerate garbage from restored data
  let count = Math.round(len * dens) + 24;
  count = clamp(count, 24, 160);
  if (count % 2 === 0) count++;
  const elements = [];
  let bar = true;
  for (let i = 0; i < count; i++) {
    elements.push({ bar, units: 1 + Math.floor(rnd() * 4) });
    bar = !bar;
  }
  return { elements, text: String(raw == null ? '' : raw) };
}

// Build the linear element list + human-readable text for a variant. Returns
// { elements:[{bar,units}], totalUnits, text }. `quietZone` units are added as
// light margin on both ends so the symbol has the mandatory clear space.
export function buildLinearBarcode(variant, data, density, quietZone) {
  const { elements, text } = variant === 'code39'
    ? code39Elements(data)
    : pseudoElements(data, density);
  // Coerce defensively: a non-finite quietZone would make totalUnits NaN and the
  // renderer would draw nothing. null/undefined/garbage all fall back to 10.
  const qzNum = Number(quietZone);
  const qz = Number.isFinite(qzNum) ? Math.max(0, qzNum) : 10;
  const inner = elements.reduce((s, e) => s + e.units, 0);
  return { elements, text, totalUnits: inner + qz * 2, quietZone: qz };
}

// ---------- Decorative QR-style matrix ----------
// Not a real QR code — a square module grid with the three corner finder
// "eyes", separators, timing rows and hashed data modules. Reads as a QR at a
// glance; it will not decode. `n` (module count per side) scales with payload.
function qrSize(data, hint) {
  // A finite hint must still be clamped to the valid range — below 7 the finder
  // eyes would index negative grid cells and throw, taking the whole canvas down.
  if (hint && Number.isFinite(hint)) {
    const h = clamp(Math.floor(hint), 21, 37);
    return h % 2 === 0 ? h + 1 : h;
  }
  const len = data ? String(data).length : 0;
  let n = 21 + 2 * Math.floor(len / 4);
  n = clamp(n, 21, 37);
  return n % 2 === 0 ? n + 1 : n;
}

function inFinderZone(r, c, n) {
  return (r < 8 && c < 8) || (r < 8 && c >= n - 8) || (r >= n - 8 && c < 8);
}

export function qrModules(data, hint) {
  const n = qrSize(data, hint);
  const grid = Array.from({ length: n }, () => new Array(n).fill(false));

  // 7×7 finder eye: solid border ring + solid 3×3 centre.
  const finder = (r0, c0) => {
    for (let r = 0; r < 7; r++) {
      for (let c = 0; c < 7; c++) {
        const edge = r === 0 || r === 6 || c === 0 || c === 6;
        const center = r >= 2 && r <= 4 && c >= 2 && c <= 4;
        grid[r0 + r][c0 + c] = edge || center;
      }
    }
  };
  finder(0, 0); finder(0, n - 7); finder(n - 7, 0);

  // Timing rows/cols (alternating) across the gap between finders.
  for (let i = 8; i < n - 8; i++) {
    grid[6][i] = i % 2 === 0;
    grid[i][6] = i % 2 === 0;
  }

  // Hashed data modules everywhere that isn't reserved.
  const rnd = mulberry32(hash32(data || ' '));
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (inFinderZone(r, c, n) || r === 6 || c === 6) continue;
      grid[r][c] = rnd() > 0.5;
    }
  }
  return grid;
}
