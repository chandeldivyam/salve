/// <reference path="../../.sst/platform/config.d.ts" />

/**
 * VPC: 2 AZs (Aurora requires it), public + private subnets, EC2 NAT (~$3/mo per
 * AZ vs $35/mo for managed NAT). Bastion enabled so we can `sst tunnel` to
 * Aurora over SSM without exposing it publicly.
 *
 * Pre-launch only: switch `nat: "ec2"` → `"managed"` before public launch (see
 * the launch checklist in docs/cicd-plan.md §12). The EC2 NAT is fine for
 * iteration but becomes a single point of failure under real traffic.
 */
export const network = new sst.aws.Vpc('Network', {
  az: 2,
  nat: 'ec2',
  bastion: true,
});
