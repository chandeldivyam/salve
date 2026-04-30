// /app/settings/channels/email — Overview tab. Glance summary of the four
// other tabs plus the inbound forwarding + reply addresses, both rendered
// with CopyValue.

import { Badge, Button, Card, CardContent, CardHeader, CopyValue } from '@opendesk/ui';
import { queries } from '@opendesk/zero-schema';
import { useQuery } from '@rocicorp/zero/react';
import { createFileRoute, Link, useRouteContext } from '@tanstack/react-router';
import { ArrowRight, Inbox, Mail, Reply, Route as RouteIcon, ShieldOff } from 'lucide-react';
import { replyEmailDomain, workspaceForwardingAddress } from '@/components/email-settings/types';
import { RouteErrorFeedback, RoutePendingFeedback } from '@/components/route-feedback';
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
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 py-6 sm:px-8">
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard
          icon={Mail}
          label="Domains"
          to="/app/settings/channels/email/domains"
          primary={`${domains.length}`}
          secondary={
            domains.length === 0
              ? 'No domains yet'
              : `${verifiedDomains} verified · ${domains.length - verifiedDomains} pending`
          }
        />
        <SummaryCard
          icon={Inbox}
          label="Addresses"
          to="/app/settings/channels/email/addresses"
          primary={`${addresses.length}`}
          secondary={
            addresses.length === 0 ? 'No addresses yet' : `${sendable} send · ${receivable} receive`
          }
        />
        <SummaryCard
          icon={RouteIcon}
          label="Routing rules"
          to="/app/settings/channels/email/routing"
          primary={`${routingRules.length}`}
          secondary={routingRules.length === 0 ? 'No rules yet' : `${enabledRules} enabled`}
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

      <Card>
        <CardHeader className="space-y-1">
          <p className="text-sm font-semibold text-foreground">Forwarding</p>
          <p className="text-xs text-muted-foreground">
            Point your customer-facing inbox at these addresses so Salve sees inbound mail and can
            thread replies.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-col gap-1.5">
            <span className="inline-flex items-center gap-2 text-xs font-medium text-foreground">
              <Inbox className="h-3.5 w-3.5 text-brand-600" />
              Inbound forwarding address
            </span>
            <CopyValue
              value={forwardingAddress}
              label="Forwarding address"
              variant="block"
              onCopy={() => copied('Forwarding address')}
            />
            <p className="text-[11px] text-muted-foreground">
              Forward your <code className="font-mono">support@</code>,{' '}
              <code className="font-mono">help@</code>, or other inboxes to this address. Each
              configured address you add still routes through this same workspace endpoint.
            </p>
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="inline-flex items-center gap-2 text-xs font-medium text-foreground">
              <Reply className="h-3.5 w-3.5 text-brand-600" />
              Reply-thread template
            </span>
            <CopyValue
              value={replyTemplate}
              label="Reply template"
              variant="block"
              onCopy={() => copied('Reply template')}
            />
            <p className="text-[11px] text-muted-foreground">
              Salve substitutes <code className="font-mono">&lt;ticket-id&gt;</code> for an
              HMAC-signed token at send time. Customer replies route back to the right ticket
              automatically.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
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
  icon: typeof Mail;
  label: string;
  to: string;
  primary: string;
  secondary: string;
  tone?: 'default' | 'warning';
}) {
  return (
    <Card className="flex h-full flex-col">
      <CardContent className="flex flex-1 flex-col gap-3 p-4">
        <div className="flex items-center justify-between">
          <span className="inline-flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <Icon className="h-3.5 w-3.5" />
            {label}
          </span>
          {tone === 'warning' ? <Badge variant="warning">Review</Badge> : null}
        </div>
        <p className="text-2xl font-semibold tabular-nums text-foreground">{primary}</p>
        <p className="text-xs text-muted-foreground">{secondary}</p>
        <div className="mt-auto pt-2">
          <Button asChild size="sm" variant="outline" className="w-full">
            <Link to={to}>
              Manage
              <ArrowRight className="h-3 w-3" />
            </Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
