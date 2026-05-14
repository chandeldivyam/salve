'use client';

import { useEffect, useRef, useState } from 'react';
import { HeroShader } from './hero-shader';
import { Frame } from './ornaments';

export function Hero() {
  const isDesktop = useIsDesktop();

  return (
    <section className="relative isolate overflow-hidden pt-20 pb-24 sm:pt-24 sm:pb-28 md:pt-28 md:pb-36">
      <HeroAtmosphere />

      <div className="relative mx-auto max-w-[1180px] px-5 sm:px-6">
        <div className="mx-auto flex max-w-[860px] flex-col items-center text-center">
          <h1 className="text-balance text-[42px] font-semibold leading-[1.02] tracking-[-0.024em] text-[oklch(0.16_0.018_280)] sm:text-[58px] md:text-[76px] lg:text-[84px]">
            Support platform built for AI agents.
          </h1>
          <p className="mt-5 max-w-[540px] text-balance text-base text-[oklch(0.4_0.02_280)] sm:mt-6 sm:text-lg md:text-xl">
            Because agents now do real work.
          </p>

          <div className="mt-9 flex w-full flex-col items-center gap-3 sm:mt-11 sm:w-auto sm:flex-row">
            <a
              href="https://app.usesalve.com"
              className="inline-flex h-11 w-full items-center justify-center rounded-md bg-[oklch(0.18_0.02_280)] px-6 text-sm font-medium text-white shadow-[0_1px_0_oklch(1_0_0_/_0.18)_inset,0_1px_2px_rgba(0,0,0,0.08),0_12px_28px_-12px_oklch(0.54_0.115_270_/_0.55)] outline-none transition-colors hover:bg-[oklch(0.12_0.02_280)] focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-canvas sm:w-auto"
            >
              Get started
            </a>
            <a
              href="https://github.com/chandeldivyam/salve"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-md border border-[oklch(0.88_0.014_280)] bg-white/80 px-6 text-sm font-medium text-[oklch(0.2_0.01_320)] outline-none backdrop-blur-sm transition-colors hover:bg-white focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-canvas sm:w-auto"
            >
              <GitHubMark />
              <span>View source</span>
            </a>
          </div>
        </div>

        <div className="relative mt-16 sm:mt-20 md:mt-24">
          <Frame padding="sm" spotlightTint="oklch(0.78 0.13 285 / 0.32)">
            {isDesktop ? <VideoFrame /> : <MobileTicketCard />}
          </Frame>
        </div>
      </div>
    </section>
  );
}

/**
 * Read viewport size on the client only. SSR renders the mobile branch
 * (cheap markup, no video, no large poster) so phones never request the
 * desktop hero media. On md+ viewports the desktop branch hydrates in.
 */
function useIsDesktop() {
  const [isDesktop, setIsDesktop] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 768px)');
    const apply = () => setIsDesktop(mq.matches);
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);
  return isDesktop;
}

/**
 * Hero atmosphere. Atmosphere container holds the shader and a soft
 * legibility scrim. We mask the whole thing with a bottom fade so it
 * dissolves into the page color without a visible seam — the Codex
 * mask-image trick.
 */
function HeroAtmosphere() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[920px] overflow-hidden sm:h-[1020px]"
      style={{
        maskImage:
          'linear-gradient(to bottom, black 0%, black calc(100% - 280px), transparent 100%)',
        WebkitMaskImage:
          'linear-gradient(to bottom, black 0%, black calc(100% - 280px), transparent 100%)',
      }}
    >
      <HeroShader />
      {/* Legibility scrim — pulls the area directly behind the headline
       *  toward white so type contrast stays ≥ AA without dimming the
       *  surrounding atmosphere. */}
      <div
        className="absolute inset-x-0 top-0 h-[520px]"
        style={{
          background:
            'radial-gradient(ellipse 60% 60% at 50% 35%, oklch(0.99 0.002 320 / 0.55), transparent 70%)',
        }}
      />
    </div>
  );
}

function VideoFrame() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [videoReady, setVideoReady] = useState(false);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    // canplay can fire before this effect attaches its listener (cached
    // video, fast network). Check readyState first so we never strand the
    // <video> at opacity 0 with readyState 4.
    if (el.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) {
      setVideoReady(true);
      return;
    }
    const onCanPlay = () => setVideoReady(true);
    el.addEventListener('canplay', onCanPlay);
    return () => el.removeEventListener('canplay', onCanPlay);
  }, []);

  return (
    <div className="relative">
      <picture>
        <source srcSet="/hero-loop-poster.webp" type="image/webp" />
        <img
          src="/hero-loop-poster.png"
          alt="Salve — an AI agent drafts a refund reply that a human teammate sends."
          width={1920}
          height={1080}
          className="block aspect-[16/9] w-full object-cover"
          loading="eager"
          fetchPriority="high"
        />
      </picture>
      <video
        ref={videoRef}
        className="pointer-events-none absolute inset-0 block aspect-[16/9] w-full object-cover transition-opacity duration-500"
        style={{ opacity: videoReady ? 1 : 0 }}
        poster="/hero-loop-poster.png"
        muted
        autoPlay
        loop
        playsInline
        preload="metadata"
        tabIndex={-1}
      >
        <source src="/hero-loop.webm" type="video/webm" />
        <source src="/hero-loop.mp4" type="video/mp4" />
      </video>
    </div>
  );
}

function MobileTicketCard() {
  return (
    <div className="bg-white">
      <div className="flex items-center gap-3 border-b border-[oklch(0.95_0.004_320)] px-4 py-3">
        <span className="text-[11px] font-medium tabular-nums text-[oklch(0.62_0.012_320)]">
          #2847
        </span>
        <span className="flex-1 truncate text-[13.5px] font-semibold text-[oklch(0.2_0.01_320)]">
          Refund — duplicate charge
        </span>
        <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-[oklch(0.78_0.07_150)] bg-[oklch(0.95_0.04_150)] px-2.5 py-0.5 text-[10.5px] font-medium text-[oklch(0.36_0.09_150)]">
          <span className="h-1.5 w-1.5 rounded-full bg-[oklch(0.62_0.14_150)]" />
          Resolved
        </span>
      </div>

      <div className="flex gap-3 px-4 py-4">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[oklch(0.7_0.01_320)] text-[11px] font-semibold text-white">
          MC
        </div>
        <div className="flex-1 rounded-lg border border-[oklch(0.9_0.006_320)] bg-[oklch(0.97_0.003_320)] p-3">
          <div className="mb-1 flex items-baseline gap-2 text-[11px]">
            <span className="font-semibold text-[oklch(0.2_0.01_320)]">Maya Chen</span>
            <span className="text-[oklch(0.5_0.012_320)]">just now</span>
          </div>
          <p className="text-[13px] leading-snug text-[oklch(0.32_0.012_320)]">
            I was charged twice today on order #2847. Could you refund the duplicate?
          </p>
        </div>
      </div>

      <div className="flex gap-3 px-4 pb-4">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[oklch(0.54_0.115_270)] text-[11px] font-bold text-white">
          A
        </div>
        <div className="flex-1 rounded-lg border border-[oklch(0.86_0.05_270)] bg-[oklch(0.97_0.014_270)] p-3">
          <div className="mb-1 flex items-baseline gap-2 text-[11px]">
            <span className="font-semibold text-[oklch(0.2_0.01_320)]">Aria</span>
            <span className="text-[oklch(0.36_0.07_270)]">agent · just now</span>
          </div>
          <p className="text-[13px] leading-snug text-[oklch(0.32_0.012_320)]">
            Confirmed both charges. Refunding the duplicate ($48.00) to card •••• 4242. Posts in 3–5
            days.
          </p>
        </div>
      </div>
    </div>
  );
}

function GitHubMark() {
  return (
    <svg
      aria-hidden="true"
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
    >
      <title>GitHub</title>
      <path d="M12 0C5.4 0 0 5.4 0 12c0 5.3 3.4 9.8 8.2 11.4.6.1.8-.3.8-.6v-2.1c-3.3.7-4-1.6-4-1.6-.6-1.4-1.4-1.8-1.4-1.8-1.1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1.1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.8-1.6-2.7-.3-5.5-1.3-5.5-6 0-1.3.5-2.4 1.2-3.2-.1-.3-.5-1.5.1-3.2 0 0 1-.3 3.3 1.2 1-.3 2-.4 3-.4s2 .1 3 .4c2.3-1.6 3.3-1.2 3.3-1.2.7 1.7.2 2.9.1 3.2.8.8 1.2 1.9 1.2 3.2 0 4.6-2.8 5.6-5.5 5.9.4.4.8 1.1.8 2.3v3.4c0 .3.2.7.8.6C20.6 21.8 24 17.3 24 12c0-6.6-5.4-12-12-12z" />
    </svg>
  );
}
