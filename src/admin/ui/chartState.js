import { useCallback, useMemo, useState } from 'react';

export const SERIES_COLORS = ['#5B3FD6', '#0E9E74', '#E8930C', '#E03E6B', '#1F8FCE', '#7B8794'];

/* Persist small view preferences per chart. Storage can be unavailable
 * (private windows), so every access is guarded. */
export function usePersistentState(key, initial) {
  const [value, setValue] = useState(() => {
    if (!key) return initial;
    try {
      const raw = localStorage.getItem(key);
      return raw == null ? initial : JSON.parse(raw);
    } catch { return initial; }
  });
  const set = useCallback((next) => {
    setValue(prev => {
      const v = typeof next === 'function' ? next(prev) : next;
      if (key) { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* ignore */ } }
      return v;
    });
  }, [key]);
  return [value, set];
}

/* Which tiles the chart shows.
 *   single  — one metric (click a tile to switch)
 *   compare — up to four metrics of the same unit (click tiles to add/remove)
 *   <pair>  — a fixed comparison the page defines, e.g. collected vs redeemed */
export function useChartSelection({ metrics, defaultId, pairs = [], storageKey }) {
  const [mode, setModeState] = usePersistentState(storageKey ? `${storageKey}:mode` : null, 'single');
  const [selectedId, setSelectedId] = usePersistentState(storageKey ? `${storageKey}:metric` : null, defaultId);
  const [comparedIds, setComparedIds] = usePersistentState(storageKey ? `${storageKey}:compare` : null, []);

  const ids = useMemo(() => new Set(metrics.map(m => m.id)), [metrics]);
  const validSelected = ids.has(selectedId) ? selectedId : defaultId;
  const pair = pairs.find(p => p.id === mode) || null;
  const validMode = mode === 'single' || mode === 'compare' || pair ? mode : 'single';

  const setMode = useCallback((next) => {
    const p = pairs.find(x => x.id === next);
    if (p) setComparedIds(p.ids);
    else if (next === 'compare') setComparedIds(prev => (prev.length ? prev : [validSelected]));
    setModeState(next);
  }, [pairs, setComparedIds, setModeState, validSelected]);

  const select = useCallback((id) => {
    setSelectedId(id);
  }, [setSelectedId]);

  const toggleCompare = useCallback((id) => {
    setComparedIds(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]));
    // Editing a fixed pair turns it into a free comparison.
    setModeState(m => (pairs.some(p => p.id === m) ? 'compare' : m));
  }, [pairs, setComparedIds, setModeState]);

  const activeIds = useMemo(() => (validMode === 'single'
    ? [validSelected]
    : (pair ? pair.ids : comparedIds).filter(id => ids.has(id))), [validMode, validSelected, pair, comparedIds, ids]);

  const colorFor = useCallback((id) => {
    const i = activeIds.indexOf(id);
    return SERIES_COLORS[(i < 0 ? 0 : i) % SERIES_COLORS.length];
  }, [activeIds]);

  return {
    mode: validMode,
    tileMode: validMode === 'single' ? 'single' : 'compare',
    selectedId: validSelected,
    comparedIds: validMode === 'single' ? [] : activeIds,
    activeIds,
    setMode,
    select,
    toggleCompare,
    colorFor,
    pair,
  };
}
