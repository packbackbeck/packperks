import { useState, useCallback, useMemo } from 'react';

/* Row-selection helper for admin tables with a "select rows / select all
 * + bulk delete" feature. Pass the CURRENTLY-VISIBLE rows (post-filter) so
 * "select all" only ever targets what the admin can see. */
export function useBulkSelection(rows, getId = (r) => r.id) {
  const [selected, setSelected] = useState(() => new Set());

  const ids = useMemo(() => rows.map(getId), [rows, getId]);
  const allSelected = ids.length > 0 && ids.every((id) => selected.has(id));
  const someSelected = ids.some((id) => selected.has(id));

  const toggle = useCallback((id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleAll = useCallback(() => {
    setSelected((prev) => {
      const everyVisibleSelected = ids.length > 0 && ids.every((id) => prev.has(id));
      if (everyVisibleSelected) {
        // Deselect the visible rows (keep any off-screen selections intact).
        const next = new Set(prev);
        ids.forEach((id) => next.delete(id));
        return next;
      }
      return new Set([...prev, ...ids]);
    });
  }, [ids]);

  const clear = useCallback(() => setSelected(new Set()), []);

  return {
    selected,
    selectedIds: [...selected],
    count: selected.size,
    isSelected: (id) => selected.has(id),
    allSelected,
    someSelected,
    toggle,
    toggleAll,
    clear,
  };
}
