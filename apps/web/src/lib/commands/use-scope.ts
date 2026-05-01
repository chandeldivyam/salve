import { useEffect } from 'react';
import { type Scope, useCommandRegistry } from './registry';

export function useScope(scope: Scope): void {
  useEffect(() => {
    const store = useCommandRegistry.getState();
    store.pushScope(scope);
    return () => useCommandRegistry.getState().popScope(scope);
  }, [scope]);
}
