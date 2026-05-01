// /app/settings/channels/email/domains/$domainId — DNS records the tenant
// must add. Variant C: SettingsHeader/Body shell, flat record sections,
// hairline separators, copy-value primitives.

import { Badge, Button, CopyValue } from '@opendesk/ui';
import { queries, type SendingDomainDetailRow } from '@opendesk/zero-schema';
import { useQuery } from '@rocicorp/zero/react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { format } from 'date-fns';
import { ArrowLeft, Check, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { domainStatusVariant, postEmpty } from '@/components/email-settings/types';
import { RouteErrorFeedback, RoutePendingFeedback } from '@/components/route-feedback';
import { FormSection, SettingsBody, SettingsHeader } from '@/components/settings';
import { showError, showSuccess } from '@/lib/feedback';
import { CACHE_NAV } from '@/lib/zero-cache';

export const Route = createFileRoute('/app/settings/channels/email/domains/$domainId')({
  component: DomainDetail,
  pendingComponent: RoutePendingFeedback,
  errorComponent: RouteErrorFeedback,
});

type DomainDetailRow = NonNullable<SendingDomainDetailRow>;

function DomainDetail() {
  const { domainId } = Route.useParams();
  const [d, status] = useQuery(queries.sendingDomainByID({ id: domainId }), CACHE_NAV);
  const [busy, setBusy] = useState(false);
  const [showRecords, setShowRecords] = useState(false);

  if (status?.type === 'unknown') {
    return (
      <>
        <SettingsHeader title="Domain" />
        <SettingsBody>
          <p className="text-[13px] text-fg-tertiary">Loading…</p>
        </SettingsBody>
      </>
    );
  }
  if (!d) {
    return (
      <>
        <SettingsHeader title="Domain" />
        <SettingsBody>
          <Link
            to="/app/settings/channels/email/domains"
            className="inline-flex items-center gap-1 text-[12px] text-fg-tertiary hover:text-fg-primary"
          >
            <ArrowLeft className="h-3 w-3" /> Back to domains
          </Link>
          <p className="mt-3 text-[13px] text-fg-tertiary">Domain not found.</p>
        </SettingsBody>
      </>
    );
  }

  async function onVerifyDev() {
    setBusy(true);
    try {
      await postEmpty([
        `/api/settings/channels/email/domains/${domainId}/verify-dev`,
        `/api/settings/email/domains/${domainId}/verify-dev`,
      ]);
      showSuccess('Domain marked verified', `${d?.domain ?? 'Domain'} is ready to send.`);
    } catch (err) {
      showError(err, 'Could not verify domain.');
    } finally {
      setBusy(false);
    }
  }

  const records = buildDnsRecords(d);
  const isVerified = d.dnsStatus === 'verified';

  const verifyButton = isVerified ? (
    <Button size="sm" variant="outline" disabled>
      <Check className="h-3.5 w-3.5" /> Verified
    </Button>
  ) : import.meta.env.DEV ? (
    <Button size="sm" onClick={onVerifyDev} disabled={busy}>
      {busy ? 'Verifying…' : 'Verify DNS (dev)'}
    </Button>
  ) : (
    <Button size="sm" variant="outline" disabled>
      Verifying via DNS…
    </Button>
  );

  return (
    <>
      <SettingsHeader
        title={d.domain}
        description={`Added ${format(new Date(d.createdAt), 'MMM d, yyyy')}`}
        actions={verifyButton}
      />
      <SettingsBody maxWidth="wide">
        <Link
          to="/app/settings/channels/email/domains"
          className="-mt-2 inline-flex items-center gap-1 text-[12px] text-fg-tertiary hover:text-fg-primary"
        >
          <ArrowLeft className="h-3 w-3" /> Back to domains
        </Link>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Badge variant={domainStatusVariant(d.dnsStatus)}>DNS: {d.dnsStatus}</Badge>
          <Badge variant={d.dmarcStatus === 'present' ? 'success' : 'warning'}>
            DMARC: {d.dmarcStatus}
          </Badge>
          {isVerified && d.lastVerifiedAt ? (
            <span className="text-[12px] text-fg-tertiary">
              Last checked {format(new Date(d.lastVerifiedAt), 'MMM d, yyyy')}
            </span>
          ) : null}
        </div>

        {isVerified ? (
          <div className="mt-6 flex flex-col gap-6">
            <div className="flex items-start gap-3 rounded-md bg-bg-elevated px-4 py-3">
              <ShieldCheck
                className="mt-0.5 h-4 w-4 shrink-0 text-fg-tertiary"
                aria-hidden="true"
              />
              <div className="min-w-0">
                <p className="text-[13px] font-medium text-fg-primary">DNS records configured</p>
                <p className="mt-0.5 text-[12px] text-fg-tertiary">
                  Replies are DKIM-signed from {d.domain}.
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setShowRecords((s) => !s)}
              className="self-start text-[12px] font-medium text-fg-tertiary underline-offset-2 hover:text-fg-primary hover:underline"
            >
              {showRecords ? 'Hide DNS records' : 'Review DNS records'}
            </button>

            {showRecords ? <DnsRecordList records={records} /> : null}
          </div>
        ) : (
          <div className="mt-6 flex flex-col gap-6">
            <FormSection
              title="DNS records"
              description={`Add the records below to your DNS provider. Once they propagate, replies will be DKIM-signed as support@${d.domain}.`}
            >
              <DnsRecordList records={records} />
              <p className="text-[11px] text-fg-tertiary">
                DNS propagation can take up to an hour. After updating your records, the next
                verification cron run will pick them up automatically.
              </p>
            </FormSection>
          </div>
        )}
      </SettingsBody>
    </>
  );
}

function DnsRecordList({
  records,
}: {
  records: Array<{ kind: string; host: string; type: 'CNAME' | 'TXT' | 'MX'; value: string }>;
}) {
  return (
    <div className="flex flex-col gap-4">
      {records.map((r) => (
        <div
          key={`${r.kind}-${r.host}`}
          className="flex flex-col gap-2 rounded-md bg-bg-elevated px-4 py-3"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[13px] font-medium text-fg-primary">{r.kind}</p>
            <Badge variant="muted">{r.type}</Badge>
          </div>
          <div className="grid gap-2 sm:grid-cols-[120px_minmax(0,1fr)] sm:items-start">
            <span className="text-[11px] uppercase tracking-[0.06em] text-fg-quaternary">Host</span>
            <CopyValue value={r.host} label={`${r.kind} host`} />
            <span className="text-[11px] uppercase tracking-[0.06em] text-fg-quaternary">
              Value
            </span>
            <CopyValue value={r.value} label={`${r.kind} value`} variant="block" />
          </div>
        </div>
      ))}
    </div>
  );
}

function buildDnsRecords(d: DomainDetailRow): Array<{
  kind: string;
  host: string;
  type: 'CNAME' | 'TXT' | 'MX';
  value: string;
}> {
  const records: Array<{
    kind: string;
    host: string;
    type: 'CNAME' | 'TXT' | 'MX';
    value: string;
  }> = [];
  for (const t of d.dkimTokens ?? []) {
    records.push({ kind: 'DKIM', host: t.name, type: 'CNAME', value: t.value });
  }
  records.push({
    kind: 'MAIL FROM (MX)',
    host: `${d.mailFromSubdomain}.${d.domain}`,
    type: 'MX',
    value: 'feedback-smtp.us-east-1.amazonses.com (priority 10)',
  });
  records.push({
    kind: 'MAIL FROM (SPF)',
    host: `${d.mailFromSubdomain}.${d.domain}`,
    type: 'TXT',
    value: 'v=spf1 include:amazonses.com ~all',
  });
  records.push({
    kind: 'DMARC',
    host: `_dmarc.${d.domain}`,
    type: 'TXT',
    value: `v=DMARC1; p=none; rua=mailto:dmarc-reports@${d.domain}`,
  });
  return records;
}
