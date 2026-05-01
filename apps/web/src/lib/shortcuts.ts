// Keyboard shortcut helpers — single source of truth for the
// "skip when typing in an input" gate. Mirrors zbugs `use-keypress.ts`.
//
// Two functions: `useShortcut(key, fn)` for a single key, and the
// platform-detection `isMod(e)` for ⌘/Ctrl modifier checks.

import { useKeyBinding } from './commands/use-key-binding';

export type ShortcutKey =
  | string // a single character or named key (e.g. 'j', 'Enter', 'ArrowDown')
  | readonly string[]; // any of these keys triggers

export interface UseShortcutOptions {
  /** Allow firing when the user is typing in an input/textarea. Default false. */
  allowInInputs?: boolean;
  /** Suppress preventDefault. Default true. */
  preventDefault?: boolean;
  /** Disable temporarily (e.g. when a modal is open). Default true. */
  enabled?: boolean;
}

const isMac = typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform);

/** Returns true when the user is typing in an input/textarea/contenteditable. */
export function isTypingInElement(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  if (el.isContentEditable) return true;
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)) return true;
  const combobox = el.closest('[role="combobox"], [role="listbox"]');
  return !!combobox && combobox.getAttribute('aria-expanded') === 'true';
}

/** True when the event has the platform-correct modifier (Cmd on macOS, Ctrl elsewhere). */
export function isMod(e: KeyboardEvent | React.KeyboardEvent): boolean {
  return isMac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
}

/**
 * Bind a keyboard shortcut at the window level, gated to skip while the
 * user is typing in an input. The handler receives the raw `KeyboardEvent`
 * so it can inspect modifiers if needed.
 */
export function useShortcut(
  key: ShortcutKey,
  fn: (e: KeyboardEvent) => void,
  options: UseShortcutOptions = {},
): void {
  const { allowInInputs = false, preventDefault = true, enabled = true } = options;
  useKeyBinding(keyToPattern(key), fn, {
    scopes: ['app'],
    allowInInputs,
    preventDefault,
    enabled,
  });
}

function keyToPattern(key: ShortcutKey): string | ReadonlyArray<string> {
  if (typeof key !== 'string') return key.map(normalizeShortcutKey);
  return normalizeShortcutKey(key);
}

function normalizeShortcutKey(key: string): string {
  return key === 'Escape' ? 'Escape' : key;
}
