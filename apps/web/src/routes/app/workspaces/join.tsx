import { useQuery } from '@rocicorp/zero/react';
import { Avatar, AvatarFallback, Button, initialsFromName, Logo } from '@salve/ui';
import { queries, type UserInvitationRow } from '@salve/zero-schema';
import { createFileRoute, Link, useNavigate, useRouteContext } from '@tanstack/react-router';
import { useState } from 'react';
import { authClient, switchWorkspace } from '@/lib/auth-client';
import { showError } from '@/lib/feedback';
import type { SessionData } from '@/lib/session-loader';
import { clearSessionCache } from '@/lib/session-loader';
import { CACHE_NAV } from '@/lib/zero-cache';

export const Route = createFileRoute('/app/workspaces/join')({
  component: JoinWorkspacePage,
});

function JoinWorkspacePage() {
  const navigate = useNavigate();
  const { hasActiveOrg } = useRouteContext({ from: '/app' }) as {
    session: SessionData;
    hasActiveOrg: boolean;
  };

  const [invitations] = useQuery(queries.userInvitations(), CACHE_NAV);
  const [actionInFlight, setActionInFlight] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  async function handleAccept(inv: UserInvitationRow) {
    setActionInFlight(inv.id);
    setErrors((prev) => ({ ...prev, [inv.id]: '' }));
    const res = await authClient.organization.acceptInvitation({ invitationId: inv.id });
    if (res.error) {
      setErrors((prev) => ({
        ...prev,
        [inv.id]: res.error?.message ?? 'Could not accept invitation.',
      }));
      setActionInFlight(null);
      return;
    }
    const orgId = res.data?.member?.organizationId ?? inv.organizationId;
    try {
      await switchWorkspace(orgId);
    } catch {
      // Non-fatal — user lands in app and can switch manually.
    }
    clearSessionCache();
    await navigate({ to: '/app/inbox' });
  }

  async function handleDecline(inv: UserInvitationRow) {
    setActionInFlight(inv.id);
    setErrors((prev) => ({ ...prev, [inv.id]: '' }));
    try {
      const res = await authClient.organization.rejectInvitation({ invitationId: inv.id });
      if (res.error) {
        setErrors((prev) => ({
          ...prev,
          [inv.id]: res.error?.message ?? 'Could not decline invitation.',
        }));
        setActionInFlight(null);
        return;
      }
      // Zero will sync the status change; no local state manipulation needed.
    } catch (err) {
      showError(err, "Couldn't decline invitation.");
    }
    setActionInFlight(null);
  }

  const content =
    invitations.length === 0 ? (
      <div className="flex flex-col items-center gap-4 py-8 text-center">
        <p className="text-[13px] text-fg-secondary">No pending invitations.</p>
        <Button variant="outline" size="sm" asChild>
          <Link to="/app/workspaces/new">Create a workspace</Link>
        </Button>
      </div>
    ) : (
      <div className="flex flex-col gap-3">
        {invitations.map((inv) => (
          <InvitationCard
            key={inv.id}
            inv={inv}
            actionInFlight={actionInFlight}
            error={errors[inv.id]}
            onAccept={handleAccept}
            onDecline={handleDecline}
          />
        ))}
      </div>
    );

  if (!hasActiveOrg) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center p-6">
        <div className="mb-8 flex flex-col items-center">
          <Logo className="h-8 w-8" />
        </div>
        <div className="w-full max-w-[480px]">
          <h1 className="mb-5 text-[18px] font-semibold text-fg-primary">Pending invitations</h1>
          {content}
          <p className="mt-6 text-center text-[13px] text-fg-tertiary">
            Want to start fresh?{' '}
            <Link
              to="/app/workspaces/new"
              className="text-fg-secondary underline-offset-2 hover:underline"
            >
              Create a workspace
            </Link>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 items-center justify-center bg-background p-6">
      <div className="w-full max-w-md">
        <h1 className="mb-5 text-[18px] font-semibold text-fg-primary">Pending invitations</h1>
        {content}
      </div>
    </div>
  );
}

function InvitationCard({
  inv,
  actionInFlight,
  error,
  onAccept,
  onDecline,
}: {
  inv: UserInvitationRow;
  actionInFlight: string | null;
  error?: string;
  onAccept: (inv: UserInvitationRow) => void;
  onDecline: (inv: UserInvitationRow) => void;
}) {
  const busy = actionInFlight === inv.id;
  const orgName = inv.organization?.name ?? inv.organizationId;
  const inviterName = inv.inviter?.name ?? inv.inviter?.email ?? null;
  const roleLabel = inv.role.charAt(0).toUpperCase() + inv.role.slice(1);

  return (
    <div className="rounded-lg border border-border bg-bg-base px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <Avatar className="h-8 w-8 shrink-0">
            <AvatarFallback className="text-[11px]">{initialsFromName(orgName)}</AvatarFallback>
          </Avatar>
          <div>
            <p className="text-[13px] font-medium text-fg-primary">{orgName}</p>
            {inviterName ? (
              <p className="text-[11px] text-fg-tertiary">Invited by {inviterName}</p>
            ) : null}
          </div>
        </div>
        <span className="shrink-0 rounded-full border border-line-quiet px-2 py-0.5 text-[11px] font-medium text-fg-secondary">
          {roleLabel}
        </span>
      </div>
      {error ? (
        <p role="alert" className="mt-2 text-[12px] text-danger-soft-foreground">
          {error}
        </p>
      ) : null}
      <div className="mt-3 flex gap-2">
        <Button
          size="sm"
          className="flex-1"
          disabled={busy || actionInFlight !== null}
          onClick={() => onAccept(inv)}
        >
          {busy ? 'Accepting…' : 'Accept'}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="flex-1 text-fg-secondary"
          disabled={busy || actionInFlight !== null}
          onClick={() => onDecline(inv)}
        >
          Decline
        </Button>
      </div>
    </div>
  );
}
