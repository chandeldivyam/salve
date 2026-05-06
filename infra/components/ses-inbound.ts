/// <reference path="../../.sst/platform/config.d.ts" />

import { rawEmailBucket } from './buckets';
import { sesWebhookSecret } from './secrets';

/**
 * SES inbound runway.
 *
 * Architecture:
 *   SES receipt rules on in.usesalve.com + reply.usesalve.com
 *     → S3 (rawEmailBucket) + SNS topic
 *     → SNS HTTPS subscription to /api/inbound/email/ses
 *     → Hono handler (apps/api/src/inbound/email.ts) creates the raw row,
 *       resolves the channel, dispatches `inbound/message.received` Inngest.
 *
 * Why no SQS/Lambda buffer (pre-launch): the API endpoint already handles
 * SubscriptionConfirmation auto-confirm and signature verification. Adding
 * SQS+DLQ+Lambda is a hardening step we accept post-launch (plan §12) —
 * gives us durable retry on API outages, but doubles the moving parts.
 *
 * Region note: SES inbound is region-restricted to us-east-1, us-west-2,
 * eu-west-1. We're in us-east-1.
 *
 * Active rule set caveat: AWS only allows ONE active rule set per account.
 * If you have other apps in this account with SES inbound, this will
 * deactivate theirs — be careful.
 */

const APEX = 'usesalve.com';
const INBOUND_DOMAIN = `in.${APEX}`;
const REPLY_DOMAIN = `reply.${APEX}`;
const REGION = 'us-east-1';

const zone = aws.route53.getZoneOutput({ name: APEX });

// 1. MX records → SES inbound endpoint.
new aws.route53.Record('SesInboundMx', {
  zoneId: zone.zoneId,
  name: INBOUND_DOMAIN,
  type: 'MX',
  ttl: 1800,
  records: [`10 inbound-smtp.${REGION}.amazonaws.com`],
});

new aws.route53.Record('SesReplyMx', {
  zoneId: zone.zoneId,
  name: REPLY_DOMAIN,
  type: 'MX',
  ttl: 1800,
  records: [`10 inbound-smtp.${REGION}.amazonaws.com`],
});

// 2. SES needs to verify ownership of the inbound MAIL FROM domains.
//    Easy DKIM on these domains too — even though they're inbound-only,
//    SES requires a verified identity to receive mail.
const inboundIdentity = new aws.sesv2.EmailIdentity('SesInboundIdentity', {
  emailIdentity: INBOUND_DOMAIN,
});
const replyIdentity = new aws.sesv2.EmailIdentity('SesReplyIdentity', {
  emailIdentity: REPLY_DOMAIN,
});

const inboundDkim = inboundIdentity.dkimSigningAttributes.apply((d) => d?.tokens ?? []);
const replyDkim = replyIdentity.dkimSigningAttributes.apply((d) => d?.tokens ?? []);

[0, 1, 2].forEach((i) => {
  new aws.route53.Record(`SesInboundDkim${i}`, {
    zoneId: zone.zoneId,
    name: inboundDkim.apply((t) => `${t[i]}._domainkey.${INBOUND_DOMAIN}`),
    type: 'CNAME',
    ttl: 1800,
    records: [inboundDkim.apply((t) => `${t[i]}.dkim.amazonses.com`)],
  });
  new aws.route53.Record(`SesReplyDkim${i}`, {
    zoneId: zone.zoneId,
    name: replyDkim.apply((t) => `${t[i]}._domainkey.${REPLY_DOMAIN}`),
    type: 'CNAME',
    ttl: 1800,
    records: [replyDkim.apply((t) => `${t[i]}.dkim.amazonses.com`)],
  });
});

// 3. SNS topic for inbound notifications. SES publishes the parsed mail
//    metadata + S3 location here.
const inboundTopic = new aws.sns.Topic('SesInboundTopic', {
  name: `salve-${$app.stage}-ses-inbound`,
});

// Allow SES to publish to this topic. Without this, SES gets AccessDenied
// and silently drops mail (you only see it in CloudWatch metric SES.RuleFailures).
const accountId = aws.getCallerIdentityOutput({}).accountId;
new aws.sns.TopicPolicy('SesInboundTopicPolicy', {
  arn: inboundTopic.arn,
  policy: $resolve([inboundTopic.arn, accountId]).apply(([topicArn, acct]) =>
    JSON.stringify({
      Version: '2012-10-17',
      Statement: [
        {
          Sid: 'AllowSESPublish',
          Effect: 'Allow',
          Principal: { Service: 'ses.amazonaws.com' },
          Action: 'sns:Publish',
          Resource: topicArn,
          Condition: { StringEquals: { 'AWS:SourceAccount': acct } },
        },
      ],
    }),
  ),
});

// 4. S3 bucket SES write permission lives in infra/components/buckets.ts
//    (the rawEmailBucket transform.policy adds an SES PutObject allow).

// 5. SES receipt rule set + 2 rules.
const ruleSet = new aws.ses.ReceiptRuleSet('SesInboundRuleSet', {
  ruleSetName: `salve-${$app.stage}-inbound`,
});

new aws.ses.ReceiptRule('SesInboundRule', {
  ruleSetName: ruleSet.ruleSetName,
  name: `salve-${$app.stage}-inbound-${INBOUND_DOMAIN}`,
  recipients: [INBOUND_DOMAIN],
  enabled: true,
  scanEnabled: true,
  tlsPolicy: 'Optional',
  s3Actions: [
    {
      position: 1,
      bucketName: rawEmailBucket.name,
      objectKeyPrefix: 'inbound/in/',
      topicArn: inboundTopic.arn,
    },
  ],
});

new aws.ses.ReceiptRule('SesReplyRule', {
  ruleSetName: ruleSet.ruleSetName,
  name: `salve-${$app.stage}-inbound-${REPLY_DOMAIN}`,
  recipients: [REPLY_DOMAIN],
  enabled: true,
  scanEnabled: true,
  tlsPolicy: 'Optional',
  s3Actions: [
    {
      position: 1,
      bucketName: rawEmailBucket.name,
      objectKeyPrefix: 'inbound/reply/',
      topicArn: inboundTopic.arn,
    },
  ],
});

// 6. Activate the rule set.
new aws.ses.ActiveReceiptRuleSet('SesActiveInboundRuleSet', {
  ruleSetName: ruleSet.ruleSetName,
});

// 7. Lambda forwarder: SNS HTTPS subscriptions can't add custom headers,
//    but the API's inbound handler authenticates via `x-salve-webhook-secret`.
//    This tiny Lambda receives the SNS event and re-POSTs to the API with
//    the secret in a header. ~50 lines; bundled with tsdown.
const inboundForwarder = new sst.aws.Function('SesInboundForwarder', {
  handler: 'apps/inngest-bridge/src/handler.handler',
  runtime: 'nodejs22.x',
  timeout: '30 seconds',
  memory: '256 MB',
  link: [sesWebhookSecret],
  environment: {
    INBOUND_ENDPOINT: 'https://api.usesalve.com/api/inbound/email/ses',
    SES_INBOUND_WEBHOOK_SECRET: sesWebhookSecret.value,
  },
});

new aws.sns.TopicSubscription('SesInboundLambdaSub', {
  topic: inboundTopic.arn,
  protocol: 'lambda',
  endpoint: inboundForwarder.arn,
});

new aws.lambda.Permission('SesInboundLambdaInvokePerm', {
  action: 'lambda:InvokeFunction',
  function: inboundForwarder.name,
  principal: 'sns.amazonaws.com',
  sourceArn: inboundTopic.arn,
});

export const sesInbound = {
  inboundTopicArn: inboundTopic.arn,
  ruleSetName: ruleSet.ruleSetName,
  inboundDomain: INBOUND_DOMAIN,
  replyDomain: REPLY_DOMAIN,
};
