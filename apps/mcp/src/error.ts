import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { hintForErrorCode, SalveApiError } from '@opendesk/api-client';
import { ZodError } from 'zod';

export function mcpErrorResult(error: unknown, actionId?: string): CallToolResult {
  return {
    isError: true,
    content: [{ type: 'text', text: formatError(error, actionId) }],
  };
}

export function formatError(error: unknown, actionId?: string): string {
  if (error instanceof SalveApiError) {
    const status = error.status || 'network';
    const lines = [
      `x ${actionId ?? error.code} failed (${status} ${error.type}) [${error.code}]`,
      `Reason: ${error.message}`,
    ];
    if (error.field) lines.push(`Field: ${error.field}`);
    if (error.requestId) lines.push(`Request: ${error.requestId}`);
    const hint = hintForErrorCode(error.code);
    if (hint) lines.push('', `Hint: ${hint}`);
    return lines.join('\n');
  }

  if (error instanceof ZodError) {
    const lines = ['x validation_error (client-side)', 'Reason: Tool input failed validation'];
    for (const issue of error.issues) {
      const path = issue.path.length > 0 ? issue.path.join('.') : '<root>';
      lines.push(`${path}: ${issue.message}`);
    }
    return lines.join('\n');
  }

  if (error instanceof Error) {
    return `x request.failed\nReason: ${error.message}`;
  }

  return `x request.failed\nReason: ${String(error)}`;
}
