/**
 * THE OFFLINE SHELL IS A LIST IN ONE FILE AND A ROUTER IN ANOTHER.
 *
 *   node cells/drive/devtools/appshell.test.mjs
 *
 * `web/sw.js` precaches a hard-coded list of paths with `cache.addAll`, which
 * is ATOMIC: one path the cell does not serve and the install rejects, the
 * worker never activates, and offline boot is gone — silently, because a
 * failed install looks exactly like a browser that has not got round to it yet.
 * The routes live in `index.ts`, so nothing but this connects the two.
 *
 * It runs in milliseconds and needs no browser, which is the point: the
 * harness relays every request through curl and never sees a service worker at
 * all, so the expensive tools are structurally blind to this whole file.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CELL = join(dirname(fileURLToPath(import.meta.url)), '..');
const sw = readFileSync(join(CELL, 'web/sw.js'), 'utf8');
const cell = readFileSync(join(CELL, 'index.ts'), 'utf8');

let bad = 0;
const check = (name, cond, saw) => {
  if (!cond) bad++;
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${name}${cond ? '' : `\n        saw ${JSON.stringify(saw)}`}`);
};

// What the worker promises to have on disk.
const shell = [...sw.matchAll(/^\s*'(\/[^']*)',$/gm)].map((m) => m[1]);
// What the cell will actually hand over: the page, the bundle, and the static
// assets it keys by path.
const assets = [...cell.matchAll(/^\s*'(\/[^']+)':\s*\{/gm)].map((m) => m[1]);
const served = new Set(['/', '/app.js', ...assets]);

check('the worker precaches a shell at all', shell.length >= 3, shell);
check('the cell has static web assets', assets.length > 0, assets);

for (const path of shell) {
  check(`served: ${path}`, served.has(path), [...served]);
}
// The other direction. A new icon added to the cell and not to the worker is
// not a broken install — it is an icon that is simply missing from an
// installed app when the network is off, which is harder to notice and just as
// wrong.
for (const path of assets) {
  check(`precached: ${path}`, shell.includes(path), shell);
}

// The stamp is what rotates the cache on a deploy. If the placeholder is
// renamed in one file and not the other, every build shares one cache name and
// a stale shell can never be replaced.
const placeholder = '__DRIVE_SW_BUILD__';
check('the worker carries the build placeholder', sw.includes(placeholder), null);
check('the cell substitutes it', cell.includes(`.replace('${placeholder}'`), null);

// A document may only register a worker its own policy admits, and a refused
// registration reports nothing to the page.
check("worker-src admits 'self'", /worker-src 'self'/.test(cell), null);

console.log(bad ? `\n${bad} FAILED` : '\nall ok');
process.exitCode = bad ? 1 : 0;
