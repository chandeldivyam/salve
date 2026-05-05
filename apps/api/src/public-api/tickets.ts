import { ticketActions } from '@opendesk/action-contracts';
import {
  addTicketTagsExecutor,
  assignTicketExecutor,
  closeTicketExecutor,
  createTicketExecutor,
  deleteMessageExecutor,
  getTicketExecutor,
  listTicketsExecutor,
  markTicketInProgressExecutor,
  noteExecutor,
  parseTicketListQuery,
  removeTicketTagExecutor,
  reopenTicketExecutor,
  replaceTicketTagsExecutor,
  replyExecutor,
  resolveTicketExecutor,
  setTicketCustomFieldExecutor,
  snoozeTicketExecutor,
  updateMessageExecutor,
  updateTicketExecutor,
} from '@opendesk/action-executor';
import { Hono } from 'hono';
import { actionHandler, actionMiddlewares, readJsonBody } from './action-route.js';

export const ticketsRouter = new Hono();

ticketsRouter.get(
  '/',
  ...actionMiddlewares(ticketActions.list),
  actionHandler(ticketActions.list, listTicketsExecutor, (c) =>
    parseTicketListQuery({
      limit: c.req.query('limit'),
      cursor: c.req.query('cursor'),
      status: c.req.query('status'),
      assigneeId: c.req.query('assigneeId'),
      customerId: c.req.query('customerId'),
    }),
  ),
);

ticketsRouter.post(
  '/',
  ...actionMiddlewares(ticketActions.create),
  actionHandler(ticketActions.create, createTicketExecutor, (c) => readJsonBody(c), 201),
);

ticketsRouter.get(
  '/:ticketId',
  ...actionMiddlewares(ticketActions.get),
  actionHandler(ticketActions.get, getTicketExecutor, (c) => ({
    ticketId: c.req.param('ticketId'),
  })),
);

ticketsRouter.patch(
  '/:ticketId',
  ...actionMiddlewares(ticketActions.update),
  actionHandler(ticketActions.update, updateTicketExecutor, async (c) => ({
    ...(await readJsonBody(c)),
    ticketId: c.req.param('ticketId'),
  })),
);

ticketsRouter.post(
  '/:ticketId/assign',
  ...actionMiddlewares(ticketActions.assign),
  actionHandler(ticketActions.assign, assignTicketExecutor, async (c) => ({
    ...(await readJsonBody(c)),
    ticketId: c.req.param('ticketId'),
  })),
);

ticketsRouter.post(
  '/:ticketId/snooze',
  ...actionMiddlewares(ticketActions.snooze),
  actionHandler(ticketActions.snooze, snoozeTicketExecutor, async (c) => ({
    ...(await readJsonBody(c)),
    ticketId: c.req.param('ticketId'),
  })),
);

ticketsRouter.post(
  '/:ticketId/in-progress',
  ...actionMiddlewares(ticketActions.markInProgress),
  actionHandler(ticketActions.markInProgress, markTicketInProgressExecutor, (c) => ({
    ticketId: c.req.param('ticketId'),
  })),
);

ticketsRouter.post(
  '/:ticketId/resolve',
  ...actionMiddlewares(ticketActions.resolve),
  actionHandler(ticketActions.resolve, resolveTicketExecutor, (c) => ({
    ticketId: c.req.param('ticketId'),
  })),
);

ticketsRouter.post(
  '/:ticketId/close',
  ...actionMiddlewares(ticketActions.close),
  actionHandler(ticketActions.close, closeTicketExecutor, (c) => ({
    ticketId: c.req.param('ticketId'),
  })),
);

ticketsRouter.post(
  '/:ticketId/reopen',
  ...actionMiddlewares(ticketActions.reopen),
  actionHandler(ticketActions.reopen, reopenTicketExecutor, (c) => ({
    ticketId: c.req.param('ticketId'),
  })),
);

ticketsRouter.post(
  '/:ticketId/replies',
  ...actionMiddlewares(ticketActions.reply),
  actionHandler(
    ticketActions.reply,
    replyExecutor,
    async (c) => ({
      ...(await readJsonBody(c)),
      ticketId: c.req.param('ticketId'),
    }),
    201,
  ),
);

ticketsRouter.post(
  '/:ticketId/notes',
  ...actionMiddlewares(ticketActions.note),
  actionHandler(
    ticketActions.note,
    noteExecutor,
    async (c) => ({
      ...(await readJsonBody(c)),
      ticketId: c.req.param('ticketId'),
    }),
    201,
  ),
);

ticketsRouter.patch(
  '/:ticketId/messages/:messageId',
  ...actionMiddlewares(ticketActions.messageUpdate),
  actionHandler(ticketActions.messageUpdate, updateMessageExecutor, async (c) => ({
    ...(await readJsonBody(c)),
    ticketId: c.req.param('ticketId'),
    messageId: c.req.param('messageId'),
  })),
);

ticketsRouter.delete(
  '/:ticketId/messages/:messageId',
  ...actionMiddlewares(ticketActions.messageDelete),
  actionHandler(ticketActions.messageDelete, deleteMessageExecutor, (c) => ({
    ticketId: c.req.param('ticketId'),
    messageId: c.req.param('messageId'),
  })),
);

ticketsRouter.post(
  '/:ticketId/tags',
  ...actionMiddlewares(ticketActions.tagsAdd),
  actionHandler(ticketActions.tagsAdd, addTicketTagsExecutor, async (c) => ({
    ...(await readJsonBody(c)),
    ticketId: c.req.param('ticketId'),
  })),
);

ticketsRouter.put(
  '/:ticketId/tags',
  ...actionMiddlewares(ticketActions.tagsReplace),
  actionHandler(ticketActions.tagsReplace, replaceTicketTagsExecutor, async (c) => ({
    ...(await readJsonBody(c)),
    ticketId: c.req.param('ticketId'),
  })),
);

ticketsRouter.delete(
  '/:ticketId/tags/:tagId',
  ...actionMiddlewares(ticketActions.tagsRemove),
  actionHandler(ticketActions.tagsRemove, removeTicketTagExecutor, (c) => ({
    ticketId: c.req.param('ticketId'),
    tagId: c.req.param('tagId'),
  })),
);

ticketsRouter.put(
  '/:ticketId/custom-fields/:fieldKey',
  ...actionMiddlewares(ticketActions.customFieldSet),
  actionHandler(ticketActions.customFieldSet, setTicketCustomFieldExecutor, async (c) => ({
    ...(await readJsonBody(c)),
    ticketId: c.req.param('ticketId'),
    fieldKey: c.req.param('fieldKey'),
  })),
);
