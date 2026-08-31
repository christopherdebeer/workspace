/**
 * EVERY LAB OPENS, AND THE ROUTES MEAN WHAT THEY SAY.
 *
 *   node cells/drive/devtools/lab.test.mjs
 *
 * A lab exists to remove the world from a question, which only works if the
 * lab itself is not the thing that is broken. Two failures are worth guarding
 * against because both are silent: a lab that renders behind the game's boot
 * splash (the page looks dead and reports nothing — it happened on the first
 * run of the marks lab), and a route that quietly falls through to the game.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { openDrive, report } from './harness.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '../../..');
// INSIDE THE REPO, NOT IN /tmp. The registry's dynamic imports pull THREE in,
// and `--external:three` only defers the resolution — a bundle written to the
// system temp directory then cannot find it, because node resolves from where
// the FILE lives. Written under the workspace's own cache instead.
const cache = join(ROOT, 'node_modules/.cache');
mkdirSync(cache, { recursive: true });
const built = join(cache, 'drive-labs.test.mjs');
execFileSync('npx', ['esbuild', join(HERE, '../client/labs.ts'), '--bundle', '--format=esm',
  '--external:three', `--outfile=${built}`], { cwd: ROOT, stdio: 'pipe' });
const { LABS, labRoute } = await import(pathToFileURL(built).href);

let bad = 0;
const ok = (name, cond, saw) => {
  if (!cond) bad++;
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${name}${cond ? '' : `\n        saw ${JSON.stringify(saw)}`}`);
};

// ── THE ROUTES ────────────────────────────────────────────────────
ok('/lab is the index', labRoute('/lab')?.slug === null, labRoute('/lab'));
ok('/lab/marks is the marks lab', labRoute('/lab/marks')?.slug === 'marks', labRoute('/lab/marks'));
ok('a trailing slash is the same route', labRoute('/lab/marks/')?.slug === 'marks', labRoute('/lab/marks/'));
// The old hydro URL is written down in notes and commit messages; breaking a
// documented URL to tidy a route is not a trade worth making.
ok('/hydro still reaches the hydro lab', labRoute('/hydro')?.slug === 'hydro', labRoute('/hydro'));
ok('the game route is not a lab', labRoute('/') === null, labRoute('/'));
ok('a deep game path is not a lab', labRoute('/some/where') === null, labRoute('/some/where'));
ok('every registered lab has a unique slug',
  new Set(LABS.map((l) => l.slug)).size === LABS.length, LABS.map((l) => l.slug));

// ── AND EACH ONE ACTUALLY OPENS ───────────────────────────────────
const errors = [];
for (const lab of LABS) {
  const d = await openDrive({ pagePath: `/lab/${lab.slug}`, tag: `lab-${lab.slug}`,
    settle: 6000, bootTimeout: 45000 });
  await d.page.waitForTimeout(2500);
  const seen = await d.page.evaluate(() => ({
    boot: !!document.getElementById('boot'),
    canvases: document.querySelectorAll('canvas').length,
    painted: (() => {
      const c = document.querySelector('canvas');
      return c ? c.width > 0 && c.height > 0 : false;
    })(),
  }));
  ok(`${lab.slug}: the game's boot splash is gone`, !seen.boot, seen);
  ok(`${lab.slug}: it put a canvas up`, seen.canvases > 0 && seen.painted, seen);
  errors.push(...d.errors);
  await d.close();
}

console.log(bad ? `\n${bad} FAILED` : '\nall good — every lab opens');
report(errors);
if (bad) process.exitCode = 1;
