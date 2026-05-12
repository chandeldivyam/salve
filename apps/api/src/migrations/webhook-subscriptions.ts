// REST endpoints for Atlas webhook subscription management.
//
//   GET    /api/migrations/atlas/webhooks               — list active + supported events
//   POST   /api/migrations/atlas/webhooks/subscribe     — { runId, event } → call Atlas + store secret
//   POST   /api/migrations/atlas/webhooks/unsubscribe   — { event } → call Atlas + delete row
//
// The receiver lives at /api/migrations/atlas/webhook/:subId. We pick the
// :subId at subscription-creation time so the receive endpoint can find the
// per-event secret without Atlas needing to ship a subscription_id (it does
// not).

import { randomUUID } from 'node:crypto';
import { getClient } from '@salve/db';
import {
  AtlasApiError,
  AtlasClient,
  type AtlasWebhookEvent,
  PHASE_4A_EVENTS,
} from '@salve/migration-atlas';
import type { Context } from 'hono';
import { z } from 'zod';
import { authOf } from '../middleware.js';
import { atlasProbeError, requireAdminRole } from './routes.js';

/**
 * Build a 502 payload for an Atlas call that failed before getting an HTTP
 * response (DNS, TCP, TLS). Mirrors atlasProbeError's shape so the web client
 * can surface causeCode in the toast.
 */
function atlasNetworkError(err: unknown, where: string) {
  const message = err instanceof Error ? err.message : String(err);
  const cause = (err as { cause?: unknown })?.cause;
  const causeCode =
    cause && typeof cause === 'object' && 'code' in cause
      ? String((cause as { code: unknown }).code)
      : undefined;
  console.error(`[atlas-network:${where}] failed`, { message, causeCode });
  return { error: 'atlas-unreachable' as const, message, causeCode, where };
}

interface SubscriptionRow {
  id: string;
  workspace_id: string;
  run_id: string | null;
  source: string;
  event: string;
  remote_id: string;
  endpoint: string;
  status: string;
  created_at: Date;
  updated_at: Date;
}

interface RunRow {
  id: string;
  status: string;
  api_key: string | null;
  base_url: string | null;
  started_at: Date;
}

function publicApiBase(): string {
  // PUBLIC_API_URL points at the URL Atlas should call back into. In dev we
  // expect the operator to expose 3001 via an HTTPS tunnel (e.g. ngrok).
  return (
    process.env.SALVE_PUBLIC_API_URL ??
    process.env.PUBLIC_API_URL ??
    'http://localhost:3001'
  ).replace(/\/+$/, '');
}

async function pickRunForWorkspace(workspaceId: string): Promise<RunRow | null> {
  const sql = getClient();
  // Most recent atlas run for the workspace; preferring non-failed runs.
  // Phase 4a expects a single run + subscriptions. When the operator has
  // multiple historical runs, the latest one is the correct binding for
  // active webhook activity. Credentials are joined from `secrets`.
  const rows = await sql<RunRow[]>`
    SELECT r.id, r.status, c.api_key, c.base_url, r.started_at
    FROM migration_run r
    LEFT JOIN secrets.migration_credential c ON c.run_id = r.id
    WHERE r.workspace_id = ${workspaceId}
      AND r.source = 'atlas'
      AND r.status <> 'failed'
    ORDER BY r.started_at DESC
    LIMIT 1
  `;
  return rows[0] ?? null;
}

const subscribeBody = z.object({
  event: z.string().min(1),
  runId: z.string().min(1).optional(),
});

export async function handleSubscribeAtlasWebhook(c: Context): Promise<Response> {
  const ctx = authOf(c);
  const workspaceId = ctx.workspaceID;
  if (!workspaceId) return c.json({ error: 'no-workspace' }, 403);
  const denied = requireAdminRole(ctx);
  if (denied) return c.json({ error: denied.error }, denied.status);

  const body = await c.req.json().catch(() => null);
  const parsed = subscribeBody.safeParse(body);
  if (!parsed.success) return c.json({ error: 'invalid-body' }, 400);
  const event = parsed.data.event as AtlasWebhookEvent;
  if (!PHASE_4A_EVENTS.has(event)) {
    return c.json({ error: 'event-not-supported', event }, 400);
  }

  const sql = getClient();

  // Resolve the run + apiKey to use.
  const run = parsed.data.runId
    ? (
        await sql<RunRow[]>`
          SELECT r.id, r.status, c.api_key, c.base_url, r.started_at
          FROM migration_run r
          LEFT JOIN secrets.migration_credential c ON c.run_id = r.id
          WHERE r.id = ${parsed.data.runId} AND r.workspace_id = ${workspaceId}
          LIMIT 1
        `
      )[0]
    : await pickRunForWorkspace(workspaceId);
  if (!run) return c.json({ error: 'no-run' }, 400);
  const apiKey = run.api_key;
  if (!apiKey) return c.json({ error: 'no-api-key-on-run' }, 400);

  const atlas = new AtlasClient({ apiKey, baseUrl: run.base_url ?? undefined });

  // Already-subscribed (or previously inactive) → reactivate on Atlas
  // instead of creating a duplicate (Atlas enforces uniqueness on
  // (company, event, endpoint) and would 409). Reactivation preserves the
  // existing signing_secret so the receiver keeps verifying deliveries.
  const existing = await sql<SubscriptionRow[]>`
    SELECT id, workspace_id, run_id, source, event, remote_id, endpoint,
           status, created_at, updated_at
    FROM migration_webhook_subscription
    WHERE workspace_id = ${workspaceId} AND source = 'atlas' AND event = ${event}
    LIMIT 1
  `;
  const prior = existing[0];
  if (prior) {
    if (prior.status === 'active') {
      return c.json({ ok: true, alreadySubscribed: true });
    }
    try {
      await atlas.updateWebhookSubscription(prior.remote_id, {
        endpoint: prior.endpoint,
        status: 'ACTIVE',
      });
    } catch (err) {
      if (err instanceof AtlasApiError) {
        return c.json(
          { error: 'atlas-reactivate-failed', status: err.status, body: err.body },
          err.status === 404 ? 410 : 502,
        );
      }
      return c.json(atlasNetworkError(err, 'reactivate'), 502);
    }
    await sql`
      UPDATE migration_webhook_subscription
      SET status = 'active', updated_at = now()
      WHERE id = ${prior.id}
    `;
    return c.json({ ok: true, reactivated: true });
  }

  const subId = `wsub_${randomUUID()}`;
  const endpoint = `${publicApiBase()}/api/migrations/atlas/webhook/${subId}`;

  let remote: Awaited<ReturnType<AtlasClient['createWebhookSubscription']>>;
  try {
    remote = await atlas.createWebhookSubscription({ event, endpoint });
  } catch (err) {
    if (err instanceof AtlasApiError) {
      return c.json(
        { error: 'atlas-create-failed', status: err.status, body: err.body },
        err.status === 409 ? 409 : 502,
      );
    }
    return c.json(atlasNetworkError(err, 'create'), 502);
  }

  if (!remote.signingSecret) {
    // Defensive: Atlas's contract says signing_secret is returned exactly
    // once on create. If we got back an empty secret we cannot verify
    // future deliveries — bail loudly rather than persist a useless row.
    // Best-effort: deactivate the subscription we just created.
    try {
      await atlas.updateWebhookSubscription(remote.id, {
        endpoint,
        status: 'INACTIVE',
      });
    } catch {
      // ignore
    }
    return c.json({ error: 'atlas-missing-signing-secret' }, 502);
  }

  // Signing secret writes into `secrets.migration_webhook_credential`; the
  // public `migration_webhook_subscription` row carries everything except
  // the secret so Zero can replicate it without leaking.
  await sql.begin(async (tx) => {
    await tx`
      INSERT INTO migration_webhook_subscription (
        id, workspace_id, run_id, source, event, remote_id, endpoint,
        status, created_at, updated_at
      ) VALUES (
        ${subId}, ${workspaceId}, ${run.id}, 'atlas', ${event},
        ${remote.id}, ${endpoint},
        'active', now(), now()
      )
    `;
    await tx`
      INSERT INTO secrets.migration_webhook_credential (subscription_id, workspace_id, signing_secret)
      VALUES (${subId}, ${workspaceId}, ${remote.signingSecret})
    `;
  });

  return c.json({
    ok: true,
    subscription: {
      id: subId,
      event,
      endpoint,
      remoteId: remote.id,
      status: 'active',
    },
  });
}

// Constrain both subscribe + unsubscribe to the same allowlist — no point
// in accepting an arbitrary string here just to reject it on lookup.
const PHASE_4A_EVENT_LIST = [
  'conversation.message',
  'conversation.status',
  'conversation.priority',
  'conversation.tags',
] as const;
const unsubscribeBody = z.object({ event: z.enum(PHASE_4A_EVENT_LIST) });

export async function handleUnsubscribeAtlasWebhook(c: Context): Promise<Response> {
  const ctx = authOf(c);
  const workspaceId = ctx.workspaceID;
  if (!workspaceId) return c.json({ error: 'no-workspace' }, 403);
  const denied = requireAdminRole(ctx);
  if (denied) return c.json({ error: denied.error }, denied.status);

  const body = await c.req.json().catch(() => null);
  const parsed = unsubscribeBody.safeParse(body);
  if (!parsed.success) return c.json({ error: 'invalid-body' }, 400);
  const event = parsed.data.event;

  const sql = getClient();
  const rows = await sql<
    Array<{ id: string; remote_id: string; run_id: string | null; endpoint: string }>
  >`
    SELECT id, remote_id, run_id, endpoint
    FROM migration_webhook_subscription
    WHERE workspace_id = ${workspaceId} AND source = 'atlas' AND event = ${event}
    LIMIT 1
  `;
  const sub = rows[0];
  if (!sub) return c.json({ ok: true, alreadyUnsubscribed: true });

  // Need apiKey to call Atlas — pick from the run that owns the subscription
  // (or fall back to the latest run for this workspace).
  let apiKey: string | undefined;
  let baseUrl: string | undefined;
  if (sub.run_id) {
    const runs = await sql<{ api_key: string | null; base_url: string | null }[]>`
      SELECT c.api_key, c.base_url
      FROM secrets.migration_credential c
      WHERE c.run_id = ${sub.run_id} AND c.workspace_id = ${workspaceId}
      LIMIT 1
    `;
    apiKey = runs[0]?.api_key ?? undefined;
    baseUrl = runs[0]?.base_url ?? undefined;
  }
  if (!apiKey) {
    const fallback = await pickRunForWorkspace(workspaceId);
    apiKey = fallback?.api_key ?? undefined;
    baseUrl = fallback?.base_url ?? undefined;
  }

  // Atlas's public /v1 API has no DELETE on webhooks (verified at
  // /Users/divyamchandel/Documents/atlas/app/webapp/web/external/routes/webhooks.py).
  // Only `POST /v1/webhooks/{id}` with `{endpoint, status: 'INACTIVE'}`. We
  // mirror that semantically as a soft remove: deactivate on Atlas, mark
  // our row inactive (keeping signing_secret so re-subscribing reuses it).
  if (apiKey) {
    try {
      const atlas = new AtlasClient({ apiKey, baseUrl });
      await atlas.updateWebhookSubscription(sub.remote_id, {
        endpoint: sub.endpoint,
        status: 'INACTIVE',
      });
    } catch (err) {
      if (err instanceof AtlasApiError && err.status !== 404) {
        return c.json(
          { error: 'atlas-deactivate-failed', status: err.status, body: err.body },
          502,
        );
      }
      // 404 → Atlas thinks the subscription is gone. Drop our row to match.
    }
  }

  await sql`
    UPDATE migration_webhook_subscription
    SET status = 'inactive', updated_at = now()
    WHERE id = ${sub.id}
  `;
  return c.json({ ok: true });
}

const setApiKeyBody = z.object({
  apiKey: z.string().min(10),
  baseUrl: z.string().url().optional(),
});

/**
 * Patch the latest (or specified) migration_run with an Atlas API key, so
 * the webhook subscription + lazy-expand flows have credentials. Validates
 * the key against Atlas before persisting (one cheap list call), so a
 * typo'd key is rejected up front.
 */
export async function handleSetAtlasRunApiKey(c: Context): Promise<Response> {
  const ctx = authOf(c);
  const workspaceId = ctx.workspaceID;
  if (!workspaceId) return c.json({ error: 'no-workspace' }, 403);
  const denied = requireAdminRole(ctx);
  if (denied) return c.json({ error: denied.error }, denied.status);

  const body = await c.req.json().catch(() => null);
  const parsed = setApiKeyBody.safeParse(body);
  if (!parsed.success) return c.json({ error: 'invalid-body' }, 400);
  const { apiKey, baseUrl } = parsed.data;

  // Smoke-test before persisting.
  try {
    const probe = new AtlasClient({ apiKey, baseUrl });
    await probe.listConversations({ cursor: 0, limit: 1 });
  } catch (err) {
    return c.json(atlasProbeError(err, 'set-api-key'), 400);
  }

  const sql = getClient();
  const run = await pickRunForWorkspace(workspaceId);
  if (!run) return c.json({ error: 'no-run' }, 400);

  // Upsert credential off-public + flip the presence flag. Atomic via tx.
  await sql.begin(async (tx) => {
    await tx`
      INSERT INTO secrets.migration_credential (run_id, workspace_id, api_key, base_url)
      VALUES (${run.id}, ${workspaceId}, ${apiKey}, ${baseUrl ?? null})
      ON CONFLICT (run_id) DO UPDATE
        SET api_key    = EXCLUDED.api_key,
            base_url   = EXCLUDED.base_url,
            updated_at = now()
    `;
    await tx`
      UPDATE migration_run
      SET has_api_key = true, updated_at = now()
      WHERE id = ${run.id} AND workspace_id = ${workspaceId}
    `;
  });

  return c.json({ ok: true, runId: run.id });
}
