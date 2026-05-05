import { createHash, randomUUID } from 'node:crypto';
import type { ExecutorCtx } from './ctx.js';

export function actionResourceID(ctx: ExecutorCtx, actionID: string, suffix: string): string {
  if (!ctx.idempotencyKey) return randomUUID();
  return deterministicUUID(`${ctx.auth.workspaceID}:${actionID}:${ctx.idempotencyKey}:${suffix}`);
}

function deterministicUUID(input: string): string {
  const hash = createHash('sha256').update(input).digest();
  const bytes = new Uint8Array(hash.subarray(0, 16));
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-');
}
