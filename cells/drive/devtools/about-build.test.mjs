/**
 * WHICH BUILD AM I LOOKING AT — and is it the one the server has?
 *
 *   node cells/drive/devtools/about-build.test.mjs
 *
 * The web cell stamps the shell with a hash of the app.js it served and the
 * ABOUT page reads it back, then asks `/build` for the server's current stamp
 * and compares. A cached shell carries the stamp it was cached with, which is
 * the whole point: that is what "am I on a stale build" means. The harness
 * serves both halves (HARNESS_BUILD in the shell, HARNESS_SERVED from the
 * route), so both verdicts are reproducible here without deploying anything.
 */
import { openDrive } from './harness.mjs';

const rowsOf = async (page) => {
  await page.evaluate(() => window.__menutab(6));
  await page.waitForTimeout(1200);
  return page.evaluate(() => {
    const out = {};
    for (const tr of document.querySelectorAll('table.m-kv tr')) {
      const td = tr.querySelectorAll('td');
      if (td.length === 2) out[td[0].textContent.trim()] = td[1].textContent.trim();
    }
    return out;
  });
};
const fails = [];
const ok = (what, cond, saw) => {
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${what}${cond ? '' : ` — saw ${JSON.stringify(saw)}`}`);
  if (!cond) fails.push(what);
};

// ── the build it booted from is the build the server has ──
process.env.HARNESS_BUILD = 'aaaa1111bbbb';
delete process.env.HARNESS_SERVED;
{
  const d = await openDrive({ spot: 'fixture=at-campsbay&cam=chase&nodraw=1', tag: 'about-current', menu: false, settle: 0, bootTimeout: 180000 });
  const rows = await rowsOf(d.page);
  ok('ABOUT names the build in the shell it booted from', rows.BUILD === 'aaaa1111bbbb', rows);
  ok('and reports it as current when the server agrees', rows.SERVING === 'CURRENT', rows);
  await d.close();
}

// ── the shell is older than what the server is serving ──
process.env.HARNESS_BUILD = 'aaaa1111bbbb';
process.env.HARNESS_SERVED = 'cccc2222dddd';
{
  const d = await openDrive({ spot: 'fixture=at-campsbay&cam=chase&nodraw=1', tag: 'about-stale', menu: false, settle: 0, bootTimeout: 180000 });
  const rows = await rowsOf(d.page);
  ok('a cached shell still names ITS build, not the server\'s', rows.BUILD === 'aaaa1111bbbb', rows);
  ok('and says so, with the server\'s stamp and what to do about it',
    rows.SERVING === 'STALE — SERVER HAS cccc2222dddd — RELOAD', rows);
  await d.close();
}

if (fails.length) { console.error(`\nFAIL ${fails.length}: ${fails.join(' · ')}`); process.exit(1); }
console.log('\nall good — the page names its build and knows when it is behind');
