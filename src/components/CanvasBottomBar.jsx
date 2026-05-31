import { NumberInput } from './ui.jsx';

export function CanvasBottomBar({
  design,
  grid,
  setGrid,
  zoomMode,
  setZoomMode,
  zoomOut,
  zoomIn,
  fit,
}) {
  return (
        <div className="canvas-bottom">
          <span className="dim-readout">{design.width} × {design.height}px</span>
          <span className="canvas-credit" title="Labels are provided as-is — you are responsible for ensuring they meet applicable safety regulations. Symbols from Wikimedia Commons (ISO 7010, GHS, ISO 7001).">
            Provided as-is — you're responsible for meeting applicable safety regulations. Symbols: Wikimedia Commons (ISO 7010 · GHS · ISO 7001).
          </span>
          <div className="canvas-grid-ctl">
            <button className={`icon-btn${grid.show ? ' on' : ''}`} aria-pressed={grid.show} title="Show grid"
                    onClick={() => setGrid(g => ({ ...g, show: !g.show }))}>
              <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.2">
                <rect x="2" y="2" width="12" height="12" rx="1" /><line x1="6" y1="2" x2="6" y2="14" /><line x1="10" y1="2" x2="10" y2="14" /><line x1="2" y1="6" x2="14" y2="6" /><line x1="2" y1="10" x2="14" y2="10" />
              </svg>
            </button>
            <button className={`icon-btn${grid.snap ? ' on' : ''}`} aria-pressed={grid.snap} title="Snap to grid"
                    onClick={() => setGrid(g => { const snap = !g.snap; return { ...g, snap, smart: snap ? false : g.smart }; })}>
              <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor">
                {[3, 8, 13].flatMap(x => [3, 8, 13].map(y => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.3" />))}
              </svg>
            </button>
            <button className={`icon-btn${grid.smart ? ' on' : ''}`} aria-pressed={grid.smart} title="Smart guides (align + equal spacing)"
                    onClick={() => setGrid(g => { const smart = !g.smart; return { ...g, smart, snap: smart ? false : g.snap }; })}>
              <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.3">
                <line x1="2.5" y1="3" x2="2.5" y2="13" /><line x1="13.5" y1="3" x2="13.5" y2="13" /><line x1="8" y1="5" x2="8" y2="11" />
                <path d="M4 8 H6.5 M9.5 8 H12" strokeWidth="1" />
              </svg>
            </button>
            <NumberInput value={grid.step} min={2} max={200} step={1} live={false} ariaLabel="Grid size (px)" title="Grid size (px)"
                         onChange={v => setGrid(g => ({ ...g, step: Math.max(2, Math.min(200, Math.round(v) || g.step)) }))} />
          </div>
          <div className="canvas-zoom">
            <button className={`icon-btn${zoomMode === 'fit' ? ' on' : ''}`} aria-pressed={zoomMode === 'fit'} title="Fit to viewport" onClick={() => setZoomMode('fit')}>⤢</button>
            <button className="icon-btn" title="Zoom out" onClick={zoomOut}>−</button>
            <input
              className="zoom-slider"
              type="range" min={0.05} max={4} step={0.01}
              value={fit}
              onChange={e => setZoomMode(Number(e.target.value))}
              aria-label="Zoom level"
              aria-valuetext={`${Math.round(fit * 100)}%`}
              title="Zoom"
            />
            <button className="icon-btn" title="Zoom in" onClick={zoomIn}>+</button>
            <button className="zoom-pct" title="Reset to 100%" onClick={() => setZoomMode(1)}>{Math.round(fit * 100)}%</button>
          </div>
        </div>
  );
}