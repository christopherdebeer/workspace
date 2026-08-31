// The 401 -> refresh -> retry path, end to end in the page: seed a stale
// access token + a refresh token, serve /state 401-once-then-200 and the
// apex token endpoint from routes, and watch the session SURVIVE the hour.
import { openDrive } from './harness.mjs';
let stateCalls = 0, tokenCalls = 0, sawBearer = [];
const d = await openDrive({
  spot: 'lat=-20.1338&lon=-67.4891&h=0&cam=chase&wx=clear&time=NOON', tag: 'refresh', settle: 25000,
  init: `try {
    localStorage.setItem('drive.sync.token', 'tok_stale');
    localStorage.setItem('drive.sync.refresh', 'rt_good');
    localStorage.setItem('drive.sync.client', 'client_x');
  } catch {}`,
  route: async (page) => {
    await page.route('**/state', (r) => {
      stateCalls++;
      const auth = r.request().headers()['authorization'] ?? '';
      sawBearer.push(auth.replace('Bearer ', ''));
      if (auth.includes('tok_stale')) {
        return r.fulfill({ status: 401, contentType: 'application/json', body: '{"error":"expired"}' });
      }
      return r.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ user: 'c15r', roads: {}, odo: 0 }) });
    });
    await page.route('**/oauth/token', (r) => {
      tokenCalls++;
      const body = JSON.parse(r.request().postData() ?? '{}');
      if (body.grant_type === 'refresh_token' && body.refresh_token === 'rt_good') {
        return r.fulfill({ status: 200, contentType: 'application/json',
          body: JSON.stringify({ access_token: 'tok_fresh', refresh_token: 'rt_good', expires_in: 3600 }) });
      }
      return r.fulfill({ status: 400, contentType: 'application/json', body: '{"error":"invalid_grant"}' });
    });
  },
});
const page = d.page;
await page.waitForTimeout(6000);
const s = await page.evaluate(() => ({
  phase: window.__sync ? window.__sync().phase : null,
  tok: localStorage.getItem('drive.sync.token'),
  ref: localStorage.getItem('drive.sync.refresh'),
}));
console.log('after boot sync:', JSON.stringify(s));
console.log('state calls:', stateCalls, 'bearers:', JSON.stringify(sawBearer.slice(0, 4)), 'token endpoint calls:', tokenCalls);
let bad = 0;
const check = (n, c, saw) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${n}${c ? '' : ' saw ' + JSON.stringify(saw)}`); if (!c) bad++; };
check('the stale bearer 401d and was retried with a fresh one', sawBearer.includes('tok_stale') && sawBearer.includes('tok_fresh'), sawBearer);
check('exactly one refresh round trip', tokenCalls === 1, tokenCalls);
check('the fresh access token is stored', s.tok === 'tok_fresh', s.tok);
check('the refresh credential survives', s.ref === 'rt_good', s.ref);
check('the session did NOT sign out', s.phase !== 'off', s.phase);
console.log('pageerrors:', d.errors.length, d.errors.slice(0, 2));
await d.close?.();
process.exit(bad || d.errors.length ? 1 : 0);
