// Phase A — token-CRUD endpoints (PATs + service accounts).
// JWT-cookie auth (you don't mint tokens with a token). Reads go via
// Zero (`queries.apiTokensForCurrentUser`, `queries.serviceAccounts`,
// `queries.serviceAccountTokens`); only writes are REST because plaintext
// is shown once at create time. Phase D shipped tickets actions; the
// matching `settings.apiTokens.*` actions land alongside the rest of the
// settings surface in Phase E.

import { randomBytes, randomUUID } from 'node:crypto';
import { defaultKeyHasher } from '@better-auth/api-key';
import { authSchema, getDb } from '@salve/db';
import { and, eq } from 'drizzle-orm';
import type { Context } from 'hono';
import { z } from 'zod';
import { authOf } from '../middleware.js';
import {
  API_SCOPES,
  type ApiScope,
  permissionStatementsFromScopes,
  scopesExceeding,
  scopesForRole,
} from './scopes.js';

const PAT_PREFIX = 'slv_pat_';
const SVC_PREFIX = 'slv_svc_';
const SERVICE_ACCOUNT_EMAIL_DOMAIN = 'service-accounts.local';

const scopeSchema = z.enum(API_SCOPES as unknown as [ApiScope, ...ApiScope[]]);

const createPatBody = z.object({
  name: z.string().min(1).max(80),
  scopes: z.array(scopeSchema).min(1).max(API_SCOPES.length),
  expiresInDays: z.number().int().min(1).max(365).optional(),
});

const createServiceAccountBody = z.object({
  name: z.string().min(1).max(80),
  scopes: z.array(scopeSchema).min(1).max(API_SCOPES.length),
});

interface TokenMetadata {
  principalKind: 'user' | 'service_account';
  principalID: string;
  workspaceID: string;
  userID?: string;
  memberID?: string;
}

function generatePlaintext(prefix: string): string {
  const body = randomBytes(48).toString('base64url').slice(0, 64);
  return `${prefix}${body}`;
}

// ---- Personal access tokens ----

export async function handleCreatePat(c: Context): Promise<Response> {
  const ctx = authOf(c);
  if (!ctx.workspaceID) return c.json({ error: 'no-workspace' }, 403);
  if (ctx.principalKind !== 'user') {
    return c.json({ error: 'service_accounts_cannot_mint_tokens' }, 403);
  }

  const json = await c.req.raw.json().catch(() => null);
  const parsed = createPatBody.safeParse(json);
  if (!parsed.success) {
    return c.json({ error: 'invalid', details: parsed.error.flatten() }, 400);
  }

  // Cap requested scopes to the role's envelope so an agent-role caller
  // cannot mint a PAT carrying scopes their own role doesn't grant. Cookie
  // callers don't carry an explicit scope set; we cap to scopesForRole.
  const grantedEnvelope = ctx.scopes ?? scopesForRole(ctx.role);
  const exceeding = scopesExceeding(parsed.data.scopes, grantedEnvelope);
  if (exceeding.length > 0) {
    return c.json(
      {
        error: 'scope_exceeds_caller',
        details: { exceeding },
      },
      403,
    );
  }

  // Direct apikey-row insert. Same storage shape Better Auth's plugin uses
  // (so `verifyApiKey` finds the row) plus our `principal_kind` /
  // `principal_id` columns so the Zero query can filter at the DB layer.
  const db = getDb();
  const expiresAt = parsed.data.expiresInDays
    ? new Date(Date.now() + parsed.data.expiresInDays * 86_400_000)
    : null;
  const keyId = randomUUID();
  const plaintext = generatePlaintext(PAT_PREFIX);
  const hashed = await defaultKeyHasher(plaintext);
  const now = new Date();

  await db.insert(authSchema.apikey).values({
    id: keyId,
    configId: 'default',
    name: parsed.data.name,
    start: plaintext.slice(0, 12),
    prefix: PAT_PREFIX,
    referenceId: ctx.workspaceID,
    key: hashed,
    enabled: true,
    rateLimitEnabled: true,
    rateLimitTimeWindow: 60_000,
    rateLimitMax: 60,
    requestCount: 0,
    expiresAt,
    permissions: JSON.stringify(permissionStatementsFromScopes(parsed.data.scopes)),
    metadata: JSON.stringify({
      principalKind: 'user',
      userID: ctx.userID,
      principalID: ctx.userID,
      workspaceID: ctx.workspaceID,
    } satisfies TokenMetadata),
    principalKind: 'user',
    principalId: ctx.userID,
    createdAt: now,
    updatedAt: now,
  });

  return c.json(
    {
      id: keyId,
      token: plaintext,
      name: parsed.data.name,
      prefix: PAT_PREFIX,
      principalKind: 'user' as const,
      scopes: parsed.data.scopes,
      expiresAt: expiresAt ? expiresAt.toISOString() : null,
      createdAt: now.toISOString(),
    },
    201,
  );
}

export async function handleRevokePat(c: Context): Promise<Response> {
  const ctx = authOf(c);
  if (!ctx.workspaceID) return c.json({ error: 'no-workspace' }, 403);

  const id = c.req.param('id');
  if (!id) return c.json({ error: 'missing-id' }, 400);

  const db = getDb();
  // Match by (id, workspace, principal_kind=user, principal_id=current user)
  // — owner-checked by composition. 404 if any condition fails so we don't
  // leak which token IDs belong to whom.
  const result = await db
    .delete(authSchema.apikey)
    .where(
      and(
        eq(authSchema.apikey.id, id),
        eq(authSchema.apikey.referenceId, ctx.workspaceID),
        eq(authSchema.apikey.principalKind, 'user'),
        eq(authSchema.apikey.principalId, ctx.userID),
      ),
    )
    .returning({ id: authSchema.apikey.id });

  if (result.length === 0) return c.json({ error: 'not-found' }, 404);
  return c.body(null, 204);
}

// ---- Service accounts ----

function requireWorkspaceAdmin(c: Context): Response | null {
  const ctx = authOf(c);
  if (!ctx.workspaceID) return c.json({ error: 'no-workspace' }, 403);
  if (ctx.role !== 'owner' && ctx.role !== 'admin') {
    return c.json({ error: 'admin_required' }, 403);
  }
  if (ctx.principalKind !== 'user') {
    return c.json({ error: 'service_accounts_cannot_manage_service_accounts' }, 403);
  }
  return null;
}

export async function handleCreateServiceAccount(c: Context): Promise<Response> {
  const guard = requireWorkspaceAdmin(c);
  if (guard) return guard;
  const ctx = authOf(c);
  if (!ctx.workspaceID) return c.json({ error: 'no-workspace' }, 403);
  const workspaceID = ctx.workspaceID;

  const json = await c.req.raw.json().catch(() => null);
  const parsed = createServiceAccountBody.safeParse(json);
  if (!parsed.success) {
    return c.json({ error: 'invalid', details: parsed.error.flatten() }, 400);
  }

  // Service-account creation is admin-only (requireWorkspaceAdmin above), but
  // we still cap the scopes to the role's envelope so the same code path is
  // safe if the role gate ever loosens.
  const grantedEnvelope = ctx.scopes ?? scopesForRole(ctx.role);
  const exceeding = scopesExceeding(parsed.data.scopes, grantedEnvelope);
  if (exceeding.length > 0) {
    return c.json(
      {
        error: 'scope_exceeds_caller',
        details: { exceeding },
      },
      403,
    );
  }

  const db = getDb();

  // Synthesise a user row for the service account. Email is namespaced under
  // an unresolvable domain so it can't collide with a real user. Name carries
  // the human-readable handle, prefixed `service:` so the audit-log renderer
  // can distinguish it without joining on `member.kind`.
  const userId = randomUUID();
  const memberId = randomUUID();
  const keyId = randomUUID();
  const syntheticEmail = `sa-${userId}@${SERVICE_ACCOUNT_EMAIL_DOMAIN}`;
  const plaintext = generatePlaintext(SVC_PREFIX);
  const hashed = await defaultKeyHasher(plaintext);
  const now = new Date();

  // All-or-nothing: synthetic user + member + apikey row in a single tx.
  // If any insert fails, none of them commit — no orphaned member rows.
  await db.transaction(async (tx) => {
    await tx.insert(authSchema.user).values({
      id: userId,
      name: `service: ${parsed.data.name}`,
      email: syntheticEmail,
      emailVerified: false,
    });
    await tx.insert(authSchema.member).values({
      id: memberId,
      organizationId: workspaceID,
      userId,
      role: 'member',
      kind: 'service_account',
    });
    await tx.insert(authSchema.apikey).values({
      id: keyId,
      configId: 'default',
      name: parsed.data.name,
      start: plaintext.slice(0, 12),
      prefix: SVC_PREFIX,
      referenceId: workspaceID,
      key: hashed,
      enabled: true,
      rateLimitEnabled: true,
      rateLimitTimeWindow: 60_000,
      rateLimitMax: 60,
      requestCount: 0,
      permissions: JSON.stringify(permissionStatementsFromScopes(parsed.data.scopes)),
      metadata: JSON.stringify({
        principalKind: 'service_account',
        memberID: memberId,
        principalID: memberId,
        workspaceID,
      } satisfies TokenMetadata),
      principalKind: 'service_account',
      principalId: memberId,
      createdAt: now,
      updatedAt: now,
    });
  });

  return c.json(
    {
      id: keyId,
      token: plaintext,
      name: parsed.data.name,
      prefix: SVC_PREFIX,
      principalKind: 'service_account' as const,
      memberID: memberId,
      scopes: parsed.data.scopes,
      expiresAt: null,
      createdAt: now.toISOString(),
    },
    201,
  );
}

export async function handleDeleteServiceAccount(c: Context): Promise<Response> {
  const guard = requireWorkspaceAdmin(c);
  if (guard) return guard;
  const ctx = authOf(c);
  if (!ctx.workspaceID) return c.json({ error: 'no-workspace' }, 403);

  const memberID = c.req.param('id');
  if (!memberID) return c.json({ error: 'missing-id' }, 400);

  const db = getDb();
  const rows = await db
    .select({ id: authSchema.member.id })
    .from(authSchema.member)
    .where(
      and(
        eq(authSchema.member.id, memberID),
        eq(authSchema.member.organizationId, ctx.workspaceID),
        eq(authSchema.member.kind, 'service_account'),
      ),
    )
    .limit(1);
  const member = rows[0];
  if (!member) return c.json({ error: 'not-found' }, 404);

  // Remove active credentials + membership. Keep the synthetic user row so
  // historical audit_event.actor_id joins still render the service identity.
  await db.transaction(async (tx) => {
    await tx
      .delete(authSchema.apikey)
      .where(
        and(
          eq(authSchema.apikey.referenceId, ctx.workspaceID as string),
          eq(authSchema.apikey.principalKind, 'service_account'),
          eq(authSchema.apikey.principalId, memberID),
        ),
      );
    await tx.delete(authSchema.member).where(eq(authSchema.member.id, memberID));
  });

  return c.body(null, 204);
}
