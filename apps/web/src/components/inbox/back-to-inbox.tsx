// Push-nav back-button rendered above the ticket detail header.
// Linear-style ghost button with Esc / Cmd+[ shortcut wiring.

import { Link, useNavigate } from '@tanstack/react-router';
import { ChevronLeft } from 'lucide-react';
import { useKeyBinding } from '@/lib/commands/use-key-binding';
import { useShortcut } from '@/lib/shortcuts';

export function BackToInbox() {
  const navigate = useNavigate();
  const back = () => navigate({ to: '/app/inbox' });

  // Esc returns to the list. Gated to skip while the user is typing
  // (composer focus, search field) — `useShortcut` enforces that.
  useShortcut('Escape', back);

  // Cmd/Ctrl+[ — Linear's "go back" chord. We disable the default
  // preventDefault and only consume the event when the modifier is held,
  // so a bare '[' keypress in the document still flows normally.
  useKeyBinding('$mod+[', back, {
    scopes: ['conversation'],
    preventDefault: true,
    label: 'Back to inbox',
    group: 'Navigation',
  });

  return (
    <Link
      to="/app/inbox"
      aria-label="Back to inbox"
      className="inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-[12px] text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />
      <span>Inbox</span>
    </Link>
  );
}
