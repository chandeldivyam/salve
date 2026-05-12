// REST endpoints for the v0 Atlas migration.
//
// POST /api/migrations/atlas/start  — kick off a run, dispatches Inngest event.
// GET  /api/migrations/:runId       — read current state for the active workspace.

import { randomUUID } from 'node:crypto';
import { getClient } from '@salve/db';
import { AtlasClient } from '@salve/migration-atlas';
import type { Context } from 'hono';
import { z } from 'zod';
import { inngest } from '../inngest/client.js';
import { MIGRATION_EVENT } from '../inngest/events.js';
import { type AuthContext, authOf } from '../middleware.js';

/**
 * Migration writes touch third-party credentials and durable workspace state.
 * Restrict to workspace owner/admin so an agent role can't store API keys or
 * mutate Atlas webhooks. Pattern matches public-api/api-tokens.ts.
 */
export function requireAdminRole(ctx: AuthContext): { error: string; status: 403 } | null {
  if (ctx.role !== 'owner' && ctx.role !== 'admin') {
    return { error: 'forbidden-role', status: 403 };
  }
  return null;
}

/**
 * Build a debuggable error payload from a failed Atlas probe call. Undici
 * wraps DNS/TCP/TLS failures as `TypeError: fetch failed` with the real
 * reason on `.cause` (e.g. `ENOTFOUND`, `ECONNREFUSED`, `UND_ERR_SOCKET`).
 * Without surfacing it, the operator just sees "fetch failed" and has no
 * way to tell a typo'd host from a transient DNS blip.
 */
export function atlasProbeError(err: unknown, where: string) {
  const message = err instanceof Error ? err.message : String(err);
  const cause = (err as { cause?: unknown })?.cause;
  const causeCode =
    cause && typeof cause === 'object' && 'code' in cause
      ? String((cause as { code: unknown }).code)
      : undefined;
  const causeMessage =
    cause instanceof Error ? cause.message : cause != null ? String(cause) : undefined;
  console.error(`[atlas-probe:${where}] failed`, { message, causeCode, causeMessage });
  return {
    error: 'atlas-auth-failed' as const,
    message,
    causeCode,
    causeMessage,
  };
}

const startSchema = z.object({
  apiKey: z.string().min(10),
  baseUrl: z.string().url().optional(),
  maxTickets: z.number().int().positive().max(500).default(10),
  /** Filter to conversations created in the last N days (Atlas filters on
   *  started_at, not updated_at — so this is a creation-time window). */
  sinceDays: z.number().int().positive().max(365).optional(),
  /** Explicit ISO start/end overrides; when set they win over sinceDays. */
  startDate: z.iso.datetime().optional(),
  endDate: z.iso.datetime().optional(),
});

export async function handleStartAtlasMigration(c: Context) {
  const ctx = authOf(c);
  const workspaceId = ctx.workspaceID;
  if (!workspaceId) return c.json({ error: 'no-workspace' }, 403);
  const denied = requireAdminRole(ctx);
  if (denied) return c.json({ error: denied.error }, denied.status);

  const body = await c.req.json().catch(() => null);
  const parsed = startSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'invalid-body', details: parsed.error.flatten() }, 400);
  }
  const { apiKey, baseUrl, maxTickets, sinceDays, startDate, endDate } = parsed.data;

  // Smoke-test the credentials before persisting a run row — this gives the
  // operator an immediate 400 on a bad key rather than a silent Inngest fail.
  try {
    const probe = new AtlasClient({ apiKey, baseUrl });
    await probe.listConversations({ cursor: 0, limit: 1 });
  } catch (err) {
    return c.json(atlasProbeError(err, 'start'), 400);
  }

  const sql = getClient();
  const runId = `mig_${randomUUID()}`;

  // Credentials live in `secrets.migration_credential` so zero-cache never
  // sees them (Zero replicates `public` only). `has_api_key` on the run row
  // is the UI-safe presence flag the web client reads.
  await sql.begin(async (tx) => {
    await tx`
      INSERT INTO migration_run (id, workspace_id, source, status, params, counters, has_api_key)
      VALUES (
        ${runId}, ${workspaceId}, 'atlas', 'pending',
        ${JSON.stringify({
          maxTickets,
          sinceDays: sinceDays ?? null,
          startDate: startDate ?? null,
          endDate: endDate ?? null,
        })}::jsonb,
        '{}'::jsonb,
        true
      )
    `;
    await tx`
      INSERT INTO secrets.migration_credential (run_id, workspace_id, api_key, base_url)
      VALUES (${runId}, ${workspaceId}, ${apiKey}, ${baseUrl ?? null})
    `;
  });

  // Event payload carries only IDs — the function re-reads apiKey + baseUrl +
  // maxTickets/sinceDays/etc from `migration_run` inside step.run. Inngest's
  // event history persists payloads, so secrets must not live here.
  await inngest.send({
    id: `mig-start-${runId}`,
    name: MIGRATION_EVENT.ATLAS_START,
    data: { runId, workspaceID: workspaceId },
  });

  return c.json({ runId, status: 'pending', maxTickets, sinceDays, startDate, endDate }, 202);
}

export async function handleGetAtlasMigration(c: Context) {
  const ctx = authOf(c);
  const workspaceId = ctx.workspaceID;
  if (!workspaceId) return c.json({ error: 'no-workspace' }, 403);
  const runId = c.req.param('runId');
  if (!runId) return c.json({ error: 'missing-run-id' }, 400);

  const sql = getClient();
  // Explicit field projection only — `api_key` is in `secrets.migration_credential`
  // and is intentionally NOT joined here. The UI uses `hasApiKey` (boolean).
  // baseUrl is a host name and not sensitive, so it's safe to surface.
  const rows = await sql<
    {
      id: string;
      source: string;
      status: string;
      has_api_key: boolean;
      base_url: string | null;
      max_tickets: number | null;
      since_days: number | null;
      start_date: string | null;
      end_date: string | null;
      counters: Record<string, number>;
      error: string | null;
      started_at: Date;
      completed_at: Date | null;
      updated_at: Date;
    }[]
  >`
    SELECT
      r.id, r.source, r.status, r.has_api_key,
      c.base_url                                   AS base_url,
      NULLIF(r.params ->> 'maxTickets','')::int    AS max_tickets,
      NULLIF(r.params ->> 'sinceDays','')::int     AS since_days,
      r.params ->> 'startDate'                     AS start_date,
      r.params ->> 'endDate'                       AS end_date,
      r.counters, r.error, r.started_at, r.completed_at, r.updated_at
    FROM migration_run r
    LEFT JOIN secrets.migration_credential c ON c.run_id = r.id
    WHERE r.id = ${runId} AND r.workspace_id = ${workspaceId}
    LIMIT 1
  `;
  const run = rows[0];
  if (!run) return c.json({ error: 'not-found' }, 404);

  // Bonus: count target rows mapped during this run for an at-a-glance check.
  const counts = await sql<{ entity_type: string; n: number }[]>`
    SELECT entity_type, count(*)::int AS n
    FROM migration_external_id_map
    WHERE workspace_id = ${workspaceId} AND source = ${run.source} AND run_id = ${runId}
    GROUP BY entity_type
  `;

  return c.json({
    runId: run.id,
    source: run.source,
    status: run.status,
    hasApiKey: run.has_api_key,
    baseUrl: run.base_url,
    maxTickets: run.max_tickets,
    sinceDays: run.since_days,
    startDate: run.start_date,
    endDate: run.end_date,
    counters: run.counters,
    error: run.error,
    startedAt: run.started_at,
    completedAt: run.completed_at,
    updatedAt: run.updated_at,
    eim: Object.fromEntries(counts.map((r) => [r.entity_type, r.n])),
  });
}
