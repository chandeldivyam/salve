/**
 * Shared marketing ornaments — the visual primitives every section reuses
 * so the page reads as one design system rather than five disconnected blocks.
 *
 * - `EyebrowMarker` is the Raycast-style centered label flanked by hairlines
 *   that fade at both ends. Replaces the `border-t` between sections.
 * - `Frame` is the Raycast-style two-layer product-mock frame with a macOS
 *   "edge of light" inset highlight and a top-anchored brand-purple radial
 *   that lights the artifact from above.
 * - `SectionSpotlight` is a soft brand-purple radial that brightens the
 *   focal artifact of a section without flooding the whole viewport.
 */

import type { ReactNode } from 'react';

export function EyebrowMarker({
  children,
  align = 'center',
}: {
  children: ReactNode;
  align?: 'center' | 'start';
}) {
  return (
    <div
      className={`flex items-center gap-4 ${
        align === 'center' ? 'justify-center' : 'justify-start'
      }`}
    >
      {align === 'center' && <FadeLine side="left" />}
      <span className="relative inline-flex items-center gap-2 px-1.5">
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 -z-10 blur-md"
          style={{
            background:
              'radial-gradient(ellipse 60% 100% at 50% 50%, oklch(0.78 0.1 270 / 0.35), transparent 70%)',
          }}
        />
        <span className="h-1.5 w-1.5 rounded-full bg-brand-600" />
        <span className="text-[11.5px] font-semibold uppercase tracking-[0.14em] text-brand-soft-foreground">
          {children}
        </span>
      </span>
      <FadeLine side="right" />
    </div>
  );
}

function FadeLine({ side }: { side: 'left' | 'right' }) {
  return (
    <span
      aria-hidden="true"
      className="hidden h-px max-w-[180px] flex-1 sm:block"
      style={{
        background:
          side === 'left'
            ? 'linear-gradient(to right, transparent, oklch(0.78 0.06 270 / 0.55))'
            : 'linear-gradient(to left, transparent, oklch(0.78 0.06 270 / 0.55))',
      }}
    />
  );
}

/**
 * Raycast-style two-layer frame. Top-anchored radial inside the outer frame
 * acts as a soft brand-light "rain" onto the inner artifact.
 *
 * The `inner` prop lets sections render the actual artifact inside the
 * inner border — pass any element and it will be clipped to the inner radius.
 */
export function Frame({
  children,
  className = '',
  innerClassName = '',
  padding = 'sm',
  spotlightTint = 'oklch(0.78 0.1 270 / 0.22)',
}: {
  children: ReactNode;
  className?: string;
  innerClassName?: string;
  padding?: 'none' | 'sm' | 'md';
  spotlightTint?: string;
}) {
  const padClass = padding === 'none' ? 'p-0' : padding === 'md' ? 'p-2.5' : 'p-1.5';
  return (
    <div
      className={`relative isolate rounded-[22px] backdrop-blur-[2px] ${padClass} ${className}`}
      style={{
        border: '1px solid var(--frame-border)',
        background: 'var(--frame-bg)',
        boxShadow: 'var(--frame-shadow)',
      }}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10 overflow-hidden rounded-[22px]"
        style={{
          background: `radial-gradient(85% 55% at 50% 0%, ${spotlightTint}, transparent 70%)`,
        }}
      />
      <div
        className={`relative overflow-hidden rounded-[14px] ${innerClassName}`}
        style={{
          background: 'var(--frame-bg-inner)',
          border: '1px solid var(--frame-border-inner)',
          boxShadow: 'var(--frame-shadow-inner)',
        }}
      >
        {children}
      </div>
    </div>
  );
}

/**
 * Section spotlight. A soft brand-purple radial centered behind the
 * section's focal artifact. Replaces per-section full-bleed gradients —
 * keeps the underlying page color visible through the rest of the section.
 */
export function SectionSpotlight({
  position = '50% 40%',
  tint = 'oklch(0.78 0.1 270 / 0.18)',
  size = '900px 600px',
  className = '',
}: {
  position?: string;
  tint?: string;
  size?: string;
  className?: string;
}) {
  return (
    <div
      aria-hidden="true"
      className={`pointer-events-none absolute inset-0 -z-10 ${className}`}
      style={{
        background: `radial-gradient(${size} at ${position}, ${tint}, transparent 70%)`,
      }}
    />
  );
}
