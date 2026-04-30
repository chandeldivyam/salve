// /app/settings/channels/email/routing — list of inbound routing rules,
// grouped by destination address, with an inline RoutingRuleForm for
// adding new rules. Slice 3:
//   - The team-id field is gone; the form surfaces a help line about the
//     forthcoming team-picker.

import { Badge, Button, Card, CardContent } from '@opendesk/ui';
import { queries } from '@opendesk/zero-schema';
import { useQuery } from '@rocicorp/zero/react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { ArrowRight, Plus, Route as RouteIcon } from 'lucide-react';
import { useState } from 'react';
import { EmptyState } from '@/components/email-settings/empty-state';
import { RoutingRuleForm } from '@/components/email-settings/routing-rule-form';
import {
  routingRuleAddressID,
  routingRuleAgentID,
  routingRulePriority,
  shortID,
} from '@/components/email-settings/types';
import { RouteErrorFeedback, RoutePendingFeedback } from '@/components/route-feedback';
import { CACHE_NAV } from '@/lib/zero-cache';

interface RoutingSearch {
  action?: 'add';
}

export const Route = createFileRoute('/app/settings/channels/email/routing')({
  component: RoutingTab,
  pendingComponent: RoutePendingFeedback,
  errorComponent: RouteErrorFeedback,
  validateSearch: (search: Record<string, unknown>): RoutingSearch => {
    return search.action === 'add' ? { action: 'add' } : {};
  },
});

function RoutingTab() {
  const [addresses] = useQuery(queries.receivableEmailAddresses(), CACHE_NAV);
  const [rules] = useQuery(queries.inboundRoutingRules(), CACHE_NAV);
  const [members] = useQuery(queries.workspaceMembers(), CACHE_NAV);

  const [activeAddressID, setActiveAddressID] = useState<string | null>(null);

  const noAddresses = addresses.length === 0;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 py-6 sm:px-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-foreground">Routing</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Decide priority and default assignee for each receive address.
          </p>
        </div>
      </div>

      {noAddresses ? (
        <EmptyState
          icon={RouteIcon}
          title="No routing rules yet"
          description="By default all inbound goes to the workspace inbox. Add a receive address first, then configure how its messages are handled."
          action={
            <Button asChild size="sm">
              <Link to="/app/settings/channels/email/addresses">
                Manage addresses <ArrowRight className="h-3 w-3" />
              </Link>
            </Button>
          }
        />
      ) : (
        <div className="grid gap-4">
          {addresses.map((address) => {
            const addressRules = rules.filter((r) => routingRuleAddressID(r) === address.id);
            const isActive = activeAddressID === address.id;
            return (
              <Card key={address.id} className="overflow-hidden">
                <CardContent className="p-4">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-foreground">
                        {address.fullAddress}
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {addressRules.length === 0
                          ? 'No routing rule — inbox default applies.'
                          : `${addressRules.length} rule${addressRules.length === 1 ? '' : 's'}`}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant={isActive ? 'default' : 'outline'}
                      onClick={() => setActiveAddressID(isActive ? null : address.id)}
                    >
                      <Plus className="h-3.5 w-3.5" />
                      {isActive ? 'Close form' : 'Add rule'}
                    </Button>
                  </div>

                  {addressRules.length > 0 ? (
                    <ul className="mt-3 space-y-1 text-xs">
                      {addressRules.map((rule) => (
                        <li
                          key={rule.id}
                          className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-surface-muted px-2 py-1.5"
                        >
                          <Badge variant="muted">{routingRulePriority(rule) ?? 'normal'}</Badge>
                          {(() => {
                            const agentID = routingRuleAgentID(rule);
                            return agentID ? (
                              <span className="text-muted-foreground">
                                Assign to{' '}
                                <span className="text-foreground">{shortID(agentID)}</span>
                              </span>
                            ) : (
                              <span className="text-muted-foreground">Any agent</span>
                            );
                          })()}
                          <Badge variant={rule.enabled === false ? 'muted' : 'success'}>
                            {rule.enabled === false ? 'disabled' : 'enabled'}
                          </Badge>
                        </li>
                      ))}
                    </ul>
                  ) : null}

                  {isActive ? (
                    <RoutingRuleForm
                      address={address}
                      members={members}
                      onCancel={() => setActiveAddressID(null)}
                    />
                  ) : null}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
