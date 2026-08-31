/**
 * COMING BACK FROM A SIGN-IN.
 *
 *   node cells/drive/devtools/sync-return.test.mjs
 *
 * The OAuth redirect lands on `?code=…&state=…`, which has replaced a URL that
 * said where the truck was, which way it faced, what the weather was doing and
 * which job was armed. Half of `main.ts` reads those at import time. So the
 * restore is synchronous and happens first, and this is the test that says so —
 * a sign-in that quietly teleports you to the default spawn would be a worse
 * bug than never syncing at all.
 *
 * Then the rest of the loop, with the apex and the cell's own `/state` stubbed:
 * the code is spent, the bearer goes out on the sync, and a road claimed on
 * ANOTHER device arrives here as claimed. That last one is the whole point of
 * the feature — everything else is plumbing around it.
 */
import { openDrive, report } from './harness.mjs';

const SPOT = { lat: -34.09905, lon: 18.37835, h: 290 };
const BACK = `lat=${SPOT.lat}&lon=${SPOT.lon}&h=${SPOT.h}&cam=chase&wx=storm`;
const FAR = 'Ou Kaapse Weg@-34,18';   // claimed on the other device, never driven here

let bad = 0;
const check = (name, cond, saw) => {
  if (!cond) bad++;
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${name}${cond ? '' : `\n        saw ${JSON.stringify(saw)}`}`);
};

// The page comes up mid-return: a code in the URL, and the sign-in this game
// started still waiting in sessionStorage.
const d = await openDrive({
  spot: 'code=test-code&state=test-state',
  tag: 'syncret',
  menu: false,
  init: `(() => {
    const origin = location.origin;
    sessionStorage.setItem('drive.sync.ret', origin + '/?${BACK}');
    sessionStorage.setItem('drive.sync.state', 'test-state');
    sessionStorage.setItem('drive.sync.pkce', 'test-verifier');
    localStorage.setItem('drive.sync.client', 'test-client');
    window.__seen = { token: null, state: [] };
  })()`,
  route: async (page) => {
    await page.route(/parc\.land\/oauth\/token/, async (route) => {
      const sent = JSON.parse(route.request().postData() ?? '{}');
      await page.evaluate((s) => { window.__seen.token = s; }, sent).catch(() => null);
      return route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ access_token: 'tok_test', scope: 'cell:c15r/drive:*', expires_in: 3600 }) });
    });
    await page.route(/\/state$/, async (route) => {
      const req = route.request();
      await page.evaluate((s) => { window.__seen.state.push(s); },
        { method: req.method(), auth: req.headers()['authorization'] ?? null,
          body: req.postData() ?? null }).catch(() => null);
      return route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ user: 'c15r', odo: 1551000,
          roads: { [FAR]: { g: 40, t: 40, c: 1700000000000 } },
          missions: { 'chapmans-run': 1700000000001 },
          stations: { 'pd-17': 1700000000002 } }) });
    });
  },
});

// ── the URL ──
const url = new URL(d.page.url());
check('the code is gone from the address', !url.searchParams.get('code'), d.page.url());
check('…and the player’s own URL is back, whole',
  url.searchParams.get('lat') === String(SPOT.lat) && url.searchParams.get('h') === String(SPOT.h),
  d.page.url());
// The URL being right is not the same as the world being built from it.
const where = await d.page.evaluate(() => window.__origin());
check('…and the world was actually built there, not at the default spawn',
  Math.abs(where.lat - SPOT.lat) < 1e-4 && Math.abs(where.lon - SPOT.lon) < 1e-4, where);

// ── the loop ──
await d.page.waitForFunction(() => window.__sync && window.__sync().phase !== 'busy', null, { timeout: 60000 })
  .catch(() => null);
const seen = await d.page.evaluate(() => window.__seen);
const status = await d.page.evaluate(() => window.__sync());
check('the code was spent, with the verifier that was waiting for it',
  seen.token?.code === 'test-code' && seen.token?.code_verifier === 'test-verifier', seen.token);
check('the sync went out as the signed-in player',
  seen.state.some((s) => s.auth === 'Bearer tok_test'), seen.state);
check('…as a POST, which pushes and pulls in one round trip',
  seen.state.some((s) => s.method === 'POST'), seen.state.map((s) => s.method));
check('…and it says who it is now', status.user === 'c15r' && status.phase === 'on', status);

const store = await d.page.evaluate(() => window.__surveyStore());
check('a road claimed on another device arrived claimed',
  store.top.some((r) => r.id === FAR && r.done > 0), store.top);
const odo = await d.page.evaluate(() => window.__odo());
check('…and so did the odometer', odo.total >= 1551000, odo);
// The marks travel with the roads: a mission finished and a station woken on
// the other device arrive here as done — the campaign's spine syncing.
const mk = await d.page.evaluate(() => window.__marks());
check('…and a mission and a station done elsewhere arrived latched',
  mk.missions === 1 && mk.stations === 1, mk);

console.log(bad ? `\n${bad} FAILED` : '\nall good');
report(d.errors);
await d.close();
process.exitCode = bad ? 1 : 0;
