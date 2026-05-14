'use client';

import { MeshGradient } from '@paper-design/shaders-react';
import { useEffect, useState } from 'react';

/**
 * Closing CTA. Echoes the hero atmosphere — same shader, same palette,
 * tighter container — so the bottom of the page rhymes with the top.
 * The shader sits inside a dark glass frame for contrast on the CTA copy.
 */
export function ClosingCTA() {
  const [mounted, setMounted] = useState(false);
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    setMounted(true);
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(mq.matches);
  }, []);

  return (
    <section className="relative isolate overflow-hidden py-24 sm:py-28 md:py-32">
      <div className="mx-auto max-w-[1180px] px-5 sm:px-6">
        <div
          className="relative isolate overflow-hidden rounded-[28px]"
          style={{
            border: '1px solid oklch(0.86 0.05 270 / 0.4)',
            boxShadow:
              '0 0 0 0.5px oklch(1 0 0 / 0.6) inset, 0 40px 100px -40px oklch(0.3 0.04 280 / 0.32), 0 18px 40px -20px oklch(0.54 0.115 270 / 0.32)',
          }}
        >
          <div className="absolute inset-0 -z-10">
            {mounted && (
              <MeshGradient
                colors={['#1a1530', '#3b2a78', '#7c5bff', '#b2a0ff', '#efeafe']}
                distortion={0.85}
                swirl={0.32}
                speed={reduced ? 0 : 0.18}
                style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
              />
            )}
            <div
              aria-hidden="true"
              className="absolute inset-0"
              style={{
                background:
                  'radial-gradient(ellipse 90% 70% at 50% 50%, transparent 0%, oklch(0.18 0.02 280 / 0.55) 80%)',
              }}
            />
            <div
              aria-hidden="true"
              className="absolute inset-0"
              style={{
                opacity: 0.18,
                mixBlendMode: 'overlay',
                backgroundImage:
                  "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='240' height='240'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 0.4 0'/></filter><rect width='240' height='240' filter='url(%23n)'/></svg>\")",
              }}
            />
          </div>

          <div className="relative px-6 py-16 text-center sm:px-12 sm:py-20 md:py-24">
            <h2 className="mx-auto max-w-[760px] text-balance text-[34px] font-semibold leading-[1.04] tracking-[-0.022em] text-white sm:text-[48px] md:text-[60px]">
              The next ten support hires
              <br />
              <span className="text-white/70">won't be hires.</span>
            </h2>
            <p className="mx-auto mt-5 max-w-[520px] text-balance text-base text-white/70 sm:text-lg">
              Give them a real workplace.
            </p>
            <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <a
                href="https://app.usesalve.com"
                className="inline-flex h-11 items-center justify-center rounded-md bg-white px-6 text-sm font-semibold text-[oklch(0.18_0.02_280)] shadow-[0_1px_0_oklch(1_0_0_/_0.18)_inset,0_12px_28px_-12px_oklch(0_0_0_/_0.32)] transition-colors hover:bg-white/90 sm:w-auto"
              >
                Get started
              </a>
              <a
                href="https://github.com/chandeldivyam/salve"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-11 items-center justify-center gap-2 rounded-md border border-white/25 bg-white/[0.06] px-6 text-sm font-medium text-white backdrop-blur-sm transition-colors hover:bg-white/10 sm:w-auto"
              >
                View source
              </a>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
