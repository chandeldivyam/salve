import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseArgv } from './args.js';

test('parseArgv handles positionals, booleans, negation, and values', () => {
  const parsed = parseArgv([
    'tickets',
    'list',
    '--status',
    'open',
    '--json',
    '--no-color',
    '--idempotency-key=fixed',
  ]);

  assert.deepEqual(parsed.positionals, ['tickets', 'list']);
  assert.equal(parsed.flags.status, 'open');
  assert.equal(parsed.flags.json, true);
  assert.equal(parsed.flags.color, false);
  assert.equal(parsed.flags.idempotencyKey, 'fixed');
});
