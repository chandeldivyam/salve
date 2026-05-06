/// <reference path="../../.sst/platform/config.d.ts" />

/**
 * SES outbound runway.
 *
 * What's in IaC:
 * - System domain identity for `usesalve.com` (apex) + Easy DKIM + custom
 *   MAIL FROM (`mail.usesalve.com`).
 * - Route 53 records: 3 DKIM CNAMEs, MAIL FROM MX + SPF TXT, DMARC TXT.
 * - One shared SES configuration set with SNS event destination.
 * - SNS topic for bounce/complaint/delivery; subscribed to our /api/webhooks/ses
 *   endpoint via HTTPS subscription (auto-confirm by app code).
 *
 * What's NOT in IaC (created at runtime by `provision-domain` Inngest fn
 * when a tenant adds their domain in the UI):
 * - Per-tenant `EmailIdentity` (e.g., trydocufy.com)
 * - Per-tenant MAIL FROM attributes
 * - Tenant DKIM CNAMEs (returned to UI for the tenant to add at their DNS)
 *
 * Sandbox vs production: while in sandbox, you can only send to verified
 * recipients (200/day cap). Production access request submitted separately.
 */

const APEX = 'usesalve.com';
const MAIL_FROM = 'mail.usesalve.com';
const DMARC_HOST = '_dmarc.usesalve.com';
const REGION = 'us-east-1';

// 1. Domain identity with Easy DKIM. SES generates 3 CNAME tokens that we
//    add to Route 53 below. Once those propagate, SES auto-marks the
//    identity as Verified + DKIM-signed.
const systemIdentity = new aws.sesv2.EmailIdentity('SesSystemIdentity', {
  emailIdentity: APEX,
});

// 2. Custom MAIL FROM. Without this, SES uses `*.amazonses.com` as the
//    bounce envelope, breaking SPF alignment. With this set, customers
//    see `mail.usesalve.com` and SPF aligns.
const mailFromAttrs = new aws.sesv2.EmailIdentityMailFromAttributes('SesSystemMailFrom', {
  emailIdentity: systemIdentity.emailIdentity,
  mailFromDomain: MAIL_FROM,
  behaviorOnMxFailure: 'USE_DEFAULT_VALUE',
});

// 3. Route 53 zone lookup (one call, used by all records below).
const zone = aws.route53.getZoneOutput({ name: APEX });

// 4. DKIM CNAMEs (×3). The tokens come from the EmailIdentity's
//    dkimSigningAttributes output.
const dkimTokens = systemIdentity.dkimSigningAttributes.apply((d) => d?.tokens ?? []);

const dkimRecords = [0, 1, 2].map(
  (i) =>
    new aws.route53.Record(`SesDkim${i}`, {
      zoneId: zone.zoneId,
      name: dkimTokens.apply((t) => `${t[i]}._domainkey.${APEX}`),
      type: 'CNAME',
      ttl: 1800,
      records: [dkimTokens.apply((t) => `${t[i]}.dkim.amazonses.com`)],
    }),
);

// 5. MAIL FROM records: one MX + one SPF TXT.
const mailFromMx = new aws.route53.Record('SesMailFromMx', {
  zoneId: zone.zoneId,
  name: MAIL_FROM,
  type: 'MX',
  ttl: 1800,
  records: [`10 feedback-smtp.${REGION}.amazonses.com`],
});

const mailFromSpf = new aws.route53.Record('SesMailFromSpf', {
  zoneId: zone.zoneId,
  name: MAIL_FROM,
  type: 'TXT',
  ttl: 1800,
  records: ['v=spf1 include:amazonses.com -all'],
});

// 6. Apex SPF — declares Amazon SES as authorized sender for usesalve.com.
//    This is for emails sent with envelope-from `@usesalve.com` (e.g. when
//    MAIL FROM hasn't fully propagated). Strict `-all` because only SES
//    sends for our domain.
const apexSpf = new aws.route53.Record('SesApexSpf', {
  zoneId: zone.zoneId,
  name: APEX,
  type: 'TXT',
  ttl: 1800,
  // Multiple TXT records on the apex don't combine; keep this scoped to
  // SPF and let other TXT records (DMARC, etc.) live at their own subdomains.
  records: ['v=spf1 include:amazonses.com -all'],
});

// 7. DMARC monitoring (p=none). Reports go to dmarc@usesalve.com which lands
//    in our SES inbound (PR 10) and gets routed via Inngest. For now the
//    address bounces — that's fine, it just means we drop reports until PR 10
//    lands. Switch to p=quarantine then p=reject after monitoring for 4-8 weeks.
const dmarc = new aws.route53.Record('SesDmarc', {
  zoneId: zone.zoneId,
  name: DMARC_HOST,
  type: 'TXT',
  ttl: 1800,
  records: ['v=DMARC1; p=none; rua=mailto:dmarc@usesalve.com; fo=1; aspf=r; adkim=r'],
});

// 8. SNS topic for SES events (bounce, complaint, delivery, etc).
const sesEventsTopic = new aws.sns.Topic('SesEventsTopic', {
  name: `salve-${$app.stage}-ses-events`,
});

// 9. Configuration set + event destination. The deliver-message Inngest fn
//    references this configuration set on every SendEmail call so events
//    flow back to us.
const configSet = new aws.sesv2.ConfigurationSet('SesConfigSet', {
  configurationSetName: `salve-${$app.stage}-default`,
  reputationOptions: { reputationMetricsEnabled: true },
  sendingOptions: { sendingEnabled: true },
});

new aws.sesv2.ConfigurationSetEventDestination('SesConfigSetEventDest', {
  configurationSetName: configSet.configurationSetName,
  eventDestinationName: 'sns',
  eventDestination: {
    enabled: true,
    matchingEventTypes: [
      'SEND',
      'REJECT',
      'BOUNCE',
      'COMPLAINT',
      'DELIVERY',
      'OPEN',
      'CLICK',
      'RENDERING_FAILURE',
      'DELIVERY_DELAY',
    ],
    snsDestination: {
      topicArn: sesEventsTopic.arn,
    },
  },
});

// 10. SNS → HTTPS subscription. SES events POST to our /api/webhooks/ses
//     endpoint. The Hono handler at apps/api/src/webhooks/ses.ts handles
//     the SubscriptionConfirmation auto-confirm (gated by SES_SNS_AUTO_CONFIRM)
//     and verifies signatures via SES_WEBHOOK_SECRET.
new aws.sns.TopicSubscription('SesEventsHttp', {
  topic: sesEventsTopic.arn,
  protocol: 'https',
  endpoint: 'https://api.usesalve.com/api/webhooks/ses',
  rawMessageDelivery: false,
});

export const ses = {
  systemIdentityArn: systemIdentity.arn,
  systemIdentityName: systemIdentity.emailIdentity,
  configSetName: configSet.configurationSetName,
  eventsTopicArn: sesEventsTopic.arn,
  // Used by the API task role grants in api.ts.
  configSetArn: configSet.arn,
};

// Force ordering: DKIM records must exist before SES marks the identity
// verified. Pulumi handles this naturally via output dependencies.
void [dkimRecords, mailFromMx, mailFromSpf, apexSpf, dmarc, mailFromAttrs];
