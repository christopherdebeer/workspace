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
    if (lab.slug === 'hydro') {
      const hydro = await d.page.evaluate(() => ({
        sections: [...document.querySelectorAll('details.section > summary')]
          .map((summary) => summary.textContent?.trim() ?? ''),
        status: document.getElementById('status')?.textContent ?? '',
      }));
      ok('hydro: weather, surface, river and sampling controls are collapsible',
        ['WEATHER', 'SURFACE', 'RIVER DETAIL', 'SAMPLING']
          .every((section) => hydro.sections.includes(section)),
        hydro.sections);
      ok('hydro: canonical shoreline topology is visible in the lab',
        /SHORE TOPOLOGY [1-9][0-9,]* SEGMENTS · TERRAIN CONSTRAINED/
          .test(hydro.status),
        hydro.status);
    }
  }
  errors.push(...d.errors);
  await d.close();
}

// ── SUBSTRATE AUTHORITY IS INSPECTABLE, NOT JUST COUNTED ─────────
{
  const d = await openDrive({ pagePath: '/lab/substrate', tag: 'lab-substrate-authority',
    settle: 6000, bootTimeout: 45000 });
  await d.page.waitForTimeout(2500);
  const initial = await d.page.evaluate(() => ({
    sections: [...document.querySelectorAll('.lab-dials .sec .sh span:first-child')]
      .map((s) => s.textContent),
    options: [...document.querySelectorAll('#authorityCase option')].map((o) => o.value),
    status: document.getElementById('substrate-status')?.textContent ?? '',
  }));
  ok('substrate lab exposes a collapsible authority/parity section',
    initial.sections.includes('AUTHORITY / PARITY'), initial.sections);
  ok('substrate lab offers matching, missing, procedural and unresolved evidence',
    ['matching', 'missing', 'procedural', 'unresolved']
      .every((value) => initial.options.includes(value)), initial.options);
  ok('substrate lab reports the selected crossing authority and implementation',
    initial.status.includes('AUTH FORD · EXPLICIT-TAG · NOT-REQUIRED')
      && initial.status.includes('EARTHWORK OPEN CHANNEL · FORD SUPPORT')
      && initial.status.includes('SOURCE MESHES RETIRED AFTER COMMIT')
      && initial.status.includes('CUTOVER GATES WET Δ <0.1%'),
    initial.status);

  await d.page.evaluate(() => {
    const select = document.getElementById('authorityCase');
    select.value = 'unresolved';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await d.page.waitForTimeout(300);
  const unresolved = await d.page.evaluate(() =>
    document.getElementById('substrate-status')?.textContent ?? '');
  ok('substrate lab makes unresolved production evidence visible',
    unresolved.includes('AUTH UNRESOLVED · UNRESOLVED · MISSING')
      && unresolved.includes('structure outcome=none')
      && unresolved.includes('EARTHWORK WITHHELD · CONSERVATIVE ROAD PLUG'),
    unresolved);
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

// ── THE FAÇADE LAB KEEPS THE SAME BARGAIN ────────────────────────
// A second lab on the same panel, held to the same three promises — and to a
// fourth that is its own: the numbers it reports are the numbers the world
// would build, so the plinth finding (a door head 0.46 m above the pavement
// on flat ground) has to be READABLE off the probe, not eyeballed off a frame.
{
  const d = await openDrive({ pagePath: '/lab/facade', tag: 'lab-facade',
    settle: 6000, bootTimeout: 45000 });
  await d.page.waitForTimeout(2500);
  const dialCount = await d.page.evaluate(() =>
    document.querySelectorAll('.lab-dials .d').length);
  ok('the façade lab is liberal with its dials', dialCount >= 30, dialCount);
  const rep = await d.page.evaluate(() => window.__facade?.());
  ok('it reports the grammar against the massing',
    !!rep && typeof rep.bays === 'number' && typeof rep.doorHeadAboveGround === 'number'
      && rep.grammar?.bayM === 2.75 && rep.grammar?.storeyM === 3.1, rep);
  // THE GAME'S RULE NOW: the base is the ground line, so a 3.1 m row stands
  // 3.1 m over the grass and a door's head at 0.6 x 3.1, whatever the plinth.
  ok('…and the base is the ground line, whatever the plinth',
    !!rep && Math.abs(rep.row1AboveGround - 3.1) < 1e-6 && Math.abs(rep.doorHeadAboveGround - 1.86) < 1e-6, rep);
  // …AND THE RULE IT REPLACED IS ONE TOGGLE AWAY, so the A/B stays honest: a
  // 1.4 m plinth under a 3.1 m row put the ground row 1.7 m above the grass
  // and the door's head at 0.46 m, which is what every building had.
  await d.page.evaluate(() => {
    const el = document.getElementById('baseGround');
    el.checked = false;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await d.page.waitForTimeout(400);
  const old = await d.page.evaluate(() => window.__facade?.());
  ok('…and BASE = GROUND off is the plinth-bottom rule the lab found',
    !!old && Math.abs(old.row1AboveGround - 1.7) < 1e-6 && Math.abs(old.doorHeadAboveGround - 0.46) < 1e-6, old);
  await d.page.evaluate(() => {
    const el = document.getElementById('bayM');
    el.value = '3.25';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await d.page.waitForTimeout(400);
  const moved = await d.page.evaluate(() => window.__facade?.().grammar.bayM);
  ok('a dial moves the ENGINE\'s grammar, not a slider', moved === 3.25, moved);
  const stored = await d.page.evaluate(() => localStorage.getItem('drive.lab.facade.dials'));
  ok('the grammar is saved as it is turned',
    !!stored && JSON.parse(stored).bayM === 3.25, stored?.slice(0, 90));
  const text = await d.page.evaluate(() => {
    const btn = [...document.querySelectorAll('.lab-dials button')].find((b) => b.textContent === 'COPY');
    btn?.click();
    return document.querySelector('.lab-dials')?.dataset.lastCopy ?? '';
  });
  ok('copy writes the FACADE_GRAMMAR literal',
    typeof text === 'string' && text.includes('FACADE_GRAMMAR') && text.includes('bayM: 3.25'),
    String(text).slice(0, 120));
  await d.page.reload({ waitUntil: 'domcontentloaded' });
  await d.page.waitForTimeout(3500);
  const back = await d.page.evaluate(() => document.getElementById('bayM')?.value);
  ok('the grammar survives a reload', back === '3.25', back);
  // A TRADITION ON THE SAME WALL, BY EITHER ROAD. Choosing t:cape sets the
  // grammar dials to what the atlas states (the uniforms' road); VIA ATTRIBUTE
  // parks the uniforms at the defaults and hands the wall its row through
  // aGram (the world's road). The report says which is in force.
  await d.page.evaluate(() => {
    const el = document.getElementById('culture');
    el.value = 't:cape';
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await d.page.waitForTimeout(600);
  const cape = await d.page.evaluate(() => window.__facade?.());
  ok('choosing a tradition dresses the wall as the atlas states',
    !!cape && cape.tradition === 'cape' && cape.gramIndex === 0 && Math.abs(cape.grammar.bayM - 3.3) < 1e-9, cape);
  await d.page.evaluate(() => {
    const el = document.getElementById('viaAttr');
    el.checked = true;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await d.page.waitForTimeout(600);
  const via = await d.page.evaluate(() => window.__facade?.());
  ok('…and VIA ATTRIBUTE hands it the row instead, with the uniforms at the defaults',
    !!via && via.viaAttribute === true && via.gramIndex > 0 && Math.abs(via.grammar.bayM - 2.75) < 1e-9, via);
  // Put it back, so the next lab run — and anyone opening the lab on this
  // browser profile — starts from the engine's defaults.
  await d.page.evaluate(() => localStorage.removeItem('drive.lab.facade.dials'));
  errors.push(...d.errors);
  await d.close();
}

// ── AND THE PANEL FITS ON THE SCREEN ─────────────────────────────
// Being liberal with the dials is the bargain; the cost is a panel that can be
// taller than the viewport. It used to be one scrolling box with COPY, PASTE
// and RESET at the bottom OF the scroll — so on a short screen the tuning
// could be turned and then not taken out, which defeats the whole point. Head
// and foot are pinned now, and both folds are asserted here because neither is
// visible in a screenshot of a lab that happens to be tall enough.
{
  const d = await openDrive({ pagePath: '/lab/flora', tag: 'lab-fold',
    settle: 5000, bootTimeout: 45000 });
  await d.page.setViewportSize({ width: 900, height: 560 });
  await d.page.waitForTimeout(2500);

  const reach = await d.page.evaluate(() => {
    const bar = document.querySelector('.lab-dials .foot');
    const r = bar.getBoundingClientRect();
    return { inView: r.top >= 0 && r.bottom <= innerHeight,
      buttons: [...bar.querySelectorAll('button')].map((b) => b.textContent) };
  });
  ok('the buttons stay reachable on a short viewport',
    reach.inView && ['COPY', 'PASTE', 'RESET'].every((b) => reach.buttons.includes(b)), reach);

  const secs = await d.page.evaluate(() =>
    [...document.querySelectorAll('.lab-dials .sec .sh span:first-child')].map((s) => s.textContent));
  ok('the dials are grouped into sections', secs.length >= 3, secs);

  // Fold one section, reload, and it has to still be folded.
  await d.page.evaluate((want) => {
    const h = [...document.querySelectorAll('.lab-dials .sh')]
      .find((x) => x.textContent.includes(want));
    h.click();
  }, secs[secs.length - 1]);
  await d.page.waitForTimeout(300);
  await d.page.reload({ waitUntil: 'domcontentloaded' });
  await d.page.waitForTimeout(3500);
  const stuck = await d.page.evaluate(() =>
    [...document.querySelectorAll('.lab-dials .sec')].map((s) => s.dataset.shut));
  ok('a folded section stays folded across a reload',
    stuck.length >= 3 && stuck[stuck.length - 1] === '1' && stuck[0] === '0', stuck);

  // …and the whole panel folds to its title bar, giving the page the gutter.
  await d.page.keyboard.press('h');
  await d.page.waitForTimeout(350);
  const shut = await d.page.evaluate(() => ({
    shut: document.querySelector('.lab-dials').dataset.shut,
    gutter: getComputedStyle(document.documentElement).getPropertyValue('--dials-w').trim(),
    bodyShown: getComputedStyle(document.querySelector('.lab-dials .body')).display,
  }));
  ok('H folds the whole panel and gives back the gutter',
    shut.shut === '1' && shut.gutter === '0px' && shut.bodyShown === 'none', shut);
  errors.push(...d.errors);
  await d.close();
}

console.log(bad ? `\n${bad} FAILED` : '\nall good — every lab opens, and its tuning can leave');
report(errors);
if (bad) process.exitCode = 1;
