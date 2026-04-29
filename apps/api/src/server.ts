import { serve } from '@hono/node-server';
import { SERVICE_NAME } from '@opendesk/core';
import { Hono } from 'hono';

const app = new Hono();

app.get('/', (c) =>
  c.text(`Hello from ${SERVICE_NAME}-api. Brand: Salve. See /healthz for status.`),
);

app.get('/healthz', (c) =>
  c.json({
    status: 'ok',
    service: 'opendesk-api',
    version: '0.0.0',
  }),
);

const port = Number.parseInt(process.env.PORT ?? '3001', 10);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`[opendesk-api] listening on http://localhost:${info.port}`);
});
