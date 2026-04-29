import { createRootRoute, Outlet } from '@tanstack/react-router';

export const Route = createRootRoute({
  component: RootComponent,
});

function RootComponent() {
  return (
    <main className="min-h-full">
      <Outlet />
    </main>
  );
}
