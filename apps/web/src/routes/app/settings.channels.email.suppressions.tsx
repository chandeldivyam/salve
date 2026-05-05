// /app/settings/channels/email/suppressions — recipients we never email.
// Read-only list; entries are added by the bounce/complaint webhook in
// the API. Variant C: flat rows with hairline separators, no card.

import { useQuery } from '@rocicorp/zero/react';
import { Badge } from '@salve/ui';
import { queries } from '@salve/zero-schema';
import { createFileRoute } from '@tanstack/react-router';
import { ShieldOff } from 'lucide-react';
import { EmptyState } from '@/components/email-settings/empty-state';
import { RouteErrorFeedback, RoutePendingFeedback } from '@/components/route-feedback';
import { SettingsBody, SettingsHeader } from '@/components/settings';
import { CACHE_NAV } from '@/lib/zero-cache';

export const Route = createFileRoute('/app/settings/channels/email/suppressions')({
  component: SuppressionsTab,
  pendingComponent: RoutePendingFeedback,
  errorComponent: RouteErrorFeedback,
});

function SuppressionsTab() {
  const [rows] = useQuery(queries.suppressions(), CACHE_NAV);

  return (
    <>
      <SettingsHeader
        title="Suppressions"
        description="Recipients Salve will not email — added automatically when a delivery hard-bounces or a recipient marks a message as spam."
      />
      <SettingsBody maxWidth="wide">
        {rows.length === 0 ? (
          <EmptyState
            icon={ShieldOff}
            title="No suppressed recipients"
            description="Bounces and spam complaints land here automatically so the same address is never re-emailed."
          />
        ) : (
          <section className="flex flex-col">
            <header className="grid h-7 items-center gap-3 px-2 pb-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-fg-quaternary lg:grid-cols-[minmax(0,2fr)_minmax(0,2fr)_minmax(0,1fr)_minmax(0,0.6fr)]">
              <span>Target</span>
              <span>Reason</span>
              <span>Channel</span>
              <span className="text-right">Status</span>
            </header>
            <ul className="flex flex-col">
              {rows.map((row) => {
                const target = row.target ?? 'unknown';
                const channel = row.channel?.kind ?? 'all channels';
                return (
                  <li
                    key={row.id}
                    className="grid items-center gap-3 rounded-md px-2 py-2 text-[13px] transition-colors hover:bg-bg-elevated/40 lg:grid-cols-[minmax(0,2fr)_minmax(0,2fr)_minmax(0,1fr)_minmax(0,0.6fr)]"
                  >
                    <span className="truncate font-medium text-fg-primary">{target}</span>
                    <span className="truncate text-fg-tertiary">{row.reason}</span>
                    <span className="truncate text-fg-tertiary">{channel}</span>
                    <span className="lg:text-right">
                      <Badge variant="danger">active</Badge>
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        )}
      </SettingsBody>
    </>
  );
}
