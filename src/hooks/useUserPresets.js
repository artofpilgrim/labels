import { useEffect, useState } from 'react';
import { isRenderableDesign } from '../core/design.js';
import { uid } from '../uid.js';

const USER_PRESETS_KEY = 'hazardLabelStudio.userPresets';

export function useUserPresets({
  design,
  setDesign,
  forceCommit,
  setDocName,
  setSelectedIds,
  setWrapOffset,
  setExportMsg,
}) {
  const [userPresets, setUserPresets] = useState([]);
  const [newPresetName, setNewPresetName] = useState('');
  const [activePresetId, setActivePresetId] = useState(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(USER_PRESETS_KEY);
      if (!raw) return;
      const v = JSON.parse(raw);
      if (Array.isArray(v)) {
        setUserPresets(v.filter(p => p && p.id && p.design && Array.isArray(p.design.layers)));
      }
    } catch {
      // Corrupted storage is ignored.
    }
  }, []);

  function persistUserPresets(next) {
    try {
      localStorage.setItem(USER_PRESETS_KEY, JSON.stringify(next));
      setUserPresets(next);
    } catch (err) {
      setExportMsg(
        err && err.name === 'QuotaExceededError'
          ? 'Storage full - delete some presets'
          : 'Could not save preset'
      );
      setTimeout(() => setExportMsg(''), 2800);
    }
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

  function updateUserPreset(id) {
    const p = userPresets.find(x => x.id === id);
    if (!p) return;
    if (!window.confirm(`Update preset "${p.name}" with the current design?`)) return;
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
    setExportMsg(`Updated "${p.name}"`);
    setTimeout(() => setExportMsg(''), 2200);
  }

  function applyUserPreset(id) {
    const p = userPresets.find(x => x.id === id);
    if (!p) return;
    if (!isRenderableDesign(p.design)) {
      setExportMsg('That preset is corrupted and could not be loaded');
      setTimeout(() => setExportMsg(''), 3000);
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
    setDocName(p.name);
    setActivePresetId(id);
    setSelectedIds([]);
    setWrapOffset({ x: 0, y: 0 });
    setExportMsg('Preset applied - press Ctrl+Z to undo');
    setTimeout(() => setExportMsg(''), 3000);
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
