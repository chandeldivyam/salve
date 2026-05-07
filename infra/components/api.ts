/// <reference path="../../.sst/platform/config.d.ts" />

import { attachmentsBucket, rawEmailBucket } from './buckets';
import { cluster } from './cluster';
import { postgres } from './postgres';
import {
  authSecret,
  googleClientId,
  googleClientSecret,
  inngestApiKey,
  inngestEventKey,
  inngestSigningKey,
  mailgunApiKey,
  mailgunWebhookSigningKey,
  sesWebhookSecret,
} from './secrets';
import { ses } from './ses';

/**
 * Hono API on Fargate behind a public ALB at api.usesalve.com.
 *
 * Built from apps/api/Dockerfile (multi-stage, tsdown bundle). SST builds
 * the image locally, pushes to ECR, and rolls the Service.
 *
 * Pre-launch sizing: 0.5 vCPU / 1 GB, single task, spot capacity. Bump
 * scaling.min and switch capacity → fargate before launch.
 */
export const api = new sst.aws.Service('Api', {
  cluster,
  image: {
    context: '.',
    dockerfile: 'apps/api/Dockerfile',
    // PR 7 added a `migrate` stage at the bottom of the Dockerfile. Without
    // an explicit target, docker-build defaults to the LAST stage, so the
    // API was accidentally running the migrate script as its CMD.
    target: 'final',
  },
  cpu: '0.5 vCPU',
  memory: '1 GB',
  scaling: {
    min: 1,
    max: 4,
    cpuUtilization: 70,
  },
  capacity: 'spot',
  loadBalancer: {
    rules: [{ listen: '443/https', forward: '3001/http' }],
    domain: 'api.usesalve.com',
    health: {
      '3001/http': {
        path: '/healthz',
        interval: '30 seconds',
        timeout: '5 seconds',
        successCodes: '200',
        healthyThreshold: 2,
        unhealthyThreshold: 5,
      },
    },
  },
  link: [
    authSecret,
    googleClientId,
    googleClientSecret,
    inngestApiKey,
    inngestEventKey,
    inngestSigningKey,
    mailgunApiKey,
    mailgunWebhookSigningKey,
    sesWebhookSecret,
    // Bucket linking auto-grants the task role s3:GetObject/PutObject on
    // these buckets (and exposes the bucket name via Resource.<name>.name).
    // - rawEmailBucket: route-inbound-message Inngest fn reads raw RFC822
    //   blobs from inbound/in/* and inbound/reply/* to parse.
    // - attachmentsBucket: presigned upload + download for ticket
    //   attachments via /api/files/* handlers.
    rawEmailBucket,
    attachmentsBucket,
  ],
  // SES permissions for the task role:
  //   - Identity management: provision-domain Inngest fn creates per-tenant
  //     EmailIdentity + MAIL FROM attrs at runtime when a customer adds a
  //     domain. Scoped resource * because identities are per-tenant.
  //   - Send: deliver-message Inngest fn sends via SES (raw + simple).
  //   - Suppression: lookups for the suppression list.
  // Pre-launch: wide. Narrow by ARN per workspace before launch (plan §12).
  permissions: [
    {
      actions: [
        'ses:CreateEmailIdentity',
        'ses:GetEmailIdentity',
        'ses:DeleteEmailIdentity',
        'ses:ListEmailIdentities',
        'ses:PutEmailIdentityMailFromAttributes',
        'ses:PutEmailIdentityDkimAttributes',
        'ses:PutEmailIdentityDkimSigningAttributes',
        'ses:PutEmailIdentityFeedbackAttributes',
        'ses:PutEmailIdentityConfigurationSetAttributes',
        'ses:SendEmail',
        'ses:SendRawEmail',
        'ses:SendBulkEmail',
        'ses:GetConfigurationSet',
        'ses:GetSuppressedDestination',
        'ses:PutSuppressedDestination',
        'ses:DeleteSuppressedDestination',
        'ses:GetAccount',
      ],
      resources: ['*'],
    },
  ],
  environment: {
    NODE_ENV: 'production',
    PORT: '3001',
    SERVICE_NAME: 'salve-api',
    AWS_REGION: 'us-east-1',
    // Postgres — DATABASE_URL is constructed from the cluster's auto-managed
    // master secret (see infra/components/postgres.ts). Pre-launch only:
    // ends up in plain text in the ECS task definition. Switch to ECS
    // `secrets` field before launch.
    DATABASE_URL: postgres.databaseUrl,
    // better-auth
    BETTER_AUTH_URL: 'https://api.usesalve.com',
    BETTER_AUTH_TRUSTED_ORIGINS: 'https://app.usesalve.com',
    // Shared eTLD+1 so the salve JWT cookie reaches sync.usesalve.com
    // (zero-cache) on the WS handshake. Without this, zero-cache forwards
    // no JWT to /api/zero/mutate and server-mutators throw "User must be
    // logged in" — which is exactly what we just hit.
    COOKIE_DOMAIN: 'usesalve.com',
    // Mirror AUTH_SECRET → ZERO_AUTH_SECRET via the linked secret.
    // (server.ts reads process.env.AUTH_SECRET; zero-cache reads
    // process.env.ZERO_AUTH_SECRET — same value.)
    AUTH_SECRET: authSecret.value,
    ZERO_AUTH_SECRET: authSecret.value,
    // Inngest serve handler binds these. Cloud reaches us at INNGEST_SERVE_ORIGIN.
    INNGEST_EVENT_KEY: inngestEventKey.value,
    INNGEST_SIGNING_KEY: inngestSigningKey.value,
    INNGEST_SERVE_ORIGIN: 'https://api.usesalve.com',
    // Email — keep SES live until the Mailgun branch is smoke-tested in prod.
    // Flip this to 'mailgun' (re-deploy) once the smoke scripts pass.
    MAILER_BACKEND: 'ses',
    REPLY_DOMAIN: 'reply.usesalve.com',
    INBOUND_EMAIL_DOMAIN: 'in.usesalve.com',
    MAIL_FROM_SUBDOMAIN: 'mail',
    SES_WEBHOOK_SECRET: sesWebhookSecret.value,
    SES_SNS_AUTO_CONFIRM: '1',
    SES_CONFIGURATION_SET: ses.configSetName,
    SES_SYSTEM_IDENTITY: ses.systemIdentityName,
    // Mailgun. The API server reads these whenever MAILER_BACKEND=mailgun
    // OR when an outbound caller passes an explicit mailgunDomain (the
    // smoke-send script). Empty defaults are safe — the linked secrets
    // arrive only if pnpm sst secret set ... was run for the stage.
    MAILGUN_API_KEY: mailgunApiKey.value,
    MAILGUN_WEBHOOK_SIGNING_KEY: mailgunWebhookSigningKey.value,
    MAILGUN_API_BASE: 'https://api.mailgun.net',
    MAILGUN_SYSTEM_DOMAIN: 'mg.usesalve.com',
    // S3 bucket for ticket attachments. files.ts presign/get handlers read
    // S3_BUCKET; in prod we leave S3_ENDPOINT/S3_FORCE_PATH_STYLE/S3_*_KEY
    // unset so the SDK targets real AWS S3 with task-role creds.
    S3_BUCKET: attachmentsBucket.name,
    S3_REGION: 'us-east-1',
    // Mailgun inbound writes the raw RFC 5322 to S3 ourselves (SES inbound
    // writes via the receipt rule's s3Action; Mailgun forwards the body in
    // the webhook so the API does the PutObject). Same bucket as SES uses
    // for inbound, different prefix (inbound/mailgun/...).
    RAW_EMAIL_BUCKET: rawEmailBucket.name,
    // OAuth
    GOOGLE_CLIENT_ID: googleClientId.value,
    GOOGLE_CLIENT_SECRET: googleClientSecret.value,
  },
  // Fargate tasks need network reachability to Aurora's security group.
  // Aurora's SG allows the VPC CIDR, and the Service runs in the same VPC's
  // private subnets, so this works without explicit SG ingress edits.
});
