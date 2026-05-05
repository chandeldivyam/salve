#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(scriptDir, '..');

const presets = {
  small: {
    agents: 4,
    customers: 120,
    tickets: 300,
    messagesPerTicket: 2,
    tags: 32,
    tagsPerTicket: 3,
    tagsPerCustomer: 2,
    ticketFields: 6,
    customerFields: 4,
  },
  old: {
    agents: 8,
    customers: 600,
    tickets: 1600,
    messagesPerTicket: 2,
    tags: 96,
    tagsPerTicket: 4,
    tagsPerCustomer: 2,
    ticketFields: 12,
    customerFields: 8,
  },
  large: {
    agents: 16,
    customers: 2500,
    tickets: 10000,
    messagesPerTicket: 3,
    tags: 144,
    tagsPerTicket: 5,
    tagsPerCustomer: 3,
    ticketFields: 12,
    customerFields: 8,
  },
};

const ticketFieldTemplates = [
  ['impact', 'Impact', 'list'],
  ['severity_score', 'Severity score', 'number'],
  ['refund_due', 'Refund due', 'boolean'],
  ['order_value', 'Order value', 'decimal'],
  ['shipping_date', 'Shipping date', 'date'],
  ['source_url', 'Source URL', 'url'],
  ['escalation_team', 'Escalation team', 'list'],
  ['operations_flags', 'Operations flags', 'multi_select'],
  ['risk_notes', 'Risk notes', 'text'],
  ['legacy_priority', 'Legacy priority', 'list'],
  ['customer_temperature', 'Customer temperature', 'list'],
  ['follow_up_window', 'Follow-up window', 'number'],
];

const customerFieldTemplates = [
  ['customer_tier', 'Customer tier', 'list'],
  ['lifetime_value', 'Lifetime value', 'decimal'],
  ['vip', 'VIP', 'boolean'],
  ['renewal_date', 'Renewal date', 'date'],
  ['crm_url', 'CRM URL', 'url'],
  ['support_region', 'Support region', 'list'],
  ['account_notes', 'Account notes', 'text'],
  ['old_segment', 'Old segment', 'list'],
];

const tagGroups = [
  ['Lifecycle', '#4f46e5'],
  ['Risk', '#dc2626'],
  ['Revenue', '#059669'],
  ['Product area', '#2563eb'],
  ['Region', '#7c3aed'],
  ['Channel', '#0891b2'],
  ['Compliance', '#ca8a04'],
  ['Escalation', '#e11d48'],
  ['Operations', '#475569'],
  ['Sentiment', '#16a34a'],
  ['Plan', '#9333ea'],
  ['Internal queue', '#64748b'],
];

function loadEnvFile(file) {
  if (!existsSync(file)) return;
  const contents = readFileSync(file, 'utf8');
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key] !== undefined) continue;
    process.env[key] = rawValue.replace(/^["']|["']$/g, '');
  }
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--') continue;
    if (arg === '--help' || arg === '-h') {
      out.help = true;
      continue;
    }
    if (arg === '--no-reset') {
      out.reset = false;
      continue;
    }
    if (!arg.startsWith('--')) {
      throw new Error(`Unexpected positional argument: ${arg}`);
    }
    const eq = arg.indexOf('=');
    if (eq > -1) {
      out[arg.slice(2, eq)] = arg.slice(eq + 1);
      continue;
    }
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      out[key] = 'true';
      continue;
    }
    out[key] = next;
    i++;
  }
  return out;
}

function printHelp() {
  console.log(`Seed synthetic Salve scale data.

Usage:
  pnpm db:seed:scale
  pnpm db:seed:scale -- --preset large
  pnpm db:seed:scale -- --tickets 5000 --customers 1200 --messages-per-ticket 3

Options:
  --preset small|old|large       Default: old
  --workspace-id <id>            Default: scale-demo-workspace
  --workspace-slug <slug>        Default: scale-demo
  --workspace-name <name>        Default: Scale Demo Workspace
  --owner-email <email>          Existing signed-in user to add as owner
  --no-reset                     Keep existing rows for this workspace
  --agents <n>
  --customers <n>
  --tickets <n>
  --messages-per-ticket <n>
  --tags <n>
  --tags-per-ticket <n>
  --tags-per-customer <n>
  --ticket-fields <n>
  --customer-fields <n>`);
}

function intOption(raw, fallback, { min = 0, max = 100000 } = {}) {
  if (raw === undefined) return fallback;
  const value = Number.parseInt(String(raw), 10);
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`Expected integer ${min}..${max}, got ${raw}`);
  }
  return value;
}

function boolOption(raw, fallback) {
  if (raw === undefined) return fallback;
  if (raw === true || raw === 'true') return true;
  if (raw === false || raw === 'false') return false;
  throw new Error(`Expected boolean, got ${raw}`);
}

function buildConfig(args) {
  const presetName = String(args.preset ?? 'old');
  const preset = presets[presetName];
  if (!preset) {
    throw new Error(`Unknown preset "${presetName}". Use small, old, or large.`);
  }
  return {
    preset: presetName,
    workspaceId: String(args['workspace-id'] ?? 'scale-demo-workspace'),
    workspaceSlug: String(args['workspace-slug'] ?? 'scale-demo'),
    workspaceName: String(args['workspace-name'] ?? 'Scale Demo Workspace'),
    ownerEmail: args['owner-email'] ? String(args['owner-email']) : undefined,
    reset: boolOption(args.reset, true),
    agents: intOption(args.agents, preset.agents, { min: 1, max: 1000 }),
    customers: intOption(args.customers, preset.customers, { min: 1, max: 100000 }),
    tickets: intOption(args.tickets, preset.tickets, { min: 1, max: 250000 }),
    messagesPerTicket: intOption(args['messages-per-ticket'], preset.messagesPerTicket, {
      min: 0,
      max: 20,
    }),
    tags: intOption(args.tags, preset.tags, { min: 1, max: 1000 }),
    tagsPerTicket: intOption(args['tags-per-ticket'], preset.tagsPerTicket, {
      min: 0,
      max: 20,
    }),
    tagsPerCustomer: intOption(args['tags-per-customer'], preset.tagsPerCustomer, {
      min: 0,
      max: 20,
    }),
    ticketFields: intOption(args['ticket-fields'], preset.ticketFields, {
      min: 0,
      max: ticketFieldTemplates.length,
    }),
    customerFields: intOption(args['customer-fields'], preset.customerFields, {
      min: 0,
      max: customerFieldTemplates.length,
    }),
  };
}

function buildSeedUsers(agentCount) {
  return Array.from({ length: agentCount }, (_, index) => {
    const n = index + 1;
    return {
      id: `scale-agent-${String(n).padStart(3, '0')}`,
      name: [
        'Mara Quinn',
        'Jorge Vargas',
        'Mei Tanaka',
        'Nina Patel',
        'Owen Brooks',
        'Samira Noor',
        'Theo Klein',
        'Iris Chen',
      ][index % 8],
      email: `scale-agent-${String(n).padStart(3, '0')}@scale.salve.local`,
    };
  });
}

function buildCustomFields(workspaceId, ticketFields, customerFields) {
  const toField = ([key, displayName, type], category, sortOrder) => ({
    idKey: `${workspaceId}:custom-field:${category}:${key}`,
    key,
    displayName,
    description: `Synthetic ${category} field for scale testing.`,
    category,
    type,
    sortOrder,
  });
  return [
    ...ticketFieldTemplates
      .slice(0, ticketFields)
      .map((field, index) => toField(field, 'ticket', index)),
    ...customerFieldTemplates
      .slice(0, customerFields)
      .map((field, index) => toField(field, 'customer', index)),
  ];
}

function buildViews() {
  const sort = { field: 'updatedAt', direction: 'desc' };
  return [
    {
      key: 'high-priority',
      label: 'High priority',
      scope: 'workspace',
      icon: 'flame',
      color: '#dc2626',
      query: {
        filters: [
          { field: 'status', operator: 'in', values: ['open', 'in_progress', 'snoozed'] },
          { field: 'priority', operator: 'in', values: ['high', 'urgent'] },
        ],
        matchAll: true,
      },
      sort,
      groupBy: null,
    },
    {
      key: 'snoozed',
      label: 'Snoozed',
      scope: 'workspace',
      icon: 'clock',
      color: '#7c3aed',
      query: {
        filters: [{ field: 'status', operator: 'in', values: ['snoozed'] }],
        matchAll: true,
      },
      sort,
      groupBy: null,
    },
    {
      key: 'vip-customers',
      label: 'VIP customers',
      scope: 'workspace',
      icon: 'sparkles',
      color: '#ca8a04',
      query: {
        filters: [
          { field: 'status', operator: 'in', values: ['open', 'in_progress', 'snoozed'] },
          { field: 'customField:vip', operator: 'eq', value: true },
        ],
        matchAll: true,
      },
      sort,
      groupBy: null,
    },
    {
      key: 'large-orders',
      label: 'Large orders',
      scope: 'workspace',
      icon: 'receipt',
      color: '#059669',
      query: {
        filters: [
          { field: 'status', operator: 'in', values: ['open', 'in_progress', 'snoozed'] },
          { field: 'customField:order_value', operator: 'after', value: 500 },
        ],
        matchAll: true,
      },
      sort,
      groupBy: null,
    },
    {
      key: 'personal-open',
      label: 'My open queue',
      scope: 'personal',
      icon: 'inbox',
      color: '#2563eb',
      query: { filters: [{ field: 'status', operator: 'in', values: ['open'] }], matchAll: true },
      sort,
      groupBy: null,
    },
  ];
}

async function tableCounts(sql, workspaceId) {
  const rows = await sql`
    select *
    from (
      values
        ('customers', (select count(*)::bigint from customer where workspace_id = ${workspaceId})),
        ('tickets', (select count(*)::bigint from ticket where workspace_id = ${workspaceId})),
        ('messages', (select count(*)::bigint from message where workspace_id = ${workspaceId})),
        ('ticket_tags', (select count(*)::bigint from ticket_tag where workspace_id = ${workspaceId})),
        ('customer_tags', (select count(*)::bigint from customer_tag where workspace_id = ${workspaceId})),
        ('custom_fields', (select count(*)::bigint from custom_field where workspace_id = ${workspaceId})),
        ('custom_field_values', (select count(*)::bigint from custom_field_value where workspace_id = ${workspaceId})),
        ('views', (select count(*)::bigint from view where workspace_id = ${workspaceId})),
        ('email_addresses', (select count(*)::bigint from email_address where workspace_id = ${workspaceId})),
        ('audit_events', (select count(*)::bigint from audit_event where workspace_id = ${workspaceId})),
        ('custom_events', (select count(*)::bigint from custom_event where workspace_id = ${workspaceId}))
    ) as counts(name, rows)
    order by rows desc, name;
  `;
  return rows.map((row) => ({ name: row.name, rows: Number(row.rows) }));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  loadEnvFile(resolve(packageRoot, '.env.local'));
  loadEnvFile(resolve(packageRoot, '.env'));

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is not set. Put it in packages/db/.env or export it.');
  }

  const config = buildConfig(args);
  const agentUsers = buildSeedUsers(config.agents);
  const customFields = buildCustomFields(
    config.workspaceId,
    config.ticketFields,
    config.customerFields,
  );
  const views = buildViews();
  const tagGroupRows = tagGroups.map(([label, color], index) => ({
    label,
    color,
    sortOrder: index,
  }));

  const sql = postgres(databaseUrl, { max: 1, idle_timeout: 5 });
  const startedAt = Date.now();

  try {
    let ownerUser;
    await sql.begin(async (tx) => {
      await tx.unsafe(`
        create or replace function pg_temp.seed_uuid(input text) returns uuid
        language sql immutable as $$
          select (
            substr(md5(input), 1, 8) || '-' ||
            substr(md5(input), 9, 4) || '-' ||
            substr(md5(input), 13, 4) || '-' ||
            substr(md5(input), 17, 4) || '-' ||
            substr(md5(input), 21, 12)
          )::uuid
        $$;
      `);

      if (config.reset) {
        await tx`
          delete from organization
          where id = ${config.workspaceId} or slug = ${config.workspaceSlug};
        `;
      }

      await tx`
        insert into organization (id, name, slug, metadata, "createdAt", "updatedAt")
        values (
          ${config.workspaceId},
          ${config.workspaceName},
          ${config.workspaceSlug},
          ${JSON.stringify({
            seeded: true,
            preset: config.preset,
            generatedAt: new Date().toISOString(),
          })},
          now(),
          now()
        )
        on conflict (id) do update set
          name = excluded.name,
          slug = excluded.slug,
          metadata = excluded.metadata,
          "updatedAt" = now();
      `;

      if (config.ownerEmail) {
        const rows = await tx`
          select id, email
          from "user"
          where email = ${config.ownerEmail}
          limit 1;
        `;
        if (!rows[0]) throw new Error(`No user found for --owner-email ${config.ownerEmail}`);
        ownerUser = rows[0];
      } else {
        const rows = await tx`
          select id, email
          from "user"
          where email not like '%@scale.salve.local'
          order by "createdAt" desc
          limit 1;
        `;
        ownerUser = rows[0] ?? agentUsers[0];
      }

      await tx`
        insert into "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
        select id, name, email, true, now(), now()
        from jsonb_to_recordset(${tx.json(agentUsers)})
          as x(id text, name text, email text)
        on conflict (id) do update set
          name = excluded.name,
          email = excluded.email,
          "emailVerified" = true,
          "updatedAt" = now();
      `;

      const memberRows = [
        ...new Map(
          [ownerUser, ...agentUsers].map((user, index) => [
            user.id,
            {
              id: `${config.workspaceId}:member:${user.id}`,
              organizationId: config.workspaceId,
              userId: user.id,
              role: user.id === ownerUser.id ? 'owner' : index % 4 === 0 ? 'admin' : 'member',
              kind: 'user',
            },
          ]),
        ).values(),
      ];

      await tx`
        insert into member (id, "organizationId", "userId", role, kind, "createdAt")
        select id, "organizationId", "userId", role, kind, now()
        from jsonb_to_recordset(${tx.json(memberRows)})
          as x(id text, "organizationId" text, "userId" text, role text, kind text)
        on conflict (id) do update set
          role = excluded.role,
          kind = excluded.kind;
      `;

      await tx`
        insert into channel (id, workspace_id, kind, name, is_default, config, created_at, updated_at)
        values (
          pg_temp.seed_uuid(${config.workspaceId} || ':channel:email'),
          ${config.workspaceId},
          'email',
          'Email',
          true,
          jsonb_build_object('seeded', true, 'provider', 'mailpit'),
          now(),
          now()
        )
        on conflict (id) do update set
          name = excluded.name,
          is_default = true,
          config = excluded.config,
          updated_at = now();
      `;

      await tx`
        insert into sending_domain (
          id,
          workspace_id,
          domain,
          ses_identity_arn,
          dkim_tokens,
          mail_from_subdomain,
          dns_status,
          dmarc_status,
          provision_status,
          last_verified_at,
          provider_meta,
          created_at,
          updated_at
        )
        values (
          pg_temp.seed_uuid(${config.workspaceId} || ':sending-domain'),
          ${config.workspaceId},
          'scale.salve.local',
          'arn:aws:ses:local:000000000000:identity/scale.salve.local',
          '["scale-a","scale-b","scale-c"]'::jsonb,
          'mail',
          'verified',
          'present',
          'provisioned',
          now(),
          jsonb_build_object('seeded', true),
          now(),
          now()
        )
        on conflict (id) do update set
          dns_status = excluded.dns_status,
          dmarc_status = excluded.dmarc_status,
          provision_status = excluded.provision_status,
          last_verified_at = excluded.last_verified_at,
          provider_meta = excluded.provider_meta,
          updated_at = now();
      `;

      await tx`
        insert into email_channel (
          channel_id,
          sending_domain_id,
          from_name,
          signature,
          default_priority,
          threading_prefs,
          new_ticket_after_closed_days,
          created_at,
          updated_at
        )
        values (
          pg_temp.seed_uuid(${config.workspaceId} || ':channel:email'),
          pg_temp.seed_uuid(${config.workspaceId} || ':sending-domain'),
          'Scale Support',
          '<p>Scale Support</p>',
          'normal',
          jsonb_build_object('replyTokens', true, 'bodyMarkers', true),
          14,
          now(),
          now()
        )
        on conflict (channel_id) do update set
          sending_domain_id = excluded.sending_domain_id,
          from_name = excluded.from_name,
          signature = excluded.signature,
          threading_prefs = excluded.threading_prefs,
          updated_at = now();
      `;

      await tx`
        insert into email_address (
          id,
          workspace_id,
          channel_id,
          sending_domain_id,
          local_part,
          full_address,
          can_send,
          can_receive,
          is_default,
          label,
          signature,
          created_at,
          updated_at
        )
        select
          pg_temp.seed_uuid(${config.workspaceId} || ':email-address:' || x.local_part),
          ${config.workspaceId},
          pg_temp.seed_uuid(${config.workspaceId} || ':channel:email'),
          pg_temp.seed_uuid(${config.workspaceId} || ':sending-domain'),
          x.local_part,
          x.local_part || '@scale.salve.local',
          true,
          true,
          x.local_part = 'support',
          x.label,
          '<p>Scale Support</p>',
          now(),
          now()
        from (
          values
            ('support', 'Support'),
            ('billing', 'Billing'),
            ('vip', 'VIP'),
            ('security', 'Security')
        ) as x(local_part, label)
        on conflict (id) do update set
          can_send = true,
          can_receive = true,
          is_default = excluded.is_default,
          label = excluded.label,
          updated_at = now();
      `;

      await tx`
        insert into inbound_routing_rule (
          id,
          workspace_id,
          channel_id,
          email_address_id,
          sender_pattern,
          subject_pattern,
          set_priority,
          priority,
          enabled,
          created_at,
          updated_at
        )
        select
          pg_temp.seed_uuid(${config.workspaceId} || ':routing:' || local_part),
          ${config.workspaceId},
          channel_id,
          id,
          case local_part when 'vip' then '*@enterprise.example' else null end,
          case local_part when 'security' then '%security%' when 'billing' then '%invoice%' else null end,
          case local_part when 'vip' then 'urgent'::ticket_priority when 'security' then 'high'::ticket_priority else null end,
          case local_part when 'vip' then 10 when 'security' then 20 when 'billing' then 40 else 100 end,
          true,
          now(),
          now()
        from email_address
        where workspace_id = ${config.workspaceId}
        on conflict (id) do update set
          sender_pattern = excluded.sender_pattern,
          subject_pattern = excluded.subject_pattern,
          set_priority = excluded.set_priority,
          priority = excluded.priority,
          enabled = true,
          updated_at = now();
      `;

      await tx`
        insert into tag_group (id, workspace_id, label, color, sort_order, created_at, updated_at)
        select
          pg_temp.seed_uuid(${config.workspaceId} || ':tag-group:' || sort_order::text),
          ${config.workspaceId},
          label,
          color,
          sort_order,
          now(),
          now()
        from jsonb_to_recordset(${tx.json(tagGroupRows)})
          as x(label text, color text, "sortOrder" int)
          cross join lateral (select x."sortOrder" as sort_order) normalized
        on conflict (id) do update set
          label = excluded.label,
          color = excluded.color,
          sort_order = excluded.sort_order,
          updated_at = now();
      `;

      await tx`
        insert into tag (id, workspace_id, group_id, label, color, sort_order, created_at, updated_at)
        select
          pg_temp.seed_uuid(${config.workspaceId} || ':tag:' || gs::text),
          ${config.workspaceId},
          tg.id,
          tg.label || ' ' || lpad((((gs - 1) / ${tagGroups.length}) + 1)::text, 2, '0'),
          tg.color,
          gs,
          now(),
          now()
        from generate_series(1, ${config.tags}) as gs
        join tag_group tg
          on tg.workspace_id = ${config.workspaceId}
         and tg.sort_order = ((gs - 1) % ${tagGroups.length})
        on conflict (id) do update set
          group_id = excluded.group_id,
          label = excluded.label,
          color = excluded.color,
          sort_order = excluded.sort_order,
          updated_at = now();
      `;

      await tx`
        insert into custom_field (
          id,
          workspace_id,
          key,
          display_name,
          description,
          category,
          type,
          required,
          active,
          options,
          default_value,
          sort_order,
          created_at,
          updated_at
        )
        select
          pg_temp.seed_uuid(id_key),
          ${config.workspaceId},
          key,
          "displayName",
          description,
          category::custom_field_category,
          type::custom_field_type,
          false,
          true,
          case
            when key in ('impact', 'customer_tier') then '["low","medium","high","critical"]'::jsonb
            when key in ('escalation_team') then '["support","billing","security","success"]'::jsonb
            when key in ('operations_flags') then '["backlog","blocked","fragile","needs-review"]'::jsonb
            when key in ('legacy_priority') then '["p0","p1","p2","p3"]'::jsonb
            when key in ('support_region') then '["na","emea","apac","latam"]'::jsonb
            when key in ('old_segment') then '["startup","growth","midmarket","enterprise"]'::jsonb
            when key in ('customer_temperature') then '["cold","warm","hot"]'::jsonb
            else '[]'::jsonb
          end,
          null,
          "sortOrder",
          now(),
          now()
        from jsonb_to_recordset(${tx.json(customFields)})
          as x(
            "idKey" text,
            key text,
            "displayName" text,
            description text,
            category text,
            type text,
            "sortOrder" int
          )
          cross join lateral (select x."idKey" as id_key) normalized
        on conflict (id) do update set
          display_name = excluded.display_name,
          description = excluded.description,
          type = excluded.type,
          options = excluded.options,
          active = true,
          sort_order = excluded.sort_order,
          updated_at = now();
      `;

      await tx`
        insert into customer (
          id,
          workspace_id,
          email,
          name,
          alternate_emails,
          display_name,
          avatar_url,
          first_seen_at,
          last_seen_at,
          phone,
          location,
          metadata,
          created_at,
          updated_at
        )
        select
          pg_temp.seed_uuid(${config.workspaceId} || ':customer:' || gs::text),
          ${config.workspaceId},
          'customer-' || lpad(gs::text, 6, '0') || '@scale.example.test',
          first_name || ' ' || last_name,
          jsonb_build_array('customer-' || lpad(gs::text, 6, '0') || '+billing@scale.example.test'),
          first_name || ' ' || last_name,
          'https://api.dicebear.com/9.x/initials/svg?seed=' || first_name || '-' || last_name,
          created_at - ((gs % 30) * interval '1 day'),
          updated_at,
          '+1-555-' || lpad((1000 + (gs % 9000))::text, 4, '0'),
          (array['Austin, TX','Berlin, DE','Bengaluru, IN','London, UK','Toronto, CA','Singapore','Sao Paulo, BR','Sydney, AU'])[((gs - 1) % 8) + 1],
          jsonb_build_object(
            'seeded', true,
            'company', (array['Acme','Nimbus','Helix','Northstar','Canopy','Brightline','Orbit','Pioneer'])[((gs - 1) % 8) + 1],
            'plan', (array['starter','growth','business','enterprise'])[((gs - 1) % 4) + 1],
            'mrr', 99 + (gs % 9000),
            'accountHealth', (array['green','yellow','red'])[((gs - 1) % 3) + 1]
          ),
          created_at,
          updated_at
        from generate_series(1, ${config.customers}) as gs
        cross join lateral (
          select
            (array['Mara','Jorge','Mei','Nina','Owen','Samira','Theo','Iris','Ari','Leah','Noor','Vik'])[((gs - 1) % 12) + 1] as first_name,
            (array['Quinn','Vargas','Tanaka','Patel','Brooks','Noor','Klein','Chen','Singh','Morgan','Rossi','Park'])[((gs - 1) % 12) + 1] as last_name,
            now() - ((gs % 180) * interval '1 day') as created_at,
            now() - ((gs % 20) * interval '1 hour') as updated_at
        ) names
        on conflict (workspace_id, email) do nothing;
      `;

      await tx`
        insert into ticket (
          id,
          workspace_id,
          short_id,
          title,
          description,
          status,
          priority,
          customer_id,
          assignee_id,
          created_by_id,
          created_at,
          updated_at,
          first_response_at,
          resolved_at,
          resolved_by_id,
          closed_at,
          closed_by_id
        )
        select
          pg_temp.seed_uuid(${config.workspaceId} || ':ticket:' || gs::text),
          ${config.workspaceId},
          gs,
          subject || ' #' || gs::text,
          'Synthetic scale ticket covering ' || lower(product_area) || ', ' || lower(reason) || ', and ' || lower(urgency) || '.',
          status,
          priority,
          pg_temp.seed_uuid(${config.workspaceId} || ':customer:' || (((gs - 1) % ${config.customers}) + 1)::text),
          case when gs % 5 = 0 then null else 'scale-agent-' || lpad((((gs - 1) % ${config.agents}) + 1)::text, 3, '0') end,
          'scale-agent-' || lpad((((gs + 2) % ${config.agents}) + 1)::text, 3, '0'),
          created_at,
          updated_at,
          case when gs % 3 <> 0 then created_at + ((gs % 8) * interval '1 hour') else null end,
          case when status in ('resolved', 'closed') then updated_at - interval '2 hours' else null end,
          case when status in ('resolved', 'closed') then 'scale-agent-' || lpad((((gs + 3) % ${config.agents}) + 1)::text, 3, '0') else null end,
          case when status = 'closed' then updated_at - interval '1 hour' else null end,
          case when status = 'closed' then 'scale-agent-' || lpad((((gs + 4) % ${config.agents}) + 1)::text, 3, '0') else null end
        from generate_series(1, ${config.tickets}) as gs
        cross join lateral (
          select
            case
              when gs % 100 < 84 then 'open'::ticket_status
              when gs % 100 < 89 then 'in_progress'::ticket_status
              when gs % 100 < 93 then 'snoozed'::ticket_status
              when gs % 100 < 98 then 'resolved'::ticket_status
              else 'closed'::ticket_status
            end as status,
            case
              when gs % 100 < 55 then 'normal'::ticket_priority
              when gs % 100 < 75 then 'high'::ticket_priority
              when gs % 100 < 88 then 'low'::ticket_priority
              else 'urgent'::ticket_priority
            end as priority,
            (array['Checkout failure','Invoice mismatch','Cannot reset password','Webhook delay','Unexpected email threading','Mobile inbox issue','SLA breach risk','Search result missing','Attachment upload failed','Customer profile drift'])[((gs - 1) % 10) + 1] as subject,
            (array['Billing','Authentication','Inbox','Search','Email delivery','Mobile','Reporting','Settings'])[((gs - 1) % 8) + 1] as product_area,
            (array['regression','configuration drift','provider latency','customer confusion','workflow gap'])[((gs - 1) % 5) + 1] as reason,
            (array['routine triage','executive escalation','launch blocker','follow-up needed'])[((gs - 1) % 4) + 1] as urgency,
            now() - ((gs % 120) * interval '1 day') - ((gs % 24) * interval '1 hour') as created_at,
            now() - ((gs % 14) * interval '1 hour') as updated_at
        ) data
        on conflict (id) do update set
          title = excluded.title,
          description = excluded.description,
          status = excluded.status,
          priority = excluded.priority,
          customer_id = excluded.customer_id,
          assignee_id = excluded.assignee_id,
          updated_at = excluded.updated_at;
      `;

      if (config.messagesPerTicket > 0) {
        await tx`
          insert into message (
            id,
            workspace_id,
            ticket_id,
            author_type,
            author_user_id,
            author_customer_id,
            body_html,
            body_text,
            is_internal,
            created_at,
            updated_at
          )
          select
            pg_temp.seed_uuid(${config.workspaceId} || ':message:' || ticket_no::text || ':' || msg_no::text),
            ${config.workspaceId},
            t.id,
            case
              when msg_no % 6 = 0 then 'system'::message_author_type
              when msg_no % 2 = 0 then 'agent'::message_author_type
              else 'customer'::message_author_type
            end,
            case when msg_no % 2 = 0 and msg_no % 6 <> 0 then 'scale-agent-' || lpad((((ticket_no + msg_no) % ${config.agents}) + 1)::text, 3, '0') else null end,
            case when msg_no % 2 = 1 then t.customer_id else null end,
            '<p>' || body_text || '</p>',
            body_text,
            msg_no % 5 = 0,
            t.created_at + (msg_no * interval '45 minutes'),
            t.created_at + (msg_no * interval '45 minutes')
          from generate_series(1, ${config.tickets}) as ticket_no
          cross join generate_series(1, ${config.messagesPerTicket}) as msg_no
          join ticket t
            on t.id = pg_temp.seed_uuid(${config.workspaceId} || ':ticket:' || ticket_no::text)
          cross join lateral (
            select case
              when msg_no = 1 then 'Customer reported: ' || t.title || '. Impact is visible to a subset of users.'
              when msg_no % 6 = 0 then 'System note: automation evaluated routing and SLA metadata.'
              when msg_no % 5 = 0 then 'Internal note: reviewing account history and recent events before replying.'
              else 'Agent response: we are checking logs, related tickets, and provider status for this issue.'
            end as body_text
          ) body
          on conflict (id) do update set
            body_html = excluded.body_html,
            body_text = excluded.body_text,
            updated_at = excluded.updated_at;
        `;

        await tx`
          insert into outbound_message (
            id,
            workspace_id,
            channel_id,
            email_address_id,
            ticket_id,
            message_id,
            provider_message_id,
            status,
            sent_at,
            delivered_at,
            provider_meta,
            created_at,
            updated_at
          )
          select
            pg_temp.seed_uuid(${config.workspaceId} || ':outbound:' || ticket_no::text || ':' || msg_no::text),
            ${config.workspaceId},
            pg_temp.seed_uuid(${config.workspaceId} || ':channel:email'),
            pg_temp.seed_uuid(${config.workspaceId} || ':email-address:support'),
            t.id,
            m.id,
            'seed-' || ticket_no::text || '-' || msg_no::text || '@scale.salve.local',
            case when ticket_no % 40 = 0 then 'bounced'::outbound_message_status else 'delivered'::outbound_message_status end,
            m.created_at + interval '1 minute',
            case when ticket_no % 40 = 0 then null else m.created_at + interval '3 minutes' end,
            jsonb_build_object('seeded', true, 'provider', 'mailpit'),
            m.created_at,
            m.updated_at
          from generate_series(1, ${config.tickets}) as ticket_no
          cross join generate_series(1, ${config.messagesPerTicket}) as msg_no
          join ticket t
            on t.id = pg_temp.seed_uuid(${config.workspaceId} || ':ticket:' || ticket_no::text)
          join message m
            on m.id = pg_temp.seed_uuid(${config.workspaceId} || ':message:' || ticket_no::text || ':' || msg_no::text)
          where m.author_type = 'agent' and m.is_internal = false
          on conflict (id) do update set
            status = excluded.status,
            sent_at = excluded.sent_at,
            delivered_at = excluded.delivered_at,
            provider_meta = excluded.provider_meta,
            updated_at = excluded.updated_at;
        `;

        await tx`
          insert into attachment (
            id,
            workspace_id,
            message_id,
            s3_key,
            filename,
            mime_type,
            size_bytes,
            created_at
          )
          select
            pg_temp.seed_uuid(${config.workspaceId} || ':attachment:' || ticket_no::text),
            ${config.workspaceId},
            pg_temp.seed_uuid(${config.workspaceId} || ':message:' || ticket_no::text || ':1'),
            'seed/scale/' || ticket_no::text || '/diagnostic.txt',
            'diagnostic-' || ticket_no::text || '.txt',
            'text/plain',
            1024 + ticket_no,
            now()
          from generate_series(1, ${config.tickets}) as ticket_no
          where ticket_no % 25 = 0
          on conflict (id) do nothing;
        `;
      }

      if (config.tagsPerTicket > 0) {
        await tx`
          insert into ticket_tag (ticket_id, tag_id, workspace_id, added_at, added_by_id)
          select
            pg_temp.seed_uuid(${config.workspaceId} || ':ticket:' || ticket_no::text),
            pg_temp.seed_uuid(${config.workspaceId} || ':tag:' || (((ticket_no + offset_no * 17 - 1) % ${config.tags}) + 1)::text),
            ${config.workspaceId},
            now() - ((ticket_no % 30) * interval '1 day'),
            'scale-agent-' || lpad((((ticket_no + offset_no) % ${config.agents}) + 1)::text, 3, '0')
          from generate_series(1, ${config.tickets}) as ticket_no
          cross join generate_series(0, ${config.tagsPerTicket - 1}) as offset_no
          on conflict do nothing;
        `;
      }

      if (config.tagsPerCustomer > 0) {
        await tx`
          insert into customer_tag (customer_id, tag_id, workspace_id, added_at, added_by_id)
          select
            pg_temp.seed_uuid(${config.workspaceId} || ':customer:' || customer_no::text),
            pg_temp.seed_uuid(${config.workspaceId} || ':tag:' || (((customer_no + offset_no * 23 - 1) % ${config.tags}) + 1)::text),
            ${config.workspaceId},
            now() - ((customer_no % 60) * interval '1 day'),
            'scale-agent-' || lpad((((customer_no + offset_no) % ${config.agents}) + 1)::text, 3, '0')
          from generate_series(1, ${config.customers}) as customer_no
          cross join generate_series(0, ${config.tagsPerCustomer - 1}) as offset_no
          on conflict do nothing;
        `;
      }

      await tx`
        insert into custom_field_value (
          id,
          field_id,
          workspace_id,
          ticket_id,
          customer_id,
          value,
          updated_by_id,
          created_at,
          updated_at
        )
        select
          pg_temp.seed_uuid(${config.workspaceId} || ':ticket-field-value:' || ticket_no::text || ':' || cf.key),
          cf.id,
          ${config.workspaceId},
          t.id,
          null,
          case cf.key
            when 'impact' then to_jsonb((array['low','medium','high','critical'])[((ticket_no - 1) % 4) + 1])
            when 'severity_score' then to_jsonb(((ticket_no % 10) + 1))
            when 'refund_due' then to_jsonb(ticket_no % 13 = 0)
            when 'order_value' then to_jsonb(round((49.99 + (ticket_no % 900))::numeric, 2))
            when 'shipping_date' then to_jsonb((current_date + ((ticket_no % 21) * interval '1 day'))::text)
            when 'source_url' then to_jsonb('https://scale.example.test/orders/' || ticket_no::text)
            when 'escalation_team' then to_jsonb((array['support','billing','security','success'])[((ticket_no - 1) % 4) + 1])
            when 'operations_flags' then jsonb_build_array((array['backlog','blocked','fragile','needs-review'])[((ticket_no - 1) % 4) + 1])
            when 'legacy_priority' then to_jsonb((array['p0','p1','p2','p3'])[((ticket_no - 1) % 4) + 1])
            when 'customer_temperature' then to_jsonb((array['cold','warm','hot'])[((ticket_no - 1) % 3) + 1])
            when 'follow_up_window' then to_jsonb(((ticket_no % 7) + 1))
            else to_jsonb('Risk review note ' || ticket_no::text)
          end,
          'scale-agent-' || lpad((((ticket_no + 1) % ${config.agents}) + 1)::text, 3, '0'),
          now(),
          now()
        from generate_series(1, ${config.tickets}) as ticket_no
        join ticket t
          on t.id = pg_temp.seed_uuid(${config.workspaceId} || ':ticket:' || ticket_no::text)
        join custom_field cf
          on cf.workspace_id = ${config.workspaceId}
         and cf.category = 'ticket'
        on conflict (field_id, ticket_id) do update set
          value = excluded.value,
          updated_by_id = excluded.updated_by_id,
          updated_at = now();
      `;

      await tx`
        insert into custom_field_value (
          id,
          field_id,
          workspace_id,
          ticket_id,
          customer_id,
          value,
          updated_by_id,
          created_at,
          updated_at
        )
        select
          pg_temp.seed_uuid(${config.workspaceId} || ':customer-field-value:' || customer_no::text || ':' || cf.key),
          cf.id,
          ${config.workspaceId},
          null,
          c.id,
          case cf.key
            when 'customer_tier' then to_jsonb((array['low','medium','high','critical'])[((customer_no - 1) % 4) + 1])
            when 'lifetime_value' then to_jsonb(round((500 + (customer_no % 50000))::numeric, 2))
            when 'vip' then to_jsonb(customer_no % 11 = 0)
            when 'renewal_date' then to_jsonb((current_date + ((customer_no % 365) * interval '1 day'))::text)
            when 'crm_url' then to_jsonb('https://crm.scale.example.test/accounts/' || customer_no::text)
            when 'support_region' then to_jsonb((array['na','emea','apac','latam'])[((customer_no - 1) % 4) + 1])
            when 'old_segment' then to_jsonb((array['startup','growth','midmarket','enterprise'])[((customer_no - 1) % 4) + 1])
            else to_jsonb('Synthetic account note ' || customer_no::text)
          end,
          'scale-agent-' || lpad((((customer_no + 2) % ${config.agents}) + 1)::text, 3, '0'),
          now(),
          now()
        from generate_series(1, ${config.customers}) as customer_no
        join customer c
          on c.id = pg_temp.seed_uuid(${config.workspaceId} || ':customer:' || customer_no::text)
        join custom_field cf
          on cf.workspace_id = ${config.workspaceId}
         and cf.category = 'customer'
        on conflict (field_id, customer_id) do update set
          value = excluded.value,
          updated_by_id = excluded.updated_by_id,
          updated_at = now();
      `;

      await tx`
        insert into customer_note (
          id,
          workspace_id,
          object_type,
          object_id,
          customer_id,
          body_html,
          body_text,
          pinned,
          created_by_id,
          created_at,
          updated_at
        )
        select
          pg_temp.seed_uuid(${config.workspaceId} || ':customer-note:' || customer_no::text),
          ${config.workspaceId},
          'customer',
          c.id,
          c.id,
          '<p>Seed note for account health, plan, and escalation context.</p>',
          'Seed note for account health, plan, and escalation context.',
          customer_no % 40 = 0,
          'scale-agent-' || lpad((((customer_no + 3) % ${config.agents}) + 1)::text, 3, '0'),
          now() - ((customer_no % 90) * interval '1 day'),
          now()
        from generate_series(1, ${config.customers}) as customer_no
        join customer c
          on c.id = pg_temp.seed_uuid(${config.workspaceId} || ':customer:' || customer_no::text)
        where customer_no % 8 = 0
        on conflict (id) do update set
          body_html = excluded.body_html,
          body_text = excluded.body_text,
          pinned = excluded.pinned,
          updated_at = now();
      `;

      await tx`
        insert into custom_event (
          id,
          workspace_id,
          customer_id,
          event_name,
          properties,
          source,
          occurred_at,
          ingested_at,
          idempotency_key
        )
        select
          pg_temp.seed_uuid(${config.workspaceId} || ':custom-event:' || customer_no::text || ':' || event_no::text),
          ${config.workspaceId},
          c.id,
          (array['plan.changed','invoice.paid','user.invited','feature.used'])[((customer_no + event_no - 1) % 4) + 1],
          jsonb_build_object('seeded', true, 'sequence', event_no, 'score', (customer_no * event_no) % 100),
          'seed',
          now() - ((customer_no % 120) * interval '1 day') - (event_no * interval '2 hours'),
          now(),
          'seed:' || ${config.workspaceId} || ':' || customer_no::text || ':' || event_no::text
        from generate_series(1, ${config.customers}) as customer_no
        cross join generate_series(1, 2) as event_no
        join customer c
          on c.id = pg_temp.seed_uuid(${config.workspaceId} || ':customer:' || customer_no::text)
        where customer_no % 3 = 0
        on conflict (id) do update set
          event_name = excluded.event_name,
          properties = excluded.properties,
          occurred_at = excluded.occurred_at,
          ingested_at = excluded.ingested_at;
      `;

      await tx`
        insert into audit_event (
          id,
          workspace_id,
          ticket_id,
          customer_id,
          actor_id,
          actor_kind,
          kind,
          payload,
          created_at
        )
        select
          pg_temp.seed_uuid(${config.workspaceId} || ':audit:ticket-created:' || ticket_no::text),
          ${config.workspaceId},
          t.id,
          t.customer_id,
          t.created_by_id,
          'user',
          'ticket.created',
          jsonb_build_object('seeded', true, 'shortId', t.short_id),
          t.created_at
        from generate_series(1, ${config.tickets}) as ticket_no
        join ticket t
          on t.id = pg_temp.seed_uuid(${config.workspaceId} || ':ticket:' || ticket_no::text)
        on conflict (id) do update set
          payload = excluded.payload,
          created_at = excluded.created_at;
      `;

      await tx`
        insert into audit_event (
          id,
          workspace_id,
          ticket_id,
          customer_id,
          actor_id,
          actor_kind,
          kind,
          payload,
          created_at
        )
        select
          pg_temp.seed_uuid(${config.workspaceId} || ':audit:status:' || ticket_no::text),
          ${config.workspaceId},
          t.id,
          t.customer_id,
          t.assignee_id,
          'user',
          'ticket.status_changed',
          jsonb_build_object('seeded', true, 'status', t.status),
          t.updated_at
        from generate_series(1, ${config.tickets}) as ticket_no
        join ticket t
          on t.id = pg_temp.seed_uuid(${config.workspaceId} || ':ticket:' || ticket_no::text)
        where t.status in ('resolved', 'closed')
        on conflict (id) do update set
          payload = excluded.payload,
          created_at = excluded.created_at;
      `;

      await tx`
        insert into view (
          id,
          workspace_id,
          kind,
          scope,
          owner_id,
          label,
          description,
          icon,
          color,
          query,
          sort,
          group_by,
          display_props,
          created_at,
          updated_at
        )
        select
          pg_temp.seed_uuid(${config.workspaceId} || ':view:' || key),
          ${config.workspaceId},
          'inbox',
          scope::view_scope,
          case when scope = 'personal' then ${ownerUser.id} else null end,
          label,
          'Synthetic saved view for scale validation.',
          icon,
          color,
          query,
          sort,
          "groupBy",
          jsonb_build_object('density', 'compact', 'seeded', true),
          now(),
          now()
        from jsonb_to_recordset(${tx.json(views)})
          as x(
            key text,
            label text,
            scope text,
            icon text,
            color text,
            query jsonb,
            sort jsonb,
            "groupBy" text
          )
        on conflict (id) do update set
          label = excluded.label,
          description = excluded.description,
          query = excluded.query,
          sort = excluded.sort,
          display_props = excluded.display_props,
          updated_at = now();
      `;

      await tx`
        insert into view_member (view_id, user_id, workspace_id, position, created_at, updated_at)
        select v.id, m."userId", ${config.workspaceId}, row_number() over (partition by m."userId" order by v.label), now(), now()
        from view v
        join member m on m."organizationId" = ${config.workspaceId}
        where v.workspace_id = ${config.workspaceId}
        on conflict (view_id, user_id) do update set
          position = excluded.position,
          updated_at = now();
      `;

      await tx`
        insert into builtin_view_member (builtin_key, user_id, workspace_id, position, created_at, updated_at)
        select x.key, m."userId", ${config.workspaceId}, x.position, now(), now()
        from member m
        cross join (
          values
            ('all', 0),
            ('unassigned', 1),
            ('mine', 2),
            ('resolved', 3)
        ) as x(key, position)
        where m."organizationId" = ${config.workspaceId}
        on conflict (builtin_key, user_id, workspace_id) do update set
          position = excluded.position,
          updated_at = now();
      `;

      await tx`
        insert into inbound_message_raw (
          id,
          workspace_id,
          channel_id,
          provider_message_id,
          raw_blob_s3_key,
          raw_blob_size_bytes,
          received_at,
          processed_at,
          processed_ticket_id,
          processed_message_id,
          headers,
          envelope_to,
          destination_address,
          sender_address,
          subject,
          authentication_results,
          provider_meta
        )
        select
          pg_temp.seed_uuid(${config.workspaceId} || ':inbound:' || ticket_no::text),
          ${config.workspaceId},
          pg_temp.seed_uuid(${config.workspaceId} || ':channel:email'),
          'seed-inbound-' || ticket_no::text || '@scale.salve.local',
          'seed/raw/' || ticket_no::text || '.eml',
          4096 + ticket_no,
          t.created_at,
          t.created_at + interval '2 minutes',
          t.id,
          case when ${config.messagesPerTicket} > 0 then pg_temp.seed_uuid(${config.workspaceId} || ':message:' || ticket_no::text || ':1') else null end,
          jsonb_build_object('message-id', '<seed-inbound-' || ticket_no::text || '@scale.salve.local>'),
          'support@scale.salve.local',
          'support@scale.salve.local',
          c.email,
          t.title,
          jsonb_build_object('spf', 'pass', 'dkim', 'pass'),
          jsonb_build_object('seeded', true)
        from generate_series(1, ${config.tickets}) as ticket_no
        join ticket t
          on t.id = pg_temp.seed_uuid(${config.workspaceId} || ':ticket:' || ticket_no::text)
        join customer c on c.id = t.customer_id
        where ticket_no % 20 = 0
        on conflict (workspace_id, provider_message_id) do update set
          processed_at = excluded.processed_at,
          processed_ticket_id = excluded.processed_ticket_id,
          processed_message_id = excluded.processed_message_id,
          provider_meta = excluded.provider_meta;
      `;
    });

    const counts = await tableCounts(sql, config.workspaceId);
    const elapsedSeconds = ((Date.now() - startedAt) / 1000).toFixed(1);
    console.log(`Seeded ${config.workspaceName} (${config.workspaceSlug}) in ${elapsedSeconds}s`);
    console.log(`Workspace ID: ${config.workspaceId}`);
    console.log(`Owner member: ${ownerUser.email ?? ownerUser.id}`);
    for (const row of counts) {
      console.log(`${row.name.padEnd(20)} ${row.rows}`);
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
