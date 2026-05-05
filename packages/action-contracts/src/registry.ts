import { CUSTOMER_ACTIONS } from './customers.js';
import { SETTINGS_ACTIONS } from './settings.js';
import { TICKET_ACTIONS } from './tickets.js';
import type { AnyActionContract } from './types.js';
import { VIEW_ACTIONS } from './views.js';

export const ALL_ACTIONS = [
  ...TICKET_ACTIONS,
  ...CUSTOMER_ACTIONS,
  ...VIEW_ACTIONS,
  ...SETTINGS_ACTIONS,
] as const satisfies readonly AnyActionContract[];

export type ActionID = (typeof ALL_ACTIONS)[number]['id'];

export const ACTION_BY_ID = Object.fromEntries(
  ALL_ACTIONS.map((action) => [action.id, action]),
) as Record<ActionID, (typeof ALL_ACTIONS)[number]>;
