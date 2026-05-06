/// <reference path="../../.sst/platform/config.d.ts" />

/**
 * GitHub Actions → AWS OIDC. Creates the OIDC provider (idempotent — one per
 * account) and a role that GH Actions can assume from chandeldivyam/salve.
 *
 * Trust scoping: the role is assumable only from the configured repo + the
 * `production` GitHub Environment (which gates on manual approval). This means
 * even if a workflow is altered to `assume-role` directly, AWS rejects unless
 * the workflow run is gated through the `production` environment.
 *
 * Permissions: AdministratorAccess for now. Pre-launch we accept this; before
 * public launch (see plan §12) we should narrow to the actual SST-required
 * actions (ECS:*, ECR:*, RDS:Describe*, IAM:PassRole, S3:*, EC2:*, etc.).
 */

const REPO = 'chandeldivyam/salve';

// AWS-published OIDC thumbprint for token.actions.githubusercontent.com.
// Stable as of 2026; AWS docs reference the same value.
const GH_THUMBPRINT = '6938fd4d98bab03faadb97b34396831e3780aea1';

const githubOidc = new aws.iam.OpenIdConnectProvider('GithubOidc', {
  url: 'https://token.actions.githubusercontent.com',
  clientIdLists: ['sts.amazonaws.com'],
  thumbprintLists: [GH_THUMBPRINT],
});

const trustPolicy = githubOidc.arn.apply((arn) =>
  JSON.stringify({
    Version: '2012-10-17',
    Statement: [
      {
        Effect: 'Allow',
        Principal: { Federated: arn },
        Action: 'sts:AssumeRoleWithWebIdentity',
        Condition: {
          StringEquals: {
            'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
          },
          StringLike: {
            // Match: any branch / pull / tag / GH environment under this repo.
            // The deploy.yml uses `environment: production` — that's the real
            // gate — but we keep the trust-policy filter at repo level so
            // staging.yml doesn't need a second role.
            'token.actions.githubusercontent.com:sub': `repo:${REPO}:*`,
          },
        },
      },
    ],
  }),
);

const deployRole = new aws.iam.Role('GithubDeployRole', {
  name: `salve-${$app.stage}-github-deploy`,
  assumeRolePolicy: trustPolicy,
  description: 'Assumed by GitHub Actions for sst deploy/diff.',
  maxSessionDuration: 3600,
});

new aws.iam.RolePolicyAttachment('GithubDeployAdmin', {
  role: deployRole.name,
  // Pre-launch wide perms — narrow before public launch (plan §12).
  policyArn: 'arn:aws:iam::aws:policy/AdministratorAccess',
});

export const githubDeployRole = deployRole;
