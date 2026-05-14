import type { Metadata } from 'next';
import { Footer } from '@/components/footer';
import { Nav } from '@/components/nav';

export const metadata: Metadata = {
  title: 'Not found',
  robots: { index: false, follow: false },
};

export default function NotFound() {
  return (
    <>
      <Nav />
      <main className="relative flex min-h-[100dvh] flex-col">
        <section className="relative isolate flex flex-1 items-center justify-center overflow-hidden px-5 pt-24 pb-16 sm:px-6">
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
              Error · 404
            </p>
            <h1 className="mt-4 text-balance text-[44px] font-semibold leading-[1.04] tracking-[-0.022em] text-fg-primary sm:text-[56px]">
              This ticket doesn't exist.
            </h1>
            <p className="mt-4 text-pretty text-base text-fg-tertiary sm:text-lg">
              The page you tried to reach isn't here. Head back to the home page or check the source
              on GitHub.
            </p>
            <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <a
                href="/"
                className="inline-flex h-11 w-full items-center justify-center rounded-md bg-[oklch(0.18_0.02_280)] px-6 text-sm font-medium text-white shadow-[0_1px_0_oklch(1_0_0_/_0.18)_inset,0_1px_2px_rgba(0,0,0,0.08),0_12px_28px_-12px_oklch(0.54_0.115_270_/_0.55)] outline-none transition-colors hover:bg-[oklch(0.12_0.02_280)] focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-canvas sm:w-auto"
              >
                Back to home
              </a>
              <a
                href="https://github.com/chandeldivyam/salve"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-11 w-full items-center justify-center rounded-md border border-[oklch(0.88_0.014_280)] bg-white/80 px-6 text-sm font-medium text-[oklch(0.2_0.01_320)] outline-none transition-colors hover:bg-white focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-canvas sm:w-auto"
              >
                View source
              </a>
            </div>
          </div>
        </section>
        <Footer />
      </main>
    </>
  );
}
