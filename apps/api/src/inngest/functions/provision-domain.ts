import {
  CreateEmailIdentityCommand,
  GetEmailIdentityCommand,
  PutEmailIdentityMailFromAttributesCommand,
  SESv2Client,
} from '@aws-sdk/client-sesv2';
import { getClient } from '@salve/db';
import type postgres from 'postgres';
import { inngest } from '../client.js';
import { DOMAIN_EVENT, domainProvisionRequestedDataSchema } from '../events.js';

type Sql = postgres.Sql<Record<string, unknown>>;

interface SendingDomainRow {
  id: string;
  workspace_id: string;
  domain: string;
  mail_from_subdomain: string;
}

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

export const provisionDomain = inngest.createFunction(
  {
    id: 'provision-domain',
    name: 'Provision sending domain',
    retries: 4,
    concurrency: [{ scope: 'fn', key: 'event.data.workspaceID', limit: 5 }],
    triggers: [{ event: DOMAIN_EVENT.PROVISION_REQUESTED }],
  },
  async ({ event, step }) => {
    const data = domainProvisionRequestedDataSchema.parse(event.data);
    const domain = await step.run('load-domain', async () =>
      loadDomain(getClient(), data.sendingDomainID, data.workspaceID),
    );
    if (!domain) return { provisioned: false, reason: 'not_found' };

    await step.run('mark-provisioning', async () =>
      updateProvisionStatus(getClient(), domain.id, 'provisioning'),
    );

    try {
      const dkimTokens = await step.run('provision-identity', async () =>
        provisionIdentity(domain),
      );
      await step.run('mark-provisioned', async () =>
        markProvisioned(getClient(), domain.id, dkimTokens),
      );
      await step.sendEvent('request-verification', {
        id: `dom-verify-req-${domain.id}-${Date.now()}`,
        name: DOMAIN_EVENT.VERIFICATION_REQUESTED,
        data: {
          workspaceID: domain.workspace_id,
          sendingDomainID: domain.id,
        },
      });
      return { provisioned: true, dkimTokens: dkimTokens.length };
    } catch (error) {
      await step.run('mark-failed', async () => markProvisionFailed(getClient(), domain.id, error));
      throw error;
    }
  },
);

async function loadDomain(
  sql: Sql,
  id: string,
  workspaceID: string,
): Promise<SendingDomainRow | null> {
  const rows = await sql<SendingDomainRow[]>`
    SELECT id, workspace_id, domain, mail_from_subdomain
    FROM sending_domain
    WHERE id = ${id}
      AND workspace_id = ${workspaceID}
    LIMIT 1
  `;
  return rows[0] ?? null;
}

async function provisionIdentity(
  domain: SendingDomainRow,
): Promise<Array<{ name: string; value: string }>> {
  if (mailerBackend() !== 'ses') return stubDkimTokens(domain.domain);

  const client = getSes();
  try {
    const created = await client.send(
      new CreateEmailIdentityCommand({
        EmailIdentity: domain.domain,
        DkimSigningAttributes: { NextSigningKeyLength: 'RSA_2048_BIT' },
      }),
    );
    await putMailFrom(client, domain);
    return tokenRecords(domain.domain, created.DkimAttributes?.Tokens ?? []);
  } catch (error) {
    if (!isAlreadyExists(error)) throw error;
    const existing = await client.send(
      new GetEmailIdentityCommand({ EmailIdentity: domain.domain }),
    );
    await putMailFrom(client, domain);
    return tokenRecords(domain.domain, existing.DkimAttributes?.Tokens ?? []);
  }
}

async function putMailFrom(client: SESv2Client, domain: SendingDomainRow): Promise<void> {
  await client.send(
    new PutEmailIdentityMailFromAttributesCommand({
      EmailIdentity: domain.domain,
      MailFromDomain: `${domain.mail_from_subdomain}.${domain.domain}`,
      BehaviorOnMxFailure: 'USE_DEFAULT_VALUE',
    }),
  );
}

function tokenRecords(domain: string, tokens: readonly string[]) {
  return tokens.map((token) => ({
    name: `${token}._domainkey.${domain}`,
    value: `${token}.dkim.amazonses.com`,
  }));
}

function isAlreadyExists(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const name = (error as { name?: unknown }).name;
  return name === 'AlreadyExistsException' || name === 'ConflictException';
}

async function updateProvisionStatus(
  sql: Sql,
  id: string,
  status: 'provisioning' | 'failed',
): Promise<void> {
  await sql`
    UPDATE sending_domain
    SET provision_status = ${status},
        updated_at = now()
    WHERE id = ${id}
  `;
}

async function markProvisioned(
  sql: Sql,
  id: string,
  dkimTokens: Array<{ name: string; value: string }>,
): Promise<void> {
  await sql`
    UPDATE sending_domain
    SET dkim_tokens = ${JSON.stringify(dkimTokens)}::jsonb,
        provision_status = 'provisioned',
        provider_meta = provider_meta || ${JSON.stringify({ provisionError: null })}::jsonb,
        updated_at = now()
    WHERE id = ${id}
  `;
}

async function markProvisionFailed(sql: Sql, id: string, error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : 'domain provisioning failed';
  await sql`
    UPDATE sending_domain
    SET provision_status = 'failed',
        provider_meta = provider_meta || ${JSON.stringify({ provisionError: message })}::jsonb,
        updated_at = now()
    WHERE id = ${id}
  `;
}
