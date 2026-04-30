import { createRootRoute, Outlet } from '@tanstack/react-router';
import { FeedbackToasts } from '@/components/feedback-toasts';
import {
  RouteErrorFeedback,
  RouteNotFoundFeedback,
  RoutePendingFeedback,
} from '@/components/route-feedback';

export const Route = createRootRoute({
  component: RootComponent,
  pendingComponent: RoutePendingFeedback,
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
