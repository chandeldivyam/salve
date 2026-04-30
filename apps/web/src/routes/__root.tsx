import { createRootRoute, Outlet } from '@tanstack/react-router';
import { BrandSplash } from '@/components/brand-splash';
import { FeedbackToasts } from '@/components/feedback-toasts';
import { RouteErrorFeedback, RouteNotFoundFeedback } from '@/components/route-feedback';

export const Route = createRootRoute({
  component: RootComponent,
  pendingComponent: BrandSplash,
  errorComponent: RouteErrorFeedback,
  notFoundComponent: RouteNotFoundFeedback,
});

function RootComponent() {
  return (
    <main className="min-h-full">
      <Outlet />
      <FeedbackToasts />
    </main>
  );
}
