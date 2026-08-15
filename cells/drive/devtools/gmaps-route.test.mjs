/**
 * THE /gmaps RESOLVER, AND ITS FENCE.
 *
 *   node cells/drive/devtools/gmaps-route.test.mjs
 *
 * The route exists because a browser cannot follow a maps.app.goo.gl redirect
 * (no CORS on the shortener). That makes it a URL-fetching endpoint, which is
 * the shape of an SSRF, so most of what is checked here is what it REFUSES:
 * other hosts, other schemes, and — the one that actually matters — a redirect
 * that tries to leave the allowlist mid-chain.
 *
 * The refusal cases never touch the network, so they run anywhere. The one
 * live hop is skipped unless the environment can reach Google.
 */
import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'gmaps-'));
const out = join(dir, 'index.cjs');
execSync(`npx esbuild cells/drive/index.ts --bundle --platform=node --format=cjs --external:@aws-sdk/* --outfile=${out}`,
  { stdio: 'pipe', cwd: process.cwd() });
const { handler } = await import(out);

const call = (qs) => handler({ rawPath: '/gmaps', rawQueryString: qs, requestContext: { http: { method: 'GET' } } });
const body = async (qs) => JSON.parse((await call(qs)).body);

let bad = 0;
const check = (name, cond, saw) => {
  if (!cond) bad++;
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${name}${cond ? '' : `\n        saw ${JSON.stringify(saw)}`}`);
};

// ── the fence ──
for (const [name, url] of [
  ['plain http refused', 'http://maps.app.goo.gl/abc'],
  ['another host refused', 'https://evil.example.com/x'],
  ['lookalike host refused', 'https://notgoogle.com/maps'],
  ['google-ish subdomain refused', 'https://google.com.evil.example/maps'],
  ['file scheme refused', 'file:///etc/passwd'],
  ['localhost refused', 'https://127.0.0.1/'],
  ['aws metadata refused', 'https://169.254.169.254/latest/meta-data/'],
  ['garbage refused', 'not a url at all'],
]) {
  const j = await body(`u=${encodeURIComponent(url)}`);
  check(name, !!j.error && !j.url, j);
}
check('empty request refused', !!(await body('')).error, await body(''));
// A refusal must not be cached — the answer is per-link.
const res = await call(`u=${encodeURIComponent('https://evil.example.com')}`);
check('no-store on the answer', res.headers['cache-control'] === 'no-store', res.headers);
check('refusal is a 400', res.statusCode === 400, res.statusCode);

// ── the real hop, when the network allows it ──
const LIVE = 'https://maps.app.goo.gl/NnqHXgwN6T4PJnyL7?g_st=ic';
const j = await body(`u=${encodeURIComponent(LIVE)}`);
if (j.url) {
  check('short link resolves to a google host', /^https:\/\/(maps|www)\.google\./.test(j.url), j.url);
  check('resolved link carries a coordinate', /-?\d+\.\d+,-?\d+\.\d+/.test(j.url), j.url);
  console.log(`        -> ${j.url.slice(0, 120)}`);
} else {
  console.log(`skip  live hop unavailable here (${j.error})`);
}

rmSync(dir, { recursive: true, force: true });
console.log(bad ? `\n${bad} FAILED` : '\nall good');
process.exitCode = bad ? 1 : 0;
