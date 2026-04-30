// /app/settings/email/domains/$domainId — DNS records the tenant must add to
// their DNS, plus a "Mark verified (dev)" override that flips
// `dns_status='verified'` so we can test the send path without real DNS.

import { Badge, Button, cn } from '@opendesk/ui';
import { queries } from '@opendesk/zero-schema';
import { useQuery } from '@rocicorp/zero/react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { ArrowLeft, Check, Copy } from 'lucide-react';
import { useState } from 'react';

const apiBase = (import.meta.env.VITE_API_URL as string | undefined) ?? '';

export const Route = createFileRoute('/app/settings/email/domains/$domainId')({
  component: DomainDetail,
});

interface DomainDetailRow {
  id: string;
  domain: string;
  mailFromSubdomain: string;
  dnsStatus: 'pending' | 'verified' | 'failed' | 'suspended';
  dmarcStatus: 'pending' | 'present' | 'missing' | 'failing';
  dkimTokens?: Array<{ name: string; value: string }> | null;
  lastVerifiedAt?: number | null;
  createdAt: number;
}

function statusVariant(
  s: DomainDetailRow['dnsStatus'],
): 'default' | 'success' | 'warning' | 'danger' {
  switch (s) {
    case 'verified':
      return 'success';
    case 'pending':
      return 'warning';
    case 'failed':
    case 'suspended':
      return 'danger';
    default:
      return 'default';
  }
}

function DomainDetail() {
  const { domainId } = Route.useParams();
  const [d, status] = useQuery(queries.sendingDomainByID({ id: domainId })) as unknown as [
    DomainDetailRow | null,
    { type: string },
  ];
  const [busy, setBusy] = useState(false);

  if (status?.type === 'unknown') {
    return <div className="p-8 text-sm text-slate-400">Loading…</div>;
  }
  if (!d) {
    return (
      <div className="p-8">
        <Link to="/app/settings/email/domains" className="text-sm text-slate-500">
          ← Back
        </Link>
        <p className="mt-4 text-sm text-slate-600">Domain not found.</p>
      </div>
    );
  }

  async function onMarkVerified() {
    setBusy(true);
    try {
      await fetch(`${apiBase}/api/settings/email/domains/${domainId}/verify-dev`, {
        method: 'POST',
        credentials: 'include',
      });
    } finally {
      setBusy(false);
    }
  }

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

  return (
    <div className="mx-auto w-full max-w-3xl px-8 py-8">
      <Link
        to="/app/settings/email/domains"
        className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-800"
      >
        <ArrowLeft className="h-3 w-3" /> Back to domains
      </Link>

      <header className="mt-3 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold text-slate-900">{d.domain}</h1>
          <div className="mt-1 flex items-center gap-2">
            <Badge variant={statusVariant(d.dnsStatus)}>DNS: {d.dnsStatus}</Badge>
            <Badge variant={statusVariant(d.dmarcStatus === 'present' ? 'verified' : 'pending')}>
              DMARC: {d.dmarcStatus}
            </Badge>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {d.dnsStatus === 'verified' ? (
            <Button size="sm" variant="outline" disabled>
              <Check className="h-3.5 w-3.5" /> Verified
            </Button>
          ) : (
            <Button size="sm" onClick={onMarkVerified} disabled={busy}>
              {busy ? 'Marking…' : 'Mark verified (dev)'}
            </Button>
          )}
        </div>
      </header>

      <p className="mt-3 max-w-xl text-sm text-slate-500">
        Add the records below to your DNS provider. Once they propagate, we'll DKIM-sign every reply
        as <code className="rounded bg-slate-100 px-1 py-0.5 text-[12px]">support@{d.domain}</code>.
      </p>

      <section className="mt-6 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-left text-[13px]">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-medium uppercase tracking-wide text-slate-500">
              <th className="px-3 py-2">Purpose</th>
              <th className="px-3 py-2">Type</th>
              <th className="px-3 py-2">Host</th>
              <th className="px-3 py-2">Value</th>
            </tr>
          </thead>
          <tbody>
            {records.map((r, i) => (
              <tr
                // biome-ignore lint/suspicious/noArrayIndexKey: stable list, not reordered
                key={i}
                className={cn(i !== records.length - 1 && 'border-b border-slate-100')}
              >
                <td className="px-3 py-2.5 font-medium text-slate-700">{r.kind}</td>
                <td className="px-3 py-2.5 text-slate-500">{r.type}</td>
                <td className="px-3 py-2.5 font-mono text-[12px] text-slate-800">{r.host}</td>
                <td className="px-3 py-2.5 font-mono text-[12px] text-slate-800">
                  <CopyValue value={r.value} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {d.dnsStatus !== 'verified' ? (
        <p className="mt-4 text-xs text-slate-500">
          DNS propagation can take up to an hour. After updating your records, click the verify
          button to re-check.
        </p>
      ) : null}
    </div>
  );
}

function CopyValue({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          // ignore
        }
      }}
      className="group inline-flex w-full items-center justify-between gap-2 text-left"
    >
      <span className="truncate">{value}</span>
      <span
        className={cn(
          'opacity-0 transition-opacity group-hover:opacity-100',
          copied && 'opacity-100',
        )}
      >
        {copied ? (
          <Check className="h-3 w-3 text-emerald-600" />
        ) : (
          <Copy className="h-3 w-3 text-slate-400" />
        )}
      </span>
    </button>
  );
}
