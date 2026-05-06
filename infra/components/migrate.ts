/// <reference path="../../.sst/platform/config.d.ts" />

import { cluster } from './cluster';
import { postgres } from './postgres';

/**
 * One-off ECS task that applies Drizzle migrations to Aurora.
 *
 * Triggered after every deploy that ships migration files (gated by a path
 * check in the GH Actions workflow). Locally:
 *
 *   aws ecs run-task \
 *     --cluster <Cluster.id> \
 *     --task-definition $(sst output migrateTask) \
 *     --launch-type FARGATE \
 *     --network-configuration 'awsvpcConfiguration={subnets=[...],securityGroups=[...]}'
 *
 * Or via the helper at scripts/run-migrate.sh.
 */
export const migrate = new sst.aws.Task('Migrate', {
  cluster,
  image: {
    context: '.',
    dockerfile: 'apps/api/Dockerfile',
    target: 'migrate',
  },
  cpu: '0.25 vCPU',
  memory: '0.5 GB',
  capacity: 'spot',
  environment: {
    NODE_ENV: 'production',
    AWS_REGION: 'us-east-1',
    DATABASE_URL: postgres.databaseUrl,
    // Strip ANSI + disable spinner so CloudWatch captures errors cleanly.
    FORCE_COLOR: '0',
    NO_COLOR: '1',
    CI: '1',
  },
});
