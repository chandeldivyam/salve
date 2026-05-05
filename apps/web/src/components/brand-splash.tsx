// Full-screen brand splash. Used during auth pending (TanStack Router's
// `beforeLoad`) and any time the workspace is bootstrapping. Designed to
// be visually identical to the inline `#initial-splash` div in
// `index.html` so the hand-off from "browser painted HTML before React"
// to "React painted the same splash" is seamless — no flash.
//
// The animation is a subtle breathing scale on the leaf glyph plus three
// trailing dots. Restraint over decoration: no spinners, no bars.

import { cn, Logo } from '@salve/ui';

interface BrandSplashProps {
  className?: string;
  /** Optional caption shown beneath the logo (e.g. "Loading workspace…"). */
  label?: string;
}

export function BrandSplash({ className, label }: BrandSplashProps) {
  return (
    <div
      className={cn('fixed inset-0 z-50 grid place-items-center bg-background', className)}
      role="status"
      aria-live="polite"
      aria-label={label ?? 'Loading'}
    >
      <div className="flex flex-col items-center gap-5">
        <div className="brand-splash-logo">
          <Logo size={56} />
        </div>
        <div className="brand-splash-dots" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        {label ? (
          <p className="text-xs font-medium tracking-wide text-muted-foreground">{label}</p>
        ) : null}
      </div>
    </div>
  );
}
