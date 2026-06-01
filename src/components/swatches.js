import { createContext, useContext } from 'react';

// Shared custom-colour palette (saved swatches). Provided once at the editor
// root and read by every ColorInput, so a colour saved in one picker shows up
// in all of them without threading props through 13 call sites.
export const SwatchContext = createContext({
  customSwatches: [],
  addSwatch: () => {},
  removeSwatch: () => {},
});

export const useSwatches = () => useContext(SwatchContext);
