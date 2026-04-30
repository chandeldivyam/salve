// LoadingButton — Button + a spinner overlay. Preserves intrinsic width by
// keeping the children mounted (visibility-hidden) underneath the spinner so
// the layout never jumps when toggling the loading state.

import { Loader2 } from 'lucide-react';
import { forwardRef } from 'react';
import { Button, type ButtonProps } from './button.js';
import { cn } from './utils.js';

export interface LoadingButtonProps extends ButtonProps {
  loading?: boolean;
  loadingText?: string;
}

export const LoadingButton = forwardRef<HTMLButtonElement, LoadingButtonProps>(
  ({ loading = false, loadingText, disabled, className, children, ...props }, ref) => {
    return (
      <Button
        ref={ref}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        className={cn('relative', className)}
        {...props}
      >
        <span
          className={cn('inline-flex items-center gap-2', loading && !loadingText && 'invisible')}
        >
          {children}
        </span>
        {loading ? (
          <span className="absolute inset-0 inline-flex items-center justify-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            {loadingText ? <span>{loadingText}</span> : null}
          </span>
        ) : null}
      </Button>
    );
  },
);
LoadingButton.displayName = 'LoadingButton';
