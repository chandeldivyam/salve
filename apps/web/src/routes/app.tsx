import { createFileRoute, Outlet, redirect } from '@tanstack/react-router';
import { fetchSession } from '@/lib/session-loader';

export const Route = createFileRoute('/app')({
  beforeLoad: async () => {
    const session = await fetchSession();
    if (!session) {
      throw redirect({ to: '/auth/sign-in' });
    }
    return { session };
  },
  component: AppLayout,
});

function AppLayout() {
  return <Outlet />;
}
