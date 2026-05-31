import { BARCODE_VARIANTS, sanitizeCode39 } from '../barcode.js';
import { starPoints } from '../templates/index.js';
import { uid } from '../uid.js';
import { PinSidesControl, CornerRadius } from './layerControls.jsx';
import { readImageFile, SymbolPicker } from './SymbolPicker.jsx';
import { Field, Section, Row, Seg, NumberInput, ColorInput, Slider, BLEND_MODES } from './ui.jsx';

// ----------- Properties panel (per layer type) -----------
function PropertiesPanel({ layer, onChange, cache }) {
  // When the layer is locked, every property is read-only. Show a notice and
  // the lock toggle only — the user has to unlock the layer to edit anything.
  if (layer.locked) {
    return (
      <div className="pad">
        <Field label={layer.name || layer.type}>
          <div className="empty-note">
            This layer is locked. Unlock it to edit position, color, text, or any other property.
          </div>
        </Field>
        <Field label="Layer">
          <Row>
            <Seg
              value="locked"
              onChange={v => onChange({ locked: v === 'locked' })}
              options={[
                { value: 'free', label: 'Editable' },
                { value: 'locked', label: 'Locked' },
              ]}
            />
          </Row>
        </Field>
      </div>
    );
  }
  return (
    <>
      <Section title="Blend">
        <Field label="Blend mode">
          <select className="select-input" value={layer.blend || 'normal'}
                  onChange={e => onChange({ blend: e.target.value === 'normal' ? null : e.target.value })}>
            {BLEND_MODES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </Field>
      </Section>

      <Section title="Dimensions">
        <Field label="Name">
          <input className="text-input" value={layer.name || ''}
                 onChange={e => onChange({ name: e.target.value })} />
        </Field>
        <Field label="Position">
          <Row>
            <NumberInput value={Math.round(layer.x)} onChange={v => onChange({ x: v })} suffix="X" />
            <NumberInput value={Math.round(layer.y)} onChange={v => onChange({ y: v })} suffix="Y" />
          </Row>
          <Row>
            <NumberInput value={Math.round(layer.w)} onChange={v => onChange({ w: Math.max(1, v) })} suffix="W" />
            <NumberInput value={Math.round(layer.h)} onChange={v => onChange({ h: Math.max(1, v) })} suffix="H" />
          </Row>
        </Field>
        <Field label="Rotation">
          <Slider ariaLabel="Rotation" value={Math.round(layer.rotation || 0)} onChange={v => onChange({ rotation: v })} min={-180} max={180} step={1} />
        </Field>
      </Section>

      {layer.type === 'text' && <Section title="Typography"><TextProps layer={layer} onChange={onChange} /></Section>}
      {layer.type === 'bullets' && <Section title="List"><BulletsProps layer={layer} onChange={onChange} /></Section>}
      {layer.type === 'rect' && <Section title="Appearance"><RectProps layer={layer} onChange={onChange} /></Section>}
      {layer.type === 'polygon' && <Section title="Appearance"><PolygonProps layer={layer} onChange={onChange} /></Section>}
      {layer.type === 'ellipse' && <Section title="Appearance"><PolygonProps layer={layer} onChange={onChange} /></Section>}
      {layer.type === 'image' && <Section title="Symbol"><ImageProps layer={layer} onChange={onChange} cache={cache} /></Section>}
      {layer.type === 'line' && <Section title="Appearance"><LineProps layer={layer} onChange={onChange} /></Section>}
      {layer.type === 'barcode' && <Section title="Barcode"><BarcodeProps layer={layer} onChange={onChange} /></Section>}

      <Section title="Constraints" defaultOpen={false}>
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

      <Section title="Layer" defaultOpen={false}>
        <Field label="Opacity">
          <Slider ariaLabel="Layer opacity"
                  value={Math.round((layer.opacity == null ? 1 : layer.opacity) * 100)}
                  min={0} max={100} step={1}
                  onChange={v => onChange({ opacity: v >= 100 ? null : v / 100 })} />
        </Field>
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
        <Row><Slider ariaLabel="Stroke width" value={layer.strokeWidth || 0} onChange={v => onChange({ strokeWidth: v })} min={0} max={40} step={0.5} /></Row>
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

export { PropertiesPanel };
