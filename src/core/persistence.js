import { isRenderableDesign } from './design.js';

export const DESIGN_AUTOSAVE_KEY = 'hazardLabelStudio.design';
export const DOC_NAME_KEY = 'hazardLabelStudio.docName';

export function loadSavedDesign() {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(DESIGN_AUTOSAVE_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw);
    if (isRenderableDesign(d)) return d;
  } catch {
    // Corrupted storage is ignored so callers can fall back to a preset.
  }
  return null;
}
