// Marketing / intro screen shown before the editor. Industrial safety-signage
// aesthetic: dark technical canvas, the editor's real severity palette as the
// accent system, hazard-stripe motifs and a warning-triangle mark. Reuses the
// live SEVERITY/FORMATS data so the copy can't drift from the product.
import { useEffect } from 'react';
import { SEVERITY, FORMATS } from './Label.jsx';
import './landing.css';

const SIGNALS = ['danger', 'warning', 'caution', 'notice', 'safety'];

const FEATURES = [
  { tag: '01 / FORMATS', title: 'Templates or blank canvas',
    body: 'ANSI headers, GHS chemical labels, lockout tags, barricade strips and PPE signs — or a blank canvas for stickers, asset tags and shipping labels.' },
  { tag: '02 / PICTOGRAMS', title: 'ISO 7010 + GHS library',
    body: 'Compliant safety symbols — hazard diamonds, mandatory, prohibition, fire and first-aid — or drop in your own artwork.' },
  { tag: '03 / EDITOR', title: 'A real layer editor',
    body: 'Drag, snap, align, rotate and stack layers. Per-corner radius, blend modes, knockout holes and live severity theming.' },
  { tag: '04 / CODES', title: 'Barcodes & QR',
    body: 'Generate scannable Code 39, dense decorative barcodes and QR-style codes right alongside your shapes.' },
  { tag: '05 / EXPORT', title: 'Vector & raster out',
    body: 'Crisp SVG, PNG at 1×–4×, or copy straight to the clipboard for email, docs and chat.' },
  { tag: '06 / LOCAL', title: 'Yours, on this device',
    body: 'Autosaves to your browser with reusable presets. No account, no upload, no tracking.' },
];

// Decorative barcode bars for the hero asset sticker: [x, width] pairs laid out
// as alternating bars/gaps (viewBox 0 0 150 46).
const BARCODE_BARS = (() => {
  const w = [3, 2, 2, 4, 2, 3, 2, 2, 5, 2, 3, 2, 4, 2, 2, 3, 2, 5, 2, 2, 4, 2, 3, 2, 2, 4, 3, 2, 2, 5, 2, 3, 2, 2, 4, 2, 3, 2];
  const bars = []; let x = 3;
  for (let i = 0; i < w.length; i++) { if (i % 2 === 0) bars.push([x, w[i]]); x += w[i] + 1.5; }
  return bars;
})();

// Iconic yellow high-voltage triangle — the hero label's pictogram, drawn inline
// so it needs no symbol fetch.
function BoltMark() {
  return (
    <svg viewBox="0 0 100 100" aria-hidden="true">
      <path d="M50 7 L93 88 L7 88 Z" fill="#FFD200" stroke="#111" strokeWidth="6" strokeLinejoin="round" />
      <path d="M55 27 L36 57 L48 57 L43 78 L66 45 L53 45 Z" fill="#111" />
    </svg>
  );
}

function TagMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinejoin="round" strokeLinecap="round">
      <path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z" />
      <circle cx="7.5" cy="7.5" r="1.3" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function Landing({ skip, onSkipChange, onLaunch }) {
  // Let the page scroll: the editor pins html/body/#root to height:100%.
  useEffect(() => {
    document.documentElement.classList.add('show-landing');
    return () => document.documentElement.classList.remove('show-landing');
  }, []);

  const formatNames = FORMATS.filter(f => f.id !== 'blank').map(f => f.name);

  return (
    <div className="landing">
      <div className="l-bg" aria-hidden="true">
        <div className="l-grid" />
        <div className="l-glow" />
        <div className="l-grain" />
      </div>

      {/* ---------- Nav ---------- */}
      <header className="l-nav">
        <div className="l-brand">
          <span className="l-brand-mark"><TagMark /></span>
          <span className="l-brand-name">Label Studio</span>
        </div>
        <button className="l-ghost" onClick={onLaunch}>Open the Studio →</button>
      </header>

      {/* ---------- Hero ---------- */}
      <main className="l-hero">
        <div className="l-hero-text">
          <p className="l-eyebrow"><span className="l-tick" />Safety · GHS · Barcodes · Stickers</p>
          <h1 className="l-title">
            From danger signs<br />to <span className="l-title-hi">barcode stickers.</span>
          </h1>

          <ul className="l-signals" aria-label="Signal words">
            {SIGNALS.map((s, i) => (
              <li key={s} style={{ '--d': `${0.5 + i * 0.08}s`, background: SEVERITY[s].band, color: SEVERITY[s].bandInk }}>
                {SEVERITY[s].word}
              </li>
            ))}
          </ul>

          <p className="l-sub">
            One studio for every label — ANSI &amp; ISO 7010 safety signs, GHS chemical labels,
            lockout tags, asset stickers and scannable barcodes. Start from a template or a
            blank canvas, then export pixel-perfect SVG / PNG. Free, local, no account.
          </p>

          <div className="l-cta-row">
            <button className="l-cta" onClick={onLaunch}>
              Open the Studio
              <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M4 12h15M13 6l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </button>
            <span className="l-cta-note">No install · runs entirely on your device</span>
          </div>

          <label className="l-skip">
            <input type="checkbox" checked={!!skip} onChange={e => onSkipChange(e.target.checked)} />
            <span className="l-skip-box" aria-hidden="true">
              <svg viewBox="0 0 16 16"><path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </span>
            <span>Skip this intro — open the Studio directly next time</span>
          </label>
        </div>

        {/* Hero art: a CSS-rendered ANSI "DANGER" label, the actual product. */}
        <div className="l-hero-art" aria-hidden="true">
          <div className="l-stripe" />
          <div className="l-card">
            <div className="l-card-band">DANGER</div>
            <div className="l-card-body">
              <div className="l-card-picto"><BoltMark /></div>
              <div className="l-card-title">HIGH VOLTAGE</div>
              <div className="l-card-msg">Hazardous voltage inside.<br />Disconnect power before servicing.</div>
              <ul className="l-card-bullets">
                <li>Authorized personnel only.</li>
                <li>Lock out before opening.</li>
              </ul>
            </div>
          </div>
          <div className="l-sticker">
            <svg className="l-sticker-bars" viewBox="0 0 150 46" preserveAspectRatio="none">
              {BARCODE_BARS.map((b, i) => <rect key={i} x={b[0]} y="0" width={b[1]} height="46" fill="#111" />)}
            </svg>
            <div className="l-sticker-code">ASSET · 0042 · WH-3</div>
          </div>
        </div>
      </main>

      {/* ---------- Hazard divider ---------- */}
      <div className="l-hazard" aria-hidden="true" />

      {/* ---------- Features ---------- */}
      <section className="l-features">
        <div className="l-features-head">
          <p className="l-eyebrow"><span className="l-tick" />The toolkit</p>
          <h2>From safety signs to barcode stickers — one editor for every label.</h2>
        </div>
        <div className="l-grid-cards">
          {FEATURES.map((f, i) => (
            <article className="l-card-feat" key={f.tag} style={{ '--d': `${i * 0.06}s` }}>
              <span className="l-feat-tag">{f.tag}</span>
              <h3>{f.title}</h3>
              <p>{f.body}</p>
            </article>
          ))}
        </div>
        <div className="l-formats">
          <span className="l-formats-label">Included formats</span>
          <div className="l-formats-viewport">
            <div className="l-formats-track">
              {formatNames.concat(formatNames).map((n, i) => <span key={i}>{n}</span>)}
            </div>
          </div>
        </div>
      </section>

      {/* ---------- Footer / closing CTA ---------- */}
      <footer className="l-foot">
        <div className="l-foot-cta">
          <h2>Ready when you are.</h2>
          <button className="l-cta" onClick={onLaunch}>
            Open the Studio
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M4 12h15M13 6l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
        </div>
        <p className="l-disclaimer">
          Provided as-is — you are responsible for ensuring labels meet applicable safety
          regulations. Symbols: Wikimedia Commons (ISO 7010 · GHS · ISO 7001).
        </p>
      </footer>
    </div>
  );
}
