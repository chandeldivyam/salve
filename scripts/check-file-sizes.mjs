#!/usr/bin/env node
// File-size guard. Reports files over WARN_LINES, fails on FAIL_LINES when
// run with --strict. Default mode is advisory (exit 0 always) so the report
// can run on every PR without blocking the existing offenders that pre-date
// guidelines/conventions.md §7.
//
// Run: `node scripts/check-file-sizes.mjs` (advisory)
//      `node scripts/check-file-sizes.mjs --strict` (fail on hard ceiling)
//
// Targets: apps/web/src and packages/*/src TS/TSX files. Generated, test,
// and centralized-by-design files (zero-schema schema/queries, mutators
// index, db schema modules) are excluded.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const STRICT = process.argv.includes('--strict');
const WARN_LINES = 300;
const FAIL_LINES = 500;

const SCAN_DIRS = ['apps/web/src', 'packages'];
const SKIP_DIRS = new Set(['node_modules', '.turbo', 'dist', '.next']);

const EXCLUDE = [
  /routeTree\.gen\.ts$/,
  /\.test\.tsx?$/,
  /\.spec\.tsx?$/,
  // Centralized schema / query / mutator registries — large by design
  // (mirrors zbugs `shared/schema.ts` and `shared/queries.ts`).
  /packages\/zero-schema\/src\/(schema|queries)\.ts$/,
  /packages\/mutators\/src\/index\.ts$/,
  /packages\/db\/src\/schema\//,
];

function* walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walk(path);
    } else if (entry.isFile() && /\.tsx?$/.test(entry.name)) {
      yield path;
    }
  }
}

function isOnlyTsPackage(root, name) {
  const src = join(root, 'packages', name, 'src');
  try {
    return statSync(src).isDirectory();
  } catch {
    return false;
  }
}

const offenders = [];
const warnings = [];

for (const top of SCAN_DIRS) {
  const start = join(ROOT, top);
  if (top === 'packages') {
    let pkgs = [];
    try {
      pkgs = readdirSync(start, { withFileTypes: true })
        .filter((e) => e.isDirectory() && isOnlyTsPackage(ROOT, e.name))
        .map((e) => join(start, e.name, 'src'));
    } catch {
      pkgs = [];
    }
    for (const pkg of pkgs) {
      for (const file of walk(pkg)) collect(file);
    }
  } else {
    for (const file of walk(start)) collect(file);
  }
}

function collect(absPath) {
  const rel = relative(ROOT, absPath);
  if (EXCLUDE.some((re) => re.test(rel))) return;
  const lines = readFileSync(absPath, 'utf8').split('\n').length;
  if (lines >= FAIL_LINES) offenders.push({ file: rel, lines });
  else if (lines >= WARN_LINES) warnings.push({ file: rel, lines });
}

if (warnings.length > 0) {
  console.warn(`\n⚠️  ${warnings.length} file(s) ≥ ${WARN_LINES} lines:`);
  for (const { file, lines } of warnings.sort((a, b) => b.lines - a.lines)) {
    console.warn(`   ${lines.toString().padStart(5)}  ${file}`);
  }
}

if (offenders.length > 0) {
  const verb = STRICT ? '✗' : '⚠️ ';
  console.warn(`\n${verb} ${offenders.length} file(s) ≥ ${FAIL_LINES} lines (hard ceiling):`);
  for (const { file, lines } of offenders.sort((a, b) => b.lines - a.lines)) {
    console.warn(`   ${lines.toString().padStart(5)}  ${file}`);
  }
  console.warn(`\nSplit these into smaller modules. See guidelines/conventions.md §7.`);
  if (STRICT) process.exit(1);
} else if (warnings.length === 0) {
  console.log(`✓ All source files under ${WARN_LINES} lines.`);
}
