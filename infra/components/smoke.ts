/// <reference path="../../.sst/platform/config.d.ts" />

/**
 * Smoke component. PR 1 only — proves the SST → AWS deploy path works
 * end-to-end without spending real money on long-lived infra.
 *
 * Delete this file once PR 4 (the API service) lands; we only kept it through
 * PR 1 verification. Replace with real components from infra/components/*.ts.
 */
export const smoke = new sst.aws.Bucket('Smoke');
