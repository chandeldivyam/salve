import type { ActionID } from '@opendesk/action-contracts';
import type { UntypedExecutor } from './ctx.js';
import { ticketExecutors } from './tickets.js';

export const executors = {
  ...ticketExecutors,
} satisfies Partial<Record<ActionID, UntypedExecutor>>;
