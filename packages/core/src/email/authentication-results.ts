export type AuthenticationCheckName = 'spf' | 'dkim' | 'dmarc';

export type AuthenticationCheckResult =
  | 'pass'
  | 'fail'
  | 'softfail'
  | 'neutral'
  | 'none'
  | 'temperror'
  | 'permerror'
  | 'policy'
  | 'unknown';

export type AuthenticationCheck = {
  name: AuthenticationCheckName;
  result: AuthenticationCheckResult;
  domain?: string;
  selector?: string;
  raw: string;
};

export type ParsedAuthenticationResults = {
  raw: string[];
  spf: AuthenticationCheck[];
  dkim: AuthenticationCheck[];
  dmarc: AuthenticationCheck[];
  passed: Record<AuthenticationCheckName, boolean>;
  failed: Record<AuthenticationCheckName, boolean>;
};

const CHECK_RE = /\b(spf|dkim|dmarc)\s*=\s*([a-z0-9_-]+)/gi;
const RESULT_VALUES = new Set<AuthenticationCheckResult>([
  'pass',
  'fail',
  'softfail',
  'neutral',
  'none',
  'temperror',
  'permerror',
  'policy',
  'unknown',
]);

export function parseAuthenticationResults(
  header: string | readonly string[] | null | undefined,
): ParsedAuthenticationResults {
  const raw = Array.isArray(header) ? header.filter(Boolean) : header ? [header] : [];
  const parsed: ParsedAuthenticationResults = {
    raw,
    spf: [],
    dkim: [],
    dmarc: [],
    passed: { spf: false, dkim: false, dmarc: false },
    failed: { spf: false, dkim: false, dmarc: false },
  };

  for (const value of raw) {
    for (const match of value.matchAll(CHECK_RE)) {
      const name = match[1]?.toLowerCase() as AuthenticationCheckName;
      const result = normalizeResult(match[2]);
      const check: AuthenticationCheck = {
        name,
        result,
        raw: value,
        ...extractDomainFields(name, value),
      };

      parsed[name].push(check);
      if (result === 'pass') {
        parsed.passed[name] = true;
      }
      if (result !== 'pass' && result !== 'none' && result !== 'neutral') {
        parsed.failed[name] = true;
      }
    }
  }

  return parsed;
}

function normalizeResult(value: string | undefined): AuthenticationCheckResult {
  const lower = value?.toLowerCase() as AuthenticationCheckResult | undefined;
  return lower && RESULT_VALUES.has(lower) ? lower : 'unknown';
}

function extractDomainFields(
  name: AuthenticationCheckName,
  value: string,
): Pick<AuthenticationCheck, 'domain' | 'selector'> {
  if (name === 'spf') {
    return { domain: findProperty(value, 'smtp.mailfrom') ?? findProperty(value, 'mailfrom') };
  }

  if (name === 'dkim') {
    return {
      domain: findProperty(value, 'header.d'),
      selector: findProperty(value, 'header.s'),
    };
  }

  return { domain: findProperty(value, 'header.from') };
}

function findProperty(value: string, property: string): string | undefined {
  const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = value.match(new RegExp(`\\b${escaped}=([^;\\s]+)`, 'i'));
  return match?.[1]?.replace(/^["']|["']$/g, '').toLowerCase();
}
