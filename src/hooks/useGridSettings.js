import { useEffect, useState } from 'react';

const GRID_KEY = 'hazardLabelStudio.grid';

function initialGrid() {
  try {
    const s = JSON.parse(localStorage.getItem(GRID_KEY) || 'null');
    if (s && typeof s === 'object') {
      const smart = !!s.smart;
      return { show: !!s.show, snap: smart ? false : !!s.snap, smart, step: Math.max(2, Math.min(200, s.step || 10)) };
    }
  } catch {
    // Ignore malformed persisted settings.
  }
  return { show: false, snap: false, step: 10, smart: false };
}

export function useGridSettings() {
  const [grid, setGrid] = useState(initialGrid);

  useEffect(() => {
    try { localStorage.setItem(GRID_KEY, JSON.stringify(grid)); } catch { /* ignore */ }
  }, [grid]);

  return [grid, setGrid];
}
