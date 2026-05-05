import { SalveApiError } from '@opendesk/api-client';
import { ZodError } from 'zod';

export function formatError(error: unknown): { message: string; exitCode: number } {
  if (error instanceof SalveApiError) {
    const lines = [
      `${error.code} (${error.status || 'network'} ${error.type})`,
      `Reason: ${error.message}`,
    ];
    if (error.field) lines.push(`Field: ${error.field}`);
    if (error.requestId) lines.push(`Request: ${error.requestId}`);
    const hint = hintFor(error.code);
    if (hint) lines.push('', hint);
    return {
      message: lines.join('\n'),
      exitCode: error.status >= 500 || error.status === 0 ? 2 : 1,
    };
  }

  if (error instanceof ZodError) {
    return { message: formatZodError(error), exitCode: 1 };
  }

  if (error instanceof Error) {
    return { message: error.message, exitCode: 1 };
  }

  return { message: String(error), exitCode: 1 };
}

function formatZodError(error: ZodError): string {
  const lines = ['validation_error (client-side)'];
  for (const issue of error.issues) {
    const path = issue.path.length > 0 ? issue.path.join('.') : '<root>';
    lines.push(`  ${path}: ${issue.message}`);
  }
  lines.push('', 'The CLI rejected the request before sending. Fix the offending input and retry.');
  return lines.join('\n');
}

function hintFor(code: string): string | null {
  if (code === 'auth.required' || code === 'auth.bearer_required') {
    return 'Run `salve login` or set SALVE_TOKEN.';
  }
  if (code === 'auth.scope_missing') {
    return 'Mint a token with the required scope at https://app.usesalve.com/app/settings/api-tokens.';
  }
  if (code === 'idempotency_key.reused_with_different_request') {
    return 'Use a fresh --idempotency-key or omit the flag.';
  }
  return null;
}
