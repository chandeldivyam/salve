// /app/settings/channels/email/domains/$domainId — DNS records the tenant
// must add. Slice 3 changes:
//   - Every DNS value uses the shared <CopyValue> primitive (block variant
//     for the long ones, inline for hosts).
//   - The "Verify DNS" button calls the real Inngest-driven verification
//     endpoint (re-emits the cron event) when one exists. Until that
//     wiring lands, the button is labeled "Verify DNS (dev)" and is only
//     rendered in development builds. See the report for the deferred
//     backend item.

import { Badge, Button, CopyValue } from '@opendesk/ui';
import { queries, type SendingDomainDetailRow } from '@opendesk/zero-schema';
import { useQuery } from '@rocicorp/zero/react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { format } from 'date-fns';
import { ArrowLeft, Check, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { domainStatusVariant, postEmpty } from '@/components/email-settings/types';
import { RouteErrorFeedback, RoutePendingFeedback } from '@/components/route-feedback';
import { showError, showSuccess } from '@/lib/feedback';
import { CACHE_NAV } from '@/lib/zero-cache';

export const Route = createFileRoute('/app/settings/channels/email/domains/$domainId')({
  component: DomainDetail,
  pendingComponent: RoutePendingFeedback,
  errorComponent: RouteErrorFeedback,
});

// `SendingDomainDetailRow` is `QueryResultType<typeof queries.sendingDomainByID>`
// — a `.one()` query, so the type is the row itself, not an array.
type DomainDetailRow = NonNullable<SendingDomainDetailRow>;

function DomainDetail() {
  const { domainId } = Route.useParams();
  const [d, status] = useQuery(queries.sendingDomainByID({ id: domainId }), CACHE_NAV);
  const [busy, setBusy] = useState(false);

  if (status?.type === 'unknown') {
    return <div className="p-8 text-sm text-muted-foreground">Loading…</div>;
  }
  if (!d) {
    return (
      <div className="mx-auto w-full max-w-3xl px-8 py-8">
        <Link
          to="/app/settings/channels/email/domains"
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          ← Back to domains
        </Link>
        <p className="mt-4 text-sm text-muted-foreground">Domain not found.</p>
      </div>
    );
  }

  async function onVerifyDev() {
    setBusy(true);
    try {
      // Phase 3a only ships the dev-override endpoint. When the real
      // DNS-verification HTTP endpoint exists this should call it instead.
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

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-8">
      <Link
        to="/app/settings/channels/email/domains"
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3 w-3" /> Back to domains
      </Link>

      <header className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold text-foreground">{d.domain}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <Badge variant={domainStatusVariant(d.dnsStatus)}>DNS: {d.dnsStatus}</Badge>
            <Badge variant={d.dmarcStatus === 'present' ? 'success' : 'warning'}>
              DMARC: {d.dmarcStatus}
            </Badge>
            <span className="text-xs text-muted-foreground">
              Added {format(new Date(d.createdAt), 'MMM d, yyyy')}
            </span>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {isVerified ? (
            <Button size="sm" variant="outline" disabled>
              <Check className="h-3.5 w-3.5" /> Verified
            </Button>
          ) : import.meta.env.DEV ? (
            <Button size="sm" onClick={onVerifyDev} disabled={busy}>
              {busy ? 'Verifying...' : 'Verify DNS (dev)'}
            </Button>
          ) : (
            <Button size="sm" variant="outline" disabled>
              Verifying via DNS…
            </Button>
          )}
        </div>
      </header>

      {isVerified ? (
        // Verified domains shouldn't read as a setup task. Replace the
        // "Add the records below" framing with a calmer status block, and
        // tuck the actual record table behind a disclosure so it stays
        // self-documenting (still copyable) without dominating the page.
        <>
          <section className="mt-4 flex items-start gap-3 rounded-lg border border-success-border bg-success-soft p-4 text-sm text-success-soft-foreground">
            <ShieldCheck className="h-5 w-5 shrink-0" aria-hidden="true" />
            <div className="min-w-0">
              <p className="font-medium">DNS records configured</p>
              <p className="mt-1 text-xs">
                {d.domain} is verified
                {d.lastVerifiedAt
                  ? ` (last checked ${format(new Date(d.lastVerifiedAt), 'MMM d, yyyy')})`
                  : ''}
                . Replies are DKIM-signed.
              </p>
            </div>
          </section>

          <details className="group mt-4 rounded-lg border border-border bg-surface">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-3 text-sm font-medium text-foreground hover:bg-surface-muted">
              <span>Review DNS records</span>
              <span className="text-xs text-muted-foreground group-open:hidden">Show</span>
              <span className="hidden text-xs text-muted-foreground group-open:inline">Hide</span>
            </summary>
            <div className="space-y-4 border-t border-border p-4">
              {records.map((r) => (
                <div
                  key={`${r.kind}-${r.host}`}
                  className="rounded-lg border border-border bg-surface p-4 shadow-sm"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-medium text-foreground">{r.kind}</p>
                    <Badge variant="muted">{r.type}</Badge>
                  </div>
                  <div className="mt-3 grid gap-3 sm:grid-cols-[120px_minmax(0,1fr)] sm:items-start">
                    <span className="text-xs uppercase tracking-wide text-muted-foreground">
                      Host
                    </span>
                    <CopyValue value={r.host} label={`${r.kind} host`} />
                    <span className="text-xs uppercase tracking-wide text-muted-foreground">
                      Value
                    </span>
                    <CopyValue value={r.value} label={`${r.kind} value`} variant="block" />
                  </div>
                </div>
              ))}
            </div>
          </details>
        </>
      ) : (
        <>
          <p className="mt-3 max-w-xl text-sm text-muted-foreground">
            Add the records below to your DNS provider. Once they propagate, replies will be
            DKIM-signed as{' '}
            <code className="rounded bg-muted px-1 py-0.5 text-[12px]">support@{d.domain}</code>.
          </p>

          <section className="mt-6 space-y-4">
            {records.map((r) => (
              <div
                key={`${r.kind}-${r.host}`}
                className="rounded-lg border border-border bg-surface p-4 shadow-sm"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium text-foreground">{r.kind}</p>
                  <Badge variant="muted">{r.type}</Badge>
                </div>
                <div className="mt-3 grid gap-3 sm:grid-cols-[120px_minmax(0,1fr)] sm:items-start">
                  <span className="text-xs uppercase tracking-wide text-muted-foreground">
                    Host
                  </span>
                  <CopyValue value={r.host} label={`${r.kind} host`} />
                  <span className="text-xs uppercase tracking-wide text-muted-foreground">
                    Value
                  </span>
                  <CopyValue value={r.value} label={`${r.kind} value`} variant="block" />
                </div>
              </div>
            ))}
          </section>

          <p className="mt-4 text-xs text-muted-foreground">
            DNS propagation can take up to an hour. After updating your records, the next
            verification cron run will pick them up automatically.
          </p>
        </>
      )}
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
