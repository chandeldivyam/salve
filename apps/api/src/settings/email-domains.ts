// Phase 3a — Settings → Email domains REST handlers.
//
// Why REST and not Zero mutators? Domain rows are written rarely (a workspace
// adds maybe 1-3 domains a year) and we want side-effects on the server only:
//   - generate stub DKIM tokens (Phase 3a, replace with real
//     `SES.CreateEmailIdentity` in 3c)
//   - run a verification poll (Phase 3c) outside of any client transaction
//
// The settings UI does:
//   POST /api/settings/email/domains            — add a new domain
//   POST /api/settings/email/domains/:id/verify-dev   — flip dns_status='verified' (dev-only)
//
// Reads happen via Zero (mirrored from the `sending_domain` table — see the
// Zero schema additions) so the list page stays realtime.

import { getDb, schema } from '@opendesk/db';
import { and, eq } from 'drizzle-orm';
import type { Context } from 'hono';
import { z } from 'zod';
import { authOf } from '../middleware.js';

// ---------- Add domain ----------

const addBody = z.object({
  domain: z
    .string()
    .min(3)
    .max(253)
    .regex(/^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/, 'invalid domain'),
});

// Stubbed DKIM tokens for Phase 3a so the UI looks real without calling SES.
// Real tokens land in 3c when we wire `SES.CreateEmailIdentity`.
function stubDkimTokens(domain: string): Array<{ name: string; value: string }> {
  return [
    {
      name: `s1._domainkey.${domain}`,
      value: 'dev-cname-1.dkim.amazonses.com',
    },
    {
      name: `s2._domainkey.${domain}`,
      value: 'dev-cname-2.dkim.amazonses.com',
    },
    {
      name: `s3._domainkey.${domain}`,
      value: 'dev-cname-3.dkim.amazonses.com',
    },
  ];
}

export async function handleEmailDomainAddDev(c: Context): Promise<Response> {
  const auth = authOf(c);
  if (!auth.workspaceID) return c.json({ error: 'no-workspace' }, 403);

  const json = await c.req.raw.json().catch(() => null);
  const parsed = addBody.safeParse(json);
  if (!parsed.success) {
    return c.json({ error: 'invalid', details: parsed.error.flatten() }, 400);
  }
  const domain = parsed.data.domain.toLowerCase();

  const db = getDb();
  const existing = await db
    .select({ id: schema.sendingDomain.id })
    .from(schema.sendingDomain)
    .where(
      and(
        eq(schema.sendingDomain.workspaceId, auth.workspaceID),
        eq(schema.sendingDomain.domain, domain),
      ),
    )
    .limit(1);
  if (existing.length > 0) {
    return c.json({ error: 'already-added', id: existing[0]?.id ?? null }, 409);
  }

  // TODO Phase 3c: replace with real SES.CreateEmailIdentity +
  // PutEmailIdentityMailFromAttributes. For now we stub the DKIM tokens so the
  // UI flow is testable end-to-end without DNS or SES sandbox lift.
  const tokens = stubDkimTokens(domain);
  const [row] = await db
    .insert(schema.sendingDomain)
    .values({
      workspaceId: auth.workspaceID,
      domain,
      dkimTokens: tokens,
      mailFromSubdomain: 'mail',
      dnsStatus: 'pending',
      dmarcStatus: 'pending',
    })
    .returning({ id: schema.sendingDomain.id });

  return c.json({ id: row?.id ?? null, domain, dkimTokens: tokens, status: 'pending' }, 201);
}

// ---------- Mark verified (dev override) ----------

export async function handleEmailDomainVerifyDev(c: Context): Promise<Response> {
  const auth = authOf(c);
  if (!auth.workspaceID) return c.json({ error: 'no-workspace' }, 403);
  const id = c.req.param('id');
  if (!id) return c.json({ error: 'missing-id' }, 400);

  const db = getDb();
  const updated = await db
    .update(schema.sendingDomain)
    .set({
      dnsStatus: 'verified',
      dmarcStatus: 'present',
      lastVerifiedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(eq(schema.sendingDomain.id, id), eq(schema.sendingDomain.workspaceId, auth.workspaceID)),
    )
    .returning({ id: schema.sendingDomain.id });

  if (updated.length === 0) return c.json({ error: 'not-found' }, 404);
  return c.json({ id, status: 'verified' });
}
