import { useQuery } from '@rocicorp/zero/react';
import {
  Avatar,
  AvatarFallback,
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Field,
  FieldError,
  FieldLabel,
  Input,
  initialsFromName,
  Label,
  LoadingButton,
} from '@salve/ui';
import { queries, type WorkspaceInvitationRow, type WorkspaceMemberRow } from '@salve/zero-schema';
import { createFileRoute, useRouteContext } from '@tanstack/react-router';
import { formatDistanceToNowStrict } from 'date-fns';
import { MoreHorizontal, UserPlus, Users } from 'lucide-react';
import { type FormEvent, useEffect, useState } from 'react';
import { RouteErrorFeedback, RoutePendingFeedback } from '@/components/route-feedback';
import { EmptyState, ListSection, SettingsBody, SettingsHeader } from '@/components/settings';
import { authClient } from '@/lib/auth-client';
import { showError, showSuccess } from '@/lib/feedback';
import type { SessionData } from '@/lib/session-loader';
import { CACHE_NAV } from '@/lib/zero-cache';

export const Route = createFileRoute('/app/settings/members')({
  component: MembersPage,
  pendingComponent: RoutePendingFeedback,
  errorComponent: RouteErrorFeedback,
});

function MembersPage() {
  const { session } = useRouteContext({ from: '/app' }) as { session: SessionData };
  const orgId = session.session.activeOrganizationId ?? '';
  const currentUserId = session.user.id;

  const [members, membersStatus] = useQuery(queries.workspaceMembers(), CACHE_NAV);
  const [invitations] = useQuery(queries.workspaceInvitations(), CACHE_NAV);

  const currentMember = members.find((m) => m.userId === currentUserId);
  const currentRole = currentMember?.role;
  const canManage = currentRole === 'owner' || currentRole === 'admin';

  const [inviteOpen, setInviteOpen] = useState(false);

  const membersReady = membersStatus?.type === 'complete';
  const humanMembers = members.filter(
    (m) => (m as WorkspaceMemberRow & { kind?: string }).kind !== 'service_account',
  );

  return (
    <>
      <SettingsHeader
        title="Members"
        description="Invite teammates and manage roles."
        actions={
          canManage ? (
            <Button size="sm" onClick={() => setInviteOpen(true)} className="h-8">
              <UserPlus className="h-3.5 w-3.5" />
              Invite member
            </Button>
          ) : null
        }
      />
      <SettingsBody>
        <div className="flex flex-col gap-6">
          <ListSection title="Members" count={membersReady ? humanMembers.length : undefined}>
            {!membersReady && humanMembers.length === 0 ? (
              <MemberSkeleton />
            ) : humanMembers.length === 0 ? (
              <EmptyState
                icon={Users}
                title="No members"
                description="Invite someone to collaborate in this workspace."
              />
            ) : (
              humanMembers.map((m) => (
                <MemberRow
                  key={m.id}
                  member={m as WorkspaceMemberRow}
                  currentUserId={currentUserId}
                  currentRole={currentRole}
                  orgId={orgId}
                />
              ))
            )}
          </ListSection>

          {canManage ? (
            <ListSection title="Pending invitations" count={invitations.length}>
              {invitations.length === 0 ? (
                <p className="py-3 text-[13px] text-fg-tertiary">No pending invitations.</p>
              ) : (
                invitations.map((inv) => <InvitationRow key={inv.id} inv={inv} orgId={orgId} />)
              )}
            </ListSection>
          ) : null}
        </div>
      </SettingsBody>

      {canManage ? (
        <InviteDialog open={inviteOpen} onClose={() => setInviteOpen(false)} orgId={orgId} />
      ) : null}
    </>
  );
}

function MemberRow({
  member,
  currentUserId,
  currentRole,
  orgId,
}: {
  member: WorkspaceMemberRow;
  currentUserId: string;
  currentRole: string | undefined;
  orgId: string;
}) {
  const canManage = currentRole === 'owner' || currentRole === 'admin';
  const isOwner = member.role === 'owner';
  const isSelf = member.userId === currentUserId;
  const name = member.user?.name ?? member.user?.email ?? 'Unknown';
  const email = member.user?.email ?? '';

  async function changeRole(newRole: string) {
    try {
      const res = await authClient.organization.updateMemberRole({
        organizationId: orgId,
        memberId: member.id,
        role: newRole,
      });
      if (res.error) throw new Error(res.error.message ?? "Couldn't update role.");
      showSuccess('Role updated.');
    } catch (err) {
      showError(err, "Couldn't update role.");
    }
  }

  async function removeMember() {
    try {
      const res = await authClient.organization.removeMember({
        organizationId: orgId,
        memberIdOrEmail: member.id,
      });
      if (res.error) throw new Error(res.error.message ?? "Couldn't remove member.");
      showSuccess('Member removed.');
    } catch (err) {
      showError(err, "Couldn't remove member.");
    }
  }

  return (
    <div className="flex h-10 items-center gap-2.5 rounded-md px-2 text-[13px] hover:bg-bg-elevated/40">
      <Avatar className="h-6 w-6 shrink-0">
        <AvatarFallback className="text-[10px]">{initialsFromName(name)}</AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <span className="truncate font-medium text-fg-primary">{name}</span>
        {email ? (
          <span className="ml-1.5 truncate text-[11px] text-fg-tertiary">{email}</span>
        ) : null}
      </div>
      <RolePill role={member.role} />
      {canManage && !isSelf ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 w-7 p-0"
              aria-label={`Actions for ${name}`}
            >
              <MoreHorizontal className="h-3.5 w-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {member.role !== 'admin' ? (
              <DropdownMenuItem onSelect={() => changeRole('admin')}>
                Change role to admin
              </DropdownMenuItem>
            ) : null}
            {member.role !== 'member' ? (
              <DropdownMenuItem onSelect={() => changeRole('member')}>
                Change role to member
              </DropdownMenuItem>
            ) : null}
            {!isOwner ? (
              <DropdownMenuItem onSelect={removeMember} className="text-danger focus:text-danger">
                Remove member
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <div className="w-7 shrink-0" />
      )}
    </div>
  );
}

function InvitationRow({ inv, orgId }: { inv: WorkspaceInvitationRow; orgId: string }) {
  const [busy, setBusy] = useState(false);

  async function resend() {
    setBusy(true);
    try {
      // better-auth rejects a duplicate `inviteMember` with
      // `USER_IS_ALREADY_INVITED_TO_THIS_ORGANIZATION` unless `resend: true`
      // is passed explicitly — that branch cancels the old token and emails a
      // fresh one. Plain re-call would error every time.
      const res = await authClient.organization.inviteMember({
        organizationId: orgId,
        email: inv.email,
        role: inv.role as 'member' | 'admin',
        resend: true,
      });
      if (res.error) throw new Error(res.error.message ?? "Couldn't resend.");
      showSuccess('Invitation resent.');
    } catch (err) {
      showError(err, "Couldn't resend invitation.");
    } finally {
      setBusy(false);
    }
  }

  async function revoke() {
    setBusy(true);
    try {
      const res = await authClient.organization.cancelInvitation({ invitationId: inv.id });
      if (res.error) throw new Error(res.error.message ?? "Couldn't revoke.");
      showSuccess('Invitation revoked.');
    } catch (err) {
      showError(err, "Couldn't revoke invitation.");
    } finally {
      setBusy(false);
    }
  }

  const sentLabel = inv.createdAt
    ? formatDistanceToNowStrict(new Date(inv.createdAt), { addSuffix: true })
    : null;

  return (
    <div className="flex h-10 items-center gap-2.5 rounded-md px-2 text-[13px] hover:bg-bg-elevated/40">
      <div className="min-w-0 flex-1">
        <span className="truncate font-medium text-fg-primary">{inv.email}</span>
        {sentLabel ? (
          <span className="ml-1.5 text-[11px] text-fg-tertiary">sent {sentLabel}</span>
        ) : null}
      </div>
      <RolePill role={inv.role} />
      <div className="flex shrink-0 items-center gap-1">
        <Button size="sm" variant="outline" className="h-7" onClick={resend} disabled={busy}>
          Resend
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 text-danger hover:text-danger"
          onClick={revoke}
          disabled={busy}
        >
          Revoke
        </Button>
      </div>
    </div>
  );
}

function RolePill({ role }: { role: string }) {
  const label = role.charAt(0).toUpperCase() + role.slice(1);
  return (
    <span className="shrink-0 rounded-full border border-line-quiet px-2 py-0.5 text-[11px] font-medium text-fg-secondary">
      {label}
    </span>
  );
}

const SKELETON_KEYS = ['sk-0', 'sk-1', 'sk-2', 'sk-3', 'sk-4'] as const;

function MemberSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="flex flex-col">
      {SKELETON_KEYS.slice(0, count).map((k) => (
        <div key={k} className="flex h-10 items-center gap-2.5 px-2">
          <div className="h-6 w-6 shrink-0 rounded-full bg-bg-elevated" />
          <div className="h-3 w-36 rounded bg-bg-elevated" />
          <div className="ml-auto h-3 w-12 rounded bg-bg-elevated" />
        </div>
      ))}
    </div>
  );
}

function InviteDialog({
  open,
  onClose,
  orgId,
}: {
  open: boolean;
  onClose: () => void;
  orgId: string;
}) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'member' | 'admin'>('member');
  const [emailError, setEmailError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setEmail('');
      setRole('member');
      setEmailError(null);
      setSubmitting(false);
    }
  }, [open]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed?.includes('@')) {
      setEmailError('Enter a valid email address.');
      return;
    }
    setEmailError(null);
    setSubmitting(true);
    try {
      const res = await authClient.organization.inviteMember({
        organizationId: orgId,
        email: trimmed,
        role,
      });
      if (res.error) {
        setEmailError(res.error.message ?? "Couldn't send invitation.");
        return;
      }
      showSuccess('Invitation sent.');
      onClose();
    } catch (err) {
      showError(err, "Couldn't send invitation.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => (!o ? onClose() : null)}>
      <DialogContent className="!w-[420px] !max-w-[calc(100vw-2rem)] gap-0 p-0">
        <DialogHeader className="px-5 pt-5 pb-4">
          <DialogTitle className="text-[15px]">Invite member</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} noValidate>
          <div className="flex flex-col gap-4 px-5 pb-4">
            <Field hasError={Boolean(emailError)}>
              <FieldLabel>Email</FieldLabel>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="colleague@company.com"
                autoFocus
                disabled={submitting}
              />
              <FieldError>{emailError}</FieldError>
            </Field>
            <div className="flex flex-col gap-1.5">
              <Label>Role</Label>
              <div className="flex gap-3">
                {(['member', 'admin'] as const).map((r) => (
                  <label
                    key={r}
                    className="flex cursor-pointer items-center gap-2 text-[13px] text-fg-primary"
                  >
                    <input
                      type="radio"
                      name="role"
                      value={r}
                      checked={role === r}
                      onChange={() => setRole(r)}
                      disabled={submitting}
                      className="accent-brand"
                    />
                    {r.charAt(0).toUpperCase() + r.slice(1)}
                  </label>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter className="px-5 pb-5 pt-2">
            <Button
              size="sm"
              variant="outline"
              type="button"
              onClick={onClose}
              disabled={submitting}
            >
              Cancel
            </Button>
            <LoadingButton size="sm" type="submit" loading={submitting} disabled={submitting}>
              Send invitation
            </LoadingButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
