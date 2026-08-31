/**
 * THE WAY IN, AND WHAT IT ASKS FOR.
 *
 *   node cells/drive/devtools/sync-cta.test.mjs
 *
 * Two things, and the second is the important one.
 *
 * THE OFFER has to be on the splash. A sign-in buried three screens down is a
 * sign-in nobody finds until after they have driven a thousand kilometres and
 * lost it — so the row sits in the hub's own stack, and this checks it is there,
 * says what it buys, and starts the redirect.
 *
 * THE REQUEST is the security claim of the whole feature, and until this test
 * existed nothing asserted it. `cellCeiling()` caps a cell token at
 * `workspace:read`, `workspace:write` and `cell:<owner>/<name>:*` — but the cap
 * is an INTERSECTION with what was asked for, so what drive asks for IS what
 * drive gets. It must ask for the cell scope ALONE. If `workspace:` ever
 * appears in that authorize URL, signing into a driving game has started
 * handing over a player's whole workspace, and the isolation in
 * `docs/drive-persistence.md` is gone.
 *
 * So the apex is stubbed and the authorize URL is read back, parameter by
 * parameter, from the navigation the button actually causes.
 */
import { openDrive, report } from './harness.mjs';

let bad = 0;
const check = (name, cond, saw) => {
  if (!cond) bad++;
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${name}${cond ? '' : `\n        saw ${JSON.stringify(saw)}`}`);
};

let authorize = null;
const d = await openDrive({
  spot: 'lat=-34.09905&lon=18.37835&h=0&cam=chase&wx=clear',
  tag: 'synccta',
  menu: false,                          // the splash IS the screen under test
  route: async (page) => {
    await page.route(/parc\.land\/oauth\/register/, (route) => route.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify({ client_id: 'client-test' }),
    }));
    // The redirect the button causes. Answered with a blank page so the test
    // can read where it was going instead of leaving the origin.
    // Recorded and then ABORTED, so the page stays on the game's own origin —
    // sessionStorage is per-origin, and the stashed return URL is only readable
    // from the side that wrote it.
    await page.route(/parc\.land\/oauth\/authorize/, (route) => {
      authorize = new URL(route.request().url());
      return route.abort();
    });
  },
});

// ── the offer ──
const rows = await d.page.evaluate(() => {
  window.__menutab(0);
  return [...document.querySelectorAll('#menu .m-navrow')].map((r) => ({
    name: r.querySelector('.name')?.textContent ?? '',
    sub: r.querySelector('.sub')?.textContent ?? '',
  }));
});
const cta = rows.find((r) => r.name === 'SIGN IN');
check('the splash offers it, in the stack with the other sections', !!cta, rows);
check('…and says what it buys rather than demanding anything',
  /PROGRESS/.test(cta?.sub ?? ''), cta);
console.log(`        rows: ${rows.map((r) => r.name).join(' · ')}`);

// ── the request ──
await d.page.evaluate(() => {
  const row = [...document.querySelectorAll('#menu .m-navrow')]
    .find((r) => r.querySelector('.name')?.textContent === 'SIGN IN');
  row.dispatchEvent(new MouseEvent('click', { bubbles: true }));
});
await d.page.waitForTimeout(2500);

check('tapping it goes to the apex to sign in', !!authorize, authorize);
const q = authorize?.searchParams;
check('THE SCOPE IS THE CELL ALONE — no workspace read, no workspace write',
  q?.get('scope') === 'cell:c15r/drive:*', q?.get('scope'));
check('…and PKCE, with the challenge hashed rather than sent plain',
  q?.get('code_challenge_method') === 'S256' && (q?.get('code_challenge') ?? '').length > 20,
  { m: q?.get('code_challenge_method'), c: q?.get('code_challenge') });
check('…coming back to this origin, not somewhere else',
  (q?.get('redirect_uri') ?? '').startsWith(new URL(d.page.url()).origin)
  || (q?.get('redirect_uri') ?? '').startsWith('http://localhost'), q?.get('redirect_uri'));
check('…with a state to match the return against', (q?.get('state') ?? '').length >= 8, q?.get('state'));
console.log(`        scope=${q?.get('scope')}  redirect=${q?.get('redirect_uri')}`);

// The stash that carries the player's drive across the redirect is NOT checked
// here: by this point the tab has committed a navigation to the apex origin, and
// `sessionStorage` belongs to the side that wrote it. `sync-return.test.mjs`
// covers it from the far end, which is the only place it matters — the URL comes
// back whole, and the world is rebuilt where it said.

console.log(bad ? `\n${bad} FAILED` : '\nall good');
report(d.errors);
await d.close();
process.exitCode = bad ? 1 : 0;
