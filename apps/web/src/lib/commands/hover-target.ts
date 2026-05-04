// Single store for "the row the user is currently aiming at" — driven by
// either mouse hover or keyboard cursor. Both inbox-list (for visual
// highlight) and the dispatcher's `resolveTarget` (for command targeting)
// read from this store, so a single-key action and a Cmd+K command can
// never disagree about which row is the target.
//
// Conflict rule: when the keyboard sets the target, hover updates are
// frozen until the user *physically moves the mouse*. That's not the
// same as "until the row id under the pointer changes": pressing `j`
// scrolls the list, which puts a different row under a stationary
// pointer and fires `mouseover` for the new row. Treating that as a
// real hover would yank the cursor back to wherever the mouse happens
// to overlap after the scroll. We track an explicit `mousemove` flag
// and only accept hover updates once that has fired.

import { type RefObject, useEffect } from 'react';
import { create } from 'zustand';
import type { Target } from './registry';

export type CursorSource = 'hover' | 'keyboard';

interface HoverTargetState {
  target: Target | null;
  source: CursorSource | null;
  /** Set to false whenever the keyboard takes the cursor; flipped to true
   *  on the next real `mousemove`. While false, scroll-induced
   *  `mouseover` events under a stationary pointer are ignored. */
  mouseMovedSinceKeyboard: boolean;
  setHoverTarget: (target: Target | null) => void;
  setKeyboardTarget: (target: Target | null) => void;
  noteMouseMoved: () => void;
  clear: () => void;
}

export const useHoverTargetStore = create<HoverTargetState>((set, get) => ({
  target: null,
  source: null,
  mouseMovedSinceKeyboard: true,
  setHoverTarget: (target) => {
    const state = get();
    // Keyboard owns the cursor and the mouse hasn't moved since — ignore.
    // The pointer is stationary; the row id under it only changed because
    // a keyboard-driven scroll re-aligned the viewport. The user's intent
    // is still on the keyboard cursor.
    if (state.source === 'keyboard' && !state.mouseMovedSinceKeyboard) return;
    set({ target, source: target ? 'hover' : null });
  },
  setKeyboardTarget: (target) =>
    set({ target, source: target ? 'keyboard' : null, mouseMovedSinceKeyboard: false }),
  noteMouseMoved: () => {
    if (get().mouseMovedSinceKeyboard) return;
    set({ mouseMovedSinceKeyboard: true });
  },
  clear: () => set({ target: null, source: null, mouseMovedSinceKeyboard: true }),
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
    // `mousemove` fires only on real pointer movement — never on scroll.
    // That's the signal we need to distinguish "user reached for the
    // mouse" from "the row under a stationary pointer slid into a new
    // position". Listen at document level so a movement that starts
    // outside the inbox still unlocks hover when it re-enters.
    const onMouseMove = () => useHoverTargetStore.getState().noteMouseMoved();
    node.addEventListener('mouseover', onMouseOver);
    node.addEventListener('mouseleave', onMouseLeave);
    document.addEventListener('mousemove', onMouseMove, { passive: true });
    return () => {
      node.removeEventListener('mouseover', onMouseOver);
      node.removeEventListener('mouseleave', onMouseLeave);
      document.removeEventListener('mousemove', onMouseMove);
      useHoverTargetStore.getState().clear();
    };
  }, [ref]);
}
