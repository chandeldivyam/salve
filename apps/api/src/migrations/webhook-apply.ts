// Webhook event → Salve apply paths. Each function takes a parsed Atlas
// payload and is idempotent via the EIM. Phase 4a covers four events:
//   conversation.message  (lazy-expand on miss)
//   conversation.status   (drop on miss)
//   conversation.priority (drop on miss)
//   conversation.tags     (drop on miss)
// "Drop on miss" means: if the conversation isn't already imported, we don't
// retroactively expand the migration scope. The operator's "last 7 days" or
// "last 500 tickets" stays a curated set; only conversation.message triggers
// lazy backfill (because new replies are the strongest signal of activity).

import { randomUUID } from 'node:crypto';
import { getClient } from '@salve/db';
import {
  type AtlasWebhookConversation,
  type AtlasWebhookMessage,
  mapPriority,
  mapStatus,
  toCanonicalMessage,
  toCanonicalTicket,
} from '@salve/migration-atlas';
import type postgres from 'postgres';
import { type UploadedAttachment, uploadAtlasAttachment } from './attachments.js';

type Sql = postgres.Sql<Record<string, unknown>>;
type TxSql = postgres.TransactionSql<Record<string, unknown>>;

const SOURCE = 'atlas';

interface ApplyContext {
  workspaceId: string;
  runId: string;
}

/** Resolve the Salve ticket id for an Atlas conversation, or null on miss. */
async function resolveTicketId(
  tx: TxSql,
  ctx: ApplyContext,
  atlasConvId: string,
): Promise<string | null> {
  const rows = await tx<{ target_id: string }[]>`
    SELECT target_id FROM migration_external_id_map
    WHERE workspace_id = ${ctx.workspaceId}
      AND source = ${SOURCE}
      AND entity_type = 'ticket'
      AND source_id = ${atlasConvId}
    LIMIT 1
  `;
  return rows[0]?.target_id ?? null;
}

async function resolveCustomerIdForTicket(tx: TxSql, ticketId: string): Promise<string | null> {
  const rows = await tx<{ customer_id: string | null }[]>`
    SELECT customer_id FROM ticket WHERE id = ${ticketId} LIMIT 1
  `;
  return rows[0]?.customer_id ?? null;
}

export interface StatusApplyResult {
  kind: 'applied' | 'miss' | 'noop';
  ticketId?: string;
}

export async function applyConversationStatus(
  ctx: ApplyContext,
  conv: AtlasWebhookConversation,
): Promise<StatusApplyResult> {
  const sql = getClient() as Sql;
  return sql.begin(async (tx) => {
    const ticketId = await resolveTicketId(tx, ctx, conv.id);
    if (!ticketId) return { kind: 'miss' };
    const status = mapStatus(conv.status);
    const closedAt = conv.closedAt ? new Date(conv.closedAt * 1000).toISOString() : null;
    await tx`
      UPDATE ticket
      SET status = ${status},
          closed_at = CASE WHEN ${status} = 'closed' THEN COALESCE(${closedAt}, closed_at, now())
                            ELSE NULL END,
          updated_at = GREATEST(updated_at, now())
      WHERE id = ${ticketId}
    `;
    return { kind: 'applied', ticketId };
  });
}

export async function applyConversationPriority(
  ctx: ApplyContext,
  conv: AtlasWebhookConversation,
): Promise<StatusApplyResult> {
  const sql = getClient() as Sql;
  return sql.begin(async (tx) => {
    const ticketId = await resolveTicketId(tx, ctx, conv.id);
    if (!ticketId) return { kind: 'miss' };
    const priority = mapPriority(conv.priority);
    await tx`
      UPDATE ticket
      SET priority = ${priority},
          updated_at = GREATEST(updated_at, now())
      WHERE id = ${ticketId}
    `;
    return { kind: 'applied', ticketId };
  });
}

export interface TagApplyResult {
  kind: 'applied' | 'miss';
  added: number;
  removed: number;
}

/**
 * Full set replacement on `ticket_tag`: add tags present in payload, remove
 * tags that were on the ticket but aren't in the new set. We only operate on
 * tags whose Atlas id is mapped via EIM (i.e. discovered during backfill or
 * on a later discovery pass) — unmapped Atlas tag ids are silently ignored.
 */
export async function applyConversationTags(
  ctx: ApplyContext,
  conv: AtlasWebhookConversation,
): Promise<TagApplyResult> {
  const sql = getClient() as Sql;
  const atlasTagIds = (conv.tags ?? []).filter((v): v is string => typeof v === 'string');

  return sql.begin(async (tx) => {
    const ticketId = await resolveTicketId(tx, ctx, conv.id);
    if (!ticketId) return { kind: 'miss', added: 0, removed: 0 };

    // Translate Atlas tag UUIDs → Salve tag UUIDs via the EIM.
    const mapped = atlasTagIds.length
      ? await tx<{ target_id: string }[]>`
          SELECT target_id FROM migration_external_id_map
          WHERE workspace_id = ${ctx.workspaceId}
            AND source = ${SOURCE}
            AND entity_type = 'tag'
            AND source_id = ANY(${tx.array(atlasTagIds)})
        `
      : [];
    const desired = new Set(mapped.map((r) => r.target_id));

    // CRITICAL: only consider Atlas-mapped tags as candidates for removal.
    // A native Salve tag (created by an agent in this workspace) must NEVER
    // be deleted by Atlas's notion of the ticket's tag set — Atlas doesn't
    // know about it. Without this scope, Atlas tags=[] would nuke every
    // ticket_tag row on the ticket.
    const current = await tx<{ tag_id: string }[]>`
      SELECT tt.tag_id
      FROM ticket_tag tt
      JOIN migration_external_id_map eim
        ON eim.workspace_id = tt.workspace_id
       AND eim.source = ${SOURCE}
       AND eim.entity_type = 'tag'
       AND eim.target_id = tt.tag_id
      WHERE tt.ticket_id = ${ticketId}
    `;
    const have = new Set(current.map((r) => r.tag_id));

    const toAdd = [...desired].filter((id) => !have.has(id));
    const toRemove = [...have].filter((id) => !desired.has(id));

    let added = 0;
    for (const tagId of toAdd) {
      const r = await tx`
        INSERT INTO ticket_tag (ticket_id, tag_id, workspace_id, added_at)
        VALUES (${ticketId}, ${tagId}, ${ctx.workspaceId}, now())
        ON CONFLICT (ticket_id, tag_id) DO NOTHING
      `;
      added += r.count;
    }
    let removed = 0;
    if (toRemove.length > 0) {
      const r = await tx`
        DELETE FROM ticket_tag
        WHERE ticket_id = ${ticketId}
          AND tag_id = ANY(${tx.array(toRemove)})
      `;
      removed = r.count;
    }

    if (added + removed > 0) {
      await tx`
        UPDATE ticket SET updated_at = GREATEST(updated_at, now())
        WHERE id = ${ticketId}
      `;
    }
    return { kind: 'applied', added, removed };
  });
}

export type MessageApplyResult =
  | { kind: 'applied'; ticketId: string; messageId: string; alreadyExists?: boolean }
  | { kind: 'lazy-expand-needed'; conversationId: string }
  | { kind: 'no-message-in-payload' };

/**
 * Apply a `conversation.message` webhook. The payload's `lastMessage` carries
 * the new message; we either insert it onto the existing imported ticket
 * (idempotent via message-EIM) or signal that the conversation needs to be
 * lazy-expanded.
 */
export async function applyConversationMessage(
  ctx: ApplyContext,
  conv: AtlasWebhookConversation,
): Promise<MessageApplyResult> {
  const sql = getClient() as Sql;
  const last = conv.lastMessage;
  if (!last) return { kind: 'no-message-in-payload' };

  // Quick EIM lookup outside any tx — if we miss, we want to skip the tx
  // entirely and signal lazy-expand.
  const lookup = await sql<{ target_id: string }[]>`
    SELECT target_id FROM migration_external_id_map
    WHERE workspace_id = ${ctx.workspaceId}
      AND source = ${SOURCE}
      AND entity_type = 'ticket'
      AND source_id = ${conv.id}
    LIMIT 1
  `;
  const ticketId = lookup[0]?.target_id ?? null;
  if (!ticketId) return { kind: 'lazy-expand-needed', conversationId: conv.id };

  // Map and upload attachments BEFORE the transaction so the tx stays short
  // and network errors don't roll back the message write. Failed uploads are
  // dropped silently — message still lands.
  const canonical = toCanonicalMessage(last as AtlasWebhookMessage);
  const attachmentMap = new Map<string, UploadedAttachment>();
  for (const ref of canonical.attachments) {
    const lookupKey = ref.handle ?? ref.url;
    try {
      const uploaded = await uploadAtlasAttachment({
        workspaceId: ctx.workspaceId,
        attachment: ref,
        ticketId,
      });
      if (uploaded) attachmentMap.set(lookupKey, uploaded);
    } catch {
      // intentionally swallow — same behavior as the backfill path
    }
  }

  // Reserve EIM BEFORE inserting the real row so concurrent lazy-expand +
  // backfill paths can't both insert duplicate `message` rows for the same
  // Atlas message id.
  return sql.begin(async (tx) => {
    const sourceId = String(last.id);
    const messageCandidate = randomUUID();
    const messageRes = await tx<{ target_id: string }[]>`
      INSERT INTO migration_external_id_map
        (workspace_id, source, entity_type, source_id, target_id, run_id)
      VALUES
        (${ctx.workspaceId}, ${SOURCE}, 'message', ${sourceId}, ${messageCandidate}, ${ctx.runId})
      ON CONFLICT (workspace_id, source, entity_type, source_id) DO NOTHING
      RETURNING target_id
    `;
    let messageId: string;
    if (messageRes[0]) {
      messageId = messageRes[0].target_id;
    } else {
      const existing = await tx<{ target_id: string }[]>`
        SELECT target_id FROM migration_external_id_map
        WHERE workspace_id = ${ctx.workspaceId}
          AND source = ${SOURCE}
          AND entity_type = 'message'
          AND source_id = ${sourceId}
        LIMIT 1
      `;
      return {
        kind: 'applied',
        ticketId,
        messageId: existing[0]?.target_id ?? messageCandidate,
        alreadyExists: true,
      };
    }

    const customerId = await resolveCustomerIdForTicket(tx, ticketId);
    const authorUserId =
      canonical.authorType === 'agent'
        ? await resolveAgentUserId(tx, ctx.workspaceId, canonical.authorEmail)
        : null;
    const authorCustomerId = canonical.authorType === 'customer' ? customerId : null;

    await tx`
      INSERT INTO message (
        id, workspace_id, ticket_id, author_type, author_user_id, author_customer_id,
        body_html, body_text, is_internal, created_at, updated_at
      ) VALUES (
        ${messageId}, ${ctx.workspaceId}, ${ticketId}, ${canonical.authorType},
        ${authorUserId}, ${authorCustomerId},
        ${canonical.bodyHtml}, ${canonical.bodyText}, ${canonical.isInternal},
        ${canonical.createdAt.toISOString()}, ${canonical.createdAt.toISOString()}
      )
    `;
    // Attachments: per-row EIM reservation (same atomicity story as the
    // message row above).
    for (const ref of canonical.attachments) {
      const lookupKey = ref.handle ?? ref.url;
      const uploaded = attachmentMap.get(lookupKey);
      if (!uploaded) continue;
      const attCandidate = randomUUID();
      const attRes = await tx<{ target_id: string }[]>`
        INSERT INTO migration_external_id_map
          (workspace_id, source, entity_type, source_id, target_id, run_id)
        VALUES
          (${ctx.workspaceId}, ${SOURCE}, 'attachment', ${uploaded.sourceId}, ${attCandidate}, ${ctx.runId})
        ON CONFLICT (workspace_id, source, entity_type, source_id) DO NOTHING
        RETURNING target_id
      `;
      if (!attRes[0]) continue; // winner already inserted this attachment
      const attId = attRes[0].target_id;
      await tx`
        INSERT INTO attachment (id, workspace_id, message_id, s3_key, filename, mime_type, size_bytes, created_at)
        VALUES (
          ${attId}, ${ctx.workspaceId}, ${messageId}, ${uploaded.s3Key},
          ${uploaded.filename}, ${uploaded.mimeType}, ${uploaded.sizeBytes},
          ${canonical.createdAt.toISOString()}
        )
      `;
    }
    await tx`
      INSERT INTO audit_event (
        id, workspace_id, ticket_id, customer_id, actor_id, actor_kind, kind, payload, created_at
      ) VALUES (
        ${randomUUID()}, ${ctx.workspaceId}, ${ticketId}, ${authorCustomerId}, ${authorUserId},
        'system-import', 'migration.webhook.message',
        ${JSON.stringify({ source: SOURCE, source_id: sourceId, atlas: canonical.metadata.atlas })}::jsonb,
        ${canonical.createdAt.toISOString()}
      )
    `;
    await tx`
      UPDATE ticket
      SET updated_at = GREATEST(updated_at, ${canonical.createdAt.toISOString()}::timestamptz)
      WHERE id = ${ticketId}
    `;

    // Best-effort: also apply the conversation header status/priority since
    // the payload carries the full ExternalConversation. Cheap UPDATEs with
    // GREATEST() guards already, so this stays idempotent across re-runs.
    const ticket = toCanonicalTicket(conv);
    await tx`
      UPDATE ticket
      SET status = ${ticket.status}, priority = ${ticket.priority},
          closed_at = CASE WHEN ${ticket.status} = 'closed'
                            THEN COALESCE(${ticket.closedAt ? ticket.closedAt.toISOString() : null}::timestamptz, closed_at, now())
                            ELSE NULL END,
          updated_at = GREATEST(updated_at, now())
      WHERE id = ${ticketId}
    `;

    return { kind: 'applied', ticketId, messageId };
  });
}

async function resolveAgentUserId(
  tx: TxSql,
  workspaceId: string,
  email: string | null,
): Promise<string | null> {
  if (!email) return null;
  const rows = await tx<{ id: string }[]>`
    SELECT u.id FROM "user" u
    JOIN "member" m ON m."userId" = u.id
    WHERE m."organizationId" = ${workspaceId}
      AND lower(u.email) = lower(${email})
    LIMIT 1
  `;
  return rows[0]?.id ?? null;
}
