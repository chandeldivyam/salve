import { getClient } from '@opendesk/db';
import type postgres from 'postgres';
import { inngest } from '../client.js';
import { DELIVERY_EVENT } from '../events.js';

type Sql = postgres.Sql<Record<string, unknown>>;

interface QueuedOutboundRow {
  id: string;
  workspace_id: string;
  channel_id: string;
  ticket_id: string;
  message_id: string;
  customer_id: string | null;
}

export const deliverMessageRecovery = inngest.createFunction(
  {
    id: 'deliver-message-recovery',
    name: 'Deliver message recovery',
    retries: 2,
    concurrency: [{ scope: 'fn', limit: 1 }],
    triggers: [{ cron: '*/30 * * * *' }],
  },
  async ({ step }) => {
    const stale = await step.run('scan-stale-queued', async () => loadStaleQueued(getClient()));
    for (const row of stale) {
      await step.sendEvent(`recover-${row.message_id}`, {
        id: `msg-req-${row.message_id}`,
        name: DELIVERY_EVENT.MESSAGE_REQUESTED,
        data: {
          workspaceID: row.workspace_id,
          channelID: row.channel_id,
          ticketID: row.ticket_id,
          messageID: row.message_id,
          outboundMessageID: row.id,
          customerID: row.customer_id ?? undefined,
          attempt: 1,
        },
      });
    }
    return { reemitted: stale.length };
  },
);

async function loadStaleQueued(sql: Sql): Promise<QueuedOutboundRow[]> {
  return sql<QueuedOutboundRow[]>`
    SELECT om.id, om.workspace_id, om.channel_id, om.ticket_id, om.message_id, t.customer_id
    FROM outbound_message om
    JOIN ticket t ON t.id = om.ticket_id
    WHERE om.status = 'queued'
      AND om.created_at < now() - interval '5 minutes'
    ORDER BY om.created_at ASC
    LIMIT 1000
  `;
}

interface DomainRateRow {
  sending_domain_id: string;
  total: number;
  bounced: number;
  complained: number;
}

export const bounceRateWatchdog = inngest.createFunction(
  {
    id: 'bounce-rate-watchdog',
    name: 'Bounce rate watchdog',
    retries: 2,
    triggers: [{ cron: '0 * * * *' }],
  },
  async ({ step }) => {
    const rows = await step.run('compute-rates', async () => loadDomainRates(getClient()));
    const suspended: string[] = [];
    for (const row of rows) {
      const bounceRate = row.total > 0 ? row.bounced / row.total : 0;
      const complaintRate = row.total > 0 ? row.complained / row.total : 0;
      if (row.total >= 100 && (bounceRate > 0.05 || complaintRate > 0.001)) {
        await step.run(`suspend-${row.sending_domain_id}`, async () =>
          suspendDomain(
            getClient(),
            row.sending_domain_id,
            bounceRate > 0.05 ? 'bounce_rate' : 'complaint_rate',
          ),
        );
        suspended.push(row.sending_domain_id);
      }
    }
    return { checked: rows.length, suspended: suspended.length };
  },
);

async function loadDomainRates(sql: Sql): Promise<DomainRateRow[]> {
  return sql<DomainRateRow[]>`
    SELECT
      ec.sending_domain_id,
      count(*)::int AS total,
      count(*) FILTER (WHERE om.status = 'bounced')::int AS bounced,
      count(*) FILTER (WHERE om.status = 'complained')::int AS complained
    FROM outbound_message om
    JOIN email_channel ec ON ec.channel_id = om.channel_id
    WHERE om.created_at >= now() - interval '24 hours'
      AND ec.sending_domain_id IS NOT NULL
    GROUP BY ec.sending_domain_id
  `;
}

async function suspendDomain(sql: Sql, sendingDomainID: string, reason: string): Promise<void> {
  await sql`
    UPDATE sending_domain
    SET suspended_at = COALESCE(suspended_at, now()),
        suspended_reason = ${reason},
        updated_at = now()
    WHERE id = ${sendingDomainID}
  `;
}
