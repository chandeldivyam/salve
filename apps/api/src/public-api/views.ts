import { viewActions } from '@opendesk/action-contracts';
import {
  createViewExecutor,
  deleteViewExecutor,
  getViewExecutor,
  listViewsExecutor,
  updateViewExecutor,
  viewTicketsExecutor,
} from '@opendesk/action-executor';
import { Hono } from 'hono';
import { actionHandler, actionMiddlewares, readJsonBody } from './action-route.js';

export const viewsRouter = new Hono();

viewsRouter.get(
  '/',
  ...actionMiddlewares(viewActions.list),
  actionHandler(viewActions.list, listViewsExecutor, (c) => ({
    includeArchived: booleanQuery(c.req.query('includeArchived')),
  })),
);

viewsRouter.post(
  '/',
  ...actionMiddlewares(viewActions.create),
  actionHandler(viewActions.create, createViewExecutor, (c) => readJsonBody(c), 201),
);

viewsRouter.get(
  '/:viewId',
  ...actionMiddlewares(viewActions.get),
  actionHandler(viewActions.get, getViewExecutor, (c) => ({
    viewId: c.req.param('viewId'),
  })),
);

viewsRouter.patch(
  '/:viewId',
  ...actionMiddlewares(viewActions.update),
  actionHandler(viewActions.update, updateViewExecutor, async (c) => ({
    ...(await readJsonBody(c)),
    viewId: c.req.param('viewId'),
  })),
);

viewsRouter.delete(
  '/:viewId',
  ...actionMiddlewares(viewActions.delete),
  actionHandler(viewActions.delete, deleteViewExecutor, (c) => ({
    viewId: c.req.param('viewId'),
  })),
);

viewsRouter.get(
  '/:viewId/tickets',
  ...actionMiddlewares(viewActions.tickets),
  actionHandler(viewActions.tickets, viewTicketsExecutor, (c) => ({
    viewId: c.req.param('viewId'),
    limit: numberQuery(c.req.query('limit')),
    cursor: c.req.query('cursor'),
  })),
);

function booleanQuery(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  if (value === 'true' || value === '1') return true;
  if (value === 'false' || value === '0') return false;
  return undefined;
}

function numberQuery(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}
