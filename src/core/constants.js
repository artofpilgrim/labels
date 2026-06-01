export const SEVERITY = {
  danger:  { word: 'DANGER',       band: '#C8102E', bandInk: '#FFFFFF' },
  warning: { word: 'WARNING',      band: '#F36F21', bandInk: '#000000' },
  caution: { word: 'CAUTION',      band: '#FFD200', bandInk: '#000000' },
  notice:  { word: 'NOTICE',       band: '#1057A8', bandInk: '#FFFFFF' },
  safety:  { word: 'SAFETY FIRST', band: '#0E7C4E', bandInk: '#FFFFFF' },
};

export const FONTS = {
  sans: "'Helvetica Neue', Helvetica, Arial, sans-serif",
  serif: "Georgia, 'Times New Roman', serif",
  mono: "'Courier New', Courier, monospace",
};

export const KNOWN_LAYER_TYPES = new Set([
  'rect',
  'text',
  'bullets',
  'image',
  'line',
  'polygon',
  'ellipse',
  'barcode',
  'ink',
]);
