import type { ActionID } from '@opendesk/action-contracts';

const DESCRIPTIONS: Partial<Record<ActionID, string>> = {
  whoami:
    'Return the authenticated Salve principal, active workspace, role, scopes, and request ID.',
  'workspace.list': 'List workspaces visible to the token and identify the active workspace.',
  'tickets.list': 'Find tickets by status, assignee, customer, cursor, or limit.',
  'tickets.get': 'Read one ticket with customer, tags, custom fields, and recent messages.',
  'tickets.create': 'Create a support ticket. Uses a generated idempotency key for safe retries.',
  'tickets.update': 'Update ticket title, description, or priority.',
  'tickets.assign': 'Assign a ticket to a user ID, or pass null to unassign.',
  'tickets.snooze': 'Snooze a ticket until an ISO 8601 timestamp.',
  'tickets.markInProgress': 'Move a ticket into the in-progress state.',
  'tickets.resolve': 'Resolve a ticket without closing it.',
  'tickets.close': 'Close a ticket. Destructive: usually ends active support work.',
  'tickets.reopen': 'Reopen a resolved or closed ticket.',
  'tickets.reply':
    'Send a public customer-visible reply. Uses a generated idempotency key for safe retries.',
  'tickets.note':
    'Add an internal note visible only to agents. Uses a generated idempotency key for safe retries.',
  'tickets.message.update': 'Edit an internal note authored by the current principal.',
  'tickets.message.delete': 'Delete an internal note authored by the current principal.',
  'tickets.tags.add': 'Add one or more tag IDs to a ticket.',
  'tickets.tags.replace': 'Replace all tags on a ticket with the supplied tag IDs.',
  'tickets.tags.remove': 'Remove one tag from a ticket.',
  'tickets.customField.set': 'Set a ticket custom-field value by field key.',
  'customers.list': 'Search customers by email/name text with cursor pagination.',
  'customers.get': 'Read a customer profile with tags, custom fields, notes, and recent events.',
  'customers.update': 'Update customer profile fields or metadata.',
  'customers.notes.delete': 'Delete a customer note authored by the current principal.',
  'customers.customField.set': 'Set a customer custom-field value by field key.',
  'views.list': 'List inbox views visible to the authenticated principal.',
  'views.delete': 'Archive a saved inbox view owned by the caller.',
  'views.tickets': 'List tickets matching a saved inbox view.',
  'settings.tags.list': 'List workspace tag groups and tags.',
  'settings.customFields.list': 'List ticket and customer custom-field definitions.',
  'settings.email.domains.create':
    'Create a sending domain and start async provisioning. Uses a generated idempotency key.',
};

export function descriptionForAction(id: ActionID, fallback: string): string {
  return DESCRIPTIONS[id] ?? fallback;
}
