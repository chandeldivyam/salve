import { forwardRef, type SVGAttributes } from 'react';
import { cn } from './utils.js';

export interface LogoProps extends SVGAttributes<SVGSVGElement> {
  /** Pixel size of the icon glyph; defaults to 24 (1.5rem). */
  size?: number;
  /** When true, render the wordmark "Salve" alongside the glyph. */
  withWordmark?: boolean;
}

/**
 * Salve logo — a simple leaf glyph in the brand color, with an optional
 * "Salve" wordmark beside it. The leaf is hand-pathed (single SVG, no extra
 * dependency) and uses `currentColor` so it inherits text color when needed.
 */
export const Logo = forwardRef<SVGSVGElement, LogoProps>(
  ({ size = 24, withWordmark = false, className, ...props }, ref) => {
    if (!withWordmark) {
      return (
        <svg
          ref={ref}
          width={size}
          height={size}
          viewBox="0 0 24 24"
          role="img"
          aria-label="Salve"
          className={cn('text-brand-600', className)}
          {...props}
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
    return (
      <span className={cn('inline-flex items-center gap-2 text-brand-600', className)}>
        <Logo size={size} />
        <span className="text-base font-semibold tracking-tight text-foreground">Salve</span>
      </span>
    );
  },
);
Logo.displayName = 'Logo';
