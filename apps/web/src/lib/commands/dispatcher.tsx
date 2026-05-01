import { useEffect } from 'react';
import { activeScopes, allCommands, type KeyBinding, useCommandRegistry } from './registry';
import { resolveTarget } from './target';

const CHORD_TIMEOUT_MS = 1000;

let chordTimer: number | null = null;

export function HotkeyDispatcher(): null {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => dispatchKeyDown(event);
    window.addEventListener('keydown', onKeyDown, { capture: true });
    return () => {
      window.removeEventListener('keydown', onKeyDown, { capture: true });
      clearChordTimer();
    };
  }, []);

  return null;
}

function dispatchKeyDown(event: KeyboardEvent): void {
  const registry = useCommandRegistry.getState();
  const scopes = activeScopes();
  const scopedBindings = Object.values(registry.bindings).filter(
    (binding) =>
      binding.enabled !== false && binding.scopes.some((scope) => scopes.includes(scope)),
  );
  const target = event.target as HTMLElement | null;
  const filtered = isTypingIn(target)
    ? scopedBindings.filter((binding) => binding.allowInInputs)
    : scopedBindings;
  // Specificity-first matching: when both `j` and `Shift+j` are bound, the
  // user pressing Shift+J must hit `Shift+j` regardless of registration
  // order. `bindingSpecificity` ranks by modifier count then by sequence
  // length; ties fall back to string length so e.g. `Enter` beats `e`
  // when both somehow align — they don't in practice, but this keeps the
  // ordering deterministic.
  const bindings = [...filtered].sort(
    (a, b) => bindingSpecificity(b.pattern) - bindingSpecificity(a.pattern),
  );
  const pending = registry.pendingChord;

  if (pending) {
    const matched = findMatchingBinding(event, bindings, pending);
    clearPendingChord();
    if (matched) {
      runBinding(event, matched);
      return;
    }
  }

  const chordPrefix = findChordPrefix(event, bindings);
  if (chordPrefix) {
    event.preventDefault();
    useCommandRegistry.getState().setPendingChord(chordPrefix);
    clearChordTimer();
    chordTimer = window.setTimeout(clearPendingChord, CHORD_TIMEOUT_MS);
    return;
  }

  const binding = findMatchingBinding(event, bindings, null);
  if (!binding) return;
  runBinding(event, binding);
}

function runBinding(event: KeyboardEvent, binding: KeyBinding): void {
  const target = event.target as HTMLElement | null;
  if (!binding.allowInInputs && isTypingIn(target)) return;
  if (binding.preventDefault !== false) event.preventDefault();

  if (binding.dispatch.type === 'effect') {
    binding.dispatch.effect(event);
    return;
  }

  const commandId = binding.dispatch.type === 'command' ? binding.dispatch.commandId : null;
  const command = allCommands().find((candidate) => candidate.id === commandId);
  const resolved = resolveTarget({ allowInInputs: binding.allowInInputs });
  if (!command?.accepts(resolved)) return;
  const ctx = useCommandRegistry.getState().commandContext;
  if (!ctx) return;
  const condition = command.condition?.(resolved, ctx);
  if (typeof condition === 'string') return;
  if (command.subPage) {
    useCommandRegistry.getState().setPaletteRequest({ commandId: command.id, target: resolved });
    ctx.openPalette();
    return;
  }
  void command.run(resolved, ctx);
}

function findMatchingBinding(
  event: KeyboardEvent,
  bindings: ReadonlyArray<KeyBinding>,
  pendingChord: string | null,
): KeyBinding | null {
  for (const binding of bindings) {
    const pattern = pendingChord ? `${pendingChord} ${eventPart(event)}` : eventPart(event);
    if (patternMatchesEvent(binding.pattern, event, pendingChord) || binding.pattern === pattern) {
      return binding;
    }
  }
  return null;
}

function findChordPrefix(event: KeyboardEvent, bindings: ReadonlyArray<KeyBinding>): string | null {
  const part = eventPart(event);
  if (!part) return null;
  return bindings.some((binding) => binding.pattern.startsWith(`${part} `)) ? part : null;
}

function patternMatchesEvent(
  pattern: string,
  event: KeyboardEvent,
  pendingChord: string | null,
): boolean {
  const parts = pattern.split(' ');
  if (pendingChord) {
    if (parts.length < 2 || parts[0] !== pendingChord) return false;
    return singlePartMatches(parts[1] ?? '', event);
  }
  if (parts.length > 1) return false;
  return singlePartMatches(parts[0] ?? '', event);
}

function singlePartMatches(part: string, event: KeyboardEvent): boolean {
  const tokens = part.split('+').filter(Boolean);
  const keyToken = tokens.at(-1) ?? '';
  const wantsMod = tokens.some((token) => token.toLowerCase() === '$mod' || token === 'mod');
  const wantsShift = tokens.some((token) => token.toLowerCase() === 'shift');
  const wantsAlt = tokens.some((token) => token.toLowerCase() === 'alt');
  const wantsCtrl = tokens.some((token) => token.toLowerCase() === 'ctrl');
  const wantsMeta = tokens.some((token) => token.toLowerCase() === 'meta');

  if (wantsMod && !isMod(event)) return false;
  if (!wantsMod && !wantsCtrl && !wantsMeta && (event.metaKey || event.ctrlKey)) return false;
  if (wantsShift && !event.shiftKey) return false;
  if (!wantsShift && event.shiftKey && keyToken.length !== 1) return false;
  if (wantsAlt !== event.altKey) return false;
  if (wantsCtrl && !event.ctrlKey) return false;
  if (wantsMeta && !event.metaKey) return false;
  return normalizeKey(event.key) === normalizeKey(keyToken);
}

function eventPart(event: KeyboardEvent): string {
  const parts: string[] = [];
  if (isMod(event)) parts.push('$mod');
  else {
    if (event.ctrlKey) parts.push('ctrl');
    if (event.metaKey) parts.push('meta');
  }
  if (event.altKey) parts.push('alt');
  if (event.shiftKey && event.key.length !== 1) parts.push('Shift');
  parts.push(normalizeEventKey(event.key));
  return parts.join('+');
}

function normalizeEventKey(key: string): string {
  if (key === ' ') return 'Space';
  if (key.length === 1) return key.toLowerCase();
  return key;
}

function normalizeKey(key: string): string {
  if (key === 'Space') return ' ';
  if (key.length === 1) return key.toLowerCase();
  return key.toLowerCase();
}

function isMod(event: KeyboardEvent): boolean {
  const isMac = typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform);
  return isMac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
}

// Higher score wins. A binding with two modifiers (`$mod+Shift+w`) beats
// one (`$mod+w`); a chord (`g i`) beats either single-key binding because
// the prefix is consumed first via `findChordPrefix`. Pattern length
// breaks ties so multi-char keys (`Enter`, `Backspace`) outrank single
// letters when literally bound to the same modifier set.
function bindingSpecificity(pattern: string): number {
  const parts = pattern.split(' ');
  const sequenceWeight = parts.length * 1000;
  const lastPart = parts.at(-1) ?? '';
  const modifierWeight = lastPart.split('+').filter((token) => token).length * 10;
  return sequenceWeight + modifierWeight + lastPart.length;
}

function isTypingIn(el: HTMLElement | null): boolean {
  if (!el) return false;
  if (el.isContentEditable) return true;
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)) return true;
  const combobox = el.closest('[role="combobox"], [role="listbox"]');
  return !!combobox && combobox.getAttribute('aria-expanded') === 'true';
}

function clearPendingChord(): void {
  clearChordTimer();
  useCommandRegistry.getState().setPendingChord(null);
}

function clearChordTimer(): void {
  if (chordTimer !== null) {
    window.clearTimeout(chordTimer);
    chordTimer = null;
  }
}
