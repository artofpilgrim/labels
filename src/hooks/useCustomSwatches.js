import { useCallback, useEffect, useState } from 'react';
import { idb } from '../core/idb.js';

const isHex = (c) => /^#[0-9a-f]{6}$/i.test((c || '').trim());
const norm = (c) => (c || '').trim().toLowerCase();
const MAX = 12;   // keep the palette small and tidy — newest first

// The user's saved colour palette, persisted in IndexedDB kv (same store as
// userPresets). Shared across every ColorInput via SwatchContext.
export function useCustomSwatches() {
  const [customSwatches, setCustomSwatches] = useState([]);

  useEffect(() => {
    let alive = true;
    idb.kvGet('customSwatches').then(v => {
      if (alive && Array.isArray(v)) setCustomSwatches(v.filter(isHex).map(norm).slice(0, MAX));
    }).catch(() => { /* unavailable/corrupt → start empty */ });
    return () => { alive = false; };
  }, []);

  const addSwatch = useCallback((c) => {
    if (!isHex(c)) return;
    const v = norm(c);
    setCustomSwatches(cur => {
      if (cur.includes(v)) return cur;               // de-dup
      const next = [v, ...cur].slice(0, MAX);        // newest first, capped
      idb.kvSet('customSwatches', next).catch(() => {});
      return next;
    });
  }, []);

  const removeSwatch = useCallback((c) => {
    const v = norm(c);
    setCustomSwatches(cur => {
      const next = cur.filter(x => x !== v);
      idb.kvSet('customSwatches', next).catch(() => {});
      return next;
    });
  }, []);

  return { customSwatches, addSwatch, removeSwatch };
}
