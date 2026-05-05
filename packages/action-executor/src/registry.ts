import type { ActionID } from '@salve/action-contracts';
import type { UntypedExecutor } from './ctx.js';
import { customerExecutors } from './customers.js';
import { settingsExecutors } from './settings.js';
import { ticketExecutors } from './tickets.js';
import { viewExecutors } from './views.js';

export const executors = {
  ...ticketExecutors,
  ...customerExecutors,
  ...viewExecutors,
  ...settingsExecutors,
} satisfies Partial<Record<ActionID, UntypedExecutor>>;
