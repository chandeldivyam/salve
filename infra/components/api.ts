/// <reference path="../../.sst/platform/config.d.ts" />

import { cluster } from './cluster';
import { postgres } from './postgres';
import {
  authSecret,
  googleClientId,
  googleClientSecret,
  inngestApiKey,
  inngestEventKey,
  inngestSigningKey,
  sesWebhookSecret,
} from './secrets';

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
    sesWebhookSecret,
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
    // Mirror AUTH_SECRET → ZERO_AUTH_SECRET via the linked secret.
    // (server.ts reads process.env.AUTH_SECRET; zero-cache reads
    // process.env.ZERO_AUTH_SECRET — same value.)
    AUTH_SECRET: authSecret.value,
    ZERO_AUTH_SECRET: authSecret.value,
    // Inngest serve handler binds these. Cloud reaches us at INNGEST_SERVE_ORIGIN.
    INNGEST_EVENT_KEY: inngestEventKey.value,
    INNGEST_SIGNING_KEY: inngestSigningKey.value,
    INNGEST_SERVE_ORIGIN: 'https://api.usesalve.com',
    // Email
    MAILER_BACKEND: 'ses',
    REPLY_DOMAIN: 'reply.usesalve.com',
    INBOUND_EMAIL_DOMAIN: 'in.usesalve.com',
    MAIL_FROM_SUBDOMAIN: 'mail',
    SES_WEBHOOK_SECRET: sesWebhookSecret.value,
    SES_SNS_AUTO_CONFIRM: '1',
    // OAuth
    GOOGLE_CLIENT_ID: googleClientId.value,
    GOOGLE_CLIENT_SECRET: googleClientSecret.value,
  },
  // Fargate tasks need network reachability to Aurora's security group.
  // Aurora's SG allows the VPC CIDR, and the Service runs in the same VPC's
  // private subnets, so this works without explicit SG ingress edits.
});
