// Query cache policies. Mirrors zbugs `src/query-cache-policy.ts` so we have
// one place to tune Zero TTLs across the app.
//
// Why this matters: with no `ttl` option, a `useQuery` subscription is
// dropped the moment its component unmounts, which means a hard reload
// re-mounts cold, IDB is empty for that query, `status.type === 'unknown'`
// for the first frames, and the UI flashes a loading state. Adding a TTL
// keeps the query warm in IndexedDB across reloads and SPA navigations.
//
// `'10m'` is the Zero MAX_TTL (`packages/zql/src/query/ttl.ts:25`); `'5m'`
// is the Zero default; `'none'` disables caching. Use `CACHE_FOREVER` for
// data we *always* want hot (inbox, workspace members), `CACHE_NAV` for
// per-route data the user might come back to within a few minutes
// (ticket detail, settings forms), and `CACHE_NONE` only for truly
// throwaway, never-re-shown queries.

import type { TTL } from '@rocicorp/zero';

export const CACHE_FOREVER: { readonly ttl: TTL } = { ttl: '10m' } as const;
export const CACHE_NAV: { readonly ttl: TTL } = { ttl: '5m' } as const;
export const CACHE_NONE: { readonly ttl: TTL } = { ttl: 'none' } as const;

// Alias used at preload sites — same payload as CACHE_FOREVER but the name
// signals intent at the call site (we are warming, not just subscribing).
export const CACHE_PRELOAD = CACHE_FOREVER;
