#!/usr/bin/env node
/**
 * cell-shot — screenshot a parc.land surface headlessly, signed in, from a
 * Claude Code remote session (or any box behind the agent proxy).
 *
 * The launch flags and auth seeding here are LOAD-BEARING; the why lives in
 * docs/headless-browser-harness.md (short version: the agent proxy's TLS
 * re-termination resets Chromium's post-quantum ML-KEM ClientHello, so ML-KEM
 * must be disabled; and a cell page needs the token in BOTH places — the
 * `parc_session` cookie for authed SSR, `parc.session.tokens` in localStorage
 * for the client's /mcp bearer).
 *
 * Usage:
 *   PARC_TOKEN=tok_… node scripts/cell-shot.mjs [url] [outdir]
 *
 *   url     defaults to https://c15r-home.on.parc.land/
 *   outdir  defaults to ./shots (created if missing)
 *   PARC_TOKEN  optional — omit for the signed-out view
 *   VIEWPORTS   optional — "mobile,desktop" (default), or any of mobile|tablet|desktop
 *
 * Prereqs: `npm i` (playwright is a devDependency; the browser itself is
 * pre-installed at /opt/pw-browsers in remote sessions — do NOT run
 * `playwright install`, PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD is set for a reason).
 */
import { mkdirSync, existsSync } from 'node:fs';
import { chromium } from 'playwright';

const URL_ARG = process.argv[2] ?? 'https://c15r-home.on.parc.land/';
const OUT = process.argv[3] ?? './shots';
const TOKEN = process.env.PARC_TOKEN ?? null;

const ALL_VIEWPORTS = {
  mobile: { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
  tablet: { width: 834, height: 1194, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
  desktop: { width: 1440, height: 900, isMobile: false, hasTouch: false, deviceScaleFactor: 1 },
};
const names = (process.env.VIEWPORTS ?? 'mobile,desktop').split(',').map((s) => s.trim()).filter((n) => n in ALL_VIEWPORTS);

if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

// /opt/pw-browsers/chromium is the pre-installed binary (a pinned-revision
// symlink); passing it explicitly means a project-pinned @playwright/test
// version never tries to fetch its own browser.
const executablePath = existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined;
const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY } : undefined;

const browser = await chromium.launch({
  executablePath,
  proxy,
  args: [
    '--no-sandbox',
    '--disable-dev-shm-usage',
    // The agent proxy's MITM resets a ClientHello carrying an ML-KEM
    // post-quantum key share → net::ERR_CONNECTION_RESET on ALL https.
    // Feature names vary by Chromium version; unknown names are ignored,
    // so list every alias.
    '--disable-features=UseMLKEM,PostQuantumKeyAgreement,PostQuantumKyber,EncryptedClientHello',
  ],
});

const host = new URL(URL_ARG).host;
let failures = 0;
for (const name of names) {
  const vp = ALL_VIEWPORTS[name];
  const ctx = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    isMobile: vp.isMobile,
    hasTouch: vp.hasTouch,
    deviceScaleFactor: vp.deviceScaleFactor,
    // The proxy re-signs TLS with its own CA; Chromium's NSS store is
    // pre-seeded in remote sessions but this keeps the harness portable.
    ignoreHTTPSErrors: true,
  });
  if (TOKEN) {
    // Cookie → dispatch validates it on the top-level navigation → authed SSR.
    await ctx.addCookies([{ name: 'parc_session', value: TOKEN, domain: host, path: '/', secure: true, sameSite: 'Lax' }]);
    // localStorage → the kernel client's bearer for /mcp calls after hydration.
    await ctx.addInitScript(([tok]) => {
      localStorage.setItem('parc.session.tokens', JSON.stringify({ access_token: tok, scope: 'workspace:read workspace:write' }));
    }, [TOKEN]);
  }
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + String(e).slice(0, 200)));
  try {
    await page.goto(URL_ARG, { waitUntil: 'networkidle', timeout: 60000 });
  } catch (e) {
    errors.push('goto: ' + e.message.split('\n')[0]);
  }
  await page.waitForTimeout(6000); // live data fetch + scene settle
  const file = `${OUT}/${host.replace(/[^\w.-]/g, '_')}-${name}.png`;
  await page.screenshot({ path: file });
  if (errors.length) failures++;
  console.log(`${file}  (${errors.length} console error${errors.length === 1 ? '' : 's'})`);
  for (const e of errors.slice(0, 5)) console.log('   !', e);
  await ctx.close();
}
await browser.close();
process.exit(failures ? 1 : 0);
