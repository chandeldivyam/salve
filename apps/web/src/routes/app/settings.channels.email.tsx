// /app/settings/channels/email — canonical Phase 3a email channel settings.
// Domains and suppressions are realtime Zero reads. Writes go through REST
// endpoints because SES/domain side effects are server-owned.

import {
  Badge,
  Button,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
  Input,
} from '@opendesk/ui';
import { queries } from '@opendesk/zero-schema';
import { useQuery } from '@rocicorp/zero/react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { format } from 'date-fns';
import { Check, ChevronDown, ExternalLink, Plus } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

const apiBase = (import.meta.env.VITE_API_URL as string | undefined) ?? '';

export const Route = createFileRoute('/app/settings/channels/email')({
  component: EmailChannelSettings,
});

type Phase3EmailQueries = typeof queries & {
  sendableEmailAddresses: () => ReturnType<typeof queries.sendingDomains>;
  suppressions: () => ReturnType<typeof queries.sendingDomains>;
};

interface Domain {
  id: string;
  domain: string;
  dnsStatus: 'pending' | 'verified' | 'failed' | 'suspended';
  dmarcStatus: 'pending' | 'present' | 'missing' | 'failing';
  createdAt: number;
  emailAddresses?: EmailAddress[];
  addresses?: EmailAddress[];
}

interface EmailAddress {
  id: string;
  fullAddress: string;
  label?: string | null;
  localPart?: string | null;
  sendingDomainID?: string | null;
  sendingDomainId?: string | null;
  sendingDomain?: {
    id?: string | null;
    domain?: string | null;
    dnsStatus?: string | null;
  } | null;
  canSend?: boolean | null;
  canReceive?: boolean | null;
  isDefault?: boolean | null;
}

interface Suppression {
  id: string;
  target?: string | null;
  emailAddress?: string | null;
  channel?: string | null;
  channelKind?: string | null;
  reason: string;
  status?: string | null;
  deletedAt?: number | null;
  createdAt?: number | null;
}

function EmailChannelSettings() {
  const [domains] = useQuery(queries.sendingDomains()) as unknown as [Domain[], { type: string }];
  const [addresses] = useQuery(
    (queries as unknown as Phase3EmailQueries).sendableEmailAddresses(),
  ) as unknown as [EmailAddress[], { type: string }];
  const [suppressions] = useQuery(
    (queries as unknown as Phase3EmailQueries).suppressions(),
  ) as unknown as [Suppression[], { type: string }];

  const [showDomainForm, setShowDomainForm] = useState(false);
  const [showAddressForm, setShowAddressForm] = useState(false);
  const [selectedDomainID, setSelectedDomainID] = useState<string | null>(null);

  const addressesByDomain = useMemo(() => {
    const grouped = new Map<string, EmailAddress[]>();
    for (const address of addresses) {
      const domainID =
        address.sendingDomainID ?? address.sendingDomainId ?? address.sendingDomain?.id;
      if (!domainID) continue;
      grouped.set(domainID, [...(grouped.get(domainID) ?? []), address]);
    }
    return grouped;
  }, [addresses]);

  useEffect(() => {
    if (!domains.length) {
      setSelectedDomainID(null);
      return;
    }
    setSelectedDomainID((current) =>
      current && domains.some((domain) => domain.id === current)
        ? current
        : (domains[0]?.id ?? null),
    );
  }, [domains]);

  const selectedDomain = domains.find((domain) => domain.id === selectedDomainID) ?? null;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 py-6 sm:px-8">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold text-slate-900">Email channel</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-500">
            Manage outbound domains, sendable addresses, and suppressed recipients for this
            workspace.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant={showAddressForm ? 'outline' : 'default'}
            onClick={() => setShowAddressForm((show) => !show)}
            disabled={domains.length === 0}
          >
            <Plus className="h-3.5 w-3.5" /> Add address
          </Button>
          <Button
            size="sm"
            variant={showDomainForm ? 'outline' : 'default'}
            onClick={() => setShowDomainForm((show) => !show)}
          >
            <Plus className="h-3.5 w-3.5" /> Add domain
          </Button>
        </div>
      </header>

      {showDomainForm ? <AddDomainForm onDone={() => setShowDomainForm(false)} /> : null}
      {showAddressForm ? (
        <AddAddressForm
          domains={domains}
          selectedDomain={selectedDomain}
          selectedDomainID={selectedDomainID}
          onSelectDomain={setSelectedDomainID}
          onDone={() => setShowAddressForm(false)}
        />
      ) : null}

      <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-900">Domains and addresses</h2>
        </div>
        {domains.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-slate-500">
            Add a domain before creating outbound addresses.
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {domains.map((domain) => {
              const domainAddresses = mergeAddresses(
                addressesByDomain.get(domain.id) ?? [],
                domain.emailAddresses ?? domain.addresses ?? [],
              );
              return <DomainRow key={domain.id} domain={domain} addresses={domainAddresses} />;
            })}
          </div>
        )}
      </section>

      <SuppressionList rows={suppressions} />
    </div>
  );
}

function AddDomainForm({ onDone }: { onDone: () => void }) {
  const [domain, setDomain] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(ev: React.FormEvent) {
    ev.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await postJSON(['/api/settings/channels/email/domains', '/api/settings/email/domains'], {
        domain: domain.trim(),
      });
      setDomain('');
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      noValidate
      onSubmit={onSubmit}
      className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
    >
      <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
        <div className="min-w-0">
          <label className="block text-xs font-medium text-slate-600" htmlFor="domain-input">
            Domain
          </label>
          <Input
            id="domain-input"
            placeholder="acme.com"
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            disabled={submitting}
            aria-invalid={Boolean(error)}
            className="mt-1"
            autoFocus
          />
          {error ? <p className="mt-1 text-xs text-red-600">{error}</p> : null}
        </div>
        <div className="flex justify-end gap-2">
          <Button size="sm" type="button" variant="outline" onClick={onDone} disabled={submitting}>
            Cancel
          </Button>
          <Button size="sm" type="submit" disabled={submitting || domain.trim().length < 3}>
            {submitting ? 'Adding...' : 'Add domain'}
          </Button>
        </div>
      </div>
    </form>
  );
}

function AddAddressForm({
  domains,
  selectedDomain,
  selectedDomainID,
  onSelectDomain,
  onDone,
}: {
  domains: Domain[];
  selectedDomain: Domain | null;
  selectedDomainID: string | null;
  onSelectDomain: (id: string) => void;
  onDone: () => void;
}) {
  const [localPart, setLocalPart] = useState('support');
  const [label, setLabel] = useState('Support');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(ev: React.FormEvent) {
    ev.preventDefault();
    if (!selectedDomainID) return;
    setError(null);
    setSubmitting(true);
    try {
      await postJSON(['/api/settings/channels/email/addresses'], {
        sendingDomainID: selectedDomainID,
        localPart: localPart.trim(),
        label: label.trim() || undefined,
        canSend: true,
        canReceive: true,
      });
      setLocalPart('support');
      setLabel('Support');
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      noValidate
      onSubmit={onSubmit}
      className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
    >
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto] lg:items-end">
        <div className="min-w-0">
          <p className="mb-1 text-xs font-medium text-slate-600">Domain</p>
          <DomainPicker
            domains={domains}
            selectedDomain={selectedDomain}
            selectedDomainID={selectedDomainID}
            onSelect={onSelectDomain}
          />
        </div>
        <div className="min-w-0">
          <label className="block text-xs font-medium text-slate-600" htmlFor="localpart-input">
            Local part
          </label>
          <Input
            id="localpart-input"
            placeholder="support"
            value={localPart}
            onChange={(e) => setLocalPart(e.target.value)}
            disabled={submitting}
            aria-invalid={Boolean(error)}
            className="mt-1"
          />
        </div>
        <div className="min-w-0">
          <label className="block text-xs font-medium text-slate-600" htmlFor="label-input">
            Label
          </label>
          <Input
            id="label-input"
            placeholder="Support"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            disabled={submitting}
            className="mt-1"
          />
        </div>
        <div className="flex justify-end gap-2">
          <Button size="sm" type="button" variant="outline" onClick={onDone} disabled={submitting}>
            Cancel
          </Button>
          <Button
            size="sm"
            type="submit"
            disabled={submitting || !selectedDomainID || localPart.trim().length === 0}
          >
            {submitting ? 'Adding...' : 'Add address'}
          </Button>
        </div>
      </div>
      {selectedDomain ? (
        <p className="mt-2 truncate text-xs text-slate-500">
          Address preview: {localPart.trim() || 'local'}@{selectedDomain.domain}
        </p>
      ) : null}
      {error ? <p className="mt-2 text-xs text-red-600">{error}</p> : null}
    </form>
  );
}

function DomainPicker({
  domains,
  selectedDomain,
  selectedDomainID,
  onSelect,
}: {
  domains: Domain[];
  selectedDomain: Domain | null;
  selectedDomainID: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="inline-flex h-9 w-full min-w-0 items-center justify-between gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-700 hover:bg-slate-50"
        >
          <span className="truncate">{selectedDomain?.domain ?? 'Choose domain'}</span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-slate-400" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-[min(320px,calc(100vw-2rem))]">
        <DropdownMenuLabel>Domain</DropdownMenuLabel>
        {domains.map((domain) => (
          <DropdownMenuItem key={domain.id} onSelect={() => onSelect(domain.id)}>
            <span className="grid h-4 w-4 place-items-center">
              {selectedDomainID === domain.id ? <Check className="h-3.5 w-3.5" /> : null}
            </span>
            <span className="truncate">{domain.domain}</span>
            <Badge variant={domainStatusVariant(domain.dnsStatus)}>{domain.dnsStatus}</Badge>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function DomainRow({ domain, addresses }: { domain: Domain; addresses: EmailAddress[] }) {
  const [verifying, setVerifying] = useState(false);

  async function onVerifyDev() {
    setVerifying(true);
    try {
      await postEmpty([
        `/api/settings/channels/email/domains/${domain.id}/verify-dev`,
        `/api/settings/email/domains/${domain.id}/verify-dev`,
      ]);
    } finally {
      setVerifying(false);
    }
  }

  return (
    <div className="px-4 py-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <p className="truncate text-sm font-semibold text-slate-900">{domain.domain}</p>
            <Badge variant={domainStatusVariant(domain.dnsStatus)}>DNS: {domain.dnsStatus}</Badge>
            <Badge variant={domain.dmarcStatus === 'present' ? 'success' : 'warning'}>
              DMARC: {domain.dmarcStatus}
            </Badge>
          </div>
          <p className="mt-1 text-xs text-slate-400">
            Added {format(new Date(domain.createdAt), 'MMM d, yyyy')}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button size="sm" variant="outline" asChild>
            <Link to="/app/settings/email/domains/$domainId" params={{ domainId: domain.id }}>
              <ExternalLink className="h-3.5 w-3.5" /> DNS
            </Link>
          </Button>
          {domain.dnsStatus === 'verified' ? (
            <Button size="sm" variant="outline" disabled>
              <Check className="h-3.5 w-3.5" /> Verified
            </Button>
          ) : (
            <Button size="sm" variant="outline" onClick={onVerifyDev} disabled={verifying}>
              {verifying ? 'Verifying...' : 'Verify dev'}
            </Button>
          )}
        </div>
      </div>

      {addresses.length === 0 ? (
        <div className="mt-3 rounded-md border border-dashed border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-500">
          No outbound addresses on this domain yet.
        </div>
      ) : (
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {addresses.map((address) => (
            <div
              key={address.id}
              className="min-w-0 rounded-md border border-slate-200 bg-slate-50 px-3 py-2"
            >
              <div className="flex min-w-0 items-center gap-2">
                <p className="truncate text-sm font-medium text-slate-800">{address.fullAddress}</p>
                {address.isDefault ? <Badge variant="default">Default</Badge> : null}
              </div>
              <p className="mt-1 truncate text-xs text-slate-500">
                {address.label ?? 'No label'} ·{' '}
                {address.canSend === false ? 'receive only' : 'sendable'}
                {address.canReceive === false ? ' · no inbound' : ''}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SuppressionList({ rows }: { rows: Suppression[] }) {
  return (
    <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 px-4 py-3">
        <h2 className="text-sm font-semibold text-slate-900">Suppressions</h2>
      </div>
      {rows.length === 0 ? (
        <div className="px-4 py-8 text-center text-sm text-slate-500">
          No suppressed recipients.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[620px] text-left text-[13px]">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-medium uppercase tracking-wide text-slate-500">
                <th className="px-3 py-2">Target</th>
                <th className="px-3 py-2">Reason</th>
                <th className="px-3 py-2">Channel</th>
                <th className="px-3 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => {
                const target = row.target ?? row.emailAddress ?? 'unknown';
                const channel = row.channel ?? row.channelKind ?? 'email';
                const status = row.status ?? (row.deletedAt ? 'inactive' : 'active');
                return (
                  <tr
                    key={row.id}
                    className={cn(index !== rows.length - 1 && 'border-b border-slate-100')}
                  >
                    <td className="max-w-[240px] truncate px-3 py-2.5 font-medium text-slate-800">
                      {target}
                    </td>
                    <td className="px-3 py-2.5 text-slate-600">{row.reason}</td>
                    <td className="px-3 py-2.5 text-slate-600">{channel}</td>
                    <td className="px-3 py-2.5">
                      <Badge variant={status === 'active' ? 'danger' : 'muted'}>{status}</Badge>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function mergeAddresses(primary: EmailAddress[], secondary: EmailAddress[]): EmailAddress[] {
  const byID = new Map<string, EmailAddress>();
  for (const address of [...primary, ...secondary]) {
    byID.set(address.id, address);
  }
  return [...byID.values()].sort((a, b) => {
    if (a.isDefault && !b.isDefault) return -1;
    if (!a.isDefault && b.isDefault) return 1;
    return a.fullAddress.localeCompare(b.fullAddress);
  });
}

function domainStatusVariant(
  status: Domain['dnsStatus'],
): 'default' | 'success' | 'warning' | 'danger' {
  switch (status) {
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

async function postJSON(paths: string[], body: Record<string, unknown>): Promise<void> {
  let lastError = 'request failed';
  for (const path of paths) {
    const res = await fetch(`${apiBase}${path}`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.ok) return;
    const payload = (await res.json().catch(() => null)) as { error?: string } | null;
    lastError = payload?.error ?? `${res.status}`;
    if (res.status !== 404) break;
  }
  throw new Error(lastError);
}

async function postEmpty(paths: string[]): Promise<void> {
  let lastError = 'request failed';
  for (const path of paths) {
    const res = await fetch(`${apiBase}${path}`, {
      method: 'POST',
      credentials: 'include',
    });
    if (res.ok) return;
    const payload = (await res.json().catch(() => null)) as { error?: string } | null;
    lastError = payload?.error ?? `${res.status}`;
    if (res.status !== 404) break;
  }
  throw new Error(lastError);
}
