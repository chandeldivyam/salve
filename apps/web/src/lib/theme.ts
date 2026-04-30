// Theme store — three modes (system/light/dark), persisted under
// `salve.theme`. The store mirrors the useSyncExternalStore pattern in
// `feedback.ts` so it stays SSR-safe even though we hydrate client-side
// today.
//
// `applyTheme()` is called once from `main.tsx` before React hydrates —
// otherwise the page paints in light, then snaps to dark on the first
// effect, producing a visible flash.

import { useSyncExternalStore } from 'react';

export type ThemeMode = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

const STORAGE_KEY = 'salve.theme';
const VALID_MODES: readonly ThemeMode[] = ['system', 'light', 'dark'];

const listeners = new Set<() => void>();
let mode: ThemeMode = 'system';
let resolved: ResolvedTheme = 'light';
let mediaQuery: MediaQueryList | null = null;
let booted = false;

function emit() {
  for (const listener of listeners) listener();
}

function readPersistedMode(): ThemeMode {
  if (typeof window === 'undefined') return 'system';
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored && (VALID_MODES as readonly string[]).includes(stored)) {
      return stored as ThemeMode;
    }
  } catch {
    // localStorage may be denied (e.g. Safari private mode); fall through.
  }
  return 'system';
}

function persistMode(next: ThemeMode) {
  if (typeof window === 'undefined') return;
  try {
    if (next === 'system') {
      window.localStorage.removeItem(STORAGE_KEY);
    } else {
      window.localStorage.setItem(STORAGE_KEY, next);
    }
  } catch {
    // ignore
  }
}

function systemPrefersDark(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function computeResolved(currentMode: ThemeMode): ResolvedTheme {
  if (currentMode === 'system') return systemPrefersDark() ? 'dark' : 'light';
  return currentMode;
}

function paintHtml(next: ResolvedTheme) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.classList.toggle('dark', next === 'dark');
  // color-scheme follows token CSS variables, but set the meta hint too so
  // form controls and scrollbars match before tokens load.
  root.style.colorScheme = next;
}

/**
 * Boot-time theme application. Run once before React hydrates so the very
 * first paint is correct (no FOUC). Safe to call multiple times — subsequent
 * calls re-resolve the current mode and re-paint without re-binding.
 */
export function applyTheme() {
  mode = readPersistedMode();
  resolved = computeResolved(mode);
  paintHtml(resolved);

  if (typeof window !== 'undefined' && window.matchMedia && !mediaQuery) {
    mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => {
      if (mode !== 'system') return;
      resolved = computeResolved(mode);
      paintHtml(resolved);
      emit();
    };
    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener('change', onChange);
    } else {
      // Safari < 14 fallback.
      mediaQuery.addListener(onChange);
    }
  }

  booted = true;
}

export function setThemeMode(next: ThemeMode) {
  if (!booted) applyTheme();
  if (mode === next) return;
  mode = next;
  resolved = computeResolved(mode);
  persistMode(mode);
  paintHtml(resolved);
  emit();
}

export function getThemeMode(): ThemeMode {
  return mode;
}

export function getResolvedTheme(): ResolvedTheme {
  return resolved;
}

interface ThemeSnapshot {
  mode: ThemeMode;
  resolved: ResolvedTheme;
}

let snapshot: ThemeSnapshot = { mode, resolved };

function refreshSnapshot() {
  if (snapshot.mode !== mode || snapshot.resolved !== resolved) {
    snapshot = { mode, resolved };
  }
  return snapshot;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot() {
  return refreshSnapshot();
}

function getServerSnapshot() {
  return snapshot;
}

export function useTheme(): ThemeSnapshot {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
