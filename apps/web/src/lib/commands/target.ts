import { useInboxSelectionStore } from '@/lib/inbox-selection';
import { isTypingInElement } from '@/lib/shortcuts';
import { useHoverTargetStore } from './hover-target';
import type { Target } from './registry';
import { useCommandRegistry } from './registry';

export function resolveTarget(options: { allowInInputs?: boolean } = {}): Target {
  if (!options.allowInInputs && isTypingInElement(document.activeElement)) {
    return { kind: 'none' };
  }

  const selection = useInboxSelectionStore.getState().ids;
  if (selection.length > 0) {
    return {
      kind: 'bulk',
      ids: [...selection],
      label: `${selection.length} ${selection.length === 1 ? 'ticket' : 'tickets'}`,
    };
  }

  const hover = useHoverTargetStore.getState().target;
  if (hover) return hover;

  const url = useCommandRegistry.getState().urlTarget?.target;
  return url ?? { kind: 'none' };
}

export function labelForTarget(target: Target): string | null {
  switch (target.kind) {
    case 'bulk':
      return target.label ?? `${target.ids.length} tickets`;
    case 'ticket':
      return target.label ?? `Ticket ${target.id}`;
    case 'customer':
      return target.label ?? 'Customer';
    case 'none':
      return null;
  }
}
