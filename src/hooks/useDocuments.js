import { useCallback, useEffect, useRef, useState } from 'react';
import { isRenderableDesign } from '../core/design.js';
import { idb } from '../core/idb.js';
import { uid } from '../uid.js';

// The local "my labels" file system. Owns the saved-document list, which one is
// open, the per-document autosave (debounced, drives the top-bar save status),
// and new/open/rename/delete. All persistence lives here so App just consumes it.
export function useDocuments({
  initialDoc,
  design,
  docName,
  setDocName,
  setSaveState,
  resetHistory,
  setSelectedIds,
  setWrapOffset,
  setActivePresetId,
  makeDefaultDesign,
  flash,
}) {
  const [currentDocId, setCurrentDocId] = useState(initialDoc.id);
  const [docs, setDocs] = useState([]);              // lightweight {id,name,updatedAt} list

  // Latest values for the async actions / debounced save, without re-binding.
  const designRef = useRef(design); designRef.current = design;
  const nameRef = useRef(docName); nameRef.current = docName;
  const idRef = useRef(currentDocId); idRef.current = currentDocId;

  // Baseline of what's durably saved for the open document. Opening or mounting a
  // doc sets this to the loaded value so the autosave doesn't re-write it (which
  // would re-stamp updatedAt, reorder the library, and flash "saving" for a doc
  // the user only viewed). null means "treat as dirty" (e.g. a failed save).
  const savedDesignRef = useRef(initialDoc.design);
  const savedNameRef = useRef(initialDoc.name);
  const saveTimerRef = useRef(null);

  const isDirty = () => designRef.current !== savedDesignRef.current || nameRef.current !== savedNameRef.current;
  const cancelSave = useCallback(() => {
    if (saveTimerRef.current) { clearTimeout(saveTimerRef.current); saveTimerRef.current = null; }
  }, []);

  const refresh = useCallback(() => idb.getAllDocs().then(all => {
    setDocs((all || [])
      .map(d => ({ id: d.id, name: d.name, updatedAt: d.updatedAt || 0 }))
      .sort((a, b) => b.updatedAt - a.updatedAt));
  }).catch(() => {}), []);

  useEffect(() => { refresh(); }, [refresh]);

  // Write the open document now and record it as the new saved baseline. Updates
  // the in-memory list only on success, so a failed write never reads as "saved".
  const persist = useCallback((updatedAt) => {
    const id = idRef.current, name = nameRef.current, d = designRef.current;
    savedDesignRef.current = d;
    savedNameRef.current = name;
    return idb.putDoc({ id, name, design: d, updatedAt }).then(() => {
      setDocs(list => [{ id, name, updatedAt }, ...list.filter(x => x.id !== id)]);
      return true;
    }).catch(() => {
      savedDesignRef.current = null;            // stay dirty so the next change retries
      flash('Could not save — storage may be full', 3000);
      return false;
    });
  }, [flash]);

  // Debounced autosave of the open document. Skips no-op opens/mounts (not dirty)
  // so viewing a label never re-stamps it. Intentionally NOT guarded against the
  // mid-drag re-runs: setSaveState('saving') is idempotent (React bails when the
  // value is unchanged, so a drag costs one re-render, not one per frame), and a
  // naive `if (inDragRef.current) return` would be unsafe here — forceCommit
  // reuses the same `design` reference, so clearing the drag flag would not
  // re-fire this effect and the post-drag write would be dropped. The per-change
  // timer reschedule below IS the debounce: only the trailing write lands.
  useEffect(() => {
    if (!isDirty()) return;
    setSaveState('saving');
    const t = setTimeout(() => {
      saveTimerRef.current = null;
      persist(Date.now()).then(() => setSaveState('saved'));
    }, 500);
    saveTimerRef.current = t;
    return () => clearTimeout(t);
  }, [design, docName, currentDocId, persist, setSaveState]);

  // Flush any unsaved edits immediately and cancel the pending timer — used
  // before switching away so the open doc's latest state is durable and no stale
  // timer can later fire against the wrong document.
  const flushCurrent = useCallback(() => {
    cancelSave();
    if (!isDirty()) return Promise.resolve(false);
    return persist(Date.now());
  }, [cancelSave, persist]);

  // Load a document object into the editor as a fresh baseline (not an edit).
  const applyDoc = useCallback((doc) => {
    cancelSave();
    savedDesignRef.current = doc.design;
    savedNameRef.current = doc.name;
    resetHistory(doc.design);
    setDocName(doc.name);
    setCurrentDocId(doc.id);
    idRef.current = doc.id;
    setSelectedIds([]);
    setWrapOffset({ x: 0, y: 0 });
    if (setActivePresetId) setActivePresetId(null);
    idb.kvSet('currentDocId', doc.id).catch(() => {});
  }, [cancelSave, resetHistory, setDocName, setSelectedIds, setWrapOffset, setActivePresetId]);

  const newDocument = useCallback(async () => {
    await flushCurrent();
    const doc = { id: uid(), name: 'Untitled Label', design: makeDefaultDesign(), updatedAt: Date.now() };
    await idb.putDoc(doc).catch(() => {});
    applyDoc(doc);
    refresh();
  }, [flushCurrent, makeDefaultDesign, applyDoc, refresh]);

  const openDocument = useCallback(async (id) => {
    if (id === idRef.current) return;
    await flushCurrent();
    const doc = await idb.getDoc(id).catch(() => null);
    if (!doc || !isRenderableDesign(doc.design)) {
      flash('That label could not be opened', 2600);
      refresh();
      return;
    }
    applyDoc(doc);
    refresh();
  }, [flushCurrent, applyDoc, refresh, flash]);

  const renameDocument = useCallback(async (id, name) => {
    const trimmed = (name || '').trim() || 'Untitled Label';
    if (id === idRef.current) {
      // Persist the rename immediately so a reload within the debounce can't drop
      // it, and update the saved-name baseline so the autosave doesn't re-write.
      setDocName(trimmed);
      savedNameRef.current = trimmed;
      await idb.putDoc({ id, name: trimmed, design: designRef.current, updatedAt: Date.now() }).catch(() => {});
      refresh();
      return;
    }
    const doc = await idb.getDoc(id).catch(() => null);
    if (!doc) return;
    await idb.putDoc({ ...doc, name: trimmed }).catch(() => {});  // keep updatedAt — a rename isn't an edit
    refresh();
  }, [setDocName, refresh]);

  const deleteDocument = useCallback(async (id) => {
    // Cancel any pending autosave for the open doc first, else its timer could
    // fire mid-delete and re-insert (resurrect) the document we just removed.
    if (id === idRef.current) cancelSave();
    await idb.delDoc(id).catch(() => {});
    if (id === idRef.current) {
      const all = (await idb.getAllDocs().catch(() => [])) || [];
      const valid = all.filter(d => d && isRenderableDesign(d.design))
        .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
      if (valid.length) applyDoc(valid[0]);
      else {
        const doc = { id: uid(), name: 'Untitled Label', design: makeDefaultDesign(), updatedAt: Date.now() };
        await idb.putDoc(doc).catch(() => {});
        applyDoc(doc);
      }
    }
    refresh();
  }, [cancelSave, applyDoc, makeDefaultDesign, refresh]);

  return { currentDocId, docs, newDocument, openDocument, renameDocument, deleteDocument };
}
