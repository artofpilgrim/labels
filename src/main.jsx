import { createRoot } from 'react-dom/client';
import { useState, useCallback } from 'react';
import { App } from './App.jsx';
import { Landing } from './Landing.jsx';
import './styles.css';

// Persisted preference: when set, the landing intro is skipped on load and the
// editor opens directly. Toggled from the landing's "Skip this intro" checkbox;
// re-enabled by unchecking it (reach the landing again via the editor's brand).
const SKIP_KEY = 'hazardLabelStudio.skipLanding';
const readSkip = () => { try { return localStorage.getItem(SKIP_KEY) === '1'; } catch { return false; } };

function Root() {
  const [skip, setSkip] = useState(readSkip);
  const [view, setView] = useState(() => (readSkip() ? 'editor' : 'landing'));

  const changeSkip = useCallback((v) => {
    setSkip(v);
    try { v ? localStorage.setItem(SKIP_KEY, '1') : localStorage.removeItem(SKIP_KEY); } catch { /* ignore */ }
  }, []);

  if (view === 'landing') {
    return <Landing skip={skip} onSkipChange={changeSkip} onLaunch={() => setView('editor')} />;
  }
  return <App onHome={() => setView('landing')} />;
}

createRoot(document.getElementById('root')).render(<Root />);
