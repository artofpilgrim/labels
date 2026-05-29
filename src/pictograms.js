// Manifest of hazard symbols sourced from ISO 7010 (Wikimedia Commons).
// Each entry references an SVG in public/symbols/; symbols.js fetches and
// base64-caches them at startup so the embedded <image> tags stay
// self-contained for PNG export. `kind` drives the category grouping in the
// symbol picker (see PICTO_GROUPS in App.jsx).
//
// W = warning (yellow triangle), P = prohibition (red circle/slash),
// M = mandatory (blue circle), E = safe condition (green), F = fire (red).
// The original 18 keep their friendly ids (e.g. `bolt`) so existing saved
// designs/presets keep resolving; newer additions are keyed by ISO code.

export const PICTOGRAMS = {
  // ---------- Warning (W) ----------
  exclamation: { name: 'General hazard',        file: 'W001.svg', code: 'W001', kind: 'warning' },
  W002:        { name: 'Explosive material',    file: 'W002.svg', code: 'W002', kind: 'warning' },
  radiation:   { name: 'Radioactive',           file: 'W003.svg', code: 'W003', kind: 'warning' },
  laser:       { name: 'Laser beam',            file: 'W004.svg', code: 'W004', kind: 'warning' },
  W005:        { name: 'Non-ionizing radiation', file: 'W005.svg', code: 'W005', kind: 'warning' },
  W006:        { name: 'Magnetic field',        file: 'W006.svg', code: 'W006', kind: 'warning' },
  W007:        { name: 'Floor obstacle',        file: 'W007.svg', code: 'W007', kind: 'warning' },
  fall:        { name: 'Fall hazard',           file: 'W008.svg', code: 'W008', kind: 'warning' },
  biohazard:   { name: 'Biological hazard',     file: 'W009.svg', code: 'W009', kind: 'warning' },
  W010:        { name: 'Low temperature',       file: 'W010.svg', code: 'W010', kind: 'warning' },
  slip:        { name: 'Slippery surface',      file: 'W011.svg', code: 'W011', kind: 'warning' },
  bolt:        { name: 'Electrical hazard',     file: 'W012.svg', code: 'W012', kind: 'warning' },
  W013:        { name: 'Guard dog',             file: 'W013.svg', code: 'W013', kind: 'warning' },
  forklift:    { name: 'Industrial truck',      file: 'W014.svg', code: 'W014', kind: 'warning' },
  W015:        { name: 'Overhead load',         file: 'W015.svg', code: 'W015', kind: 'warning' },
  skull:       { name: 'Toxic',                 file: 'W016.svg', code: 'W016', kind: 'warning' },
  hot:         { name: 'Hot surface',           file: 'W017.svg', code: 'W017', kind: 'warning' },
  W018:        { name: 'Automatic start-up',    file: 'W018.svg', code: 'W018', kind: 'warning' },
  W019:        { name: 'Crushing hazard',       file: 'W019.svg', code: 'W019', kind: 'warning' },
  W020:        { name: 'Overhead obstacle',     file: 'W020.svg', code: 'W020', kind: 'warning' },
  flame:       { name: 'Flammable',             file: 'W021.svg', code: 'W021', kind: 'warning' },
  W022:        { name: 'Sharp element',         file: 'W022.svg', code: 'W022', kind: 'warning' },
  corrosive:   { name: 'Corrosive',             file: 'W023.svg', code: 'W023', kind: 'warning' },
  crush:       { name: 'Crushing of hands',     file: 'W024.svg', code: 'W024', kind: 'warning' },
  W025:        { name: 'Counter-rotating rollers', file: 'W025.svg', code: 'W025', kind: 'warning' },
  W026:        { name: 'Battery charging',      file: 'W026.svg', code: 'W026', kind: 'warning' },
  W027:        { name: 'Optical radiation',     file: 'W027.svg', code: 'W027', kind: 'warning' },
  W028:        { name: 'Oxidizing substance',   file: 'W028.svg', code: 'W028', kind: 'warning' },
  W029:        { name: 'Pressurized cylinder',  file: 'W029.svg', code: 'W029', kind: 'warning' },
  W035:        { name: 'Falling objects',       file: 'W035.svg', code: 'W035', kind: 'warning' },

  // ---------- Prohibition (P) ----------
  noEntry:     { name: 'No entry',              file: 'P001.svg', code: 'P001', kind: 'prohibition' },
  noSmoking:   { name: 'No smoking',            file: 'P002.svg', code: 'P002', kind: 'prohibition' },
  P003:        { name: 'No open flame',         file: 'P003.svg', code: 'P003', kind: 'prohibition' },
  P004:        { name: 'No thoroughfare',       file: 'P004.svg', code: 'P004', kind: 'prohibition' },
  P005:        { name: 'Not drinking water',    file: 'P005.svg', code: 'P005', kind: 'prohibition' },
  P006:        { name: 'No forklift trucks',    file: 'P006.svg', code: 'P006', kind: 'prohibition' },
  P007:        { name: 'No pacemakers',         file: 'P007.svg', code: 'P007', kind: 'prohibition' },
  P010:        { name: 'Do not touch',          file: 'P010.svg', code: 'P010', kind: 'prohibition' },
  P011:        { name: 'Do not extinguish with water', file: 'P011.svg', code: 'P011', kind: 'prohibition' },
  P013:        { name: 'No mobile phones',      file: 'P013.svg', code: 'P013', kind: 'prohibition' },
  P022:        { name: 'No eating or drinking', file: 'P022.svg', code: 'P022', kind: 'prohibition' },
  P024:        { name: 'Do not walk here',      file: 'P024.svg', code: 'P024', kind: 'prohibition' },
  P028:        { name: 'Do not wear gloves',    file: 'P028.svg', code: 'P028', kind: 'prohibition' },
  P029:        { name: 'No photography',        file: 'P029.svg', code: 'P029', kind: 'prohibition' },
  P031:        { name: 'Do not alter switch',   file: 'P031.svg', code: 'P031', kind: 'prohibition' },

  // ---------- Mandatory (M) ----------
  M001:        { name: 'General mandatory',     file: 'M001.svg', code: 'M001', kind: 'mandatory' },
  M002:        { name: 'Refer to manual',       file: 'M002.svg', code: 'M002', kind: 'mandatory' },
  ears:        { name: 'Hearing protection',    file: 'M003.svg', code: 'M003', kind: 'mandatory' },
  glasses:     { name: 'Eye protection',        file: 'M004.svg', code: 'M004', kind: 'mandatory' },
  M005:        { name: 'Connect earth ground',  file: 'M005.svg', code: 'M005', kind: 'mandatory' },
  M008:        { name: 'Wear foot protection',  file: 'M008.svg', code: 'M008', kind: 'mandatory' },
  M009:        { name: 'Wear protective gloves', file: 'M009.svg', code: 'M009', kind: 'mandatory' },
  M010:        { name: 'Wear protective clothing', file: 'M010.svg', code: 'M010', kind: 'mandatory' },
  M013:        { name: 'Wear face shield',      file: 'M013.svg', code: 'M013', kind: 'mandatory' },
  hardHat:     { name: 'Head protection',       file: 'M014.svg', code: 'M014', kind: 'mandatory' },
  M015:        { name: 'Wear hi-vis clothing',  file: 'M015.svg', code: 'M015', kind: 'mandatory' },
  M016:        { name: 'Wear a mask',           file: 'M016.svg', code: 'M016', kind: 'mandatory' },
  M017:        { name: 'Wear respiratory protection', file: 'M017.svg', code: 'M017', kind: 'mandatory' },
  M018:        { name: 'Wear safety harness',   file: 'M018.svg', code: 'M018', kind: 'mandatory' },
  M026:        { name: 'Wear protective apron', file: 'M026.svg', code: 'M026', kind: 'mandatory' },

  // ---------- Safe condition (E) ----------
  E001:        { name: 'Emergency exit (left)', file: 'E001.svg', code: 'E001', kind: 'safe' },
  E002:        { name: 'Emergency exit (right)', file: 'E002.svg', code: 'E002', kind: 'safe' },
  E003:        { name: 'First aid',             file: 'E003.svg', code: 'E003', kind: 'safe' },
  E004:        { name: 'Emergency telephone',   file: 'E004.svg', code: 'E004', kind: 'safe' },
  E007:        { name: 'Assembly point',        file: 'E007.svg', code: 'E007', kind: 'safe' },
  E010:        { name: 'Defibrillator (AED)',   file: 'E010.svg', code: 'E010', kind: 'safe' },
  E011:        { name: 'Eyewash station',       file: 'E011.svg', code: 'E011', kind: 'safe' },
  E012:        { name: 'Safety shower',         file: 'E012.svg', code: 'E012', kind: 'safe' },
  E013:        { name: 'Stretcher',             file: 'E013.svg', code: 'E013', kind: 'safe' },
  E015:        { name: 'Drinking water',        file: 'E015.svg', code: 'E015', kind: 'safe' },

  // ---------- Fire equipment (F) ----------
  F001:        { name: 'Fire extinguisher',     file: 'F001.svg', code: 'F001', kind: 'fire' },
  F002:        { name: 'Fire hose reel',        file: 'F002.svg', code: 'F002', kind: 'fire' },
  F003:        { name: 'Fire ladder',           file: 'F003.svg', code: 'F003', kind: 'fire' },
  F004:        { name: 'Firefighting equipment', file: 'F004.svg', code: 'F004', kind: 'fire' },
  F005:        { name: 'Fire alarm call point', file: 'F005.svg', code: 'F005', kind: 'fire' },
  F006:        { name: 'Fire emergency telephone', file: 'F006.svg', code: 'F006', kind: 'fire' },
};
