import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Logo } from '@salve/ui';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import * as z from 'zod';
import { authClient, switchWorkspace } from '@/lib/auth-client';
import { clearSessionCache } from '@/lib/session-loader';

const searchSchema = z.object({
  invitationId: z.string().catch(''),
});

export const Route = createFileRoute('/auth/accept-invitation')({
  validateSearch: (s) => searchSchema.parse(s),
  component: AcceptInvitationPage,
});

type PageState = 'loading' | 'unauthenticated' | 'accepting' | 'success' | 'error';

function AcceptInvitationPage() {
  const { invitationId } = Route.useSearch();
  const navigate = useNavigate();
  const [state, setState] = useState<PageState>('loading');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      const sessionRes = await authClient.getSession();
      if (cancelled) return;

      if (!sessionRes.data?.session) {
        setState('unauthenticated');
        return;
      }

      if (!invitationId) {
        setState('error');
        setErrorMessage('No invitation ID provided.');
        return;
      }

      setState('accepting');
      const res = await authClient.organization.acceptInvitation({ invitationId });
      if (cancelled) return;

      if (res.error) {
        setState('error');
        setErrorMessage(res.error.message ?? 'Could not accept invitation.');
        return;
      }

      const orgId = res.data?.member?.organizationId;
      if (orgId) {
        try {
          await switchWorkspace(orgId);
        } catch {
          // Non-fatal: user can switch manually from the app.
        }
      }
      clearSessionCache();
      setState('success');
      await navigate({ to: '/app' });
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, [invitationId, navigate]);

  if (state === 'loading' || state === 'accepting') {
    return (
      <div className="flex min-h-dvh items-center justify-center p-6">
        <Card className="w-full max-w-sm">
          <CardHeader>
            <Logo />
            <CardTitle as="h1">Accepting invitation…</CardTitle>
            <CardDescription>Just a moment.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  if (state === 'unauthenticated') {
    const next = `/auth/accept-invitation?invitationId=${encodeURIComponent(invitationId)}`;
    return (
      <div className="flex min-h-dvh items-center justify-center p-6">
        <Card className="w-full max-w-sm">
          <CardHeader>
            <Logo />
            <CardTitle as="h1">You've been invited</CardTitle>
            <CardDescription>Sign in to join a workspace on Salve.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            <Button asChild>
              <Link to="/auth/sign-in" search={{ next }}>
                Sign in to accept
              </Link>
            </Button>
            <Button variant="outline" asChild>
              <Link to="/auth/sign-up">Create an account</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (state === 'error') {
    return (
      <div className="flex min-h-dvh items-center justify-center p-6">
        <Card className="w-full max-w-sm">
          <CardHeader>
            <Logo />
            <CardTitle as="h1">Invitation unavailable</CardTitle>
            <CardDescription>
              {errorMessage ??
                "This invitation may have expired, already been used, or isn't for your account."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link to="/app">Go to Salve</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return null;
}
