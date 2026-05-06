/// <reference path="./.sst/platform/config.d.ts" />

/**
 * Salve infrastructure entrypoint.
 *
 * Stages:
 *   - prod    — long-lived, single source of truth. Deploys via .github/workflows/deploy.yml.
 *   - staging — on-demand for risky changes. Spin up with `sst deploy --stage staging`,
 *               tear down with `sst remove --stage staging`. No standing dev stage.
 *
 * Component definitions live under infra/components/ and are imported into run() below.
 * See docs/cicd-plan.md for the full topology.
 */
export default $config({
  app(_input) {
    return {
      name: 'salve',
      // PRE-LAUNCH MODE — both flags are deliberately off so we can iterate fast
      // (spin Aurora up/down, refactor IaC, blast resources) without fighting
      // SST's safety rails. Flip both before public launch:
      //
      //   removal: input?.stage === 'prod' ? 'retain' : 'remove',
      //   protect: input?.stage === 'prod',
      //
      // See "Launch checklist" in docs/cicd-plan.md §13.
      removal: 'remove',
      protect: false,
      home: 'aws',
      providers: {
        aws: {
          region: 'us-east-1',
        },
      },
    };
  },
  async run() {
    await import('./infra/components/network');
    const { postgres } = await import('./infra/components/postgres');
    await import('./infra/components/cluster');
    await import('./infra/components/secrets');
    await import('./infra/components/buckets');
    const { api } = await import('./infra/components/api');
    const { zeroCache } = await import('./infra/components/zero-cache');
    const { web } = await import('./infra/components/web');
    const { migrate } = await import('./infra/components/migrate');
    const { githubDeployRole } = await import('./infra/components/github-oidc');
    return {
      postgresEndpoint: postgres.clusterEndpoint,
      postgresSecretArn: postgres.masterSecretArn,
      apiUrl: api.url,
      zeroCacheUrl: zeroCache.url,
      webUrl: web.url,
      migrateTaskArn: migrate.taskDefinition,
      githubDeployRoleArn: githubDeployRole.arn,
    };
  },
});
