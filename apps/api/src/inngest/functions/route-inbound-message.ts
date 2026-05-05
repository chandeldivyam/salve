import { randomUUID } from 'node:crypto';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import {
  normalizeSubjectForThreading,
  parseAuthenticationResults,
  stripQuotedHtml,
  stripQuotedText,
} from '@salve/core';
import { getClient } from '@salve/db';
import { type AddressObject, type EmailAddress, type ParsedMail, simpleParser } from 'mailparser';
import type postgres from 'postgres';
import { parseReplyAddress, verifyBodyMarker } from '../../email/reply-token.js';
import { inngest } from '../client.js';
import { INBOUND_EVENT, inboundMessageReceivedDataSchema } from '../events.js';

type Sql = postgres.Sql<Record<string, unknown>>;

interface RawInboundRow {
  id: string;
  workspace_id: string;
  channel_id: string;
  provider_message_id: string | null;
  raw_blob_s3_key: string | null;
  raw_blob_size_bytes: number | null;
  headers: Record<string, unknown> | null;
  envelope_to: string | null;
  destination_address: string | null;
  sender_address: string | null;
  subject: string | null;
  processed_at: Date | null;
  channel_kind: string;
  default_priority: TicketPriority;
  new_ticket_after_closed_days: number;
}

// Inbound mail above this size is rejected before mail parsing. A 50 MB
// hard cap keeps the worker memory-bounded against an attacker (or a real
// mailing-list digest) sending a multi-hundred-megabyte payload that would
// OOM `simpleParser`. AWS SES already enforces a similar limit at ingress;
// this is defense in depth for the rare case where the row was queued via a
// different path.
const MAX_INBOUND_RAW_BYTES = 50 * 1024 * 1024;

type TicketPriority = 'low' | 'normal' | 'high' | 'urgent';

interface NormalizedAddress {
  address: string;
  name?: string;
}

interface NormalizedEmail {
  messageID: string | null;
  inReplyTo: string[];
  references: string[];
  subject: string;
  from: NormalizedAddress | null;
  replyTo: NormalizedAddress | null;
  to: NormalizedAddress[];
  cc: NormalizedAddress[];
  html: string | null;
  text: string;
  headers: Record<string, string | string[]>;
  authResults: AuthResults;
  raw: string;
}

interface AuthResults {
  spf?: string;
  dkim?: string;
  dmarc?: string;
  raw: string[];
}

interface ServiceEmailContext {
  emails: Set<string>;
  domains: Set<string>;
}

interface DestinationContext {
  emailAddressID: string | null;
  fullAddress: string | null;
  defaultTeamID: string | null;
}

interface CustomerContext {
  id: string;
  email: string;
  name: string | null;
  forwardedFromColleague: boolean;
  forwarderEmail: string | null;
  requesterEmail: string;
}

interface TicketCandidate {
  ticketID: string;
  title: string;
  status: string;
  closedAt: Date | null;
  customerID: string | null;
  matchReason: string;
}

interface RoutingResult {
  priority: TicketPriority;
  assigneeID: string | null;
  defaultTeamID: string | null;
  ruleID: string | null;
}

interface PersistedInbound {
  ticketID: string;
  messageID: string;
  createdTicket: boolean;
  matchReason: string | null;
}

interface InboundMessageReceivedData {
  workspaceID: string;
  channelID: string;
  rawID: string;
  providerMessageID: string;
}

interface StepRunner {
  run: <T>(name: string, fn: () => Promise<T>) => Promise<T>;
}

interface LoggerLike {
  info: (message: string, data?: Record<string, unknown>) => void;
}

const inFlightInbound = new Map<string, number>();
const IN_FLIGHT_TTL_MS = 10 * 60 * 1000;

const s3 = new S3Client({
  region:
    process.env.S3_REGION ??
    process.env.AWS_REGION ??
    process.env.AWS_DEFAULT_REGION ??
    'us-east-1',
  endpoint: process.env.S3_ENDPOINT,
  forcePathStyle: (process.env.S3_FORCE_PATH_STYLE ?? 'true') === 'true',
  credentials:
    process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY
      ? {
          accessKeyId: process.env.S3_ACCESS_KEY_ID,
          secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
        }
      : undefined,
});

export const routeInboundMessage = inngest.createFunction(
  {
    id: 'route-inbound-message',
    name: 'Route inbound message',
    retries: 4,
    concurrency: [{ scope: 'fn', key: 'event.data.channelID', limit: 20 }],
    triggers: [{ event: INBOUND_EVENT.MESSAGE_RECEIVED }],
  },
  // biome-ignore lint/suspicious/noExplicitAny: Inngest 4 event typing is validated locally with Zod.
  async ({ event, step, logger }: any) => {
    const data = inboundMessageReceivedDataSchema.parse(event.data);
    return processInboundMessage(data, step, logger);
  },
);

export async function processInboundMessage(
  data: InboundMessageReceivedData,
  step: StepRunner = directStepRunner,
  logger: LoggerLike = console,
) {
  const guardKey = `${data.channelID}:${data.providerMessageID}`;
  if (!acquireInFlight(guardKey)) {
    logger.info('inbound message already processing in this worker', { guardKey });
    return { ok: true, skipped: 'duplicate-in-flight' as const };
  }

  try {
    const rawRow = await step.run('load-raw', async () => loadRawInbound(getClient(), data));
    if (!rawRow) return { ok: false, reason: 'raw-not-found' as const };
    if (rawRow.processed_at) return { ok: true, skipped: 'already-processed' as const };

    if (rawRow.channel_kind !== 'email') {
      await step.run('mark-unsupported-channel', async () =>
        markSkipped(getClient(), rawRow.id, 'unsupported_channel', {
          channelKind: rawRow.channel_kind,
        }),
      );
      return { ok: false, reason: 'unsupported-channel' as const };
    }

    let email: NormalizedEmail;
    try {
      email = await step.run('parse-email', async () => {
        const raw = await loadRawRFC822(rawRow);
        return normalizeParsedEmail(await simpleParser(raw, { keepCidLinks: true }), raw);
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await step.run('mark-parse-error', async () =>
        markParseError(getClient(), rawRow.id, message),
      );
      return { ok: false, reason: 'parse-error' as const, error: message };
    }

    const services = await step.run('load-service-emails', async () =>
      loadServiceEmailContext(getClient(), rawRow.workspace_id),
    );

    const loopGuard = await step.run('loop-guard', async () =>
      checkLoopGuard(getClient(), rawRow, email, services),
    );
    if (loopGuard.skipReason) {
      const skipReason = loopGuard.skipReason;
      await step.run('mark-loop-skipped', async () =>
        markSkipped(getClient(), rawRow.id, skipReason, {
          headers: email.headers,
          authResults: email.authResults,
          subject: email.subject,
        }),
      );
      return { ok: true, skipped: skipReason };
    }

    const destination = await step.run('resolve-destination-address', async () =>
      resolveDestination(getClient(), rawRow, email),
    );

    const customer = await step.run('identify-customer', async () =>
      identifyCustomer(getClient(), rawRow.workspace_id, email, services),
    );

    const thread = await step.run('thread-match', async () =>
      matchThread(getClient(), rawRow, email, customer, destination),
    );

    const reusableThread =
      thread && !shouldForkClosedTicket(thread, rawRow.new_ticket_after_closed_days)
        ? thread
        : null;
    const fromAddress = email.from?.address;
    if (reusableThread && fromAddress) {
      const rateLimited = await step.run('conversation-rate-limit', async () =>
        isConversationRateLimited(getClient(), rawRow, reusableThread.ticketID, fromAddress),
      );
      if (rateLimited) {
        await step.run('mark-rate-limited', async () =>
          markSkipped(getClient(), rawRow.id, 'rate_limited', {
            headers: email.headers,
            authResults: email.authResults,
            subject: email.subject,
          }),
        );
        return { ok: true, skipped: 'rate_limited' as const };
      }
    }

    const routing = await step.run('apply-routing-rules', async () =>
      applyRoutingRules(getClient(), rawRow, email, destination),
    );

    const persisted = await step.run('upsert-ticket-message', async () =>
      persistInboundMessage(getClient(), rawRow, email, customer, destination, thread, routing),
    );

    await step.run('mark-processed', async () =>
      markProcessed(getClient(), rawRow.id, persisted, {
        headers: email.headers,
        authResults: email.authResults,
        subject: email.subject,
        messageID: email.messageID,
        destinationAddress: destination.fullAddress,
      }),
    );

    return { ok: true, ...persisted };
  } finally {
    releaseInFlight(guardKey);
  }
}

const directStepRunner: StepRunner = {
  run: async (_name, fn) => fn(),
};

async function loadRawInbound(
  sql: Sql,
  data: { rawID: string; workspaceID: string; channelID: string },
): Promise<RawInboundRow | null> {
  const rows = await sql<RawInboundRow[]>`
    SELECT
      imr.id,
      imr.workspace_id,
      imr.channel_id,
      imr.provider_message_id,
      imr.raw_blob_s3_key,
      imr.raw_blob_size_bytes,
      imr.headers,
      imr.envelope_to,
      imr.destination_address,
      imr.sender_address,
      imr.subject,
      imr.processed_at,
      c.kind AS channel_kind,
      ec.default_priority,
      ec.new_ticket_after_closed_days
    FROM inbound_message_raw imr
    JOIN channel c ON c.id = imr.channel_id
    LEFT JOIN email_channel ec ON ec.channel_id = imr.channel_id
    WHERE imr.id = ${data.rawID}
      AND imr.workspace_id = ${data.workspaceID}
      AND imr.channel_id = ${data.channelID}
    LIMIT 1
  `;
  return rows[0] ?? null;
}

async function loadRawRFC822(row: RawInboundRow): Promise<string> {
  if (row.raw_blob_size_bytes && row.raw_blob_size_bytes > MAX_INBOUND_RAW_BYTES) {
    throw new Error(
      `inbound raw exceeds ${MAX_INBOUND_RAW_BYTES} bytes (got ${row.raw_blob_size_bytes})`,
    );
  }
  const devRaw = nestedString(row.headers, ['salve', 'devRawRFC822']);
  if (row.raw_blob_s3_key?.startsWith('dev://')) {
    if (!devRaw) throw new Error('dev inbound raw row is missing salve.devRawRFC822');
    if (Buffer.byteLength(devRaw) > MAX_INBOUND_RAW_BYTES) {
      throw new Error(`inbound raw exceeds ${MAX_INBOUND_RAW_BYTES} bytes`);
    }
    return devRaw;
  }
  if (!row.raw_blob_s3_key) throw new Error('raw_blob_s3_key is empty');

  const s3Ref = parseS3Ref(row.raw_blob_s3_key);
  const object = await s3.send(new GetObjectCommand({ Bucket: s3Ref.bucket, Key: s3Ref.key }));
  // Trust the metadata size when the row was inserted with one (cheap),
  // otherwise fall back to checking ContentLength on the S3 response. Both
  // are still pre-parse so an oversized payload never reaches `simpleParser`.
  const contentLength = Number(object.ContentLength ?? 0);
  if (contentLength > MAX_INBOUND_RAW_BYTES) {
    throw new Error(
      `inbound raw exceeds ${MAX_INBOUND_RAW_BYTES} bytes (s3 content-length ${contentLength})`,
    );
  }
  const body = object.Body as { transformToByteArray?: () => Promise<Uint8Array> } | undefined;
  if (!body?.transformToByteArray) throw new Error('S3 object body is not readable');
  const bytes = await body.transformToByteArray();
  if (bytes.length > MAX_INBOUND_RAW_BYTES) {
    throw new Error(`inbound raw exceeds ${MAX_INBOUND_RAW_BYTES} bytes (post-read)`);
  }
  return Buffer.from(bytes).toString('utf8');
}

function normalizeParsedEmail(parsed: ParsedMail, raw: string): NormalizedEmail {
  const headers = plainHeaders(parsed);
  const references = normalizeMessageIDs([
    ...messageIDList(parsed.references),
    ...messageIDList(headers.references),
  ]);
  const inReplyTo = normalizeMessageIDs([
    parsed.inReplyTo,
    ...messageIDList(headers['in-reply-to']),
  ]);

  return {
    messageID: normalizeMessageID(parsed.messageId ?? firstHeader(headers['message-id'])),
    inReplyTo,
    references,
    subject: parsed.subject?.trim() ?? '',
    from: firstAddress(parsed.from),
    replyTo: firstAddress(parsed.replyTo),
    to: addressList(parsed.to),
    cc: addressList(parsed.cc),
    html: typeof parsed.html === 'string' ? parsed.html : null,
    text: parsed.text ?? htmlToText(typeof parsed.html === 'string' ? parsed.html : ''),
    headers,
    authResults: parseAuthResults(headers),
    raw,
  };
}

async function checkLoopGuard(
  sql: Sql,
  row: RawInboundRow,
  email: NormalizedEmail,
  services: ServiceEmailContext,
): Promise<{ skipReason?: string }> {
  const autoSubmitted = firstHeader(email.headers['auto-submitted'])?.toLowerCase();
  if (autoSubmitted && autoSubmitted !== 'no') return { skipReason: 'auto_submitted' };

  const precedence = firstHeader(email.headers.precedence)?.toLowerCase();
  if (precedence && ['bulk', 'junk', 'list'].includes(precedence)) {
    return { skipReason: 'bulk_or_list' };
  }

  if (
    hasHeader(email.headers, 'x-autoreply') ||
    hasHeader(email.headers, 'x-autoresponder') ||
    hasHeader(email.headers, 'x-autoresponse-suppress') ||
    hasHeader(email.headers, 'x-auto-response-suppress')
  ) {
    return { skipReason: 'auto_response' };
  }

  const from = email.from?.address;
  if (from && isBounceLikeAddress(from)) return { skipReason: 'bounce_or_no_reply' };

  const ownMessageIDs = await findOutboundByRFCMessageID(sql, {
    workspaceID: row.workspace_id,
    channelID: row.channel_id,
    messageIDs: email.messageID ? [email.messageID] : [],
    withinDays: null,
  });
  if (ownMessageIDs.length > 0) return { skipReason: 'self_sent' };

  const referencedIDs = normalizeMessageIDs([
    ...email.inReplyTo,
    ...email.references,
    ...idsInText(email.raw),
  ]);
  if (referencedIDs.length > 0) {
    const referencedOwn = await findOutboundByRFCMessageID(sql, {
      workspaceID: row.workspace_id,
      channelID: row.channel_id,
      messageIDs: referencedIDs,
      withinDays: null,
    });
    if (
      referencedOwn.length > 0 &&
      from &&
      (services.emails.has(from) || isBounceLikeAddress(from))
    ) {
      return { skipReason: 'self_reference_loop' };
    }
  }

  return {};
}

async function identifyCustomer(
  sql: Sql,
  workspaceID: string,
  email: NormalizedEmail,
  services: ServiceEmailContext,
): Promise<CustomerContext> {
  const forwarded = detectForwardFromColleague(email, services);
  const from = email.from;
  const replyTo = email.replyTo;
  let author = forwarded.requester ?? from;

  if (from?.address && services.emails.has(from.address) && replyTo?.address) {
    author = replyTo;
  } else if (from?.address && replyTo?.address && replyTo.address !== from.address) {
    const replyToCustomer = await findCustomerByEmail(sql, workspaceID, replyTo.address);
    if (replyToCustomer) author = replyTo;
  }

  if (!author?.address) {
    throw new Error('inbound email has no usable From/Reply-To customer address');
  }
  if (services.emails.has(author.address)) {
    throw new Error('inbound email resolved to a service email as customer');
  }

  const customer = await findOrCreateCustomer(sql, {
    workspaceID,
    email: author.address,
    name: author.name,
  });

  const alternateCandidates = [
    replyTo?.address && replyTo.address !== customer.email ? replyTo.address : null,
    forwarded.requester?.address && forwarded.requester.address !== customer.email
      ? forwarded.requester.address
      : null,
  ].filter((value): value is string => Boolean(value));
  for (const alternate of alternateCandidates) {
    await addAlternateEmailIfSafe(sql, {
      workspaceID,
      customerID: customer.id,
      email: alternate,
      serviceEmails: services.emails,
    });
  }

  return {
    id: customer.id,
    email: customer.email,
    name: customer.name,
    forwardedFromColleague: forwarded.detected,
    forwarderEmail: forwarded.forwarder?.address ?? null,
    requesterEmail: author.address,
  };
}

async function matchThread(
  sql: Sql,
  row: RawInboundRow,
  email: NormalizedEmail,
  customer: CustomerContext,
  destination: DestinationContext,
): Promise<TicketCandidate | null> {
  const inReplyToMatch = await candidateFromOutboundIDs(
    sql,
    row,
    email.inReplyTo,
    null,
    'in_reply_to',
  );
  const validInReplyTo = chooseSubjectCompatible(inReplyToMatch, email.subject);
  if (validInReplyTo) return validInReplyTo;

  const referencesMatch = await candidateFromOutboundIDs(
    sql,
    row,
    email.references,
    30,
    'references',
  );
  const validReferences = chooseSubjectCompatible(referencesMatch, email.subject);
  if (validReferences) return validReferences;

  const replyTokenMatch = await candidateFromReplyToken(sql, row, [
    ...allRecipientAddresses(email),
    ...emailAddressesInText(email.raw),
  ]);
  const validReplyToken = chooseSubjectCompatible(replyTokenMatch, email.subject);
  if (validReplyToken) return validReplyToken;

  const addressSubjectMatch = await candidateFromAddressAndSubject(
    sql,
    row,
    email,
    customer,
    destination,
  );
  if (addressSubjectMatch) return addressSubjectMatch;

  const cssMarkerMatch = await candidateFromBodyTicketID(
    sql,
    row,
    extractCSSMarkerTicketIDs(email.html ?? ''),
    'css_selector',
  );
  const validCSS = chooseSubjectCompatible(cssMarkerMatch, email.subject);
  if (validCSS) return validCSS;

  const bodyMarkerMatch = await candidateFromBodyTicketID(
    sql,
    row,
    extractMagicTicketIDs(`${email.text}\n${email.html ?? ''}`, row.workspace_id),
    'body_marker',
  );
  const validBody = chooseSubjectCompatible(bodyMarkerMatch, email.subject);
  if (validBody) return validBody;

  return null;
}

async function resolveDestination(
  sql: Sql,
  row: RawInboundRow,
  email: NormalizedEmail,
): Promise<DestinationContext> {
  const candidates = [
    row.destination_address,
    row.envelope_to,
    firstHeader(email.headers['delivered-to']),
    firstHeader(email.headers['x-original-to']),
    firstHeader(email.headers['x-forwarded-to']),
    ...allRecipientAddresses(email),
  ]
    .map((addr) => normalizeAddress(addr))
    .filter((addr): addr is string => Boolean(addr));

  for (const address of candidates) {
    const rows = await sql<
      Array<{ id: string; full_address: string; default_team_id: string | null }>
    >`
      SELECT id, full_address, default_team_id
      FROM email_address
      WHERE workspace_id = ${row.workspace_id}
        AND channel_id = ${row.channel_id}
        AND lower(full_address) = ${address}
        AND can_receive = true
        AND deleted_at IS NULL
      LIMIT 1
    `;
    const found = rows[0];
    if (found) {
      return {
        emailAddressID: found.id,
        fullAddress: found.full_address.toLowerCase(),
        defaultTeamID: found.default_team_id,
      };
    }
  }

  const defaults = await sql<
    Array<{ id: string; full_address: string; default_team_id: string | null }>
  >`
    SELECT id, full_address, default_team_id
    FROM email_address
    WHERE workspace_id = ${row.workspace_id}
      AND channel_id = ${row.channel_id}
      AND can_receive = true
      AND deleted_at IS NULL
    ORDER BY is_default DESC, created_at ASC
    LIMIT 1
  `;
  const fallback = defaults[0];
  return fallback
    ? {
        emailAddressID: fallback.id,
        fullAddress: fallback.full_address.toLowerCase(),
        defaultTeamID: fallback.default_team_id,
      }
    : { emailAddressID: null, fullAddress: null, defaultTeamID: null };
}

async function applyRoutingRules(
  sql: Sql,
  row: RawInboundRow,
  email: NormalizedEmail,
  destination: DestinationContext,
): Promise<RoutingResult> {
  const fallback: RoutingResult = {
    priority: row.default_priority ?? 'normal',
    assigneeID: null,
    defaultTeamID: destination.defaultTeamID,
    ruleID: null,
  };

  let rows: Array<{ rule: Record<string, unknown> }>;
  try {
    rows = await sql<Array<{ rule: Record<string, unknown> }>>`
      SELECT to_jsonb(irr) AS rule
      FROM inbound_routing_rule irr
      WHERE irr.workspace_id = ${row.workspace_id}
        AND irr.channel_id = ${row.channel_id}
      ORDER BY COALESCE((to_jsonb(irr)->>'priority')::int, 100), irr.created_at ASC
    `;
  } catch (err) {
    if (isUndefinedTableOrColumn(err)) return fallback;
    throw err;
  }

  for (const { rule } of rows) {
    if (!ruleEnabled(rule)) continue;
    const addressID = stringProp(rule, 'email_address_id') ?? stringProp(rule, 'address_id');
    if (addressID && addressID !== destination.emailAddressID) continue;
    if (!matchesPattern(stringProp(rule, 'sender_pattern'), email.from?.address ?? '')) continue;
    if (!matchesPattern(stringProp(rule, 'subject_pattern'), email.subject)) continue;

    const action = objectProp(rule, 'action');
    return {
      priority:
        asTicketPriority(stringProp(rule, 'set_priority') ?? stringProp(action, 'priority')) ??
        fallback.priority,
      assigneeID: stringProp(rule, 'assign_agent_id') ?? stringProp(action, 'assignAgentID'),
      defaultTeamID:
        stringProp(rule, 'assign_team_id') ??
        stringProp(action, 'assignTeamID') ??
        fallback.defaultTeamID,
      ruleID: stringProp(rule, 'id'),
    };
  }

  return fallback;
}

async function isConversationRateLimited(
  sql: Sql,
  row: RawInboundRow,
  ticketID: string,
  fromAddress: string,
): Promise<boolean> {
  const rows = await sql<Array<{ count: string | number }>>`
    SELECT count(*) AS count
    FROM inbound_message_raw
    WHERE workspace_id = ${row.workspace_id}
      AND channel_id = ${row.channel_id}
      AND processed_ticket_id = ${ticketID}
      AND lower(sender_address) = ${fromAddress.toLowerCase()}
      AND received_at > now() - interval '5 minutes'
  `;
  const count = Number(rows[0]?.count ?? 0);
  return count >= 20;
}

async function persistInboundMessage(
  sql: Sql,
  row: RawInboundRow,
  email: NormalizedEmail,
  customer: CustomerContext,
  destination: DestinationContext,
  thread: TicketCandidate | null,
  routing: RoutingResult,
): Promise<PersistedInbound> {
  return sql.begin(async (tx) => {
    const reusableThread =
      thread && !shouldForkClosedTicket(thread, row.new_ticket_after_closed_days);
    const ticketID = reusableThread ? thread.ticketID : randomUUID();
    const messageID = randomUUID();
    const bodyText = stripQuotedText(email.text || htmlToText(email.html ?? '') || '(no body)');
    const cleanedHtml = email.html ? stripQuotedHtml(email.html) : '';
    const bodyHtml = cleanedHtml || textToHtml(bodyText);

    if (reusableThread) {
      await tx`
        UPDATE ticket
        SET status = 'open',
            closed_at = NULL,
            closed_by_id = NULL,
            priority = ${routing.priority},
            assignee_id = COALESCE(${routing.assigneeID}, assignee_id),
            updated_at = now()
        WHERE id = ${ticketID}
          AND workspace_id = ${row.workspace_id}
      `;
    } else {
      await tx`
        INSERT INTO ticket (
          id,
          workspace_id,
          short_id,
          title,
          description,
          status,
          priority,
          customer_id,
          assignee_id,
          created_by_id,
          created_at,
          updated_at
        )
        VALUES (
          ${ticketID},
          ${row.workspace_id},
          0,
          ${email.subject || '(no subject)'},
          ${bodyText.slice(0, 1000)},
          'open',
          ${routing.priority},
          ${customer.id},
          ${routing.assigneeID},
          NULL,
          now(),
          now()
        )
      `;
    }

    await tx`
      INSERT INTO message (
        id,
        workspace_id,
        ticket_id,
        author_type,
        author_user_id,
        author_customer_id,
        body_html,
        body_text,
        is_internal,
        created_at
      )
      VALUES (
        ${messageID},
        ${row.workspace_id},
        ${ticketID},
        'customer',
        NULL,
        ${customer.id},
        ${bodyHtml},
        ${bodyText},
        false,
        now()
      )
    `;

    await tx`
      UPDATE ticket
      SET updated_at = now()
      WHERE id = ${ticketID}
    `;

    await tx`
      INSERT INTO audit_event (id, workspace_id, ticket_id, actor_id, kind, payload, created_at)
      VALUES (
        ${randomUUID()},
        ${row.workspace_id},
        ${ticketID},
        NULL,
        ${reusableThread ? 'message.received' : 'ticket.created_from_inbound'},
        ${JSON.stringify({
          inboundRawID: row.id,
          providerMessageID: row.provider_message_id,
          inboundMessageID: email.messageID,
          destinationAddress: destination.fullAddress,
          emailAddressID: destination.emailAddressID,
          routingRuleID: routing.ruleID,
          defaultTeamID: routing.defaultTeamID,
          authResults: email.authResults,
          forwardedFromColleague: customer.forwardedFromColleague,
          forwarderEmail: customer.forwarderEmail,
          matchReason: thread?.matchReason ?? null,
        })}::jsonb,
        now()
      )
    `;

    return {
      ticketID,
      messageID,
      createdTicket: !reusableThread,
      matchReason: reusableThread ? thread.matchReason : null,
    };
  });
}

async function markProcessed(
  sql: Sql,
  rawID: string,
  persisted: PersistedInbound,
  metadata: Record<string, unknown>,
): Promise<void> {
  await updateInboundRaw(sql, rawID, {
    processedAt: true,
    processedTicketID: persisted.ticketID,
    processedMessageID: persisted.messageID,
    parseError: null,
    skipReason: null,
    authenticationResults: metadata.authResults,
    subject: typeof metadata.subject === 'string' ? metadata.subject : undefined,
    headersPatch: { salve: { processed: true, ...metadata } },
  });
}

async function markSkipped(
  sql: Sql,
  rawID: string,
  skipReason: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  await updateInboundRaw(sql, rawID, {
    processedAt: true,
    parseError: null,
    skipReason,
    authenticationResults: metadata.authResults,
    subject: typeof metadata.subject === 'string' ? metadata.subject : undefined,
    headersPatch: { salve: { skipped: true, skipReason, ...metadata } },
  });
}

async function markParseError(sql: Sql, rawID: string, parseError: string): Promise<void> {
  await updateInboundRaw(sql, rawID, {
    processedAt: true,
    parseError,
    skipReason: 'parse_error',
    headersPatch: { salve: { skipped: true, skipReason: 'parse_error' } },
  });
}

async function updateInboundRaw(
  sql: Sql,
  rawID: string,
  update: {
    processedAt?: boolean;
    processedTicketID?: string;
    processedMessageID?: string;
    parseError?: string | null;
    skipReason?: string | null;
    authenticationResults?: unknown;
    subject?: string;
    headersPatch?: Record<string, unknown>;
  },
): Promise<void> {
  const cols = await inboundRawColumns(sql);
  const sets: string[] = [];
  const params: postgres.JSONValue[] = [];

  if (update.processedAt && cols.has('processed_at')) sets.push('processed_at = now()');
  pushSet(cols, sets, params, 'processed_ticket_id', update.processedTicketID);
  pushSet(cols, sets, params, 'processed_message_id', update.processedMessageID);
  if (update.parseError !== undefined)
    pushSet(cols, sets, params, 'parse_error', update.parseError);
  if (update.skipReason !== undefined)
    pushSet(cols, sets, params, 'skip_reason', update.skipReason);
  if (update.subject !== undefined) pushSet(cols, sets, params, 'subject', update.subject);
  if (update.authenticationResults !== undefined && cols.has('authentication_results')) {
    params.push(JSON.stringify(update.authenticationResults));
    sets.push(`authentication_results = $${params.length}::jsonb`);
  }
  if (update.headersPatch && cols.has('headers')) {
    params.push(JSON.stringify(update.headersPatch));
    sets.push(`headers = COALESCE(headers, '{}'::jsonb) || $${params.length}::jsonb`);
  }

  if (sets.length === 0) return;
  params.push(rawID);
  await sql.unsafe(
    `UPDATE inbound_message_raw SET ${sets.join(', ')} WHERE id = $${params.length}`,
    params,
  );
}

async function candidateFromOutboundIDs(
  sql: Sql,
  row: RawInboundRow,
  messageIDs: string[],
  withinDays: number | null,
  reason: string,
): Promise<TicketCandidate[]> {
  const ids = normalizeMessageIDs(messageIDs);
  if (ids.length === 0) return [];
  const rows = await sql<
    Array<{
      ticket_id: string;
      title: string;
      status: string;
      closed_at: Date | null;
      customer_id: string | null;
    }>
  >`
    SELECT DISTINCT ON (t.id)
      t.id AS ticket_id,
      t.title,
      t.status,
      t.closed_at,
      t.customer_id
    FROM outbound_message om
    JOIN ticket t ON t.id = om.ticket_id
    WHERE om.workspace_id = ${row.workspace_id}
      AND om.channel_id = ${row.channel_id}
      AND om.provider_meta->>'rfcMessageID' = ANY(${sql.array(ids)})
      ${withinDays ? sql`AND om.created_at > now() - (${withinDays} || ' days')::interval` : sql``}
    ORDER BY t.id, om.created_at DESC
  `;
  return rows.map((candidate) => ({
    ticketID: candidate.ticket_id,
    title: candidate.title,
    status: candidate.status,
    closedAt: candidate.closed_at,
    customerID: candidate.customer_id,
    matchReason: reason,
  }));
}

async function candidateFromReplyToken(
  sql: Sql,
  row: RawInboundRow,
  addresses: string[],
): Promise<TicketCandidate[]> {
  for (const address of addresses) {
    const parsed = parseReplyAddress(address);
    if (!parsed || parsed.workspaceID !== row.workspace_id) continue;
    const candidate = await loadTicketCandidate(
      sql,
      row.workspace_id,
      parsed.ticketID,
      'reply_token',
    );
    if (candidate) return [candidate];
  }
  return [];
}

async function candidateFromAddressAndSubject(
  sql: Sql,
  row: RawInboundRow,
  email: NormalizedEmail,
  customer: CustomerContext,
  destination: DestinationContext,
): Promise<TicketCandidate | null> {
  if (!destination.emailAddressID || !destination.fullAddress || !email.subject) return null;
  const rows = await sql<
    Array<{
      ticket_id: string;
      title: string;
      status: string;
      closed_at: Date | null;
      customer_id: string | null;
    }>
  >`
    SELECT
      t.id AS ticket_id,
      t.title,
      t.status,
      t.closed_at,
      t.customer_id
    FROM ticket t
    WHERE t.workspace_id = ${row.workspace_id}
      AND t.customer_id = ${customer.id}
      AND t.updated_at > now() - interval '30 days'
      AND EXISTS (
        SELECT 1
        FROM inbound_message_raw imr
        WHERE imr.workspace_id = t.workspace_id
          AND imr.channel_id = ${row.channel_id}
          AND imr.processed_ticket_id = t.id
          AND lower(imr.destination_address) = ${destination.fullAddress}
      )
    ORDER BY t.updated_at DESC
    LIMIT 25
  `;
  const candidates = rows.map((candidate) => ({
    ticketID: candidate.ticket_id,
    title: candidate.title,
    status: candidate.status,
    closedAt: candidate.closed_at,
    customerID: candidate.customer_id,
    matchReason: 'address_subject',
  }));
  return chooseSubjectCompatible(candidates, email.subject);
}

async function candidateFromBodyTicketID(
  sql: Sql,
  row: RawInboundRow,
  ticketIDs: string[],
  reason: string,
): Promise<TicketCandidate[]> {
  for (const ticketID of ticketIDs) {
    const candidate = await loadTicketCandidate(sql, row.workspace_id, ticketID, reason);
    if (candidate) return [candidate];
  }
  return [];
}

async function loadTicketCandidate(
  sql: Sql,
  workspaceID: string,
  ticketID: string,
  reason: string,
): Promise<TicketCandidate | null> {
  const rows = await sql<
    Array<{
      id: string;
      title: string;
      status: string;
      closed_at: Date | null;
      customer_id: string | null;
    }>
  >`
    SELECT id, title, status, closed_at, customer_id
    FROM ticket
    WHERE id = ${ticketID}
      AND workspace_id = ${workspaceID}
    LIMIT 1
  `;
  const row = rows[0];
  return row
    ? {
        ticketID: row.id,
        title: row.title,
        status: row.status,
        closedAt: row.closed_at,
        customerID: row.customer_id,
        matchReason: reason,
      }
    : null;
}

async function findOutboundByRFCMessageID(
  sql: Sql,
  args: { workspaceID: string; channelID: string; messageIDs: string[]; withinDays: number | null },
): Promise<string[]> {
  const ids = normalizeMessageIDs(args.messageIDs);
  if (ids.length === 0) return [];
  const rows = await sql<Array<{ rfc_message_id: string }>>`
    SELECT provider_meta->>'rfcMessageID' AS rfc_message_id
    FROM outbound_message
    WHERE workspace_id = ${args.workspaceID}
      AND channel_id = ${args.channelID}
      AND provider_meta->>'rfcMessageID' = ANY(${sql.array(ids)})
      ${args.withinDays ? sql`AND created_at > now() - (${args.withinDays} || ' days')::interval` : sql``}
  `;
  return rows.map((r) => r.rfc_message_id).filter(Boolean);
}

async function loadServiceEmailContext(
  sql: Sql,
  workspaceID: string,
): Promise<ServiceEmailContext> {
  const rows = await sql<Array<{ full_address: string; domain: string | null }>>`
    SELECT ea.full_address, sd.domain
    FROM email_address ea
    LEFT JOIN sending_domain sd ON sd.id = ea.sending_domain_id
    WHERE ea.workspace_id = ${workspaceID}
      AND ea.deleted_at IS NULL
  `;
  const emails = new Set<string>();
  const domains = new Set<string>();
  for (const row of rows) {
    emails.add(row.full_address.toLowerCase());
    if (row.domain) domains.add(row.domain.toLowerCase());
    const domain = row.full_address.split('@')[1];
    if (domain) domains.add(domain.toLowerCase());
  }
  domains.add((process.env.INBOUND_EMAIL_DOMAIN ?? 'in.usesalve.com').toLowerCase());
  domains.add((process.env.REPLY_DOMAIN ?? 'reply.usesalve.com').toLowerCase());
  return { emails, domains };
}

async function findCustomerByEmail(
  sql: Sql,
  workspaceID: string,
  email: string,
): Promise<{ id: string; email: string; name: string | null } | null> {
  const normalized = email.toLowerCase();
  const rows = await sql<Array<{ id: string; email: string; name: string | null }>>`
    SELECT id, email, name
    FROM customer
    WHERE workspace_id = ${workspaceID}
      AND (
        lower(email) = ${normalized}
        OR EXISTS (
          SELECT 1
          FROM jsonb_array_elements_text(COALESCE(alternate_emails, '[]'::jsonb)) alt(email)
          WHERE lower(alt.email) = ${normalized}
        )
      )
    LIMIT 1
  `;
  return rows[0] ?? null;
}

async function findOrCreateCustomer(
  sql: Sql,
  args: { workspaceID: string; email: string; name?: string },
): Promise<{ id: string; email: string; name: string | null }> {
  const existing = await findCustomerByEmail(sql, args.workspaceID, args.email);
  if (existing) return existing;

  const id = randomUUID();
  const rows = await sql<Array<{ id: string; email: string; name: string | null }>>`
    INSERT INTO customer (
      id,
      workspace_id,
      email,
      name,
      display_name,
      alternate_emails,
      created_at,
      updated_at
    )
    VALUES (
      ${id},
      ${args.workspaceID},
      ${args.email.toLowerCase()},
      ${args.name ?? null},
      ${args.name ?? null},
      '[]'::jsonb,
      now(),
      now()
    )
    ON CONFLICT (workspace_id, email) DO UPDATE
    SET updated_at = customer.updated_at
    RETURNING id, email, name
  `;
  return rows[0] ?? { id, email: args.email.toLowerCase(), name: args.name ?? null };
}

async function addAlternateEmailIfSafe(
  sql: Sql,
  args: {
    workspaceID: string;
    customerID: string;
    email: string;
    serviceEmails: Set<string>;
  },
): Promise<void> {
  const email = args.email.toLowerCase();
  if (args.serviceEmails.has(email) || isBounceLikeAddress(email)) return;
  const primary = await sql<Array<{ id: string }>>`
    SELECT id
    FROM customer
    WHERE workspace_id = ${args.workspaceID}
      AND lower(email) = ${email}
      AND id <> ${args.customerID}
    LIMIT 1
  `;
  if (primary[0]) return;

  await sql`
    UPDATE customer
    SET alternate_emails = COALESCE(alternate_emails, '[]'::jsonb) || jsonb_build_array(${email}),
        updated_at = now()
    WHERE id = ${args.customerID}
      AND workspace_id = ${args.workspaceID}
      AND lower(email) <> ${email}
      AND NOT EXISTS (
        SELECT 1
        FROM jsonb_array_elements_text(COALESCE(alternate_emails, '[]'::jsonb)) alt(email)
        WHERE lower(alt.email) = ${email}
      )
  `;
}

function detectForwardFromColleague(
  email: NormalizedEmail,
  services: ServiceEmailContext,
): {
  detected: boolean;
  requester: NormalizedAddress | null;
  forwarder: NormalizedAddress | null;
} {
  const from = email.from;
  const fromDomain = from?.address.split('@')[1];
  const sentFromWorkspaceDomain = Boolean(fromDomain && services.domains.has(fromDomain));
  const body = `${email.subject}\n${email.text}\n${email.html ?? ''}`;
  const looksForwarded =
    /(^|\n)-+\s*forwarded message\s*-+/i.test(body) ||
    /\bFwd?:/i.test(email.subject) ||
    /(^|\n)From:\s*.+\n(?:Date|Sent):\s*.+\n(?:To|Subject):/i.test(body);
  if (!from || !sentFromWorkspaceDomain || !looksForwarded) {
    return { detected: false, requester: null, forwarder: null };
  }

  const requester = extractForwardedFrom(body);
  if (!requester || requester.address === from.address || services.emails.has(requester.address)) {
    return { detected: false, requester: null, forwarder: null };
  }
  return { detected: true, requester, forwarder: from };
}

function chooseSubjectCompatible(
  candidates: TicketCandidate[] | TicketCandidate | null,
  inboundSubject: string,
): TicketCandidate | null {
  const list = Array.isArray(candidates) ? candidates : candidates ? [candidates] : [];
  for (const candidate of list) {
    if (sameSubject(candidate.title, inboundSubject)) return candidate;
  }
  return null;
}

function shouldForkClosedTicket(candidate: TicketCandidate, windowDays: number): boolean {
  if (candidate.status !== 'closed' || !candidate.closedAt) return false;
  const ageMs = Date.now() - candidate.closedAt.getTime();
  return ageMs > windowDays * 24 * 60 * 60 * 1000;
}

function plainHeaders(parsed: ParsedMail): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const [key, value] of parsed.headers.entries()) {
    out[key.toLowerCase()] = plainHeaderValue(value);
  }
  for (const line of parsed.headerLines) {
    if (!out[line.key.toLowerCase()]) {
      const idx = line.line.indexOf(':');
      if (idx > 0) out[line.key.toLowerCase()] = line.line.slice(idx + 1).trim();
    }
  }
  return out;
}

function plainHeaderValue(value: unknown): string | string[] {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map((item) => String(item));
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value && typeof value === 'object' && 'text' in value) {
    return String((value as { text?: string }).text ?? '');
  }
  return String(value ?? '');
}

function firstAddress(input: AddressObject | undefined): NormalizedAddress | null {
  return addressList(input)[0] ?? null;
}

function addressList(input: AddressObject | AddressObject[] | undefined): NormalizedAddress[] {
  const objects = Array.isArray(input) ? input : input ? [input] : [];
  const out: NormalizedAddress[] = [];
  for (const object of objects) {
    for (const value of object.value) collectEmailAddress(value, out);
  }
  return out;
}

function collectEmailAddress(address: EmailAddress, out: NormalizedAddress[]): void {
  if (address.address) {
    out.push({ address: address.address.toLowerCase(), name: address.name || undefined });
  }
  for (const grouped of address.group ?? []) collectEmailAddress(grouped, out);
}

function allRecipientAddresses(email: NormalizedEmail): string[] {
  return [...email.to, ...email.cc].map((addr) => addr.address);
}

function parseAuthResults(headers: Record<string, string | string[]>): AuthResults {
  const raw = arrayHeader(headers['authentication-results']);
  const parsed = parseAuthenticationResults(raw);
  return {
    spf: preferredAuthResult(parsed.spf),
    dkim: preferredAuthResult(parsed.dkim),
    dmarc: preferredAuthResult(parsed.dmarc),
    raw,
  };
}

function preferredAuthResult(checks: Array<{ result: string }> | undefined): string | undefined {
  if (!checks?.length) return undefined;
  return checks.find((check) => check.result === 'pass')?.result ?? checks[0]?.result;
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function arrayHeader(value: string | string[] | undefined): string[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function hasHeader(headers: Record<string, string | string[]>, key: string): boolean {
  const value = headers[key.toLowerCase()];
  if (Array.isArray(value)) return value.length > 0;
  return Boolean(value);
}

function messageIDList(value: unknown): string[] {
  if (!value) return [];
  if (Array.isArray(value)) return value.flatMap(messageIDList);
  if (typeof value !== 'string') return [];
  return value.match(/<[^<>]+>/g) ?? value.split(/\s+/).filter(Boolean);
}

function normalizeMessageIDs(ids: Array<string | null | undefined>): string[] {
  return Array.from(
    new Set(
      ids
        .flatMap((id) => messageIDList(id))
        .map(normalizeMessageID)
        .filter((id): id is string => Boolean(id)),
    ),
  );
}

function normalizeMessageID(id: string | null | undefined): string | null {
  if (!id) return null;
  const trimmed = id.trim();
  if (!trimmed) return null;
  const angle = trimmed.match(/<[^<>]+>/)?.[0];
  return angle ?? `<${trimmed.replace(/^<|>$/g, '')}>`;
}

function idsInText(text: string): string[] {
  return text.match(/<[A-Z0-9._%+-]+@[A-Z0-9.-]+>/gi) ?? [];
}

function emailAddressesInText(text: string): string[] {
  return text.match(/[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9.-]+(?:\.[A-Z0-9-]+)+/gi) ?? [];
}

function sameSubject(a: string, b: string): boolean {
  const ca = canonicalSubject(a);
  const cb = canonicalSubject(b);
  if (!ca || !cb) return true;
  return ca === cb;
}

function canonicalSubject(subject: string): string {
  return normalizeSubjectForThreading(subject);
}

function extractCSSMarkerTicketIDs(html: string): string[] {
  if (!html) return [];
  const ids = new Set<string>();
  const inputRe =
    /<input\b[^>]*\bname=["'](?:x_)*(?:conversation_id|ticket_id)["'][^>]*\bvalue=["']([^"']+)["'][^>]*>/gi;
  for (const match of html.matchAll(inputRe)) {
    if (match[1]) ids.add(match[1]);
  }
  return Array.from(ids);
}

// Magic body markers must carry a workspace-scoped HMAC suffix:
// `::tid:<ticketID>:<sig>::`. Unsigned `::tid:<id>::` markers are ignored
// — they're trivially forgeable in customer replies, and a forged marker
// would jump a reply into a different ticket. Markers without a sig
// (older callers, third-party-emitted) silently drop through to the
// other threading layers (header chain, reply token, recipient routing).
function extractMagicTicketIDs(body: string, workspaceID: string): string[] {
  const ids = new Set<string>();
  for (const match of body.matchAll(
    /::tid:([0-9a-f-]{32,36}|[A-Za-z0-9_-]+):([A-Za-z0-9_-]{12})::/g,
  )) {
    const ticketID = match[1];
    const sig = match[2];
    if (!ticketID || !sig) continue;
    if (verifyBodyMarker(workspaceID, ticketID, sig)) {
      ids.add(ticketID);
    }
  }
  return Array.from(ids);
}

function extractForwardedFrom(body: string): NormalizedAddress | null {
  const match = body.match(/(?:^|\n)from:\s*(.+?)(?:\r?\n|$)/i);
  if (!match?.[1]) return null;
  const address = normalizeAddress(match[1]);
  if (!address) return null;
  const name = match[1]
    .replace(/<[^<>]+>/, '')
    .replace(/["']/g, '')
    .trim();
  return { address, name: name || undefined };
}

function normalizeAddress(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = value.match(/<([^<>@\s]+@[^<>\s]+)>/);
  const address = (match?.[1] ?? value).trim().toLowerCase();
  return /^[^@\s]+@[^@\s]+$/.test(address) ? address : null;
}

function isBounceLikeAddress(address: string): boolean {
  const local = address.split('@')[0] ?? '';
  return /^(mailer-daemon|postmaster|bounces?|bounce|no-?reply|do-?not-?reply)([+_.-]|$)/i.test(
    local,
  );
}

function textToHtml(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${escapeHTML(paragraph).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();
}

function escapeHTML(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function parseS3Ref(ref: string): { bucket: string; key: string } {
  if (ref.startsWith('s3://')) {
    const withoutScheme = ref.slice('s3://'.length);
    const slash = withoutScheme.indexOf('/');
    if (slash < 1) throw new Error(`invalid s3 raw blob key: ${ref}`);
    return { bucket: withoutScheme.slice(0, slash), key: withoutScheme.slice(slash + 1) };
  }
  return { bucket: process.env.S3_BUCKET ?? 'salve-dev', key: ref };
}

function nestedString(value: unknown, path: string[]): string | null {
  let current = value;
  for (const key of path) {
    if (!current || typeof current !== 'object') return null;
    current = (current as Record<string, unknown>)[key];
  }
  return typeof current === 'string' ? current : null;
}

function ruleEnabled(rule: Record<string, unknown>): boolean {
  const enabled = rule.enabled ?? rule.is_active;
  return typeof enabled === 'boolean' ? enabled : true;
}

// Routing rule patterns are user-authored regex strings that run against
// inbound headers/subjects. JavaScript regex has no execution timeout and a
// pattern like `(a+)+b` against a long no-match string hangs the worker.
// Defense in depth:
//  1. Cap candidate value length so any match terminates in bounded time.
//  2. Cap pattern length and reject patterns that look pathological
//     (nested unbounded quantifiers — the canonical ReDoS shape).
//  3. Patterns that fail validation fall back to a literal-glob match,
//     same as compile errors.
const MAX_PATTERN_VALUE_LENGTH = 4096;
const MAX_PATTERN_LENGTH = 256;
const PATHOLOGICAL_PATTERN = /(\([^)]*[+*][^)]*\)|\[[^\]]*[+*][^\]]*\])[+*]/;

function matchesPattern(pattern: string | null, value: string): boolean {
  if (!pattern) return true;
  const trimmedValue =
    value.length > MAX_PATTERN_VALUE_LENGTH ? value.slice(0, MAX_PATTERN_VALUE_LENGTH) : value;
  if (pattern.length <= MAX_PATTERN_LENGTH && !PATHOLOGICAL_PATTERN.test(pattern)) {
    try {
      return new RegExp(pattern, 'i').test(trimmedValue);
    } catch {
      // fall through to glob fallback
    }
  }
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  try {
    return new RegExp(`^${escaped}$`, 'i').test(trimmedValue);
  } catch {
    return false;
  }
}

function objectProp(value: unknown, key: string): Record<string, unknown> | null {
  const child = value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : null;
  return child && typeof child === 'object' ? (child as Record<string, unknown>) : null;
}

function stringProp(value: unknown, key: string): string | null {
  const child = value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : null;
  return typeof child === 'string' && child.trim() ? child : null;
}

function asTicketPriority(value: string | null): TicketPriority | null {
  return value === 'low' || value === 'normal' || value === 'high' || value === 'urgent'
    ? value
    : null;
}

let inboundRawColumnCache: Set<string> | null = null;
async function inboundRawColumns(sql: Sql): Promise<Set<string>> {
  if (inboundRawColumnCache) return inboundRawColumnCache;
  const rows = await sql<Array<{ column_name: string }>>`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'inbound_message_raw'
  `;
  inboundRawColumnCache = new Set(rows.map((row) => row.column_name));
  return inboundRawColumnCache;
}

function pushSet(
  cols: Set<string>,
  sets: string[],
  params: postgres.JSONValue[],
  column: string,
  value: string | null | undefined,
): void {
  if (!cols.has(column) || value === undefined) return;
  params.push(value);
  sets.push(`${column} = $${params.length}`);
}

function acquireInFlight(key: string): boolean {
  const now = Date.now();
  for (const [candidate, expiry] of inFlightInbound) {
    if (expiry <= now) inFlightInbound.delete(candidate);
  }
  if (inFlightInbound.has(key)) return false;
  inFlightInbound.set(key, now + IN_FLIGHT_TTL_MS);
  return true;
}

function releaseInFlight(key: string): void {
  inFlightInbound.delete(key);
}

function isUndefinedTableOrColumn(err: unknown): boolean {
  const code = (err as { code?: string } | undefined)?.code;
  return code === '42P01' || code === '42703';
}
