export interface ParsedArgv {
  positionals: string[];
  flags: Record<string, string | boolean>;
}

export function parseArgv(argv: readonly string[]): ParsedArgv {
  const positionals: string[] = [];
  const flags: Record<string, string | boolean> = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg) continue;

    if (arg === '--') {
      positionals.push(...argv.slice(index + 1));
      break;
    }

    if (arg === '-h') {
      flags.help = true;
      continue;
    }
    if (arg === '-v') {
      flags.version = true;
      continue;
    }

    if (arg.startsWith('--')) {
      const trimmed = arg.slice(2);
      if (trimmed.startsWith('no-')) {
        flags[toCamelCase(trimmed.slice(3))] = false;
        continue;
      }

      const [rawKey, inlineValue] = splitFlag(trimmed);
      const key = toCamelCase(rawKey);
      if (inlineValue !== undefined) {
        flags[key] = inlineValue;
        continue;
      }

      const next = argv[index + 1];
      if (next && !next.startsWith('-')) {
        flags[key] = next;
        index += 1;
      } else {
        flags[key] = true;
      }
      continue;
    }

    positionals.push(arg);
  }

  return { positionals, flags };
}

export function getFlag(flags: Record<string, string | boolean>, key: string): string | undefined {
  const value = flags[key];
  return typeof value === 'string' ? value : undefined;
}

export function getBooleanFlag(
  flags: Record<string, string | boolean>,
  key: string,
): boolean | undefined {
  const value = flags[key];
  if (typeof value === 'boolean') return value;
  if (value === 'true' || value === '1') return true;
  if (value === 'false' || value === '0') return false;
  return undefined;
}

export function getNumberFlag(
  flags: Record<string, string | boolean>,
  key: string,
): number | undefined {
  const value = getFlag(flags, key);
  if (value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function splitFlag(value: string): [string, string | undefined] {
  const index = value.indexOf('=');
  if (index === -1) return [value, undefined];
  return [value.slice(0, index), value.slice(index + 1)];
}

function toCamelCase(value: string): string {
  return value.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
}
