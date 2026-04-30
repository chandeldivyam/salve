// @opendesk/zero-schema — Zero schema mirroring the Drizzle source-of-truth in
// `packages/db/src/schema`. Auth mirrors expose only UI-safe columns.

import {
  boolean,
  createBuilder,
  createSchema,
  enumeration,
  json,
  number,
  type Row,
  relationships,
  string,
  table,
} from '@rocicorp/zero';

// ---------- Auth tables

const user = table('user')
  .columns({
    id: string(),
    name: string(),
    email: string(),
    image: string().optional(),
  })
  .primaryKey('id');

const organization = table('organization')
  .columns({
    id: string(),
    name: string(),
    slug: string(),
  })
  .primaryKey('id');

const member = table('member')
  .columns({
    id: string(),
    userId: string(),
    organizationId: string(),
    role: string(),
  })
  .primaryKey('id');

// ---------- Domain tables

const customer = table('customer')
  .columns({
    id: string(),
    workspaceID: string().from('workspace_id'),
    email: string(),
    name: string().optional(),
    alternateEmails: json<string[]>().from('alternate_emails').optional(),
    displayName: string().from('display_name').optional(),
    avatarUrl: string().from('avatar_url').optional(),
    createdAt: number().from('created_at'),
    updatedAt: number().from('updated_at'),
  })
  .primaryKey('id');

const ticket = table('ticket')
  .columns({
    id: string(),
    workspaceID: string().from('workspace_id'),
    shortID: number().from('short_id'),
    title: string(),
    description: string().optional(),
    status: enumeration<'open' | 'in_progress' | 'snoozed' | 'resolved' | 'closed'>(),
    priority: enumeration<'low' | 'normal' | 'high' | 'urgent'>(),
    customerID: string().from('customer_id').optional(),
    assigneeID: string().from('assignee_id').optional(),
    createdByID: string().from('created_by_id').optional(),
    closedByID: string().from('closed_by_id').optional(),
    createdAt: number().from('created_at'),
    updatedAt: number().from('updated_at'),
    firstResponseAt: number().from('first_response_at').optional(),
    resolvedAt: number().from('resolved_at').optional(),
    closedAt: number().from('closed_at').optional(),
  })
  .primaryKey('id');

const message = table('message')
  .columns({
    id: string(),
    workspaceID: string().from('workspace_id'),
    ticketID: string().from('ticket_id'),
    authorType: enumeration<'customer' | 'agent' | 'system'>().from('author_type'),
    authorUserID: string().from('author_user_id').optional(),
    authorCustomerID: string().from('author_customer_id').optional(),
    bodyHtml: string().from('body_html'),
    bodyText: string().from('body_text'),
    isInternal: boolean().from('is_internal'),
    createdAt: number().from('created_at'),
  })
  .primaryKey('id');

const attachment = table('attachment')
  .columns({
    id: string(),
    workspaceID: string().from('workspace_id'),
    messageID: string().from('message_id'),
    s3Key: string().from('s3_key'),
    filename: string(),
    mimeType: string().from('mime_type'),
    sizeBytes: number().from('size_bytes'),
    createdAt: number().from('created_at'),
  })
  .primaryKey('id');

const auditEvent = table('auditEvent')
  .from('audit_event')
  .columns({
    id: string(),
    workspaceID: string().from('workspace_id'),
    ticketID: string().from('ticket_id').optional(),
    customerID: string().from('customer_id').optional(),
    actorID: string().from('actor_id').optional(),
    kind: string(),
    payload: json().optional(),
    createdAt: number().from('created_at'),
  })
  .primaryKey('id');

// ---------- Tags and custom fields

const tagGroup = table('tagGroup')
  .from('tag_group')
  .columns({
    id: string(),
    workspaceID: string().from('workspace_id'),
    label: string(),
    color: string(),
    sortOrder: number().from('sort_order'),
    archivedAt: number().from('archived_at').optional(),
    createdAt: number().from('created_at'),
    updatedAt: number().from('updated_at'),
  })
  .primaryKey('id');

const tag = table('tag')
  .columns({
    id: string(),
    workspaceID: string().from('workspace_id'),
    groupID: string().from('group_id').optional(),
    label: string(),
    color: string().optional(),
    sortOrder: number().from('sort_order'),
    archivedAt: number().from('archived_at').optional(),
    createdAt: number().from('created_at'),
    updatedAt: number().from('updated_at'),
  })
  .primaryKey('id');

const ticketTag = table('ticketTag')
  .from('ticket_tag')
  .columns({
    ticketID: string().from('ticket_id'),
    tagID: string().from('tag_id'),
    workspaceID: string().from('workspace_id'),
    addedAt: number().from('added_at'),
    addedByID: string().from('added_by_id').optional(),
  })
  .primaryKey('ticketID', 'tagID');

const customerTag = table('customerTag')
  .from('customer_tag')
  .columns({
    customerID: string().from('customer_id'),
    tagID: string().from('tag_id'),
    workspaceID: string().from('workspace_id'),
    addedAt: number().from('added_at'),
    addedByID: string().from('added_by_id').optional(),
  })
  .primaryKey('customerID', 'tagID');

export type CustomFieldCategory = 'ticket' | 'customer';
export type CustomFieldType =
  | 'text'
  | 'number'
  | 'decimal'
  | 'boolean'
  | 'date'
  | 'list'
  | 'multi_select'
  | 'agent'
  | 'customer'
  | 'ticket'
  | 'url'
  | 'address'
  | 'dynamic_list'
  | 'dynamic_multi_select';
export type CustomFieldEditableBy = 'api' | 'admin' | 'agent' | 'sdk';

const customField = table('customField')
  .from('custom_field')
  .columns({
    id: string(),
    workspaceID: string().from('workspace_id'),
    key: string(),
    displayName: string().from('display_name'),
    description: string().optional(),
    category: enumeration<CustomFieldCategory>(),
    type: enumeration<CustomFieldType>(),
    required: boolean(),
    active: boolean(),
    options: json<string[]>(),
    dynamicConfig: json().from('dynamic_config').optional(),
    defaultValue: json().from('default_value').optional(),
    rules: json().optional(),
    dependsOn: json<string[]>().from('depends_on'),
    editableBy: json<CustomFieldEditableBy[]>().from('editable_by'),
    sortOrder: number().from('sort_order'),
    createdAt: number().from('created_at'),
    updatedAt: number().from('updated_at'),
  })
  .primaryKey('id');

const customFieldValue = table('customFieldValue')
  .from('custom_field_value')
  .columns({
    id: string(),
    fieldID: string().from('field_id'),
    workspaceID: string().from('workspace_id'),
    ticketID: string().from('ticket_id').optional(),
    customerID: string().from('customer_id').optional(),
    value: json().optional(),
    updatedByID: string().from('updated_by_id').optional(),
    createdAt: number().from('created_at'),
    updatedAt: number().from('updated_at'),
  })
  .primaryKey('id');

// ---------- Polymorphic delivery tables

const channel = table('channel')
  .columns({
    id: string(),
    workspaceID: string().from('workspace_id'),
    kind: enumeration<
      'email' | 'chat' | 'whatsapp' | 'sms' | 'instagram' | 'facebook' | 'api_webhook'
    >(),
    name: string(),
    isDefault: boolean().from('is_default'),
    config: json(),
    deletedAt: number().from('deleted_at').optional(),
    createdAt: number().from('created_at'),
    updatedAt: number().from('updated_at'),
  })
  .primaryKey('id');

const sendingDomain = table('sendingDomain')
  .from('sending_domain')
  .columns({
    id: string(),
    workspaceID: string().from('workspace_id'),
    domain: string(),
    sesIdentityArn: string().from('ses_identity_arn').optional(),
    dkimTokens: json<Array<{ name: string; value: string }>>().from('dkim_tokens').optional(),
    mailFromSubdomain: string().from('mail_from_subdomain'),
    dnsStatus: enumeration<'pending' | 'verified' | 'failed' | 'suspended'>().from('dns_status'),
    dmarcStatus: enumeration<'pending' | 'present' | 'missing' | 'failing'>().from('dmarc_status'),
    lastVerifiedAt: number().from('last_verified_at').optional(),
    suspendedAt: number().from('suspended_at').optional(),
    suspendedReason: string().from('suspended_reason').optional(),
    providerMeta: json().from('provider_meta'),
    createdAt: number().from('created_at'),
    updatedAt: number().from('updated_at'),
  })
  .primaryKey('id');

const emailChannel = table('emailChannel')
  .from('email_channel')
  .columns({
    channelID: string().from('channel_id'),
    sendingDomainID: string().from('sending_domain_id').optional(),
    fromName: string().from('from_name').optional(),
    signature: string().optional(),
    defaultPriority: enumeration<'low' | 'normal' | 'high' | 'urgent'>().from('default_priority'),
    threadingPrefs: json().from('threading_prefs'),
    newTicketAfterClosedDays: number().from('new_ticket_after_closed_days'),
    createdAt: number().from('created_at'),
    updatedAt: number().from('updated_at'),
  })
  .primaryKey('channelID');

const emailAddress = table('emailAddress')
  .from('email_address')
  .columns({
    id: string(),
    workspaceID: string().from('workspace_id'),
    channelID: string().from('channel_id'),
    sendingDomainID: string().from('sending_domain_id'),
    localPart: string().from('local_part'),
    fullAddress: string().from('full_address'),
    canSend: boolean().from('can_send'),
    canReceive: boolean().from('can_receive'),
    isDefault: boolean().from('is_default'),
    defaultTeamID: string().from('default_team_id').optional(),
    signature: string().optional(),
    label: string().optional(),
    deletedAt: number().from('deleted_at').optional(),
    createdAt: number().from('created_at'),
    updatedAt: number().from('updated_at'),
  })
  .primaryKey('id');

const outboundMessage = table('outboundMessage')
  .from('outbound_message')
  .columns({
    id: string(),
    workspaceID: string().from('workspace_id'),
    channelID: string().from('channel_id'),
    emailAddressID: string().from('email_address_id').optional(),
    ticketID: string().from('ticket_id'),
    messageID: string().from('message_id'),
    providerMessageID: string().from('provider_message_id').optional(),
    status: enumeration<
      | 'queued'
      | 'sending'
      | 'sent'
      | 'delivered'
      | 'bounced'
      | 'complained'
      | 'suppressed'
      | 'failed'
    >(),
    error: string().optional(),
    sentAt: number().from('sent_at').optional(),
    deliveredAt: number().from('delivered_at').optional(),
    providerMeta: json().from('provider_meta'),
    createdAt: number().from('created_at'),
    updatedAt: number().from('updated_at'),
  })
  .primaryKey('id');

const inboundMessageRaw = table('inboundMessageRaw')
  .from('inbound_message_raw')
  .columns({
    id: string(),
    workspaceID: string().from('workspace_id'),
    channelID: string().from('channel_id'),
    providerMessageID: string().from('provider_message_id'),
    rawBlobS3Key: string().from('raw_blob_s3_key'),
    rawBlobSizeBytes: number().from('raw_blob_size_bytes').optional(),
    receivedAt: number().from('received_at'),
    processedAt: number().from('processed_at').optional(),
    processedTicketID: string().from('processed_ticket_id').optional(),
    processedMessageID: string().from('processed_message_id').optional(),
    parseError: string().from('parse_error').optional(),
    skipReason: string().from('skip_reason').optional(),
    headers: json(),
    envelopeTo: string().from('envelope_to').optional(),
    destinationAddress: string().from('destination_address').optional(),
    senderAddress: string().from('sender_address').optional(),
    subject: string().optional(),
    authenticationResults: json().from('authentication_results'),
    providerMeta: json().from('provider_meta'),
  })
  .primaryKey('id');

const inboundRoutingRule = table('inboundRoutingRule')
  .from('inbound_routing_rule')
  .columns({
    id: string(),
    workspaceID: string().from('workspace_id'),
    channelID: string().from('channel_id'),
    emailAddressID: string().from('email_address_id').optional(),
    senderPattern: string().from('sender_pattern').optional(),
    subjectPattern: string().from('subject_pattern').optional(),
    assignTeamID: string().from('assign_team_id').optional(),
    assignAgentID: string().from('assign_agent_id').optional(),
    setPriority: enumeration<'low' | 'normal' | 'high' | 'urgent'>()
      .from('set_priority')
      .optional(),
    priority: number(),
    enabled: boolean(),
    createdAt: number().from('created_at'),
    updatedAt: number().from('updated_at'),
  })
  .primaryKey('id');

const suppression = table('suppression')
  .columns({
    id: string(),
    workspaceID: string().from('workspace_id'),
    channelID: string().from('channel_id').optional(),
    target: string(),
    reason: enumeration<'hard_bounce' | 'complaint' | 'manual' | 'unsubscribe'>(),
    providerMeta: json().from('provider_meta'),
    createdAt: number().from('created_at'),
  })
  .primaryKey('id');

const webhookEvent = table('webhookEvent')
  .from('webhook_event')
  .columns({
    id: string(),
    workspaceID: string().from('workspace_id').optional(),
    channelID: string().from('channel_id').optional(),
    source: string(),
    eventType: string().from('event_type'),
    providerMessageID: string().from('provider_message_id').optional(),
    payload: json(),
    processedAt: number().from('processed_at').optional(),
    createdAt: number().from('created_at'),
  })
  .primaryKey('id');

const customerChannelIdentity = table('customerChannelIdentity')
  .from('customer_channel_identity')
  .columns({
    id: string(),
    workspaceID: string().from('workspace_id'),
    channelID: string().from('channel_id'),
    customerID: string().from('customer_id'),
    externalIdentifier: string().from('external_identifier'),
    providerMeta: json().from('provider_meta'),
    createdAt: number().from('created_at'),
    updatedAt: number().from('updated_at'),
  })
  .primaryKey('id');

// ---------- Relationships

const userRelationships = relationships(user, ({ many }) => ({
  assignedTickets: many({
    sourceField: ['id'],
    destField: ['assigneeID'],
    destSchema: ticket,
  }),
  createdTickets: many({
    sourceField: ['id'],
    destField: ['createdByID'],
    destSchema: ticket,
  }),
  closedTickets: many({
    sourceField: ['id'],
    destField: ['closedByID'],
    destSchema: ticket,
  }),
  assignedInboundRoutingRules: many({
    sourceField: ['id'],
    destField: ['assignAgentID'],
    destSchema: inboundRoutingRule,
  }),
  memberships: many({
    sourceField: ['id'],
    destField: ['userId'],
    destSchema: member,
  }),
}));

const organizationRelationships = relationships(organization, ({ many }) => ({
  members: many({
    sourceField: ['id'],
    destField: ['organizationId'],
    destSchema: member,
  }),
  tickets: many({
    sourceField: ['id'],
    destField: ['workspaceID'],
    destSchema: ticket,
  }),
  customers: many({
    sourceField: ['id'],
    destField: ['workspaceID'],
    destSchema: customer,
  }),
  tagGroups: many({
    sourceField: ['id'],
    destField: ['workspaceID'],
    destSchema: tagGroup,
  }),
  tags: many({
    sourceField: ['id'],
    destField: ['workspaceID'],
    destSchema: tag,
  }),
  customFields: many({
    sourceField: ['id'],
    destField: ['workspaceID'],
    destSchema: customField,
  }),
  channels: many({
    sourceField: ['id'],
    destField: ['workspaceID'],
    destSchema: channel,
  }),
  inboundMessages: many({
    sourceField: ['id'],
    destField: ['workspaceID'],
    destSchema: inboundMessageRaw,
  }),
  inboundRoutingRules: many({
    sourceField: ['id'],
    destField: ['workspaceID'],
    destSchema: inboundRoutingRule,
  }),
}));

const memberRelationships = relationships(member, ({ one }) => ({
  user: one({
    sourceField: ['userId'],
    destField: ['id'],
    destSchema: user,
  }),
  organization: one({
    sourceField: ['organizationId'],
    destField: ['id'],
    destSchema: organization,
  }),
}));

const customerRelationships = relationships(customer, ({ many }) => ({
  tickets: many({
    sourceField: ['id'],
    destField: ['customerID'],
    destSchema: ticket,
  }),
  tags: many({
    sourceField: ['id'],
    destField: ['customerID'],
    destSchema: customerTag,
  }),
  customFieldValues: many({
    sourceField: ['id'],
    destField: ['customerID'],
    destSchema: customFieldValue,
  }),
  auditEvents: many({
    sourceField: ['id'],
    destField: ['customerID'],
    destSchema: auditEvent,
  }),
  channelIdentities: many({
    sourceField: ['id'],
    destField: ['customerID'],
    destSchema: customerChannelIdentity,
  }),
}));

const ticketRelationships = relationships(ticket, ({ one, many }) => ({
  workspace: one({
    sourceField: ['workspaceID'],
    destField: ['id'],
    destSchema: organization,
  }),
  customer: one({
    sourceField: ['customerID'],
    destField: ['id'],
    destSchema: customer,
  }),
  assignee: one({
    sourceField: ['assigneeID'],
    destField: ['id'],
    destSchema: user,
  }),
  createdBy: one({
    sourceField: ['createdByID'],
    destField: ['id'],
    destSchema: user,
  }),
  closedBy: one({
    sourceField: ['closedByID'],
    destField: ['id'],
    destSchema: user,
  }),
  messages: many({
    sourceField: ['id'],
    destField: ['ticketID'],
    destSchema: message,
  }),
  auditEvents: many({
    sourceField: ['id'],
    destField: ['ticketID'],
    destSchema: auditEvent,
  }),
  tags: many({
    sourceField: ['id'],
    destField: ['ticketID'],
    destSchema: ticketTag,
  }),
  customFieldValues: many({
    sourceField: ['id'],
    destField: ['ticketID'],
    destSchema: customFieldValue,
  }),
  outboundMessages: many({
    sourceField: ['id'],
    destField: ['ticketID'],
    destSchema: outboundMessage,
  }),
  inboundMessages: many({
    sourceField: ['id'],
    destField: ['processedTicketID'],
    destSchema: inboundMessageRaw,
  }),
}));

const messageRelationships = relationships(message, ({ one, many }) => ({
  ticket: one({
    sourceField: ['ticketID'],
    destField: ['id'],
    destSchema: ticket,
  }),
  authorUser: one({
    sourceField: ['authorUserID'],
    destField: ['id'],
    destSchema: user,
  }),
  authorCustomer: one({
    sourceField: ['authorCustomerID'],
    destField: ['id'],
    destSchema: customer,
  }),
  attachments: many({
    sourceField: ['id'],
    destField: ['messageID'],
    destSchema: attachment,
  }),
  outboundMessages: many({
    sourceField: ['id'],
    destField: ['messageID'],
    destSchema: outboundMessage,
  }),
  inboundMessages: many({
    sourceField: ['id'],
    destField: ['processedMessageID'],
    destSchema: inboundMessageRaw,
  }),
}));

const attachmentRelationships = relationships(attachment, ({ one }) => ({
  message: one({
    sourceField: ['messageID'],
    destField: ['id'],
    destSchema: message,
  }),
}));

const auditEventRelationships = relationships(auditEvent, ({ one }) => ({
  ticket: one({
    sourceField: ['ticketID'],
    destField: ['id'],
    destSchema: ticket,
  }),
  customer: one({
    sourceField: ['customerID'],
    destField: ['id'],
    destSchema: customer,
  }),
  actor: one({
    sourceField: ['actorID'],
    destField: ['id'],
    destSchema: user,
  }),
}));

const tagGroupRelationships = relationships(tagGroup, ({ one, many }) => ({
  workspace: one({
    sourceField: ['workspaceID'],
    destField: ['id'],
    destSchema: organization,
  }),
  tags: many({
    sourceField: ['id'],
    destField: ['groupID'],
    destSchema: tag,
  }),
}));

const tagRelationships = relationships(tag, ({ one, many }) => ({
  workspace: one({
    sourceField: ['workspaceID'],
    destField: ['id'],
    destSchema: organization,
  }),
  group: one({
    sourceField: ['groupID'],
    destField: ['id'],
    destSchema: tagGroup,
  }),
  ticketTags: many({
    sourceField: ['id'],
    destField: ['tagID'],
    destSchema: ticketTag,
  }),
  customerTags: many({
    sourceField: ['id'],
    destField: ['tagID'],
    destSchema: customerTag,
  }),
}));

const ticketTagRelationships = relationships(ticketTag, ({ one }) => ({
  ticket: one({
    sourceField: ['ticketID'],
    destField: ['id'],
    destSchema: ticket,
  }),
  tag: one({
    sourceField: ['tagID'],
    destField: ['id'],
    destSchema: tag,
  }),
  addedBy: one({
    sourceField: ['addedByID'],
    destField: ['id'],
    destSchema: user,
  }),
}));

const customerTagRelationships = relationships(customerTag, ({ one }) => ({
  customer: one({
    sourceField: ['customerID'],
    destField: ['id'],
    destSchema: customer,
  }),
  tag: one({
    sourceField: ['tagID'],
    destField: ['id'],
    destSchema: tag,
  }),
  addedBy: one({
    sourceField: ['addedByID'],
    destField: ['id'],
    destSchema: user,
  }),
}));

const customFieldRelationships = relationships(customField, ({ one, many }) => ({
  workspace: one({
    sourceField: ['workspaceID'],
    destField: ['id'],
    destSchema: organization,
  }),
  values: many({
    sourceField: ['id'],
    destField: ['fieldID'],
    destSchema: customFieldValue,
  }),
}));

const customFieldValueRelationships = relationships(customFieldValue, ({ one }) => ({
  field: one({
    sourceField: ['fieldID'],
    destField: ['id'],
    destSchema: customField,
  }),
  ticket: one({
    sourceField: ['ticketID'],
    destField: ['id'],
    destSchema: ticket,
  }),
  customer: one({
    sourceField: ['customerID'],
    destField: ['id'],
    destSchema: customer,
  }),
  updatedBy: one({
    sourceField: ['updatedByID'],
    destField: ['id'],
    destSchema: user,
  }),
}));

const channelRelationships = relationships(channel, ({ one, many }) => ({
  workspace: one({
    sourceField: ['workspaceID'],
    destField: ['id'],
    destSchema: organization,
  }),
  emailChannel: one({
    sourceField: ['id'],
    destField: ['channelID'],
    destSchema: emailChannel,
  }),
  emailAddresses: many({
    sourceField: ['id'],
    destField: ['channelID'],
    destSchema: emailAddress,
  }),
  outboundMessages: many({
    sourceField: ['id'],
    destField: ['channelID'],
    destSchema: outboundMessage,
  }),
  inboundMessages: many({
    sourceField: ['id'],
    destField: ['channelID'],
    destSchema: inboundMessageRaw,
  }),
  inboundRoutingRules: many({
    sourceField: ['id'],
    destField: ['channelID'],
    destSchema: inboundRoutingRule,
  }),
  suppressions: many({
    sourceField: ['id'],
    destField: ['channelID'],
    destSchema: suppression,
  }),
  webhookEvents: many({
    sourceField: ['id'],
    destField: ['channelID'],
    destSchema: webhookEvent,
  }),
  customerIdentities: many({
    sourceField: ['id'],
    destField: ['channelID'],
    destSchema: customerChannelIdentity,
  }),
}));

const sendingDomainRelationships = relationships(sendingDomain, ({ many }) => ({
  emailChannels: many({
    sourceField: ['id'],
    destField: ['sendingDomainID'],
    destSchema: emailChannel,
  }),
  emailAddresses: many({
    sourceField: ['id'],
    destField: ['sendingDomainID'],
    destSchema: emailAddress,
  }),
}));

const emailChannelRelationships = relationships(emailChannel, ({ one }) => ({
  channel: one({
    sourceField: ['channelID'],
    destField: ['id'],
    destSchema: channel,
  }),
  sendingDomain: one({
    sourceField: ['sendingDomainID'],
    destField: ['id'],
    destSchema: sendingDomain,
  }),
}));

const emailAddressRelationships = relationships(emailAddress, ({ one, many }) => ({
  channel: one({
    sourceField: ['channelID'],
    destField: ['id'],
    destSchema: channel,
  }),
  sendingDomain: one({
    sourceField: ['sendingDomainID'],
    destField: ['id'],
    destSchema: sendingDomain,
  }),
  outboundMessages: many({
    sourceField: ['id'],
    destField: ['emailAddressID'],
    destSchema: outboundMessage,
  }),
  inboundRoutingRules: many({
    sourceField: ['id'],
    destField: ['emailAddressID'],
    destSchema: inboundRoutingRule,
  }),
}));

const outboundMessageRelationships = relationships(outboundMessage, ({ one }) => ({
  channel: one({
    sourceField: ['channelID'],
    destField: ['id'],
    destSchema: channel,
  }),
  emailAddress: one({
    sourceField: ['emailAddressID'],
    destField: ['id'],
    destSchema: emailAddress,
  }),
  message: one({
    sourceField: ['messageID'],
    destField: ['id'],
    destSchema: message,
  }),
  ticket: one({
    sourceField: ['ticketID'],
    destField: ['id'],
    destSchema: ticket,
  }),
}));

const inboundMessageRawRelationships = relationships(inboundMessageRaw, ({ one }) => ({
  workspace: one({
    sourceField: ['workspaceID'],
    destField: ['id'],
    destSchema: organization,
  }),
  channel: one({
    sourceField: ['channelID'],
    destField: ['id'],
    destSchema: channel,
  }),
  processedTicket: one({
    sourceField: ['processedTicketID'],
    destField: ['id'],
    destSchema: ticket,
  }),
  processedMessage: one({
    sourceField: ['processedMessageID'],
    destField: ['id'],
    destSchema: message,
  }),
}));

const inboundRoutingRuleRelationships = relationships(inboundRoutingRule, ({ one }) => ({
  workspace: one({
    sourceField: ['workspaceID'],
    destField: ['id'],
    destSchema: organization,
  }),
  channel: one({
    sourceField: ['channelID'],
    destField: ['id'],
    destSchema: channel,
  }),
  emailAddress: one({
    sourceField: ['emailAddressID'],
    destField: ['id'],
    destSchema: emailAddress,
  }),
  assignAgent: one({
    sourceField: ['assignAgentID'],
    destField: ['id'],
    destSchema: user,
  }),
}));

const suppressionRelationships = relationships(suppression, ({ one }) => ({
  channel: one({
    sourceField: ['channelID'],
    destField: ['id'],
    destSchema: channel,
  }),
}));

const webhookEventRelationships = relationships(webhookEvent, ({ one }) => ({
  channel: one({
    sourceField: ['channelID'],
    destField: ['id'],
    destSchema: channel,
  }),
}));

const customerChannelIdentityRelationships = relationships(customerChannelIdentity, ({ one }) => ({
  channel: one({
    sourceField: ['channelID'],
    destField: ['id'],
    destSchema: channel,
  }),
  customer: one({
    sourceField: ['customerID'],
    destField: ['id'],
    destSchema: customer,
  }),
}));

// ---------- Schema

export const schema = createSchema({
  tables: [
    user,
    organization,
    member,
    customer,
    ticket,
    message,
    attachment,
    auditEvent,
    tagGroup,
    tag,
    ticketTag,
    customerTag,
    customField,
    customFieldValue,
    channel,
    sendingDomain,
    emailChannel,
    emailAddress,
    outboundMessage,
    inboundMessageRaw,
    inboundRoutingRule,
    suppression,
    webhookEvent,
    customerChannelIdentity,
  ],
  relationships: [
    userRelationships,
    organizationRelationships,
    memberRelationships,
    customerRelationships,
    ticketRelationships,
    messageRelationships,
    attachmentRelationships,
    auditEventRelationships,
    tagGroupRelationships,
    tagRelationships,
    ticketTagRelationships,
    customerTagRelationships,
    customFieldRelationships,
    customFieldValueRelationships,
    channelRelationships,
    sendingDomainRelationships,
    emailChannelRelationships,
    emailAddressRelationships,
    outboundMessageRelationships,
    inboundMessageRawRelationships,
    inboundRoutingRuleRelationships,
    suppressionRelationships,
    webhookEventRelationships,
    customerChannelIdentityRelationships,
  ],
  enableLegacyMutators: false,
  enableLegacyQueries: false,
});

export const builder = createBuilder(schema);

export type Schema = typeof schema;
export type User = Row<typeof schema.tables.user>;
export type Organization = Row<typeof schema.tables.organization>;
export type Member = Row<typeof schema.tables.member>;
export type Customer = Row<typeof schema.tables.customer>;
export type Ticket = Row<typeof schema.tables.ticket>;
export type Message = Row<typeof schema.tables.message>;
export type Attachment = Row<typeof schema.tables.attachment>;
export type AuditEvent = Row<typeof schema.tables.auditEvent>;
export type TagGroup = Row<typeof schema.tables.tagGroup>;
export type Tag = Row<typeof schema.tables.tag>;
export type TicketTag = Row<typeof schema.tables.ticketTag>;
export type CustomerTag = Row<typeof schema.tables.customerTag>;
export type CustomField = Row<typeof schema.tables.customField>;
export type CustomFieldValue = Row<typeof schema.tables.customFieldValue>;
export type Channel = Row<typeof schema.tables.channel>;
export type SendingDomain = Row<typeof schema.tables.sendingDomain>;
export type EmailChannel = Row<typeof schema.tables.emailChannel>;
export type EmailAddress = Row<typeof schema.tables.emailAddress>;
export type OutboundMessage = Row<typeof schema.tables.outboundMessage>;
export type InboundMessageRaw = Row<typeof schema.tables.inboundMessageRaw>;
export type InboundRoutingRule = Row<typeof schema.tables.inboundRoutingRule>;
export type Suppression = Row<typeof schema.tables.suppression>;
export type WebhookEvent = Row<typeof schema.tables.webhookEvent>;
export type CustomerChannelIdentity = Row<typeof schema.tables.customerChannelIdentity>;

export type AuthData = {
  sub: string;
  workspaceID: string | null;
  role: 'owner' | 'admin' | 'agent' | null;
};

declare module '@rocicorp/zero' {
  interface DefaultTypes {
    schema: Schema;
    context: AuthData | undefined;
  }
}
