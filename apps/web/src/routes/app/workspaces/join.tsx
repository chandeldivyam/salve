import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@salve/ui';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { authClient, switchWorkspace } from '@/lib/auth-client';
import { clearSessionCache } from '@/lib/session-loader';

export const Route = createFileRoute('/app/workspaces/join')({
  component: JoinWorkspacePage,
});

interface PendingInvitation {
  id: string;
  organizationId: string;
  organizationName: string;
  role: string;
  inviterId: string;
  expiresAt: Date;
}

function JoinWorkspacePage() {
  const navigate = useNavigate();
  const [invitations, setInvitations] = useState<PendingInvitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionInFlight, setActionInFlight] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    async function load() {
      const res = await authClient.organization.listUserInvitations();
      const all = Array.isArray(res.data) ? res.data : [];
      const pending = all.filter((inv) => (inv as { status?: string }).status === 'pending');
      setInvitations(
        pending.map((inv) => ({
          id: inv.id,
          organizationId: inv.organizationId,
          organizationName:
            (inv as { organizationName?: string }).organizationName ?? inv.organizationId,
          role: inv.role,
          inviterId: inv.inviterId,
          expiresAt: inv.expiresAt,
        })),
      );
      setLoading(false);
    }
    void load();
  }, []);

  async function handleAccept(inv: PendingInvitation) {
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

  async function handleDecline(inv: PendingInvitation) {
    setActionInFlight(inv.id);
    setErrors((prev) => ({ ...prev, [inv.id]: '' }));
    const res = await authClient.organization.rejectInvitation({ invitationId: inv.id });
    if (res.error) {
      setErrors((prev) => ({
        ...prev,
        [inv.id]: res.error?.message ?? 'Could not decline invitation.',
      }));
      setActionInFlight(null);
      return;
    }
    setInvitations((prev) => prev.filter((i) => i.id !== inv.id));
    setActionInFlight(null);
  }

  return (
    <div className="flex min-h-0 flex-1 items-center justify-center bg-background p-6">
      <div className="w-full max-w-md">
        <h1 className="mb-6 text-xl font-semibold">Pending invitations</h1>
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : invitations.length === 0 ? (
          <Card>
            <CardHeader>
              <CardTitle as="h2">No pending invitations</CardTitle>
              <CardDescription>You don't have any workspace invitations waiting.</CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild>
                <Link to="/app/workspaces/new">Create a workspace</Link>
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4">
            {invitations.map((inv) => (
              <Card key={inv.id}>
                <CardHeader>
                  <CardTitle as="h2">{inv.organizationName}</CardTitle>
                  <CardDescription>
                    You've been invited as{' '}
                    <span className="font-medium capitalize">{inv.role}</span>.
                  </CardDescription>
                </CardHeader>
                <CardContent className="grid gap-3">
                  {errors[inv.id] ? (
                    <p role="alert" className="text-sm text-danger-soft-foreground">
                      {errors[inv.id]}
                    </p>
                  ) : null}
                  <div className="flex gap-2">
                    <Button
                      className="flex-1"
                      disabled={actionInFlight === inv.id}
                      onClick={() => void handleAccept(inv)}
                    >
                      {actionInFlight === inv.id ? 'Accepting…' : 'Accept'}
                    </Button>
                    <Button
                      variant="outline"
                      className="flex-1"
                      disabled={actionInFlight === inv.id}
                      onClick={() => void handleDecline(inv)}
                    >
                      Decline
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
