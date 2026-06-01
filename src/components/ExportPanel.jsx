import { Field } from './ui.jsx';

export function ExportPanel({ docName, design, doExport, doCopyImage, slug }) {
  const exportBody = (
    <>
      <Field label="Filename" hint="From the label name — rename it in the top bar.">
        <div className="export-filename">{slug(docName)}</div>
      </Field>
      <Field label="Vector">
        <button className="export-btn primary" onClick={() => doExport('svg')}>
          <span>Download SVG</span>
          <span className="ext">{slug(docName)}.svg</span>
        </button>
      </Field>
      <Field label="Raster" hint={`Native ${design.width} × ${design.height}px.`}>
        <div className="export-grid">
          {[1, 2, 3, 4].map(s => (
            <button key={s} className="export-btn" onClick={() => doExport('png', s)}>
              <span className="scale">{s}×</span>
              <span className="px">{design.width * s} × {design.height * s}</span>
            </button>
          ))}
        </div>
      </Field>
      <Field label="Clipboard" hint="Paste straight into email, docs or chat.">
        <button className="export-btn" onClick={doCopyImage}>
          <span>Copy image (PNG)</span>
          <span className="ext">@2×</span>
        </button>
      </Field>
    </>
  );

  return exportBody;
}