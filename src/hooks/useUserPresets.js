import { useEffect, useState } from 'react';
import { isRenderableDesign } from '../core/design.js';
import { idb } from '../core/idb.js';
import { uid } from '../uid.js';

export function useUserPresets({
  design,
  setDesign,
  forceCommit,
  setDocName,
  setSelectedIds,
  setWrapOffset,
  flash,
  confirm,
}) {
  const [userPresets, setUserPresets] = useState([]);
  const [newPresetName, setNewPresetName] = useState('');
  const [activePresetId, setActivePresetId] = useState(null);

  useEffect(() => {
    let alive = true;
    idb.kvGet('userPresets').then(v => {
      if (alive && Array.isArray(v)) {
        setUserPresets(v.filter(p => p && p.id && p.design && Array.isArray(p.design.layers)));
      }
    }).catch(() => { /* corrupted/unavailable storage → start empty */ });
    return () => { alive = false; };
  }, []);

  function persistUserPresets(next) {
    setUserPresets(next);   // optimistic — IndexedDB writes are async
    idb.kvSet('userPresets', next).catch(() => {
      flash('Could not save preset', 2800);
    });
  }

  function saveCurrentAsPreset(name) {
    const trimmed = (name || '').trim();
    if (!trimmed) return;
    const preset = {
      id: uid(),
      name: trimmed,
      design: {
        width: design.width,
        height: design.height,
        severity: design.severity,
        layers: JSON.parse(JSON.stringify(design.layers)),
      },
    };
    persistUserPresets([...userPresets, preset]);
    setActivePresetId(preset.id);
    setNewPresetName('');
  }

  async function updateUserPreset(id) {
    const p = userPresets.find(x => x.id === id);
    if (!p) return;
    const ok = await confirm({
      title: 'Update preset?',
      message: `Replace "${p.name}" with the current design? The previous version can't be recovered.`,
      confirmLabel: 'Update',
    });
    if (!ok) return;
    persistUserPresets(userPresets.map(x => x.id === id ? {
      ...x,
      design: {
        width: design.width,
        height: design.height,
        severity: design.severity,
        layers: JSON.parse(JSON.stringify(design.layers)),
      },
    } : x));
    setActivePresetId(id);
    flash(`Updated "${p.name}"`, 2200);
  }

  function applyUserPreset(id) {
    const p = userPresets.find(x => x.id === id);
    if (!p) return;
    if (!isRenderableDesign(p.design)) {
      flash('That preset is corrupted and could not be loaded', 3000);
      return;
    }
    forceCommit();
    const layers = p.design.layers.map(l => ({
      ...l,
      id: uid(),
    }));
    setDesign({
      width: p.design.width,
      height: p.design.height,
      severity: p.design.severity,
      format: 'custom',
      layers,
    });
    // A preset is a layout applied to the open document — keep the document's
    // own name (under the IndexedDB model, docName IS the open file's title).
    setActivePresetId(id);
    setSelectedIds([]);
    setWrapOffset({ x: 0, y: 0 });
    flash('Preset applied - press Ctrl+Z to undo', 3000);
  }

  function deleteUserPreset(id) {
    persistUserPresets(userPresets.filter(p => p.id !== id));
    setActivePresetId(a => (a === id ? null : a));
  }

  return {
    userPresets,
    newPresetName,
    setNewPresetName,
    activePresetId,
    setActivePresetId,
    saveCurrentAsPreset,
    updateUserPreset,
    applyUserPreset,
    deleteUserPreset,
  };
}
