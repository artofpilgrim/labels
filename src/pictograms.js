// Manifest of hazard symbols sourced from ISO 7010 (Wikimedia Commons).
// Each entry references an SVG in public/symbols/; symbols.js fetches and
// base64-caches them at startup so the embedded <image> tags stay
// self-contained for PNG export.
//
// W-series = warning (yellow triangle), M-series = mandatory (blue circle),
// P-series = prohibition (red circle with slash). The plate shape is part of the SVG.

export const PICTOGRAMS = {
  exclamation: { name: 'General hazard',     file: 'W001.svg', code: 'W001', kind: 'warning' },
  bolt:        { name: 'Electrical hazard',  file: 'W012.svg', code: 'W012', kind: 'warning' },
  flame:       { name: 'Flammable',          file: 'W021.svg', code: 'W021', kind: 'warning' },
  skull:       { name: 'Toxic',              file: 'W016.svg', code: 'W016', kind: 'warning' },
  biohazard:   { name: 'Biological hazard',  file: 'W009.svg', code: 'W009', kind: 'warning' },
  radiation:   { name: 'Radioactive',        file: 'W003.svg', code: 'W003', kind: 'warning' },
  hot:         { name: 'Hot surface',        file: 'W017.svg', code: 'W017', kind: 'warning' },
  slip:        { name: 'Slippery surface',   file: 'W011.svg', code: 'W011', kind: 'warning' },
  crush:       { name: 'Crushing of hands',  file: 'W024.svg', code: 'W024', kind: 'warning' },
  fall:        { name: 'Fall hazard',        file: 'W008.svg', code: 'W008', kind: 'warning' },
  corrosive:   { name: 'Corrosive',          file: 'W023.svg', code: 'W023', kind: 'warning' },
  forklift:    { name: 'Industrial truck',   file: 'W014.svg', code: 'W014', kind: 'warning' },
  laser:       { name: 'Laser beam',         file: 'W004.svg', code: 'W004', kind: 'warning' },
  noEntry:     { name: 'No entry',           file: 'P001.svg', code: 'P001', kind: 'prohibition' },
  noSmoking:   { name: 'No smoking',         file: 'P002.svg', code: 'P002', kind: 'prohibition' },
  glasses:     { name: 'Eye protection',     file: 'M004.svg', code: 'M004', kind: 'mandatory' },
  hardHat:     { name: 'Head protection',    file: 'M014.svg', code: 'M014', kind: 'mandatory' },
  ears:        { name: 'Hearing protection', file: 'M003.svg', code: 'M003', kind: 'mandatory' },
};
