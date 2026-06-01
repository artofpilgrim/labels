import { createContext, useContext, useEffect, useId, useRef } from 'react';

// Promise-based, app-styled replacement for window.confirm(). A component does
// `const confirm = useConfirm(); if (await confirm({ title, message, confirmLabel,
// danger })) { … }`. The controller (pending resolver + opts) lives in App and
// renders <ConfirmDialog> at the root; hooks get `confirm` passed as a param.
export const ConfirmContext = createContext(() => Promise.resolve(false));
export const useConfirm = () => useContext(ConfirmContext);

export function ConfirmDialog({ opts, onResolve }) {
  const ref = useRef(null);
  const titleId = useId();
  useEffect(() => {
    const prevFocus = document.activeElement;
    const dialog = ref.current;
    const go = dialog && dialog.querySelector('.confirm-go');
    if (go) go.focus();   // Enter confirms — matches the native confirm() this replaces
    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); onResolve(false); return; }
      if (e.key === 'Tab' && dialog) {
        const f = dialog.querySelectorAll('button');
        if (f.length) {
          const first = f[0], last = f[f.length - 1];
          if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
          else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        }
      }
      // Isolate the modal: block global editor shortcuts (Delete, arrows, undo…)
      // while it's open. Enter/Space still activate the focused button — that
      // fires a separate click event, unaffected by stopping the keydown here.
      e.stopPropagation();
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      if (prevFocus && prevFocus.focus) prevFocus.focus();
    };
  }, [onResolve]);

  return (
    <div className="modal-backdrop" onMouseDown={() => onResolve(false)}>
      <div ref={ref} tabIndex={-1} className="modal confirm-modal" role="alertdialog"
           aria-modal="true" aria-labelledby={titleId} onMouseDown={e => e.stopPropagation()}>
        <h2 id={titleId} className="confirm-title">{opts.title}</h2>
        {opts.message && <p className="confirm-msg">{opts.message}</p>}
        <div className="confirm-actions">
          <button type="button" className="btn-lg" onClick={() => onResolve(false)}>
            {opts.cancelLabel || 'Cancel'}
          </button>
          <button type="button" className={`btn-lg confirm-go ${opts.danger ? 'primary' : 'on'}`}
                  onClick={() => onResolve(true)}>
            {opts.confirmLabel || 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  );
}
