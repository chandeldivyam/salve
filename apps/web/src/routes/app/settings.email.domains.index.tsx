// /app/settings/email/domains — list of `sending_domain` rows + an inline
// "Add domain" form. Reads via Zero (realtime); writes hit the REST endpoint
// at `/api/settings/email/domains` so the server can stub DKIM tokens (Phase
// 3a) and call SES `CreateEmailIdentity` (Phase 3c).

import { Badge, Button, cn, Input } from '@opendesk/ui';
import { queries } from '@opendesk/zero-schema';
import { useQuery } from '@rocicorp/zero/react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { format } from 'date-fns';
import { ChevronRight, Plus } from 'lucide-react';
import { useState } from 'react';

const apiBase = (import.meta.env.VITE_API_URL as string | undefined) ?? '';

export const Route = createFileRoute('/app/settings/email/domains/')({
  component: EmailDomainsList,
});

interface Domain {
  id: string;
  domain: string;
  dnsStatus: 'pending' | 'verified' | 'failed' | 'suspended';
  dmarcStatus: 'pending' | 'present' | 'missing' | 'failing';
  createdAt: number;
}

function statusVariant(s: Domain['dnsStatus']): 'default' | 'success' | 'warning' | 'danger' {
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

function EmailDomainsList() {
  // biome-ignore lint/suspicious/noExplicitAny: Zero useQuery types don't surface through here cleanly
  const [rows] = useQuery(queries.sendingDomains()) as unknown as [Domain[], any];
  const [showForm, setShowForm] = useState(false);
  const [domain, setDomain] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(ev: React.FormEvent) {
    ev.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch(`${apiBase}/api/settings/email/domains`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ domain: domain.trim() }),
      });
      if (!res.ok) {
        const msg = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(msg?.error ?? `${res.status}`);
      }
      setDomain('');
      setShowForm(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-8 py-8">
      <header className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-lg font-semibold text-foreground">Email domains</h1>
          <p className="mt-1 max-w-xl text-sm text-muted-foreground">
            Send email from your own domain. Add it here, install the DNS records, and we'll
            DKIM-sign every reply on your behalf.
          </p>
        </div>
        <Button
          size="sm"
          onClick={() => setShowForm((s) => !s)}
          variant={showForm ? 'outline' : 'default'}
        >
          <Plus className="h-3.5 w-3.5" /> Add domain
        </Button>
      </header>

      {showForm ? (
        <form
          onSubmit={onSubmit}
          className="mb-6 rounded-lg border border-border bg-surface p-4 shadow-sm"
        >
          <label className="block text-xs font-medium text-muted-foreground" htmlFor="domain-input">
            Domain
          </label>
          <Input
            id="domain-input"
            placeholder="acme.com"
            className="mt-1"
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            disabled={submitting}
            autoFocus
          />
          {error ? <p className="mt-2 text-xs text-danger-soft-foreground">{error}</p> : null}
          <div className="mt-3 flex justify-end gap-2">
            <Button
              size="sm"
              variant="outline"
              type="button"
              onClick={() => {
                setShowForm(false);
                setDomain('');
                setError(null);
              }}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button size="sm" type="submit" disabled={submitting || domain.trim().length < 3}>
              {submitting ? 'Adding…' : 'Add domain'}
            </Button>
          </div>
        </form>
      ) : null}

      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-surface p-8 text-center text-sm text-muted-foreground">
          No domains yet. Click <strong>Add domain</strong> above to start sending from your own
          address.
        </div>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface shadow-sm">
          {rows.map((d) => (
            <li key={d.id}>
              <Link
                to="/app/settings/email/domains/$domainId"
                params={{ domainId: d.id }}
                className={cn(
                  'flex items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-surface-muted',
                )}
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">{d.domain}</p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    Added {format(new Date(d.createdAt), 'MMM d, yyyy')}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={statusVariant(d.dnsStatus)}>{d.dnsStatus}</Badge>
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
