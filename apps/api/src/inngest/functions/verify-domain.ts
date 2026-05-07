import { resolveMx, resolveTxt } from 'node:dns/promises';
import { GetEmailIdentityCommand, SESv2Client } from '@aws-sdk/client-sesv2';
import { getClient } from '@salve/db';
import type postgres from 'postgres';
import { verifyMailgunDomainNow } from '../../email/mailgun-domains.js';
import { inngest } from '../client.js';
import { DOMAIN_EVENT, domainVerificationRequestedDataSchema } from '../events.js';

type Sql = postgres.Sql<Record<string, unknown>>;

interface DomainRow {
  id: string;
  workspace_id: string;
  domain: string;
  mail_from_subdomain: string | null;
  dns_status: string;
}

let ses: SESv2Client | undefined;
function getSes() {
  ses ??= new SESv2Client({
    region: process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? 'us-east-1',
  });
  return ses;
}

export const verifyDomain = inngest.createFunction(
  {
    id: 'verify-domain',
    name: 'Verify sending domain',
    retries: 4,
    concurrency: [{ scope: 'fn', key: 'event.data.workspaceID', limit: 5 }],
    triggers: [{ event: DOMAIN_EVENT.VERIFICATION_REQUESTED }, { cron: '*/30 * * * *' }],
  },
  // biome-ignore lint/suspicious/noExplicitAny: Cron and event payloads have different shapes; event data is Zod-validated when present.
  async ({ event, step }: any) => {
    const domains = await step.run('load-domains', async () => {
      if (event.name === DOMAIN_EVENT.VERIFICATION_REQUESTED) {
        const data = domainVerificationRequestedDataSchema.parse(event.data);
        return loadDomain(getClient(), data.sendingDomainID, data.workspaceID);
      }
      return loadPendingDomains(getClient());
    });

    const completed: Array<{ sendingDomainID: string; workspaceID: string; status: string }> = [];
    for (const domain of domains) {
      const result = await step.run(`check-${domain.id}`, async () => checkDomain(domain));
      await step.run(`update-${domain.id}`, async () =>
        updateDomainStatus(getClient(), domain.id, result),
      );
      if (result.dnsStatus === 'verified' && domain.dns_status !== 'verified') {
        completed.push({
          sendingDomainID: domain.id,
          workspaceID: domain.workspace_id,
          status: 'verified',
        });
      }
    }

    for (const item of completed) {
      await step.sendEvent(`domain-verified-${item.sendingDomainID}`, {
        id: `dom-verify-done-${item.sendingDomainID}-${Date.now()}`,
        name: DOMAIN_EVENT.VERIFICATION_COMPLETED,
        data: item,
      });
    }

    return { checked: domains.length, completed: completed.length };
  },
);

async function loadDomain(sql: Sql, id: string, workspaceID: string): Promise<DomainRow[]> {
  return sql<DomainRow[]>`
    SELECT id, workspace_id, domain, mail_from_subdomain, dns_status
    FROM sending_domain
    WHERE id = ${id}
      AND workspace_id = ${workspaceID}
    LIMIT 1
  `;
}

async function loadPendingDomains(sql: Sql): Promise<DomainRow[]> {
  return sql<DomainRow[]>`
    SELECT id, workspace_id, domain, mail_from_subdomain, dns_status
    FROM sending_domain
    WHERE dns_status = 'pending'
      AND suspended_at IS NULL
    ORDER BY created_at ASC
    LIMIT 100
  `;
}

async function checkDomain(domain: DomainRow): Promise<{ dnsStatus: string; dmarcStatus: string }> {
  const backend =
    process.env.MAILER_BACKEND ?? (process.env.NODE_ENV === 'production' ? 'ses' : 'mailpit');

  const dmarcStatus = await hasDmarcRecord(domain.domain).then((ok) =>
    ok ? 'present' : 'missing',
  );

  if (backend === 'mailgun') {
    // PUT /v4/domains/{name}/verify forces Mailgun to re-poll the records.
    // It returns the same shape as GET — `domain.state === 'active'` is the
    // single signal that DKIM + SPF are passing. Mailgun does not require a
    // tenant-side MAIL FROM MX (it owns the return path through its own
    // bounce host), so we skip the resolveMx check entirely.
    let active = false;
    try {
      const res = await verifyMailgunDomainNow(domain.domain);
      active = res.domain?.state === 'active';
    } catch (error) {
      console.error('[verify-domain] mailgun verify failed', { domain: domain.domain, error });
    }
    return {
      dnsStatus: active ? 'verified' : 'pending',
      dmarcStatus,
    };
  }

  let sesVerified = backend !== 'ses';
  if (backend === 'ses') {
    const identity = await getSes().send(
      new GetEmailIdentityCommand({ EmailIdentity: domain.domain }),
    );
    sesVerified = identity.VerificationStatus === 'SUCCESS';
  }
  const mailFromStatus = await hasMailFromMx(domain.domain, domain.mail_from_subdomain ?? 'mail');
  return {
    dnsStatus: sesVerified && mailFromStatus ? 'verified' : 'pending',
    dmarcStatus,
  };
}

async function hasDmarcRecord(domain: string): Promise<boolean> {
  try {
    const records = await resolveTxt(`_dmarc.${domain}`);
    return records.some((parts) => parts.join('').toLowerCase().startsWith('v=dmarc1'));
  } catch {
    return false;
  }
}

async function hasMailFromMx(domain: string, subdomain: string): Promise<boolean> {
  try {
    const records = await resolveMx(`${subdomain}.${domain}`);
    return records.length > 0;
  } catch {
    return false;
  }
}

async function updateDomainStatus(
  sql: Sql,
  id: string,
  result: { dnsStatus: string; dmarcStatus: string },
): Promise<void> {
  await sql`
    UPDATE sending_domain
    SET dns_status = ${result.dnsStatus},
        dmarc_status = ${result.dmarcStatus},
        last_verified_at = now(),
        updated_at = now()
    WHERE id = ${id}
  `;
}
