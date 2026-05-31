import { isRenderableDesign } from './design.js';
import { idb } from './idb.js';
import { uid } from '../uid.js';

// Legacy localStorage keys — read once during migration, then retired.
const DESIGN_AUTOSAVE_KEY = 'hazardLabelStudio.design';
const DOC_NAME_KEY = 'hazardLabelStudio.docName';
const USER_PRESETS_KEY = 'hazardLabelStudio.userPresets';

function lsGet(key) {
  try { return typeof localStorage === 'undefined' ? null : localStorage.getItem(key); }
  catch { return null; }
}

// One-time import of pre-IndexedDB data — a single autosaved design + its name,
// plus any saved presets — so existing users don't lose work on the upgrade.
// Guarded by an 'lsMigrated' flag so it never re-imports (e.g. after the user
// deletes the migrated document).
async function migrateFromLocalStorage() {
  if (await idb.kvGet('lsMigrated')) return;

  // Only finalise (set the flag + delete the legacy keys) when every IndexedDB
  // write of recoverable data actually succeeded. A corrupt source is skipped
  // (nothing to lose), but a failed *write* leaves localStorage intact and the
  // flag unset so the next load retries — never discarding the only copy.
  let wrote = true;

  const design = parseIf(lsGet(DESIGN_AUTOSAVE_KEY), isRenderableDesign);
  if (design) {
    try {
      const doc = { id: uid(), name: lsGet(DOC_NAME_KEY) || 'Untitled Label', design, updatedAt: Date.now() };
      await idb.putDoc(doc);
      await idb.kvSet('currentDocId', doc.id);
    } catch { wrote = false; }
  }

  const presets = parseIf(lsGet(USER_PRESETS_KEY), Array.isArray);
  if (presets) {
    try { await idb.kvSet('userPresets', presets); } catch { wrote = false; }
  }

  if (!wrote) return;                       // retry on the next load; keep localStorage
  try { await idb.kvSet('lsMigrated', true); } catch { return; }
  // The data now lives in IndexedDB; free the old localStorage slots.
  try {
    localStorage.removeItem(DESIGN_AUTOSAVE_KEY);
    localStorage.removeItem(DOC_NAME_KEY);
    localStorage.removeItem(USER_PRESETS_KEY);
  } catch { /* ignore */ }
}

// JSON.parse `raw`, returning the value only if it passes `ok`; null otherwise
// (missing, malformed, or rejected — all "nothing to migrate", not an error).
function parseIf(raw, ok) {
  if (!raw) return null;
  try { const v = JSON.parse(raw); return ok(v) ? v : null; }
  catch { return null; }
}

// Resolve the document to open on load: the last-current one, else the most
// recently edited, else a freshly-created default. Always returns a renderable
// { id, name, design, updatedAt }. Falls back to an in-memory default if IDB
// is unavailable, so the editor still opens.
export async function loadInitialDocument(makeDefaultDesign) {
  try {
    await migrateFromLocalStorage();
    const currentId = await idb.kvGet('currentDocId');
    if (currentId) {
      const doc = await idb.getDoc(currentId);
      if (doc && isRenderableDesign(doc.design)) return doc;
    }
    const all = (await idb.getAllDocs()) || [];
    const valid = all.filter(d => d && isRenderableDesign(d.design))
                     .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    if (valid.length) {
      await idb.kvSet('currentDocId', valid[0].id);
      return valid[0];
    }
  } catch {
    // fall through to a fresh default document
  }
  const doc = { id: uid(), name: 'Untitled Label', design: makeDefaultDesign(), updatedAt: Date.now() };
  try { await idb.putDoc(doc); await idb.kvSet('currentDocId', doc.id); } catch { /* ignore */ }
  return doc;
}
