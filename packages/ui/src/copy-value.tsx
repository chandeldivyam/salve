// CopyValue — render a value with a copy button. Two variants:
//   - `inline` — value as monospace text + small copy icon button on the right.
//   - `block`  — value in a code-block-styled card with a copy button overlaid
//                top-right.
//
// We deliberately do NOT couple this to apps/web `lib/feedback`. The button
// swaps to a check icon and shows a transient inline "Copied" badge for
// ~1.2s. Consumers can pass `onCopy` to fire toasts (showSuccess) at the
// call site.

import { Check, Copy } from 'lucide-react';
import { type HTMLAttributes, useCallback, useEffect, useRef, useState } from 'react';
import { cn } from './utils.js';

export interface CopyValueProps extends Omit<HTMLAttributes<HTMLDivElement>, 'onCopy'> {
  /** The value that gets written to the clipboard. */
  value: string;
  /** Optional accessible label, used for `aria-label` and the toast hook. */
  label?: string;
  /** Visual variant. Defaults to `inline`. */
  variant?: 'inline' | 'block';
  /** Optional override of how the value is displayed; copy still uses `value`. */
  display?: string;
  /** Fires after a successful clipboard write. Use this to surface a toast. */
  onCopy?: (value: string, label?: string) => void;
}

const COPIED_DURATION_MS = 1200;

export function CopyValue({
  value,
  label,
  variant = 'inline',
  display,
  className,
  onCopy,
  ...rest
}: CopyValueProps) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      onCopy?.(value, label);
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(false), COPIED_DURATION_MS);
    } catch {
      // Clipboard access can fail in non-secure contexts; consumers see no
      // success toast and the icon stays as Copy. Swallow the error here so
      // we don't crash the row.
    }
  }, [value, label, onCopy]);

  const ariaLabel = `Copy ${label || 'value'}`;

  if (variant === 'block') {
    return (
      <div
        className={cn(
          'group relative w-full overflow-hidden rounded-md border border-border bg-surface-muted',
          className,
        )}
        {...rest}
      >
        <pre className="max-h-48 w-full overflow-auto whitespace-pre-wrap break-all p-3 pr-12 font-mono text-[12px] text-foreground">
          {display ?? value}
        </pre>
        <button
          type="button"
          aria-label={ariaLabel}
          onClick={handleCopy}
          className={cn(
            'absolute right-2 top-2 inline-flex h-7 items-center gap-1 rounded-md border border-border bg-surface px-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-surface hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
            copied && 'border-success-border bg-success-soft text-success-soft-foreground',
          )}
        >
          {copied ? (
            <>
              <Check className="h-3 w-3" aria-hidden="true" />
              <span>Copied</span>
            </>
          ) : (
            <>
              <Copy className="h-3 w-3" aria-hidden="true" />
              <span>Copy</span>
            </>
          )}
        </button>
        {/*
          Visually-hidden a11y live region. Some screen readers don't
          reliably announce label changes inside a button when the button
          itself is the polite live source — pairing the button with a
          sibling status node makes the announcement consistent. Mirrors
          the pattern used by the inline variant above.
        */}
        <span role="status" aria-live="polite" className="sr-only">
          {copied ? `Copied ${label || 'value'}` : ''}
        </span>
      </div>
    );
  }

  return (
    <div
      className={cn(
        'group inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-md border border-border bg-surface-muted px-2 py-1 align-middle',
        className,
      )}
      {...rest}
    >
      <span className="min-w-0 truncate font-mono text-[12px] text-foreground">
        {display ?? value}
      </span>
      <button
        type="button"
        aria-label={ariaLabel}
        onClick={handleCopy}
        className={cn(
          'inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-surface hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background',
          copied && 'text-success-soft-foreground',
        )}
      >
        {copied ? (
          <Check className="h-3 w-3" aria-hidden="true" />
        ) : (
          <Copy className="h-3 w-3" aria-hidden="true" />
        )}
      </button>
      {copied ? (
        <span
          className="inline-flex shrink-0 items-center rounded-full bg-success-soft px-1.5 py-0.5 text-[10px] font-medium text-success-soft-foreground"
          role="status"
          aria-live="polite"
        >
          Copied
        </span>
      ) : null}
    </div>
  );
}
