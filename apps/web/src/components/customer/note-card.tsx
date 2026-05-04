import { mutators } from '@opendesk/mutators';
import {
  Button,
  cn,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@opendesk/ui';
import { MoreHorizontal, Pencil, Pin, PinOff, StickyNote, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { relativeTime } from '@/components/timeline/timeline-format';
import type { TimelineCustomerNote } from '@/components/timeline/types';
import { showError } from '@/lib/feedback';
import { useZero } from '@/lib/zero';
import { NoteComposer } from './note-composer';

interface NoteCardProps {
  note: TimelineCustomerNote;
  currentUserID: string;
  variant?: 'default' | 'compact';
  className?: string;
}

export function NoteCard({ note, currentUserID, variant = 'default', className }: NoteCardProps) {
  const z = useZero();
  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const isAuthor = note.createdByID === currentUserID;
  const author = note.createdBy?.name ?? note.createdBy?.email ?? null;
  const labelPrefix = note.objectType === 'ticket' ? 'Conversation note' : 'Customer note';
  const compact = variant === 'compact';

  if (editing) {
    return (
      <NoteComposer
        scope={note.objectType}
        customerID={note.customerID}
        ticketID={note.objectType === 'ticket' ? note.objectID : undefined}
        noteID={note.id}
        initialBody={note.bodyText}
        initialPinned={note.pinned}
        onClose={() => setEditing(false)}
        onSaved={() => setEditing(false)}
      />
    );
  }

  async function togglePin() {
    try {
      await z.mutate(mutators.customerNote.togglePin({ id: note.id }));
    } catch (error) {
      showError(error, 'Could not update pin');
    }
  }

  async function performDelete() {
    setDeleting(true);
    try {
      await z.mutate(mutators.customerNote.delete({ id: note.id }));
      setConfirmingDelete(false);
    } catch (error) {
      showError(error, 'Could not delete note');
    } finally {
      setDeleting(false);
    }
  }

  return (
    <article
      className={cn(
        'group/note relative rounded-md bg-warning-soft/30 px-3 py-2 ring-1 ring-warning-border/40',
        compact && 'rounded-sm bg-transparent px-1 py-1.5 ring-0',
        className,
      )}
    >
      <div className="flex items-start gap-2">
        <StickyNote
          className={cn(
            'mt-0.5 h-3.5 w-3.5 shrink-0',
            compact ? 'text-fg-quaternary' : 'text-warning',
          )}
          aria-hidden="true"
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[12px] font-medium text-fg-primary">
              {note.pinned ? `Pinned ${labelPrefix.toLowerCase()}` : labelPrefix}
            </span>
            {author ? <span className="text-[11px] text-fg-tertiary">· {author}</span> : null}
            <span className="text-[11px] tabular-nums text-fg-tertiary">
              · {relativeTime(note.createdAt)}
            </span>
            {note.editedAt ? (
              <span className="text-[11px] text-fg-quaternary">· edited</span>
            ) : null}
          </div>
          <p className="mt-1 whitespace-pre-wrap break-words text-[13px] leading-relaxed text-fg-secondary">
            {note.bodyText}
          </p>
        </div>
        {isAuthor ? (
          <div className="pointer-events-none absolute right-1.5 top-1.5 opacity-0 transition-opacity group-hover/note:pointer-events-auto group-hover/note:opacity-100 focus-within:pointer-events-auto focus-within:opacity-100">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label="Note actions"
                  className="grid h-6 w-6 place-items-center rounded-md text-fg-tertiary hover:bg-warning-border/40 hover:text-fg-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <MoreHorizontal className="h-3.5 w-3.5" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => setEditing(true)}>
                  <Pencil className="h-3.5 w-3.5" />
                  Edit
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={togglePin}>
                  {note.pinned ? (
                    <>
                      <PinOff className="h-3.5 w-3.5" />
                      Unpin
                    </>
                  ) : (
                    <>
                      <Pin className="h-3.5 w-3.5" />
                      Pin
                    </>
                  )}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => setConfirmingDelete(true)}>
                  <Trash2 className="h-3.5 w-3.5" />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ) : null}
      </div>
      <Dialog open={confirmingDelete} onOpenChange={setConfirmingDelete}>
        <DialogContent
          hideClose
          className="w-[min(calc(100vw-2rem),28rem)] gap-0"
          onEscapeKeyDown={deleting ? (event) => event.preventDefault() : undefined}
        >
          <DialogHeader>
            <DialogTitle>Delete note</DialogTitle>
            <DialogDescription>
              The note will be removed from this{' '}
              {note.objectType === 'ticket' ? 'conversation' : 'customer profile'}. This can't be
              undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => setConfirmingDelete(false)}
              disabled={deleting}
            >
              Cancel
            </Button>
            <Button type="button" variant="destructive" onClick={performDelete} disabled={deleting}>
              {deleting ? 'Deleting…' : 'Delete note'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </article>
  );
}
