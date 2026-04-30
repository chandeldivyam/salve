// Shared types + helpers for the /app/settings/channels/email/* tabs.
// The Phase 3 settings UI reads via Zero (realtime) and writes via REST.

export type TicketPriority = 'low' | 'normal' | 'high' | 'urgent';

export interface Domain {
  id: string;
  domain: string;
  dnsStatus: 'pending' | 'verified' | 'failed' | 'suspended';
  dmarcStatus: 'pending' | 'present' | 'missing' | 'failing';
  createdAt: number;
  emailAddresses?: EmailAddress[];
  addresses?: EmailAddress[];
}

export interface EmailAddress {
  id: string;
  workspaceID?: string | null;
  workspaceId?: string | null;
  fullAddress: string;
  label?: string | null;
  localPart?: string | null;
  channelID?: string | null;
  channelId?: string | null;
  sendingDomainID?: string | null;
  sendingDomainId?: string | null;
  sendingDomain?: {
    id?: string | null;
    domain?: string | null;
    dnsStatus?: string | null;
  } | null;
  channel?: {
    id?: string | null;
    workspaceID?: string | null;
    workspaceId?: string | null;
    name?: string | null;
    // `unknown` so callers can pass a Zero `json()` row (`ReadonlyJSONValue`)
    // here; `stringFromRecord` re-narrows before reading.
    config?: unknown;
  } | null;
  canSend?: boolean | null;
  canReceive?: boolean | null;
  isDefault?: boolean | null;
  defaultTeamID?: string | null;
  defaultTeamId?: string | null;
  signatureHTML?: string | null;
  signatureHtml?: string | null;
  signature?: string | null;
}

export interface Suppression {
  id: string;
  target?: string | null;
  emailAddress?: string | null;
  channel?: string | null;
  channelKind?: string | null;
  reason: string;
  status?: string | null;
  deletedAt?: number | null;
  createdAt?: number | null;
}

export interface WorkspaceMember {
  id: string;
  userId?: string | null;
  userID?: string | null;
  user?: { name?: string | null; email?: string | null } | null;
}

export interface InboundRoutingRule {
  id: string;
  channelID?: string | null;
  channelId?: string | null;
  emailAddressID?: string | null;
  emailAddressId?: string | null;
  addressID?: string | null;
  addressId?: string | null;
  emailAddress?: { id?: string | null; fullAddress?: string | null } | null;
  destinationAddress?: string | null;
  setPriority?: TicketPriority | null;
  defaultPriority?: TicketPriority | null;
  assignTeamID?: string | null;
  assignTeamId?: string | null;
  defaultTeamID?: string | null;
  defaultTeamId?: string | null;
  assignAgentID?: string | null;
  assignAgentId?: string | null;
  priority?: number | null;
  enabled?: boolean | null;
  isActive?: boolean | null;
  action?: {
    assignTeamID?: string | null;
    assignTeamId?: string | null;
    assignAgentID?: string | null;
    assignAgentId?: string | null;
    setPriority?: TicketPriority | null;
    priority?: TicketPriority | null;
  } | null;
}

export const TICKET_PRIORITIES: TicketPriority[] = ['normal', 'high', 'urgent', 'low'];

export const apiBase = (import.meta.env.VITE_API_URL as string | undefined) ?? '';
export const inboundEmailDomain =
  (import.meta.env.VITE_INBOUND_EMAIL_DOMAIN as string | undefined) ?? 'in.usesalve.com';
export const replyEmailDomain =
  (import.meta.env.VITE_REPLY_EMAIL_DOMAIN as string | undefined) ?? 'reply.usesalve.com';

export function inboundForwardingTarget(address: EmailAddress): string {
  const config =
    address.channel?.config &&
    typeof address.channel.config === 'object' &&
    !Array.isArray(address.channel.config)
      ? (address.channel.config as Record<string, unknown>)
      : null;
  const configured =
    stringFromRecord(config, 'forwardingAddress') ??
    stringFromRecord(config, 'inboundForwardingAddress') ??
    stringFromRecord(config, 'inboundAddress');
  const workspaceID =
    address.workspaceID ??
    address.workspaceId ??
    address.channel?.workspaceID ??
    address.channel?.workspaceId;
  return (
    configured ??
    (workspaceID
      ? `inbound+ws_${workspaceID}@${inboundEmailDomain}`
      : `inbound+ws_<workspace>@${inboundEmailDomain}`)
  );
}

export function workspaceForwardingAddress(workspaceID: string | null | undefined): string {
  return workspaceID
    ? `inbound+ws_${workspaceID}@${inboundEmailDomain}`
    : `inbound+ws_<workspace>@${inboundEmailDomain}`;
}

function stringFromRecord(value: Record<string, unknown> | null | undefined, key: string) {
  const raw = value?.[key];
  return typeof raw === 'string' && raw.trim() ? raw : null;
}

export function getAddressSignature(address: EmailAddress): string | null {
  return address.signatureHTML ?? address.signatureHtml ?? address.signature ?? null;
}

export function memberUserID(member: WorkspaceMember): string | null {
  return member.userId ?? member.userID ?? null;
}

export function shortID(value: string): string {
  return value.length <= 10 ? value : `${value.slice(0, 8)}...`;
}

export function domainStatusVariant(
  status: Domain['dnsStatus'],
): 'default' | 'success' | 'warning' | 'danger' {
  switch (status) {
    case 'verified':
      return 'success';
    case 'pending':
      return 'warning';
    case 'failed':
    case 'suspended':
      return 'danger';
    default:
      return 'default';
  }
}

export function routingRuleAddressID(rule: InboundRoutingRule): string | null {
  return (
    rule.emailAddressID ??
    rule.emailAddressId ??
    rule.addressID ??
    rule.addressId ??
    rule.emailAddress?.id ??
    null
  );
}

export function routingRulePriority(rule: InboundRoutingRule): TicketPriority | null {
  return (
    rule.setPriority ??
    rule.defaultPriority ??
    rule.action?.setPriority ??
    rule.action?.priority ??
    null
  );
}

export function routingRuleAgentID(rule: InboundRoutingRule): string | null {
  return (
    rule.assignAgentID ??
    rule.assignAgentId ??
    rule.action?.assignAgentID ??
    rule.action?.assignAgentId ??
    null
  );
}

/**
 * Plain-text view of a signature value. Strips HTML tags so legacy address
 * signatures (which may have been saved as HTML in earlier slices) display
 * as readable plain text in the new editor.
 *
 * Also strips the *content* of <script> and <style> blocks so an input like
 *   `<script>alert("xss")</script>Hello`
 * renders only as `Hello`, not as the literal text `alert("xss")Hello`.
 *
 * Examples:
 *   signatureToPlainText('<script>alert("xss")</script>Hi') === 'Hi'
 *   signatureToPlainText('<style>.x{}</style>Hi') === 'Hi'
 *   signatureToPlainText('Hi <b>there</b>') === 'Hi there'
 *   signatureToPlainText('A<br>B') === 'A\nB'
 */
export function signatureToPlainText(value: string): string {
  // First drop the *contents* of <script>/<style> blocks (case-insensitive,
  // crossing lines) so their inner text doesn't leak through as visible
  // plain text. Then replace <br> + block boundaries with newlines, then
  // drop any remaining tags. Decoding common entities is enough for the
  // small set we're likely to encounter in legacy signatures.
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<\s*br\s*\/?\s*>/gi, '\n')
    .replace(/<\s*\/(p|div|li|h[1-6])\s*>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/[\t ]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export async function postJSON(paths: string[], body: Record<string, unknown>): Promise<void> {
  let lastError = 'request failed';
  for (const path of paths) {
    const res = await fetch(`${apiBase}${path}`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.ok) return;
    const payload = (await res.json().catch(() => null)) as { error?: string } | null;
    lastError = payload?.error ?? `${res.status}`;
    if (res.status !== 404) break;
  }
  throw new Error(lastError);
}

export async function postEmpty(paths: string[]): Promise<void> {
  let lastError = 'request failed';
  for (const path of paths) {
    const res = await fetch(`${apiBase}${path}`, {
      method: 'POST',
      credentials: 'include',
    });
    if (res.ok) return;
    const payload = (await res.json().catch(() => null)) as { error?: string } | null;
    lastError = payload?.error ?? `${res.status}`;
    if (res.status !== 404) break;
  }
  throw new Error(lastError);
}
