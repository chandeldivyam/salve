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
import {
  AlertCircle,
  ArrowRight,
  Check,
  ChevronDown,
  ExternalLink,
  Inbox,
  Plus,
  Reply,
  Route as RouteIcon,
  Signature,
  UserRound,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

const apiBase = (import.meta.env.VITE_API_URL as string | undefined) ?? '';
const inboundEmailDomain =
  (import.meta.env.VITE_INBOUND_EMAIL_DOMAIN as string | undefined) ?? 'in.usesalve.com';
const replyEmailDomain =
  (import.meta.env.VITE_REPLY_EMAIL_DOMAIN as string | undefined) ?? 'reply.usesalve.com';

export const Route = createFileRoute('/app/settings/channels/email')({
  component: EmailChannelSettings,
});

type Phase3EmailQueries = typeof queries & {
  emailAddresses?: () => ReturnType<typeof queries.sendingDomains>;
  inboundRoutingRules?: () => ReturnType<typeof queries.sendingDomains>;
  receivableEmailAddresses?: () => ReturnType<typeof queries.sendingDomains>;
  sendableEmailAddresses: () => ReturnType<typeof queries.sendingDomains>;
  suppressions: () => ReturnType<typeof queries.sendingDomains>;
};

type TicketPriority = 'low' | 'normal' | 'high' | 'urgent';

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
  workspaceID?: string | null;
  workspaceId?: string | null;
  fullAddress: string;
  label?: string | null;
  localPart?: string | null;
  channelID?: string | null;
  channelId?: string | null;
  sendingDomainID?: string | null;
  sendingDomainId?: string | null;
  sendingDomain?: {
    id?: string | null;
    domain?: string | null;
    dnsStatus?: string | null;
  } | null;
  channel?: {
    id?: string | null;
    workspaceID?: string | null;
    workspaceId?: string | null;
    name?: string | null;
    config?: Record<string, unknown> | null;
  } | null;
  canSend?: boolean | null;
  canReceive?: boolean | null;
  isDefault?: boolean | null;
  defaultTeamID?: string | null;
  defaultTeamId?: string | null;
  signatureHTML?: string | null;
  signatureHtml?: string | null;
  signature?: string | null;
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

interface WorkspaceMember {
  id: string;
  userId?: string | null;
  userID?: string | null;
  user?: { name?: string | null; email?: string | null } | null;
}

interface InboundRoutingRule {
  id: string;
  channelID?: string | null;
  channelId?: string | null;
  emailAddressID?: string | null;
  emailAddressId?: string | null;
  addressID?: string | null;
  addressId?: string | null;
  emailAddress?: { id?: string | null; fullAddress?: string | null } | null;
  destinationAddress?: string | null;
  setPriority?: TicketPriority | null;
  defaultPriority?: TicketPriority | null;
  assignTeamID?: string | null;
  assignTeamId?: string | null;
  defaultTeamID?: string | null;
  defaultTeamId?: string | null;
  assignAgentID?: string | null;
  assignAgentId?: string | null;
  priority?: number | null;
  enabled?: boolean | null;
  isActive?: boolean | null;
  action?: {
    assignTeamID?: string | null;
    assignTeamId?: string | null;
    assignAgentID?: string | null;
    assignAgentId?: string | null;
    setPriority?: TicketPriority | null;
    priority?: TicketPriority | null;
  } | null;
}

const TICKET_PRIORITIES: TicketPriority[] = ['normal', 'high', 'urgent', 'low'];

function EmailChannelSettings() {
  const emailQueries = queries as unknown as Phase3EmailQueries;
  const hasAllAddressQuery = typeof emailQueries.emailAddresses === 'function';
  const hasReceivableAddressQuery = typeof emailQueries.receivableEmailAddresses === 'function';
  const hasRoutingRulesQuery = typeof emailQueries.inboundRoutingRules === 'function';
  const addressQuery =
    hasReceivableAddressQuery && emailQueries.receivableEmailAddresses
      ? emailQueries.receivableEmailAddresses()
      : hasAllAddressQuery && emailQueries.emailAddresses
        ? emailQueries.emailAddresses()
        : emailQueries.sendableEmailAddresses();
  const routingRulesQuery =
    hasRoutingRulesQuery && emailQueries.inboundRoutingRules
      ? emailQueries.inboundRoutingRules()
      : queries.sendingDomains();
  const [domains] = useQuery(queries.sendingDomains()) as unknown as [Domain[], { type: string }];
  const [addresses] = useQuery(addressQuery as never) as unknown as [
    EmailAddress[],
    { type: string },
  ];
  const [routingRuleRows] = useQuery(routingRulesQuery as never) as unknown as [
    InboundRoutingRule[],
    { type: string },
  ];
  const [suppressions] = useQuery(emailQueries.suppressions()) as unknown as [
    Suppression[],
    { type: string },
  ];
  const [members] = useQuery(queries.workspaceMembers()) as unknown as [
    WorkspaceMember[],
    { type: string },
  ];

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

  const routingRulesByAddressID = useMemo(() => {
    if (!hasRoutingRulesQuery) return new Map<string, InboundRoutingRule[]>();
    return groupRoutingRulesByAddress(routingRuleRows);
  }, [hasRoutingRulesQuery, routingRuleRows]);

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
            Manage outbound domains, receiving addresses, routing, and suppressed recipients for
            this workspace.
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

      <ForwardingHintBar addressCount={addresses.length} />

      <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-900">Domains and addresses</h2>
        </div>
        {domains.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-slate-500">
            Add a domain before creating send or receive addresses.
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {domains.map((domain) => {
              const domainAddresses = mergeAddresses(
                addressesByDomain.get(domain.id) ?? [],
                domain.emailAddresses ?? domain.addresses ?? [],
              );
              return (
                <DomainRow
                  key={domain.id}
                  domain={domain}
                  addresses={domainAddresses}
                  members={members}
                  routingRulesAvailable={hasRoutingRulesQuery}
                  routingRulesByAddressID={routingRulesByAddressID}
                />
              );
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

function ForwardingHintBar({ addressCount }: { addressCount: number }) {
  return (
    <section className="grid gap-2 rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm sm:grid-cols-2">
      <div className="flex min-w-0 items-center gap-2 text-xs text-slate-600">
        <Inbox className="h-4 w-4 shrink-0 text-brand-600" />
        <span className="truncate">
          {addressCount} configured {addressCount === 1 ? 'address' : 'addresses'} forward into{' '}
          <code className="font-mono text-[11px] text-slate-800">
            inbound+ws_&lt;workspace&gt;@{inboundEmailDomain}
          </code>
        </span>
      </div>
      <div className="flex min-w-0 items-center gap-2 text-xs text-slate-600">
        <Reply className="h-4 w-4 shrink-0 text-brand-600" />
        <span className="truncate">
          Thread replies route through{' '}
          <code className="font-mono text-[11px] text-slate-800">*@{replyEmailDomain}</code>
        </span>
      </div>
    </section>
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
  const [signatureHTML, setSignatureHTML] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(ev: React.FormEvent) {
    ev.preventDefault();
    if (!selectedDomainID) return;
    setError(null);
    setSubmitting(true);
    try {
      await postJSON(
        [
          '/api/settings/channels/email/addresses',
          `/api/settings/email/domains/${selectedDomainID}/addresses`,
        ],
        {
          sendingDomainID: selectedDomainID,
          localPart: localPart.trim(),
          label: label.trim() || undefined,
          canSend: true,
          canReceive: true,
          signature: signatureHTML.trim() || undefined,
        },
      );
      setLocalPart('support');
      setLabel('Support');
      setSignatureHTML('');
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
        <div className="min-w-0 lg:col-span-3">
          <label
            className="block text-xs font-medium text-slate-600"
            htmlFor="signature-override-input"
          >
            Signature override
          </label>
          <textarea
            id="signature-override-input"
            placeholder="<p>Support team</p>"
            value={signatureHTML}
            onChange={(e) => setSignatureHTML(e.target.value)}
            disabled={submitting}
            className="mt-1 min-h-20 w-full resize-y rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
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
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
          <span className="truncate">
            Address: {localPart.trim() || 'local'}@{selectedDomain.domain}
          </span>
          <span className="truncate">
            Forwarding:{' '}
            <code className="font-mono text-[11px]">
              inbound+ws_&lt;workspace&gt;@{inboundEmailDomain}
            </code>
          </span>
        </div>
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

function DomainRow({
  domain,
  addresses,
  members,
  routingRulesAvailable,
  routingRulesByAddressID,
}: {
  domain: Domain;
  addresses: EmailAddress[];
  members: WorkspaceMember[];
  routingRulesAvailable: boolean;
  routingRulesByAddressID: Map<string, InboundRoutingRule[]>;
}) {
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
        <div className="mt-3 border-y border-dashed border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-500">
          No send or receive addresses on this domain yet.
        </div>
      ) : (
        <div className="mt-3 divide-y divide-slate-100 border-y border-slate-100">
          {addresses.map((address) => (
            <AddressRow
              key={address.id}
              address={address}
              members={members}
              routingRules={routingRulesByAddressID.get(address.id) ?? []}
              routingRulesAvailable={routingRulesAvailable}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function AddressRow({
  address,
  members,
  routingRules,
  routingRulesAvailable,
}: {
  address: EmailAddress;
  members: WorkspaceMember[];
  routingRules: InboundRoutingRule[];
  routingRulesAvailable: boolean;
}) {
  const [showRoutingForm, setShowRoutingForm] = useState(false);
  const signatureOverride = getAddressSignature(address);

  return (
    <div className="py-3">
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_auto] lg:items-start">
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <p className="break-all text-sm font-medium text-slate-800">{address.fullAddress}</p>
            {address.isDefault ? <Badge variant="default">Default</Badge> : null}
          </div>
          <div className="mt-1 flex flex-wrap gap-1.5">
            <Badge variant={address.canSend === false ? 'muted' : 'success'}>
              {address.canSend === false ? 'receive only' : 'send'}
            </Badge>
            <Badge variant={address.canReceive === false ? 'muted' : 'default'}>
              {address.canReceive === false ? 'no inbound' : 'receive'}
            </Badge>
            {address.label ? <Badge variant="muted">{address.label}</Badge> : null}
          </div>
        </div>

        <div className="min-w-0 text-xs text-slate-500">
          <p className="flex items-center gap-1.5 font-medium text-slate-700">
            <Inbox className="h-3.5 w-3.5 text-brand-600" />
            Forwarding
          </p>
          <div className="mt-1 flex min-w-0 items-center gap-1.5">
            <span className="truncate">{address.fullAddress}</span>
            <ArrowRight className="h-3 w-3 shrink-0 text-slate-300" />
            <code className="truncate font-mono text-[11px] text-slate-700">
              {inboundForwardingTarget(address)}
            </code>
          </div>
          <p className="mt-0.5 truncate">
            Replies: <code className="font-mono text-[11px]">*@{replyEmailDomain}</code>
          </p>
        </div>

        <div className="min-w-0 text-xs text-slate-500">
          <p className="flex items-center gap-1.5 font-medium text-slate-700">
            <RouteIcon className="h-3.5 w-3.5 text-brand-600" />
            Routing
          </p>
          <RoutingRuleSummary
            address={address}
            rules={routingRules}
            routingRulesAvailable={routingRulesAvailable}
          />
        </div>

        <div className="flex justify-start lg:justify-end">
          <Button
            size="sm"
            variant={showRoutingForm ? 'default' : 'outline'}
            type="button"
            onClick={() => setShowRoutingForm((show) => !show)}
          >
            <RouteIcon className="h-3.5 w-3.5" />
            Rule
          </Button>
        </div>
      </div>

      <div className="mt-2 flex min-w-0 items-start gap-1.5 text-xs text-slate-500">
        <Signature className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
        {signatureOverride ? (
          <span className="line-clamp-2 min-w-0 break-words">
            Signature override: {stripTags(signatureOverride)}
          </span>
        ) : (
          <span>No address signature override</span>
        )}
      </div>

      {showRoutingForm ? (
        <RoutingRuleForm
          address={address}
          members={members}
          onCancel={() => setShowRoutingForm(false)}
        />
      ) : null}
    </div>
  );
}

function RoutingRuleSummary({
  address,
  rules,
  routingRulesAvailable,
}: {
  address: EmailAddress;
  rules: InboundRoutingRule[];
  routingRulesAvailable: boolean;
}) {
  if (!routingRulesAvailable) {
    return (
      <p className="mt-1 flex items-center gap-1.5 text-amber-700">
        <AlertCircle className="h-3.5 w-3.5 shrink-0" />
        Routing query pending
      </p>
    );
  }

  if (rules.length === 0) {
    const teamID = address.defaultTeamID ?? address.defaultTeamId;
    return (
      <p className="mt-1 truncate">
        {teamID ? `Default team ${shortID(teamID)}` : 'No routing rule'}
      </p>
    );
  }

  return (
    <div className="mt-1 space-y-1">
      {rules.slice(0, 2).map((rule) => {
        const priority = routingRulePriority(rule);
        const teamID = routingRuleTeamID(rule);
        const agentID = routingRuleAgentID(rule);
        return (
          <p key={rule.id} className="truncate">
            <span className="font-medium text-slate-700">{address.fullAddress}</span> {'->'}{' '}
            {priority ?? 'normal'}
            {teamID ? ` / team ${shortID(teamID)}` : ' / team default'}
            {agentID ? ` / agent ${shortID(agentID)}` : ''}
          </p>
        );
      })}
      {rules.length > 2 ? <p className="text-slate-400">+{rules.length - 2} more</p> : null}
    </div>
  );
}

function RoutingRuleForm({
  address,
  members,
  onCancel,
}: {
  address: EmailAddress;
  members: WorkspaceMember[];
  onCancel: () => void;
}) {
  const [setPriority, setSetPriority] = useState<TicketPriority>('normal');
  const [assignTeamID, setAssignTeamID] = useState(
    address.defaultTeamID ?? address.defaultTeamId ?? '',
  );
  const [assignAgentID, setAssignAgentID] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(ev: React.FormEvent) {
    ev.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await postJSON(
        ['/api/settings/channels/email/routing-rules', '/api/settings/email/routing-rules'],
        {
          emailAddressID: address.id,
          channelID: address.channelID ?? address.channelId,
          destinationAddress: address.fullAddress,
          setPriority,
          assignTeamID: assignTeamID.trim() || undefined,
          assignAgentID: assignAgentID || undefined,
          enabled: true,
        },
      );
      onCancel();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form noValidate onSubmit={onSubmit} className="mt-3 border-t border-slate-100 pt-3">
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.8fr)_minmax(0,1fr)_minmax(0,1fr)_auto] lg:items-end">
        <div className="min-w-0">
          <p className="mb-1 text-xs font-medium text-slate-600">Destination</p>
          <div className="flex h-9 min-w-0 items-center rounded-md border border-slate-200 bg-slate-50 px-3 text-sm text-slate-700">
            <span className="truncate">{address.fullAddress}</span>
          </div>
        </div>
        <div className="min-w-0">
          <p className="mb-1 text-xs font-medium text-slate-600">Priority</p>
          <PriorityPicker value={setPriority} onChange={setSetPriority} />
        </div>
        <div className="min-w-0">
          <label
            className="block text-xs font-medium text-slate-600"
            htmlFor={`team-${address.id}`}
          >
            Default team
          </label>
          <Input
            id={`team-${address.id}`}
            value={assignTeamID}
            onChange={(e) => setAssignTeamID(e.target.value)}
            placeholder="team id"
            disabled={submitting}
            className="mt-1 h-9 text-sm"
          />
        </div>
        <div className="min-w-0">
          <p className="mb-1 text-xs font-medium text-slate-600">Default agent</p>
          <AgentPicker members={members} value={assignAgentID} onChange={setAssignAgentID} />
        </div>
        <div className="flex justify-end gap-2">
          <Button
            size="sm"
            type="button"
            variant="outline"
            onClick={onCancel}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button size="sm" type="submit" disabled={submitting}>
            {submitting ? 'Saving...' : 'Save rule'}
          </Button>
        </div>
      </div>
      {error ? <p className="mt-2 text-xs text-red-600">{error}</p> : null}
    </form>
  );
}

function PriorityPicker({
  value,
  onChange,
}: {
  value: TicketPriority;
  onChange: (value: TicketPriority) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="inline-flex h-9 w-full min-w-0 items-center justify-between gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-700 hover:bg-slate-50"
        >
          <span className="truncate capitalize">{value}</span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-slate-400" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-[min(220px,calc(100vw-2rem))]">
        <DropdownMenuLabel>Ticket priority</DropdownMenuLabel>
        {TICKET_PRIORITIES.map((priority) => (
          <DropdownMenuItem key={priority} onSelect={() => onChange(priority)}>
            <span className="grid h-4 w-4 place-items-center">
              {value === priority ? <Check className="h-3.5 w-3.5" /> : null}
            </span>
            <span className="capitalize">{priority}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function AgentPicker({
  members,
  value,
  onChange,
}: {
  members: WorkspaceMember[];
  value: string;
  onChange: (id: string) => void;
}) {
  const selected = members.find((member) => memberUserID(member) === value) ?? null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="inline-flex h-9 w-full min-w-0 items-center justify-between gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-700 hover:bg-slate-50"
        >
          <span className="truncate">
            {selected ? (selected.user?.name ?? selected.user?.email ?? value) : 'Any agent'}
          </span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-slate-400" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-[min(300px,calc(100vw-2rem))]">
        <DropdownMenuLabel>Default agent</DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => onChange('')}>
          <span className="grid h-4 w-4 place-items-center">
            {!value ? <Check className="h-3.5 w-3.5" /> : null}
          </span>
          <UserRound className="h-3.5 w-3.5 text-slate-400" />
          Any agent
        </DropdownMenuItem>
        {members.map((member) => {
          const id = memberUserID(member);
          if (!id) return null;
          return (
            <DropdownMenuItem key={member.id} onSelect={() => onChange(id)}>
              <span className="grid h-4 w-4 place-items-center">
                {value === id ? <Check className="h-3.5 w-3.5" /> : null}
              </span>
              <UserRound className="h-3.5 w-3.5 text-slate-400" />
              <span className="truncate">{member.user?.name ?? member.user?.email ?? id}</span>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
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

function groupRoutingRulesByAddress(rows: InboundRoutingRule[]): Map<string, InboundRoutingRule[]> {
  const grouped = new Map<string, InboundRoutingRule[]>();
  for (const row of rows) {
    const addressID = routingRuleAddressID(row);
    if (!addressID) continue;
    grouped.set(addressID, [...(grouped.get(addressID) ?? []), row]);
  }
  for (const [addressID, rules] of grouped) {
    grouped.set(
      addressID,
      [...rules].sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100)),
    );
  }
  return grouped;
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

function routingRuleAddressID(rule: InboundRoutingRule): string | null {
  return (
    rule.emailAddressID ??
    rule.emailAddressId ??
    rule.addressID ??
    rule.addressId ??
    rule.emailAddress?.id ??
    null
  );
}

function routingRulePriority(rule: InboundRoutingRule): TicketPriority | null {
  return (
    rule.setPriority ??
    rule.defaultPriority ??
    rule.action?.setPriority ??
    rule.action?.priority ??
    null
  );
}

function routingRuleTeamID(rule: InboundRoutingRule): string | null {
  return (
    rule.assignTeamID ??
    rule.assignTeamId ??
    rule.defaultTeamID ??
    rule.defaultTeamId ??
    rule.action?.assignTeamID ??
    rule.action?.assignTeamId ??
    null
  );
}

function routingRuleAgentID(rule: InboundRoutingRule): string | null {
  return (
    rule.assignAgentID ??
    rule.assignAgentId ??
    rule.action?.assignAgentID ??
    rule.action?.assignAgentId ??
    null
  );
}

function getAddressSignature(address: EmailAddress): string | null {
  return address.signatureHTML ?? address.signatureHtml ?? address.signature ?? null;
}

function inboundForwardingTarget(address: EmailAddress): string {
  const config = address.channel?.config;
  const configured =
    stringFromRecord(config, 'forwardingAddress') ??
    stringFromRecord(config, 'inboundForwardingAddress') ??
    stringFromRecord(config, 'inboundAddress');
  const workspaceID =
    address.workspaceID ??
    address.workspaceId ??
    address.channel?.workspaceID ??
    address.channel?.workspaceId;
  return (
    configured ??
    (workspaceID
      ? `inbound+ws_${workspaceID}@${inboundEmailDomain}`
      : `inbound+ws_<workspace>@${inboundEmailDomain}`)
  );
}

function stringFromRecord(value: Record<string, unknown> | null | undefined, key: string) {
  const raw = value?.[key];
  return typeof raw === 'string' && raw.trim() ? raw : null;
}

function stripTags(value: string): string {
  return value
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function memberUserID(member: WorkspaceMember): string | null {
  return member.userId ?? member.userID ?? null;
}

function shortID(value: string): string {
  return value.length <= 10 ? value : `${value.slice(0, 8)}...`;
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
