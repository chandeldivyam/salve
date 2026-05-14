'use client';

import { useEffect, useRef } from 'react';

/**
 * Site nav. Transparent while the page is at the top (so the hero
 * atmosphere bleeds through), backdrop-blurred white panel once the
 * user scrolls past the sentinel.
 *
 * Why this shape:
 * - `fixed` (not `sticky`) so an ancestor `overflow: hidden` can never
 *   silently break the header.
 * - IntersectionObserver on a 1px sentinel placed at the very top of
 *   the page — O(1) callback only at the threshold crossing, no
 *   per-frame scroll handler, no React re-renders.
 * - Toggles a `data-scrolled` attribute on the header via ref. The
 *   compositor handles paint; React never re-runs. Tailwind
 *   `data-[scrolled=true]:*` variants drive the styling.
 * - We deliberately do NOT transition `backdrop-filter` — animating
 *   it triggers full-region repaints (Safari especially) and reads as
 *   jank. Only `background-color` and `border-color` animate; the
 *   blur snaps on with the opaque panel.
 */
export function Nav() {
  const headerRef = useRef<HTMLElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const header = headerRef.current;
    const sentinel = sentinelRef.current;
    if (!header || !sentinel) return;

    const io = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry) return;
        header.dataset.scrolled = entry.isIntersecting ? 'false' : 'true';
      },
      { threshold: 0, rootMargin: '0px' },
    );
    io.observe(sentinel);
    return () => io.disconnect();
  }, []);

  return (
    <>
      <div ref={sentinelRef} aria-hidden="true" className="absolute top-0 left-0 h-2 w-px" />
      <header
        ref={headerRef}
        data-scrolled="false"
        className="
          fixed inset-x-0 top-0 z-50 w-full
          border-b border-transparent bg-transparent backdrop-blur-0
          transition-[background-color,border-color] duration-200
          data-[scrolled=true]:border-line-quiet
          data-[scrolled=true]:bg-bg-canvas/75
          data-[scrolled=true]:backdrop-blur-md
          data-[scrolled=true]:backdrop-saturate-150
        "
      >
        <div className="mx-auto flex h-14 max-w-[1180px] items-center justify-between px-5 sm:px-6">
          <a
            href="/"
            className="inline-flex items-center gap-2 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-canvas"
            aria-label="Salve — home"
          >
            <SalveMark size={22} />
            <span className="text-[15px] font-semibold tracking-tight text-fg-primary">Salve</span>
            <span className="ml-1 hidden rounded-full border border-line-default bg-bg-panel/70 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-fg-tertiary sm:inline-block">
              Beta
            </span>
          </a>

          <nav className="flex items-center gap-1 sm:gap-2">
            <a
              href="https://github.com/chandeldivyam/salve"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-9 items-center gap-1.5 rounded-md px-2.5 text-[13px] font-medium text-fg-secondary transition-colors hover:bg-bg-panel hover:text-fg-primary sm:px-3"
            >
              <GitHubMark />
              <span className="hidden sm:inline">GitHub</span>
            </a>
          </nav>
        </div>
      </header>
    </>
  );
}

function SalveMark({ size = 22 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      role="img"
      aria-label="Salve"
      className="text-brand-600"
    >
      <title>Salve</title>
      <path d="M20 4c0 8-5 14-13 14h-3c0-8 5-14 13-14h3z" fill="currentColor" opacity="0.18" />
      <path
        d="M20 4c0 8-5 14-13 14h-3c0-8 5-14 13-14h3z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M4 18c4-2 8-6 11-12"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

function GitHubMark() {
  return (
    <svg
      aria-hidden="true"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
    >
      <title>GitHub</title>
      <path d="M12 0C5.4 0 0 5.4 0 12c0 5.3 3.4 9.8 8.2 11.4.6.1.8-.3.8-.6v-2.1c-3.3.7-4-1.6-4-1.6-.6-1.4-1.4-1.8-1.4-1.8-1.1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1.1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.8-1.6-2.7-.3-5.5-1.3-5.5-6 0-1.3.5-2.4 1.2-3.2-.1-.3-.5-1.5.1-3.2 0 0 1-.3 3.3 1.2 1-.3 2-.4 3-.4s2 .1 3 .4c2.3-1.6 3.3-1.2 3.3-1.2.7 1.7.2 2.9.1 3.2.8.8 1.2 1.9 1.2 3.2 0 4.6-2.8 5.6-5.5 5.9.4.4.8 1.1.8 2.3v3.4c0 .3.2.7.8.6C20.6 21.8 24 17.3 24 12c0-6.6-5.4-12-12-12z" />
    </svg>
  );
}
