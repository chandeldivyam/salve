import { useEffect, useId, useMemo, useRef } from 'react';
import type { BindingDispatch, CommandGroup, Scope } from './registry';
import { useCommandRegistry } from './registry';

export interface UseKeyBindingOptions {
  readonly scopes?: ReadonlyArray<Scope>;
  readonly allowInInputs?: boolean;
  readonly preventDefault?: boolean;
  readonly enabled?: boolean;
  readonly label?: string;
  readonly group?: CommandGroup;
  readonly commandId?: string;
}

export function useKeyBinding(
  pattern: string | ReadonlyArray<string>,
  dispatch: BindingDispatch | ((event: KeyboardEvent) => void),
  options: UseKeyBindingOptions = {},
): void {
  const reactId = useId();
  const dispatchRef = useRef(dispatch);
  const patternKey = typeof pattern === 'string' ? pattern : pattern.join('\u0000');
  const scopesKey = (options.scopes ?? ['app']).join('\u0000');
  useEffect(() => {
    dispatchRef.current = dispatch;
  }, [dispatch]);

  const patterns = useMemo<string[]>(() => patternKey.split('\u0000'), [patternKey]);
  const scopes = useMemo(() => scopesKey.split('\u0000') as Scope[], [scopesKey]);

  useEffect(() => {
    if (options.enabled === false) return;
    const store = useCommandRegistry.getState();
    const ids = patterns.map((_item: string, index: number) => `${reactId}:${index}`);
    const dispatchRecord: BindingDispatch =
      typeof dispatchRef.current === 'function'
        ? {
            type: 'effect',
            effect: (event) => {
              const current = dispatchRef.current;
              if (typeof current === 'function') current(event);
            },
          }
        : dispatchRef.current;
    for (let index = 0; index < patterns.length; index += 1) {
      const item = patterns[index];
      const id = ids[index];
      if (!item || !id) continue;
      store.registerBinding({
        id,
        pattern: item,
        scopes,
        dispatch: dispatchRecord,
        allowInInputs: options.allowInInputs,
        preventDefault: options.preventDefault,
        enabled: options.enabled,
        label: options.label,
        group: options.group,
        commandId: options.commandId,
      });
    }
    return () => {
      for (const id of ids) {
        store.unregisterBinding(id);
      }
    };
  }, [
    reactId,
    patterns,
    scopes,
    options.allowInInputs,
    options.preventDefault,
    options.enabled,
    options.label,
    options.group,
    options.commandId,
  ]);
}
