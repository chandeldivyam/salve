// /app/settings/channels/email/routing — list of inbound routing rules,
// grouped by destination address, with an inline RoutingRuleForm for
// adding new rules. Variant C: flat sections, no card outlines.

import { useQuery } from '@rocicorp/zero/react';
import { Badge, Button } from '@salve/ui';
import { queries } from '@salve/zero-schema';
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
import { SettingsBody, SettingsHeader } from '@/components/settings';
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
    <>
      <SettingsHeader
        title="Routing"
        description="Decide priority and default assignee for each receive address."
      />
      <SettingsBody maxWidth="wide">
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
          <div className="flex flex-col gap-6">
            {addresses.map((address) => {
              const addressRules = rules.filter((r) => routingRuleAddressID(r) === address.id);
              const isActive = activeAddressID === address.id;
              return (
                <section key={address.id} className="flex flex-col gap-2">
                  <header className="flex h-7 items-center justify-between gap-2 px-1 pb-1">
                    <div className="min-w-0 flex items-baseline gap-2">
                      <p className="truncate text-[11px] font-semibold uppercase tracking-[0.06em] text-fg-quaternary">
                        {address.fullAddress}
                      </p>
                      <span className="tabular-nums text-[11px] text-fg-quaternary">
                        {addressRules.length}
                      </span>
                    </div>
                    <Button
                      size="sm"
                      variant={isActive ? 'outline' : 'default'}
                      onClick={() => setActiveAddressID(isActive ? null : address.id)}
                      className="h-7"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      {isActive ? 'Close form' : 'Add rule'}
                    </Button>
                  </header>

                  {addressRules.length === 0 ? (
                    <p className="px-2 text-[12px] text-fg-tertiary">
                      No routing rule — inbox default applies.
                    </p>
                  ) : (
                    <ul className="flex flex-col">
                      {addressRules.map((rule) => {
                        const agentID = routingRuleAgentID(rule);
                        return (
                          <li
                            key={rule.id}
                            className="flex h-9 items-center gap-2 rounded-md px-2 text-[13px] text-fg-primary transition-colors hover:bg-bg-elevated/40"
                          >
                            <Badge variant="muted">{routingRulePriority(rule) ?? 'normal'}</Badge>
                            <span className="text-fg-tertiary">
                              {agentID ? (
                                <>
                                  Assign to{' '}
                                  <span className="text-fg-primary">{shortID(agentID)}</span>
                                </>
                              ) : (
                                'Any agent'
                              )}
                            </span>
                            <Badge
                              variant={rule.enabled === false ? 'muted' : 'success'}
                              className="ml-auto"
                            >
                              {rule.enabled === false ? 'disabled' : 'enabled'}
                            </Badge>
                          </li>
                        );
                      })}
                    </ul>
                  )}

                  {isActive ? (
                    <RoutingRuleForm
                      address={address}
                      members={members}
                      onCancel={() => setActiveAddressID(null)}
                    />
                  ) : null}
                </section>
              );
            })}
          </div>
        )}
      </SettingsBody>
    </>
  );
}
