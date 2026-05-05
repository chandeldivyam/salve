import { customerActions } from '@opendesk/action-contracts';
import {
  addCustomerTagsExecutor,
  createCustomerNoteExecutor,
  deleteCustomerNoteExecutor,
  getCustomerExecutor,
  ingestCustomerEventExecutor,
  listCustomersExecutor,
  removeCustomerTagExecutor,
  setCustomerCustomFieldExecutor,
  updateCustomerExecutor,
  updateCustomerNoteExecutor,
} from '@opendesk/action-executor';
import { Hono } from 'hono';
import { actionHandler, actionMiddlewares, readJsonBody } from './action-route.js';

export const customersRouter = new Hono();
export const customerNotesRouter = new Hono();

customersRouter.get(
  '/',
  ...actionMiddlewares(customerActions.list),
  actionHandler(customerActions.list, listCustomersExecutor, (c) => ({
    limit: numberQuery(c.req.query('limit')),
    cursor: c.req.query('cursor'),
    search: c.req.query('search'),
  })),
);

customersRouter.get(
  '/:customerId',
  ...actionMiddlewares(customerActions.get),
  actionHandler(customerActions.get, getCustomerExecutor, (c) => ({
    customerId: c.req.param('customerId'),
  })),
);

customersRouter.patch(
  '/:customerId',
  ...actionMiddlewares(customerActions.update),
  actionHandler(customerActions.update, updateCustomerExecutor, async (c) => ({
    ...(await readJsonBody(c)),
    customerId: c.req.param('customerId'),
  })),
);

customersRouter.post(
  '/:customerId/notes',
  ...actionMiddlewares(customerActions.notesCreate),
  actionHandler(
    customerActions.notesCreate,
    createCustomerNoteExecutor,
    async (c) => ({
      ...(await readJsonBody(c)),
      customerId: c.req.param('customerId'),
    }),
    201,
  ),
);

customerNotesRouter.patch(
  '/:noteId',
  ...actionMiddlewares(customerActions.notesUpdate),
  actionHandler(customerActions.notesUpdate, updateCustomerNoteExecutor, async (c) => ({
    ...(await readJsonBody(c)),
    noteId: c.req.param('noteId'),
  })),
);

customerNotesRouter.delete(
  '/:noteId',
  ...actionMiddlewares(customerActions.notesDelete),
  actionHandler(customerActions.notesDelete, deleteCustomerNoteExecutor, (c) => ({
    noteId: c.req.param('noteId'),
  })),
);

customersRouter.post(
  '/:customerId/tags',
  ...actionMiddlewares(customerActions.tagsAdd),
  actionHandler(customerActions.tagsAdd, addCustomerTagsExecutor, async (c) => ({
    ...(await readJsonBody(c)),
    customerId: c.req.param('customerId'),
  })),
);

customersRouter.delete(
  '/:customerId/tags/:tagId',
  ...actionMiddlewares(customerActions.tagsRemove),
  actionHandler(customerActions.tagsRemove, removeCustomerTagExecutor, (c) => ({
    customerId: c.req.param('customerId'),
    tagId: c.req.param('tagId'),
  })),
);

customersRouter.post(
  '/:customerId/events',
  ...actionMiddlewares(customerActions.eventsIngest),
  actionHandler(
    customerActions.eventsIngest,
    ingestCustomerEventExecutor,
    async (c) => ({
      ...(await readJsonBody(c)),
      customerId: c.req.param('customerId'),
    }),
    201,
  ),
);

customersRouter.put(
  '/:customerId/custom-fields/:fieldKey',
  ...actionMiddlewares(customerActions.customFieldSet),
  actionHandler(customerActions.customFieldSet, setCustomerCustomFieldExecutor, async (c) => ({
    ...(await readJsonBody(c)),
    customerId: c.req.param('customerId'),
    fieldKey: c.req.param('fieldKey'),
  })),
);

function numberQuery(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}
