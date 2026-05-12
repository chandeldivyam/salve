// migration/atlas.start
//
// v0 thin slice. Lists the most-recent N conversations from Atlas (capped via
// `maxTickets`) and fans out one `migration/atlas.conversation` event per id.
// No date-window slicing yet — that comes in v1 once the basic slice works.

import { getClient } from '@salve/db';
import {
  AtlasClient,
  toCanonicalCustomFieldDef,
  toCanonicalTag,
  toCanonicalTagGroup,
} from '@salve/migration-atlas';
import {
  upsertCustomFieldDefinitions,
  upsertTagGroups,
  upsertTags,
} from '../../../migrations/persist.js';
import { inngest } from '../../client.js';
import { MIGRATION_EVENT, migrationAtlasStartDataSchema } from '../../events.js';

export const migrationAtlasStart = inngest.createFunction(
  {
    id: 'migration-atlas-start',
    name: 'Migration · Atlas · start',
    retries: 2,
    concurrency: [{ scope: 'fn', key: 'event.data.workspaceID', limit: 1 }],
    triggers: [{ event: MIGRATION_EVENT.ATLAS_START }],
  },
  // biome-ignore lint/suspicious/noExplicitAny: Inngest 4 event typing kept local; data validated below.
  async ({ event, step, logger }: any) => {
    const data = migrationAtlasStartDataSchema.parse(event.data);
    const sql = getClient();

    // Re-read run params + credentials from the DB. Credentials live in the
    // off-public `secrets` schema so they're never replicated to zero-cache
    // (see packages/db/src/schema/migration.ts header).
    const runRows = await sql<
      {
        api_key: string | null;
        base_url: string | null;
        params: {
          maxTickets?: number | null;
          sinceDays?: number | null;
          startDate?: string | null;
          endDate?: string | null;
        };
      }[]
    >`
      SELECT c.api_key, c.base_url, r.params
      FROM migration_run r
      LEFT JOIN secrets.migration_credential c ON c.run_id = r.id
      WHERE r.id = ${data.runId} AND r.workspace_id = ${data.workspaceID}
      LIMIT 1
    `;
    const runRow = runRows[0];
    if (!runRow?.api_key) {
      logger.error('migration_run missing apiKey on start', { runId: data.runId });
      return { ok: false, reason: 'no-api-key' };
    }
    const apiKey = runRow.api_key;
    const baseUrl = runRow.base_url ?? undefined;
    const runParams = runRow.params ?? {};
    const maxTickets = runParams.maxTickets ?? 10;
    const startDateStr = runParams.startDate ?? undefined;
    const endDateStr = runParams.endDate ?? undefined;
    const sinceDays = runParams.sinceDays ?? undefined;
    const atlas = new AtlasClient({ apiKey, baseUrl });

    await step.run('mark-discovering', async () => {
      await sql`
        UPDATE migration_run
        SET status = 'discovering', updated_at = now()
        WHERE id = ${data.runId}
      `;
    });

    // Discovery — pull every Atlas custom-field definition and upsert into
    // Salve. Must happen BEFORE the conversation fan-out so per-ticket value
    // projection can resolve `custom_field` rows by key.
    const fieldsResult = await step.run('discover-custom-fields', async () => {
      const atlasFields = await atlas.listAllCustomFields();
      const canonical = atlasFields.map(toCanonicalCustomFieldDef);
      const result = await upsertCustomFieldDefinitions(
        { workspaceId: data.workspaceID, source: 'atlas', runId: data.runId },
        canonical,
      );
      logger.info('discovered atlas custom fields', {
        atlasTotal: atlasFields.length,
        ...result,
      });
      return { atlasTotal: atlasFields.length, ...result };
    });

    // Discovery — tag groups must come before tags (FK reference).
    const tagsResult = await step.run('discover-tags', async () => {
      const persistCtx = { workspaceId: data.workspaceID, source: 'atlas', runId: data.runId };
      const groupsAtlas = await atlas.listAllTagGroups();
      const groupsCanonical = groupsAtlas.map(toCanonicalTagGroup);
      const groupsResult = await upsertTagGroups(persistCtx, groupsCanonical);

      const tagsAtlas = await atlas.listAllTags();
      const tagsCanonical = tagsAtlas.map(toCanonicalTag);
      const tagRes = await upsertTags(persistCtx, tagsCanonical);

      logger.info('discovered atlas tags', {
        atlasGroupTotal: groupsAtlas.length,
        atlasTagTotal: tagsAtlas.length,
        groupsCreated: groupsResult.created,
        groupsReused: groupsResult.reused,
        tagsCreated: tagRes.created,
        tagsReused: tagRes.reused,
      });
      return {
        groups_total: groupsAtlas.length,
        groups_created: groupsResult.created,
        tags_total: tagsAtlas.length,
        tags_created: tagRes.created,
      };
    });

    await step.run('record-discovery-counters', async () => {
      await sql`
        UPDATE migration_run SET
          counters = counters || jsonb_build_object(
            'custom_fields_discovered'::text, ${fieldsResult.atlasTotal}::int,
            'custom_fields_created'::text,    ${fieldsResult.created}::int,
            'custom_fields_skipped'::text,    ${fieldsResult.skipped}::int,
            'tag_groups_discovered'::text,    ${tagsResult.groups_total}::int,
            'tag_groups_created'::text,       ${tagsResult.groups_created}::int,
            'tags_discovered'::text,          ${tagsResult.tags_total}::int,
            'tags_created'::text,             ${tagsResult.tags_created}::int
          ),
          updated_at = now()
        WHERE id = ${data.runId}
      `;
    });

    // Compute the optional date window. `startDate` overrides `sinceDays`.
    // Atlas serves cursor=0 as the OLDEST ticket (ascending startedAt). To
    // get "the most recent N", we sweep BACKWARD from `total`.
    //
    // IMPORTANT: Atlas's server-side `start_date`/`end_date` query params are
    // silently no-op in production (verified by probing). We pass them anyway
    // (future-proofing) but apply the filter CLIENT-SIDE during the sweep.
    const now = new Date();
    const startDate: Date | undefined = startDateStr
      ? new Date(startDateStr)
      : sinceDays
        ? new Date(now.getTime() - sinceDays * 24 * 60 * 60 * 1000)
        : undefined;
    const endDate: Date | undefined = endDateStr ? new Date(endDateStr) : undefined;
    const startEpochSec = startDate ? Math.floor(startDate.getTime() / 1000) : null;
    const endEpochSec = endDate ? Math.floor(endDate.getTime() / 1000) : null;

    // Probe the total once.
    const probe = await step.run('probe-total', async () => {
      const res = await atlas.listConversations({ cursor: 0, limit: 1 });
      return { total: res.total };
    });

    const PAGE = 100;
    const headers: string[] = [];
    // Backward sweep: each iteration pulls the chunk just before `windowEnd`
    // (exclusive). Within a page we walk newest-to-oldest (by reversing) and
    // bail the moment we cross below the cutoff.
    let windowEnd = probe.total;
    let crossedCutoff = false;
    // Defensive iteration cap — mirrors listAllTags/listAllCustomFields. A
    // workspace with millions of Atlas tickets + a tight sinceDays could
    // otherwise spawn unbounded step.run invocations.
    const MAX_SWEEP_PAGES = 200;
    let sweptPages = 0;
    while (
      windowEnd > 0 &&
      headers.length < maxTickets &&
      !crossedCutoff &&
      sweptPages < MAX_SWEEP_PAGES
    ) {
      sweptPages++;
      const pageStart = Math.max(0, windowEnd - PAGE);
      const want = windowEnd - pageStart;
      const page = await step.run(`list-conversations-${pageStart}`, async () => {
        const res = await atlas.listConversations({
          cursor: pageStart,
          limit: want,
          startDate,
          endDate,
        });
        return res.data; // sorted ascending by startedAt
      });

      let pageHits = 0;
      // Walk newest-to-oldest within the page.
      for (const c of [...page].reverse()) {
        if (headers.length >= maxTickets) break;
        const t = c.startedAt ?? null;
        if (startEpochSec != null && t != null && t < startEpochSec) {
          crossedCutoff = true;
          break;
        }
        if (endEpochSec != null && t != null && t > endEpochSec) continue;
        headers.push(c.id);
        pageHits++;
      }
      logger.info('atlas list (backward)', {
        windowEnd,
        pageStart,
        rawCount: page.length,
        pageHits,
        crossedCutoff,
        accumulated: headers.length,
      });
      if (page.length < want) break; // exhausted at the head
      windowEnd = pageStart;
    }

    await step.run('mark-backfilling', async () => {
      await sql`
        UPDATE migration_run
        SET status = 'backfilling',
            counters = jsonb_set(counters, '{discovered}', to_jsonb(${headers.length}::int), true),
            updated_at = now()
        WHERE id = ${data.runId}
      `;
    });

    if (headers.length === 0) {
      await step.run('mark-completed-empty', async () => {
        await sql`
          UPDATE migration_run
          SET status = 'completed', completed_at = now(), updated_at = now()
          WHERE id = ${data.runId}
        `;
      });
      return { ok: true, count: 0 };
    }

    await step.sendEvent(
      'fan-out',
      headers.map((id: string) => ({
        id: `mig-conv-${data.runId}-${id}`,
        name: MIGRATION_EVENT.ATLAS_CONVERSATION,
        data: {
          runId: data.runId,
          workspaceID: data.workspaceID,
          conversationId: id,
        },
      })),
    );

    return { ok: true, count: headers.length };
  },
);
