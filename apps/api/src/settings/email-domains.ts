import { randomUUID } from 'node:crypto';
import { getClient } from '@salve/db';
import type { Context } from 'hono';
import type postgres from 'postgres';
import { z } from 'zod';
import { inngest } from '../inngest/client.js';
import { DOMAIN_EVENT } from '../inngest/events.js';
import { authOf } from '../middleware.js';
import { runServerMutation } from '../public-api/mutator-runner.js';

type Sql = postgres.Sql<Record<string, unknown>>;

const addDomainBody = z.object({
  domain: z
    .string()
    .min(3)
    .max(253)
    .regex(/^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/, 'invalid domain'),
  localPart: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-zA-Z0-9._%+-]+$/)
    .default('support'),
  fromName: z.string().min(1).max(120).optional(),
  signature: z.string().max(4000).optional(),
});

const addAddressBody = z.object({
  sendingDomainID: z.string().min(1).optional(),
  channelID: z.string().min(1).optional(),
  localPart: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-zA-Z0-9._%+-]+$/),
  label: z.string().max(120).optional(),
  canSend: z.boolean().default(true),
  canReceive: z.boolean().default(true),
  isDefault: z.boolean().default(false),
  signature: z.string().max(4000).optional(),
});

const routingRuleBody = z.object({
  emailAddressID: z.string().min(1),
  channelID: z.string().min(1).optional(),
  destinationAddress: z.string().email().optional(),
  senderPattern: z.string().max(500).optional(),
  subjectPattern: z.string().max(500).optional(),
  assignTeamID: z.string().max(120).optional(),
  assignAgentID: z.string().min(1).optional(),
  setPriority: z.enum(['low', 'normal', 'high', 'urgent']).default('normal'),
  priority: z.number().int().min(0).max(10_000).default(100),
  enabled: z.boolean().default(true),
});

export async function handleEmailDomainAdd(c: Context): Promise<Response> {
  const auth = authOf(c);
  if (!auth.workspaceID) return c.json({ error: 'no-workspace' }, 403);
  const workspaceID = auth.workspaceID;

  const json = await c.req.raw.json().catch(() => null);
  const parsed = addDomainBody.safeParse(json);
  if (!parsed.success) {
    return c.json({ error: 'invalid', details: parsed.error.flatten() }, 400);
  }

  const domain = parsed.data.domain.toLowerCase();
  const sendingDomainID = randomUUID();
  const channelID = randomUUID();

  try {
    await runServerMutation(
      'settings.email.domain.create',
      {
        id: sendingDomainID,
        channelID,
        domain,
        fromName: parsed.data.fromName,
        signature: parsed.data.signature,
        mailFromSubdomain: process.env.MAIL_FROM_SUBDOMAIN ?? 'mail',
        channelConfig: emailChannelConfig(sendingDomainID, workspaceID),
      },
      authDataFromContext(auth),
    );
  } catch (error) {
    const response = legacyMutationErrorResponse(c, error);
    if (response) return response;
    throw error;
  }

  return c.json(
    {
      id: sendingDomainID,
      channelID,
      domain,
      dkimTokens: [],
      mailFromDomain: `${process.env.MAIL_FROM_SUBDOMAIN ?? 'mail'}.${domain}`,
      status: 'pending',
      provisionStatus: 'pending',
    },
    201,
  );
}

export async function handleEmailAddressAdd(c: Context): Promise<Response> {
  const auth = authOf(c);
  if (!auth.workspaceID) return c.json({ error: 'no-workspace' }, 403);
  const workspaceID = auth.workspaceID;

  const json = await c.req.raw.json().catch(() => null);
  const parsed = addAddressBody.safeParse(json);
  if (!parsed.success) {
    return c.json({ error: 'invalid', details: parsed.error.flatten() }, 400);
  }

  const sendingDomainID = c.req.param('id') || parsed.data.sendingDomainID;
  if (!sendingDomainID) return c.json({ error: 'missing-id' }, 400);

  const sql = getClient();
  const domainRows = await sql<Array<{ id: string; domain: string }>>`
    SELECT id, domain
    FROM sending_domain
    WHERE id = ${sendingDomainID}
      AND workspace_id = ${auth.workspaceID}
    LIMIT 1
  `;
  const domain = domainRows[0];
  if (!domain) return c.json({ error: 'not-found' }, 404);

  let channelID =
    (await findDefaultEmailChannel(sql, auth.workspaceID, sendingDomainID)) ?? randomUUID();
  if (parsed.data.channelID) {
    const allowedChannelID = await findEmailChannel(sql, {
      workspaceID: auth.workspaceID,
      sendingDomainID,
      channelID: parsed.data.channelID,
    });
    if (!allowedChannelID) return c.json({ error: 'channel-not-found' }, 404);
    channelID = allowedChannelID;
  }
  const fullAddress = `${parsed.data.localPart.toLowerCase()}@${domain.domain}`;
  const id = randomUUID();

  try {
    await runServerMutation(
      'settings.email.address.create',
      {
        id,
        sendingDomainID,
        channelID,
        localPart: parsed.data.localPart,
        label: parsed.data.label,
        canSend: parsed.data.canSend,
        canReceive: parsed.data.canReceive,
        isDefault: parsed.data.isDefault,
        signature: parsed.data.signature,
        channelConfig: emailChannelConfig(sendingDomainID, workspaceID),
      },
      authDataFromContext(auth),
    );
  } catch (error) {
    const response = legacyMutationErrorResponse(c, error);
    if (response) return response;
    throw error;
  }

  return c.json({ id, channelID, sendingDomainID, fullAddress }, 201);
}

export async function handleEmailRoutingRuleUpsert(c: Context): Promise<Response> {
  const auth = authOf(c);
  if (!auth.workspaceID) return c.json({ error: 'no-workspace' }, 403);

  const json = await c.req.raw.json().catch(() => null);
  const parsed = routingRuleBody.safeParse(json);
  if (!parsed.success) {
    return c.json({ error: 'invalid', details: parsed.error.flatten() }, 400);
  }

  const sql = getClient();
  const addressRows = await sql<Array<{ id: string; channel_id: string; full_address: string }>>`
    SELECT id, channel_id, full_address
    FROM email_address
    WHERE id = ${parsed.data.emailAddressID}
      AND workspace_id = ${auth.workspaceID}
      AND can_receive = true
      AND deleted_at IS NULL
    LIMIT 1
  `;
  const address = addressRows[0];
  if (!address) return c.json({ error: 'address-not-found' }, 404);
  if (parsed.data.channelID && parsed.data.channelID !== address.channel_id) {
    return c.json({ error: 'channel-address-mismatch' }, 400);
  }
  if (
    parsed.data.destinationAddress &&
    parsed.data.destinationAddress.toLowerCase() !== address.full_address.toLowerCase()
  ) {
    return c.json({ error: 'destination-address-mismatch' }, 400);
  }

  if (parsed.data.assignAgentID) {
    const memberRows = await sql<Array<{ id: string }>>`
      SELECT id
      FROM member
      WHERE "organizationId" = ${auth.workspaceID}
        AND "userId" = ${parsed.data.assignAgentID}
      LIMIT 1
    `;
    if (!memberRows[0]) return c.json({ error: 'assign-agent-not-member' }, 400);
  }

  const requestedID = randomUUID();
  try {
    await runServerMutation(
      'settings.email.routingRule.upsert',
      {
        id: requestedID,
        emailAddressID: address.id,
        channelID: address.channel_id,
        destinationAddress: parsed.data.destinationAddress,
        senderPattern: parsed.data.senderPattern,
        subjectPattern: parsed.data.subjectPattern,
        assignTeamID: parsed.data.assignTeamID,
        assignAgentID: parsed.data.assignAgentID,
        setPriority: parsed.data.setPriority,
        priority: parsed.data.priority,
        enabled: parsed.data.enabled,
      },
      authDataFromContext(auth),
    );
  } catch (error) {
    const response = legacyMutationErrorResponse(c, error);
    if (response) return response;
    throw error;
  }

  const id =
    (await findRoutingRule(sql, {
      workspaceID: auth.workspaceID,
      channelID: address.channel_id,
      emailAddressID: address.id,
      senderPattern: parsed.data.senderPattern,
      subjectPattern: parsed.data.subjectPattern,
    })) ?? requestedID;

  return c.json(
    {
      id,
      emailAddressID: address.id,
      channelID: address.channel_id,
      setPriority: parsed.data.setPriority,
      assignTeamID: parsed.data.assignTeamID ?? null,
      assignAgentID: parsed.data.assignAgentID ?? null,
      enabled: parsed.data.enabled,
    },
    201,
  );
}

async function findDefaultEmailChannel(
  sql: Sql,
  workspaceID: string,
  sendingDomainID: string,
): Promise<string | null> {
  const rows = await sql<Array<{ id: string }>>`
    SELECT c.id
    FROM channel c
    JOIN email_channel ec ON ec.channel_id = c.id
    WHERE c.workspace_id = ${workspaceID}
      AND c.kind = 'email'
      AND ec.sending_domain_id = ${sendingDomainID}
      AND c.deleted_at IS NULL
    ORDER BY c.is_default DESC, c.created_at ASC
    LIMIT 1
  `;
  return rows[0]?.id ?? null;
}

async function findEmailChannel(
  sql: Sql,
  args: { workspaceID: string; sendingDomainID: string; channelID: string },
): Promise<string | null> {
  const rows = await sql<Array<{ id: string }>>`
    SELECT c.id
    FROM channel c
    JOIN email_channel ec ON ec.channel_id = c.id
    WHERE c.id = ${args.channelID}
      AND c.workspace_id = ${args.workspaceID}
      AND c.kind = 'email'
      AND ec.sending_domain_id = ${args.sendingDomainID}
      AND c.deleted_at IS NULL
    LIMIT 1
  `;
  return rows[0]?.id ?? null;
}

/**
 * Trigger an immediate verification check against the configured provider
 * (Mailgun's PUT /v4/domains/{name}/verify when MAILER_BACKEND=mailgun, or
 * SES GetEmailIdentity otherwise). Without this, the user has to wait for
 * the verify-domain cron to fire (every 30 min) before fresh DNS picks up.
 *
 * Idempotent: re-running while already verified is a no-op (the Inngest fn
 * just re-checks and writes the same status). Returns 202 with the dispatched
 * event id so the UI can poll dnsStatus afterwards.
 */
export async function handleEmailDomainVerify(c: Context): Promise<Response> {
  const auth = authOf(c);
  if (!auth.workspaceID) return c.json({ error: 'no-workspace' }, 403);
  const id = c.req.param('id');
  if (!id) return c.json({ error: 'missing-id' }, 400);

  // Confirm the domain belongs to this workspace before dispatching anything
  // — otherwise the endpoint becomes a cross-tenant probe surface.
  const rows = await getClient()<Array<{ id: string }>>`
    SELECT id
    FROM sending_domain
    WHERE id = ${id}
      AND workspace_id = ${auth.workspaceID}
    LIMIT 1
  `;
  if (rows.length === 0) return c.json({ error: 'not-found' }, 404);

  const eventID = `dom-verify-req-${id}-${Date.now()}`;
  await inngest.send({
    id: eventID,
    name: DOMAIN_EVENT.VERIFICATION_REQUESTED,
    data: { workspaceID: auth.workspaceID, sendingDomainID: id },
  });

  return c.json({ id, queued: true, eventID }, 202);
}

export async function handleEmailDomainVerifyDev(c: Context): Promise<Response> {
  // Dev-only override that flips dns_status='verified' without a real DNS
  // lookup. The UI also gates the button behind `import.meta.env.DEV`, but
  // the API must enforce this independently — a direct curl in production
  // would otherwise bypass actual verification. The real verification path
  // is the `verifyDomain` Inngest function, which performs DNS + SES lookups
  // and runs in all environments.
  if (process.env.NODE_ENV === 'production') {
    return c.json({ error: 'dev_endpoint_not_available_in_production' }, 403);
  }

  const auth = authOf(c);
  if (!auth.workspaceID) return c.json({ error: 'no-workspace' }, 403);
  const id = c.req.param('id');
  if (!id) return c.json({ error: 'missing-id' }, 400);

  const updated = await getClient()<Array<{ id: string }>>`
    UPDATE sending_domain
    SET dns_status = 'verified',
        dmarc_status = 'present',
        last_verified_at = now(),
        updated_at = now()
    WHERE id = ${id}
      AND workspace_id = ${auth.workspaceID}
    RETURNING id
  `;

  if (updated.length === 0) return c.json({ error: 'not-found' }, 404);
  return c.json({ id, status: 'verified' });
}

function emailChannelConfig(sendingDomainID: string, workspaceID: string): Record<string, string> {
  return {
    sendingDomainID,
    inboundForwardingAddress: inboundForwardingAddress(workspaceID),
    replyAddressPattern: `*@${process.env.REPLY_DOMAIN ?? 'reply.usesalve.com'}`,
  };
}

function inboundForwardingAddress(workspaceID: string): string {
  return `inbound+ws_${workspaceID}@${process.env.INBOUND_EMAIL_DOMAIN ?? 'in.usesalve.com'}`;
}

async function findRoutingRule(
  sql: Sql,
  args: {
    workspaceID: string;
    channelID: string;
    emailAddressID: string;
    senderPattern?: string;
    subjectPattern?: string;
  },
): Promise<string | null> {
  const rows = await sql<Array<{ id: string }>>`
    SELECT id
    FROM inbound_routing_rule
    WHERE workspace_id = ${args.workspaceID}
      AND channel_id = ${args.channelID}
      AND email_address_id = ${args.emailAddressID}
      AND sender_pattern IS NOT DISTINCT FROM ${args.senderPattern ?? null}
      AND subject_pattern IS NOT DISTINCT FROM ${args.subjectPattern ?? null}
    ORDER BY created_at ASC
    LIMIT 1
  `;
  return rows[0]?.id ?? null;
}

function authDataFromContext(auth: ReturnType<typeof authOf>) {
  return {
    sub: auth.userID,
    workspaceID: auth.workspaceID,
    role: auth.role,
    principalKind: auth.principalKind,
  };
}

function legacyMutationErrorResponse(c: Context, error: unknown): Response | null {
  if (typeof error !== 'object' || error === null) return null;
  const details = (error as { details?: { code?: string; id?: string } }).details;
  if (!details?.code) return null;
  if (details.code === 'INVALID_INPUT') {
    return c.json({ error: 'invalid', id: details.id }, 400);
  }
  if (details.code === 'NOT_FOUND' || details.code === 'CROSS_WORKSPACE') {
    return c.json({ error: 'not-found' }, 404);
  }
  if (details.code === 'NO_WORKSPACE' || details.code === 'NOT_AUTHORIZED') {
    return c.json({ error: 'forbidden' }, 403);
  }
  return null;
}
