import { useQuery } from '@rocicorp/zero/react';
import {
  Button,
  CopyValue,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  Input,
  Label,
  Skeleton,
} from '@salve/ui';
import {
  type ApiTokenRow,
  queries,
  type ServiceAccountRow,
  type ServiceAccountTokenRow,
} from '@salve/zero-schema';
import { createFileRoute, useRouteContext } from '@tanstack/react-router';
import { format, formatDistanceToNowStrict } from 'date-fns';
import { Bot, Key, MoreHorizontal } from 'lucide-react';
import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { RouteErrorFeedback, RoutePendingFeedback } from '@/components/route-feedback';
import {
  EmptyState,
  ListSection,
  SettingsBody,
  SettingsHeader,
  SettingsSheet,
} from '@/components/settings';
import {
  API_SCOPES,
  type ApiScope,
  type CreatedToken,
  createPat,
  createServiceAccount,
  deleteServiceAccount,
  revokePat,
} from '@/lib/api-tokens';
import { showError, showSuccess } from '@/lib/feedback';
import type { SessionData } from '@/lib/session-loader';
import { CACHE_NAV } from '@/lib/zero-cache';

export const Route = createFileRoute('/app/settings/api-tokens')({
  component: ApiTokensPage,
  pendingComponent: RoutePendingFeedback,
  errorComponent: RouteErrorFeedback,
});

type SheetState = { kind: 'closed' } | { kind: 'create-pat' } | { kind: 'create-service' };
type ConfirmState =
  | { kind: 'closed' }
  | { kind: 'revoke-pat'; row: ApiTokenRow }
  | { kind: 'delete-service'; row: ServiceAccountRow };

function ApiTokensPage() {
  const { session } = useRouteContext({ from: '/app' }) as { session: SessionData };
  const role = useCurrentRole(session);

  const [pats, patsStatus] = useQuery(queries.apiTokensForCurrentUser(), CACHE_NAV);
  const [serviceMembers, serviceMembersStatus] = useQuery(queries.serviceAccounts(), CACHE_NAV);
  const [serviceTokens] = useQuery(queries.serviceAccountTokens(), CACHE_NAV);

  const tokensByMember = useMemo(() => {
    const m = new Map<string, ServiceAccountTokenRow>();
    for (const t of serviceTokens) if (t.principalId) m.set(t.principalId, t);
    return m;
  }, [serviceTokens]);

  const isAdmin = role === 'owner' || role === 'admin';

  const [sheet, setSheet] = useState<SheetState>({ kind: 'closed' });
  const [confirm, setConfirm] = useState<ConfirmState>({ kind: 'closed' });
  const [revealing, setRevealing] = useState<CreatedToken | null>(null);

  return (
    <>
      <SettingsHeader
        title="API tokens"
        description="Programmatic access for the CLI, MCP, and integrations. Tokens are shown once at creation."
      />
      <SettingsBody maxWidth="wide">
        <div className="flex flex-col gap-8 pt-2">
          <PatList
            rows={pats}
            ready={patsStatus?.type === 'complete'}
            onCreate={() => setSheet({ kind: 'create-pat' })}
            onRevoke={(row) => setConfirm({ kind: 'revoke-pat', row })}
          />

          {isAdmin ? (
            <ServiceAccountList
              members={serviceMembers}
              tokensByMember={tokensByMember}
              ready={serviceMembersStatus?.type === 'complete'}
              onCreate={() => setSheet({ kind: 'create-service' })}
              onDelete={(row) => setConfirm({ kind: 'delete-service', row })}
            />
          ) : null}
        </div>
      </SettingsBody>

      <CreateSheet
        state={sheet}
        onClose={() => setSheet({ kind: 'closed' })}
        onCreated={(token) => {
          setSheet({ kind: 'closed' });
          setRevealing(token);
        }}
      />
      <RevealDialog token={revealing} onClose={() => setRevealing(null)} />
      <ConfirmDialog state={confirm} onClose={() => setConfirm({ kind: 'closed' })} />
    </>
  );
}

// ---- PATs ----

function PatList({
  rows,
  ready,
  onCreate,
  onRevoke,
}: {
  rows: readonly ApiTokenRow[];
  ready: boolean;
  onCreate: () => void;
  onRevoke: (row: ApiTokenRow) => void;
}) {
  return (
    <ListSection
      title="Personal access tokens"
      count={ready ? rows.length : undefined}
      trailing={
        <Button size="sm" onClick={onCreate} className="h-8">
          New token
        </Button>
      }
    >
      {!ready && rows.length === 0 ? (
        <TokenSkeleton />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={Key}
          title="No personal access tokens"
          description="Create a token to use the CLI or call the API from a script."
          action={
            <Button size="sm" onClick={onCreate}>
              New token
            </Button>
          }
        />
      ) : (
        <div className="flex flex-col">
          {rows.map((row) => (
            <PatRow key={row.id} row={row} onRevoke={() => onRevoke(row)} />
          ))}
        </div>
      )}
    </ListSection>
  );
}

function PatRow({ row, onRevoke }: { row: ApiTokenRow; onRevoke: () => void }) {
  const expired = row.expiresAt != null && row.expiresAt < Date.now();
  return (
    <div className="flex h-9 items-center gap-2 rounded-md px-2 text-[13px] hover:bg-bg-elevated/40">
      <span className="truncate font-medium text-fg-primary">{row.name ?? 'Untitled token'}</span>
      <span className="font-mono text-[11px] tabular-nums text-fg-tertiary">
        {row.start ?? row.prefix ?? ''}…
      </span>
      <span className="text-[11px] text-fg-tertiary">{lastUsedLabel(row.lastRequest)}</span>
      {expired ? (
        <span className="text-[11px] text-warning">expired</span>
      ) : row.expiresAt ? (
        <span className="text-[11px] text-fg-tertiary">
          expires {format(new Date(row.expiresAt), 'MMM d, yyyy')}
        </span>
      ) : null}
      <div className="ml-auto">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 w-7 p-0"
              aria-label={`Token actions for ${row.name ?? 'this token'}`}
            >
              <MoreHorizontal className="h-3.5 w-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onSelect={(e) => {
                e.preventDefault();
                onRevoke();
              }}
            >
              Revoke token
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

// ---- Service accounts ----

function ServiceAccountList({
  members,
  tokensByMember,
  ready,
  onCreate,
  onDelete,
}: {
  members: readonly ServiceAccountRow[];
  tokensByMember: Map<string, ServiceAccountTokenRow>;
  ready: boolean;
  onCreate: () => void;
  onDelete: (row: ServiceAccountRow) => void;
}) {
  return (
    <ListSection
      title="Service accounts"
      count={ready ? members.length : undefined}
      trailing={
        <Button size="sm" onClick={onCreate} className="h-8">
          New service account
        </Button>
      }
    >
      {!ready && members.length === 0 ? (
        <TokenSkeleton />
      ) : members.length === 0 ? (
        <EmptyState
          icon={Bot}
          title="No service accounts"
          description="Create one for an automation or AI agent that needs its own identity."
          action={
            <Button size="sm" onClick={onCreate}>
              New service account
            </Button>
          }
        />
      ) : (
        <div className="flex flex-col">
          {members.map((row) => (
            <ServiceAccountRowView
              key={row.id}
              row={row}
              token={tokensByMember.get(row.id)}
              onDelete={() => onDelete(row)}
            />
          ))}
        </div>
      )}
    </ListSection>
  );
}

function ServiceAccountRowView({
  row,
  token,
  onDelete,
}: {
  row: ServiceAccountRow;
  token: ServiceAccountTokenRow | undefined;
  onDelete: () => void;
}) {
  const displayName = displayServiceName(row.user?.name);
  return (
    <div className="flex h-9 items-center gap-2 rounded-md px-2 text-[13px] hover:bg-bg-elevated/40">
      <span className="truncate font-medium text-fg-primary">{displayName}</span>
      {token ? (
        <span className="font-mono text-[11px] tabular-nums text-fg-tertiary">
          {token.start ?? token.prefix ?? ''}…
        </span>
      ) : (
        <span className="text-[11px] text-fg-tertiary">no token</span>
      )}
      <span className="text-[11px] text-fg-tertiary">{lastUsedLabel(token?.lastRequest)}</span>
      <div className="ml-auto">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 w-7 p-0"
              aria-label={`Service account actions for ${displayName}`}
            >
              <MoreHorizontal className="h-3.5 w-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onSelect={(e) => {
                e.preventDefault();
                onDelete();
              }}
            >
              Delete service account
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

// ---- Skeleton ----

function TokenSkeleton() {
  return (
    <div className="flex flex-col">
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex h-9 items-center gap-2 px-2">
          <Skeleton className="h-3 w-32" />
          <Skeleton className="h-3 w-24" />
          <Skeleton className="ml-auto h-3 w-16" />
        </div>
      ))}
    </div>
  );
}

// ---- Create sheet (tier B) ----

function CreateSheet({
  state,
  onClose,
  onCreated,
}: {
  state: SheetState;
  onClose: () => void;
  onCreated: (t: CreatedToken) => void;
}) {
  const open = state.kind !== 'closed';
  const kind = state.kind === 'create-service' ? 'service' : 'pat';

  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<ApiScope[]>(['tickets:read']);
  const [expiresInDays, setExpiresInDays] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setName('');
      setScopes(['tickets:read']);
      setExpiresInDays('');
      setError(null);
      setSubmitting(false);
    }
  }, [open]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setError(null);
    if (name.trim().length === 0) {
      setError('Name is required.');
      return;
    }
    if (scopes.length === 0) {
      setError('Pick at least one scope.');
      return;
    }
    setSubmitting(true);
    try {
      const token =
        kind === 'pat'
          ? await createPat({
              name: name.trim(),
              scopes,
              expiresInDays: expiresInDays ? Number(expiresInDays) : undefined,
            })
          : await createServiceAccount({ name: name.trim(), scopes });
      showSuccess(kind === 'pat' ? 'Token created.' : 'Service account created.');
      onCreated(token);
    } catch (e) {
      setError(toMessage(e));
      showError(e, "Couldn't create token.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <SettingsSheet
      open={open}
      onOpenChange={(next) => (next ? null : onClose())}
      title={kind === 'pat' ? 'New personal access token' : 'New service account'}
      description={
        kind === 'pat'
          ? 'Acts as you. Use it from the CLI or local scripts.'
          : 'Acts as a workspace bot. Audit events show "service: <name>".'
      }
      footer={
        <>
          <Button size="sm" variant="outline" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button size="sm" type="submit" form="create-token-form" disabled={submitting}>
            {submitting ? 'Creating…' : 'Create'}
          </Button>
        </>
      }
    >
      <form id="create-token-form" onSubmit={submit} noValidate className="flex flex-col gap-4">
        <Field hasError={Boolean(error)}>
          <FieldLabel>Name</FieldLabel>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={kind === 'pat' ? 'laptop-cli' : 'triage-bot'}
            autoFocus
            disabled={submitting}
          />
          <FieldDescription>Shown in the audit log against actions taken.</FieldDescription>
          <FieldError>{error}</FieldError>
        </Field>

        <fieldset className="flex flex-col gap-2">
          <Label>Scopes</Label>
          <div className="grid grid-cols-2 gap-1">
            {API_SCOPES.map((scope) => (
              <ScopeCheckbox
                key={scope}
                scope={scope}
                checked={scopes.includes(scope)}
                disabled={submitting}
                onToggle={() =>
                  setScopes((prev) =>
                    prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope],
                  )
                }
              />
            ))}
          </div>
        </fieldset>

        {kind === 'pat' ? (
          <Field>
            <FieldLabel>Expires in (days)</FieldLabel>
            <Input
              type="number"
              min={1}
              max={365}
              value={expiresInDays}
              onChange={(e) => setExpiresInDays(e.target.value)}
              placeholder="Never"
              disabled={submitting}
            />
            <FieldDescription>Leave blank to never expire.</FieldDescription>
          </Field>
        ) : null}
      </form>
    </SettingsSheet>
  );
}

function ScopeCheckbox({
  scope,
  checked,
  disabled,
  onToggle,
}: {
  scope: ApiScope;
  checked: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-[12px] text-fg-primary hover:bg-bg-elevated/40">
      <input
        type="checkbox"
        checked={checked}
        onChange={onToggle}
        disabled={disabled}
        className="h-3.5 w-3.5 accent-brand"
      />
      <span className="font-mono">{scope}</span>
    </label>
  );
}

// ---- Reveal dialog ----

function RevealDialog({ token, onClose }: { token: CreatedToken | null; onClose: () => void }) {
  return (
    <Dialog open={token !== null} onOpenChange={(o) => (!o ? onClose() : null)}>
      <DialogContent className="!w-[480px] !max-w-[calc(100vw-2rem)] gap-0 p-0">
        <DialogHeader className="px-5 pt-5 pb-3">
          <DialogTitle className="text-[15px]">Copy your token</DialogTitle>
          <DialogDescription className="text-xs">
            This is the only time the full token is shown. Store it somewhere safe.
          </DialogDescription>
        </DialogHeader>
        {token ? (
          <div className="flex flex-col gap-3 px-5 pb-3">
            <CopyValue value={token.token} />
            <p className="text-[11px] text-fg-tertiary">
              Scopes: <span className="font-mono">{token.scopes.join(', ')}</span>
              {token.expiresAt
                ? ` · Expires ${format(new Date(token.expiresAt), 'MMM d, yyyy')}`
                : ' · Never expires'}
            </p>
          </div>
        ) : null}
        <DialogFooter className="px-5 pb-5 pt-2">
          <Button size="sm" onClick={onClose}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---- Confirm dialog ----

function ConfirmDialog({ state, onClose }: { state: ConfirmState; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const open = state.kind !== 'closed';

  async function confirm() {
    if (state.kind === 'closed' || busy) return;
    setBusy(true);
    try {
      if (state.kind === 'revoke-pat') {
        await revokePat(state.row.id);
        showSuccess('Token revoked.');
      } else {
        await deleteServiceAccount(state.row.id);
        showSuccess('Service account deleted.');
      }
      onClose();
    } catch (e) {
      showError(e, "Couldn't complete that.");
    } finally {
      setBusy(false);
    }
  }

  const isService = state.kind === 'delete-service';
  return (
    <Dialog open={open} onOpenChange={(o) => (!o ? onClose() : null)}>
      <DialogContent className="!w-[420px] !max-w-[calc(100vw-2rem)] gap-0 p-0">
        <DialogHeader className="px-5 pt-5 pb-3">
          <DialogTitle className="text-[15px]">
            {isService ? 'Delete service account?' : 'Revoke token?'}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {isService
              ? 'The service account and its tokens are removed. Past events stay attributed.'
              : 'Any client using this token starts getting 401s immediately.'}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="px-5 pb-5 pt-2">
          <Button size="sm" variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button size="sm" variant="destructive" onClick={confirm} disabled={busy}>
            {busy
              ? isService
                ? 'Deleting…'
                : 'Revoking…'
              : isService
                ? 'Delete service account'
                : 'Revoke token'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---- Helpers ----

// `member.role` for the current user. Resolved from the workspaceMembers
// query once available so we don't depend on the JWT being present in
// session data (it's set as an httpOnly cookie). Service-account section
// is gated on this; while it loads we render conservatively (assume agent).
function useCurrentRole(session: SessionData): 'owner' | 'admin' | 'agent' | null {
  const [members] = useQuery(queries.workspaceMembers(), CACHE_NAV);
  return useMemo(() => {
    const me = members.find((m) => m.userId === session.user.id);
    if (!me) return null;
    if (me.role === 'owner' || me.role === 'admin') return me.role;
    return 'agent';
  }, [members, session.user.id]);
}

function lastUsedLabel(epoch: number | null | undefined): string {
  if (!epoch) return 'never used';
  return `used ${formatDistanceToNowStrict(new Date(epoch), { addSuffix: true })}`;
}

function displayServiceName(raw: string | null | undefined): string {
  if (!raw) return 'Unnamed';
  return raw.startsWith('service: ') ? raw.slice('service: '.length) : raw;
}

function toMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return 'Try again in a moment.';
}
