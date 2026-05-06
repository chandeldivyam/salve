import { getClient } from '@salve/db';
import type postgres from 'postgres';
import type { z } from 'zod';
import { inngest } from '../client.js';
import { type EmailDriverContext, sendEmailMessage } from '../drivers/email.js';
import {
  DELIVERY_EVENT,
  type deliveryMessageFailedDataSchema,
  deliveryMessageRequestedDataSchema,
} from '../events.js';

type Sql = postgres.Sql<Record<string, unknown>>;

interface DeliveryContextRow {
  outbound_message_id: string;
  outbound_status: string;
  workspace_id: string;
  channel_id: string;
  channel_kind: string;
  channel_name: string | null;
  email_address_id: string | null;
  local_part: string | null;
  full_address: string | null;
  from_name: string | null;
  signature: string | null;
  sending_domain_id: string | null;
  sending_domain: string | null;
  mail_from_subdomain: string | null;
  dns_status: string | null;
  suspended_at: Date | null;
  ticket_id: string;
  short_id: number;
  title: string;
  message_id: string;
  message_deleted_at: Date | null;
  body_html: string;
  body_text: string;
  customer_id: string;
  customer_email: string;
  customer_name: string | null;
  customer_display_name: string | null;
  workspace_name: string;
  workspace_slug: string;
}

interface PriorRow {
  rfc_message_id: string | null;
}

type FailedData = z.infer<typeof deliveryMessageFailedDataSchema>;

export const deliverMessage = inngest.createFunction(
  {
    id: 'deliver-message',
    name: 'Deliver message',
    retries: 4,
    // Pre-launch: capped at 5 to match Inngest free plan. Bump back to
    // { workspaceID: 50, "ses": 200 } when we move to Pro (see plan §12).
    concurrency: [
      { scope: 'fn', key: 'event.data.workspaceID', limit: 5 },
      { scope: 'account', key: '"ses"', limit: 5 },
    ],
    triggers: [{ event: DELIVERY_EVENT.MESSAGE_REQUESTED }],
  },
  // biome-ignore lint/suspicious/noExplicitAny: Inngest 4 event typing is intentionally kept local; data is validated with Zod below.
  async ({ event, step, logger }: any) => {
    const data = deliveryMessageRequestedDataSchema.parse(event.data);

    const loaded = await step.run('load-context', async () =>
      loadDeliveryContext(getClient(), data),
    );
    if (!loaded) {
      await emitFailed(step, {
        workspaceID: data.workspaceID,
        channelID: data.channelID,
        messageID: data.messageID,
        outboundMessageID: data.outboundMessageID,
        error: 'outbound message context not found',
        errorCode: 'not_found',
      });
      return { ok: false, reason: 'not-found' as const };
    }

    if (loaded.outbound_status !== 'queued' && loaded.outbound_status !== 'sending') {
      logger.info('outbound message already handled; skipping', {
        outboundMessageID: loaded.outbound_message_id,
        status: loaded.outbound_status,
      });
      return { ok: true, skipped: 'already-handled' as const };
    }

    if (loaded.message_deleted_at) {
      await step.run('mark-deleted-before-delivery', async () =>
        updateOutboundStatus(getClient(), loaded.outbound_message_id, {
          status: 'suppressed',
          error: 'message was deleted before delivery',
        }),
      );
      return { ok: true, skipped: 'message-deleted' as const };
    }

    if (loaded.suspended_at) {
      return markFailedAndEmit(step, loaded, 'sending domain is suspended', 'domain_suspended');
    }

    const suppressed = await step.run('check-suppression', async () =>
      isSuppressed(getClient(), {
        workspaceID: loaded.workspace_id,
        channelID: loaded.channel_id,
        target: loaded.customer_email,
      }),
    );
    if (suppressed) {
      await step.run('mark-suppressed', async () =>
        updateOutboundStatus(getClient(), loaded.outbound_message_id, {
          status: 'suppressed',
          error: 'recipient is suppressed for this channel',
        }),
      );
      await emitFailed(step, {
        workspaceID: loaded.workspace_id,
        channelID: loaded.channel_id,
        messageID: loaded.message_id,
        outboundMessageID: loaded.outbound_message_id,
        error: 'recipient is suppressed for this channel',
        errorCode: 'suppressed',
      });
      return { ok: false, reason: 'suppressed' as const };
    }

    if (loaded.channel_kind !== 'email') {
      return markFailedAndEmit(
        step,
        loaded,
        `unsupported delivery channel kind: ${loaded.channel_kind}`,
        'unsupported_channel',
      );
    }

    if (
      !loaded.email_address_id ||
      !loaded.local_part ||
      !loaded.full_address ||
      !loaded.sending_domain_id ||
      !loaded.sending_domain
    ) {
      return markFailedAndEmit(
        step,
        loaded,
        'email channel is missing send configuration',
        'bad_config',
      );
    }

    const priorMessages = await step.run('load-prior-message-ids', async () =>
      loadPriorMessages(getClient(), loaded.ticket_id, loaded.channel_id, loaded.message_id),
    );

    await step.run('mark-sending', async () =>
      updateOutboundStatus(getClient(), loaded.outbound_message_id, { status: 'sending' }),
    );

    try {
      const result = await step.run('send-email', async () =>
        sendEmailMessage(toEmailDriverContext(loaded, priorMessages)),
      );

      await step.run('mark-sent', async () =>
        markOutboundSent(getClient(), loaded.outbound_message_id, result.providerMessageID, {
          ...result.providerMeta,
          channelKind: loaded.channel_kind,
        }),
      );

      await step.sendEvent('delivery-message-sent', {
        id: `msg-sent-${result.providerMessageID}`,
        name: DELIVERY_EVENT.MESSAGE_SENT,
        data: {
          workspaceID: loaded.workspace_id,
          channelID: loaded.channel_id,
          messageID: loaded.message_id,
          outboundMessageID: loaded.outbound_message_id,
          providerMessageID: result.providerMessageID,
        },
      });

      return { ok: true, providerMessageID: result.providerMessageID };
    } catch (err) {
      if (isProbablyRetriable(err)) throw err;
      const message = err instanceof Error ? err.message : String(err);
      return markFailedAndEmit(step, loaded, message, 'send_failed');
    }
  },
);

async function loadDeliveryContext(
  sql: Sql,
  data: {
    workspaceID: string;
    channelID: string;
    ticketID: string;
    messageID: string;
    outboundMessageID?: string;
  },
): Promise<DeliveryContextRow | null> {
  const rows = await sql<DeliveryContextRow[]>`
    SELECT
      om.id AS outbound_message_id,
      om.status AS outbound_status,
      om.workspace_id,
      om.channel_id,
      c.kind AS channel_kind,
      c.name AS channel_name,
      ea.id AS email_address_id,
      ea.local_part,
      ea.full_address,
      ec.from_name,
      COALESCE(NULLIF(to_jsonb(ea)->>'signature', ''), ec.signature) AS signature,
      sd.id AS sending_domain_id,
      sd.domain AS sending_domain,
      sd.mail_from_subdomain,
      sd.dns_status,
      sd.suspended_at,
      t.id AS ticket_id,
      t.short_id,
      t.title,
      m.id AS message_id,
      m.deleted_at AS message_deleted_at,
      m.body_html,
      m.body_text,
      cust.id AS customer_id,
      cust.email AS customer_email,
      cust.name AS customer_name,
      cust.display_name AS customer_display_name,
      org.name AS workspace_name,
      org.slug AS workspace_slug
    FROM outbound_message om
    JOIN channel c ON c.id = om.channel_id
    JOIN ticket t ON t.id = om.ticket_id
    JOIN message m ON m.id = om.message_id
    JOIN customer cust ON cust.id = t.customer_id
    JOIN organization org ON org.id = om.workspace_id
    LEFT JOIN LATERAL (
      SELECT ea.*
      FROM email_address ea
      WHERE ea.channel_id = om.channel_id
        AND ea.can_send = true
        AND ea.deleted_at IS NULL
        AND (om.email_address_id IS NULL OR ea.id = om.email_address_id)
      ORDER BY (ea.id = om.email_address_id) DESC, ea.is_default DESC, ea.created_at ASC
      LIMIT 1
    ) ea ON true
    LEFT JOIN email_channel ec ON ec.channel_id = om.channel_id
    LEFT JOIN sending_domain sd ON sd.id = COALESCE(ea.sending_domain_id, ec.sending_domain_id)
    WHERE om.workspace_id = ${data.workspaceID}
      AND om.channel_id = ${data.channelID}
      AND om.ticket_id = ${data.ticketID}
      AND om.message_id = ${data.messageID}
      ${data.outboundMessageID ? sql`AND om.id = ${data.outboundMessageID}` : sql``}
    LIMIT 1
  `;
  return rows[0] ?? null;
}

async function isSuppressed(
  sql: Sql,
  args: { workspaceID: string; channelID: string; target: string },
): Promise<boolean> {
  const rows = await sql<{ id: string }[]>`
    SELECT id
    FROM suppression
    WHERE workspace_id = ${args.workspaceID}
      AND (channel_id = ${args.channelID} OR channel_id IS NULL)
      AND lower(target) = lower(${args.target})
    LIMIT 1
  `;
  return rows.length > 0;
}

async function loadPriorMessages(
  sql: Sql,
  ticketID: string,
  channelID: string,
  messageID: string,
): Promise<Array<{ rfcMessageID: string }>> {
  const rows = await sql<PriorRow[]>`
    SELECT provider_meta->>'rfcMessageID' AS rfc_message_id
    FROM outbound_message
    WHERE ticket_id = ${ticketID}
      AND channel_id = ${channelID}
      AND message_id <> ${messageID}
      AND provider_meta ? 'rfcMessageID'
    ORDER BY created_at ASC
  `;
  return rows
    .map((row) => row.rfc_message_id)
    .filter((id): id is string => Boolean(id))
    .map((rfcMessageID) => ({ rfcMessageID }));
}

async function updateOutboundStatus(
  sql: Sql,
  outboundMessageID: string,
  args: { status: string; error?: string },
): Promise<void> {
  await sql`
    UPDATE outbound_message
    SET status = ${args.status},
        error = ${args.error ?? null},
        updated_at = now()
    WHERE id = ${outboundMessageID}
  `;
}

async function markOutboundSent(
  sql: Sql,
  outboundMessageID: string,
  providerMessageID: string,
  providerMeta: Record<string, unknown>,
): Promise<void> {
  await sql`
    UPDATE outbound_message
    SET status = 'sent',
        provider_message_id = ${providerMessageID},
        provider_meta = ${JSON.stringify(asJson(providerMeta))}::jsonb,
        error = NULL,
        sent_at = now(),
        updated_at = now()
    WHERE id = ${outboundMessageID}
  `;
}

function toEmailDriverContext(
  row: DeliveryContextRow,
  priorMessages: Array<{ rfcMessageID: string }>,
): EmailDriverContext {
  return {
    workspace: {
      id: row.workspace_id,
      name: row.workspace_name,
      slug: row.workspace_slug,
    },
    ticket: {
      id: row.ticket_id,
      shortID: row.short_id,
      title: row.title,
    },
    message: {
      id: row.message_id,
      bodyHtml: row.body_html,
      bodyText: row.body_text,
    },
    customer: {
      id: row.customer_id,
      email: row.customer_email,
      name: row.customer_name,
      displayName: row.customer_display_name,
    },
    emailAddress: {
      id: row.email_address_id ?? '',
      localPart: row.local_part ?? '',
      fullAddress: row.full_address ?? '',
    },
    emailChannel: {
      fromName: row.from_name,
      signature: row.signature,
    },
    sendingDomain: {
      id: row.sending_domain_id ?? '',
      domain: row.sending_domain ?? '',
      mailFromSubdomain: row.mail_from_subdomain,
    },
    priorMessages,
  };
}

async function markFailedAndEmit(
  step: {
    run: <T>(name: string, fn: () => Promise<T>) => Promise<T>;
    sendEvent: (name: string, event: unknown) => Promise<unknown>;
  },
  row: DeliveryContextRow,
  error: string,
  errorCode: string,
) {
  await step.run('mark-failed', async () =>
    updateOutboundStatus(getClient(), row.outbound_message_id, { status: 'failed', error }),
  );
  await emitFailed(step, {
    workspaceID: row.workspace_id,
    channelID: row.channel_id,
    messageID: row.message_id,
    outboundMessageID: row.outbound_message_id,
    error,
    errorCode,
  });
  return { ok: false, reason: errorCode };
}

async function emitFailed(
  step: { sendEvent: (name: string, event: unknown) => Promise<unknown> },
  data: FailedData,
): Promise<void> {
  await step.sendEvent('delivery-message-failed', {
    id: `msg-failed-${data.messageID}`,
    name: DELIVERY_EVENT.MESSAGE_FAILED,
    data,
  });
}

function isProbablyRetriable(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const code = (err as Error & { name?: string; $metadata?: { httpStatusCode?: number } }).name;
  const status = (err as Error & { $metadata?: { httpStatusCode?: number } }).$metadata
    ?.httpStatusCode;
  if (status && status >= 500) return true;
  return Boolean(code && /throttl|timeout|temporar|rate|serviceunavailable/i.test(code));
}

function asJson(value: unknown): postgres.JSONValue {
  return JSON.parse(JSON.stringify(value)) as postgres.JSONValue;
}
