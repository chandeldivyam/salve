// /app/settings/channels/email — Overview. Glance summary of the four
// sub-routes plus the inbound forwarding + reply addresses, both rendered
// with CopyValue.

import { Badge, CopyValue } from '@opendesk/ui';
import { queries } from '@opendesk/zero-schema';
import { useQuery } from '@rocicorp/zero/react';
import { createFileRoute, Link, useRouteContext } from '@tanstack/react-router';
import type { LucideIcon } from 'lucide-react';
import { ArrowRight, Inbox, Mail, Reply, Route as RouteIcon, ShieldOff } from 'lucide-react';
import { replyEmailDomain, workspaceForwardingAddress } from '@/components/email-settings/types';
import { RouteErrorFeedback, RoutePendingFeedback } from '@/components/route-feedback';
import { FormSection, SettingsBody, SettingsHeader } from '@/components/settings';
import { showSuccess } from '@/lib/feedback';
import type { SessionData } from '@/lib/session-loader';
import { CACHE_NAV } from '@/lib/zero-cache';

export const Route = createFileRoute('/app/settings/channels/email/')({
  component: OverviewTab,
  pendingComponent: RoutePendingFeedback,
  errorComponent: RouteErrorFeedback,
});

function OverviewTab() {
  const { session } = useRouteContext({ from: '/app' }) as { session: SessionData };
  const workspaceID = session.session.activeOrganizationId ?? null;

  const [domains] = useQuery(queries.sendingDomains(), CACHE_NAV);
  const [addresses] = useQuery(queries.sendableEmailAddresses(), CACHE_NAV);
  const [routingRules] = useQuery(queries.inboundRoutingRules(), CACHE_NAV);
  const [suppressions] = useQuery(queries.suppressions(), CACHE_NAV);

  const verifiedDomains = domains.filter((d) => d.dnsStatus === 'verified').length;
  const sendable = addresses.filter((a) => a.canSend !== false).length;
  const receivable = addresses.filter((a) => a.canReceive !== false).length;
  const enabledRules = routingRules.filter((r) => r.enabled !== false).length;
  const suppressionCount = suppressions.length;

  const forwardingAddress = workspaceForwardingAddress(workspaceID);
  const replyTemplate = `reply+t_<ticket-id>@${replyEmailDomain}`;

  function copied(label: string) {
    showSuccess('Copied', `${label} copied to clipboard.`);
  }

  return (
    <>
      <SettingsHeader
        title="Email channel"
        description="Manage outbound domains, receiving addresses, routing, and suppressed recipients for this workspace."
      />
      <SettingsBody maxWidth="wide">
        <div className="flex flex-col gap-8">
          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <SummaryCard
              icon={Mail}
              label="Domains"
              to="/app/settings/channels/email/domains"
              primary={`${domains.length}`}
              secondary={
                domains.length === 0
                  ? 'No domains'
                  : `${verifiedDomains} verified · ${domains.length - verifiedDomains} pending`
              }
            />
            <SummaryCard
              icon={Inbox}
              label="Addresses"
              to="/app/settings/channels/email/addresses"
              primary={`${addresses.length}`}
              secondary={
                addresses.length === 0 ? 'No addresses' : `${sendable} send · ${receivable} receive`
              }
            />
            <SummaryCard
              icon={RouteIcon}
              label="Routing rules"
              to="/app/settings/channels/email/routing"
              primary={`${routingRules.length}`}
              secondary={routingRules.length === 0 ? 'No rules' : `${enabledRules} enabled`}
            />
            <SummaryCard
              icon={ShieldOff}
              label="Suppressions"
              to="/app/settings/channels/email/suppressions"
              primary={`${suppressionCount}`}
              secondary={
                suppressionCount === 0 ? 'No suppressed recipients' : 'Recipients we will not email'
              }
              tone={suppressionCount > 0 ? 'warning' : 'default'}
            />
          </section>

          <FormSection
            title="Forwarding"
            description="Point your customer-facing inbox at these addresses so Salve sees inbound mail and can thread replies."
          >
            <div className="flex flex-col gap-1.5">
              <span className="inline-flex items-center gap-2 text-[12px] font-medium text-fg-primary">
                <Inbox className="h-3.5 w-3.5 text-fg-tertiary" />
                Inbound forwarding address
              </span>
              <CopyValue
                value={forwardingAddress}
                label="Forwarding address"
                variant="block"
                onCopy={() => copied('Forwarding address')}
              />
              <p className="text-[11px] text-fg-tertiary">
                Forward your <code className="font-mono">support@</code>,{' '}
                <code className="font-mono">help@</code>, or other inboxes to this address. Each
                configured address you add still routes through this same workspace endpoint.
              </p>
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="inline-flex items-center gap-2 text-[12px] font-medium text-fg-primary">
                <Reply className="h-3.5 w-3.5 text-fg-tertiary" />
                Reply-thread template
              </span>
              <CopyValue
                value={replyTemplate}
                label="Reply template"
                variant="block"
                onCopy={() => copied('Reply template')}
              />
              <p className="text-[11px] text-fg-tertiary">
                Salve substitutes <code className="font-mono">&lt;ticket-id&gt;</code> for an
                HMAC-signed token at send time. Customer replies route back to the right ticket
                automatically.
              </p>
            </div>
          </FormSection>
        </div>
      </SettingsBody>
    </>
  );
}

function SummaryCard({
  icon: Icon,
  label,
  to,
  primary,
  secondary,
  tone = 'default',
}: {
  icon: LucideIcon;
  label: string;
  to: string;
  primary: string;
  secondary: string;
  tone?: 'default' | 'warning';
}) {
  return (
    <Link
      to={to}
      className="flex flex-col gap-2 rounded-md bg-bg-elevated px-4 py-3 transition-colors hover:bg-bg-popover"
    >
      <div className="flex items-center justify-between">
        <span className="inline-flex items-center gap-2 text-[12px] font-medium text-fg-tertiary">
          <Icon className="h-3.5 w-3.5" />
          {label}
        </span>
        {tone === 'warning' ? <Badge variant="warning">Review</Badge> : null}
      </div>
      <p className="text-[24px] font-semibold tabular-nums tracking-[-0.018em] text-fg-primary">
        {primary}
      </p>
      <div className="flex items-center justify-between gap-2">
        <p className="text-[12px] text-fg-tertiary">{secondary}</p>
        <ArrowRight className="h-3 w-3 text-fg-quaternary" />
      </div>
    </Link>
  );
}
