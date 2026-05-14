'use client';

import { MeshGradient } from '@paper-design/shaders-react';
import { useEffect, useState } from 'react';

/**
 * Hero atmosphere — built to feel photographic, not synthetic.
 *
 * Three stacked layers compose the look:
 *   1. Bokeh blobs — large blurred radial-gradients that drift slowly,
 *      mimicking the defocused-flower look from Codex without needing a
 *      photo asset.
 *   2. MeshGradient (paper-shaders, 2D canvas, ~5KB) — adds the organic
 *      micro-variation real shaders give. Layered with mix-blend-mode:
 *      multiply at ~40% opacity so it deepens the bokeh rather than
 *      replacing it.
 *   3. Noise grain — a tiny SVG turbulence pattern at 4% to break
 *      gradient banding and add tactile texture.
 *
 * Layer 1 and 3 work without JS; layer 2 is mounted after first effect
 * tick to avoid hydration mismatch. `prefers-reduced-motion` freezes
 * both the bokeh keyframes and the shader speed.
 */
export function HeroShader() {
  const [mounted, setMounted] = useState(false);
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    setMounted(true);
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(mq.matches);
    const handler = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  return (
    <div className="absolute inset-0 overflow-hidden">
      <BokehBlobs paused={reduced} />

      {mounted && (
        <div className="absolute inset-0" style={{ mixBlendMode: 'multiply', opacity: 0.42 }}>
          <MeshGradient
            colors={['#fbfbfa', '#efe9fe', '#d8c9fa', '#9982ec', '#5a3fd1']}
            distortion={0.7}
            swirl={0.22}
            speed={reduced ? 0 : 0.14}
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
          />
        </div>
      )}

      <NoiseGrain />
    </div>
  );
}

/**
 * Bokeh blob composition. Six large blurred radials, animated on slow
 * keyframes, layered behind the shader. The base linear gradient gives
 * the underlying lavender tint that the blobs sit on.
 */
function BokehBlobs({ paused }: { paused: boolean }) {
  const animA = paused ? 'none' : 'salve-bokeh-a 32s ease-in-out infinite';
  const animB = paused ? 'none' : 'salve-bokeh-b 38s ease-in-out infinite';
  const animC = paused ? 'none' : 'salve-bokeh-c 44s ease-in-out infinite';

  return (
    <div className="salve-bokeh absolute inset-0">
      <div
        aria-hidden="true"
        className="absolute inset-0"
        style={{
          background:
            'linear-gradient(180deg, oklch(0.97 0.022 290) 0%, oklch(0.985 0.008 300) 55%, oklch(0.985 0.002 320) 100%)',
        }}
      />
      <div
        aria-hidden="true"
        className="absolute -top-32 -left-24 h-[720px] w-[720px] rounded-full"
        style={{
          background:
            'radial-gradient(circle at 50% 50%, oklch(0.74 0.16 285 / 0.55), oklch(0.74 0.16 285 / 0) 60%)',
          filter: 'blur(60px)',
          animation: animA,
          willChange: 'transform',
        }}
      />
      <div
        aria-hidden="true"
        className="absolute -top-10 right-[-12%] h-[640px] w-[640px] rounded-full"
        style={{
          background:
            'radial-gradient(circle at 50% 50%, oklch(0.82 0.13 305 / 0.55), oklch(0.82 0.13 305 / 0) 60%)',
          filter: 'blur(70px)',
          animation: animB,
          willChange: 'transform',
        }}
      />
      <div
        aria-hidden="true"
        className="absolute top-[20%] left-[28%] h-[560px] w-[560px] rounded-full"
        style={{
          background:
            'radial-gradient(circle at 50% 50%, oklch(0.92 0.08 280 / 0.7), oklch(0.92 0.08 280 / 0) 60%)',
          filter: 'blur(70px)',
          animation: animC,
          willChange: 'transform',
        }}
      />
      <div
        aria-hidden="true"
        className="absolute top-[40%] right-[20%] h-[440px] w-[440px] rounded-full"
        style={{
          background:
            'radial-gradient(circle at 50% 50%, oklch(0.6 0.18 280 / 0.35), oklch(0.6 0.18 280 / 0) 60%)',
          filter: 'blur(80px)',
          animation: animB,
          willChange: 'transform',
        }}
      />
      <div
        aria-hidden="true"
        className="absolute bottom-[-10%] left-[20%] h-[600px] w-[600px] rounded-full"
        style={{
          background:
            'radial-gradient(circle at 50% 50%, oklch(0.88 0.1 295 / 0.55), oklch(0.88 0.1 295 / 0) 60%)',
          filter: 'blur(90px)',
          animation: animA,
          willChange: 'transform',
        }}
      />
      {/* Tiny bright bloom — the "highlight" of a defocused photo. Off-center
       * so it reads as a real lens highlight rather than a vignette. */}
      <div
        aria-hidden="true"
        className="absolute top-[8%] left-[42%] h-[260px] w-[260px] rounded-full"
        style={{
          background:
            'radial-gradient(circle at 50% 50%, oklch(0.99 0.02 300 / 0.9), oklch(0.99 0.02 300 / 0) 65%)',
          filter: 'blur(36px)',
          animation: animC,
          willChange: 'transform',
        }}
      />
    </div>
  );
}

function NoiseGrain() {
  return (
    <div
      aria-hidden="true"
      className="absolute inset-0"
      style={{
        opacity: 0.18,
        mixBlendMode: 'overlay',
        backgroundImage:
          "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='240' height='240'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 0.5  0 0 0 0 0.4  0 0 0 0 0.6  0 0 0 0.6 0'/></filter><rect width='240' height='240' filter='url(%23n)'/></svg>\")",
        backgroundSize: '240px 240px',
      }}
    />
  );
}
