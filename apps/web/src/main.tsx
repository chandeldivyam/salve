import { createRouter, RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import {
  RouteErrorFeedback,
  RouteNotFoundFeedback,
  RoutePendingFeedback,
} from './components/route-feedback';
import { applyTheme } from './lib/theme';
import './styles.css';
import { routeTree } from './routeTree.gen';

// Paint the right theme before React hydrates to avoid a FOUC.
applyTheme();

// Default pending UI is the card-style RoutePendingFeedback — used by
// nested routes whose load takes long enough to show. The full-screen
// `<BrandSplash>` is opted into only at the auth gate (routes/app.tsx);
// in-app navigations (clicking a ticket, switching tabs) must NEVER
// full-screen splash. With `defaultPendingMs: 200` most clicks render
// the next view before any pending UI shows at all — Zero's local cache
// means the data is already there when the click lands.
const router = createRouter({
  routeTree,
  defaultPendingComponent: RoutePendingFeedback,
  defaultErrorComponent: RouteErrorFeedback,
  defaultNotFoundComponent: RouteNotFoundFeedback,
  defaultPendingMs: 200,
  defaultPendingMinMs: 400,
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('Root element #root not found');

createRoot(rootEl).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
