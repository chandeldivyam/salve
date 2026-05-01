export type TimelineTicketStatus = 'open' | 'in_progress' | 'snoozed' | 'resolved' | 'closed';
export type TimelineTicketPriority = 'low' | 'normal' | 'high' | 'urgent';
export type TimelineMessageAuthorType = 'customer' | 'agent' | 'system';

export type AuthSignal =
  | 'pass'
  | 'fail'
  | 'softfail'
  | 'neutral'
  | 'none'
  | 'temperror'
  | 'permerror'
  | 'unknown';

export interface InboundAuthResults {
  spf: AuthSignal;
  dkim: AuthSignal;
  dmarc: AuthSignal;
}

export interface TimelineUser {
  readonly id: string;
  readonly name?: string | null;
  readonly email?: string | null;
  readonly image?: string | null;
}

export interface TimelineCustomer {
  readonly id: string;
  readonly email: string;
  readonly name?: string | null;
  readonly displayName?: string | null;
  readonly avatarUrl?: string | null;
  readonly createdAt?: number | null;
  readonly updatedAt?: number | null;
  readonly phone?: string | null;
  readonly location?: string | null;
  readonly firstSeenAt?: number | null;
  readonly lastSeenAt?: number | null;
  readonly metadata?: unknown;
  readonly tags?: ReadonlyArray<TimelineTagRelation>;
  readonly customFieldValues?: unknown;
}

export interface TimelineAttachment {
  readonly id: string;
  readonly filename: string;
  readonly sizeBytes: number;
  readonly mimeType: string;
  readonly s3Key: string;
}

export interface TimelineMessage {
  readonly id: string;
  readonly ticketID?: string | null;
  readonly authorType: TimelineMessageAuthorType;
  readonly authorUserID?: string | null;
  readonly authorCustomerID?: string | null;
  readonly bodyHtml: string;
  readonly bodyText: string;
  readonly isInternal: boolean;
  readonly createdAt: number;
  readonly authorUser?: TimelineUser | null;
  readonly authorCustomer?: TimelineCustomer | null;
  readonly attachments?: ReadonlyArray<TimelineAttachment>;
}

export interface TimelineTag {
  readonly id: string;
  readonly label: string;
  readonly color?: string | null;
  readonly group?: {
    readonly id?: string | null;
    readonly label?: string | null;
    readonly color?: string | null;
  } | null;
}

export interface TimelineTagRelation {
  readonly tag?: TimelineTag | null;
}

export interface TimelineAuditEvent {
  readonly id: string;
  readonly kind: string;
  readonly ticketID?: string | null;
  readonly customerID?: string | null;
  readonly actorID?: string | null;
  readonly actor?: TimelineUser | null;
  readonly payload?: unknown;
  readonly createdAt: number;
}

export interface TimelineCustomerNote {
  readonly id: string;
  readonly objectType: 'customer' | 'ticket';
  readonly objectID: string;
  readonly customerID: string;
  readonly bodyHtml: string;
  readonly bodyText: string;
  readonly pinned: boolean;
  readonly createdByID: string;
  readonly editedAt?: number | null;
  readonly deletedAt?: number | null;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly createdBy?: TimelineUser | null;
}

export interface TimelineCustomEvent {
  readonly id: string;
  readonly customerID: string;
  readonly eventName: string;
  readonly properties?: unknown;
  readonly source: string;
  readonly occurredAt: number;
  readonly ingestedAt: number;
  readonly idempotencyKey?: string | null;
}

export interface TimelineTicket {
  readonly id: string;
  readonly shortID: number;
  readonly title: string;
  readonly description?: string | null;
  readonly status: TimelineTicketStatus;
  readonly priority: TimelineTicketPriority;
  readonly customerID?: string | null;
  readonly assigneeID?: string | null;
  readonly createdByID?: string | null;
  readonly closedByID?: string | null;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly firstResponseAt?: number | null;
  readonly resolvedAt?: number | null;
  readonly closedAt?: number | null;
  readonly customer?: TimelineCustomer | null;
  readonly assignee?: TimelineUser | null;
  readonly createdBy?: TimelineUser | null;
  readonly closedBy?: TimelineUser | null;
  readonly messages?: ReadonlyArray<TimelineMessage>;
  readonly auditEvents?: ReadonlyArray<TimelineAuditEvent>;
  readonly customerNotes?: ReadonlyArray<TimelineCustomerNote>;
  readonly tags?: ReadonlyArray<TimelineTagRelation>;
  readonly customFieldValues?: unknown;
}

export interface TimelineDelivery {
  readonly status: string;
  readonly error?: string | null;
}

export interface TimelineEmailAddress {
  readonly id: string;
  readonly fullAddress: string;
  readonly label?: string | null;
  readonly isDefault?: boolean | null;
  readonly signatureHTML?: string | null;
  readonly signatureHtml?: string | null;
  readonly signature?: string | null;
  readonly sendingDomain?: {
    readonly id?: string;
    readonly domain?: string | null;
    readonly dnsStatus?: string | null;
  } | null;
}
