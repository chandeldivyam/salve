import type { AnyRouter } from '@tanstack/react-router';

export function navigateWorkbenchHref(router: AnyRouter, href: string) {
  void router.navigate({ href });
}
