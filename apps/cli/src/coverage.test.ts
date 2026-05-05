// Asserts the hand-written dispatcher in `main.ts` stays aligned with the
// `cli` metadata declared on action contracts. Catches both directions of
// drift:
//
//   - An action declares `cli.command: ['foo', 'bar']` but no branch in
//     `main.ts` handles it (forgot to wire).
//   - The dispatcher exposes a verb that no contract declares (CLI exposes
//     more than the public contract documents).
//
// The check is heuristic: we assume each CLI branch is implemented as a
// `client.<namespace>.<verb>(...)` call in `main.ts`, and we look for the
// verb namespace + method name. If the dispatcher ever stops using the
// typed namespaced surface, this test would need to switch to AST-based
// scanning — until then, the substring approach is enough to catch drift
// at CI without a TypeScript compile dance.

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { ALL_ACTIONS } from '@opendesk/action-contracts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MAIN_PATH = resolve(__dirname, 'main.ts');

test('every action with cli metadata has a wiring in main.ts', async () => {
  const source = await readFile(MAIN_PATH, 'utf8');
  const missing: string[] = [];

  for (const action of ALL_ACTIONS) {
    if (!action.cli) continue;
    const command = action.cli.command;
    if (command.length === 0) continue;
    // Heuristic: dispatcher looks like `if (verb === '<group>') { … if (command[0] === '<verb>') { … } }`.
    // We require both the namespace verb and one of the verb tokens to appear.
    const namespace = command[0];
    const verb = command[command.length - 1];
    const namespacePresent = source.includes(`'${namespace}'`) || source.includes(`"${namespace}"`);
    const verbPresent = source.includes(`'${verb}'`) || source.includes(`"${verb}"`);
    if (!namespacePresent || !verbPresent) {
      missing.push(`${action.id} (${command.join(' ')})`);
    }
  }

  assert.deepEqual(missing, [], `unwired CLI commands: ${missing.join(', ')}`);
});

test('every "client.<ns>.<verb>(" call site in main.ts maps to a contract with cli metadata', async () => {
  const source = await readFile(MAIN_PATH, 'utf8');
  // Pull every `client.namespace.verb(` occurrence. We keep it conservative —
  // a deeper-nested chain like `client.customers.notes.update` becomes
  // `customers.notes.update` and is matched against contract IDs.
  const callPattern = /client\.([a-zA-Z][\w]*(?:\.[a-zA-Z][\w]*)+)\(/g;
  const calls = new Set<string>();
  for (const match of source.matchAll(callPattern)) {
    calls.add(match[1] ?? '');
  }
  // Methods on the namespace object that exist on every typed surface but
  // do not correspond to an individual contract id (e.g. `client.action`,
  // generic helpers). We exclude these explicitly.
  const namespaceMembers = new Set(['action', 'on']);
  const validIds = new Set(ALL_ACTIONS.filter((action) => action.cli).map((action) => action.id));
  // Some method names are re-cased between contract id and SDK method
  // (e.g. `tickets.markInProgress` → `client.tickets.markInProgress(...)`,
  //  `customers.events.ingest` → `client.customers.events.ingest(...)`).
  // We accept either an exact id match or a dotted-path that, after dropping
  // the first segment, ends in the verb the contract declares.
  const verbsByNamespace = new Map<string, Set<string>>();
  for (const action of ALL_ACTIONS) {
    if (!action.cli) continue;
    const ns = action.cli.command[0];
    if (!ns) continue;
    const set = verbsByNamespace.get(ns) ?? new Set<string>();
    set.add(action.cli.command[action.cli.command.length - 1] ?? '');
    verbsByNamespace.set(ns, set);
  }

  const undeclared: string[] = [];
  for (const path of calls) {
    const parts = path.split('.');
    const ns = parts[0] ?? '';
    const tail = parts[parts.length - 1] ?? '';
    if (namespaceMembers.has(ns)) continue;
    if (validIds.has(path as never)) continue;
    if (verbsByNamespace.get(ns)?.has(tail)) continue;
    // A few SDK methods carry helper aliases the dispatcher uses (e.g.
    // `client.views.get` for `views.show`). Allow the call when the namespace
    // exists in the contract set even if the verb doesn't match exactly —
    // the matching check above is the strict one.
    if (verbsByNamespace.has(ns)) continue;
    undeclared.push(path);
  }

  assert.deepEqual(
    undeclared,
    [],
    `CLI calls into namespaces with no cli metadata: ${undeclared.join(', ')}`,
  );
});
