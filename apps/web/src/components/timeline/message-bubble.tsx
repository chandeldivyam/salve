import { MESSAGE_EDIT_WINDOW_MS, mutators } from '@salve/mutators';
import {
  Avatar,
  AvatarFallback,
  Badge,
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
  initialsFromName,
} from '@salve/ui';
import { format } from 'date-fns';
import { Lock, MoreHorizontal, Paperclip, Pencil, ShieldCheck, Trash2 } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { showError } from '@/lib/feedback';
import { useZero } from '@/lib/zero';
import type { AuthSignal, InboundAuthResults, TimelineDelivery, TimelineMessage } from './types';

const apiBase = (import.meta.env.VITE_API_URL as string | undefined) ?? '';

interface MessageBubbleProps {
  message: TimelineMessage;
  isSelf: boolean;
  delivery?: TimelineDelivery | null;
  inboundAuth?: InboundAuthResults | null;
}

export function MessageBubble({ message, isSelf, delivery, inboundAuth }: MessageBubbleProps) {
  const z = useZero();
  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const isAgent = message.authorType === 'agent' || message.authorType === 'system';
  const author = message.authorUser ?? message.authorCustomer;
  const authorName = message.authorCustomer?.displayName ?? author?.name;
  const ts = new Date(message.createdAt);
  // Phase B: edit/delete is allowed only on internal notes. Public outbound
  // replies (email today; WhatsApp/Slack/etc. later) are immutable once
  // authored — we can't un-send what's already in the customer's inbox.
  // Future: a per-channel send-delay setting will open a grace window for
  // `outbound_message.status='queued'`, and channels that natively support
  // edit (WhatsApp / Slack) will gain a post-send edit path. Until those
  // land, the UI hides the action menu on outbound messages entirely.
  const canDelete =
    isSelf && message.authorType === 'agent' && !!message.ticketID && message.isInternal;
  const canEdit =
    canDelete && Date.now() - message.createdAt <= MESSAGE_EDIT_WINDOW_MS && !message.deletedAt;

  async function performDelete() {
    if (!message.ticketID) return;
    setDeleting(true);
    try {
      await z.mutate(mutators.message.delete({ id: message.id, ticketID: message.ticketID }));
      setConfirmingDelete(false);
    } catch (error) {
      showError(error, "Couldn't delete note.");
    } finally {
      setDeleting(false);
    }
  }

  const actions =
    canDelete && !message.deletedAt ? (
      <MessageActions
        canEdit={canEdit}
        onEdit={() => setEditing(true)}
        onDelete={() => setConfirmingDelete(true)}
      />
    ) : null;

  const deleteDialog = (
    <Dialog open={confirmingDelete} onOpenChange={setConfirmingDelete}>
      <DialogContent
        hideClose
        className="w-[min(calc(100vw-2rem),28rem)] gap-0"
        onEscapeKeyDown={deleting ? (event) => event.preventDefault() : undefined}
      >
        <DialogHeader>
          <DialogTitle>Delete note</DialogTitle>
          <DialogDescription>
            Removes this internal note from the conversation. Other agents won't see it again.
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
  );

  if (editing && message.ticketID) {
    return (
      <>
        <MessageEditForm
          message={message}
          isAgent={isAgent}
          onCancel={() => setEditing(false)}
          onSaved={() => setEditing(false)}
        />
        {deleteDialog}
      </>
    );
  }

  if (message.deletedAt) {
    return (
      <>
        <div
          data-message-id={message.id}
          className={cn('flex', isAgent ? 'justify-end' : 'justify-start')}
        >
          <div className="inline-flex max-w-[75%] items-center gap-2 rounded-md border border-line-default bg-bg-elevated px-3 py-2 text-[12px] text-fg-tertiary">
            <Trash2 className="h-3.5 w-3.5" />
            <span>Note deleted</span>
            <span className="text-[10.5px] tabular-nums">{format(ts, 'MMM d, h:mm a')}</span>
          </div>
        </div>
        {deleteDialog}
      </>
    );
  }

  if (message.isInternal) {
    return (
      <>
        <div
          data-message-id={message.id}
          className="rounded-lg border border-warning-border bg-warning-soft px-4 py-3"
        >
          <div className="mb-1 flex items-center gap-2 text-[11px] font-semibold text-warning-soft-foreground">
            <Lock className="h-3 w-3" />
            <span>Internal note</span>
            <span className="ml-auto text-[10px] font-normal tabular-nums text-warning-soft-foreground/80">
              {format(ts, 'MMM d, h:mm a')}
              {message.editedAt ? ' · edited' : ''}
            </span>
            {actions}
          </div>
          <div
            className="prose prose-sm max-w-none text-[13px] leading-relaxed text-warning-soft-foreground"
            // biome-ignore lint/security/noDangerouslySetInnerHtml: composer Tiptap output is rendered by the existing message UI.
            dangerouslySetInnerHTML={{ __html: message.bodyHtml }}
          />
          <AttachmentList attachments={message.attachments} />
          <p className="mt-2 text-[11px] text-warning-soft-foreground/70">
            {authorName ?? author?.email ?? 'Unknown'}
          </p>
        </div>
        {deleteDialog}
      </>
    );
  }

  return (
    <>
      <div
        data-message-id={message.id}
        className={cn(
          'flex flex-col gap-1 rounded-md transition-shadow',
          isAgent ? 'items-end' : 'items-start',
        )}
      >
        <div className={cn('flex w-full items-end gap-2', isAgent && 'flex-row-reverse')}>
          <Avatar size={28}>
            <AvatarFallback>{initialsFromName(authorName, author?.email)}</AvatarFallback>
          </Avatar>
          <div
            className={cn(
              'max-w-[75%] rounded-2xl px-4 py-2.5 text-[13px]',
              isAgent
                ? 'bg-brand-soft text-brand-soft-foreground ring-1 ring-brand-border'
                : 'bg-bg-panel text-fg-primary ring-1 ring-line-default',
            )}
          >
            <div
              className="prose prose-sm max-w-none leading-relaxed"
              // biome-ignore lint/security/noDangerouslySetInnerHtml: composer Tiptap output is rendered by the existing message UI.
              dangerouslySetInnerHTML={{ __html: message.bodyHtml }}
            />
            <AttachmentList attachments={message.attachments} />
          </div>
        </div>
        <div
          className={cn(
            'flex flex-wrap items-center gap-1.5 px-10 text-[10.5px] tabular-nums text-fg-tertiary',
            isAgent ? 'self-end text-right' : 'self-start',
          )}
        >
          <span>
            {authorName ?? author?.email ?? 'Unknown'}
            {isSelf ? ' (you)' : ''} · {format(ts, 'MMM d, h:mm a')}
            {message.editedAt ? ' · edited' : ''}
          </span>
          {isAgent && delivery ? (
            <DeliveryBadge status={delivery.status} error={delivery.error} />
          ) : null}
          {!isAgent && inboundAuth ? <AuthResultsBadges results={inboundAuth} /> : null}
          {actions}
        </div>
      </div>
      {deleteDialog}
    </>
  );
}

function MessageEditForm({
  message,
  isAgent,
  onCancel,
  onSaved,
}: {
  message: TimelineMessage;
  isAgent: boolean;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const z = useZero();
  const [body, setBody] = useState(message.bodyText);
  const [saving, setSaving] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = body.trim();
    if (!message.ticketID || !trimmed) return;
    setSaving(true);
    try {
      await z.mutate(
        mutators.message.update({
          id: message.id,
          ticketID: message.ticketID,
          bodyHTML: htmlFromPlainText(trimmed),
          bodyText: trimmed,
        }),
      );
      onSaved();
    } catch (error) {
      showError(error, 'Could not update message');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      data-message-id={message.id}
      onSubmit={onSubmit}
      className={cn('flex flex-col gap-2', isAgent ? 'items-end' : 'items-start')}
    >
      <textarea
        value={body}
        onChange={(event) => setBody(event.target.value)}
        className={cn(
          'min-h-28 w-full max-w-[75%] resize-y rounded-lg border border-line-default bg-bg-panel px-3 py-2 text-[13px] leading-relaxed text-fg-primary shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          isAgent && 'bg-brand-soft text-brand-soft-foreground ring-1 ring-brand-border',
        )}
      />
      <div className={cn('flex items-center gap-2 px-10', isAgent && 'justify-end')}>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={saving || !body.trim()}>
          {saving ? 'Saving...' : 'Save'}
        </Button>
      </div>
    </form>
  );
}

function MessageActions({
  canEdit,
  onEdit,
  onDelete,
}: {
  canEdit: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Note actions"
          className="grid h-5 w-5 place-items-center rounded-md text-fg-tertiary hover:bg-bg-elevated hover:text-fg-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <MoreHorizontal className="h-3.5 w-3.5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {canEdit ? (
          <DropdownMenuItem onSelect={onEdit}>
            <Pencil className="h-3.5 w-3.5" />
            Edit note
          </DropdownMenuItem>
        ) : null}
        {canEdit ? <DropdownMenuSeparator /> : null}
        <DropdownMenuItem onSelect={onDelete}>
          <Trash2 className="h-3.5 w-3.5" />
          Delete note
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function htmlFromPlainText(text: string) {
  return text
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function AuthResultsBadges({ results }: { results: InboundAuthResults }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <ShieldCheck className="h-3 w-3 text-fg-tertiary" />
      <AuthBadge label="SPF" value={results.spf} />
      <AuthBadge label="DKIM" value={results.dkim} />
      <AuthBadge label="DMARC" value={results.dmarc} />
    </span>
  );
}

function AuthBadge({ label, value }: { label: string; value: AuthSignal }) {
  return (
    <Badge variant={authVariant(value)} title={`${label}: ${value}`}>
      {label} {value}
    </Badge>
  );
}

function authVariant(value: AuthSignal): 'default' | 'success' | 'warning' | 'danger' | 'muted' {
  switch (value) {
    case 'pass':
      return 'success';
    case 'fail':
    case 'permerror':
      return 'danger';
    case 'softfail':
    case 'temperror':
      return 'warning';
    case 'neutral':
    case 'none':
    case 'unknown':
      return 'muted';
    default:
      return 'default';
  }
}

function DeliveryBadge({ status, error }: { status: string; error?: string | null }) {
  const variant: 'default' | 'success' | 'warning' | 'danger' | 'muted' =
    status === 'sent' || status === 'delivered'
      ? 'success'
      : status === 'queued' || status === 'sending'
        ? 'warning'
        : status === 'bounced' || status === 'complained' || status === 'failed'
          ? 'danger'
          : 'muted';
  return (
    <Badge variant={variant} title={error ?? undefined}>
      {status}
    </Badge>
  );
}

function AttachmentList({ attachments }: Pick<TimelineMessage, 'attachments'>) {
  if (!attachments || attachments.length === 0) return null;

  async function onClick(s3Key: string) {
    try {
      const res = await fetch(`${apiBase}/api/files/get`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ s3Key }),
      });
      if (!res.ok) throw new Error('failed to fetch download url');
      const { getUrl } = (await res.json()) as { getUrl: string };
      window.open(getUrl, '_blank');
    } catch (error) {
      console.error('attachment download', error);
    }
  }

  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {attachments.map((attachment) => (
        <button
          key={attachment.id}
          type="button"
          onClick={() => onClick(attachment.s3Key)}
          className="inline-flex items-center gap-1 rounded-md border border-line-default bg-bg-panel px-2 py-1 text-[11px] text-fg-tertiary hover:bg-bg-elevated hover:text-fg-primary"
        >
          <Paperclip className="h-3 w-3" />
          <span className="max-w-[160px] truncate">{attachment.filename}</span>
          <span>·</span>
          <span>{formatBytes(attachment.sizeBytes)}</span>
        </button>
      ))}
    </div>
  );
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
