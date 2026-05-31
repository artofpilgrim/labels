import { useSyncExternalStore } from 'react';

// Persisted open/closed state for the right-panel accordion sections.
//
// Keyed by a stable GROUP id ('transform', 'appearance', 'effects', …), NOT a
// layer id — so collapsing "Appearance" stays collapsed as you click between
// layers, instead of resetting on every selection (the old per-instance
// useState lost the choice the moment the panel re-mounted). A tiny external
// store lets any <Section id="…"> subscribe without threading a context.
const KEY = 'hazardLabelStudio.sections';

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || 'null');
    return (s && typeof s === 'object') ? s : {};
  } catch {
    return {};
  }
}

let state = load();
const listeners = new Set();

function emit() {
  for (const l of listeners) l();
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* ignore quota/availability */ }
}

function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// Returns [open, toggle] for a section id. `defaultOpen` is the first-ever
// fallback before the user has expressed a preference for this group.
export function useSectionOpen(id, defaultOpen = true) {
  const open = useSyncExternalStore(
    subscribe,
    () => (state[id] === undefined ? defaultOpen : state[id]),
  );
  const toggle = () => {
    const cur = state[id] === undefined ? defaultOpen : state[id];
    state = { ...state, [id]: !cur };
    emit();
  };
  return [open, toggle];
}
