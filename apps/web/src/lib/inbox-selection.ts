// Transient selection store for the inbox multi-select. Lives outside
// the workbench store on purpose: selection is ephemeral, must not persist
// across reloads, and must be accessible from the Cmd-K palette without
// drilling props.
//
// Implemented with Zustand for parity with `lib/workbench/store.ts`. NO
// `persist` middleware — selection is always cleared on a hard reload.
//
// Workspace-keyed so a workspace switch (or sign-out) drops selection from
// the previous workspace cleanly.

import { create } from 'zustand';

interface InboxSelectionState {
  workspaceID: string | null;
  /** Order-preserving selection for bulk-action UI; reads use a Set lookup. */
  ids: ReadonlyArray<string>;
  /** Index of the last toggled row in the *currently filtered* list — used for shift-range. */
  lastToggledIndex: number | null;

  setWorkspace: (workspaceID: string | null) => void;
  toggle: (id: string) => void;
  add: (id: string) => void;
  remove: (id: string) => void;
  setMany: (ids: ReadonlyArray<string>) => void;
  clear: () => void;
  setLastToggledIndex: (index: number | null) => void;
}

export const useInboxSelectionStore = create<InboxSelectionState>((set) => ({
  workspaceID: null,
  ids: [],
  lastToggledIndex: null,

  setWorkspace: (workspaceID) =>
    set((state) =>
      state.workspaceID === workspaceID ? state : { workspaceID, ids: [], lastToggledIndex: null },
    ),

  toggle: (id) =>
    set((state) => {
      if (state.ids.includes(id)) {
        return { ids: state.ids.filter((x) => x !== id) };
      }
      return { ids: [...state.ids, id] };
    }),

  add: (id) => set((state) => (state.ids.includes(id) ? state : { ids: [...state.ids, id] })),

  remove: (id) => set((state) => ({ ids: state.ids.filter((x) => x !== id) })),

  setMany: (ids) => set({ ids: [...ids] }),

  clear: () => set({ ids: [], lastToggledIndex: null }),

  setLastToggledIndex: (index) => set({ lastToggledIndex: index }),
}));
