import { mutators } from '@opendesk/mutators';
import { Button, cn } from '@opendesk/ui';
import { Pin, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { showError } from '@/lib/feedback';
import { useShortcut } from '@/lib/shortcuts';
import { useZero } from '@/lib/zero';

interface NoteComposerProps {
  scope: 'customer' | 'ticket';
  customerID: string;
  ticketID?: string;
  noteID?: string;
  initialBody?: string;
  initialPinned?: boolean;
  autoFocus?: boolean;
  className?: string;
  onClose?: () => void;
  onSaved?: () => void;
}

export function NoteComposer({
  scope,
  customerID,
  ticketID,
  noteID,
  initialBody,
  initialPinned,
  autoFocus = true,
  className,
  onClose,
  onSaved,
}: NoteComposerProps) {
  const z = useZero();
  const [body, setBody] = useState(initialBody ?? '');
  const [pinned, setPinned] = useState(initialPinned ?? false);
  const [saving, setSaving] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (autoFocus) {
      textareaRef.current?.focus();
    }
  }, [autoFocus]);

  useEffect(() => {
    autoresize(textareaRef.current);
  }, [body]);

  async function submit() {
    const trimmed = body.trim();
    if (!trimmed || saving) return;
    setSaving(true);
    try {
      if (noteID) {
        await z.mutate(
          mutators.customerNote.update({
            id: noteID,
            bodyText: trimmed,
            bodyHtml: textToHtml(trimmed),
          }),
        );
      } else {
        const objectID = scope === 'customer' ? customerID : (ticketID ?? '');
        if (!objectID) {
          throw new Error('Missing target id for note');
        }
        await z.mutate(
          mutators.customerNote.create({
            id: crypto.randomUUID(),
            objectType: scope,
            objectID,
            customerID,
            bodyText: trimmed,
            bodyHtml: textToHtml(trimmed),
            pinned,
          }),
        );
      }
      setBody('');
      setPinned(false);
      onSaved?.();
      onClose?.();
    } catch (error) {
      showError(error, 'Could not save note');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      className={cn(
        'flex flex-col gap-1.5 rounded-md bg-warning-soft/40 px-2.5 py-2 ring-1 ring-warning-border/60',
        className,
      )}
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <textarea
        ref={textareaRef}
        value={body}
        onChange={(event) => setBody(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation();
            onClose?.();
          }
          if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
            event.preventDefault();
            void submit();
          }
        }}
        placeholder={
          scope === 'customer'
            ? 'Note about this customer (visible to teammates only)…'
            : 'Note about this conversation (visible to teammates only)…'
        }
        rows={2}
        className="min-h-[48px] w-full resize-none border-0 bg-transparent text-[13px] leading-relaxed text-fg-primary placeholder:text-fg-tertiary focus:outline-none focus-visible:outline-none"
      />
      <div className="flex items-center justify-between gap-2 border-t border-warning-border/40 pt-1.5">
        <div className="flex min-w-0 items-center gap-1">
          {!noteID ? (
            <button
              type="button"
              onClick={() => setPinned((p) => !p)}
              className={cn(
                'inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-[11px] font-medium transition-colors',
                pinned
                  ? 'bg-warning-border/60 text-fg-primary'
                  : 'text-fg-tertiary hover:bg-warning-border/40 hover:text-fg-primary',
              )}
              aria-pressed={pinned}
            >
              <Pin className="h-3 w-3" />
              {pinned ? 'Pinned' : 'Pin'}
            </button>
          ) : null}
          <span className="ml-1 hidden text-[11px] text-fg-quaternary sm:inline">
            ⌘↵ to save · esc to cancel
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {onClose ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-6 px-2 text-[12px]"
              onClick={onClose}
            >
              <X className="h-3.5 w-3.5" />
              Cancel
            </Button>
          ) : null}
          <Button
            type="submit"
            size="sm"
            className="h-6 px-2.5 text-[12px]"
            disabled={!body.trim() || saving}
          >
            {noteID ? 'Save' : 'Add note'}
          </Button>
        </div>
      </div>
    </form>
  );
}

interface AddNoteButtonProps {
  scope: 'customer' | 'ticket';
  customerID: string;
  ticketID?: string;
  className?: string;
  label?: string;
}

export function AddNoteButton({
  scope,
  customerID,
  ticketID,
  className,
  label = 'Add note',
}: AddNoteButtonProps) {
  const [open, setOpen] = useState(false);
  useShortcut(['n'], () => setOpen(true));

  if (open) {
    return (
      <NoteComposer
        scope={scope}
        customerID={customerID}
        ticketID={ticketID}
        onClose={() => setOpen(false)}
      />
    );
  }
  return (
    <button
      type="button"
      onClick={() => setOpen(true)}
      className={cn(
        'inline-flex h-7 items-center gap-1.5 rounded-md border border-dashed border-line-default px-2.5 text-[12px] text-fg-tertiary transition-colors hover:border-line-strong hover:bg-bg-elevated/40 hover:text-fg-primary',
        className,
      )}
    >
      + {label}
    </button>
  );
}

function autoresize(textarea: HTMLTextAreaElement | null) {
  if (!textarea) return;
  textarea.style.height = 'auto';
  textarea.style.height = `${Math.min(textarea.scrollHeight, 240)}px`;
}

function textToHtml(text: string) {
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return `<p>${escaped.replace(/\n+/g, '</p><p>')}</p>`;
}
