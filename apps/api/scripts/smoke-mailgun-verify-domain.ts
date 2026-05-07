// Trigger an immediate domain/verification.requested Inngest event so
// verify-domain runs on demand instead of waiting for the */30 cron tick.
// Useful right after dropping fresh DNS records into Route 53 — saves up
// to a 30-minute wait during a manual cutover.
//
// Run from apps/api with the live .env loaded:
//
//   pnpm exec tsx --env-file=<repo>/.env scripts/smoke-mailgun-verify-domain.ts \
//     <workspaceID> <sendingDomainID>
//
// The Inngest event key (cloud) comes from INNGEST_EVENT_KEY in .env. In
// dev the client falls back to the localhost:8288 dev server.

import { Inngest } from 'inngest';

async function main() {
  const workspaceID = process.argv[2];
  const sendingDomainID = process.argv[3];
  if (!workspaceID || !sendingDomainID) {
    console.error('Usage: tsx smoke-mailgun-verify-domain.ts <workspaceID> <sendingDomainID>');
    process.exit(2);
  }

  const eventKey = process.env.INNGEST_EVENT_KEY;
  if (!eventKey) throw new Error('INNGEST_EVENT_KEY not set');

  const inngest = new Inngest({ id: 'salve-smoke', eventKey });
  const id = `smoke-domain-verify-${sendingDomainID}-${Date.now()}`;

  console.log(`[smoke] sending domain/verification.requested id=${id}`);
  console.log(`[smoke]   workspaceID=${workspaceID}`);
  console.log(`[smoke]   sendingDomainID=${sendingDomainID}`);

  const result = await inngest.send({
    id,
    name: 'domain/verification.requested',
    data: { workspaceID, sendingDomainID },
  });

  console.log('[smoke] dispatch result:', result);
  console.log('[smoke] watch the verify-domain function in Inngest Cloud or');
  console.log('[smoke] reload the settings page in ~5–15 s. dns_status should');
  console.log('[smoke] flip to "verified" once Mailgun reports state="active".');
}

main().catch((err) => {
  console.error('[smoke] FAIL:', err);
  process.exit(1);
});
