#!/usr/bin/env node
/**
 * Guards the flags (client/mistwood/flags.ts): run before a deploy — `node cells/lab/devtools/check-flags.mjs`.
 *
 * Fails when
 *   - a declared flag is read nowhere (an orphan: remove it, or use it);
 *   - any file but flags.ts reads the address (URLSearchParams, location.search, searchParams.get),
 *     which would be a flag the overlay and these checks cannot see.
 * (A flag read but not declared does not compile: `flag()` takes only declared names.)
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'client', 'mistwood');
const files = readdirSync(dir).filter((f) => f.endsWith('.ts'));
const src = Object.fromEntries(files.map((f) => [f, readFileSync(join(dir, f), 'utf8')]));

const block = src['flags.ts'].match(/export const FLAGS = \{([\s\S]*?)\n\} as const/);
if (!block) throw new Error('check-flags: FLAGS not found in flags.ts');
const declared = [...block[1].matchAll(/^\s{2}(\w+): \{/gm)].map((m) => m[1]);

const problems = [];
const reads = new Map(declared.map((n) => [n, []]));
for (const [f, text] of Object.entries(src)) {
  if (f === 'flags.ts') continue;
  for (const m of text.matchAll(/\b(?:flag|setFlag)\(\s*'(\w+)'/g)) reads.get(m[1])?.push(f);
  if (/URLSearchParams|location\.search|searchParams\.get/.test(text)) problems.push(`${f} reads the address directly: use flag() (flags.ts)`);
}
// the overlay reads every flag by itself; `tune` is read where the overlay is mounted
for (const [n, where] of reads) if (!where.length) problems.push(`flag '${n}' is declared but never read (orphan)`);

if (problems.length) {
  console.error('check-flags: ' + problems.length + ' problem(s)\n  ' + problems.join('\n  '));
  process.exit(1);
}
console.log(`check-flags: ${declared.length} flags, each read; nothing else reads the address`);
