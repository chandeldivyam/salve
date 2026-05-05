// AddAddressForm — creates a new email_address row scoped to a sending
// domain. Slice 3 changes:
//   - Signature input is the new <Textarea> primitive (plain text, not raw
//     HTML) with a FieldDescription that telegraphs the upcoming rich-text
//     editor.
//   - Submit posts the value as-is — the API column already accepts a
//     plain string, and the address row UI renders with whitespace-pre-wrap.

import {
  Badge,
  Button,
  CopyValue,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
  Field,
  FieldDescription,
  FieldLabel,
  Input,
  Textarea,
} from '@salve/ui';
import { Check, ChevronDown } from 'lucide-react';
import { useState } from 'react';
import { showError, showSuccess } from '@/lib/feedback';
import {
  type Domain,
  domainStatusVariant,
  inboundEmailDomain,
  postJSON,
  workspaceForwardingAddress,
} from './types';

interface Props {
  domains: Domain[];
  selectedDomain: Domain | null;
  selectedDomainID: string | null;
  workspaceID: string | null;
  onSelectDomain: (id: string) => void;
  onDone: () => void;
}

export function AddAddressForm({
  domains,
  selectedDomain,
  selectedDomainID,
  workspaceID,
  onSelectDomain,
  onDone,
}: Props) {
  const [localPart, setLocalPart] = useState('support');
  const [label, setLabel] = useState('Support');
  const [signature, setSignature] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(ev: React.FormEvent) {
    ev.preventDefault();
    if (!selectedDomainID) return;
    setError(null);
    setSubmitting(true);
    try {
      await postJSON(
        [
          '/api/settings/channels/email/addresses',
          `/api/settings/email/domains/${selectedDomainID}/addresses`,
        ],
        {
          sendingDomainID: selectedDomainID,
          localPart: localPart.trim(),
          label: label.trim() || undefined,
          canSend: true,
          canReceive: true,
          signature: signature.trim() || undefined,
        },
      );
      showSuccess(
        'Address added',
        `${localPart.trim()}@${selectedDomain?.domain ?? ''} is now active.`,
      );
      setLocalPart('support');
      setLabel('Support');
      setSignature('');
      onDone();
    } catch (e) {
      const message = e instanceof Error ? e.message : 'failed';
      setError(message);
      showError(e, 'Could not add address.');
    } finally {
      setSubmitting(false);
    }
  }

  const canSubmit = !submitting && Boolean(selectedDomainID) && localPart.trim().length > 0;

  return (
    <form
      noValidate
      onSubmit={onSubmit}
      className="rounded-lg border border-border bg-surface p-4 shadow-sm"
    >
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)]">
        <Field>
          <FieldLabel>Domain</FieldLabel>
          <DomainPicker
            domains={domains}
            selectedDomain={selectedDomain}
            selectedDomainID={selectedDomainID}
            onSelect={onSelectDomain}
          />
        </Field>
        <Field>
          <FieldLabel>Local part</FieldLabel>
          <Input
            placeholder="support"
            value={localPart}
            onChange={(e) => setLocalPart(e.target.value)}
            disabled={submitting}
            aria-invalid={Boolean(error)}
          />
        </Field>
        <Field>
          <FieldLabel>Label</FieldLabel>
          <Input
            placeholder="Support"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            disabled={submitting}
          />
        </Field>
      </div>
      <div className="mt-3">
        <Field>
          <FieldLabel>Signature</FieldLabel>
          <Textarea
            placeholder={'Plain-text signature\nLine breaks are preserved.'}
            value={signature}
            onChange={(e) => setSignature(e.target.value)}
            disabled={submitting}
            rows={4}
          />
          <FieldDescription>Plain text. A rich-text editor is coming next phase.</FieldDescription>
        </Field>
      </div>
      {selectedDomain ? (
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <span className="text-foreground">Address:</span>
            <CopyValue
              value={`${localPart.trim() || 'local'}@${selectedDomain.domain}`}
              label="Address"
            />
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="text-foreground">Forwarding:</span>
            <CopyValue value={workspaceForwardingAddress(workspaceID)} label="Forwarding address" />
          </span>
          <span className="text-[11px] text-muted-foreground">
            Inbound mail from this address forwards into{' '}
            <code className="font-mono">{inboundEmailDomain}</code>.
          </span>
        </div>
      ) : null}
      <div className="mt-3 flex flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:justify-end">
        {error ? (
          <p className="grow text-xs text-danger-soft-foreground" role="alert">
            {error}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button size="sm" type="button" variant="outline" onClick={onDone} disabled={submitting}>
            Cancel
          </Button>
          <Button size="sm" type="submit" disabled={!canSubmit}>
            {submitting ? 'Adding...' : 'Add address'}
          </Button>
        </div>
      </div>
    </form>
  );
}

function DomainPicker({
  domains,
  selectedDomain,
  selectedDomainID,
  onSelect,
}: {
  domains: Domain[];
  selectedDomain: Domain | null;
  selectedDomainID: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="inline-flex h-10 w-full min-w-0 items-center justify-between gap-2 rounded-md border border-border bg-surface px-3 text-sm text-foreground hover:bg-surface-muted"
        >
          <span className="truncate">{selectedDomain?.domain ?? 'Choose domain'}</span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-[min(320px,calc(100vw-2rem))]">
        <DropdownMenuLabel>Domain</DropdownMenuLabel>
        {domains.map((domain) => (
          <DropdownMenuItem key={domain.id} onSelect={() => onSelect(domain.id)}>
            <span className="grid h-4 w-4 place-items-center">
              {selectedDomainID === domain.id ? <Check className="h-3.5 w-3.5" /> : null}
            </span>
            <span className="truncate">{domain.domain}</span>
            <Badge variant={domainStatusVariant(domain.dnsStatus)}>{domain.dnsStatus}</Badge>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
