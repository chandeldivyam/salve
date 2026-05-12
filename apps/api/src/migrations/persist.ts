// Direct-SQL persistence for the v0 Atlas migration.
//
// Why not go through @salve/mutators here?
//   - The importer must accept historical timestamps (createdAt, closedAt)
//     verbatim from Atlas; mutators stamp now().
//   - We must NEVER trigger outbound delivery on imported agent messages.
//     The mutator path enqueues outbound_message rows.
// A future refinement (RFC §2.3) is a `__import` mutator namespace; for v0
// we use direct SQL so the slice is small and observable.
//
// All inserts are idempotency-safe via `migration_external_id_map` (EIM).

import { createHash, randomUUID } from 'node:crypto';
import { getClient } from '@salve/db';
import {
  type CanonicalCustomer,
  type CanonicalCustomFieldDef,
  type CanonicalMessage,
  type CanonicalTag,
  type CanonicalTagGroup,
  type CanonicalTicket,
  coerceCustomFieldValue,
  type SalveCustomFieldType,
} from '@salve/migration-atlas';
import type postgres from 'postgres';
import type { UploadedAttachment } from './attachments.js';

type Sql = postgres.Sql<Record<string, unknown>>;
type TxSql = postgres.TransactionSql<Record<string, unknown>>;

export interface PersistContext {
  workspaceId: string;
  source: string; // 'atlas'
  runId: string;
}

export interface PersistResult {
  ticketId: string;
  customerId: string | null;
  messagesInserted: number;
  messagesSkipped: number;
  ticketFieldValues: number;
  customerFieldValues: number;
  ticketTagsApplied: number;
  attachmentsInserted: number;
  reused: boolean; // true if ticket existed already
}

export interface CustomFieldUpsertResult {
  created: number;
  updated: number;
  skipped: number; // skipReason set
}

export interface TagUpsertResult {
  created: number;
  reused: number; // matched by label or already mapped via EIM
}

/** Map an Atlas agent email → workspace user.id (text), or null. */
async function resolveAgentUserId(
  tx: TxSql,
  workspaceId: string,
  email: string | null,
): Promise<string | null> {
  if (!email) return null;
  const rows = await tx<{ id: string }[]>`
    SELECT u.id
    FROM "user" u
    JOIN "member" m ON m."userId" = u.id
    WHERE m."organizationId" = ${workspaceId}
      AND lower(u.email) = lower(${email})
    LIMIT 1
  `;
  return rows[0]?.id ?? null;
}

/**
 * Atlas signed-S3 attachment URLs can be 1KB+, which busts Postgres's btree
 * index size limit (2704 bytes for `migration_eim_pk`). Hash anything over
 * 256 chars to a stable short token. The `sha256:` prefix is reserved so we
 * never confuse a hashed source_id with a real Atlas id (UUID, integer, URL).
 */
function normalizeSourceId(raw: string): string {
  if (raw.length <= 256) return raw;
  return `sha256:${createHash('sha256').update(raw).digest('hex')}`;
}

/** Look up an existing EIM mapping. Returns target_id or null. */
async function eimLookup(
  tx: TxSql,
  ctx: PersistContext,
  entityType: string,
  sourceId: string,
): Promise<string | null> {
  const normalized = normalizeSourceId(sourceId);
  const rows = await tx<{ target_id: string }[]>`
    SELECT target_id FROM migration_external_id_map
    WHERE workspace_id = ${ctx.workspaceId}
      AND source = ${ctx.source}
      AND entity_type = ${entityType}
      AND source_id = ${normalized}
    LIMIT 1
  `;
  return rows[0]?.target_id ?? null;
}

async function eimInsert(
  tx: TxSql,
  ctx: PersistContext,
  entityType: string,
  sourceId: string,
  targetId: string,
): Promise<void> {
  const normalized = normalizeSourceId(sourceId);
  await tx`
    INSERT INTO migration_external_id_map
      (workspace_id, source, entity_type, source_id, target_id, run_id)
    VALUES
      (${ctx.workspaceId}, ${ctx.source}, ${entityType}, ${normalized}, ${targetId}, ${ctx.runId})
    ON CONFLICT (workspace_id, source, entity_type, source_id) DO NOTHING
  `;
}

/**
 * Reserve an EIM mapping atomically. Returns the target_id we won (newly
 * inserted) OR the winning concurrent inserter's target_id, and a `reserved`
 * flag indicating which.
 *
 * Pattern: INSERT ... ON CONFLICT DO NOTHING RETURNING target_id. Postgres
 * uses tuple locking on the unique index so a concurrent transaction's
 * pending INSERT blocks this call until that tx commits or rolls back,
 * meaning the conflict-branch re-lookup is guaranteed to see the winner.
 *
 * Callers MUST gate the real-row insert on `reserved === true` to avoid the
 * race the old `INSERT real-row → eimInsert ON CONFLICT DO NOTHING` pattern
 * suffered: when two txs raced, both real-row inserts succeeded but only one
 * was mapped, leaving an orphan ticket/message with no EIM row.
 */
async function eimReserveOrLookup(
  tx: TxSql,
  ctx: PersistContext,
  entityType: string,
  sourceId: string,
  candidateTargetId: string,
): Promise<{ targetId: string; reserved: boolean }> {
  const normalized = normalizeSourceId(sourceId);
  const rows = await tx<{ target_id: string }[]>`
    INSERT INTO migration_external_id_map
      (workspace_id, source, entity_type, source_id, target_id, run_id)
    VALUES
      (${ctx.workspaceId}, ${ctx.source}, ${entityType}, ${normalized}, ${candidateTargetId}, ${ctx.runId})
    ON CONFLICT (workspace_id, source, entity_type, source_id) DO NOTHING
    RETURNING target_id
  `;
  if (rows[0]) return { targetId: rows[0].target_id, reserved: true };
  // Lost the race; winner's mapping is now visible.
  const existing = await tx<{ target_id: string }[]>`
    SELECT target_id FROM migration_external_id_map
    WHERE workspace_id = ${ctx.workspaceId}
      AND source = ${ctx.source}
      AND entity_type = ${entityType}
      AND source_id = ${normalized}
    LIMIT 1
  `;
  if (!existing[0]) {
    throw new Error(
      `eimReserveOrLookup race lost but no winner row visible (${entityType}:${sourceId})`,
    );
  }
  return { targetId: existing[0].target_id, reserved: false };
}

/**
 * Upsert a customer. Strategy:
 *   1. EIM map row exists → return that target id.
 *   2. Adopt-by-email: existing (workspace_id, lower(email)) match → bind
 *      EIM to the existing customer.
 *   3. Reserve EIM with a candidate id, then INSERT customer with that same
 *      id. Concurrent inserts can't duplicate the customer row because EIM
 *      reservation serialises us.
 */
async function upsertCustomer(
  tx: TxSql,
  ctx: PersistContext,
  c: CanonicalCustomer,
): Promise<string> {
  const mapped = await eimLookup(tx, ctx, 'customer', c.sourceId);
  if (mapped) return mapped;

  const existing = await tx<{ id: string; metadata: Record<string, unknown> }[]>`
    SELECT id, metadata FROM customer
    WHERE workspace_id = ${ctx.workspaceId}
      AND lower(email) = lower(${c.email})
    LIMIT 1
  `;
  if (existing[0]) {
    const merged = { ...(existing[0].metadata ?? {}), ...c.metadata };
    await tx`
      UPDATE customer SET
        metadata = ${JSON.stringify(merged)}::jsonb,
        updated_at = now()
      WHERE id = ${existing[0].id}
    `;
    await eimInsert(tx, ctx, 'customer', c.sourceId, existing[0].id);
    return existing[0].id;
  }

  const candidateId = randomUUID();
  const { targetId, reserved } = await eimReserveOrLookup(
    tx,
    ctx,
    'customer',
    c.sourceId,
    candidateId,
  );
  if (!reserved) return targetId; // concurrent winner already inserted the customer
  await tx`
    INSERT INTO customer (
      id, workspace_id, email, name, display_name, phone,
      first_seen_at, metadata, created_at, updated_at
    ) VALUES (
      ${targetId}, ${ctx.workspaceId}, ${c.email}, ${c.name}, ${c.name}, ${c.phone},
      ${c.firstSeenAt ? c.firstSeenAt.toISOString() : null},
      ${JSON.stringify(c.metadata)}::jsonb,
      now(), now()
    )
  `;
  return targetId;
}

async function insertMessage(
  tx: TxSql,
  ctx: PersistContext,
  ticketId: string,
  m: CanonicalMessage,
  customerId: string | null,
  attachmentMap: Map<string, UploadedAttachment>,
): Promise<{ id: string; inserted: boolean; attachmentsInserted: number }> {
  const candidateId = randomUUID();
  const { targetId, reserved } = await eimReserveOrLookup(
    tx,
    ctx,
    'message',
    m.sourceId,
    candidateId,
  );
  if (!reserved) {
    // Concurrent winner already inserted the message + audit event. Skip both
    // — but still attempt attachments: idempotent via per-attachment EIM, so
    // a winner that uploaded message+0 attachments and a loser that uploaded
    // 2 attachments converges to 2 attachments total.
    const attachmentsInserted = await insertImportedAttachments(
      tx,
      ctx,
      targetId,
      m,
      attachmentMap,
    );
    return { id: targetId, inserted: false, attachmentsInserted };
  }

  const authorUserId =
    m.authorType === 'agent' ? await resolveAgentUserId(tx, ctx.workspaceId, m.authorEmail) : null;
  const authorCustomerId = m.authorType === 'customer' ? customerId : null;

  await tx`
    INSERT INTO message (
      id, workspace_id, ticket_id, author_type, author_user_id, author_customer_id,
      body_html, body_text, is_internal, created_at, updated_at
    ) VALUES (
      ${targetId}, ${ctx.workspaceId}, ${ticketId}, ${m.authorType}, ${authorUserId}, ${authorCustomerId},
      ${m.bodyHtml}, ${m.bodyText}, ${m.isInternal},
      ${m.createdAt.toISOString()}, ${m.createdAt.toISOString()}
    )
  `;
  await tx`
    INSERT INTO audit_event (id, workspace_id, ticket_id, customer_id, actor_id, actor_kind, kind, payload, created_at)
    VALUES (
      ${randomUUID()}, ${ctx.workspaceId}, ${ticketId}, ${authorCustomerId}, ${authorUserId},
      'system-import', 'migration.imported.message',
      ${JSON.stringify({ source: ctx.source, source_id: m.sourceId, atlas: m.metadata.atlas })}::jsonb,
      ${m.createdAt.toISOString()}
    )
  `;

  const attachmentsInserted = await insertImportedAttachments(tx, ctx, targetId, m, attachmentMap);

  return { id: targetId, inserted: true, attachmentsInserted };
}

/**
 * Per-message attachment loop. Each attachment is reserved in EIM before the
 * `attachment` insert so two concurrent runs/retries can't produce duplicate
 * `attachment` rows for the same Atlas-side handle/URL.
 */
async function insertImportedAttachments(
  tx: TxSql,
  ctx: PersistContext,
  messageId: string,
  m: CanonicalMessage,
  attachmentMap: Map<string, UploadedAttachment>,
): Promise<number> {
  let attachmentsInserted = 0;
  for (const ref of m.attachments) {
    const lookupKey = ref.handle ?? ref.url;
    const uploaded = attachmentMap.get(lookupKey);
    if (!uploaded) continue;
    const candidateAttId = randomUUID();
    const { targetId: attId, reserved } = await eimReserveOrLookup(
      tx,
      ctx,
      'attachment',
      uploaded.sourceId,
      candidateAttId,
    );
    if (!reserved) continue; // winner already inserted the attachment row
    await tx`
      INSERT INTO attachment (id, workspace_id, message_id, s3_key, filename, mime_type, size_bytes, created_at)
      VALUES (
        ${attId}, ${ctx.workspaceId}, ${messageId}, ${uploaded.s3Key},
        ${uploaded.filename}, ${uploaded.mimeType}, ${uploaded.sizeBytes},
        ${m.createdAt.toISOString()}
      )
    `;
    attachmentsInserted++;
  }
  return attachmentsInserted;
}

/**
 * Persist a single Atlas conversation as a Salve ticket. Idempotent: re-running
 * the same (workspace, source, source_id) reuses the mapped Salve ticket id and
 * appends only previously-unseen messages.
 */
export async function persistConversation(
  ctx: PersistContext,
  ticket: CanonicalTicket,
  messages: CanonicalMessage[],
  /** atlas-url-or-handle → uploaded S3 metadata. Pre-built upstream so the
   *  Postgres tx stays short. Defaults to empty (skips attachment writes). */
  attachmentMap: Map<string, UploadedAttachment> = new Map(),
): Promise<PersistResult> {
  const sql = getClient() as Sql;

  return sql.begin(async (tx) => {
    let customerId: string | null = null;
    if (ticket.customer) {
      customerId = await upsertCustomer(tx, ctx, ticket.customer);
    }

    // Atomic ticket reservation. The previous `eimLookup → maybe-insert →
    // eimInsert ON CONFLICT DO NOTHING` pattern allowed two concurrent runs
    // (e.g. backfill + webhook lazy-expand) to both insert a `ticket` row
    // for the same Atlas conversation, leaving the loser's row orphaned.
    const ticketCandidate = randomUUID();
    const reservation = await eimReserveOrLookup(
      tx,
      ctx,
      'ticket',
      ticket.sourceId,
      ticketCandidate,
    );
    const ticketId = reservation.targetId;
    const reused = !reservation.reserved;

    if (reservation.reserved) {
      const assigneeId = await resolveAgentUserId(tx, ctx.workspaceId, ticket.agentEmail);
      await tx`
        INSERT INTO ticket (
          id, workspace_id, title, status, priority, customer_id, assignee_id,
          created_at, updated_at, closed_at
        ) VALUES (
          ${ticketId}, ${ctx.workspaceId}, ${ticket.title},
          ${ticket.status}, ${ticket.priority},
          ${customerId}, ${assigneeId},
          ${ticket.createdAt.toISOString()}, ${ticket.createdAt.toISOString()},
          ${ticket.closedAt ? ticket.closedAt.toISOString() : null}
        )
      `;
      await tx`
        INSERT INTO audit_event (id, workspace_id, ticket_id, customer_id, actor_kind, kind, payload, created_at)
        VALUES (
          ${randomUUID()}, ${ctx.workspaceId}, ${ticketId}, ${customerId},
          'system-import', 'migration.imported.ticket',
          ${JSON.stringify({ source: ctx.source, source_id: ticket.sourceId, atlas: ticket.metadata.atlas })}::jsonb,
          ${ticket.createdAt.toISOString()}
        )
      `;
    }

    let inserted = 0;
    let skipped = 0;
    let attachmentsInserted = 0;
    // Sort messages chronologically so first_response_at lands correctly.
    const sorted = [...messages].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    let firstAgentAt: Date | null = null;
    for (const m of sorted) {
      const r = await insertMessage(tx, ctx, ticketId, m, customerId, attachmentMap);
      if (r.inserted) inserted++;
      else skipped++;
      attachmentsInserted += r.attachmentsInserted;
      if (m.authorType === 'agent' && !m.isInternal && !firstAgentAt) {
        firstAgentAt = m.createdAt;
      }
    }
    // Stamp ticket.updated_at to the latest imported activity (NOT now()),
    // so "last contact" in the UI shows the real Atlas timestamp and the
    // inbox sorts by genuine recency. GREATEST() guards against re-runs that
    // import older messages on a ticket whose updated_at already reflects
    // newer activity.
    const lastActivityAt: Date | null =
      sorted.length > 0 ? (sorted[sorted.length - 1] as CanonicalMessage).createdAt : null;
    if (firstAgentAt || lastActivityAt) {
      await tx`
        UPDATE ticket
        SET first_response_at = COALESCE(first_response_at, ${firstAgentAt?.toISOString() ?? null}),
            updated_at = GREATEST(updated_at, ${(lastActivityAt ?? ticket.createdAt).toISOString()}::timestamptz)
        WHERE id = ${ticketId}
      `;
    }

    // Project Atlas custom-field values onto the imported ticket + customer.
    // We do this regardless of `reused` so that re-running the migration after
    // a custom-field definition was added picks up values for already-imported
    // tickets — that is, custom-field state is reconciled, not append-only.
    const ticketFieldValues = await applyCustomFieldValues(
      tx,
      ctx,
      'ticket',
      ticketId,
      atlasObjectFor('ticket', ticket),
    );

    let customerFieldValues = 0;
    if (customerId && ticket.customer) {
      customerFieldValues = await applyCustomFieldValues(
        tx,
        ctx,
        'customer',
        customerId,
        atlasObjectFor('customer', ticket.customer),
      );
    }

    // Project Atlas conversation tags into Salve `ticket_tag` rows. The Atlas
    // tag IDs were already mapped to Salve tag IDs in the discovery step.
    const atlasMeta = (ticket.metadata as { atlas?: { tags?: unknown } } | undefined)?.atlas;
    const atlasTagIds: string[] = Array.isArray(atlasMeta?.tags)
      ? (atlasMeta.tags as unknown[]).filter((v): v is string => typeof v === 'string')
      : [];
    const ticketTagsApplied = await applyTicketTags(tx, ctx, ticketId, atlasTagIds);

    return {
      ticketId,
      customerId,
      messagesInserted: inserted,
      messagesSkipped: skipped,
      ticketFieldValues,
      customerFieldValues,
      ticketTagsApplied,
      attachmentsInserted,
      reused,
    };
  });
}

/** Pull the raw `customFields` map from a ticket/customer canonical DTO. */
function atlasObjectFor(
  category: 'ticket' | 'customer',
  src: CanonicalTicket | CanonicalCustomer,
): Record<string, unknown> {
  // Both DTOs stash the original Atlas custom_fields under metadata.atlas.
  const meta = (src as { metadata?: Record<string, unknown> }).metadata as
    | { atlas?: { custom_fields?: unknown; customFields?: unknown } }
    | undefined;
  const atlas = meta?.atlas;
  if (!atlas) return {};
  // Ticket DTO uses `custom_fields` (snake), customer DTO doesn't currently
  // surface them — but Atlas returns `customFields` on both. Read either.
  const raw =
    (atlas as { custom_fields?: unknown }).custom_fields ??
    (atlas as { customFields?: unknown }).customFields;
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return {};
  // Mark category to silence the unused-arg warning while keeping the API
  // future-proof for category-specific source paths.
  void category;
  return raw as Record<string, unknown>;
}

/**
 * Look up Salve `custom_field` rows for a category (ticket/customer) and
 * project a raw Atlas `customFields` map into `custom_field_value` rows.
 * Returns the count of values written (created or updated).
 *
 * Idempotency: ON CONFLICT (field_id, ticket_id|customer_id) DO UPDATE.
 * Type mismatches are silently skipped — they're rare but expected (e.g. an
 * Atlas free-text field migrated to a Salve number field on a later re-run).
 */
async function applyCustomFieldValues(
  tx: TxSql,
  ctx: PersistContext,
  category: 'ticket' | 'customer',
  targetId: string,
  rawValues: Record<string, unknown>,
): Promise<number> {
  if (Object.keys(rawValues).length === 0) return 0;

  // One query loads all relevant field rows; we filter to keys present in raw.
  const keys = Object.keys(rawValues);
  // sql.array(...) per AGENTS.md §postgres-js — raw `${jsArray}` does NOT
  // auto-serialise as a Postgres array literal and silently returns nothing.
  const rows = await tx<{ id: string; key: string; type: string }[]>`
    SELECT id, key, type FROM custom_field
    WHERE workspace_id = ${ctx.workspaceId}
      AND category = ${category}
      AND key = ANY(${tx.array(keys)})
  `;

  let written = 0;
  for (const row of rows) {
    const raw = rawValues[row.key];
    const coerced = coerceCustomFieldValue(row.type as SalveCustomFieldType, raw);
    if (coerced === undefined) continue;

    const valueJson = JSON.stringify(coerced);
    if (category === 'ticket') {
      await tx`
        INSERT INTO custom_field_value (id, field_id, workspace_id, ticket_id, value, created_at, updated_at)
        VALUES (${randomUUID()}, ${row.id}, ${ctx.workspaceId}, ${targetId}, ${valueJson}::jsonb, now(), now())
        ON CONFLICT (field_id, ticket_id) WHERE ticket_id IS NOT NULL DO UPDATE
          SET value = EXCLUDED.value, updated_at = now()
      `;
    } else {
      await tx`
        INSERT INTO custom_field_value (id, field_id, workspace_id, customer_id, value, created_at, updated_at)
        VALUES (${randomUUID()}, ${row.id}, ${ctx.workspaceId}, ${targetId}, ${valueJson}::jsonb, now(), now())
        ON CONFLICT (field_id, customer_id) WHERE customer_id IS NOT NULL DO UPDATE
          SET value = EXCLUDED.value, updated_at = now()
      `;
    }
    written++;
  }
  return written;
}

/**
 * Discovery-step counterpart: take a list of canonical custom-field
 * definitions and ensure a Salve `custom_field` row exists for each.
 * Idempotent — repeated calls update the existing row's display name /
 * options / required flag in place.
 */
export async function upsertCustomFieldDefinitions(
  ctx: PersistContext,
  defs: CanonicalCustomFieldDef[],
): Promise<CustomFieldUpsertResult> {
  const sql = getClient() as Sql;
  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const def of defs) {
    if (def.skipReason) {
      skipped++;
      continue;
    }
    await sql.begin(async (tx) => {
      const mapped = await eimLookup(tx, ctx, 'custom_field', def.sourceId);
      if (mapped) {
        await tx`
          UPDATE custom_field SET
            display_name = ${def.displayName},
            description = ${def.description},
            options = ${JSON.stringify(def.options)}::jsonb,
            required = ${def.required},
            active = ${def.active},
            updated_at = now()
          WHERE id = ${mapped}
        `;
        updated++;
        return;
      }

      // Look up an existing row by (workspace, category, key) — operators
      // who created a Salve field manually with the same key get the field
      // adopted into the EIM rather than a duplicate.
      const existing = await tx<{ id: string }[]>`
        SELECT id FROM custom_field
        WHERE workspace_id = ${ctx.workspaceId}
          AND category = ${def.category}
          AND key = ${def.key}
        LIMIT 1
      `;
      if (existing[0]) {
        await tx`
          UPDATE custom_field SET
            display_name = ${def.displayName},
            description = COALESCE(description, ${def.description}),
            options = ${JSON.stringify(def.options)}::jsonb,
            updated_at = now()
          WHERE id = ${existing[0].id}
        `;
        await eimInsert(tx, ctx, 'custom_field', def.sourceId, existing[0].id);
        updated++;
        return;
      }

      const id = randomUUID();
      await tx`
        INSERT INTO custom_field (
          id, workspace_id, key, display_name, description,
          category, type, required, active, options, created_at, updated_at
        ) VALUES (
          ${id}, ${ctx.workspaceId}, ${def.key}, ${def.displayName}, ${def.description},
          ${def.category}, ${def.type}, ${def.required}, ${def.active},
          ${JSON.stringify(def.options)}::jsonb, now(), now()
        )
      `;
      await eimInsert(tx, ctx, 'custom_field', def.sourceId, id);
      created++;
    });
  }

  return { created, updated, skipped };
}

/**
 * Discovery — upsert tag groups. Match strategy:
 *   1. EIM hit → reuse + update label/color.
 *   2. Else, exact label match (case-sensitive) on the same workspace → adopt.
 *   3. Else, INSERT new + write EIM.
 * Salve schema requires `color` NOT NULL, so canonical mapper falls back to
 * a neutral grey when Atlas omits it.
 */
export async function upsertTagGroups(
  ctx: PersistContext,
  groups: CanonicalTagGroup[],
): Promise<TagUpsertResult> {
  const sql = getClient() as Sql;
  let created = 0;
  let reused = 0;

  for (const g of groups) {
    await sql.begin(async (tx) => {
      const mapped = await eimLookup(tx, ctx, 'tag_group', g.sourceId);
      if (mapped) {
        await tx`
          UPDATE tag_group SET
            label = ${g.label},
            color = ${g.color},
            archived_at = ${g.archived ? new Date().toISOString() : null},
            updated_at = now()
          WHERE id = ${mapped}
        `;
        reused++;
        return;
      }

      const existing = await tx<{ id: string }[]>`
        SELECT id FROM tag_group
        WHERE workspace_id = ${ctx.workspaceId} AND label = ${g.label}
        LIMIT 1
      `;
      if (existing[0]) {
        await eimInsert(tx, ctx, 'tag_group', g.sourceId, existing[0].id);
        reused++;
        return;
      }

      const id = randomUUID();
      await tx`
        INSERT INTO tag_group (id, workspace_id, label, color, archived_at, created_at, updated_at)
        VALUES (
          ${id}, ${ctx.workspaceId}, ${g.label}, ${g.color},
          ${g.archived ? new Date().toISOString() : null},
          now(), now()
        )
      `;
      await eimInsert(tx, ctx, 'tag_group', g.sourceId, id);
      created++;
    });
  }

  return { created, reused };
}

/**
 * Discovery — upsert tags. Salve enforces `(workspace_id, lower(label))`
 * uniqueness, so when an Atlas import collides with a manually-created Salve
 * tag of the same label, we adopt it via the EIM. Atlas tags also have many
 * archived duplicates; later-imported duplicates are silently mapped to the
 * first.
 */
export async function upsertTags(
  ctx: PersistContext,
  tags: CanonicalTag[],
): Promise<TagUpsertResult> {
  const sql = getClient() as Sql;
  let created = 0;
  let reused = 0;

  for (const t of tags) {
    await sql.begin(async (tx) => {
      const mapped = await eimLookup(tx, ctx, 'tag', t.sourceId);
      if (mapped) {
        const groupId = t.groupSourceId
          ? await eimLookup(tx, ctx, 'tag_group', t.groupSourceId)
          : null;
        await tx`
          UPDATE tag SET
            group_id = ${groupId},
            archived_at = ${t.archived ? new Date().toISOString() : null},
            updated_at = now()
          WHERE id = ${mapped}
        `;
        reused++;
        return;
      }

      // Adopt by case-insensitive label match.
      const existing = await tx<{ id: string }[]>`
        SELECT id FROM tag
        WHERE workspace_id = ${ctx.workspaceId} AND lower(label) = lower(${t.label})
        LIMIT 1
      `;
      if (existing[0]) {
        await eimInsert(tx, ctx, 'tag', t.sourceId, existing[0].id);
        reused++;
        return;
      }

      const groupId = t.groupSourceId
        ? await eimLookup(tx, ctx, 'tag_group', t.groupSourceId)
        : null;
      const id = randomUUID();
      await tx`
        INSERT INTO tag (id, workspace_id, group_id, label, color, archived_at, created_at, updated_at)
        VALUES (
          ${id}, ${ctx.workspaceId}, ${groupId}, ${t.label}, ${t.color},
          ${t.archived ? new Date().toISOString() : null},
          now(), now()
        )
      `;
      await eimInsert(tx, ctx, 'tag', t.sourceId, id);
      created++;
    });
  }

  return { created, reused };
}

/**
 * Per-conversation — given a list of Atlas tag UUIDs from the conversation
 * payload, look up Salve tag IDs via the EIM and write `ticket_tag` rows.
 * Returns the count of rows materially inserted (already-existing rows are a
 * no-op via PK conflict).
 */
async function applyTicketTags(
  tx: TxSql,
  ctx: PersistContext,
  ticketId: string,
  atlasTagIds: string[],
): Promise<number> {
  if (atlasTagIds.length === 0) return 0;

  // Bulk EIM lookup — one query per conversation, regardless of tag count.
  const rows = await tx<{ source_id: string; target_id: string }[]>`
    SELECT source_id, target_id FROM migration_external_id_map
    WHERE workspace_id = ${ctx.workspaceId}
      AND source = ${ctx.source}
      AND entity_type = 'tag'
      AND source_id = ANY(${tx.array(atlasTagIds)})
  `;
  if (rows.length === 0) return 0;

  let written = 0;
  for (const r of rows) {
    const result = await tx`
      INSERT INTO ticket_tag (ticket_id, tag_id, workspace_id, added_at)
      VALUES (${ticketId}, ${r.target_id}, ${ctx.workspaceId}, now())
      ON CONFLICT (ticket_id, tag_id) DO NOTHING
    `;
    written += result.count;
  }
  return written;
}
