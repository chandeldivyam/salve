'use client';

import { useEffect } from 'react';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surface the error in the browser console so debugging in the field
    // doesn't require the user to dig through framework internals.
    console.error(error);
  }, [error]);

  return (
    <main className="relative flex min-h-[100dvh] flex-col">
      <section className="relative isolate flex flex-1 items-center justify-center overflow-hidden px-5 py-24 sm:px-6">
        <div className="absolute inset-0 -z-10">
          <div
            aria-hidden="true"
            className="absolute inset-0"
            style={{
              background:
                'radial-gradient(ellipse 80% 60% at 50% 30%, oklch(0.96 0.04 270 / 0.55), transparent 70%)',
            }}
          />
        </div>

        <div className="mx-auto max-w-[560px] text-center">
          <p className="font-mono text-[12px] font-medium uppercase tracking-[0.18em] text-fg-quaternary">
            Something went wrong
          </p>
          <h1 className="mt-4 text-balance text-[44px] font-semibold leading-[1.04] tracking-[-0.022em] text-fg-primary sm:text-[56px]">
            We hit an unexpected snag.
          </h1>
          <p className="mt-4 text-pretty text-base text-fg-tertiary sm:text-lg">
            The page failed to render. Try again — if it keeps happening, let us know on GitHub.
          </p>
          {error.digest ? (
            <p className="mt-3 font-mono text-[11px] text-fg-quaternary">ref: {error.digest}</p>
          ) : null}
          <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <button
              type="button"
              onClick={reset}
              className="inline-flex h-11 w-full items-center justify-center rounded-md bg-[oklch(0.18_0.02_280)] px-6 text-sm font-medium text-white shadow-[0_1px_0_oklch(1_0_0_/_0.18)_inset,0_1px_2px_rgba(0,0,0,0.08),0_12px_28px_-12px_oklch(0.54_0.115_270_/_0.55)] outline-none transition-colors hover:bg-[oklch(0.12_0.02_280)] focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-canvas sm:w-auto"
            >
              Try again
            </button>
            <a
              href="/"
              className="inline-flex h-11 w-full items-center justify-center rounded-md border border-[oklch(0.88_0.014_280)] bg-white/80 px-6 text-sm font-medium text-[oklch(0.2_0.01_320)] outline-none transition-colors hover:bg-white focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-canvas sm:w-auto"
            >
              Back to home
            </a>
          </div>
        </div>
      </section>
    </main>
  );
}
