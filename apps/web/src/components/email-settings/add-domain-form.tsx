// AddDomainForm — creates a new sending_domain. Submits to the canonical
// `/api/settings/channels/email/domains` endpoint and falls back to the
// older `/api/settings/email/domains` so older deployments stay working.

import { Button, Field, FieldDescription, FieldError, FieldLabel, Input } from '@opendesk/ui';
import { useState } from 'react';
import { showError, showSuccess } from '@/lib/feedback';
import { postJSON } from './types';

interface Props {
  onDone: () => void;
}

export function AddDomainForm({ onDone }: Props) {
  const [domain, setDomain] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(ev: React.FormEvent) {
    ev.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const trimmed = domain.trim();
      await postJSON(['/api/settings/channels/email/domains', '/api/settings/email/domains'], {
        domain: trimmed,
      });
      showSuccess(
        `Domain ${trimmed} added`,
        'Next, add an address on the Addresses tab to start receiving.',
      );
      setDomain('');
      onDone();
    } catch (e) {
      const message = e instanceof Error ? e.message : 'failed';
      setError(message);
      showError(e, 'Could not add domain.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      noValidate
      onSubmit={onSubmit}
      className="rounded-lg border border-border bg-surface p-4 shadow-sm"
    >
      <Field hasError={Boolean(error)}>
        <FieldLabel>Domain</FieldLabel>
        <Input
          placeholder="acme.com"
          value={domain}
          onChange={(e) => setDomain(e.target.value)}
          disabled={submitting}
          aria-invalid={Boolean(error)}
          autoFocus
        />
        <FieldDescription>The domain replies will appear to come from.</FieldDescription>
        <FieldError>{error}</FieldError>
      </Field>
      <div className="mt-3 flex justify-end gap-2">
        <Button size="sm" type="button" variant="outline" onClick={onDone} disabled={submitting}>
          Cancel
        </Button>
        <Button size="sm" type="submit" disabled={submitting || domain.trim().length < 3}>
          {submitting ? 'Adding...' : 'Add domain'}
        </Button>
      </div>
    </form>
  );
}
