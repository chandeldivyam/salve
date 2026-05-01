import { Avatar, AvatarFallback, Badge, cn, initialsFromName } from '@opendesk/ui';
import { format } from 'date-fns';
import { Lock, Paperclip, ShieldCheck } from 'lucide-react';
import type { AuthSignal, InboundAuthResults, TimelineDelivery, TimelineMessage } from './types';

const apiBase = (import.meta.env.VITE_API_URL as string | undefined) ?? '';

interface MessageBubbleProps {
  message: TimelineMessage;
  isSelf: boolean;
  delivery?: TimelineDelivery | null;
  inboundAuth?: InboundAuthResults | null;
}

export function MessageBubble({ message, isSelf, delivery, inboundAuth }: MessageBubbleProps) {
  const isAgent = message.authorType === 'agent' || message.authorType === 'system';
  const author = message.authorUser ?? message.authorCustomer;
  const authorName = message.authorCustomer?.displayName ?? author?.name;
  const ts = new Date(message.createdAt);

  if (message.isInternal) {
    return (
      <div
        data-message-id={message.id}
        className="rounded-lg border border-warning-border bg-warning-soft px-4 py-3"
      >
        <div className="mb-1 flex items-center gap-2 text-[11px] font-semibold text-warning-soft-foreground">
          <Lock className="h-3 w-3" />
          <span>Internal note</span>
          <span className="ml-auto text-[10px] font-normal tabular-nums text-warning-soft-foreground/80">
            {format(ts, 'MMM d, h:mm a')}
          </span>
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
    );
  }

  return (
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
      <p
        className={cn(
          'flex flex-wrap items-center gap-1.5 px-10 text-[10.5px] tabular-nums text-fg-tertiary',
          isAgent ? 'self-end text-right' : 'self-start',
        )}
      >
        <span>
          {authorName ?? author?.email ?? 'Unknown'}
          {isSelf ? ' (you)' : ''} · {format(ts, 'MMM d, h:mm a')}
        </span>
        {isAgent && delivery ? (
          <DeliveryBadge status={delivery.status} error={delivery.error} />
        ) : null}
        {!isAgent && inboundAuth ? <AuthResultsBadges results={inboundAuth} /> : null}
      </p>
    </div>
  );
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
