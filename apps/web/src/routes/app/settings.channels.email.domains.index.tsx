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
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 py-6 sm:px-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-foreground">Sending domains</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Add a domain so replies go out from your own brand. We'll DKIM-sign every send.
          </p>
        </div>
        {!empty ? (
          <Button
            size="sm"
            variant={showForm ? 'outline' : 'default'}
            onClick={() => setShowForm((s) => !s)}
          >
            <Plus className="h-3.5 w-3.5" />
            {showForm ? 'Close form' : 'Add domain'}
          </Button>
        ) : null}
      </div>

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
        <Card className="overflow-hidden">
          <CardContent className="p-0">
            <ul className="divide-y divide-border">
              {domains.map((d) => (
                <li key={d.id}>
                  <Link
                    to="/app/settings/channels/email/domains/$domainId"
                    params={{ domainId: d.id }}
                    className="flex items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-surface-muted"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-foreground">{d.domain}</p>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        Added {format(new Date(d.createdAt), 'MMM d, yyyy')}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={domainStatusVariant(d.dnsStatus)}>{d.dnsStatus}</Badge>
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
