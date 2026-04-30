import { cn } from '@opendesk/ui';
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';
import { dismissFeedback, type FeedbackMessage, useFeedbackMessages } from '@/lib/feedback';

const toneClasses: Record<FeedbackMessage['tone'], string> = {
  info: 'border-border bg-popover text-popover-foreground',
  success: 'border-success-border bg-success-soft text-success-soft-foreground',
  error: 'border-danger-border bg-danger-soft text-danger-soft-foreground',
};

const iconClasses: Record<FeedbackMessage['tone'], string> = {
  info: 'text-muted-foreground',
  success: 'text-success',
  error: 'text-danger',
};

const toneIcon = {
  info: Info,
  success: CheckCircle2,
  error: AlertCircle,
};

export function FeedbackToasts() {
  const messages = useFeedbackMessages();

  if (messages.length === 0) return null;

  return (
    <div
      aria-live="polite"
      aria-relevant="additions removals"
      className="pointer-events-none fixed right-4 top-4 z-50 flex w-[min(28rem,calc(100vw-2rem))] flex-col gap-2"
    >
      {messages.map((message) => (
        <FeedbackToast key={message.id} message={message} />
      ))}
    </div>
  );
}

function FeedbackToast({ message }: { message: FeedbackMessage }) {
  const Icon = toneIcon[message.tone];

  return (
    <div
      className={cn(
        'pointer-events-auto flex items-start gap-3 rounded-lg border px-3 py-2.5 text-sm shadow-lg',
        toneClasses[message.tone],
      )}
    >
      <Icon className={cn('mt-0.5 h-4 w-4 shrink-0', iconClasses[message.tone])} />
      <div className="min-w-0 flex-1">
        <p className="font-medium leading-5">{message.title}</p>
        {message.description ? (
          <p className="mt-0.5 break-words text-xs leading-5 opacity-80">{message.description}</p>
        ) : null}
      </div>
      <button
        type="button"
        aria-label="Dismiss notification"
        onClick={() => dismissFeedback(message.id)}
        className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-current opacity-55 hover:bg-foreground/10 hover:opacity-100"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
