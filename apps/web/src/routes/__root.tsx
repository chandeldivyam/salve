import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Logo,
} from '@opendesk/ui';
import { createRootRoute, Link, Outlet } from '@tanstack/react-router';

export const Route = createRootRoute({
  component: RootComponent,
  errorComponent: ErrorBoundary,
});

function RootComponent() {
  return (
    <main className="min-h-full">
      <Outlet />
    </main>
  );
}

/**
 * Styled top-level error boundary. TanStack Router will render this whenever
 * a route loader/component throws — replaces the default unstyled "Something
 * went wrong!" page with a Salve-branded card.
 */
function ErrorBoundary({ error }: { error: unknown }) {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : 'An unexpected error occurred.';
  return (
    <div className="flex min-h-dvh items-center justify-center bg-slate-50 p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <Logo />
          <CardTitle as="h1">Something went sideways</CardTitle>
          <CardDescription>
            Salve hit an unexpected error. Try reloading; if it sticks around, sign in again.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          <pre className="overflow-x-auto rounded-md border border-red-100 bg-red-50 px-3 py-2 text-xs text-red-700">
            {message}
          </pre>
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={() => window.location.reload()}>Reload</Button>
            <Button asChild variant="outline">
              <Link to="/auth/sign-in">Sign in</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
