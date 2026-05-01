import { z } from 'zod';
import { create } from 'zustand';

export interface DraftSnapshot {
  bodyHTML: string;
  bodyText: string;
  selectedAddressID?: string;
  isInternal?: boolean;
  updatedAt: number;
}

interface ComposerDraftsState {
  userID: string | null;
  drafts: Record<string, DraftSnapshot>;
  initializeDrafts: (userID: string) => void;
  resetDrafts: () => void;
  getDraft: (workspaceID: string | null, ticketID: string) => DraftSnapshot | null;
  setDraft: (
    workspaceID: string | null,
    ticketID: string,
    snapshot: Partial<DraftSnapshot>,
  ) => void;
  clearDraft: (workspaceID: string | null, ticketID: string) => void;
}

const STORAGE_PREFIX = 'opendesk.composer-drafts.v1';

const draftSchema = z.object({
  bodyHTML: z.string().default(''),
  bodyText: z.string().default(''),
  selectedAddressID: z.string().optional(),
  isInternal: z.boolean().optional(),
  updatedAt: z.number(),
});

const draftsSchema = z.record(z.string(), draftSchema);

export const useComposerDraftsStore = create<ComposerDraftsState>((set, get) => ({
  userID: null,
  drafts: {},

  initializeDrafts: (userID) => set({ userID, drafts: loadDrafts(userID) }),
  resetDrafts: () => {
    const userID = get().userID;
    if (userID && typeof window !== 'undefined') {
      window.localStorage.removeItem(storageKey(userID));
    }
    set({ userID: null, drafts: {} });
  },
  getDraft: (workspaceID, ticketID) => get().drafts[draftKey(workspaceID, ticketID)] ?? null,
  setDraft: (workspaceID, ticketID, snapshot) => {
    const key = draftKey(workspaceID, ticketID);
    set((state) => ({
      drafts: {
        ...state.drafts,
        [key]: {
          bodyHTML: snapshot.bodyHTML ?? state.drafts[key]?.bodyHTML ?? '',
          bodyText: snapshot.bodyText ?? state.drafts[key]?.bodyText ?? '',
          selectedAddressID: snapshot.selectedAddressID ?? state.drafts[key]?.selectedAddressID,
          isInternal: snapshot.isInternal ?? state.drafts[key]?.isInternal,
          updatedAt: Date.now(),
        },
      },
    }));
    persistDrafts();
  },
  clearDraft: (workspaceID, ticketID) => {
    const key = draftKey(workspaceID, ticketID);
    set((state) => {
      const { [key]: _removed, ...rest } = state.drafts;
      return { drafts: rest };
    });
    persistDrafts();
  },
}));

export function resetDraftsForSignOut() {
  useComposerDraftsStore.getState().resetDrafts();
}

export function draftKey(workspaceID: string | null | undefined, ticketID: string): string {
  return `${workspaceID ?? 'no-workspace'}:${ticketID}`;
}

function storageKey(userID: string): string {
  return `${STORAGE_PREFIX}:${userID}`;
}

function loadDrafts(userID: string): Record<string, DraftSnapshot> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(storageKey(userID));
    if (!raw) return {};
    return draftsSchema.parse(JSON.parse(raw));
  } catch {
    return {};
  }
}

function persistDrafts() {
  const state = useComposerDraftsStore.getState();
  if (!state.userID || typeof window === 'undefined') return;
  window.localStorage.setItem(storageKey(state.userID), JSON.stringify(state.drafts));
}
