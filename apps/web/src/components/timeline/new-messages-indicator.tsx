import { Button } from '@opendesk/ui';
import { ArrowDown } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { TimelineMessage } from './types';

interface NewMessagesIndicatorProps {
  messages: ReadonlyArray<TimelineMessage>;
  currentUserID: string;
}

export function NewMessagesIndicator({ messages, currentUserID }: NewMessagesIndicatorProps) {
  const [pending, setPending] = useState<ReadonlyArray<TimelineMessage>>([]);
  const seenIDsRef = useRef<Set<string> | null>(null);

  useEffect(() => {
    const known = seenIDsRef.current;
    if (!known) {
      seenIDsRef.current = new Set(messages.map((message) => message.id));
      return;
    }
    const arrivals: TimelineMessage[] = [];
    for (const message of messages) {
      if (known.has(message.id)) continue;
      known.add(message.id);
      if (message.authorUserID === currentUserID) continue;
      const node = document.querySelector(
        `[data-message-id="${cssEscape(message.id)}"]`,
      ) as HTMLElement | null;
      if (!node) continue;
      const rect = node.getBoundingClientRect();
      if (rect.top >= window.innerHeight - 80) {
        arrivals.push(message);
      }
    }
    if (arrivals.length > 0) {
      setPending((current) => mergeUnique(current, arrivals));
    }
  }, [messages, currentUserID]);

  if (pending.length === 0) return null;

  const latest = pending[pending.length - 1];
  const author =
    latest?.authorCustomer?.name ??
    latest?.authorCustomer?.email ??
    latest?.authorUser?.name ??
    'Someone';
  const label =
    pending.length === 1 ? `${author} sent a new message` : `${pending.length} new messages`;

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-3 z-10 flex justify-center">
      <Button
        type="button"
        size="sm"
        variant="default"
        className="pointer-events-auto h-7 gap-1.5 rounded-full px-3 text-[12px] shadow-md"
        onClick={() => {
          if (latest) {
            const node = document.querySelector(
              `[data-message-id="${cssEscape(latest.id)}"]`,
            ) as HTMLElement | null;
            if (node) {
              node.scrollIntoView({ behavior: 'smooth', block: 'center' });
              node.classList.add('ring-2', 'ring-ring', 'ring-offset-2', 'ring-offset-bg-canvas');
              window.setTimeout(() => {
                node.classList.remove('ring-2', 'ring-ring', 'ring-offset-2', 'ring-offset-bg-canvas');
              }, 1500);
            }
          }
          setPending([]);
        }}
      >
        <ArrowDown className="h-3.5 w-3.5" />
        {label}
      </Button>
    </div>
  );
}

function mergeUnique(
  current: ReadonlyArray<TimelineMessage>,
  next: ReadonlyArray<TimelineMessage>,
) {
  const ids = new Set(current.map((message) => message.id));
  const additions = next.filter((message) => !ids.has(message.id));
  return [...current, ...additions];
}

function cssEscape(value: string) {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(value);
  }
  return value.replace(/[^a-zA-Z0-9_-]/g, (character) => `\\${character}`);
}
