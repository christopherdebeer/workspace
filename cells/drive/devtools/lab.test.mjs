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
 *
 * AND THE DIAL BARGAIN, which every lab owes: liberal dials, tuning that
 * survives a reload, and a COPY that produces something you can paste into
 * the engine. A lab whose tuning cannot leave it is a toy — so the last block
 * turns a dial, reloads the page, and asserts the number came back.
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
// ── AND THE SAME ROUTES ON THE APEX ──
// The cell is served at `/` on its own host and at `/@owner/cell` on the
// apex. A route matched only on the first falls through on the second and the
// GAME boots — which reads exactly like a lab that was never deployed.
ok('the apex index is the index',
  labRoute('/@c15r/drive/lab')?.slug === null, labRoute('/@c15r/drive/lab'));
ok('an apex lab reaches its lab',
  labRoute('/@c15r/drive/lab/world')?.slug === 'world', labRoute('/@c15r/drive/lab/world'));
ok('the apex game route is not a lab',
  labRoute('/@c15r/drive') === null, labRoute('/@c15r/drive'));
ok('a deep game path is not a lab', labRoute('/some/where') === null, labRoute('/some/where'));
ok('every registered lab has a unique slug',
  new Set(LABS.map((l) => l.slug)).size === LABS.length, LABS.map((l) => l.slug));

const errors = [];

// ── THE INDEX LISTS EVERY LAB ─────────────────────────────────────
// A lab that is built, registered and reachable is still invisible if the
// index does not name it — which is how three labs shipped as dead code.
{
  const d = await openDrive({ pagePath: '/lab', tag: 'lab-index', settle: 3000, bootTimeout: 45000 });
  await d.page.waitForTimeout(1500);
  const listed = await d.page.evaluate(() =>
    [...document.querySelectorAll('a')].map((a) => a.querySelector('b')?.textContent ?? ''));
  ok('the index names every registered lab',
    LABS.every((l) => listed.includes(l.label)) && listed.length === LABS.length,
    { listed, want: LABS.map((l) => l.label) });
  errors.push(...d.errors);
  await d.close();
}

// ── AND EACH ONE ACTUALLY OPENS ───────────────────────────────────
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
  // A CHOOSER PUTS UP CHOICES, not a canvas — see LabEntry.chooser. Held to
  // the same bar in its own terms: every option it offers has to be a link
  // that goes somewhere, or the lab is a page of dead text.
  if (lab.chooser) {
    const links = await d.page.evaluate(() =>
      [...document.querySelectorAll('a')].map((a) => a.getAttribute('href') ?? ''));
    ok(`${lab.slug}: it offers worlds to open`,
      links.length >= 3 && links.every((h) => h.includes('fixture=')), links);
  } else {
    ok(`${lab.slug}: it put a canvas up`, seen.canvases > 0 && seen.painted, seen);
  }
  errors.push(...d.errors);
  await d.close();
}

// ── THE DIAL BARGAIN ──────────────────────────────────────────────
{
  const d = await openDrive({ pagePath: '/lab/marks', tag: 'lab-dials',
    settle: 6000, bootTimeout: 45000 });
  await d.page.waitForTimeout(2500);
  const dialCount = await d.page.evaluate(() =>
    document.querySelectorAll('.lab-dials .d').length);
  ok('the marks lab is liberal with its dials', dialCount >= 10, dialCount);
  const buttons = await d.page.evaluate(() =>
    [...document.querySelectorAll('.lab-dials button')].map((b) => b.textContent));
  ok('copy, paste and reset are all offered',
    ['COPY', 'PASTE', 'RESET'].every((b) => buttons.includes(b)), buttons);

  // Turn one, and make sure it is the ENGINE that moved rather than a slider.
  await d.page.evaluate(() => {
    const el = document.getElementById('sizeMin');
    el.value = '2.75';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await d.page.waitForTimeout(400);
  const stored = await d.page.evaluate(() => localStorage.getItem('drive.lab.marks.dials'));
  ok('the tuning is saved as it is turned',
    !!stored && JSON.parse(stored).sizeMin === 2.75, stored?.slice(0, 90));

  // COPY has to produce something that could be pasted into the source. Read
  // the panel's own mirror rather than the clipboard: a clipboard read needs
  // a permission headless does not grant, and it HANGS rather than failing.
  const text = await d.page.evaluate(() => {
    const btn = [...document.querySelectorAll('.lab-dials button')].find((b) => b.textContent === 'COPY');
    btn?.click();
    return document.querySelector('.lab-dials')?.dataset.lastCopy ?? '';
  });
  ok('copy writes the engine literal',
    typeof text === 'string' && text.includes('MARK_TUNING') && text.includes('sizeMin: 2.75'),
    String(text).slice(0, 120));

  // …and it must still be there after a reload, which is the whole point.
  await d.page.reload({ waitUntil: 'domcontentloaded' });
  await d.page.waitForTimeout(3500);
  const back = await d.page.evaluate(() => document.getElementById('sizeMin')?.value);
  ok('the tuning survives a reload', back === '2.75', back);
  errors.push(...d.errors);
  await d.close();
}

console.log(bad ? `\n${bad} FAILED` : '\nall good — every lab opens, and its tuning can leave');
report(errors);
if (bad) process.exitCode = 1;
