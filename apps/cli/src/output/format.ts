import Table from 'cli-table3';
import pc from 'picocolors';
import { getBooleanFlag } from '../args.js';

export type OutputMode = 'table' | 'json' | 'jsonl';

export interface OutputContext {
  flags: Record<string, string | boolean>;
}

export function outputMode(flags: Record<string, string | boolean>): OutputMode {
  if (getBooleanFlag(flags, 'jsonl')) return 'jsonl';
  if (getBooleanFlag(flags, 'json')) return 'json';
  return process.stdout.isTTY && !process.env.CI ? 'table' : 'json';
}

export function colorize(flags: Record<string, string | boolean>) {
  return getBooleanFlag(flags, 'color') === false || process.env.NO_COLOR
    ? pc.createColors(false)
    : pc;
}

export function printValue(
  value: unknown,
  context: OutputContext,
  table?: { head: string[]; rows: string[][] },
): void {
  const mode = outputMode(context.flags);
  if (mode === 'json') {
    process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
    return;
  }
  if (mode === 'jsonl') {
    const rows = dataRows(value);
    for (const row of rows) process.stdout.write(`${JSON.stringify(row)}\n`);
    return;
  }
  if (table) {
    const rendered = new Table({ head: table.head });
    rendered.push(...table.rows);
    process.stdout.write(`${rendered.toString()}\n`);
    return;
  }
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

export function dataRows(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object' && Array.isArray((value as { data?: unknown }).data)) {
    return (value as { data: unknown[] }).data;
  }
  return [value];
}
