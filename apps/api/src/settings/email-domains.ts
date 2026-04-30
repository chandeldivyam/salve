import { randomUUID } from 'node:crypto';
import {
  CreateEmailIdentityCommand,
  PutEmailIdentityMailFromAttributesCommand,
  SESv2Client,
} from '@aws-sdk/client-sesv2';
import { getClient } from '@opendesk/db';
import type { Context } from 'hono';
import type postgres from 'postgres';
import { z } from 'zod';
import { inngest } from '../inngest/client.js';
import { DOMAIN_EVENT } from '../inngest/events.js';
import { authOf } from '../middleware.js';

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
});

let ses: SESv2Client | undefined;
function getSes(): SESv2Client {
  ses ??= new SESv2Client({
    region: process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? 'us-east-1',
  });
  return ses;
}

function mailerBackend(): 'mailpit' | 'ses' {
  const explicit = process.env.MAILER_BACKEND;
  if (explicit === 'ses') return 'ses';
  if (explicit === 'mailpit') return 'mailpit';
  return process.env.NODE_ENV === 'production' ? 'ses' : 'mailpit';
}

function stubDkimTokens(domain: string): Array<{ name: string; value: string }> {
  return [
    { name: `s1._domainkey.${domain}`, value: 'dev-cname-1.dkim.amazonses.com' },
    { name: `s2._domainkey.${domain}`, value: 'dev-cname-2.dkim.amazonses.com' },
    { name: `s3._domainkey.${domain}`, value: 'dev-cname-3.dkim.amazonses.com' },
  ];
}

async function provisionSesDomain(domain: string): Promise<Array<{ name: string; value: string }>> {
  if (mailerBackend() !== 'ses') return stubDkimTokens(domain);

  const created = await getSes().send(
    new CreateEmailIdentityCommand({
      EmailIdentity: domain,
      DkimSigningAttributes: { NextSigningKeyLength: 'RSA_2048_BIT' },
    }),
  );

  await getSes().send(
    new PutEmailIdentityMailFromAttributesCommand({
      EmailIdentity: domain,
      MailFromDomain: `${process.env.MAIL_FROM_SUBDOMAIN ?? 'mail'}.${domain}`,
      BehaviorOnMxFailure: 'USE_DEFAULT_VALUE',
    }),
  );

  const tokens = created.DkimAttributes?.Tokens ?? [];
  return tokens.map((token) => ({
    name: `${token}._domainkey.${domain}`,
    value: `${token}.dkim.amazonses.com`,
  }));
}

export async function handleEmailDomainAdd(c: Context): Promise<Response> {
  const auth = authOf(c);
  if (!auth.workspaceID) return c.json({ error: 'no-workspace' }, 403);

  const json = await c.req.raw.json().catch(() => null);
  const parsed = addDomainBody.safeParse(json);
  if (!parsed.success) {
    return c.json({ error: 'invalid', details: parsed.error.flatten() }, 400);
  }

  const domain = parsed.data.domain.toLowerCase();
  const localPart = parsed.data.localPart.toLowerCase();
  const fullAddress = `${localPart}@${domain}`;
  const sql = getClient();

  const duplicate = await sql<Array<{ id: string }>>`
    SELECT id
    FROM sending_domain
    WHERE workspace_id = ${auth.workspaceID}
      AND domain = ${domain}
    LIMIT 1
  `;
  if (duplicate[0]) {
    return c.json({ error: 'already-added', id: duplicate[0].id }, 409);
  }

  const dkimTokens = await provisionSesDomain(domain);
  const sendingDomainID = randomUUID();
  const channelID = randomUUID();
  const emailAddressID = randomUUID();

  await sql.begin(async (tx) => {
    await tx`
      INSERT INTO sending_domain (
        id,
        workspace_id,
        domain,
        dkim_tokens,
        mail_from_subdomain,
        dns_status,
        dmarc_status,
        created_at,
        updated_at
      )
      VALUES (
        ${sendingDomainID},
        ${auth.workspaceID},
        ${domain},
        ${JSON.stringify(dkimTokens)}::jsonb,
        ${process.env.MAIL_FROM_SUBDOMAIN ?? 'mail'},
        'pending',
        'pending',
        now(),
        now()
      )
    `;

    await tx`
      INSERT INTO channel (id, workspace_id, kind, name, is_default, config, created_at, updated_at)
      VALUES (
        ${channelID},
        ${auth.workspaceID},
        'email',
        ${`${domain} email`},
        true,
        ${JSON.stringify({ sendingDomainID })}::jsonb,
        now(),
        now()
      )
    `;

    await tx`
      INSERT INTO email_channel (
        channel_id,
        sending_domain_id,
        from_name,
        signature,
        created_at,
        updated_at
      )
      VALUES (
        ${channelID},
        ${sendingDomainID},
        ${parsed.data.fromName ?? null},
        ${parsed.data.signature ?? null},
        now(),
        now()
      )
    `;

    await tx`
      INSERT INTO email_address (
        id,
        workspace_id,
        channel_id,
        sending_domain_id,
        local_part,
        full_address,
        can_send,
        can_receive,
        is_default,
        label,
        created_at,
        updated_at
      )
      VALUES (
        ${emailAddressID},
        ${auth.workspaceID},
        ${channelID},
        ${sendingDomainID},
        ${localPart},
        ${fullAddress},
        true,
        true,
        true,
        'Support',
        now(),
        now()
      )
    `;
  });

  await inngest.send({
    id: `dom-verify-req-${sendingDomainID}-${Date.now()}`,
    name: DOMAIN_EVENT.VERIFICATION_REQUESTED,
    data: {
      workspaceID: auth.workspaceID,
      sendingDomainID,
    },
  });

  return c.json(
    {
      id: sendingDomainID,
      channelID,
      emailAddressID,
      domain,
      dkimTokens,
      mailFromDomain: `${process.env.MAIL_FROM_SUBDOMAIN ?? 'mail'}.${domain}`,
      status: 'pending',
    },
    201,
  );
}

export async function handleEmailAddressAdd(c: Context): Promise<Response> {
  const auth = authOf(c);
  if (!auth.workspaceID) return c.json({ error: 'no-workspace' }, 403);

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

  await sql.begin(async (tx) => {
    if (!parsed.data.channelID) {
      await tx`
        INSERT INTO channel (id, workspace_id, kind, name, is_default, config, created_at, updated_at)
        VALUES (
          ${channelID},
          ${auth.workspaceID},
          'email',
          ${`${domain.domain} email`},
          false,
          ${JSON.stringify({ sendingDomainID })}::jsonb,
          now(),
          now()
        )
        ON CONFLICT (id) DO NOTHING
      `;
      await tx`
        INSERT INTO email_channel (channel_id, sending_domain_id, created_at, updated_at)
        VALUES (${channelID}, ${sendingDomainID}, now(), now())
        ON CONFLICT (channel_id) DO NOTHING
      `;
    }

    if (parsed.data.isDefault) {
      await tx`
        UPDATE email_address
        SET is_default = false, updated_at = now()
        WHERE channel_id = ${channelID}
      `;
    }

    await tx`
      INSERT INTO email_address (
        id,
        workspace_id,
        channel_id,
        sending_domain_id,
        local_part,
        full_address,
        can_send,
        can_receive,
        is_default,
        label,
        created_at,
        updated_at
      )
      VALUES (
        ${id},
        ${auth.workspaceID},
        ${channelID},
        ${sendingDomainID},
        ${parsed.data.localPart.toLowerCase()},
        ${fullAddress},
        ${parsed.data.canSend},
        ${parsed.data.canReceive},
        ${parsed.data.isDefault},
        ${parsed.data.label ?? null},
        now(),
        now()
      )
    `;
  });

  return c.json({ id, channelID, sendingDomainID, fullAddress }, 201);
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

export async function handleEmailDomainVerifyDev(c: Context): Promise<Response> {
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
