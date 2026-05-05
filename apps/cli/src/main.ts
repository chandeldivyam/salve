import { SalveClient } from '@salve/api-client';
import { defineCommand } from 'citty';
import { getBooleanFlag, getFlag, getNumberFlag, parseArgv } from './args.js';
import { clearAuthConfig, writeAuthConfig, writeWorkspaceConfig } from './auth/config.js';
import { getClient, requestOptions } from './client.js';
import { formatError } from './error.js';
import { readJsonArg, readSecret, readTextArg } from './io.js';
import { type OutputContext, printValue } from './output/format.js';
import {
  customerTable,
  defaultTable,
  tagTable,
  ticketTable,
  workspaceTable,
} from './output/tables.js';

const VERSION = '0.0.0';
const TOKEN_URL = 'https://app.usesalve.com/app/settings/api-tokens';

export const salveCommand = defineCommand({
  meta: {
    name: 'salve',
    version: VERSION,
    description: 'Command-line client for Salve.',
  },
});

export async function run(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
  const normalizedArgv = argv[0] === '--' ? argv.slice(1) : argv;
  const parsed = parseArgv(normalizedArgv);
  const context: OutputContext = { flags: parsed.flags };

  if (parsed.flags.version) {
    printVersion();
    return;
  }
  if (parsed.flags.help || parsed.positionals.length === 0) {
    printHelp(parsed.positionals);
    return;
  }

  try {
    await dispatch(parsed.positionals, parsed.flags, context);
  } catch (error) {
    const formatted = formatError(error);
    process.stderr.write(`${formatted.message}\n`);
    process.exitCode = formatted.exitCode;
  }
}

async function dispatch(
  command: readonly string[],
  flags: Record<string, string | boolean>,
  context: OutputContext,
): Promise<void> {
  const [noun, verb, third, fourth] = command;
  if (noun === 'login') return login(flags);
  if (noun === 'logout') return logout();
  if (noun === 'whoami') return whoami(flags, context);
  if (noun === 'workspace') return workspace(command.slice(1), flags, context);
  if (noun === 'tickets') return tickets(command.slice(1), flags, context);
  if (noun === 'customers') return customers(command.slice(1), flags, context);
  if (noun === 'views') return views(command.slice(1), flags, context);
  if (noun === 'settings') return settings(command.slice(1), flags, context);
  if (noun === 'api') return api(command.slice(1), flags, context);
  if (noun === 'action') return action(command.slice(1), flags, context);

  throw new Error(`Unknown command: ${[noun, verb, third, fourth].filter(Boolean).join(' ')}`);
}

async function login(flags: Record<string, string | boolean>): Promise<void> {
  process.stderr.write(
    `Paste your token from Salve Settings -> Developer -> API tokens\n${TOKEN_URL}\n`,
  );
  const token = await readSecret('Token: ');
  const apiBaseUrl = getFlag(flags, 'apiBaseUrl') ?? process.env.SALVE_API_URL ?? undefined;
  const client = new SalveClient({
    token,
    baseUrl: apiBaseUrl,
  });
  const auth = await client.whoami();
  await writeAuthConfig({
    token,
    workspaceId: auth.workspaceId,
    apiBaseUrl: apiBaseUrl ?? 'https://api.usesalve.com',
    principalKind: auth.principalKind,
    scopes: auth.scopes,
    savedAt: new Date().toISOString(),
    email: auth.email,
    role: auth.role,
  });
  process.stdout.write(
    `Signed in as ${auth.email} (${auth.role}). Token scopes: ${auth.scopes.join(', ') || 'none'}\n`,
  );
}

async function logout(): Promise<void> {
  await clearAuthConfig();
  process.stdout.write('Signed out.\n');
}

async function whoami(
  flags: Record<string, string | boolean>,
  context: OutputContext,
): Promise<void> {
  const client = await getClient({ flags });
  printValue(await client.whoami(), context);
}

async function workspace(
  command: readonly string[],
  flags: Record<string, string | boolean>,
  context: OutputContext,
): Promise<void> {
  const client = await getClient({ flags });
  if (command[0] === 'list') {
    const result = await client.workspace.list(requestOptions(flags));
    printValue(result, context, workspaceTable(result, context));
    return;
  }
  if (command[0] === 'use') {
    const slugOrId = requireArg(command[1], 'workspace slug or id');
    const result = await client.workspace.list(requestOptions(flags));
    const workspace = result.data.find((item) => item.slug === slugOrId || item.id === slugOrId);
    if (!workspace) throw new Error(`Workspace not found: ${slugOrId}`);
    await writeWorkspaceConfig({
      workspaceId: workspace.id,
      workspaceSlug: workspace.slug,
      savedAt: new Date().toISOString(),
    });
    process.stdout.write(`Active workspace set to ${workspace.slug}.\n`);
    return;
  }
  throw new Error('Usage: salve workspace list | salve workspace use <slug>');
}

async function tickets(
  command: readonly string[],
  flags: Record<string, string | boolean>,
  context: OutputContext,
): Promise<void> {
  const client = await getClient({ flags });
  const options = requestOptions(flags);
  const [verb] = command;

  if (verb === 'list') {
    const assignee = getFlag(flags, 'assignee');
    const input = {
      limit: getNumberFlag(flags, 'limit'),
      cursor: getFlag(flags, 'cursor'),
      status: getFlag(flags, 'status') as never,
      assigneeId: assignee === 'me' ? (await client.whoami()).userId : assignee,
      customerId: getFlag(flags, 'customer'),
    };
    const result = await client.tickets.list(input, options);
    printValue(result, context, ticketTable(result, context));
    return;
  }
  if (verb === 'show') {
    printValue(await client.tickets.get(requireArg(command[1], 'ticket id'), options), context);
    return;
  }
  if (verb === 'create') {
    const result = await client.tickets.create(
      {
        title: requireFlag(flags, 'title'),
        description: await readTextArg(getFlag(flags, 'body') ?? getFlag(flags, 'bodyFile')),
        customerEmail: getFlag(flags, 'customer'),
        customerName: getFlag(flags, 'customerName'),
        priority: getFlag(flags, 'priority') as never,
      },
      options,
    );
    printValue(result, context);
    return;
  }
  if (verb === 'update') {
    printValue(
      await client.tickets.update(
        requireArg(command[1], 'ticket id'),
        {
          title: getFlag(flags, 'title'),
          description: getFlag(flags, 'description'),
          priority: getFlag(flags, 'priority') as never,
        },
        options,
      ),
      context,
    );
    return;
  }
  if (verb === 'reply' || verb === 'note') {
    const body = requireText(
      await readTextArg(getFlag(flags, 'body') ?? getFlag(flags, 'bodyFile')),
    );
    const method = verb === 'reply' ? client.tickets.reply : client.tickets.note;
    printValue(
      await method.call(
        client.tickets,
        requireArg(command[1], 'ticket id'),
        {
          bodyText: body,
          bodyHtml: getFlag(flags, 'bodyHtml') ?? body,
          emailAddressId: getFlag(flags, 'emailAddressId') ?? undefined,
        },
        options,
      ),
      context,
    );
    return;
  }
  if (verb === 'assign') {
    const assignee = requireArg(command[2], 'assignee');
    const assigneeId =
      assignee === 'none' ? null : assignee === 'me' ? (await client.whoami()).userId : assignee;
    printValue(
      await client.tickets.assign(requireArg(command[1], 'ticket id'), { assigneeId }, options),
      context,
    );
    return;
  }
  if (verb === 'snooze') {
    printValue(
      await client.tickets.snooze(
        requireArg(command[1], 'ticket id'),
        {
          until: requireFlag(flags, 'until'),
        },
        options,
      ),
      context,
    );
    return;
  }
  if (verb === 'in-progress') {
    printValue(
      await client.tickets.markInProgress(requireArg(command[1], 'ticket id'), options),
      context,
    );
    return;
  }
  if (verb === 'resolve' || verb === 'close' || verb === 'reopen') {
    printValue(await client.tickets[verb](requireArg(command[1], 'ticket id'), options), context);
    return;
  }
  if (verb === 'tags') {
    const sub = command[1];
    const ticketId = requireArg(command[2], 'ticket id');
    if (sub === 'add') {
      printValue(
        await client.tickets.tags.add(ticketId, { tagIds: command.slice(3) }, options),
        context,
      );
      return;
    }
    if (sub === 'replace') {
      printValue(
        await client.tickets.tags.replace(ticketId, { tagIds: command.slice(3) }, options),
        context,
      );
      return;
    }
    if (sub === 'remove') {
      printValue(
        await client.tickets.tags.remove(ticketId, requireArg(command[3], 'tag id'), options),
        context,
      );
      return;
    }
  }
  if (verb === 'message' || verb === 'messages') {
    const sub = command[1];
    const ticketId = requireArg(command[2], 'ticket id');
    const messageId = requireArg(command[3], 'message id');
    if (sub === 'update') {
      const body = requireText(
        await readTextArg(getFlag(flags, 'body') ?? getFlag(flags, 'bodyFile')),
      );
      printValue(
        await client.tickets.message.update(
          ticketId,
          messageId,
          { bodyText: body, bodyHtml: getFlag(flags, 'bodyHtml') ?? body },
          options,
        ),
        context,
      );
      return;
    }
    if (sub === 'delete') {
      printValue(await client.tickets.message.delete(ticketId, messageId, options), context);
      return;
    }
  }
  if (verb === 'custom-field' && command[1] === 'set') {
    printValue(
      await client.tickets.customField.set(
        requireArg(command[2], 'ticket id'),
        requireArg(command[3], 'field key'),
        parseLooseJson(requireArg(command[4], 'value')),
        options,
      ),
      context,
    );
    return;
  }

  throw new Error('Unknown tickets command. Run `salve tickets --help`.');
}

async function customers(
  command: readonly string[],
  flags: Record<string, string | boolean>,
  context: OutputContext,
): Promise<void> {
  const client = await getClient({ flags });
  const options = requestOptions(flags);
  const [verb] = command;
  if (verb === 'list') {
    const result = await client.customers.list({
      limit: getNumberFlag(flags, 'limit'),
      cursor: getFlag(flags, 'cursor'),
      search: getFlag(flags, 'search'),
    });
    printValue(result, context, customerTable(result, context));
    return;
  }
  if (verb === 'show') {
    printValue(await client.customers.get(requireArg(command[1], 'customer id'), options), context);
    return;
  }
  if (verb === 'update') {
    printValue(
      await client.customers.update(
        requireArg(command[1], 'customer id'),
        {
          name: nullableFlag(flags, 'name'),
          displayName: nullableFlag(flags, 'displayName'),
          phone: nullableFlag(flags, 'phone'),
          location: nullableFlag(flags, 'location'),
          metadata: await readJsonArg(getFlag(flags, 'metadata')),
        },
        options,
      ),
      context,
    );
    return;
  }
  if (verb === 'notes') {
    const sub = command[1];
    if (sub === 'create') {
      const body = requireText(
        await readTextArg(getFlag(flags, 'body') ?? getFlag(flags, 'bodyFile')),
      );
      printValue(
        await client.customers.notes.create(
          requireArg(command[2], 'customer id'),
          { objectType: 'customer', bodyText: body, bodyHtml: getFlag(flags, 'bodyHtml') ?? body },
          options,
        ),
        context,
      );
      return;
    }
    if (sub === 'update') {
      const body = requireText(
        await readTextArg(getFlag(flags, 'body') ?? getFlag(flags, 'bodyFile')),
      );
      printValue(
        await client.customers.notes.update(
          requireArg(command[2], 'note id'),
          { bodyText: body, bodyHtml: getFlag(flags, 'bodyHtml') ?? body },
          options,
        ),
        context,
      );
      return;
    }
    if (sub === 'delete') {
      printValue(
        await client.customers.notes.delete(requireArg(command[2], 'note id'), options),
        context,
      );
      return;
    }
  }
  if (verb === 'tags') {
    const sub = command[1];
    const customerId = requireArg(command[2], 'customer id');
    if (sub === 'add') {
      printValue(
        await client.customers.tags.add(customerId, { tagIds: command.slice(3) }, options),
        context,
      );
      return;
    }
    if (sub === 'remove') {
      printValue(
        await client.customers.tags.remove(customerId, requireArg(command[3], 'tag id'), options),
        context,
      );
      return;
    }
  }
  if (verb === 'events' && command[1] === 'ingest') {
    printValue(
      await client.customers.events.ingest(
        requireArg(command[2], 'customer id'),
        {
          eventName: requireFlag(flags, 'name'),
          properties: (await readJsonArg(getFlag(flags, 'properties'))) ?? {},
          source: getFlag(flags, 'source'),
        },
        options,
      ),
      context,
    );
    return;
  }
  if (verb === 'custom-field' && command[1] === 'set') {
    printValue(
      await client.customers.customField.set(
        requireArg(command[2], 'customer id'),
        requireArg(command[3], 'field key'),
        parseLooseJson(requireArg(command[4], 'value')),
        options,
      ),
      context,
    );
    return;
  }
  throw new Error('Unknown customers command.');
}

async function views(
  command: readonly string[],
  flags: Record<string, string | boolean>,
  context: OutputContext,
): Promise<void> {
  const client = await getClient({ flags });
  const options = requestOptions(flags);
  if (command[0] === 'list') {
    const result = await client.views.list(
      { includeArchived: getBooleanFlag(flags, 'includeArchived') },
      options,
    );
    printValue(result, context, defaultTable(result, context));
    return;
  }
  if (command[0] === 'show') {
    printValue(await client.views.get(requireArg(command[1], 'view id'), options), context);
    return;
  }
  if (command[0] === 'create') {
    printValue(
      await client.views.create(
        {
          scope: requireFlag(flags, 'scope') as never,
          label: requireFlag(flags, 'label'),
          description: getFlag(flags, 'description'),
          icon: getFlag(flags, 'icon'),
          color: getFlag(flags, 'color'),
          query: await readJsonRequiredFlag(flags, 'query'),
          sort: await readJsonArg(getFlag(flags, 'sort')),
          groupBy: nullableFlag(flags, 'groupBy'),
          displayProps: await readJsonArg(getFlag(flags, 'displayProps')),
        },
        options,
      ),
      context,
    );
    return;
  }
  if (command[0] === 'update') {
    printValue(
      await client.views.update(
        requireArg(command[1], 'view id'),
        {
          label: getFlag(flags, 'label'),
          description: getFlag(flags, 'description'),
          icon: getFlag(flags, 'icon'),
          color: getFlag(flags, 'color'),
          query: await readJsonArg(getFlag(flags, 'query')),
          sort: await readJsonArg(getFlag(flags, 'sort')),
          groupBy: nullableFlag(flags, 'groupBy'),
          displayProps: await readJsonArg(getFlag(flags, 'displayProps')),
        },
        options,
      ),
      context,
    );
    return;
  }
  if (command[0] === 'delete' || command[0] === 'archive') {
    printValue(await client.views.delete(requireArg(command[1], 'view id'), options), context);
    return;
  }
  if (command[0] === 'tickets') {
    const result = await client.views.tickets(
      requireArg(command[1], 'view id'),
      { limit: getNumberFlag(flags, 'limit'), cursor: getFlag(flags, 'cursor') },
      options,
    );
    printValue(result, context, ticketTable(result, context));
    return;
  }
  throw new Error('Unknown views command.');
}

async function settings(
  command: readonly string[],
  flags: Record<string, string | boolean>,
  context: OutputContext,
): Promise<void> {
  const client = await getClient({ flags });
  const options = requestOptions(flags);
  const [area, resource, verb] = command;
  if (area === 'tags') {
    if (resource === 'list') {
      const result = await client.settings.tags.list({
        includeArchived: getBooleanFlag(flags, 'includeArchived'),
      });
      printValue(result, context, tagTable(result, context));
      return;
    }
    if (resource === 'create') {
      printValue(
        await client.settings.tags.create(
          {
            label: requireFlag(flags, 'label'),
            groupId: nullableFlag(flags, 'groupId'),
            color: nullableFlag(flags, 'color'),
            sortOrder: getNumberFlag(flags, 'sortOrder'),
          },
          options,
        ),
        context,
      );
      return;
    }
    if (resource === 'update') {
      printValue(
        await client.settings.tags.update(
          requireArg(command[2], 'tag id'),
          {
            label: getFlag(flags, 'label'),
            groupId: nullableFlag(flags, 'groupId'),
            color: nullableFlag(flags, 'color'),
            sortOrder: getNumberFlag(flags, 'sortOrder'),
          },
          options,
        ),
        context,
      );
      return;
    }
    if (resource === 'archive') {
      printValue(
        await client.settings.tags.archive(requireArg(command[2], 'tag id'), options),
        context,
      );
      return;
    }
  }
  if (area === 'tag-groups') {
    await tagGroups(command.slice(1), flags, context);
    return;
  }
  if (area === 'custom-fields') {
    await customFields(command.slice(1), flags, context);
    return;
  }
  if (area === 'api-tokens') {
    if (resource === 'list') {
      const result = await client.settings.apiTokens.list(options);
      printValue(result, context, defaultTable(result, context));
      return;
    }
    if (resource === 'create') {
      printValue(
        await client.settings.apiTokens.create(
          {
            name: requireFlag(flags, 'name'),
            scopes: requireFlag(flags, 'scopes').split(',') as never,
            expiresInDays: getNumberFlag(flags, 'expiresInDays'),
          },
          options,
        ),
        context,
      );
      return;
    }
    if (resource === 'revoke') {
      printValue(
        await client.settings.apiTokens.revoke(requireArg(command[2], 'token id'), options),
        context,
      );
      return;
    }
  }
  if (area === 'email') {
    if (resource === 'domains' && (verb === 'add' || verb === 'create')) {
      printValue(
        await client.settings.email.domains.create(
          {
            domain: requireArg(command[3], 'domain'),
            fromName: getFlag(flags, 'fromName'),
            signature: getFlag(flags, 'signature'),
          },
          options,
        ),
        context,
      );
      return;
    }
    if (resource === 'addresses' && (verb === 'add' || verb === 'create')) {
      printValue(
        await client.settings.email.addresses.create(
          requireArg(command[3], 'sending domain id'),
          {
            localPart: requireArg(command[4], 'local part'),
            channelId: getFlag(flags, 'channelId'),
            label: getFlag(flags, 'label'),
            canSend: getBooleanFlag(flags, 'canSend'),
            canReceive: getBooleanFlag(flags, 'canReceive'),
            isDefault: getBooleanFlag(flags, 'default'),
            signature: getFlag(flags, 'signature'),
          },
          options,
        ),
        context,
      );
      return;
    }
    if (resource === 'routing-rules' && verb === 'upsert') {
      printValue(
        await client.settings.email.routingRules.upsert(
          requireArg(command[3], 'channel id'),
          {
            emailAddressId: requireFlag(flags, 'emailAddressId'),
            destinationAddress: getFlag(flags, 'destinationAddress'),
            senderPattern: getFlag(flags, 'senderPattern'),
            subjectPattern: getFlag(flags, 'subjectPattern'),
            assignTeamId: getFlag(flags, 'assignTeamId'),
            assignAgentId: getFlag(flags, 'assignAgentId'),
            setPriority: getFlag(flags, 'setPriority') as never,
            priority: getNumberFlag(flags, 'priority'),
            enabled: getBooleanFlag(flags, 'enabled'),
          },
          options,
        ),
        context,
      );
      return;
    }
  }
  throw new Error('Unknown settings command.');
}

async function tagGroups(
  command: readonly string[],
  flags: Record<string, string | boolean>,
  context: OutputContext,
): Promise<void> {
  const client = await getClient({ flags });
  const options = requestOptions(flags);
  if (command[0] === 'create') {
    printValue(
      await client.settings.tagGroups.create(
        {
          label: requireFlag(flags, 'label'),
          color: requireFlag(flags, 'color'),
          sortOrder: getNumberFlag(flags, 'sortOrder'),
        },
        options,
      ),
      context,
    );
    return;
  }
  if (command[0] === 'update') {
    printValue(
      await client.settings.tagGroups.update(
        requireArg(command[1], 'group id'),
        {
          label: getFlag(flags, 'label'),
          color: getFlag(flags, 'color'),
          sortOrder: getNumberFlag(flags, 'sortOrder'),
        },
        options,
      ),
      context,
    );
    return;
  }
  if (command[0] === 'archive') {
    printValue(
      await client.settings.tagGroups.archive(requireArg(command[1], 'group id'), options),
      context,
    );
    return;
  }
  if (command[0] === 'restore') {
    printValue(
      await client.settings.tagGroups.restore(requireArg(command[1], 'group id'), options),
      context,
    );
    return;
  }
  throw new Error('Unknown tag-groups command.');
}

async function customFields(
  command: readonly string[],
  flags: Record<string, string | boolean>,
  context: OutputContext,
): Promise<void> {
  const client = await getClient({ flags });
  const options = requestOptions(flags);
  if (command[0] === 'list') {
    printValue(
      await client.settings.customFields.list({
        category: getFlag(flags, 'category') as never,
        includeInactive: getBooleanFlag(flags, 'includeInactive'),
      }),
      context,
    );
    return;
  }
  if (command[0] === 'create') {
    printValue(
      await client.settings.customFields.create(
        {
          key: requireFlag(flags, 'key'),
          displayName: requireFlag(flags, 'displayName'),
          description: getFlag(flags, 'description'),
          category: requireFlag(flags, 'category') as never,
          type: requireFlag(flags, 'type') as never,
          options: getFlag(flags, 'options')?.split(','),
          required: getBooleanFlag(flags, 'required'),
          active: getBooleanFlag(flags, 'active'),
          sortOrder: getNumberFlag(flags, 'sortOrder'),
        },
        options,
      ),
      context,
    );
    return;
  }
  if (command[0] === 'update') {
    printValue(
      await client.settings.customFields.update(
        requireArg(command[1], 'custom field id'),
        {
          displayName: getFlag(flags, 'displayName'),
          description: getFlag(flags, 'description'),
          required: getBooleanFlag(flags, 'required'),
          active: getBooleanFlag(flags, 'active'),
          options: getFlag(flags, 'options')?.split(','),
          sortOrder: getNumberFlag(flags, 'sortOrder'),
        },
        options,
      ),
      context,
    );
    return;
  }
  if (command[0] === 'archive') {
    printValue(
      await client.settings.customFields.archive(requireArg(command[1], 'field id'), options),
      context,
    );
    return;
  }
  throw new Error('Unknown custom-fields command.');
}

async function api(
  command: readonly string[],
  flags: Record<string, string | boolean>,
  context: OutputContext,
): Promise<void> {
  const client = await getClient({ flags });
  const body = await readJsonArg(getFlag(flags, 'body'));
  printValue(
    await client.raw(
      requireArg(command[0], 'method'),
      requireArg(command[1], 'path'),
      body,
      requestOptions(flags),
    ),
    context,
  );
}

async function action(
  command: readonly string[],
  flags: Record<string, string | boolean>,
  context: OutputContext,
): Promise<void> {
  const client = await getClient({ flags });
  const actionId = requireArg(command[0], 'action id') as never;
  const input = ((await readJsonArg(getFlag(flags, 'input'))) ?? {}) as never;
  printValue(await client.action(actionId, input, requestOptions(flags)), context);
}

function printVersion(): void {
  const commit = process.env.SALVE_COMMIT_SHA ?? 'dev';
  process.stdout.write(`salve ${VERSION} (${commit})\n`);
}

function printHelp(command: readonly string[]): void {
  if (command[0] === 'tickets' && command[1] === 'reply') {
    printLines([
      'usage: salve tickets reply <ticket-id> --body <text>',
      '',
      'flags',
      '  --body <text>              Reply body',
      '  --body-file <path|-|@file> Read reply body from a file or stdin',
      '  --body-html <html>         Optional HTML body',
      '  --email-address-id <id>    Send from a configured email address',
      '  --idempotency-key <key>    Reuse for an explicit retry',
      '',
      'examples',
      '  salve tickets reply ticket_123 --body "Thanks, we are checking."',
      '  cat reply.txt | salve tickets reply ticket_123 --body-file -',
    ]);
    return;
  }

  if (command[0] === 'tickets') {
    printLines([
      `salve ${VERSION}`,
      '',
      'tickets commands',
      '  list --status <status> --assignee <me|id> --limit <n>',
      '  show <ticket-id>',
      '  create --title <title> [--body <text>] [--customer <email>] [--priority <priority>]',
      '  update <ticket-id> [--title <title>] [--description <text>] [--priority <priority>]',
      '  reply <ticket-id> --body <text>',
      '  note <ticket-id> --body <text>',
      '  assign <ticket-id> <me|none|user-id>',
      '  snooze <ticket-id> --until <iso-time>',
      '  in-progress|resolve|close|reopen <ticket-id>',
      '  message update|delete <ticket-id> <message-id>',
      '  tags add|replace|remove <ticket-id> <tag-id...>',
      '  custom-field set <ticket-id> <field-key> <value>',
    ]);
    return;
  }

  const section = command[0] ? `${command[0]} commands` : 'commands';
  const lines = [
    `salve ${VERSION}`,
    '',
    section,
    '  login',
    '  logout',
    '  whoami',
    '  workspace list|use',
    '  tickets list|show|create|update|reply|note|assign|snooze|in-progress|resolve|close|reopen',
    '  tickets message update|delete',
    '  tickets tags add|replace|remove',
    '  tickets custom-field set',
    '  customers list|show|update|notes|tags|events|custom-field',
    '  views list|show|create|update|delete|tickets',
    '  settings tags|tag-groups|custom-fields|email|api-tokens',
    '  api <METHOD> <PATH> [--body @file.json]',
    '  action <action-id> [--input @file.json]',
    '',
    'global flags',
    '  --json  --jsonl  --no-color  --api-base-url <url>  --workspace <id>',
    '  --idempotency-key <key>',
  ];
  printLines(lines);
}

function printLines(lines: readonly string[]): void {
  process.stdout.write(`${lines.join('\n')}\n`);
}

function requireArg(value: string | undefined, label: string): string {
  if (!value) throw new Error(`Missing ${label}`);
  return value;
}

function requireFlag(flags: Record<string, string | boolean>, key: string): string {
  const value = getFlag(flags, key);
  if (!value) throw new Error(`Missing --${key.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}`);
  return value;
}

async function readJsonRequiredFlag(
  flags: Record<string, string | boolean>,
  key: string,
): Promise<unknown> {
  return readJsonArg(requireFlag(flags, key));
}

function requireText(value: string | undefined): string {
  if (!value?.trim()) throw new Error('Missing body text');
  return value;
}

function nullableFlag(
  flags: Record<string, string | boolean>,
  key: string,
): string | null | undefined {
  const value = getFlag(flags, key);
  if (value === undefined) return undefined;
  return value === 'null' || value === 'none' ? null : value;
}

function parseLooseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}
