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

const router = createRouter({
  routeTree,
  defaultPendingComponent: RoutePendingFeedback,
  defaultErrorComponent: RouteErrorFeedback,
  defaultNotFoundComponent: RouteNotFoundFeedback,
  defaultPendingMs: 150,
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
