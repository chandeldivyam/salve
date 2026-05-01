// Sheet — side-anchored Dialog. Right-anchored by default, full height,
// 480px max width. Wraps Radix Dialog.

import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import {
  type ComponentPropsWithoutRef,
  type ElementRef,
  forwardRef,
  type HTMLAttributes,
} from 'react';
import { DialogOverlay, DialogPortal } from './dialog.js';
import { cn } from './utils.js';

export const Sheet = DialogPrimitive.Root;
export const SheetTrigger = DialogPrimitive.Trigger;
export const SheetClose = DialogPrimitive.Close;

export const SheetContent = forwardRef<
  ElementRef<typeof DialogPrimitive.Content>,
  ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
    side?: 'right' | 'left';
    hideClose?: boolean;
  }
>(({ className, children, side = 'right', hideClose, ...props }, ref) => (
  <DialogPortal>
    <DialogOverlay />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        'fixed inset-y-0 z-50 flex w-[min(480px,100vw)] flex-col border-border bg-popover text-popover-foreground shadow-2xl outline-none',
        side === 'right'
          ? 'right-0 border-l data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right'
          : 'left-0 border-r data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left',
        'data-[state=open]:animate-in data-[state=closed]:animate-out',
        className,
      )}
      {...props}
    >
      {children}
      {hideClose ? null : (
        <DialogPrimitive.Close
          aria-label="Close"
          className="absolute right-3 top-3 grid h-7 w-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="h-3.5 w-3.5" />
        </DialogPrimitive.Close>
      )}
    </DialogPrimitive.Content>
  </DialogPortal>
));
SheetContent.displayName = 'SheetContent';

export const SheetHeader = ({ className, ...props }: HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      'flex shrink-0 flex-col gap-1 border-b border-border px-5 py-4 pr-12',
      className,
    )}
    {...props}
  />
);

export const SheetBody = ({ className, ...props }: HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn('flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-5 py-5', className)}
    {...props}
  />
);

export const SheetFooter = ({ className, ...props }: HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      'flex shrink-0 items-center justify-end gap-2 border-t border-border bg-surface px-5 py-3',
      className,
    )}
    {...props}
  />
);

export const SheetTitle = forwardRef<
  ElementRef<typeof DialogPrimitive.Title>,
  ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn('text-[14px] font-semibold tracking-[-0.011em] text-foreground', className)}
    {...props}
  />
));
SheetTitle.displayName = DialogPrimitive.Title.displayName;

export const SheetDescription = forwardRef<
  ElementRef<typeof DialogPrimitive.Description>,
  ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn('text-[12px] text-muted-foreground', className)}
    {...props}
  />
));
SheetDescription.displayName = DialogPrimitive.Description.displayName;
