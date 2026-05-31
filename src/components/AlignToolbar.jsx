import { AlignIcon, FlipIcon } from './editorChrome.jsx';

export function AlignToolbar({
  editableSel,
  preview,
  alignLayer,
  distribute,
  flipSelected,
  duplicateLayer,
  deleteSelected,
}) {
  // ---------- Align / arrange toolbar ----------
  if (editableSel.length < 1 || preview) return null;
  return (
          <div className="align-toolbar">
            <button className="icon-btn" title="Align left" onClick={() => alignLayer('left')}><AlignIcon axis="x" pos="start" /></button>
            <button className="icon-btn" title="Align horizontal center" onClick={() => alignLayer('cx')}><AlignIcon axis="x" pos="center" /></button>
            <button className="icon-btn" title="Align right" onClick={() => alignLayer('right')}><AlignIcon axis="x" pos="end" /></button>
            <span className="tb-sep" />
            <button className="icon-btn" title="Align top" onClick={() => alignLayer('top')}><AlignIcon axis="y" pos="start" /></button>
            <button className="icon-btn" title="Align vertical center" onClick={() => alignLayer('cy')}><AlignIcon axis="y" pos="center" /></button>
            <button className="icon-btn" title="Align bottom" onClick={() => alignLayer('bottom')}><AlignIcon axis="y" pos="end" /></button>
            {editableSel.length >= 3 && (
              <>
                <span className="tb-sep" />
                <button className="icon-btn" title="Distribute horizontally" onClick={() => distribute('x')}>
                  <svg viewBox="0 0 16 16" width="18" height="18">
                    <rect x="1.5" y="3" width="2.5" height="10" rx="1" fill="currentColor" />
                    <rect x="6.75" y="3" width="2.5" height="10" rx="1" fill="currentColor" />
                    <rect x="12" y="3" width="2.5" height="10" rx="1" fill="currentColor" />
                  </svg>
                </button>
                <button className="icon-btn" title="Distribute vertically" onClick={() => distribute('y')}>
                  <svg viewBox="0 0 16 16" width="18" height="18">
                    <rect x="3" y="1.5" width="10" height="2.5" rx="1" fill="currentColor" />
                    <rect x="3" y="6.75" width="10" height="2.5" rx="1" fill="currentColor" />
                    <rect x="3" y="12" width="10" height="2.5" rx="1" fill="currentColor" />
                  </svg>
                </button>
              </>
            )}
            <span className="tb-sep" />
            <button className="icon-btn" title="Flip horizontal" onClick={() => flipSelected('h')}><FlipIcon axis="h" /></button>
            <button className="icon-btn" title="Flip vertical" onClick={() => flipSelected('v')}><FlipIcon axis="v" /></button>
            <span className="tb-sep" />
            <button className="icon-btn" title="Duplicate" onClick={duplicateLayer}>
              <svg viewBox="0 0 16 16" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.4">
                <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
                <path d="M10.5 5.5V4A1.5 1.5 0 0 0 9 2.5H4A1.5 1.5 0 0 0 2.5 4v5A1.5 1.5 0 0 0 4 10.5h1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <button className="icon-btn danger" title="Delete" onClick={deleteSelected}>
              <svg viewBox="0 0 16 16" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.6 4.5l.6 8.4a1 1 0 0 0 1 .9h3.6a1 1 0 0 0 1-.9l.6-8.4" />
              </svg>
            </button>
          </div>
  );
}