// Field — composable form field primitives. Pair with `react-hook-form` +
// `zod` resolver in apps/web. The wiring is: <Field name="x"> renders a
// <div> with a stable id, <FieldLabel> targets that id, <FieldError> emits
// `role="alert"` for screen readers, and <FieldGroup> stacks labelled rows.
//
// The Field contains an `htmlFor` id; child labels/errors derive their
// targeting via the FieldContext when consumers don't pass `htmlFor`/`id`
// explicitly. We export the IDs so consumers can wire `aria-describedby`
// without reaching for hooks.

import {
  createContext,
  forwardRef,
  type HTMLAttributes,
  type LabelHTMLAttributes,
  useContext,
  useId,
} from 'react';
import { cn } from './utils.js';

interface FieldContextValue {
  inputId: string;
  errorId: string;
  descriptionId: string;
  hasError: boolean;
}

const FieldContext = createContext<FieldContextValue | null>(null);

export interface FieldProps extends HTMLAttributes<HTMLDivElement> {
  /** Optional explicit id; auto-generated when omitted. Used as the input id. */
  fieldId?: string;
  /** Surfaces error styling and `aria-invalid` to descendants that consume context. */
  hasError?: boolean;
}

export const Field = forwardRef<HTMLDivElement, FieldProps>(
  ({ className, fieldId, hasError = false, children, ...props }, ref) => {
    const generated = useId();
    const inputId = fieldId ?? `field-${generated}`;
    const errorId = `${inputId}-error`;
    const descriptionId = `${inputId}-description`;

    return (
      <FieldContext.Provider value={{ inputId, errorId, descriptionId, hasError }}>
        <div ref={ref} className={cn('grid gap-1.5', className)} {...props}>
          {children}
        </div>
      </FieldContext.Provider>
    );
  },
);
Field.displayName = 'Field';

export function useFieldContext(): FieldContextValue | null {
  return useContext(FieldContext);
}

export interface FieldLabelProps extends LabelHTMLAttributes<HTMLLabelElement> {}

export const FieldLabel = forwardRef<HTMLLabelElement, FieldLabelProps>(
  ({ className, htmlFor, ...props }, ref) => {
    const ctx = useContext(FieldContext);
    return (
      // biome-ignore lint/a11y/noLabelWithoutControl: htmlFor is wired via FieldContext; consumers always render an input as a sibling within the same Field.
      <label
        ref={ref}
        htmlFor={htmlFor ?? ctx?.inputId}
        className={cn(
          'text-sm font-medium leading-none text-foreground peer-disabled:cursor-not-allowed peer-disabled:opacity-70',
          className,
        )}
        {...props}
      />
    );
  },
);
FieldLabel.displayName = 'FieldLabel';

export const FieldDescription = forwardRef<
  HTMLParagraphElement,
  HTMLAttributes<HTMLParagraphElement>
>(({ className, id, ...props }, ref) => {
  const ctx = useContext(FieldContext);
  return (
    <p
      ref={ref}
      id={id ?? ctx?.descriptionId}
      className={cn('text-xs text-muted-foreground', className)}
      {...props}
    />
  );
});
FieldDescription.displayName = 'FieldDescription';

export interface FieldErrorProps extends HTMLAttributes<HTMLParagraphElement> {
  children?: React.ReactNode;
}

export const FieldError = forwardRef<HTMLParagraphElement, FieldErrorProps>(
  ({ className, id, children, ...props }, ref) => {
    const ctx = useContext(FieldContext);
    if (!children) return null;
    return (
      <p
        ref={ref}
        id={id ?? ctx?.errorId}
        role="alert"
        className={cn('text-sm text-danger-soft-foreground', className)}
        {...props}
      >
        {children}
      </p>
    );
  },
);
FieldError.displayName = 'FieldError';

export const FieldGroup = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('grid gap-4', className)} {...props} />
  ),
);
FieldGroup.displayName = 'FieldGroup';
