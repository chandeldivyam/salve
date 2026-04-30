// Badge — small pill for status / priority / tags. Variants chosen to align
// with the brand-teal palette in `apps/web/src/styles.css`.

import { cva, type VariantProps } from 'class-variance-authority';
import { forwardRef, type HTMLAttributes } from 'react';
import { cn } from './utils.js';

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium leading-tight ring-1 ring-inset whitespace-nowrap',
  {
    variants: {
      variant: {
        default: 'bg-brand-soft text-brand-soft-foreground ring-brand-border',
        success: 'bg-success-soft text-success-soft-foreground ring-success-border',
        warning: 'bg-warning-soft text-warning-soft-foreground ring-warning-border',
        danger: 'bg-danger-soft text-danger-soft-foreground ring-danger-border',
        muted: 'bg-muted text-muted-foreground ring-border',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

export interface BadgeProps
  extends HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export const Badge = forwardRef<HTMLSpanElement, BadgeProps>(
  ({ className, variant, ...props }, ref) => (
    <span ref={ref} className={cn(badgeVariants({ variant }), className)} {...props} />
  ),
);
Badge.displayName = 'Badge';

export { badgeVariants };
