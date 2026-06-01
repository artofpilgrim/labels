import { useState } from 'react';
import { BARCODE_VARIANTS, sanitizeCode39 } from '../barcode.js';
import { starPoints } from '../templates/index.js';
import { uid } from '../uid.js';
import { PinSidesControl, CornerRadius } from './layerControls.jsx';
import { readImageFile, SymbolPicker } from './SymbolPicker.jsx';
import { LayerGlyph, AlignIcon } from './editorChrome.jsx';
import { Field, Section, Row, Seg, NumberInput, ColorInput, Slider } from './ui.jsx';

// Compact quick-action icons (match the app's 1.4-stroke chrome).
const qaSvg = (children) => (
  <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor"
       strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">{children}</svg>
);
const IconCenter = qaSvg(<><rect x="2" y="2" width="12" height="12" rx="1.5" strokeDasharray="2 2" /><rect x="6" y="6" width="4" height="4" rx="0.5" fill="currentColor" stroke="none" /></>);
const IconDup = qaSvg(<><rect x="2.5" y="2.5" width="7.5" height="7.5" rx="1.2" /><rect x="6" y="6" width="7.5" height="7.5" rx="1.2" /></>);
const IconRot = qaSvg(<><path d="M3.4 8a4.6 4.6 0 1 0 1.5-3.4" /><path d="M2.8 3.1V5.6h2.5" /></>);
const IconEye = qaSvg(<><path d="M1.8 8S4.2 4.2 8 4.2 14.2 8 14.2 8 11.8 11.8 8 11.8 1.8 8 1.8 8Z" /><circle cx="8" cy="8" r="1.7" /></>);
const IconEyeOff = qaSvg(<><path d="M2.5 8s2.2-3.4 5.5-3.4c1 0 1.9.2 2.6.6M13.5 8s-.8 1.3-2.2 2.3M6.5 6.6A2 2 0 0 0 8 10" /><line x1="3" y1="3" x2="13" y2="13" /></>);
const IconLock = qaSvg(<><rect x="3.5" y="7" width="9" height="6" rx="1.3" /><path d="M5.6 7V5.2a2.4 2.4 0 0 1 4.8 0V7" /></>);
const IconUnlock = qaSvg(<><rect x="3.5" y="7" width="9" height="6" rx="1.3" /><path d="M5.6 7V5.2a2.4 2.4 0 0 1 4.7-.6" /></>);
const IconTrash = qaSvg(<><path d="M3 4.5h10M6.2 4.5V3.2h3.6V4.5M4.8 4.5 5.4 13h5.2l.6-8.5" /></>);

function QABtn({ title, onClick, disabled, danger, children }) {
  return (
    <button type="button" className={`qa-btn${danger ? ' danger' : ''}`}
            title={title} disabled={disabled} onClick={onClick}>{children}</button>
  );
}

// Per-object quick actions hosted in the properties header (single selection).
function QuickActions({ layer, setLayer, alignLayer, duplicateLayer, deleteSelected }) {
  const locked = !!layer.locked;
  return (
    <div className="qa-bar">
      <QABtn title="Center on canvas" disabled={locked} onClick={() => alignLayer('center')}>{IconCenter}</QABtn>
      <QABtn title="Duplicate" disabled={locked} onClick={duplicateLayer}>{IconDup}</QABtn>
      <QABtn title="Reset rotation" disabled={locked || !layer.rotation} onClick={() => setLayer(layer.id, { rotation: 0 })}>{IconRot}</QABtn>
      <QABtn title={layer.hidden ? 'Show' : 'Hide'} onClick={() => setLayer(layer.id, { hidden: !layer.hidden })}>{layer.hidden ? IconEyeOff : IconEye}</QABtn>
      <QABtn title={locked ? 'Unlock' : 'Lock'} onClick={() => setLayer(layer.id, { locked: !locked })}>{locked ? IconLock : IconUnlock}</QABtn>
      <QABtn title="Delete" danger disabled={locked} onClick={deleteSelected}>{IconTrash}</QABtn>
    </div>
  );
}

// Inline-editable layer name in the header (double-click to rename).
function InlineName({ layer, setLayer }) {
  const [editing, setEditing] = useState(false);
  if (editing) {
    return (
      <input className="ph-name-input" autoFocus defaultValue={layer.name || layer.type}
             onBlur={e => { setLayer(layer.id, { name: e.target.value.trim() || layer.type }); setEditing(false); }}
             onKeyDown={e => {
               if (e.key === 'Enter') e.currentTarget.blur();
               else if (e.key === 'Escape') setEditing(false);
             }} />
    );
  }
  return <span className="ph-name" title={layer.locked ? undefined : 'Double-click to rename'}
               onDoubleClick={() => { if (!layer.locked) setEditing(true); }}>{layer.name || layer.type}</span>;
}

const layerStat = (l) => {
  const rot = l.rotation ? ` · ${Math.round(l.rotation)}°` : '';
  return `${l.type.toUpperCase()} · ${Math.round(l.w)}×${Math.round(l.h)}${rot}`;
};

// "You are here" identity strip at the top of the properties area. Renders in
// three modes — single layer (glyph + name + stat + quick actions), multi-
// select (count + type summary), and no selection (the canvas itself).
function PropsHeader({ canvasW, canvasH, selectedLayer, selectedLayers, selectedIds, setLayer, alignLayer, duplicateLayer, deleteSelected }) {
  if (selectedLayer) {
    const l = selectedLayer;
    return (
      <div className="props-head">
        <span className="ph-glyph"><LayerGlyph type={l.type} /></span>
        <div className="ph-id">
          {/* key by id so an in-progress rename can't leak onto a newly
              selected layer (uncontrolled input keeps its frozen defaultValue). */}
          <InlineName key={l.id} layer={l} setLayer={setLayer} />
          <span className="ph-stat">{layerStat(l)}</span>
        </div>
        <QuickActions layer={l} setLayer={setLayer} alignLayer={alignLayer}
                      duplicateLayer={duplicateLayer} deleteSelected={deleteSelected} />
      </div>
    );
  }
  if (selectedIds.length >= 2) {
    const types = [...new Set(selectedLayers.map(l => l.type))];
    return (
      <div className="props-head">
        <span className="ph-glyph" aria-hidden="true">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3">
            <rect x="2" y="4.5" width="7.5" height="7.5" rx="1" /><path d="M4.8 4.5V2.2h7.3V9.5H9.8" />
          </svg>
        </span>
        <div className="ph-id">
          <span className="ph-name">{selectedIds.length} layers</span>
          <span className="ph-stat">{types.length === 1 ? `${types[0].toUpperCase()} ×${selectedLayers.length}` : 'MIXED TYPES'}</span>
        </div>
      </div>
    );
  }
  return (
    <div className="props-head">
      <span className="ph-glyph" aria-hidden="true">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3">
          <rect x="1.5" y="2.5" width="11" height="9" rx="1" />
        </svg>
      </span>
      <div className="ph-id">
        <span className="ph-name">Canvas</span>
        <span className="ph-stat">{canvasW}×{canvasH}</span>
      </div>
    </div>
  );
}

// Shared Position / Size / Rotation editors — reused for the live panel and the
// read-only (locked) inspect view.
function TransformFields({ layer, onChange, canvasW, canvasH, scrub = true }) {
  const pctW = canvasW ? Math.round((layer.w / canvasW) * 100) : null;
  const pctH = canvasH ? Math.round((layer.h / canvasH) * 100) : null;
  return (
    <>
      <Field label="Position">
        <Row>
          <NumberInput value={Math.round(layer.x)} onChange={v => onChange({ x: v })} suffix="X" scrub={scrub} />
          <NumberInput value={Math.round(layer.y)} onChange={v => onChange({ y: v })} suffix="Y" scrub={scrub} />
        </Row>
        <Row>
          <NumberInput value={Math.round(layer.w)} onChange={v => onChange({ w: Math.max(1, v) })} suffix="W" scrub={scrub} />
          <NumberInput value={Math.round(layer.h)} onChange={v => onChange({ h: Math.max(1, v) })} suffix="H" scrub={scrub} />
        </Row>
        {(pctW != null && pctH != null) && (
          <div className="field-hint" style={{ textAlign: 'right' }}>{pctW}% × {pctH}% of canvas</div>
        )}
      </Field>
      <Field label="Rotation">
        <Slider ariaLabel="Rotation" unit="°" value={Math.round(layer.rotation || 0)}
                onChange={v => onChange({ rotation: v })} min={-180} max={180} step={1} />
      </Field>
    </>
  );
}

// Batch editor for 2+ selected layers — shared Fill/Stroke/Opacity/Rotation
// (showing "Mixed" when they differ) plus inline align/distribute. Each control
// applies to all selected (unlocked) layers in one history step.
function MultiSelectProps({ layers, ids, setLayers, alignLayer, distribute }) {
  // Distinct sentinel for "values differ". Compute over the UNLOCKED layers
  // only — setLayers skips locked ones, so a locked member must not drive the
  // shared value (it would show something the user can't change, or wedge a
  // field at "Mixed" that no edit can clear).
  const MIXED = '__mixed_sentinel__';
  const editable = layers.filter(l => !l.locked);
  const eids = editable.map(l => l.id);
  // null and undefined are the same value (both render at full opacity / no
  // override), so coalesce before comparing — otherwise a touched-then-reset
  // layer (null) reads as different from an untouched one (undefined).
  const shared = (key) => {
    if (!editable.length) return MIXED;
    const norm = (v) => (v == null ? null : v);
    const first = norm(editable[0][key]);
    return editable.every(l => norm(l[key]) === first) ? first : MIXED;
  };
  if (!editable.length) {
    return (
      <Section title={`${ids.length} layers`} id="multi">
        <div className="empty-note">Every selected layer is locked. Unlock one to edit shared properties.</div>
      </Section>
    );
  }
  const fill = shared('fill'), stroke = shared('stroke'), sw = shared('strokeWidth');
  const op = shared('opacity'), rot = shared('rotation');
  const mixed = (v) => (v === MIXED ? <span className="mixed-tag">Mixed</span> : null);
  const opPct = op === MIXED ? 100 : Math.round((op == null ? 1 : op) * 100);
  const canDist = editable.length >= 3;
  // Recolouring the stroke must not overwrite per-layer widths: only seed a
  // width when the layers share no stroke at all (so the new colour is visible).
  const onStrokeColor = (v) => {
    const patch = { stroke: v };
    if (sw !== MIXED && !sw) patch.strokeWidth = 2;
    setLayers(eids, patch);
  };
  return (
    <Section title={`${ids.length} layers`} id="multi">
      <Field label={<>Fill {mixed(fill)}</>}>
        <ColorInput value={(fill === MIXED || fill === 'none' || fill == null) ? '#FFFFFF' : fill}
                    onChange={v => setLayers(eids, { fill: v, bindSeverity: null })} />
      </Field>
      <Field label={<>Stroke {mixed(stroke)}</>}>
        <ColorInput value={(stroke === MIXED || !stroke) ? '#000000' : stroke} onChange={onStrokeColor} />
        <Row><Slider ariaLabel="Stroke width" value={sw === MIXED ? 0 : (sw || 0)} min={0} max={40} step={0.5}
                     onChange={v => setLayers(eids, { strokeWidth: v })} /></Row>
      </Field>
      <Field label={<>Opacity {mixed(op)}</>}>
        <Slider ariaLabel="Opacity" value={opPct} min={0} max={100} step={1}
                onChange={v => setLayers(eids, { opacity: v >= 100 ? null : v / 100 })} />
      </Field>
      <Field label={<>Rotation {mixed(rot)}</>}>
        <Slider ariaLabel="Rotation" unit="°" value={rot === MIXED ? 0 : Math.round(rot || 0)}
                min={-180} max={180} step={1} onChange={v => setLayers(eids, { rotation: v })} />
      </Field>
      <Field label="Arrange" hint={canDist ? undefined : 'Distribute needs 3+ layers.'}>
        <div className="ms-align">
          <button className="icon-btn" title="Align left" onClick={() => alignLayer('left')}><AlignIcon axis="x" pos="start" /></button>
          <button className="icon-btn" title="Align centre" onClick={() => alignLayer('cx')}><AlignIcon axis="x" pos="center" /></button>
          <button className="icon-btn" title="Align right" onClick={() => alignLayer('right')}><AlignIcon axis="x" pos="end" /></button>
          <span className="ms-sep" />
          <button className="icon-btn" title="Align top" onClick={() => alignLayer('top')}><AlignIcon axis="y" pos="start" /></button>
          <button className="icon-btn" title="Align middle" onClick={() => alignLayer('cy')}><AlignIcon axis="y" pos="center" /></button>
          <button className="icon-btn" title="Align bottom" onClick={() => alignLayer('bottom')}><AlignIcon axis="y" pos="end" /></button>
          <span className="ms-sep" />
          <button className="icon-btn" title="Distribute horizontally" disabled={!canDist} onClick={() => distribute('x')}>⇿</button>
          <button className="icon-btn" title="Distribute vertically" disabled={!canDist} onClick={() => distribute('y')}>⇳</button>
        </div>
      </Field>
    </Section>
  );
}

// ----------- Properties panel (per layer type) -----------
function PropertiesPanel({ layer, onChange, cache, canvasW, canvasH }) {
  // A locked layer is read-only, but its geometry stays legible so you can
  // check coordinates without unlocking (and risking an accidental nudge).
  if (layer.locked) {
    return (
      <>
        <div className="locked-banner">
          <span className="lb-text">Locked — read only</span>
          <button className="ghost lb-unlock" onClick={() => onChange({ locked: false })}>Unlock</button>
        </div>
        <Section title="Transform" id="transform">
          {/* scrub={false} + .ro-fields pointer-events:none keep the scrub-handle
              spans inert — a disabled <fieldset> only neutralises form controls. */}
          <fieldset className="ro-fields" disabled>
            <TransformFields layer={layer} onChange={onChange} canvasW={canvasW} canvasH={canvasH} scrub={false} />
          </fieldset>
        </Section>
      </>
    );
  }
  return (
    <>
      <Section title="Transform" id="transform">
        <TransformFields layer={layer} onChange={onChange} canvasW={canvasW} canvasH={canvasH} />
      </Section>

      {layer.type === 'text' && <Section title="Typography" id="text"><TextProps layer={layer} onChange={onChange} /></Section>}
      {layer.type === 'bullets' && <Section title="List" id="text"><BulletsProps layer={layer} onChange={onChange} /></Section>}
      {layer.type === 'rect' && <Section title="Appearance" id="appearance"><RectProps layer={layer} onChange={onChange} /></Section>}
      {layer.type === 'polygon' && <Section title="Appearance" id="appearance"><PolygonProps layer={layer} onChange={onChange} /></Section>}
      {layer.type === 'ellipse' && <Section title="Appearance" id="appearance"><PolygonProps layer={layer} onChange={onChange} /></Section>}
      {layer.type === 'image' && <Section title="Symbol" id="appearance"><ImageProps layer={layer} onChange={onChange} cache={cache} /></Section>}
      {layer.type === 'line' && <Section title="Appearance" id="appearance"><LineProps layer={layer} onChange={onChange} /></Section>}
      {layer.type === 'ink' && <Section title="Signature" id="appearance"><InkProps layer={layer} onChange={onChange} /></Section>}
      {layer.type === 'barcode' && <Section title="Barcode" id="appearance"><BarcodeProps layer={layer} onChange={onChange} /></Section>}

      <Section title="Constraints" id="constraints" defaultOpen={false}>
        <Field label="Pin to canvas" hint="When the canvas resizes, the pinned edges stay anchored.">
          <PinSidesControl value={layer.pinSides} onChange={v => onChange({ pinSides: v })} />
        </Field>
        <Field label="Clip to canvas" hint="Crop this layer to the background's rounded shape.">
          <Seg
            value={layer.clipToCanvas ? 'on' : 'off'}
            onChange={v => onChange({ clipToCanvas: v === 'on' })}
            options={[{ value: 'off', label: 'No clip' }, { value: 'on', label: 'Clip' }]}
          />
        </Field>
      </Section>

      <Section title="Layer" id="layerstate" defaultOpen={false}>
        {/* Opacity + blend live in the always-visible Layers header now. */}
        {['rect', 'ellipse', 'polygon'].includes(layer.type) && (
          <Field label="Hole" hint="Punch this shape through the whole label as a transparent cutout (e.g. a tag hole).">
            <Seg
              value={layer.hole ? 'hole' : 'solid'}
              onChange={v => onChange({ hole: v === 'hole' })}
              options={[{ value: 'solid', label: 'Solid' }, { value: 'hole', label: 'Hole' }]}
            />
          </Field>
        )}
        <Row>
          <Seg
            value={layer.hidden ? 'hidden' : 'shown'}
            onChange={v => onChange({ hidden: v === 'hidden' })}
            options={[{ value: 'shown', label: 'Visible' }, { value: 'hidden', label: 'Hidden' }]}
          />
        </Row>
        <Row>
          <Seg
            value={layer.locked ? 'locked' : 'free'}
            onChange={v => onChange({ locked: v === 'locked' })}
            options={[{ value: 'free', label: 'Editable' }, { value: 'locked', label: 'Locked' }]}
          />
        </Row>
      </Section>
    </>
  );
}

function TextProps({ layer, onChange }) {
  return (
    <>
      <Field label="Text">
        <textarea className="text-input" rows={3}
                  value={layer.text || ''} onChange={e => onChange({ text: e.target.value })} />
      </Field>
      <Field label="Font">
        <Seg
          value={layer.fontFamily || 'sans'}
          onChange={v => onChange({ fontFamily: v })}
          options={[
            { value: 'sans', label: 'Sans' },
            { value: 'serif', label: 'Serif' },
            { value: 'mono', label: 'Mono' },
          ]}
        />
      </Field>
      <Field label="Size">
        <Slider ariaLabel="Font size" value={Math.round(layer.fontSize || 16)} onChange={v => onChange({ fontSize: v })} min={4} max={200} step={1} />
      </Field>
      <Field label="Weight">
        <Seg
          value={String(layer.fontWeight || 400)}
          onChange={v => onChange({ fontWeight: Number(v) })}
          options={[
            { value: '400', label: 'Regular' },
            { value: '700', label: 'Bold' },
            { value: '900', label: 'Extra' },
          ]}
        />
      </Field>
      <Field label="Align">
        <Seg
          value={layer.align || 'start'}
          onChange={v => onChange({ align: v })}
          options={[
            { value: 'start', label: 'Left' },
            { value: 'middle', label: 'Center' },
            { value: 'end', label: 'Right' },
          ]}
        />
      </Field>
      <Field label="Style">
        <Row>
          <Seg
            value={layer.italic ? 'i' : 'r'}
            onChange={v => onChange({ italic: v === 'i' })}
            options={[{ value: 'r', label: 'Roman' }, { value: 'i', label: 'Italic' }]}
          />
          <Seg
            value={layer.uppercase ? 'u' : 'mc'}
            onChange={v => onChange({ uppercase: v === 'u' })}
            options={[{ value: 'mc', label: 'Mixed' }, { value: 'u', label: 'CAPS' }]}
          />
        </Row>
      </Field>
      <Field label="Tracking">
        <Slider ariaLabel="Letter spacing" value={Number(((layer.letterSpacing || 0)).toFixed(2))} onChange={v => onChange({ letterSpacing: v })} min={-0.05} max={0.5} step={0.01} />
      </Field>
      <Field label="Line height">
        <Slider ariaLabel="Line height" value={Number(((layer.lineHeight || 1.2)).toFixed(2))} onChange={v => onChange({ lineHeight: v })} min={0.8} max={2.5} step={0.05} />
      </Field>
      <Field label="Color">
        <ColorInput value={layer.fill || '#000000'} onChange={v => onChange({ fill: v, bindSeverity: null })} />
      </Field>
    </>
  );
}

function BulletsProps({ layer, onChange }) {
  // Items can be a legacy string[] (older saved presets) or {id, text}[].
  // Normalize to the object shape so React keys stay stable across delete /
  // reorder — using the array index as a key here used to drop focus and
  // mis-route in-progress IME composition onto a different bullet.
  const items = (layer.items || []).map(b =>
    typeof b === 'string'
      ? { id: uid(), text: b }
      : { id: b.id || uid(), text: b.text || '' }
  );
  return (
    <>
      <Field label="Items">
        <div className="bullets">
          {items.map((b, i) => (
            <div className="bullet-row" key={b.id}>
              <span className="bullet-dot">•</span>
              <input
                className="text-input"
                value={b.text}
                onChange={e => onChange({
                  items: items.map((x, j) => j === i ? { ...x, text: e.target.value } : x),
                })}
                placeholder={`Item ${i + 1}`}
              />
              <button className="icon-btn"
                      onClick={() => onChange({ items: items.filter((_, j) => j !== i) })}>×</button>
            </div>
          ))}
          <button className="ghost dashed"
                  onClick={() => onChange({ items: [...items, { id: uid(), text: '' }] })}>
            + Add item
          </button>
        </div>
      </Field>
      <Field label="Font">
        <Seg
          value={layer.fontFamily || 'sans'}
          onChange={v => onChange({ fontFamily: v })}
          options={[
            { value: 'sans', label: 'Sans' },
            { value: 'serif', label: 'Serif' },
            { value: 'mono', label: 'Mono' },
          ]}
        />
      </Field>
      <Field label="Size">
        <Slider ariaLabel="Font size" value={Math.round(layer.fontSize || 16)} onChange={v => onChange({ fontSize: v })} min={4} max={120} step={1} />
      </Field>
      <Field label="Color">
        <ColorInput value={layer.fill || '#000000'} onChange={v => onChange({ fill: v, bindSeverity: null })} />
      </Field>
    </>
  );
}

function RectProps({ layer, onChange }) {
  const maxR = Math.floor(Math.min(layer.w, layer.h) / 2);
  return (
    <>
      <Field label="Fill">
        <ColorInput value={layer.fill === 'none' ? '#FFFFFF' : (layer.fill || '#000000')}
                    onChange={v => onChange({ fill: v, bindSeverity: null })} />
        <div className="row" style={{ marginTop: 6 }}>
          <Seg
            value={layer.fill === 'none' ? 'none' : 'on'}
            onChange={v => onChange({ fill: v === 'none' ? 'none' : (layer.fill === 'none' ? '#FFFFFF' : layer.fill), bindSeverity: null })}
            options={[{ value: 'on', label: 'Filled' }, { value: 'none', label: 'None' }]}
          />
        </div>
      </Field>
      <Field label="Stroke">
        <ColorInput value={layer.stroke || '#000000'} onChange={v => onChange({ stroke: v, strokeWidth: layer.strokeWidth || 2 })} />
        <Row><Slider label="Width" ariaLabel="Stroke width" value={layer.strokeWidth || 0} onChange={v => onChange({ strokeWidth: v })} min={0} max={40} step={0.5} /></Row>
        {(layer.strokeWidth || 0) > 0 && (
          <Row><Slider label="Inset" ariaLabel="Stroke inset" value={layer.strokeInset || 0}
                       onChange={v => onChange({ strokeInset: v })} min={0} max={maxR} step={0.5} /></Row>
        )}
        <Row>
          <Seg
            value={layer.strokeOnTop ? 'top' : 'normal'}
            onChange={v => onChange({ strokeOnTop: v === 'top' })}
            options={[
              { value: 'normal', label: 'Inline' },
              { value: 'top', label: 'On top' },
            ]}
          />
        </Row>
      </Field>
      <Field label="Corner radius">
        <CornerRadius value={layer.radius || 0} onChange={v => onChange({ radius: v })} max={maxR}
                      corner={layer.corner} onCorner={c => onChange({ corner: c })} />
      </Field>
    </>
  );
}

function ImageProps({ layer, onChange, cache }) {
  return (
    <>
      <Field label={layer.src ? 'Image' : 'Symbol'} hint={layer.src ? 'Custom uploaded image. Pick a symbol to replace it.' : 'Built-in plates, or upload your own.'}>
        <SymbolPicker activeId={layer.src ? null : layer.symbol} cache={cache}
          onPick={(id) => onChange({ symbol: id, src: undefined })}
          onUpload={(file) => readImageFile(file, (src) => onChange({ src, symbol: undefined }))} />
      </Field>
      <Field label="Aspect">
        <Seg
          value={layer.preserveAspect === false ? 'stretch' : 'keep'}
          onChange={v => onChange({ preserveAspect: v === 'keep' })}
          options={[{ value: 'keep', label: 'Preserve' }, { value: 'stretch', label: 'Stretch' }]}
        />
      </Field>
    </>
  );
}

function PolygonProps({ layer, onChange }) {
  const isStar = layer.shape === 'star';
  const sides = layer.sides || 5;
  const inner = layer.inner == null ? 0.42 : layer.inner;
  return (
    <>
      {isStar && (
        <Field label="Star">
          <Row><Slider ariaLabel="Star points" label="Points"
                       value={sides} min={3} max={12} step={1}
                       onChange={v => onChange({ sides: v, points: starPoints(v, inner) })} /></Row>
          <Row><Slider ariaLabel="Star spikiness" label="Spikiness"
                       value={Number((1 - inner).toFixed(2))} min={0.1} max={0.85} step={0.01}
                       onChange={v => { const ni = 1 - v; onChange({ inner: ni, points: starPoints(sides, ni) }); }} /></Row>
        </Field>
      )}
      <Field label="Fill">
        <ColorInput value={layer.fill === 'none' ? '#FFFFFF' : (layer.fill || '#000000')}
                    onChange={v => onChange({ fill: v, bindSeverity: null })} />
        <div className="row" style={{ marginTop: 6 }}>
          <Seg
            value={layer.fill === 'none' ? 'none' : 'on'}
            onChange={v => onChange({ fill: v === 'none' ? 'none' : (layer.fill === 'none' ? '#FFFFFF' : layer.fill), bindSeverity: null })}
            options={[{ value: 'on', label: 'Filled' }, { value: 'none', label: 'None' }]}
          />
        </div>
      </Field>
      <Field label="Stroke">
        <ColorInput value={layer.stroke || '#000000'} onChange={v => onChange({ stroke: v, strokeWidth: layer.strokeWidth || 2 })} />
        <Row><Slider ariaLabel="Stroke width" value={layer.strokeWidth || 0} onChange={v => onChange({ strokeWidth: v })} min={0} max={40} step={0.5} /></Row>
      </Field>
    </>
  );
}

function LineProps({ layer, onChange }) {
  return (
    <>
      <Field label="Color">
        <ColorInput value={layer.stroke || '#000000'} onChange={v => onChange({ stroke: v })} />
      </Field>
      <Field label="Weight">
        <Slider ariaLabel="Line weight" value={layer.strokeWidth || 2} onChange={v => onChange({ strokeWidth: v })} min={0.5} max={40} step={0.5} />
      </Field>
      <Field label="Dash">
        <Seg
          value={layer.dasharray ? 'dash' : 'solid'}
          onChange={v => onChange({ dasharray: v === 'dash' ? '8 6' : null })}
          options={[{ value: 'solid', label: 'Solid' }, { value: 'dash', label: 'Dashed' }]}
        />
      </Field>
    </>
  );
}

function InkProps({ layer, onChange }) {
  return (
    <>
      <Field label="Ink color">
        <ColorInput value={layer.stroke || '#000000'} onChange={v => onChange({ stroke: v })} />
      </Field>
      <Field label="Weight">
        <Slider ariaLabel="Ink weight" value={layer.strokeWidth || 3} onChange={v => onChange({ strokeWidth: v })} min={0.5} max={40} step={0.5} />
      </Field>
    </>
  );
}

function BarcodeProps({ layer, onChange }) {
  const variant = layer.variant || 'code128';
  const isLinear = variant !== 'qr';
  // 'none' OR a missing value both mean "transparent background".
  const bgNone = !layer.background || layer.background === 'none';
  return (
    <>
      <Field label="Data" hint={variant === 'code39'
        ? 'Scannable. Allowed: 0-9 A-Z space - . $ / + % — lower-case is upper-cased, anything else is dropped.'
        : 'Any text — it seeds the bar pattern (decorative, not scannable).'}>
        <input className="text-input" value={layer.data || ''}
               onChange={e => onChange({ data: e.target.value })}
               placeholder="012345678905" />
        {variant === 'code39' && (layer.data || '').trim() !== '' &&
          sanitizeCode39(layer.data) !== layer.data.toUpperCase() && (
          <div className="field-hint" style={{ marginTop: 4 }}>Encodes: {sanitizeCode39(layer.data)}</div>
        )}
      </Field>
      <Field label="Type">
        {/* Switching variant never touches geometry — the renderer letterboxes a
            square QR centred in whatever box the layer has, so a round-trip can't
            lose the box's width. Resize the layer for a bigger QR. */}
        <Seg value={variant} onChange={v => onChange({ variant: v })} options={BARCODE_VARIANTS} />
      </Field>
      {isLinear && (
        <Field label="Caption" hint="Show the value as text beneath the bars.">
          <Seg
            value={layer.showText === false ? 'off' : 'on'}
            onChange={v => onChange({ showText: v === 'on' })}
            options={[{ value: 'on', label: 'Shown' }, { value: 'off', label: 'Hidden' }]}
          />
        </Field>
      )}
      {variant === 'code128' && (
        <Field label="Density" hint="Roughly how many bars to pack in.">
          <Slider ariaLabel="Barcode density" value={layer.density || 3}
                  min={1} max={8} step={1} onChange={v => onChange({ density: v })} />
        </Field>
      )}
      <Field label="Bars">
        <ColorInput value={layer.fill || '#000000'} onChange={v => onChange({ fill: v, bindSeverity: null })} />
      </Field>
      <Field label="Background">
        <ColorInput value={bgNone ? '#FFFFFF' : layer.background}
                    onChange={v => onChange({ background: v })} />
        <div className="row" style={{ marginTop: 6 }}>
          <Seg
            value={bgNone ? 'none' : 'on'}
            onChange={v => onChange({ background: v === 'none' ? 'none' : (bgNone ? '#FFFFFF' : layer.background) })}
            options={[{ value: 'on', label: 'Solid' }, { value: 'none', label: 'None' }]}
          />
        </div>
      </Field>
    </>
  );
}

export { PropertiesPanel, PropsHeader, MultiSelectProps };
