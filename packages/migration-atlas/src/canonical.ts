// Canonical mappers — Atlas wire shapes → Salve-flavoured DTOs the importer
// inserts. Salve enums:
//   ticket.status   = 'open' | 'in_progress' | 'snoozed' | 'resolved' | 'closed'
//   ticket.priority = 'low' | 'normal' | 'high' | 'urgent'
//   message.author_type = 'customer' | 'agent' | 'system'

import sanitizeHtml from 'sanitize-html';
import type {
  AtlasConversation,
  AtlasCustomer,
  AtlasCustomField,
  AtlasMessage,
  AtlasTag,
  AtlasTagGroup,
} from './client.js';

/**
 * Atlas-imported HTML is rendered directly via dangerouslySetInnerHTML in the
 * timeline (apps/web/src/components/timeline/message-bubble.tsx). Atlas does
 * not sanitize the text body, so we MUST strip anything that could execute or
 * load cross-origin. Allowlist is intentionally tighter than the agent
 * composer's output — imported messages are passive content, not editable.
 */
const SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  // Allowed tags: text + lists + tables + minimal block-level + links + images.
  // Notably excluded: script, style, iframe, object, embed, form, input,
  // svg, math, base, meta — anything that can execute, load active content,
  // or alter document base.
  allowedTags: [
    'a',
    'b',
    'blockquote',
    'br',
    'code',
    'div',
    'em',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'hr',
    'i',
    'img',
    'li',
    'ol',
    'p',
    'pre',
    'span',
    'strong',
    'sub',
    'sup',
    'table',
    'tbody',
    'td',
    'tfoot',
    'th',
    'thead',
    'tr',
    'u',
    'ul',
  ],
  allowedAttributes: {
    a: ['href', 'title', 'target', 'rel'],
    img: ['src', 'alt', 'title', 'width', 'height'],
    // Allow class/style on a small set so legacy HTML keeps shape — but
    // sanitize-html's style filtering strips javascript:/expression()/etc.
    '*': ['class'],
  },
  allowedSchemes: ['http', 'https', 'mailto', 'tel'],
  allowedSchemesByTag: {
    img: ['http', 'https', 'data', 'cid'],
  },
  // Force-noopener every link so customer-controlled HTML can't reach
  // window.opener of the timeline frame.
  transformTags: {
    a: sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer', target: '_blank' }, true),
  },
  // Don't keep raw text from disallowed tags (prevents `<script>alert()</script>` from
  // leaking the alert() text into the rendered body).
  disallowedTagsMode: 'discard',
};

export function sanitizeImportedHtml(input: string): string {
  if (!input) return '';
  return sanitizeHtml(input, SANITIZE_OPTIONS);
}

export type SalveTicketStatus = 'open' | 'in_progress' | 'snoozed' | 'resolved' | 'closed';
export type SalveTicketPriority = 'low' | 'normal' | 'high' | 'urgent';
export type SalveMessageAuthorType = 'customer' | 'agent' | 'system';
export type SalveCustomFieldCategory = 'ticket' | 'customer';
export type SalveCustomFieldType =
  | 'text'
  | 'number'
  | 'decimal'
  | 'boolean'
  | 'date'
  | 'list'
  | 'multi_select'
  | 'url'
  | 'address';

export interface CanonicalCustomer {
  sourceId: string;
  email: string;
  syntheticEmail: boolean;
  name: string | null;
  phone: string | null;
  metadata: Record<string, unknown>;
  firstSeenAt: Date | null;
}

export interface CanonicalTicket {
  sourceId: string;
  title: string;
  status: SalveTicketStatus;
  priority: SalveTicketPriority;
  customer: CanonicalCustomer | null;
  agentEmail: string | null;
  createdAt: Date;
  closedAt: Date | null;
  metadata: Record<string, unknown>;
}

export interface CanonicalAttachmentRef {
  /** Atlas-served URL — stable per attachment, used as EIM source_id. */
  url: string;
  name: string | null;
  handle: string | null;
  size: number | null;
  contentId: string | null;
}

export interface CanonicalMessage {
  sourceId: string;
  authorType: SalveMessageAuthorType;
  authorEmail: string | null; // for agent matching
  authorCustomerSourceId: string | null;
  bodyHtml: string;
  bodyText: string;
  isInternal: boolean;
  createdAt: Date;
  attachments: CanonicalAttachmentRef[];
  metadata: Record<string, unknown>;
}

export function syntheticEmail(c: AtlasCustomer): string {
  // Use Atlas's external_user_id when available; otherwise fall back to id.
  // The .invalid TLD is unrouteable per RFC 6761.
  const seed = c.externalUserId ?? c.id;
  const safe = seed.toLowerCase().replace(/[^a-z0-9._-]+/g, '-');
  return `${safe}@imported.atlas.invalid`;
}

export function toCanonicalCustomer(c: AtlasCustomer): CanonicalCustomer {
  const hasEmail = typeof c.email === 'string' && c.email.includes('@');
  const email = hasEmail ? (c.email as string).toLowerCase() : syntheticEmail(c);
  const fullName = [c.firstName, c.lastName].filter(Boolean).join(' ').trim() || null;
  return {
    sourceId: c.id,
    email,
    syntheticEmail: !hasEmail,
    name: fullName,
    phone: c.phoneNumber ?? null,
    metadata: {
      atlas: {
        external_user_id: c.externalUserId ?? null,
        account_id: c.accountId ?? null,
        synthetic_email: !hasEmail,
        custom_fields: c.customFields ?? null,
      },
    },
    firstSeenAt: epochToDate(c.createdAt),
  };
}

export function mapStatus(atlasStatus: string): SalveTicketStatus {
  switch (atlasStatus.toUpperCase()) {
    case 'OPEN':
      return 'open';
    case 'PENDING':
      return 'in_progress';
    case 'SNOOZED':
      return 'snoozed';
    case 'CLOSED':
      return 'closed';
    default:
      return 'open';
  }
}

export function mapPriority(atlasPriority: string | null | undefined): SalveTicketPriority {
  switch ((atlasPriority ?? '').toUpperCase()) {
    case 'LOW':
      return 'low';
    case 'HIGH':
      return 'high';
    case 'URGENT':
      return 'urgent';
    case 'MEDIUM':
    case 'NO_PRIORITY':
    case '':
      return 'normal';
    default:
      return 'normal';
  }
}

export function toCanonicalTicket(c: AtlasConversation): CanonicalTicket {
  const customer = c.customer ? toCanonicalCustomer(c.customer) : null;
  const subject = (c.subject ?? '').trim();
  const fallback = (c.lastMessage?.text ?? '').replace(/<[^>]+>/g, '').trim();
  const title = subject || (fallback ? fallback.slice(0, 120) : `Atlas #${c.number ?? c.id}`);
  const createdAt = epochToDate(c.startedAt ?? c.createdAt) ?? new Date();
  return {
    sourceId: c.id,
    title,
    status: mapStatus(c.status),
    priority: mapPriority(c.priority),
    customer,
    agentEmail: c.assignedAgent?.email ?? null,
    createdAt,
    closedAt: epochToDate(c.closedAt),
    metadata: {
      atlas: {
        number: c.number ?? null,
        started_channel: c.startedChannel ?? null,
        assigned_agent_id: c.assignedAgentId ?? null,
        snoozed_until_epoch: c.snoozedUntil ?? null,
        custom_fields: c.customFields ?? null,
        tags: c.tags ?? [],
      },
    },
  };
}

export function toCanonicalMessage(m: AtlasMessage): CanonicalMessage {
  const isInternal = m.type === 'note' || m.type === 'sidebar_note';
  const authorType: SalveMessageAuthorType =
    m.side === 'customer' ? 'customer' : m.side === 'agent' ? 'agent' : 'system';
  const rawHtml = m.text ?? '';
  const html = sanitizeImportedHtml(rawHtml);
  // bodyText derives from the SANITIZED html — keeps search/preview consistent
  // with what the customer-facing UI actually renders.
  const text = html.replace(/<[^>]+>/g, '').trim();
  const attachments: CanonicalAttachmentRef[] = (m.attachments ?? []).map((a) => ({
    url: a.url,
    name: a.name ?? null,
    handle: a.handle ?? null,
    size: a.size ?? null,
    contentId: a.contentId ?? null,
  }));
  return {
    sourceId: String(m.id),
    authorType,
    authorEmail: m.agent?.email ?? null,
    authorCustomerSourceId: m.customer?.id ?? null,
    bodyHtml: html,
    bodyText: text,
    isInternal,
    createdAt: epochToDate(m.createdAt ?? m.sentAt) ?? new Date(),
    attachments,
    metadata: {
      atlas: {
        type: m.type,
        channel: m.channel ?? null,
        agent_first_name: m.agent?.firstName ?? null,
        attachments_count: attachments.length,
      },
    },
  };
}

function epochToDate(epochSeconds: number | null | undefined): Date | null {
  if (epochSeconds == null) return null;
  return new Date(epochSeconds * 1000);
}

// ---------- Custom fields ----------

export interface CanonicalCustomFieldDef {
  sourceId: string;
  key: string;
  displayName: string;
  description: string | null;
  category: SalveCustomFieldCategory;
  type: SalveCustomFieldType;
  options: string[];
  required: boolean;
  active: boolean;
  /** null when the Atlas field cannot be represented in Salve (e.g. account scope). */
  skipReason: string | null;
}

/**
 * Map an Atlas custom-field definition to a Salve definition. Returns a
 * `skipReason` when the field can't be migrated (account-scoped, unknown type).
 * Atlas type strings are TitleCase (`Boolean`, `List`, `MultiSelect`, …).
 */
export function toCanonicalCustomFieldDef(f: AtlasCustomField): CanonicalCustomFieldDef {
  const def: CanonicalCustomFieldDef = {
    sourceId: f.id,
    key: f.key,
    displayName: f.displayName || f.key,
    description: f.description ?? null,
    category: 'ticket',
    type: 'text',
    options: f.fieldMetadata ?? [],
    required: f.required,
    active: f.active,
    skipReason: null,
  };

  // Salve has no Account entity yet — skip.
  if (f.category === 'account') {
    return { ...def, skipReason: 'account-category-not-supported' };
  }
  if (f.category !== 'ticket' && f.category !== 'customer') {
    return { ...def, skipReason: `unknown-category:${f.category}` };
  }
  def.category = f.category;

  switch (f.type) {
    case 'Text':
      def.type = 'text';
      break;
    case 'Number':
      def.type = 'number';
      break;
    case 'Decimal':
      def.type = 'decimal';
      break;
    case 'Boolean':
      def.type = 'boolean';
      break;
    case 'Date':
      def.type = 'date';
      break;
    case 'List':
      def.type = 'list';
      break;
    case 'MultiSelect':
      def.type = 'multi_select';
      break;
    default:
      return { ...def, skipReason: `unknown-type:${f.type}` };
  }
  return def;
}

/**
 * Coerce a raw Atlas custom-field value into the JSON shape Salve expects for
 * the given Salve type. Returns `undefined` to mean "skip this value" (null
 * counts as a real "cleared" value for fields that allow nulls — but Atlas
 * sends null for absent so we drop those too).
 */
export function coerceCustomFieldValue(
  type: SalveCustomFieldType,
  raw: unknown,
): unknown | undefined {
  if (raw == null) return undefined;

  switch (type) {
    case 'text':
    case 'url':
    case 'address': {
      if (Array.isArray(raw)) return raw.length ? String(raw[0]) : undefined;
      return String(raw);
    }
    case 'number':
    case 'decimal': {
      const n = typeof raw === 'number' ? raw : Number(raw);
      return Number.isFinite(n) ? n : undefined;
    }
    case 'boolean': {
      if (typeof raw === 'boolean') return raw;
      if (typeof raw === 'string') {
        const v = raw.toLowerCase();
        if (v === 'true' || v === 'yes' || v === '1') return true;
        if (v === 'false' || v === 'no' || v === '0') return false;
      }
      if (typeof raw === 'number') return raw !== 0;
      return undefined;
    }
    case 'date': {
      // Accept epoch seconds (number), epoch ms, or ISO string. Store ISO.
      if (typeof raw === 'number') {
        const ms = raw < 1e12 ? raw * 1000 : raw;
        const d = new Date(ms);
        return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
      }
      if (typeof raw === 'string') {
        const d = new Date(raw);
        return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
      }
      return undefined;
    }
    case 'list': {
      // Atlas wraps List values in arrays in our sample data; unwrap if so.
      if (Array.isArray(raw)) return raw.length ? String(raw[0]) : undefined;
      return String(raw);
    }
    case 'multi_select': {
      if (Array.isArray(raw)) return raw.map((v) => String(v));
      return [String(raw)];
    }
  }
}

// ---------- Tags ----------

export interface CanonicalTagGroup {
  sourceId: string;
  label: string;
  /** Salve's tag_group.color is NOT NULL — fall back to a neutral grey. */
  color: string;
  archived: boolean;
}

export interface CanonicalTag {
  sourceId: string;
  label: string;
  /** Atlas tag-group source id; may not yet be mapped at the moment of upsert. */
  groupSourceId: string | null;
  /** Optional per-tag color (Salve allows null). */
  color: string | null;
  archived: boolean;
}

export function toCanonicalTagGroup(g: AtlasTagGroup): CanonicalTagGroup {
  return {
    sourceId: g.id,
    label: g.label,
    color: g.color && /^#[0-9a-f]{3,8}$/i.test(g.color) ? g.color : '#6b7280',
    archived: g.archived,
  };
}

export function toCanonicalTag(t: AtlasTag): CanonicalTag {
  return {
    sourceId: t.id,
    label: t.label.trim(),
    groupSourceId: t.groupId ?? null,
    color: null,
    archived: t.archived,
  };
}
