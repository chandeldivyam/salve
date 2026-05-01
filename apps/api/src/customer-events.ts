import { randomUUID } from 'node:crypto';
import { schema as dbSchema, getDb } from '@opendesk/db';
import { and, eq, sql } from 'drizzle-orm';
import type { Context } from 'hono';
import { z } from 'zod';
import { authOf } from './middleware.js';

type JSONValue = null | string | number | boolean | JSONValue[] | { [key: string]: JSONValue };
type JSONRecord = Record<string, JSONValue>;

function isJSONValue(value: unknown): value is JSONValue {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  ) {
    return true;
  }
  if (Array.isArray(value)) {
    return value.every(isJSONValue);
  }
  if (
    typeof value === 'object' &&
    value !== null &&
    Object.getPrototypeOf(value) === Object.prototype
  ) {
    return Object.values(value).every(isJSONValue);
  }
  return false;
}

function isJSONRecord(value: unknown): value is JSONRecord {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype &&
    Object.values(value).every(isJSONValue)
  );
}

const eventBodySchema = z.object({
  id: z.string().uuid().optional(),
  eventName: z.string().trim().min(1).max(200),
  properties: z.custom<JSONRecord>(isJSONRecord).optional(),
  source: z.string().trim().min(1).max(80).optional(),
  occurredAt: z.union([z.string().datetime(), z.number().int().nonnegative()]).optional(),
  idempotencyKey: z.string().trim().min(1).max(500).optional(),
});

const customerIDSchema = z.string().uuid();

function parseOccurredAt(value: string | number | undefined): Date {
  if (value === undefined) return new Date();
  const date = typeof value === 'number' ? new Date(value) : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error('invalid occurredAt');
  }
  return date;
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === '23505'
  );
}

async function findEventByIdempotencyKey(args: { workspaceID: string; idempotencyKey: string }) {
  const db = getDb();
  const rows = await db
    .select()
    .from(dbSchema.customEvent)
    .where(
      and(
        eq(dbSchema.customEvent.workspaceId, args.workspaceID),
        eq(dbSchema.customEvent.idempotencyKey, args.idempotencyKey),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function handleCustomerEventIngest(c: Context) {
  const auth = authOf(c);
  if (!auth.workspaceID) return c.json({ error: 'no-workspace' }, 403);

  const customerIDResult = customerIDSchema.safeParse(c.req.param('customerID'));
  if (!customerIDResult.success) {
    return c.json({ error: 'invalid customerID' }, 400);
  }

  const rawBody = await c.req.json().catch(() => null);
  const bodyResult = eventBodySchema.safeParse(rawBody);
  if (!bodyResult.success) {
    return c.json({ error: 'invalid event payload', issues: bodyResult.error.issues }, 400);
  }

  let occurredAt: Date;
  try {
    occurredAt = parseOccurredAt(bodyResult.data.occurredAt);
  } catch {
    return c.json({ error: 'invalid occurredAt' }, 400);
  }

  const db = getDb();
  const customerID = customerIDResult.data;
  const customerRows = await db
    .select({ id: dbSchema.customer.id })
    .from(dbSchema.customer)
    .where(
      and(
        eq(dbSchema.customer.id, customerID),
        eq(dbSchema.customer.workspaceId, auth.workspaceID),
      ),
    )
    .limit(1);

  if (!customerRows[0]) {
    return c.json({ error: 'customer not found' }, 404);
  }

  const idempotencyKey = bodyResult.data.idempotencyKey;
  if (idempotencyKey) {
    const existing = await findEventByIdempotencyKey({
      workspaceID: auth.workspaceID,
      idempotencyKey,
    });
    if (existing) {
      return c.json({ event: existing, deduplicated: true });
    }
  }

  try {
    const inserted = await db
      .insert(dbSchema.customEvent)
      .values({
        id: bodyResult.data.id ?? randomUUID(),
        workspaceId: auth.workspaceID,
        customerId: customerID,
        eventName: bodyResult.data.eventName,
        properties: bodyResult.data.properties ?? {},
        source: bodyResult.data.source ?? 'api',
        occurredAt,
        idempotencyKey,
      })
      .returning();

    await db
      .update(dbSchema.customer)
      .set({
        firstSeenAt: sql`LEAST(COALESCE(${dbSchema.customer.firstSeenAt}, ${occurredAt}), ${occurredAt})`,
        lastSeenAt: sql`GREATEST(COALESCE(${dbSchema.customer.lastSeenAt}, ${occurredAt}), ${occurredAt})`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(dbSchema.customer.id, customerID),
          eq(dbSchema.customer.workspaceId, auth.workspaceID),
        ),
      );

    return c.json({ event: inserted[0], deduplicated: false }, 201);
  } catch (error) {
    if (idempotencyKey && isUniqueViolation(error)) {
      const existing = await findEventByIdempotencyKey({
        workspaceID: auth.workspaceID,
        idempotencyKey,
      });
      if (existing) {
        return c.json({ event: existing, deduplicated: true });
      }
    }
    throw error;
  }
}
