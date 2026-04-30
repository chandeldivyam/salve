import { forwardRef, type HTMLAttributes } from 'react';
import { cn } from './utils.js';

export interface FormActionsProps extends HTMLAttributes<HTMLDivElement> {
  align?: 'start' | 'end' | 'between';
}

export const FormActions = forwardRef<HTMLDivElement, FormActionsProps>(
  ({ className, align = 'end', ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        'flex flex-wrap items-center gap-2',
        align === 'end' && 'justify-end',
        align === 'start' && 'justify-start',
        align === 'between' && 'justify-between',
        className,
      )}
      {...props}
    />
  ),
);
FormActions.displayName = 'FormActions';
