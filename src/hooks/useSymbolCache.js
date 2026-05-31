import { useEffect, useState } from 'react';
import { loadSymbols } from '../symbols.js';

export function useSymbolCache() {
  const [symbolCache, setSymbolCache] = useState(null);

  useEffect(() => {
    loadSymbols().then(setSymbolCache);
  }, []);

  return symbolCache;
}
