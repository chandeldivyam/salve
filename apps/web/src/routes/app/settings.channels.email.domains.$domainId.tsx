// /app/settings/channels/email/domains/$domainId — DNS records the tenant
// must add. Variant C: SettingsHeader/Body shell, flat record sections,
// hairline separators, copy-value primitives.

import { useQuery } from '@rocicorp/zero/react';
import { Badge, Button, CopyValue } from '@salve/ui';
import { queries, type SendingDomainDetailRow } from '@salve/zero-schema';
import { createFileRoute, Link } from '@tanstack/react-router';
import { format } from 'date-fns';
import { ArrowLeft, Check, Loader2, ShieldCheck } from 'lucide-react';
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

  async function onVerify() {
    setBusy(true);
    try {
      await postEmpty([
        `/api/settings/channels/email/domains/${domainId}/verify`,
        `/api/settings/email/domains/${domainId}/verify`,
      ]);
      // Dispatching is async — the verify-domain Inngest fn updates dnsStatus
      // a few seconds later. The Zero subscription on this page picks up the
      // change automatically; we just nudge the user.
      showSuccess('Verification queued', 'DNS records are being checked now.');
    } catch (err) {
      showError(err, 'Could not start verification.');
    } finally {
      setBusy(false);
    }
  }

  const records = buildDnsRecords(d);
  const isVerified = d.dnsStatus === 'verified';
  const isProvisioning = d.provisionStatus === 'pending' || d.provisionStatus === 'provisioning';
  const provisionFailed = d.provisionStatus === 'failed';

  // Three states for the verify action:
  //   1. Already verified         → static success badge
  //   2. Provisioning in flight   → disabled, the next event flips state
  //   3. Provisioned but pending  → active "Verify now" that dispatches the
  //      Inngest verify event. Dev mode adds a sibling button that bypasses
  //      DNS lookups for local testing.
  const verifyButton = isVerified ? (
    <Button size="sm" variant="outline" disabled>
      <Check className="h-3.5 w-3.5" /> Verified
    </Button>
  ) : isProvisioning || provisionFailed ? (
    <Button size="sm" variant="outline" disabled>
      Verifying via DNS…
    </Button>
  ) : (
    <div className="flex items-center gap-2">
      {import.meta.env.DEV ? (
        <Button size="sm" variant="outline" onClick={onVerifyDev} disabled={busy}>
          {busy ? '…' : 'Verify (dev)'}
        </Button>
      ) : null}
      <Button size="sm" onClick={onVerify} disabled={busy}>
        {busy ? 'Checking…' : 'Verify now'}
      </Button>
    </div>
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
          <Badge variant={provisionFailed ? 'danger' : isProvisioning ? 'warning' : 'success'}>
            Provisioning: {d.provisionStatus}
          </Badge>
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

        {isProvisioning ? (
          <div className="mt-6 flex items-start gap-3 rounded-md bg-bg-elevated px-4 py-3">
            <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-fg-tertiary" />
            <div className="min-w-0">
              <p className="text-[13px] font-medium text-fg-primary">Preparing DNS records</p>
              <p className="mt-0.5 text-[12px] text-fg-tertiary">
                DKIM records will appear here when domain provisioning completes.
              </p>
            </div>
          </div>
        ) : provisionFailed ? (
          <div className="mt-6 rounded-md bg-red-50 px-4 py-3 text-[13px] text-red-700">
            Domain provisioning failed. Try adding the domain again or check the API logs.
          </div>
        ) : isVerified ? (
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

type DnsRecordRow = {
  kind: string;
  host: string;
  type: 'CNAME' | 'TXT' | 'MX';
  value: string;
};

function providerOf(d: DomainDetailRow): 'ses' | 'mailgun' {
  // `provider_meta.provider` is set by provision-domain.ts at provisioning
  // time. Older rows (pre-Mailgun) lack the field → default to SES.
  const meta = d.providerMeta as { provider?: string } | null | undefined;
  return meta?.provider === 'mailgun' ? 'mailgun' : 'ses';
}

function buildDnsRecords(d: DomainDetailRow): DnsRecordRow[] {
  return providerOf(d) === 'mailgun' ? buildMailgunRecords(d) : buildSesRecords(d);
}

function buildSesRecords(d: DomainDetailRow): DnsRecordRow[] {
  const records: DnsRecordRow[] = [];
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

function buildMailgunRecords(d: DomainDetailRow): DnsRecordRow[] {
  // Mailgun returns SPF + DKIM in `sending_dns_records` already shaped — we
  // mirror them straight into dkim_tokens with `recordType` set. No MAIL
  // FROM MX is needed (Mailgun owns the return path) so this list is
  // strictly DKIM CNAMEs + 1 SPF TXT, plus our own DMARC monitor row.
  const records: DnsRecordRow[] = [];
  for (const t of d.dkimTokens ?? []) {
    const type = mapRecordType(t.recordType);
    const kind = type === 'TXT' ? 'SPF' : 'DKIM';
    records.push({ kind, host: t.name, type, value: t.value });
  }
  records.push({
    kind: 'DMARC',
    host: `_dmarc.${d.domain}`,
    type: 'TXT',
    value: `v=DMARC1; p=none; rua=mailto:dmarc-reports@${d.domain}`,
  });
  return records;
}

function mapRecordType(value: string | undefined): 'CNAME' | 'TXT' | 'MX' {
  const upper = (value ?? '').toUpperCase();
  if (upper === 'TXT' || upper === 'MX') return upper;
  return 'CNAME';
}
