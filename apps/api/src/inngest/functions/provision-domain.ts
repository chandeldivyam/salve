import {
  CreateEmailIdentityCommand,
  GetEmailIdentityCommand,
  PutEmailIdentityMailFromAttributesCommand,
  SESv2Client,
} from '@aws-sdk/client-sesv2';
import { getClient } from '@salve/db';
import type postgres from 'postgres';
import {
  createMailgunDomain,
  getMailgunDomain,
  isAlreadyExistsError,
  type MailgunDnsRecord,
  type MailgunDomainResponse,
} from '../../email/mailgun-domains.js';
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

function mailerBackend(): 'mailpit' | 'ses' | 'mailgun' {
  const explicit = process.env.MAILER_BACKEND;
  if (explicit === 'ses') return 'ses';
  if (explicit === 'mailgun') return 'mailgun';
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
      const result = await step.run('provision-identity', async () => provisionIdentity(domain));
      await step.run('mark-provisioned', async () =>
        markProvisioned(getClient(), domain.id, result),
      );
      await step.sendEvent('request-verification', {
        id: `dom-verify-req-${domain.id}-${Date.now()}`,
        name: DOMAIN_EVENT.VERIFICATION_REQUESTED,
        data: {
          workspaceID: domain.workspace_id,
          sendingDomainID: domain.id,
        },
      });
      return { provisioned: true, dkimTokens: result.dkimTokens.length, provider: result.provider };
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

export type DkimRecord = { name: string; value: string; recordType?: string };
export type ProvisionProvider = 'ses' | 'mailgun' | 'stub';

interface ProvisionResult {
  provider: ProvisionProvider;
  dkimTokens: DkimRecord[];
  /** Raw provider snapshot, written to provider_meta for later debugging. */
  raw?: Record<string, unknown>;
}

async function provisionIdentity(domain: SendingDomainRow): Promise<ProvisionResult> {
  const backend = mailerBackend();
  if (backend === 'mailgun') return provisionViaMailgun(domain);
  if (backend === 'ses') return provisionViaSes(domain);
  return { provider: 'stub', dkimTokens: stubDkimTokens(domain.domain) };
}

async function provisionViaSes(domain: SendingDomainRow): Promise<ProvisionResult> {
  const client = getSes();
  try {
    const created = await client.send(
      new CreateEmailIdentityCommand({
        EmailIdentity: domain.domain,
        DkimSigningAttributes: { NextSigningKeyLength: 'RSA_2048_BIT' },
      }),
    );
    await putMailFrom(client, domain);
    return {
      provider: 'ses',
      dkimTokens: tokenRecords(domain.domain, created.DkimAttributes?.Tokens ?? []),
    };
  } catch (error) {
    if (!isAlreadyExists(error)) throw error;
    const existing = await client.send(
      new GetEmailIdentityCommand({ EmailIdentity: domain.domain }),
    );
    await putMailFrom(client, domain);
    return {
      provider: 'ses',
      dkimTokens: tokenRecords(domain.domain, existing.DkimAttributes?.Tokens ?? []),
    };
  }
}

async function provisionViaMailgun(domain: SendingDomainRow): Promise<ProvisionResult> {
  let response: MailgunDomainResponse;
  try {
    response = await createMailgunDomain(domain.domain);
  } catch (error) {
    // Mailgun returns 400 (not 409) when the domain already exists in this
    // account. Treat the same as SES `AlreadyExistsException`: fetch the
    // existing record and use its DNS list.
    if (!isAlreadyExistsError(error)) throw error;
    response = await getMailgunDomain(domain.domain);
  }
  return {
    provider: 'mailgun',
    dkimTokens: mapMailgunSendingRecords(response.sending_dns_records ?? []),
    raw: { mailgunDomain: response.domain, sendingDnsRecords: response.sending_dns_records },
  };
}

function mapMailgunSendingRecords(records: readonly MailgunDnsRecord[]): DkimRecord[] {
  // Strip Mailgun-specific tracking CNAMEs from the tenant-facing list — those
  // are optional (open/click tracking) and clutter the DNS instructions.
  return records
    .filter((r) => !/^email\./i.test(r.name))
    .map((r) => ({
      name: r.name,
      value: r.value,
      recordType: r.record_type?.toUpperCase(),
    }));
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

async function markProvisioned(sql: Sql, id: string, result: ProvisionResult): Promise<void> {
  // The `provider` field on provider_meta is what the UI keys off to choose
  // which DNS instructions to render (Mailgun vs SES) — without it, a domain
  // provisioned through Mailgun would show SES-shaped MAIL FROM/SPF rows
  // alongside CNAMEs that don't exist.
  const meta: Record<string, unknown> = { provisionError: null, provider: result.provider };
  if (result.raw) Object.assign(meta, result.raw);
  await sql`
    UPDATE sending_domain
    SET dkim_tokens = ${JSON.stringify(result.dkimTokens)}::jsonb,
        provision_status = 'provisioned',
        provider_meta = COALESCE(provider_meta, '{}'::jsonb) || ${JSON.stringify(meta)}::jsonb,
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
