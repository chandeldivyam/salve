import {
  type WorkbenchLocation,
  type WorkbenchRouteDef,
  type WorkbenchRouteMatch,
  workbenchRoutes,
} from './routes';

const APP_ORIGIN = 'https://salve.local';

export function stripTrailingSlash(pathname: string): string {
  if (pathname === '/') return pathname;
  return pathname.replace(/\/+$/, '');
}

export function hrefToLocation(href: string): WorkbenchLocation {
  const url = new URL(href, APP_ORIGIN);
  return {
    pathname: stripTrailingSlash(url.pathname),
    search: url.search,
    hash: url.hash,
  };
}

export function locationToHref(location: WorkbenchLocation): string {
  const pathname = stripTrailingSlash(location.pathname);
  return `${pathname}${location.search ?? ''}${location.hash ?? ''}`;
}

export function makeTicketTabHref(ticketID: string): string {
  return `/app/inbox/t/${encodeURIComponent(ticketID)}?fullDetail=1`;
}

export function makeInboxTicketHref(ticketID: string): string {
  return `/app/inbox/t/${encodeURIComponent(ticketID)}`;
}

export function isFullDetailTicketHref(href: string): boolean {
  const location = hrefToLocation(href);
  return (
    location.pathname.startsWith('/app/inbox/t/') &&
    new URLSearchParams(location.search).get('fullDetail') === '1'
  );
}

export function resolveWorkbenchHref(href: string): WorkbenchRouteMatch {
  return resolveWorkbenchLocation(hrefToLocation(href));
}

export function resolveWorkbenchLocation(location: WorkbenchLocation): WorkbenchRouteMatch {
  const pathname = stripTrailingSlash(location.pathname);
  const search = new URLSearchParams(location.search ?? '');

  for (const route of workbenchRoutes) {
    const params = route.match(pathname, search);
    if (!params) continue;
    const href = canonicalizeHref(route, {
      pathname,
      search: location.search,
      hash: location.hash,
    });
    return {
      route,
      params,
      href,
      tabKey: route.tabKey(params, search),
      title: route.title(params, search),
    };
  }

  const fallback = workbenchRoutes.find((route) => route.id === 'inbox');
  if (!fallback) {
    throw new Error('Workbench route registry is missing inbox.');
  }
  return {
    route: fallback,
    params: {},
    href: fallback.defaultHref,
    tabKey: fallback.tabKey({}, new URLSearchParams()),
    title: fallback.title({}, new URLSearchParams()),
  };
}

function canonicalizeHref(route: WorkbenchRouteDef, location: WorkbenchLocation): string {
  const pathname = stripTrailingSlash(canonicalPathname(location.pathname));
  const search = new URLSearchParams(location.search ?? '');
  for (const param of route.transientSearchParams ?? []) {
    search.delete(param);
  }

  const query = search.toString();
  return `${pathname}${query ? `?${query}` : ''}${location.hash ?? ''}`;
}

function canonicalPathname(pathname: string): string {
  if (pathname === '/app/settings/email/domains') {
    return '/app/settings/channels/email/domains';
  }
  const legacyDomain = /^\/app\/settings\/email\/domains\/([^/]+)$/.exec(pathname);
  if (legacyDomain?.[1]) {
    return `/app/settings/channels/email/domains/${legacyDomain[1]}`;
  }
  if (pathname === '/app') return '/app/inbox';
  return pathname;
}
