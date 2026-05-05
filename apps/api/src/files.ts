// /api/files/* — S3 presigned PUT/GET endpoints for ticket attachments.
//
// In dev we point at the MinIO container (`docker/docker-compose.yml`)
// which is AWS-S3 compatible and lets us avoid pulling real AWS creds for
// local work. The bucket is auto-created on the first request — MinIO doesn't
// expose a way to declare default buckets, so the API just calls
// `CreateBucketCommand` and ignores `BucketAlreadyOwnedByYou`.
//
// Phase 2c only stores the `s3Key` on the `attachment` row inside the
// `message.send` mutator; download URLs are minted on demand via /api/files/get
// (60s expiry) so we can apply the workspace prefix check on every fetch.

import {
  CreateBucketCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { Context } from 'hono';
import { authOf } from './middleware.js';

// SVG is intentionally excluded. SVGs can carry inline `<script>` tags and
// are served same-origin via signed GETs, so allowing them is a stored XSS
// vector. If we ever need vector previews, sanitize via SVGO with scripts
// stripped before upload AND serve with `Content-Disposition: attachment`.
const ALLOWED_MIME = new Set<string>([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/avif',
  'application/pdf',
  'text/plain',
  'text/csv',
  'application/json',
  'application/zip',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/msword',
  'application/vnd.ms-excel',
]);

const MAX_BYTES = 25 * 1024 * 1024; // 25 MB

const region = process.env.S3_REGION ?? 'us-east-1';
const endpoint = process.env.S3_ENDPOINT ?? 'http://localhost:9000';
const accessKeyId = process.env.S3_ACCESS_KEY_ID ?? 'salve';
const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY ?? 'salvedev';
const bucket = process.env.S3_BUCKET ?? 'salve-dev';
const forcePathStyle = (process.env.S3_FORCE_PATH_STYLE ?? 'true') === 'true';

const s3 = new S3Client({
  region,
  endpoint,
  forcePathStyle,
  credentials: { accessKeyId, secretAccessKey },
});

let bucketReady = false;
async function ensureBucket() {
  if (bucketReady) return;
  try {
    await s3.send(new CreateBucketCommand({ Bucket: bucket }));
  } catch (e) {
    const err = e as { Code?: string; name?: string; $metadata?: { httpStatusCode?: number } };
    const code = err.Code ?? err.name ?? '';
    // 409 / BucketAlreadyOwnedByYou / BucketAlreadyExists — both fine.
    if (
      err.$metadata?.httpStatusCode === 409 ||
      /BucketAlreadyOwnedByYou|BucketAlreadyExists/.test(code)
    ) {
      // already exists — fine
    } else {
      throw e;
    }
  }
  bucketReady = true;
}

function sanitizeFilename(name: string): string {
  // Strip path separators + control chars; collapse whitespace. Leave most
  // printables alone — S3 can store almost anything in a key. The regex below
  // intentionally targets control characters via a code-point check rather
  // than a literal range so biome's `noControlCharactersInRegex` rule passes.
  let out = '';
  for (const ch of name) {
    const code = ch.codePointAt(0) ?? 0;
    if (code < 0x20 || ch === '/' || ch === '\\') continue;
    out += ch;
  }
  out = out.replace(/\s+/g, '_').slice(0, 200);
  return out || 'file';
}

/** POST /api/files/presign — returns `{ s3Key, putUrl, expiresIn }`. */
export async function handlePresign(c: Context) {
  const auth = authOf(c);
  if (!auth.workspaceID) {
    return c.json({ error: 'no active workspace' }, 400);
  }

  const body = (await c.req.raw.json().catch(() => null)) as {
    filename?: string;
    mimeType?: string;
    size?: number;
    ticketID?: string;
  } | null;
  if (!body?.filename || !body?.mimeType || typeof body.size !== 'number') {
    return c.json({ error: 'filename, mimeType, size required' }, 400);
  }
  if (!ALLOWED_MIME.has(body.mimeType)) {
    return c.json({ error: `mimeType ${body.mimeType} not allowed` }, 400);
  }
  if (body.size <= 0 || body.size > MAX_BYTES) {
    return c.json({ error: `size must be 1..${MAX_BYTES}` }, 400);
  }

  await ensureBucket();
  const ticketSegment = body.ticketID ? body.ticketID : 'unattached';
  const id = crypto.randomUUID();
  const s3Key = `workspaces/${auth.workspaceID}/tickets/${ticketSegment}/${id}-${sanitizeFilename(
    body.filename,
  )}`;

  const cmd = new PutObjectCommand({
    Bucket: bucket,
    Key: s3Key,
    ContentType: body.mimeType,
    ContentLength: body.size,
  });
  const putUrl = await getSignedUrl(s3, cmd, { expiresIn: 600 });

  return c.json({ s3Key, putUrl, expiresIn: 600 });
}

/** POST /api/files/get — returns `{ getUrl, expiresIn }` for a s3Key the
 *  caller's workspace owns. Rejects keys that don't sit under the caller's
 *  workspace prefix — defense in depth against cross-workspace probes. */
export async function handleGetSigned(c: Context) {
  const auth = authOf(c);
  if (!auth.workspaceID) {
    return c.json({ error: 'no active workspace' }, 400);
  }
  const body = (await c.req.raw.json().catch(() => null)) as { s3Key?: string } | null;
  if (!body?.s3Key) {
    return c.json({ error: 's3Key required' }, 400);
  }
  const expectedPrefix = `workspaces/${auth.workspaceID}/`;
  if (!body.s3Key.startsWith(expectedPrefix)) {
    return c.json({ error: 'cross-workspace key blocked' }, 403);
  }

  await ensureBucket();
  // Force download semantics on signed GETs so an attacker who slips a
  // dangerous file past the upload allowlist (or an old SVG predating the
  // allowlist tightening) cannot run inline. The S3 SDK signs the response
  // override; the browser sees `Content-Disposition: attachment` regardless
  // of what the bucket has stored. Filename is the trailing key segment.
  const filename = filenameFromKey(body.s3Key);
  const cmd = new GetObjectCommand({
    Bucket: bucket,
    Key: body.s3Key,
    ResponseContentDisposition: `attachment; filename="${escapeContentDispositionFilename(filename)}"`,
  });
  const getUrl = await getSignedUrl(s3, cmd, { expiresIn: 60 });
  return c.json({ getUrl, expiresIn: 60 });
}

function filenameFromKey(key: string): string {
  const tail = key.split('/').at(-1) ?? key;
  const dash = tail.indexOf('-');
  return dash >= 0 ? tail.slice(dash + 1) : tail;
}

function escapeContentDispositionFilename(name: string): string {
  return name.replace(/[\\"\r\n]/g, '_');
}
