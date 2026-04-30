// Avatar — Radix-based with a tiny initials-fallback. Sized via the `size`
// prop (in px) to keep dense list rows aligned to the line-height grid.

import * as AvatarPrimitive from '@radix-ui/react-avatar';
import { type ComponentPropsWithoutRef, type ElementRef, forwardRef } from 'react';
import { cn } from './utils.js';

export interface AvatarProps extends ComponentPropsWithoutRef<typeof AvatarPrimitive.Root> {
  size?: number;
}

export const Avatar = forwardRef<ElementRef<typeof AvatarPrimitive.Root>, AvatarProps>(
  ({ className, size = 28, style, ...props }, ref) => (
    <AvatarPrimitive.Root
      ref={ref}
      className={cn(
        'relative inline-flex shrink-0 overflow-hidden rounded-full bg-muted align-middle',
        className,
      )}
      style={{ width: size, height: size, ...style }}
      {...props}
    />
  ),
);
Avatar.displayName = 'Avatar';

export const AvatarImage = forwardRef<
  ElementRef<typeof AvatarPrimitive.Image>,
  ComponentPropsWithoutRef<typeof AvatarPrimitive.Image>
>(({ className, ...props }, ref) => (
  <AvatarPrimitive.Image
    ref={ref}
    className={cn('aspect-square h-full w-full object-cover', className)}
    {...props}
  />
));
AvatarImage.displayName = 'AvatarImage';

export const AvatarFallback = forwardRef<
  ElementRef<typeof AvatarPrimitive.Fallback>,
  ComponentPropsWithoutRef<typeof AvatarPrimitive.Fallback>
>(({ className, ...props }, ref) => (
  <AvatarPrimitive.Fallback
    ref={ref}
    className={cn(
      'flex h-full w-full items-center justify-center bg-brand-soft text-[0.65em] font-semibold uppercase text-brand-soft-foreground',
      className,
    )}
    {...props}
  />
));
AvatarFallback.displayName = 'AvatarFallback';

/**
 * Convenience: derive 1-2 letter initials from a free-form name or email.
 * Picks the first letter of up to two whitespace-separated words; falls back
 * to the first 2 chars if there's only one token.
 */
export function initialsFromName(name?: string | null, email?: string | null): string {
  const source = name?.trim() || email?.split('@')[0] || '';
  if (!source) return '?';
  const parts = source.split(/[\s._-]+/).filter(Boolean);
  const a = parts[0];
  const b = parts[1];
  if (a && b) {
    return (a.charAt(0) + b.charAt(0)).toUpperCase();
  }
  return source.slice(0, 2).toUpperCase();
}
