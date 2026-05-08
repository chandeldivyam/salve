import { useQuery } from '@rocicorp/zero/react';
import { Field, FieldError, FieldLabel, Input, LoadingButton } from '@salve/ui';
import { queries } from '@salve/zero-schema';
import { createFileRoute, useRouteContext } from '@tanstack/react-router';
import { type FormEvent, useEffect, useState } from 'react';
import { RouteErrorFeedback, RoutePendingFeedback } from '@/components/route-feedback';
import { FormSection, SettingsBody, SettingsHeader } from '@/components/settings';
import { authClient } from '@/lib/auth-client';
import { showError, showSuccess } from '@/lib/feedback';
import type { OrgRow, SessionData } from '@/lib/session-loader';
import { CACHE_NAV } from '@/lib/zero-cache';

export const Route = createFileRoute('/app/settings/general')({
  component: GeneralPage,
  pendingComponent: RoutePendingFeedback,
  errorComponent: RouteErrorFeedback,
});

function GeneralPage() {
  const { session, orgs } = useRouteContext({ from: '/app' }) as {
    session: SessionData;
    orgs: OrgRow[];
  };
  const orgId = session.session.activeOrganizationId ?? '';
  const currentUserId = session.user.id;

  // Active workspace metadata comes from the org list cached by /app's
  // beforeLoad — better-auth's `getSession` only returns `activeOrganizationId`,
  // not the populated org row.
  const activeOrg = orgs.find((o) => o.id === orgId);

  // Role: read from Zero's workspaceMembers query (already preloaded). Cheaper
  // than calling `authClient.organization.getActiveMember()` per render.
  const [members] = useQuery(queries.workspaceMembers(), CACHE_NAV);
  const currentRole = members.find((m) => m.userId === currentUserId)?.role;
  const canEdit = currentRole === 'owner' || currentRole === 'admin';

  const [name, setName] = useState('');
  const [nameError, setNameError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (activeOrg?.name) {
      setName(activeOrg.name);
    }
  }, [activeOrg?.name]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canEdit) return;
    const trimmed = name.trim();
    if (!trimmed) {
      setNameError('Name is required.');
      return;
    }
    if (trimmed.length < 2) {
      setNameError('At least 2 characters.');
      return;
    }
    setNameError(null);
    setSaving(true);
    try {
      const res = await authClient.organization.update({
        organizationId: orgId,
        data: { name: trimmed },
      });
      if (res.error) {
        setNameError(res.error.message ?? "Couldn't save.");
        return;
      }
      showSuccess('Workspace saved.');
    } catch (err) {
      showError(err, "Couldn't save workspace.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <SettingsHeader title="General" description="Manage your workspace identity." />
      <SettingsBody>
        {!canEdit ? (
          <p className="mb-5 rounded-md bg-bg-elevated px-4 py-3 text-[13px] text-fg-tertiary">
            Only workspace owners can edit these settings.
          </p>
        ) : null}

        <form onSubmit={handleSubmit} noValidate>
          <FormSection>
            <Field hasError={Boolean(nameError)}>
              <FieldLabel>Workspace name</FieldLabel>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Acme Co."
                disabled={!canEdit || saving}
              />
              <FieldError>{nameError}</FieldError>
            </Field>

            <Field>
              <FieldLabel>URL slug</FieldLabel>
              <Input value={activeOrg?.slug ?? ''} readOnly disabled className="text-fg-tertiary" />
              <p className="mt-1 text-[12px] text-fg-tertiary">
                Slug changes affect shared links.{' '}
                <a
                  href="mailto:support@usesalve.com"
                  className="font-medium text-fg-secondary underline-offset-2 hover:underline"
                >
                  Contact support
                </a>{' '}
                to rename.
              </p>
            </Field>

            {canEdit ? (
              <div className="flex">
                <LoadingButton type="submit" size="sm" loading={saving} disabled={saving}>
                  Save
                </LoadingButton>
              </div>
            ) : null}
          </FormSection>
        </form>
      </SettingsBody>
    </>
  );
}
