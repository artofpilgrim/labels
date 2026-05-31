import { useCallback, useEffect, useRef, useState } from 'react';

const HISTORY_LIMIT = 100;
const COMMIT_DEBOUNCE_MS = 400;

export function useHistoryState(initialDesign) {
  const [editor, setEditor] = useState(() => ({
    design: typeof initialDesign === 'function' ? initialDesign() : initialDesign,
    past: [],
    future: [],
  }));

  const design = editor.design;
  const lastCommittedDesign = useRef(editor.design);
  const commitTimerRef = useRef(null);
  const inDragRef = useRef(false);

  const setDesign = useCallback((updater) => {
    setEditor(e => {
      const nd = typeof updater === 'function' ? updater(e.design) : updater;
      return nd === e.design ? e : { ...e, design: nd };
    });
  }, []);

  useEffect(() => {
    if (editor.design === lastCommittedDesign.current) return;
    if (inDragRef.current) return;
    if (commitTimerRef.current) clearTimeout(commitTimerRef.current);
    commitTimerRef.current = setTimeout(() => {
      commitTimerRef.current = null;
      setEditor(e => {
        if (e.design === lastCommittedDesign.current) return e;
        const snapshot = lastCommittedDesign.current;
        lastCommittedDesign.current = e.design;
        return {
          design: e.design,
          past: [...e.past, snapshot].slice(-HISTORY_LIMIT),
          future: [],
        };
      });
    }, COMMIT_DEBOUNCE_MS);
    return () => {};
  }, [editor.design]);

  const forceCommit = useCallback(() => {
    if (commitTimerRef.current) {
      clearTimeout(commitTimerRef.current);
      commitTimerRef.current = null;
    }
    setEditor(e => {
      if (e.design === lastCommittedDesign.current) return e;
      const snapshot = lastCommittedDesign.current;
      lastCommittedDesign.current = e.design;
      return {
        design: e.design,
        past: [...e.past, snapshot].slice(-HISTORY_LIMIT),
        future: [],
      };
    });
  }, []);

  const undo = useCallback(() => {
    if (commitTimerRef.current) {
      clearTimeout(commitTimerRef.current);
      commitTimerRef.current = null;
    }
    setEditor(e => {
      if (e.design !== lastCommittedDesign.current) {
        return {
          ...e,
          design: lastCommittedDesign.current,
          future: [e.design],
        };
      }
      if (e.past.length === 0) return e;
      const prev = e.past[e.past.length - 1];
      lastCommittedDesign.current = prev;
      return {
        design: prev,
        past: e.past.slice(0, -1),
        future: [e.design, ...e.future].slice(0, HISTORY_LIMIT),
      };
    });
  }, []);

  const redo = useCallback(() => {
    forceCommit();
    setEditor(e => {
      if (e.future.length === 0) return e;
      const next = e.future[0];
      lastCommittedDesign.current = next;
      return {
        design: next,
        past: [...e.past, e.design].slice(-HISTORY_LIMIT),
        future: e.future.slice(1),
      };
    });
  }, [forceCommit]);

  return {
    design,
    setDesign,
    forceCommit,
    inDragRef,
    undo,
    redo,
    canUndo: editor.past.length > 0 || editor.design !== lastCommittedDesign.current,
    canRedo: editor.future.length > 0,
  };
}
