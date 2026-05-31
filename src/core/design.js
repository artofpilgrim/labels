import { KNOWN_LAYER_TYPES } from './constants.js';

export function slug(name) {
  const s = (name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return s || 'label';
}

export function isRenderableDesign(d) {
  return !!(d && Array.isArray(d.layers) && d.layers.length
    && Number.isFinite(d.width) && Number.isFinite(d.height)
    && d.layers.every(l => l && KNOWN_LAYER_TYPES.has(l.type)
        && ['x', 'y', 'w', 'h'].every(k => Number.isFinite(l[k]))));
}
