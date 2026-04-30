// /app/settings/channels/email/suppressions — recipients we never email.
// Read-only list; entries are added by the bounce/complaint webhook in
// the API.

import { Badge, Card, CardContent, cn } from '@opendesk/ui';
import { queries } from '@opendesk/zero-schema';
import { useQuery } from '@rocicorp/zero/react';
import { createFileRoute } from '@tanstack/react-router';
import { ShieldOff } from 'lucide-react';
import { EmptyState } from '@/components/email-settings/empty-state';
import { RouteErrorFeedback, RoutePendingFeedback } from '@/components/route-feedback';
import { CACHE_NAV } from '@/lib/zero-cache';

export const Route = createFileRoute('/app/settings/channels/email/suppressions')({
  component: SuppressionsTab,
  pendingComponent: RoutePendingFeedback,
  errorComponent: RouteErrorFeedback,
});

function SuppressionsTab() {
  const [rows] = useQuery(queries.suppressions(), CACHE_NAV);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 py-6 sm:px-8">
      <div>
        <h2 className="text-base font-semibold text-foreground">Suppressions</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Recipients Salve will not email — added automatically when a delivery hard-bounces or a
          recipient marks a message as spam.
        </p>
      </div>
      {rows.length === 0 ? (
        <EmptyState
          icon={ShieldOff}
          title="No suppressed recipients"
          description="Bounces and spam complaints land here automatically so the same address is never re-emailed."
        />
      ) : (
        <Card className="overflow-hidden">
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[620px] text-left text-[13px]">
                <thead>
                  <tr className="border-b border-border bg-surface-muted text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    <th className="px-3 py-2">Target</th>
                    <th className="px-3 py-2">Reason</th>
                    <th className="px-3 py-2">Channel</th>
                    <th className="px-3 py-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, index) => {
                    const target = row.target ?? 'unknown';
                    // Suppressions can apply workspace-wide (no channel) or to a
                    // specific channel; the related row carries the channel
                    // kind we want to render.
                    const channel = row.channel?.kind ?? 'all channels';
                    const status: 'active' | 'inactive' = 'active';
                    return (
                      <tr
                        key={row.id}
                        className={cn(index !== rows.length - 1 && 'border-b border-border')}
                      >
                        <td className="max-w-[240px] truncate px-3 py-2.5 font-medium text-foreground">
                          {target}
                        </td>
                        <td className="px-3 py-2.5 text-muted-foreground">{row.reason}</td>
                        <td className="px-3 py-2.5 text-muted-foreground">{channel}</td>
                        <td className="px-3 py-2.5">
                          <Badge variant={status === 'active' ? 'danger' : 'muted'}>{status}</Badge>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
