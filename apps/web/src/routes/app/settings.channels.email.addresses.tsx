// /app/settings/channels/email/addresses — list of receivable + sendable
// addresses, grouped by sending domain. Slice 3:
//   - Signature is rendered as plain text via whitespace-pre-wrap; legacy
//     HTML signatures (saved before Slice 3) are stripped via
//     `signatureToPlainText`.
//   - Forwarding/inbound addresses use <CopyValue inline>.

import { useQuery } from '@rocicorp/zero/react';
import { Badge, Button, CopyValue } from '@salve/ui';
import { queries } from '@salve/zero-schema';
import { createFileRoute, Link, useRouteContext, useSearch } from '@tanstack/react-router';
import { ArrowRight, Inbox, Mail, Plus, Reply, Signature } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { AddAddressForm } from '@/components/email-settings/add-address-form';
import { EmptyState } from '@/components/email-settings/empty-state';
import {
  type EmailAddress,
  getAddressSignature,
  inboundForwardingTarget,
  replyEmailDomain,
  signatureToPlainText,
} from '@/components/email-settings/types';
import { RouteErrorFeedback, RoutePendingFeedback } from '@/components/route-feedback';
import { SettingsBody, SettingsHeader } from '@/components/settings';
import type { SessionData } from '@/lib/session-loader';
import { CACHE_NAV } from '@/lib/zero-cache';

interface AddressesSearch {
  action?: 'add';
}

export const Route = createFileRoute('/app/settings/channels/email/addresses')({
  component: AddressesTab,
  pendingComponent: RoutePendingFeedback,
  errorComponent: RouteErrorFeedback,
  validateSearch: (search: Record<string, unknown>): AddressesSearch => {
    return search.action === 'add' ? { action: 'add' } : {};
  },
});

function AddressesTab() {
  const { session } = useRouteContext({ from: '/app' }) as { session: SessionData };
  const workspaceID = session.session.activeOrganizationId ?? null;
  const search = useSearch({ from: Route.id }) as AddressesSearch;

  const [domains] = useQuery(queries.sendingDomains(), CACHE_NAV);
  const [addresses] = useQuery(queries.receivableEmailAddresses(), CACHE_NAV);

  const [showForm, setShowForm] = useState(false);
  const [selectedDomainID, setSelectedDomainID] = useState<string | null>(null);

  useEffect(() => {
    if (!domains.length) {
      setSelectedDomainID(null);
      return;
    }
    setSelectedDomainID((current) =>
      current && domains.some((d) => d.id === current) ? current : (domains[0]?.id ?? null),
    );
  }, [domains]);

  useEffect(() => {
    if (search.action === 'add' && domains.length > 0) setShowForm(true);
  }, [search.action, domains.length]);

  const selectedDomain = domains.find((d) => d.id === selectedDomainID) ?? null;

  const grouped = useMemo(() => {
    const map = new Map<string, EmailAddress[]>();
    for (const a of addresses) {
      const id = a.sendingDomainID ?? a.sendingDomain?.id ?? 'unknown';
      map.set(id, [...(map.get(id) ?? []), a]);
    }
    return map;
  }, [addresses]);

  const noDomains = domains.length === 0;
  const noAddresses = addresses.length === 0;

  return (
    <>
      <SettingsHeader
        title="Addresses"
        description="One address per local part (e.g. support@, comms@) on a verified domain."
        actions={
          !noAddresses ? (
            <Button
              size="sm"
              variant={showForm ? 'outline' : 'default'}
              onClick={() => setShowForm((s) => !s)}
              disabled={noDomains}
            >
              <Plus className="h-3.5 w-3.5" />
              {showForm ? 'Close form' : 'Add address'}
            </Button>
          ) : null
        }
      />
      <SettingsBody maxWidth="wide">
        <div className="flex flex-col gap-4">
          {showForm && !noDomains ? (
            <AddAddressForm
              domains={domains}
              selectedDomain={selectedDomain}
              selectedDomainID={selectedDomainID}
              workspaceID={workspaceID}
              onSelectDomain={setSelectedDomainID}
              onDone={() => setShowForm(false)}
            />
          ) : null}

          {noDomains ? (
            <EmptyState
              icon={Mail}
              title="Add a sending domain"
              description="You'll need a verified domain before configuring receive addresses."
              action={
                <Button asChild size="sm">
                  <Link to="/app/settings/channels/email/domains">
                    Go to domains <ArrowRight className="h-3 w-3" />
                  </Link>
                </Button>
              }
            />
          ) : noAddresses && !showForm ? (
            <EmptyState
              icon={Inbox}
              title="No addresses"
              description="Add support@ or comms@ so customers can reach you."
              action={
                <Button size="sm" onClick={() => setShowForm(true)}>
                  <Plus className="h-3.5 w-3.5" /> Add address
                </Button>
              }
            />
          ) : noAddresses ? null : (
            <div className="grid gap-4">
              {domains.map((d) => {
                const list = grouped.get(d.id) ?? [];
                if (list.length === 0) return null;
                return (
                  <section key={d.id} className="flex flex-col gap-1">
                    <div className="flex h-7 items-center justify-between gap-2 px-1 pb-1">
                      <p className="truncate text-[11px] font-semibold uppercase tracking-[0.06em] text-fg-quaternary">
                        {d.domain}
                      </p>
                      <Badge variant={d.dnsStatus === 'verified' ? 'success' : 'warning'}>
                        DNS: {d.dnsStatus}
                      </Badge>
                    </div>
                    <ul className="flex flex-col">
                      {list.map((a) => (
                        <li
                          key={a.id}
                          className="rounded-md transition-colors hover:bg-bg-elevated/30"
                        >
                          <AddressRow address={a} />
                        </li>
                      ))}
                    </ul>
                  </section>
                );
              })}
            </div>
          )}
        </div>
      </SettingsBody>
    </>
  );
}

function AddressRow({ address }: { address: EmailAddress }) {
  const signatureRaw = getAddressSignature(address);
  const signaturePlain = signatureRaw ? signatureToPlainText(signatureRaw) : null;
  return (
    <div className="grid gap-3 px-3 py-3 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)]">
      <div className="min-w-0">
        <p className="break-all text-[13px] font-medium text-fg-primary">{address.fullAddress}</p>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {address.isDefault ? <Badge variant="default">Default</Badge> : null}
          <Badge variant={address.canSend === false ? 'muted' : 'success'}>
            {address.canSend === false ? 'receive only' : 'send'}
          </Badge>
          <Badge variant={address.canReceive === false ? 'muted' : 'default'}>
            {address.canReceive === false ? 'no inbound' : 'receive'}
          </Badge>
          {address.label ? <Badge variant="muted">{address.label}</Badge> : null}
        </div>
      </div>
      <div className="min-w-0 text-[12px] text-fg-tertiary">
        <p className="flex items-center gap-1.5 text-[12px] font-medium text-fg-primary">
          <Inbox className="h-3.5 w-3.5 text-fg-tertiary" />
          Forwarding
        </p>
        <div className="mt-1.5">
          <CopyValue
            value={inboundForwardingTarget(address)}
            label={`Forwarding for ${address.fullAddress}`}
          />
        </div>
        <p className="mt-1.5 inline-flex items-center gap-1.5">
          <Reply className="h-3 w-3" /> Replies through{' '}
          <code className="font-mono text-[11px] text-fg-primary">*@{replyEmailDomain}</code>
        </p>
      </div>
      <div className="min-w-0 text-[12px] text-fg-tertiary">
        <p className="flex items-center gap-1.5 text-[12px] font-medium text-fg-primary">
          <Signature className="h-3.5 w-3.5 text-fg-tertiary" />
          Signature
        </p>
        {signaturePlain ? (
          <pre className="mt-1.5 max-h-24 overflow-auto whitespace-pre-wrap break-words text-[12px] text-fg-primary">
            {signaturePlain}
          </pre>
        ) : (
          <p className="mt-1.5">No address signature override</p>
        )}
      </div>
    </div>
  );
}
