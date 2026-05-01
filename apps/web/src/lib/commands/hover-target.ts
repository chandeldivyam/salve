// Single store for "the row the user is currently aiming at" — driven by
// either mouse hover or keyboard cursor. Both inbox-list (for visual
// highlight) and the dispatcher's `resolveTarget` (for command targeting)
// read from this store, so a single-key action and a Cmd+K command can
// never disagree about which row is the target.
//
// Conflict rule: when the keyboard sets the target, hover updates are
// frozen until the mouse moves to a *different* row. Holding the mouse
// over row A while pressing `j` should leave the cursor on row B (the
// keyboard's target), not snap back to A.

import { type RefObject, useEffect } from 'react';
import { create } from 'zustand';
import type { Target } from './registry';

export type CursorSource = 'hover' | 'keyboard';

interface HoverTargetState {
  target: Target | null;
  source: CursorSource | null;
  /** Last row id the mouse actually entered. Distinct from `target` so the
   *  store can tell "mouse stationary while keyboard moved" from "mouse
   *  moved to a new row". */
  lastHoverId: string | null;
  setHoverTarget: (target: Target | null) => void;
  setKeyboardTarget: (target: Target | null) => void;
  clear: () => void;
}

export const useHoverTargetStore = create<HoverTargetState>((set, get) => ({
  target: null,
  source: null,
  lastHoverId: null,
  setHoverTarget: (target) => {
    const targetId = target?.kind === 'ticket' ? target.id : null;
    const state = get();
    // While the keyboard owns the cursor, block hover updates until the
    // mouse moves to a *different* row from where it last entered. This
    // ignores the rapid mouseover bubbles fired on sub-elements of the
    // same row when the mouse is stationary.
    if (state.source === 'keyboard' && targetId && targetId === state.lastHoverId) {
      return;
    }
    set({ target, source: target ? 'hover' : null, lastHoverId: targetId });
  },
  setKeyboardTarget: (target) => set({ target, source: target ? 'keyboard' : null }),
  clear: () => set({ target: null, source: null, lastHoverId: null }),
}));

export function useHoverTargetRoot(ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    const onMouseOver = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      const row = target?.closest<HTMLElement>('[data-ticket-id]');
      if (!row || !node.contains(row)) return;
      const id = row.dataset.ticketId;
      if (!id) return;
      useHoverTargetStore.getState().setHoverTarget({
        kind: 'ticket',
        id,
        label: row.dataset.ticketLabel,
      });
    };

    const onMouseLeave = () => useHoverTargetStore.getState().setHoverTarget(null);
    node.addEventListener('mouseover', onMouseOver);
    node.addEventListener('mouseleave', onMouseLeave);
    return () => {
      node.removeEventListener('mouseover', onMouseOver);
      node.removeEventListener('mouseleave', onMouseLeave);
      useHoverTargetStore.getState().clear();
    };
  }, [ref]);
}
