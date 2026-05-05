import { createHash, randomUUID } from 'node:crypto';
import { getClient } from '@salve/db';
import type { Context } from 'hono';
import { type AddressObject, simpleParser } from 'mailparser';
import type postgres from 'postgres';
import { z } from 'zod';
import { parseReplyAddress } from '../email/reply-token.js';
import { inngest } from '../inngest/client.js';
import { INBOUND_EVENT } from '../inngest/events.js';
import { processInboundMessage } from '../inngest/functions/route-inbound-message.js';

type Sql = postgres.Sql<Record<string, unknown>>;

const devInboundJsonSchema = z
  .object({
    raw: z.string().min(1).optional(),
    headers: z.record(z.string(), z.unknown()).optional(),
    body: z.string().optional(),
    bodyText: z.string().optional(),
    bodyHtml: z.string().optional(),
    from: z.string().optional(),
    to: z.union([z.string(), z.array(z.string())]).optional(),
    cc: z.union([z.string(), z.array(z.string())]).optional(),
    replyTo: z.string().optional(),
    subject: z.string().optional(),
    providerMessageID: z.string().optional(),
    channelID: z.string().optional(),
    emailAddressID: z.string().optional(),
    destinationAddress: z.string().optional(),
    envelopeTo: z.string().optional(),
    processNow: z.boolean().optional(),
  })
  .refine((v) => Boolean(v.raw || v.body || v.bodyText || v.bodyHtml), {
    message: 'raw or body/bodyText/bodyHtml is required',
  });

type DevInboundJson = z.infer<typeof devInboundJsonSchema>;

interface IntakeInput {
  raw: string;
  providerMessageID?: string;
  channelID?: string;
  emailAddressID?: string;
  destinationAddress?: string;
  envelopeTo?: string;
  processNow?: boolean;
}

interface ResolvedInboundChannel {
  workspaceID: string;
  channelID: string;
  emailAddressID: string | null;
  destinationAddress: string | null;
}

interface InsertInboundRawArgs {
  id: string;
  workspaceID: string;
  channelID: string;
  providerMessageID: string;
  rawBlobS3Key: string;
  rawSizeBytes: number;
  headers: Record<string, unknown>;
  envelopeTo?: string | null;
  destinationAddress?: string | null;
  senderAddress?: string | null;
  subject?: string | null;
  authenticationResults?: Record<string, unknown>;
  providerMeta?: Record<string, unknown>;
}

interface InsertInboundRawResult {
  rawID: string;
  duplicate: boolean;
  alreadyProcessed: boolean;
}

interface SesSnsBody {
  Type?: string;
  Message?: string;
  SubscribeURL?: string;
}

interface SesInboundNotification {
  mail?: {
    messageId?: string;
    headers?: Array<{ name?: string; value?: string }>;
    commonHeaders?: {
      from?: string[];
      to?: string[];
      cc?: string[];
      subject?: string;
      messageId?: string;
    };
  };
  receipt?: {
    recipients?: string[];
    action?: {
      type?: string;
      bucketName?: string;
      objectKey?: string;
    };
  };
  workspaceID?: string;
  channelID?: string;
}

export async function handleDevInboundEmail(c: Context): Promise<Response> {
  if (process.env.NODE_ENV === 'production' && process.env.ENABLE_DEV_INBOUND_EMAIL !== '1') {
    return c.json({ error: 'disabled' }, 404);
  }

  const workspaceID = devWorkspaceID(c);
  if (!workspaceID) return c.json({ error: 'no-workspace' }, 403);

  const parsedInput = await readDevInboundRequest(c);
  if (!parsedInput.ok) {
    return c.json({ error: 'invalid', details: parsedInput.error }, 400);
  }

  const sql = getClient();
  try {
    const queued = await queueInboundEmail(sql, {
      ...parsedInput.value,
      workspaceID,
      rawBlobS3Key: `dev://inbound/${randomUUID()}.eml`,
      devRawRFC822: parsedInput.value.raw,
    });
    const processed = parsedInput.value.processNow
      ? await processInboundMessage({
          rawID: queued.rawID,
          workspaceID,
          channelID: queued.channelID,
          providerMessageID: queued.providerMessageID,
        })
      : undefined;

    return c.json(
      {
        ok: true,
        endpoint: '/api/inbound/email/dev',
        event: INBOUND_EVENT.MESSAGE_RECEIVED,
        rawID: queued.rawID,
        channelID: queued.channelID,
        providerMessageID: queued.providerMessageID,
        duplicate: queued.duplicate,
        alreadyProcessed: queued.alreadyProcessed,
        processed,
      },
      queued.duplicate ? 200 : 202,
    );
  } catch (err) {
    if (isMissingInboundSchema(err)) {
      return c.json(
        {
          error: 'missing-inbound-schema',
          detail:
            'inbound_message_raw is not present yet; Worker 1 must add Phase 3b DB migrations.',
        },
        503,
      );
    }
    throw err;
  }
}

function devWorkspaceID(c: Context): string | null {
  const auth = c.get('auth');
  if (auth?.workspaceID) return auth.workspaceID;
  if (process.env.NODE_ENV === 'production') return null;
  return c.req.header('x-salve-dev-workspace-id')?.trim() || null;
}

export async function handleSesInboundEmail(c: Context): Promise<Response> {
  const secret = process.env.SES_INBOUND_WEBHOOK_SECRET ?? process.env.SES_WEBHOOK_SECRET;
  // The inbound webhook writes `inbound_message_raw` rows for any
  // workspace that owns the resolved channel; an unauthenticated POST is
  // a cross-tenant ingestion vector. Require the secret unconditionally.
  if (!secret) {
    return c.json({ error: 'webhook-secret-required' }, 500);
  }
  if (c.req.header('x-salve-webhook-secret') !== secret) {
    return c.json({ error: 'unauthorized' }, 401);
  }

  const raw = (await c.req.raw.json().catch(() => null)) as
    | SesSnsBody
    | SesInboundNotification
    | null;
  if (!raw) return c.json({ error: 'invalid-json' }, 400);

  if ('Type' in raw && raw.Type === 'SubscriptionConfirmation') {
    if (process.env.SES_SNS_AUTO_CONFIRM === '1' && raw.SubscribeURL) {
      try {
        await fetch(raw.SubscribeURL);
      } catch (error) {
        console.error('[ses-inbound] auto-confirm fetch failed', error);
        return c.json({ error: 'auto-confirm-failed' }, 502);
      }
    }
    return c.json({ ok: true, subscriptionConfirmation: true });
  }

  const notification = unwrapSesInbound(raw);
  if (!notification) return c.json({ error: 'invalid-ses-notification' }, 400);
  const providerMessageID =
    notification?.mail?.messageId ?? notification?.mail?.commonHeaders?.messageId;
  const s3Action = notification?.receipt?.action;
  const rawBlobS3Key =
    s3Action?.bucketName && s3Action.objectKey
      ? `s3://${s3Action.bucketName}/${s3Action.objectKey}`
      : null;
  if (!providerMessageID || !rawBlobS3Key) {
    return c.json({ error: 'missing-provider-message-id-or-s3-key' }, 400);
  }

  const recipientHints = [
    ...(notification.receipt?.recipients ?? []),
    ...(notification.mail?.commonHeaders?.to ?? []),
    ...(notification.mail?.commonHeaders?.cc ?? []),
  ];
  const headerMap = headersFromSesNotification(notification);
  const workspaceID = notification.workspaceID;

  const sql = getClient();
  try {
    const resolved = await resolveInboundChannel(sql, {
      workspaceID,
      channelID: notification.channelID,
      recipientHints,
    });
    if (!resolved) {
      return c.json({ ok: true, queued: false, ignored: 'unresolved-channel' }, 202);
    }

    const rawID = randomUUID();
    const inserted = await insertInboundRaw(sql, {
      id: rawID,
      workspaceID: resolved.workspaceID,
      channelID: resolved.channelID,
      providerMessageID,
      rawBlobS3Key,
      rawSizeBytes: 0,
      headers: {
        ...headerMap,
        salve: {
          source: 'ses',
          s3Key: rawBlobS3Key,
          notification,
        },
      },
      envelopeTo: notification.receipt?.recipients?.[0] ?? null,
      destinationAddress: resolved.destinationAddress,
      senderAddress: firstHeaderAddress(notification.mail?.commonHeaders?.from),
      subject: notification.mail?.commonHeaders?.subject ?? null,
      authenticationResults: authResultsFromHeaders(headerMap),
      providerMeta: { source: 'ses', notification },
    });

    await emitInboundReceived({
      rawID: inserted.rawID,
      workspaceID: resolved.workspaceID,
      channelID: resolved.channelID,
      providerMessageID,
    });

    return c.json(
      {
        ok: true,
        endpoint: '/api/inbound/email/ses',
        event: INBOUND_EVENT.MESSAGE_RECEIVED,
        rawID: inserted.rawID,
        channelID: resolved.channelID,
        providerMessageID,
        duplicate: inserted.duplicate,
      },
      202,
    );
  } catch (err) {
    if (isMissingInboundSchema(err)) {
      return c.json(
        {
          error: 'missing-inbound-schema',
          detail:
            'inbound_message_raw is not present yet; Worker 1 must add Phase 3b DB migrations.',
        },
        503,
      );
    }
    throw err;
  }
}

async function readDevInboundRequest(
  c: Context,
): Promise<{ ok: true; value: IntakeInput } | { ok: false; error: unknown }> {
  const contentType = c.req.header('content-type') ?? '';
  if (contentType.includes('application/json')) {
    const json = await c.req.raw.json().catch(() => null);
    const parsed = devInboundJsonSchema.safeParse(json);
    if (!parsed.success) return { ok: false, error: parsed.error.flatten() };
    const raw = parsed.data.raw ?? buildRawFromParts(parsed.data);
    return {
      ok: true,
      value: {
        raw,
        providerMessageID: parsed.data.providerMessageID,
        channelID: parsed.data.channelID,
        emailAddressID: parsed.data.emailAddressID,
        destinationAddress: parsed.data.destinationAddress,
        envelopeTo: parsed.data.envelopeTo,
        processNow: parsed.data.processNow,
      },
    };
  }

  const raw = await c.req.raw.text();
  if (!raw.trim()) return { ok: false, error: 'raw RFC822 body is required' };
  return { ok: true, value: { raw } };
}

function buildRawFromParts(input: DevInboundJson): string {
  const headers = new Headers();
  for (const [key, value] of Object.entries(input.headers ?? {})) {
    if (value !== undefined && value !== null) headers.set(key, String(value));
  }
  if (input.from) headers.set('From', input.from);
  if (input.to) headers.set('To', Array.isArray(input.to) ? input.to.join(', ') : input.to);
  if (input.cc) headers.set('Cc', Array.isArray(input.cc) ? input.cc.join(', ') : input.cc);
  if (input.replyTo) headers.set('Reply-To', input.replyTo);
  if (input.subject) headers.set('Subject', input.subject);
  if (!headers.has('Date')) headers.set('Date', new Date().toUTCString());
  if (!headers.has('Message-ID')) {
    headers.set('Message-ID', `<dev-${randomUUID()}@inbound.dev.usesalve.com>`);
  }

  const text = input.bodyText ?? input.body ?? '';
  if (!input.bodyHtml) {
    if (!headers.has('Content-Type')) headers.set('Content-Type', 'text/plain; charset=utf-8');
    return `${headersToRFC822(headers)}\r\n\r\n${text}`;
  }

  const boundary = `=_salve_inbound_${randomUUID().replace(/-/g, '')}`;
  headers.set('MIME-Version', '1.0');
  headers.set('Content-Type', `multipart/alternative; boundary="${boundary}"`);
  const body = [
    `--${boundary}`,
    'Content-Type: text/plain; charset=utf-8',
    '',
    text,
    `--${boundary}`,
    'Content-Type: text/html; charset=utf-8',
    '',
    input.bodyHtml,
    `--${boundary}--`,
    '',
  ].join('\r\n');
  return `${headersToRFC822(headers)}\r\n\r\n${body}`;
}

function headersToRFC822(headers: Headers): string {
  const lines: string[] = [];
  headers.forEach((value, key) => {
    lines.push(`${headerCase(key)}: ${value}`);
  });
  return lines.join('\r\n');
}

function headerCase(input: string): string {
  return input
    .split('-')
    .map((part) => (part ? `${part[0]?.toUpperCase()}${part.slice(1).toLowerCase()}` : part))
    .join('-');
}

async function queueInboundEmail(
  sql: Sql,
  args: IntakeInput & { workspaceID: string; rawBlobS3Key: string; devRawRFC822?: string },
): Promise<
  InsertInboundRawResult & {
    channelID: string;
    providerMessageID: string;
    destinationAddress: string | null;
  }
> {
  const parsed = await simpleParser(args.raw, { keepCidLinks: true });
  const headerMap = headerMapFromParsed(parsed);
  const recipientHints = [
    ...addressesFromObject(parsed.to),
    ...addressesFromObject(parsed.cc),
    args.destinationAddress,
    args.envelopeTo,
  ].filter((v): v is string => Boolean(v));
  const resolved = await resolveInboundChannel(sql, {
    workspaceID: args.workspaceID,
    channelID: args.channelID,
    emailAddressID: args.emailAddressID,
    destinationAddress: args.destinationAddress ?? args.envelopeTo,
    recipientHints,
  });
  if (!resolved) {
    throw new Error('no receiving email channel found for this workspace');
  }

  const providerMessageID =
    args.providerMessageID ??
    parsed.messageId ??
    `sha256:${createHash('sha256').update(args.raw).digest('hex')}`;

  const rawID = randomUUID();
  const inserted = await insertInboundRaw(sql, {
    id: rawID,
    workspaceID: args.workspaceID,
    channelID: resolved.channelID,
    providerMessageID,
    rawBlobS3Key: args.rawBlobS3Key,
    rawSizeBytes: Buffer.byteLength(args.raw),
    headers: {
      ...headerMap,
      salve: {
        source: 'dev',
        emailAddressID: resolved.emailAddressID,
        devRawRFC822: args.devRawRFC822,
      },
    },
    envelopeTo: args.envelopeTo ?? null,
    destinationAddress: resolved.destinationAddress,
    senderAddress: parsed.from?.value[0]?.address?.toLowerCase() ?? null,
    subject: parsed.subject ?? null,
    authenticationResults: authResultsFromHeaders(headerMap),
    providerMeta: { source: 'dev' },
  });

  await emitInboundReceived({
    rawID: inserted.rawID,
    workspaceID: args.workspaceID,
    channelID: resolved.channelID,
    providerMessageID,
  });

  return {
    ...inserted,
    channelID: resolved.channelID,
    providerMessageID,
    destinationAddress: resolved.destinationAddress,
  };
}

async function resolveInboundChannel(
  sql: Sql,
  args: {
    workspaceID?: string;
    channelID?: string;
    emailAddressID?: string;
    destinationAddress?: string;
    recipientHints?: string[];
  },
): Promise<ResolvedInboundChannel | null> {
  const rawAddressCandidates = [args.destinationAddress, ...(args.recipientHints ?? [])]
    .map((addr) => extractAddressPreservingLocalpart(addr))
    .filter((addr): addr is string => Boolean(addr));

  if (args.channelID) {
    const rows = await sql<Array<{ workspace_id: string; channel_id: string }>>`
      SELECT workspace_id, id AS channel_id
      FROM channel
      WHERE id = ${args.channelID}
        ${args.workspaceID ? sql`AND workspace_id = ${args.workspaceID}` : sql``}
        AND kind = 'email'
        AND deleted_at IS NULL
      LIMIT 1
    `;
    const row = rows[0];
    if (row) {
      return {
        workspaceID: row.workspace_id,
        channelID: row.channel_id,
        emailAddressID: null,
        destinationAddress: normalizeAddress(args.destinationAddress),
      };
    }
  }

  if (args.emailAddressID) {
    const rows = await sql<
      Array<{ workspace_id: string; channel_id: string; id: string; full_address: string }>
    >`
      SELECT workspace_id, channel_id, id, full_address
      FROM email_address
      WHERE id = ${args.emailAddressID}
        ${args.workspaceID ? sql`AND workspace_id = ${args.workspaceID}` : sql``}
        AND can_receive = true
        AND deleted_at IS NULL
      LIMIT 1
    `;
    const row = rows[0];
    if (row) {
      return {
        workspaceID: row.workspace_id,
        channelID: row.channel_id,
        emailAddressID: row.id,
        destinationAddress: row.full_address.toLowerCase(),
      };
    }
  }

  const addressCandidates = rawAddressCandidates
    .map((addr) => normalizeAddress(addr))
    .filter((addr): addr is string => Boolean(addr));
  for (const address of addressCandidates) {
    const rows = await sql<
      Array<{ workspace_id: string; channel_id: string; id: string; full_address: string }>
    >`
      SELECT workspace_id, channel_id, id, full_address
      FROM email_address
      WHERE lower(full_address) = ${address}
        ${args.workspaceID ? sql`AND workspace_id = ${args.workspaceID}` : sql``}
        AND can_receive = true
        AND deleted_at IS NULL
      LIMIT 1
    `;
    const row = rows[0];
    if (row) {
      return {
        workspaceID: row.workspace_id,
        channelID: row.channel_id,
        emailAddressID: row.id,
        destinationAddress: row.full_address.toLowerCase(),
      };
    }
  }

  for (const address of rawAddressCandidates) {
    const reply = parseReplyAddress(address);
    if (reply && (!args.workspaceID || reply.workspaceID === args.workspaceID)) {
      const channel = await findDefaultEmailChannel(sql, reply.workspaceID);
      if (channel) return channel;
    }
    const wsFromForwarding = workspaceIDFromForwardingAddress(address);
    if (wsFromForwarding && (!args.workspaceID || wsFromForwarding === args.workspaceID)) {
      const channel = await findDefaultEmailChannel(sql, wsFromForwarding);
      if (channel) return channel;
    }
  }

  if (args.workspaceID) return findDefaultEmailChannel(sql, args.workspaceID);
  return null;
}

async function findDefaultEmailChannel(
  sql: Sql,
  workspaceID: string,
): Promise<ResolvedInboundChannel | null> {
  const rows = await sql<Array<{ workspace_id: string; channel_id: string }>>`
    SELECT c.workspace_id, c.id AS channel_id
    FROM channel c
    JOIN email_channel ec ON ec.channel_id = c.id
    WHERE c.workspace_id = ${workspaceID}
      AND c.kind = 'email'
      AND c.deleted_at IS NULL
    ORDER BY c.is_default DESC, c.created_at ASC
    LIMIT 1
  `;
  const row = rows[0];
  return row
    ? {
        workspaceID: row.workspace_id,
        channelID: row.channel_id,
        emailAddressID: null,
        destinationAddress: null,
      }
    : null;
}

async function insertInboundRaw(
  sql: Sql,
  args: InsertInboundRawArgs,
): Promise<InsertInboundRawResult> {
  try {
    const rows = await sql<Array<{ id: string; duplicate: boolean; already_processed: boolean }>>`
      INSERT INTO inbound_message_raw (
        id,
        workspace_id,
        channel_id,
        provider_message_id,
        raw_blob_s3_key,
        raw_blob_size_bytes,
        headers,
        envelope_to,
        destination_address,
        sender_address,
        subject,
        authentication_results,
        provider_meta,
        received_at
      )
      VALUES (
        ${args.id},
        ${args.workspaceID},
        ${args.channelID},
        ${args.providerMessageID},
        ${args.rawBlobS3Key},
        ${args.rawSizeBytes},
        ${JSON.stringify(args.headers)}::jsonb,
        ${args.envelopeTo ?? null},
        ${args.destinationAddress ?? null},
        ${args.senderAddress ?? null},
        ${args.subject ?? null},
        ${JSON.stringify(args.authenticationResults ?? {})}::jsonb,
        ${JSON.stringify(args.providerMeta ?? {})}::jsonb,
        now()
      )
      ON CONFLICT (workspace_id, provider_message_id) DO UPDATE
      SET headers = COALESCE(inbound_message_raw.headers, '{}'::jsonb) || EXCLUDED.headers
      RETURNING
        id,
        (id <> ${args.id}) AS duplicate,
        (processed_at IS NOT NULL) AS already_processed
    `;
    const row = rows[0];
    if (!row) throw new Error('failed to insert inbound_message_raw');
    return { rawID: row.id, duplicate: row.duplicate, alreadyProcessed: row.already_processed };
  } catch (err) {
    if (isNoMatchingConflictTarget(err)) {
      return insertInboundRawWithoutConflictTarget(sql, args);
    }
    throw err;
  }
}

async function insertInboundRawWithoutConflictTarget(
  sql: Sql,
  args: InsertInboundRawArgs,
): Promise<InsertInboundRawResult> {
  const existing = await sql<Array<{ id: string; processed_at: Date | null }>>`
    SELECT id, processed_at
    FROM inbound_message_raw
    WHERE workspace_id = ${args.workspaceID}
      AND provider_message_id = ${args.providerMessageID}
    LIMIT 1
  `;
  const duplicate = existing[0];
  if (duplicate) {
    return {
      rawID: duplicate.id,
      duplicate: true,
      alreadyProcessed: Boolean(duplicate.processed_at),
    };
  }

  const rows = await sql<Array<{ id: string }>>`
    INSERT INTO inbound_message_raw (
      id,
      workspace_id,
      channel_id,
      provider_message_id,
      raw_blob_s3_key,
      raw_blob_size_bytes,
      headers,
      envelope_to,
      destination_address,
      sender_address,
      subject,
      authentication_results,
      provider_meta,
      received_at
    )
    VALUES (
      ${args.id},
      ${args.workspaceID},
      ${args.channelID},
      ${args.providerMessageID},
      ${args.rawBlobS3Key},
      ${args.rawSizeBytes},
      ${JSON.stringify(args.headers)}::jsonb,
      ${args.envelopeTo ?? null},
      ${args.destinationAddress ?? null},
      ${args.senderAddress ?? null},
      ${args.subject ?? null},
      ${JSON.stringify(args.authenticationResults ?? {})}::jsonb,
      ${JSON.stringify(args.providerMeta ?? {})}::jsonb,
      now()
    )
    RETURNING id
  `;
  return { rawID: rows[0]?.id ?? args.id, duplicate: false, alreadyProcessed: false };
}

async function emitInboundReceived(args: {
  rawID: string;
  workspaceID: string;
  channelID: string;
  providerMessageID: string;
}): Promise<void> {
  await inngest.send({
    id: `inbound-${args.channelID}-${args.providerMessageID}`,
    name: INBOUND_EVENT.MESSAGE_RECEIVED,
    data: args,
  });
}

function unwrapSesInbound(raw: SesSnsBody | SesInboundNotification): SesInboundNotification | null {
  if ('Message' in raw && raw.Message) {
    try {
      return JSON.parse(raw.Message) as SesInboundNotification;
    } catch {
      return null;
    }
  }
  return raw as SesInboundNotification;
}

function headersFromSesNotification(notification: SesInboundNotification): Record<string, unknown> {
  const headers: Record<string, unknown> = {};
  for (const header of notification.mail?.headers ?? []) {
    if (!header.name) continue;
    headers[header.name.toLowerCase()] = header.value ?? '';
  }
  const common = notification.mail?.commonHeaders;
  if (common?.subject) headers.subject = common.subject;
  if (common?.from) headers.from = common.from;
  if (common?.to) headers.to = common.to;
  if (common?.cc) headers.cc = common.cc;
  return headers;
}

function headerMapFromParsed(
  parsed: Awaited<ReturnType<typeof simpleParser>>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of parsed.headers.entries()) {
    out[key] = headerValueToJSON(value);
  }
  return out;
}

function authResultsFromHeaders(headers: Record<string, unknown>): Record<string, unknown> {
  const rawValue = headers['authentication-results'];
  const raw = Array.isArray(rawValue)
    ? rawValue.map((value) => String(value))
    : rawValue
      ? [String(rawValue)]
      : [];
  const joined = raw.join('\n');
  return {
    spf: joined.match(/\bspf=(pass|fail|softfail|neutral|none|temperror|permerror)\b/i)?.[1],
    dkim: joined.match(/\bdkim=(pass|fail|neutral|none|temperror|permerror)\b/i)?.[1],
    dmarc: joined.match(/\bdmarc=(pass|fail|bestguesspass|none|temperror|permerror)\b/i)?.[1],
    raw,
  };
}

function headerValueToJSON(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(headerValueToJSON);
  if (value instanceof Map) return Object.fromEntries(value.entries());
  if (typeof value === 'object' && value !== null) return JSON.parse(JSON.stringify(value));
  return value;
}

function addressesFromObject(input: AddressObject | AddressObject[] | undefined): string[] {
  const objects = Array.isArray(input) ? input : input ? [input] : [];
  return objects.flatMap((obj) =>
    obj.value
      .flatMap((addr) => [addr.address, ...(addr.group ?? []).map((grouped) => grouped.address)])
      .filter((addr): addr is string => Boolean(addr))
      .map((addr) => addr.toLowerCase()),
  );
}

function firstHeaderAddress(values: string[] | undefined): string | null {
  return values?.[0] ? normalizeAddress(values[0]) : null;
}

function normalizeAddress(address: string | undefined | null): string | null {
  const raw = extractAddressPreservingLocalpart(address);
  if (!raw) return null;
  const value = raw.toLowerCase();
  return /^[^@\s]+@[^@\s]+$/.test(value) ? value : null;
}

function workspaceIDFromForwardingAddress(address: string): string | null {
  const raw = extractAddressPreservingLocalpart(address);
  if (!raw) return null;
  const atIdx = raw.lastIndexOf('@');
  if (atIdx <= 0) return null;
  const localpart = raw.slice(0, atIdx);
  const domain = raw.slice(atIdx + 1).toLowerCase();
  const inboundDomain = (process.env.INBOUND_EMAIL_DOMAIN ?? 'in.usesalve.com').toLowerCase();
  if (domain !== inboundDomain || !localpart?.startsWith('inbound+ws_')) return null;
  return localpart.slice('inbound+ws_'.length);
}

function extractAddressPreservingLocalpart(address: string | undefined | null): string | null {
  if (!address) return null;
  const match = address.match(/<([^<>@\s]+@[^<>\s]+)>/);
  const value = (match?.[1] ?? address).trim();
  return /^[^@\s]+@[^@\s]+$/.test(value) ? value : null;
}

function isMissingInboundSchema(err: unknown): boolean {
  return errorCode(err) === '42P01';
}

function isNoMatchingConflictTarget(err: unknown): boolean {
  return errorCode(err) === '42P10';
}

function errorCode(err: unknown): string | undefined {
  return (err as { code?: string } | undefined)?.code;
}
