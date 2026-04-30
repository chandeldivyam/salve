// Keyboard shortcut helpers — single source of truth for the
// "skip when typing in an input" gate. Mirrors zbugs `use-keypress.ts`.
//
// Two functions: `useShortcut(key, fn)` for a single key, and the
// platform-detection `isMod(e)` for ⌘/Ctrl modifier checks.

import { useEffect } from 'react';

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
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

/** True when the event has the platform-correct modifier (Cmd on macOS, Ctrl elsewhere). */
export function isMod(e: KeyboardEvent | React.KeyboardEvent): boolean {
  return isMac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
}

function matchesKey(e: KeyboardEvent, key: ShortcutKey): boolean {
  if (Array.isArray(key)) return key.includes(e.key);
  return e.key === (key as string);
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

  useEffect(() => {
    if (!enabled) return;
    const handler = (e: KeyboardEvent) => {
      if (!allowInInputs && isTypingInElement(e.target)) return;
      if (!matchesKey(e, key)) return;
      if (preventDefault) e.preventDefault();
      fn(e);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [key, fn, allowInInputs, preventDefault, enabled]);
}
