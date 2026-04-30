import {
  type ComponentPropsWithoutRef,
  type ElementType,
  forwardRef,
  type HTMLAttributes,
} from 'react';
import { cn } from './utils.js';

export const Card = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        'rounded-2xl border border-border bg-surface text-surface-foreground shadow-sm',
        className,
      )}
      {...props}
    />
  ),
);
Card.displayName = 'Card';

// Stack title-then-description vertically. `block` here is belt-and-braces so
// even if Tailwind's flex utilities ever fail to load, children still cascade
// top-to-bottom rather than collapse into inline-block siblings.
export const CardHeader = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('block flex flex-col gap-1.5 p-6', className)} {...props} />
  ),
);
CardHeader.displayName = 'CardHeader';

export interface CardTitleProps extends HTMLAttributes<HTMLHeadingElement> {
  /** Render the title as a different heading level (default: "h3"). Auth pages
   *  pass "h1" so the page heading lands at the top of the a11y outline. */
  as?: ElementType;
}

export const CardTitle = forwardRef<HTMLHeadingElement, CardTitleProps>(
  ({ as, className, ...props }, ref) => {
    const Comp = (as ?? 'h3') as ElementType;
    return (
      <Comp
        ref={ref}
        className={cn('block text-lg font-semibold leading-tight tracking-tight', className)}
        {...props}
      />
    );
  },
);
CardTitle.displayName = 'CardTitle';

export const CardDescription = forwardRef<HTMLParagraphElement, ComponentPropsWithoutRef<'p'>>(
  ({ className, ...props }, ref) => (
    <p ref={ref} className={cn('block text-sm text-muted-foreground', className)} {...props} />
  ),
);
CardDescription.displayName = 'CardDescription';

export const CardContent = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('p-6 pt-0', className)} {...props} />
  ),
);
CardContent.displayName = 'CardContent';

export const CardFooter = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('flex items-center p-6 pt-0', className)} {...props} />
  ),
);
CardFooter.displayName = 'CardFooter';
