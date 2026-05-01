// /app/settings/channels/email/domains — domain list + add-domain form.
// Replaces the older /app/settings/email/domains list (kept as a redirect
// for one slice). The setup checklist deep-links here with `?action=add`
// to auto-open the add form.

import { Badge, Button, Card, CardContent } from '@opendesk/ui';
import { queries } from '@opendesk/zero-schema';
import { useQuery } from '@rocicorp/zero/react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { format } from 'date-fns';
import { ChevronRight, Mail, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { AddDomainForm } from '@/components/email-settings/add-domain-form';
import { EmptyState } from '@/components/email-settings/empty-state';
import { domainStatusVariant } from '@/components/email-settings/types';
import { RouteErrorFeedback, RoutePendingFeedback } from '@/components/route-feedback';
import { SettingsBody, SettingsHeader } from '@/components/settings';
import { CACHE_NAV } from '@/lib/zero-cache';

interface DomainsSearch {
  action?: 'add';
}

export const Route = createFileRoute('/app/settings/channels/email/domains/')({
  component: DomainsTab,
  pendingComponent: RoutePendingFeedback,
  errorComponent: RouteErrorFeedback,
  validateSearch: (search: Record<string, unknown>): DomainsSearch => {
    return search.action === 'add' ? { action: 'add' } : {};
  },
});

function DomainsTab() {
  const search = Route.useSearch();
  const [domains] = useQuery(queries.sendingDomains(), CACHE_NAV);
  const [showForm, setShowForm] = useState(false);

  // Honor the ?action=add deep-link from the setup checklist.
  useEffect(() => {
    if (search.action === 'add') setShowForm(true);
  }, [search.action]);

  const empty = domains.length === 0;

  return (
    <>
      <SettingsHeader
        title="Sending domains"
        description="Add a domain so replies go out from your own brand. We'll DKIM-sign every send."
        actions={
          !empty ? (
            <Button
              size="sm"
              variant={showForm ? 'outline' : 'default'}
              onClick={() => setShowForm((s) => !s)}
            >
              <Plus className="h-3.5 w-3.5" />
              {showForm ? 'Close form' : 'Add domain'}
            </Button>
          ) : null
        }
      />
      <SettingsBody maxWidth="wide">
        <div className="flex flex-col gap-4">
          {showForm ? <AddDomainForm onDone={() => setShowForm(false)} /> : null}

          {empty && !showForm ? (
            <EmptyState
              icon={Mail}
              title="No sending domains yet"
              description="Add the domain replies will come from. We'll generate DKIM records for your DNS."
              action={
                <Button size="sm" onClick={() => setShowForm(true)}>
                  <Plus className="h-3.5 w-3.5" /> Add domain
                </Button>
              }
            />
          ) : (
            <ul className="flex flex-col">
              {domains.map((d) => (
                <li key={d.id}>
                  <Link
                    to="/app/settings/channels/email/domains/$domainId"
                    params={{ domainId: d.id }}
                    className="flex items-center justify-between gap-3 rounded-md px-3 py-2.5 transition-colors hover:bg-bg-elevated/40"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-[13px] font-medium text-fg-primary">
                        {d.domain}
                      </p>
                      <p className="mt-0.5 text-[11px] text-fg-tertiary">
                        Added {format(new Date(d.createdAt), 'MMM d, yyyy')}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={domainStatusVariant(d.dnsStatus)}>{d.dnsStatus}</Badge>
                      <ChevronRight className="h-4 w-4 text-fg-tertiary" />
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </SettingsBody>
    </>
  );
}
