/// <reference path="../../.sst/platform/config.d.ts" />

import { network } from './network';

/**
 * Shared ECS cluster for all long-running Node services (api, zero-cache).
 * Both run as separate `sst.aws.Service` instances on this cluster, with
 * their own ALBs and target groups. Co-locating saves the ~$15/mo cluster
 * fee × 2.
 */
export const cluster = new sst.aws.Cluster('Cluster', {
  vpc: network,
});
