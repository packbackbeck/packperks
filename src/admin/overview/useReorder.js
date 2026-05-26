import { useState, useCallback } from 'react';

/* ─────────────────────────────────────────────────────────────────────
 * useReorder — small HTML5-native drag-and-drop helper for grids of
 * cards in the Overview customize mode.
 *
 * Why hand-rolled instead of dnd-kit / react-dnd: we have ~12 cards
 * and one screen using this — a library would bloat the bundle for
 * marginal UX gain. The native API gives us draggable, dragstart,
 * dragover, drop, and dragend, which is everything we need for
 * "drop INTO another card's slot" semantics.
 *
 * Drop semantics: when card B is dropped onto card A, B takes A's
 * slot and A shifts. This is the "insert before" model — the same
 * mental model Notion / Linear / Figma use for sidebar reordering.
 *
 * Usage:
 *
 *   const { onCardDragStart, onCardDragOver, onCardDrop, dragId,
 *           overId } = useReorder(ids, (nextIds) => onReorder(nextIds));
 *
 *   <div
 *     draggable={editMode}
 *     onDragStart={() => onCardDragStart(id)}
 *     onDragOver={(e) => onCardDragOver(e, id)}
 *     onDrop={() => onCardDrop(id)}
 *     className={[
 *       dragId === id  ? 'is-dragging' : '',
 *       overId === id  ? 'is-drop-target' : '',
 *     ].join(' ')}
 *   >
 *
 * `ids` should be a stable array. `onReorder(next)` is called once
 * per drop with the new order.
 * ───────────────────────────────────────────────────────────────────── */
export function useReorder(ids, onReorder) {
  const [dragId, setDragId] = useState(null);
  const [overId, setOverId] = useState(null);

  const onCardDragStart = useCallback((id) => {
    setDragId(id);
    setOverId(null);
  }, []);

  const onCardDragOver = useCallback((e, id) => {
    if (!dragId || dragId === id) return;
    // Allow drop. preventDefault is the magic word for the native API.
    e.preventDefault();
    setOverId(id);
  }, [dragId]);

  const onCardDrop = useCallback((targetId) => {
    if (!dragId || dragId === targetId) {
      setDragId(null);
      setOverId(null);
      return;
    }
    const fromIdx = ids.indexOf(dragId);
    const toIdx   = ids.indexOf(targetId);
    if (fromIdx === -1 || toIdx === -1) {
      setDragId(null);
      setOverId(null);
      return;
    }
    const next = ids.slice();
    next.splice(fromIdx, 1);
    next.splice(toIdx, 0, dragId);
    onReorder(next);
    setDragId(null);
    setOverId(null);
  }, [dragId, ids, onReorder]);

  const onCardDragEnd = useCallback(() => {
    // Always clear the visual state, even if drop happened outside any card.
    setDragId(null);
    setOverId(null);
  }, []);

  return {
    dragId,
    overId,
    onCardDragStart,
    onCardDragOver,
    onCardDrop,
    onCardDragEnd,
  };
}
