import { createRouter, RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrandSplash } from './components/brand-splash';
import {
  RouteErrorFeedback,
  RouteNotFoundFeedback,
} from './components/route-feedback';
import { applyTheme } from './lib/theme';
import './styles.css';
import { routeTree } from './routeTree.gen';

// Paint the right theme before React hydrates to avoid a FOUC.
applyTheme();

// Default pending component is the full-screen brand splash. It is
// visually identical to the inline `#initial-splash` painted in
// `index.html`, so the hand-off (HTML → React → real app) has no flash.
// `defaultPendingMs: 0` means we render the splash immediately on any
// navigation that suspends — combined with the inline splash, the user
// never sees raw white.
const router = createRouter({
  routeTree,
  defaultPendingComponent: BrandSplash,
  defaultErrorComponent: RouteErrorFeedback,
  defaultNotFoundComponent: RouteNotFoundFeedback,
  defaultPendingMs: 0,
  defaultPendingMinMs: 250,
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
