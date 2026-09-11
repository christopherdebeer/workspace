/**
 * THE ABOUT PAGE, AND THE ROW IT REPLACED.
 *
 *   node cells/drive/devtools/about.test.mjs
 *
 * An attribution page is the one screen whose CONTENT is the feature: it exists
 * because most of this world is other people's surveys, given on terms that ask
 * for credit. So this asserts the credits are actually on the screen, not that
 * a tab opened — a page that renders empty looks exactly like a page that
 * renders, from anywhere but a screenshot.
 *
 * It also asserts the swap: PROGRESS is gone from the splash (signed in it did
 * nothing but hop to SETTINGS, one row above it), and SIGN IN is still there
 * when it means something.
 */
import { openDrive, report } from './harness.mjs';

let bad = 0;
const check = (name, cond, saw) => {
  if (!cond) bad++;
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${name}${cond ? '' : `\n        saw ${JSON.stringify(saw)}`}`);
};

const d = await openDrive({ spot: 'lat=46.55&lon=10.44&h=277&cam=chase&wx=clear', tag: 'about', settle: 16000 });

const splash = await d.page.evaluate(() => {
  window.__menutab?.(0);
  const rows = [...document.querySelectorAll('#menu .m-navrow')];
  return rows.map((r) => ({
    name: r.querySelector('.name')?.textContent ?? '',
    sub: r.querySelector('.sub')?.textContent ?? '',
    shown: getComputedStyle(r).display !== 'none',
  }));
});
console.log('splash rows:', JSON.stringify(splash.filter((r) => r.shown).map((r) => r.name)));
const shown = splash.filter((r) => r.shown).map((r) => r.name);
check('ABOUT is on the splash', shown.includes('ABOUT'), shown);
check('PROGRESS is not', !shown.includes('PROGRESS'), shown);
// ── THE PRIMARY STACK, IN ITS DOCUMENTED ORDER ──
// This asserted `shown[0] === 'THE LINE'` and had been failing since before
// the splash gained its device toggles — measured on the parent commit, which
// fails it identically. RIG-MENU-2026-09-08.md states the order outright:
// "Primary navigation is Rig, Drives, Surveys, The Line", and THE LINE is
// appended to the nav LAST, so the assertion contradicted the shipped design
// rather than catching a regression in it. Asserting the whole documented
// order is stricter than the line it replaces, not looser: it would catch a
// reshuffle of any of the four, which `[0]` never could.
check('the primary stack is RIG · DRIVES · SURVEYS · THE LINE',
  ['RIG', 'DRIVES', 'SURVEYS', 'THE LINE'].every((n, i) => shown[i] === n), shown);

const page = await d.page.evaluate(() => {
  window.__menutab?.(6);
  const b = document.querySelector('#menu .m-body');
  return {
    title: document.querySelector('#menu .m-title')?.textContent ?? '',
    sects: [...b.querySelectorAll('.m-sect')].map((e) => e.textContent),
    names: [...b.querySelectorAll('.m-credit')].map((e) => e.textContent),
    dim: [...b.querySelectorAll('.m-dimline')].map((e) => e.textContent),
    kv: [...b.querySelectorAll('table.m-kv td')].map((e) => e.textContent),
  };
});
console.log('sections:', page.sects.length, '· credited:', page.names.length);
for (const n of page.names) console.log('   ', n);
console.log('build row:', JSON.stringify(page.kv));

check('the page is titled ABOUT', page.title === 'ABOUT', page.title);
// The licences that actually oblige us, named on the screen.
for (const who of ['OpenStreetMap', 'Mapterhorn', 'ESA WorldCover', 'Open-Meteo',
  'RESOLVE Ecoregions', 'Natural Earth', 'EZ-Tree', 'three.js', 'Silkscreen']) {
  check(`${who} is credited`, page.names.some((n) => n.includes(who)), page.names);
}
for (const terms of ['ODbL', 'CC BY 4.0', 'MIT', 'public domain', 'SIL Open Font']) {
  check(`the terms "${terms}" appear`, page.dim.some((t) => t.includes(terms)), null);
}
check('and the build names itself', page.kv.includes('BUILD'), page.kv);
// THE ONE THE DOM CANNOT SEE. textContent is whole however the box clips, so
// the first version of this page ellipsised half its credits and passed every
// assertion. Measured against the element's own scroll width instead.
const clipped = await d.page.evaluate(() => [...document.querySelectorAll('#menu .m-credit')]
  .filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => e.textContent));
check('no credit is visually truncated', clipped.length === 0, clipped);
check('no page errors', d.errors.length === 0, d.errors);

await d.page.evaluate(() => window.__menutab?.(6));
await d.shot('about-page');
console.log(bad ? `\n${bad} FAILED` : '\nall ok');
report(d.errors);
await d.close();
