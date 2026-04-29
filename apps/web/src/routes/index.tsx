import { createFileRoute, redirect } from '@tanstack/react-router';
import { fetchSession } from '@/lib/session-loader';

export const Route = createFileRoute('/')({
  beforeLoad: async () => {
    const session = await fetchSession();
    if (session) {
      throw redirect({ to: '/app' });
    }
    throw redirect({ to: '/auth/sign-in' });
  },
});
