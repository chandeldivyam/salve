// RoutingRuleForm — assigns an inbound priority + (later) team/agent to a
// receivable address. Slice 3:
//   - The raw "team id" Input is gone. We surface a help line that
//     "Team assignment ships in a later phase." The submit still works
//     (assignTeamID is omitted → null in the DB).

import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
  Field,
  FieldDescription,
  FieldLabel,
} from '@salve/ui';
import { Check, ChevronDown, UserRound } from 'lucide-react';
import { useState } from 'react';
import { showError, showSuccess } from '@/lib/feedback';
import {
  type EmailAddress,
  memberUserID,
  postJSON,
  TICKET_PRIORITIES,
  type TicketPriority,
  type WorkspaceMember,
} from './types';

interface Props {
  address: EmailAddress;
  members: WorkspaceMember[];
  onCancel: () => void;
}

export function RoutingRuleForm({ address, members, onCancel }: Props) {
  const [setPriority, setSetPriority] = useState<TicketPriority>('normal');
  const [assignAgentID, setAssignAgentID] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(ev: React.FormEvent) {
    ev.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await postJSON(
        ['/api/settings/channels/email/routing-rules', '/api/settings/email/routing-rules'],
        {
          emailAddressID: address.id,
          channelID: address.channelID ?? address.channelId,
          destinationAddress: address.fullAddress,
          setPriority,
          assignAgentID: assignAgentID || undefined,
          enabled: true,
        },
      );
      showSuccess('Routing rule saved', `Inbound for ${address.fullAddress} routed.`);
      onCancel();
    } catch (e) {
      const message = e instanceof Error ? e.message : 'failed';
      setError(message);
      showError(e, 'Could not save routing rule.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form noValidate onSubmit={onSubmit} className="mt-3 border-t border-border pt-3">
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.8fr)_minmax(0,1fr)]">
        <Field>
          <FieldLabel>Destination</FieldLabel>
          <div className="flex h-10 min-w-0 items-center rounded-md border border-border bg-surface-muted px-3 text-sm text-foreground">
            <span className="truncate">{address.fullAddress}</span>
          </div>
        </Field>
        <Field>
          <FieldLabel>Priority</FieldLabel>
          <PriorityPicker value={setPriority} onChange={setSetPriority} />
        </Field>
        <Field>
          <FieldLabel>Default agent</FieldLabel>
          <AgentPicker members={members} value={assignAgentID} onChange={setAssignAgentID} />
        </Field>
      </div>
      <Field className="mt-2">
        <FieldDescription>
          Team assignment ships in a later phase. Inbound messages route by priority and assignee
          for now.
        </FieldDescription>
      </Field>
      <div className="mt-3 flex flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:justify-end">
        {error ? (
          <p className="grow text-xs text-danger-soft-foreground" role="alert">
            {error}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button
            size="sm"
            type="button"
            variant="outline"
            onClick={onCancel}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button size="sm" type="submit" disabled={submitting}>
            {submitting ? 'Saving...' : 'Save rule'}
          </Button>
        </div>
      </div>
    </form>
  );
}

function PriorityPicker({
  value,
  onChange,
}: {
  value: TicketPriority;
  onChange: (value: TicketPriority) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="inline-flex h-10 w-full min-w-0 items-center justify-between gap-2 rounded-md border border-border bg-surface px-3 text-sm text-foreground hover:bg-surface-muted"
        >
          <span className="truncate capitalize">{value}</span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-[min(220px,calc(100vw-2rem))]">
        <DropdownMenuLabel>Ticket priority</DropdownMenuLabel>
        {TICKET_PRIORITIES.map((priority) => (
          <DropdownMenuItem key={priority} onSelect={() => onChange(priority)}>
            <span className="grid h-4 w-4 place-items-center">
              {value === priority ? <Check className="h-3.5 w-3.5" /> : null}
            </span>
            <span className="capitalize">{priority}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function AgentPicker({
  members,
  value,
  onChange,
}: {
  members: WorkspaceMember[];
  value: string;
  onChange: (id: string) => void;
}) {
  const selected = members.find((member) => memberUserID(member) === value) ?? null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="inline-flex h-10 w-full min-w-0 items-center justify-between gap-2 rounded-md border border-border bg-surface px-3 text-sm text-foreground hover:bg-surface-muted"
        >
          <span className="truncate">
            {selected ? (selected.user?.name ?? selected.user?.email ?? value) : 'Any agent'}
          </span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-[min(300px,calc(100vw-2rem))]">
        <DropdownMenuLabel>Default agent</DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => onChange('')}>
          <span className="grid h-4 w-4 place-items-center">
            {!value ? <Check className="h-3.5 w-3.5" /> : null}
          </span>
          <UserRound className="h-3.5 w-3.5 text-muted-foreground" />
          Any agent
        </DropdownMenuItem>
        {members.map((member) => {
          const id = memberUserID(member);
          if (!id) return null;
          return (
            <DropdownMenuItem key={member.id} onSelect={() => onChange(id)}>
              <span className="grid h-4 w-4 place-items-center">
                {value === id ? <Check className="h-3.5 w-3.5" /> : null}
              </span>
              <UserRound className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="truncate">{member.user?.name ?? member.user?.email ?? id}</span>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
