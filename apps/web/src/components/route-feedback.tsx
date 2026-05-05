import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Logo } from '@salve/ui';
import type { ErrorComponentProps } from '@tanstack/react-router';
import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { toUserErrorMessage } from '@/lib/feedback';

export function RoutePendingFeedback() {
  return (
    <RouteFeedbackFrame>
      <Card className="w-full max-w-sm">
        <CardHeader>
          <Logo />
          <CardTitle as="h1">Loading Salve</CardTitle>
          <CardDescription>Preparing this workspace view.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div className="h-full w-1/3 animate-pulse rounded-full bg-brand-600" />
          </div>
        </CardContent>
      </Card>
    </RouteFeedbackFrame>
  );
}

export function RouteErrorFeedback({ error }: ErrorComponentProps) {
  const message = toUserErrorMessage(error, 'An unexpected route error occurred.');

  return (
    <RouteFeedbackFrame>
      <Card className="w-full max-w-md">
        <CardHeader>
          <Logo />
          <CardTitle as="h1">This view could not load</CardTitle>
          <CardDescription>
            Reload the page. If the problem continues, sign in again and reopen the workspace.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          <pre className="max-h-40 overflow-auto rounded-md border border-danger-border bg-danger-soft px-3 py-2 text-xs text-danger-soft-foreground">
            {message}
          </pre>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" onClick={() => window.location.reload()}>
              Reload
            </Button>
            <Button asChild variant="outline">
              <Link to="/auth/sign-in">Sign in</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </RouteFeedbackFrame>
  );
}

export function RouteNotFoundFeedback() {
  return (
    <RouteFeedbackFrame>
      <Card className="w-full max-w-md">
        <CardHeader>
          <Logo />
          <CardTitle as="h1">Page not found</CardTitle>
          <CardDescription>
            The page may have moved, or you may not have access from this workspace.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3">
          <Button asChild>
            <Link to="/app/inbox">Go to inbox</Link>
          </Button>
          <Button asChild variant="outline">
            <Link to="/app/settings/channels/email">Email setup</Link>
          </Button>
        </CardContent>
      </Card>
    </RouteFeedbackFrame>
  );
}

function RouteFeedbackFrame({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-background p-6">{children}</div>
  );
}
