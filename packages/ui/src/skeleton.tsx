import type { HTMLAttributes } from 'react';
import { cn } from './utils.js';

export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('animate-pulse rounded-md bg-slate-200/70', className)}
      aria-hidden="true"
      {...props}
    />
  );
}
