import type { LucideIcon } from 'lucide-react';
import { create } from 'zustand';

export type Scope =
  | 'global'
  | 'app'
  | 'inbox'
  | 'conversation'
  | 'customer'
  | 'dialog:cmdk'
  | 'modal:help';
export type ModalKey = 'dialog:cmdk' | 'modal:help';

export type CommandGroup =
  | 'Navigation'
  | 'Open tabs'
  | 'Ticket'
  | 'Customer'
  | 'View'
  | 'Settings'
  | 'Help';

export type Target =
  | { kind: 'none' }
  | { kind: 'ticket'; id: string; label?: string }
  | { kind: 'customer'; id: string; label?: string }
  | { kind: 'bulk'; ids: ReadonlyArray<string>; label?: string };

export interface CommandContext {
  readonly workspaceID: string | null;
  readonly userID: string;
  readonly z: unknown;
  readonly navigateHref: (href: string, opts?: { fork?: boolean }) => void;
  readonly openPalette: () => void;
  readonly closePalette: () => void;
  readonly openHelp: () => void;
  readonly closeHelp: () => void;
  readonly routePathname: string;
}

export interface SubPageDescriptor {
  readonly id: string;
  readonly title: string;
  readonly commands: ReadonlyArray<Command>;
  readonly inheritsQuery?: boolean;
  readonly bindParentTarget: true;
}

export interface Command {
  readonly id: string;
  readonly label: string;
  readonly group: CommandGroup;
  readonly accepts: (target: Target) => boolean;
  readonly run: (target: Target, ctx: CommandContext) => void | Promise<void>;
  readonly description?: string;
  readonly icon?: LucideIcon;
  readonly keywords?: ReadonlyArray<string>;
  readonly order?: number;
  readonly condition?: (target: Target, ctx: CommandContext) => true | string;
  readonly subPage?: (target: Target, ctx: CommandContext) => SubPageDescriptor;
  /**
   * Display-only hotkey hint for commands whose key binding lives outside
   * the Command's own id (e.g. open tabs share one indexed `$mod+N`
   * binding). Not registered with the dispatcher.
   */
  readonly hotkeyHint?: string;
}

export type BindingDispatch =
  | { type: 'command'; commandId: string }
  | { type: 'effect'; effect: (event: KeyboardEvent) => void };

export interface KeyBinding {
  readonly id: string;
  readonly pattern: string;
  readonly scopes: ReadonlyArray<Scope>;
  readonly dispatch: BindingDispatch;
  readonly allowInInputs?: boolean;
  readonly preventDefault?: boolean;
  readonly enabled?: boolean;
  readonly label?: string;
  readonly group?: CommandGroup;
  readonly commandId?: string;
}

interface UrlTarget {
  target: Target;
  pathname: string;
}

export interface PaletteRequest {
  readonly commandId: string;
  readonly target: Target;
}

interface CommandRegistryState {
  commands: ReadonlyArray<Command>;
  routeCommands: Record<string, ReadonlyArray<Command>>;
  bindings: Record<string, KeyBinding>;
  scopeStack: ReadonlyArray<Scope>;
  modalStack: ReadonlyArray<ModalKey>;
  pendingChord: string | null;
  urlTarget: UrlTarget | null;
  commandContext: CommandContext | null;
  paletteRequest: PaletteRequest | null;
  helpOpen: boolean;
  version: number;
  setCommands: (commands: ReadonlyArray<Command>) => void;
  setRouteCommands: (routeId: string, commands: ReadonlyArray<Command>) => void;
  registerBinding: (binding: KeyBinding) => void;
  unregisterBinding: (id: string) => void;
  pushScope: (scope: Scope) => void;
  popScope: (scope: Scope) => void;
  pushModal: (modal: ModalKey) => void;
  popModal: (modal: ModalKey) => void;
  setPendingChord: (chord: string | null) => void;
  setUrlTarget: (target: UrlTarget | null) => void;
  setCommandContext: (ctx: CommandContext | null) => void;
  setPaletteRequest: (request: PaletteRequest | null) => void;
  setHelpOpen: (open: boolean) => void;
}

export const useCommandRegistry = create<CommandRegistryState>((set, get) => ({
  commands: [],
  routeCommands: {},
  bindings: {},
  scopeStack: [],
  modalStack: [],
  pendingChord: null,
  urlTarget: null,
  commandContext: null,
  paletteRequest: null,
  helpOpen: false,
  version: 0,

  setCommands: (commands) =>
    set((state) => ({ commands: [...commands], version: state.version + 1 })),

  setRouteCommands: (routeId, commands) =>
    set((state) => ({
      routeCommands: { ...state.routeCommands, [routeId]: [...commands] },
      version: state.version + 1,
    })),

  registerBinding: (binding) => {
    const normalized = normalizeBinding(binding);
    assertNoConflict(normalized, Object.values(get().bindings));
    set((state) => ({
      bindings: { ...state.bindings, [normalized.id]: normalized },
      version: state.version + 1,
    }));
  },

  unregisterBinding: (id) =>
    set((state) => {
      if (!state.bindings[id]) return state;
      const { [id]: _removed, ...bindings } = state.bindings;
      return { bindings, version: state.version + 1 };
    }),

  pushScope: (scope) =>
    set((state) => ({ scopeStack: [...state.scopeStack, scope], version: state.version + 1 })),

  popScope: (scope) =>
    set((state) => {
      const next = [...state.scopeStack];
      const index = next.lastIndexOf(scope);
      if (index >= 0) next.splice(index, 1);
      return { scopeStack: next, version: state.version + 1 };
    }),

  pushModal: (modal) =>
    set((state) => ({ modalStack: [...state.modalStack, modal], version: state.version + 1 })),

  popModal: (modal) =>
    set((state) => {
      const next = [...state.modalStack];
      const index = next.lastIndexOf(modal);
      if (index >= 0) next.splice(index, 1);
      return { modalStack: next, version: state.version + 1 };
    }),

  setPendingChord: (pendingChord) => set({ pendingChord }),
  setUrlTarget: (urlTarget) => set({ urlTarget }),
  setCommandContext: (commandContext) => set({ commandContext }),
  setPaletteRequest: (paletteRequest) => set({ paletteRequest }),
  setHelpOpen: (helpOpen) => set({ helpOpen }),
}));

export function allCommands(): ReadonlyArray<Command> {
  const state = useCommandRegistry.getState();
  return [
    ...state.commands,
    ...Object.values(state.routeCommands).flatMap((commands) => [...commands]),
  ];
}

export function activeScopes(): ReadonlyArray<Scope> {
  const { scopeStack, modalStack } = useCommandRegistry.getState();
  const topModal = modalStack.at(-1);
  if (topModal) return [topModal, 'global'];
  const ordered: Scope[] = [...scopeStack].reverse();
  return [...new Set<Scope>([...ordered, 'app', 'global'])];
}

function normalizeBinding(binding: KeyBinding): KeyBinding {
  return {
    ...binding,
    pattern: normalizePattern(binding.pattern),
    scopes: binding.scopes.length > 0 ? binding.scopes : ['app'],
    enabled: binding.enabled ?? true,
    preventDefault: binding.preventDefault ?? true,
  };
}

export function normalizePattern(pattern: string): string {
  return pattern.trim().replace(/\s+/g, ' ');
}

function assertNoConflict(next: KeyBinding, existing: ReadonlyArray<KeyBinding>): void {
  if (next.enabled === false) return;
  for (const binding of existing) {
    if (binding.id === next.id || binding.enabled === false) continue;
    const duplicate = next.scopes.find(
      (scope) => binding.scopes.includes(scope) && binding.pattern === next.pattern,
    );
    if (!duplicate) continue;
    reportConflict(`Duplicate hotkey ${next.pattern} in ${duplicate}.`);
  }

  const hasSequence = next.pattern.includes(' ');
  const startsWithG = next.pattern.split(' ')[0] === 'g';
  if (!startsWithG) return;
  for (const binding of existing) {
    if (binding.id === next.id || binding.enabled === false) continue;
    const overlaps = next.scopes.some((scope) => binding.scopes.includes(scope));
    if (!overlaps) continue;
    const otherHasSequence = binding.pattern.includes(' ');
    const otherStartsWithG = binding.pattern.split(' ')[0] === 'g';
    if (otherStartsWithG && hasSequence !== otherHasSequence) {
      reportConflict('Single-key g bindings cannot coexist with g-prefixed chords.');
    }
  }
}

function reportConflict(message: string): void {
  if (import.meta.env.DEV) throw new Error(message);
  console.warn(message);
}
