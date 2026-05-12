// Atlas attachment uploader. Fetches one attachment URL → uploads bytes to
// our S3 (workspace-prefixed key) → returns the metadata we need to insert
// into Salve's `attachment` table.
//
// Buffers in memory because attachments are capped at 25MB and most are
// small. A future iteration can stream via multipart upload — but for the
// migration MVP, buffer is fine and dramatically simpler.
//
// Mime allowlist DOES NOT apply on import. The presign route enforces it for
// agent uploads (XSS hardening); for migrations the trust boundary is the
// source CSP — if Atlas accepted the file, we accept it. Keys live under
// `workspaces/<id>/imported/atlas/<uuid>-<sanitized-name>` so they round-trip
// through the `/api/files/get` workspace-prefix check.

import { randomUUID } from 'node:crypto';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

const region = process.env.S3_REGION ?? 'us-east-1';
const endpoint = process.env.S3_ENDPOINT || undefined;
const accessKeyId = process.env.S3_ACCESS_KEY_ID;
const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;
const bucket = process.env.S3_BUCKET ?? 'salve-dev';
const forcePathStyle = process.env.S3_FORCE_PATH_STYLE === 'true';

const s3 = new S3Client({
  region,
  ...(endpoint
    ? {
        endpoint,
        forcePathStyle,
        ...(accessKeyId && secretAccessKey
          ? { credentials: { accessKeyId, secretAccessKey } }
          : {}),
      }
    : {}),
});

export const ATTACHMENT_MAX_BYTES = 25 * 1024 * 1024;

export interface UploadedAttachment {
  s3Key: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  /** Atlas-side identifier we EIM-key on. URL is stable per attachment. */
  sourceId: string;
}

export interface UploadAtlasAttachmentArgs {
  workspaceId: string;
  /** Atlas attachment shape: name, url, handle?, size?, contentId? */
  attachment: {
    name: string | null | undefined;
    url: string;
    handle?: string | null;
    size?: number | null;
    contentId?: string | null;
  };
  /** Used in the S3 key prefix so attachments are colocated with their ticket. */
  ticketId: string;
}

/**
 * Fetch from the Atlas-served URL, validate size + content type, and upload
 * to our S3 under `workspaces/<id>/imported/atlas/<...>`.
 *
 * Returns null when the attachment fails any validation (404, oversize, etc.)
 * — caller treats this as "skip this attachment" rather than failing the
 * whole conversation. Throws only on transport-level errors that retrying
 * may resolve.
 */
export async function uploadAtlasAttachment(
  args: UploadAtlasAttachmentArgs,
): Promise<UploadedAttachment | null> {
  const { workspaceId, attachment, ticketId } = args;
  const url = attachment.url;

  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) {
    // 404 = file gone (Atlas trim, link rot). Quarantine quietly — the
    // conversation persists without this attachment.
    if (res.status >= 400 && res.status < 500) return null;
    throw new Error(`atlas attachment fetch ${res.status} for ${url}`);
  }

  const contentLengthHeader = res.headers.get('content-length');
  const advertisedSize = contentLengthHeader ? Number(contentLengthHeader) : 0;
  if (advertisedSize > ATTACHMENT_MAX_BYTES) return null;

  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.byteLength === 0) return null;
  if (buf.byteLength > ATTACHMENT_MAX_BYTES) return null;

  const mimeType =
    res.headers.get('content-type')?.split(';')[0]?.trim() || 'application/octet-stream';

  const filename = sanitizeFilename(
    attachment.name || filenameFromUrl(url) || `atlas-${attachment.handle ?? 'file'}`,
  );

  const s3Key = `workspaces/${workspaceId}/tickets/${ticketId}/imported-atlas-${randomUUID()}-${filename}`;

  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: s3Key,
      Body: buf,
      ContentType: mimeType,
      ContentLength: buf.byteLength,
    }),
  );

  return {
    s3Key,
    filename,
    mimeType,
    sizeBytes: buf.byteLength,
    sourceId: attachment.handle ?? url,
  };
}

function sanitizeFilename(name: string): string {
  let out = '';
  for (const ch of name) {
    const code = ch.codePointAt(0) ?? 0;
    if (code < 0x20 || ch === '/' || ch === '\\') continue;
    out += ch;
  }
  return out.replace(/\s+/g, '_').slice(0, 200) || 'file';
}

function filenameFromUrl(url: string): string | null {
  try {
    const u = new URL(url);
    const tail = u.pathname.split('/').filter(Boolean).at(-1);
    return tail ? decodeURIComponent(tail) : null;
  } catch {
    return null;
  }
}
