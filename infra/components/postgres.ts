/// <reference path="../../.sst/platform/config.d.ts" />

import { network } from './network';

/**
 * Aurora Postgres 16 cluster, single writer on db.t4g.medium (burstable, ~$50/mo).
 *
 * Logical replication is enabled at the cluster parameter group level — required
 * by Rocicorp Zero. Switch to `db.m7g.large` (non-burstable, ~$130/mo) if Zero's
 * replication decoder consistently exhausts CPU credits in production. See
 * docs/cicd-plan.md §3.4 for the upgrade trigger.
 *
 * Pre-launch posture: skipFinalSnapshot=true, deletionProtection=false, retention
 * defaulted to 7 days. Flip all three before public launch (see §12).
 *
 * Private-subnet only — connect via `sst tunnel` (uses the VPC bastion) or from
 * Fargate services on the same VPC.
 */

// AWS RDS naming rules: parameter groups and subnet groups must be lowercase
// alphanumerics + hyphens. Pulumi's auto-derived names are CamelCase, so we
// pass `name` explicitly. Including `$app.stage` keeps prod and staging
// from conflicting if both exist simultaneously.
const parameterGroup = new aws.rds.ClusterParameterGroup('PostgresParams', {
  name: `salve-${$app.stage}-aurora-pg16`,
  family: 'aurora-postgresql16',
  description: 'salve aurora-postgresql16 logical replication for Rocicorp Zero',
  parameters: [
    { name: 'rds.logical_replication', value: '1', applyMethod: 'pending-reboot' },
    { name: 'max_replication_slots', value: '10', applyMethod: 'pending-reboot' },
    { name: 'max_wal_senders', value: '10', applyMethod: 'pending-reboot' },
  ],
});

const subnetGroup = new aws.rds.SubnetGroup('PostgresSubnets', {
  name: `salve-${$app.stage}-aurora-subnets`,
  subnetIds: network.privateSubnets,
  description: 'salve aurora private subnets',
});

const securityGroup = new aws.ec2.SecurityGroup('PostgresSg', {
  vpcId: network.id,
  description: 'salve aurora-postgresql access (5432)',
  ingress: [
    {
      protocol: 'tcp',
      fromPort: 5432,
      toPort: 5432,
      // VPC-internal only. Bastion + future Fargate services share this VPC,
      // so the VPC CIDR is what we want here.
      cidrBlocks: [network.nodes.vpc.cidrBlock],
    },
  ],
  egress: [
    {
      protocol: '-1',
      fromPort: 0,
      toPort: 0,
      cidrBlocks: ['0.0.0.0/0'],
    },
  ],
});

const cluster = new aws.rds.Cluster('Postgres', {
  engine: 'aurora-postgresql',
  // Aurora Postgres 16.6 — latest in the 16.x line as of 2026-05.
  engineVersion: '16.6',
  databaseName: 'salve',
  masterUsername: 'salve',
  // Auto-generates master password, stores in Secrets Manager, rotates on demand.
  // Read via `cluster.masterUserSecrets[0].secretArn`.
  manageMasterUserPassword: true,
  dbSubnetGroupName: subnetGroup.name,
  dbClusterParameterGroupName: parameterGroup.name,
  vpcSecurityGroupIds: [securityGroup.id],
  storageEncrypted: true,
  backupRetentionPeriod: 7,
  preferredBackupWindow: '03:00-04:00',
  // Pre-launch knobs. Flip these before public launch (see plan §12):
  skipFinalSnapshot: true,
  deletionProtection: false,
  applyImmediately: true,
});

const writer = new aws.rds.ClusterInstance('PostgresWriter', {
  clusterIdentifier: cluster.id,
  instanceClass: 'db.t4g.medium',
  engine: cluster.engine,
  engineVersion: cluster.engineVersion,
  dbSubnetGroupName: subnetGroup.name,
  publiclyAccessible: false,
  applyImmediately: true,
});

// Resolve master password at deploy time via Pulumi's getSecretVersionOutput,
// then assemble a DATABASE_URL connection string. See docs/cicd-plan.md §10:
// the password ends up in the ECS task definition (visible to anyone with
// ECS read perms) — acceptable pre-launch, switch to ECS `secrets` field
// referencing the secret ARN before public launch.
const masterSecretArn = cluster.masterUserSecrets.apply((s) => s[0].secretArn);
const masterSecret = aws.secretsmanager.getSecretVersionOutput({
  secretId: masterSecretArn,
});
// Aurora auto-managed passwords are base64 (contain `/`, `+`, `=`) — URL-encode
// before embedding in a postgres:// connection string. postgres-js parses
// percent-encoded passwords correctly.
const masterPassword = masterSecret.secretString.apply((raw) =>
  encodeURIComponent((JSON.parse(raw) as { password: string }).password),
);

const databaseUrl = $interpolate`postgres://${cluster.masterUsername}:${masterPassword}@${cluster.endpoint}:${cluster.port}/${cluster.databaseName}?sslmode=require`;

export const postgres = {
  clusterEndpoint: cluster.endpoint,
  port: cluster.port,
  databaseName: cluster.databaseName,
  masterUsername: cluster.masterUsername,
  masterSecretArn,
  databaseUrl,
  securityGroupId: securityGroup.id,
  writerInstanceId: writer.id,
  parameterGroupName: parameterGroup.name,
};
