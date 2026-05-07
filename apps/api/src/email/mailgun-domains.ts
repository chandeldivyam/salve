// Mailgun Domains API client.
//
// Used by `provision-domain` and `verify-domain` Inngest fns to register
// tenant sending domains and poll their verification state. Three endpoints:
//
//   POST   /v4/domains              — create
//   GET    /v4/domains/{name}       — read state + DNS records
//   PUT    /v4/domains/{name}/verify — re-run verification synchronously
//
// All authenticate via the shared Mailgun API key (basic auth, user="api").
// Region is selected via MAILGUN_API_BASE — defaults to US.

const REQUIRED_OK = new Set([200, 201]);

export interface MailgunDnsRecord {
  /** "TXT" | "CNAME" | "MX" — Mailgun returns uppercase. */
  record_type: string;
  name: string;
  value: string;
  /** Mailgun reports `valid: "valid" | "unknown" | "invalid"`. */
  valid?: string;
  priority?: string;
  cached?: string[];
}

export interface MailgunDomainResponse {
  domain: {
    name: string;
    /** "active" once DNS passes verification; "unverified" otherwise. */
    state: 'active' | 'unverified' | 'disabled' | string;
    is_disabled?: boolean;
    require_tls?: boolean;
    skip_verification?: boolean;
    created_at?: string;
    smtp_login?: string;
    /** "us" | "eu" depending on region. */
    region?: string;
  };
  sending_dns_records?: MailgunDnsRecord[];
  receiving_dns_records?: MailgunDnsRecord[];
}

function authHeader(): string {
  const apiKey = process.env.MAILGUN_API_KEY;
  if (!apiKey) throw new Error('mailgun: MAILGUN_API_KEY not configured');
  return `Basic ${Buffer.from(`api:${apiKey}`).toString('base64')}`;
}

function apiBase(): string {
  return (process.env.MAILGUN_API_BASE ?? 'https://api.mailgun.net').replace(/\/$/, '');
}

async function request<T>(
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  path: string,
  body?: URLSearchParams,
): Promise<T> {
  const res = await fetch(`${apiBase()}${path}`, {
    method,
    headers: {
      Authorization: authHeader(),
      ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
    },
    body: body ?? undefined,
  });
  if (!REQUIRED_OK.has(res.status)) {
    const text = await res.text().catch(() => '');
    const err = new Error(`mailgun ${method} ${path} failed (${res.status}): ${text}`);
    (err as { status?: number }).status = res.status;
    throw err;
  }
  return (await res.json()) as T;
}

/**
 * Create a Mailgun sending domain. With `force_dkim_authority=true` Mailgun
 * issues CNAME-based DKIM records (matching the SES UX where customers add 3
 * CNAMEs at `<token>._domainkey.<domain>`). Without it, you get TXT-based
 * DKIM which is harder for customers to copy into their DNS.
 *
 * `dkim_key_size` is fixed at 2048 — the default 1024 is below current
 * deliverability best-practice (Gmail/Yahoo bulk-sender requirements).
 */
export async function createMailgunDomain(name: string): Promise<MailgunDomainResponse> {
  const params = new URLSearchParams({
    name,
    dkim_key_size: '2048',
    force_dkim_authority: 'true',
    web_scheme: 'https',
  });
  return request<MailgunDomainResponse>('POST', '/v4/domains', params);
}

export async function getMailgunDomain(name: string): Promise<MailgunDomainResponse> {
  return request<MailgunDomainResponse>('GET', `/v4/domains/${encodeURIComponent(name)}`);
}

/**
 * Force a re-check of the domain's DNS records. Mailgun also auto-polls,
 * but this is what the UI's "Verify now" button calls.
 */
export async function verifyMailgunDomainNow(name: string): Promise<MailgunDomainResponse> {
  return request<MailgunDomainResponse>('PUT', `/v4/domains/${encodeURIComponent(name)}/verify`);
}

export function isAlreadyExistsError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const status = (error as { status?: number }).status;
  return status === 400 || status === 409;
}
