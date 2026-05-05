import type { SalveClient } from '@opendesk/api-client';

export interface SalveMcpAuth {
  userId: string;
  email: string;
  workspaceId: string | null;
  role: string;
  principalKind: 'user' | 'service_account';
  memberId: string | null;
  apiKeyId: string | null;
  scopes: string[];
  requestId: string;
}

export interface SalveMcpContext {
  client: SalveClient;
  auth: SalveMcpAuth;
}
