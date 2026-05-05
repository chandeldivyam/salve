export function hintForErrorCode(code: string): string | null {
  if (code === 'auth.required' || code === 'auth.bearer_required') {
    return 'Set SALVE_TOKEN or run `salve login` to save a token locally.';
  }
  if (code === 'auth.scope_missing') {
    return 'Mint a token with the required scope at https://app.usesalve.com/app/settings/api-tokens.';
  }
  if (code === 'idempotency_key.reused_with_different_request') {
    return 'Use a fresh idempotency key or omit the override.';
  }
  if (code === 'request.failed') {
    return 'The request did not reach Salve. Check SALVE_API_URL and network connectivity.';
  }
  return null;
}
