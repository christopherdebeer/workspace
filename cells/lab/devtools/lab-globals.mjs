// The lab's bundle as it's served (node cells/lab/devtools/lab-globals.mjs): ESM, every module hoisted into one scope,
// loaded by a classic <script>, so each module-level name the bundler hoists to a `var` is a global of the page. A name
// the window holds read-only (`top`, `closed`, `location`…) can't be taken that way: the assignment is dropped, and the
// name stays the window's (labyrinth's preview died on `top is not a function` this way). The harness bundles as an
// IIFE, where none of this shows, so this looks for it directly.
const { build } = await import('esbuild');
const { join } = await import('node:path');
const here = new URL('.', import.meta.url).pathname;
// (the window's own names that a `var` can't take: read-only and not replaceable)
const HELD = new Set(['top', 'window', 'document', 'location', 'closed', 'navigator', 'history', 'customElements', 'localStorage', 'sessionStorage', 'indexedDB', 'caches', 'crypto', 'frameElement', 'isSecureContext', 'crossOriginIsolated', 'trustedTypes']);
const out = await build({ entryPoints: [join(here, '../client/main.ts')], bundle: true, format: 'esm', target: 'es2020', write: false, logLevel: 'warning' });
const src = out.outputFiles[0].text, bad = [];
for (const m of src.matchAll(/^var ([^;=\n]+)[;=]/gm)) for (const n of m[1].split(',').map((x) => x.trim().split(/\s/)[0])) if (HELD.has(n)) bad.push(n);
if (bad.length) { console.log(`FAIL  module-level names the page's window holds read-only: ${[...new Set(bad)].join(', ')}`); process.exit(1); }
console.log('ok    no module-level name takes one the window holds read-only');
