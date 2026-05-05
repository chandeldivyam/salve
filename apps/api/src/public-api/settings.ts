import { settingsActions } from '@opendesk/action-contracts';
import {
  archiveCustomFieldExecutor,
  archiveTagExecutor,
  archiveTagGroupExecutor,
  createApiTokenExecutor,
  createCustomFieldExecutor,
  createEmailAddressExecutor,
  createEmailDomainExecutor,
  createTagExecutor,
  createTagGroupExecutor,
  listApiTokensExecutor,
  listCustomFieldsExecutor,
  listSettingsTagsExecutor,
  restoreTagGroupExecutor,
  revokeApiTokenExecutor,
  updateCustomFieldExecutor,
  updateTagExecutor,
  updateTagGroupExecutor,
  upsertEmailRoutingRuleExecutor,
} from '@opendesk/action-executor';
import { Hono } from 'hono';
import { actionHandler, actionMiddlewares, readJsonBody } from './action-route.js';

export const settingsRouter = new Hono();

settingsRouter.get(
  '/tags',
  ...actionMiddlewares(settingsActions.tagsList),
  actionHandler(settingsActions.tagsList, listSettingsTagsExecutor, (c) => ({
    includeArchived: booleanQuery(c.req.query('includeArchived')),
  })),
);

settingsRouter.post(
  '/tags',
  ...actionMiddlewares(settingsActions.tagsCreate),
  actionHandler(settingsActions.tagsCreate, createTagExecutor, (c) => readJsonBody(c), 201),
);

settingsRouter.patch(
  '/tags/:tagId',
  ...actionMiddlewares(settingsActions.tagsUpdate),
  actionHandler(settingsActions.tagsUpdate, updateTagExecutor, async (c) => ({
    ...(await readJsonBody(c)),
    tagId: c.req.param('tagId'),
  })),
);

settingsRouter.delete(
  '/tags/:tagId',
  ...actionMiddlewares(settingsActions.tagsArchive),
  actionHandler(settingsActions.tagsArchive, archiveTagExecutor, (c) => ({
    tagId: c.req.param('tagId'),
  })),
);

settingsRouter.post(
  '/tag-groups',
  ...actionMiddlewares(settingsActions.tagGroupsCreate),
  actionHandler(
    settingsActions.tagGroupsCreate,
    createTagGroupExecutor,
    (c) => readJsonBody(c),
    201,
  ),
);

settingsRouter.patch(
  '/tag-groups/:groupId',
  ...actionMiddlewares(settingsActions.tagGroupsUpdate),
  actionHandler(settingsActions.tagGroupsUpdate, updateTagGroupExecutor, async (c) => ({
    ...(await readJsonBody(c)),
    groupId: c.req.param('groupId'),
  })),
);

settingsRouter.delete(
  '/tag-groups/:groupId',
  ...actionMiddlewares(settingsActions.tagGroupsArchive),
  actionHandler(settingsActions.tagGroupsArchive, archiveTagGroupExecutor, (c) => ({
    groupId: c.req.param('groupId'),
  })),
);

settingsRouter.post(
  '/tag-groups/:groupId/restore',
  ...actionMiddlewares(settingsActions.tagGroupsRestore),
  actionHandler(settingsActions.tagGroupsRestore, restoreTagGroupExecutor, (c) => ({
    groupId: c.req.param('groupId'),
  })),
);

settingsRouter.get(
  '/custom-fields',
  ...actionMiddlewares(settingsActions.customFieldsList),
  actionHandler(settingsActions.customFieldsList, listCustomFieldsExecutor, (c) => ({
    category: c.req.query('category'),
    includeInactive: booleanQuery(c.req.query('includeInactive')),
  })),
);

settingsRouter.post(
  '/custom-fields',
  ...actionMiddlewares(settingsActions.customFieldsCreate),
  actionHandler(
    settingsActions.customFieldsCreate,
    createCustomFieldExecutor,
    (c) => readJsonBody(c),
    201,
  ),
);

settingsRouter.patch(
  '/custom-fields/:customFieldId',
  ...actionMiddlewares(settingsActions.customFieldsUpdate),
  actionHandler(settingsActions.customFieldsUpdate, updateCustomFieldExecutor, async (c) => ({
    ...(await readJsonBody(c)),
    customFieldId: c.req.param('customFieldId'),
  })),
);

settingsRouter.delete(
  '/custom-fields/:customFieldId',
  ...actionMiddlewares(settingsActions.customFieldsArchive),
  actionHandler(settingsActions.customFieldsArchive, archiveCustomFieldExecutor, (c) => ({
    customFieldId: c.req.param('customFieldId'),
  })),
);

settingsRouter.post(
  '/email/domains',
  ...actionMiddlewares(settingsActions.emailDomainsCreate),
  actionHandler(
    settingsActions.emailDomainsCreate,
    createEmailDomainExecutor,
    (c) => readJsonBody(c),
    201,
  ),
);

settingsRouter.post(
  '/email/domains/:sendingDomainId/addresses',
  ...actionMiddlewares(settingsActions.emailAddressesCreate),
  actionHandler(
    settingsActions.emailAddressesCreate,
    createEmailAddressExecutor,
    async (c) => ({
      ...(await readJsonBody(c)),
      sendingDomainId: c.req.param('sendingDomainId'),
    }),
    201,
  ),
);

settingsRouter.post(
  '/email/channels/:channelId/routing-rules',
  ...actionMiddlewares(settingsActions.emailRoutingRulesUpsert),
  actionHandler(
    settingsActions.emailRoutingRulesUpsert,
    upsertEmailRoutingRuleExecutor,
    async (c) => ({
      ...(await readJsonBody(c)),
      channelId: c.req.param('channelId'),
    }),
    201,
  ),
);

settingsRouter.get(
  '/api-tokens',
  ...actionMiddlewares(settingsActions.apiTokensList),
  actionHandler(settingsActions.apiTokensList, listApiTokensExecutor, () => ({})),
);

settingsRouter.post(
  '/api-tokens',
  ...actionMiddlewares(settingsActions.apiTokensCreate),
  actionHandler(
    settingsActions.apiTokensCreate,
    createApiTokenExecutor,
    (c) => readJsonBody(c),
    201,
  ),
);

settingsRouter.delete(
  '/api-tokens/:tokenId',
  ...actionMiddlewares(settingsActions.apiTokensRevoke),
  actionHandler(settingsActions.apiTokensRevoke, revokeApiTokenExecutor, (c) => ({
    tokenId: c.req.param('tokenId'),
  })),
);

function booleanQuery(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  if (value === 'true' || value === '1') return true;
  if (value === 'false' || value === '0') return false;
  return undefined;
}
