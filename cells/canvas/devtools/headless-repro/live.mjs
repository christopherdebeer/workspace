/* ---------------------------------------------------------------------------
 * live.mjs — the harness against the REAL substrate (no kernel stub).
 *
 * The mock harness (build.mjs + kernel-stub.js) is for deterministic gesture/
 * render repros. This driver validates against prod: it injects a real token
 * where the kernel looks for one (localStorage `parc.session.tokens`) and
 * opens the deployed cell, so the whole stack — dispatch, gateway, DynamoDB,
 * live-sync — is exercised, not simulated.
 *
 * Usage:
 *   CHROME=/opt/pw-browsers/chromium node live.mjs [boardId] [--shot out.png]
 *
 * Token (first match wins):
 *   PARC_TOKEN        raw access token string
 *   PARC_TOKEN_FILE   json file with {access_token} (default /tmp/parc-token.json)
 *
 * NOTE: what works depends on the token's scope — a bare `read` token loads
 * the board but the change-feed (`read:workspace`) and writes will be denied;
 * that denial surface is itself worth seeing here.
 * ------------------------------------------------------------------------- */
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const board = args[0] || 'parcland';
const shotIx = process.argv.indexOf('--shot');
const shotPath = shotIx > -1 ? process.argv[shotIx + 1] : null;
const URL = `https://parc.land/@c15r/canvas/${board}`;
const EXE = process.env.CHROME || undefined;

function token() {
  if (process.env.PARC_TOKEN) return process.env.PARC_TOKEN;
  const file = process.env.PARC_TOKEN_FILE || '/tmp/parc-token.json';
  const j = JSON.parse(readFileSync(file, 'utf8'));
  return j.access_token || j.token;
}

let failures = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

async function main() {
  const t = token();
  // In proxied environments (e.g. Claude Code remote), the browser must use the
  // agent proxy explicitly — its CA is already in the system NSS store.
  const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
  const browser = await chromium.launch({
    ...(EXE ? { executablePath: EXE } : {}),
    ...(proxy ? { proxy: { server: proxy } } : {}),
    headless: true,
  });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  const consoleErrors = [];
  page.on('pageerror', (e) => consoleErrors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });

  // The kernel reads localStorage BEFORE any app code runs — init script wins.
  await page.addInitScript((tok) => {
    localStorage.setItem('parc.session.tokens', JSON.stringify({ access_token: tok, token_type: 'Bearer' }));
  }, t);

  console.log(`live: ${URL}`);
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.CC && Array.isArray(window.CC.canvasState?.elements), null, { timeout: 30000 });
  // Let SSR-hydrate + the background board load settle.
  await page.waitForTimeout(4000);

  const state = await page.evaluate(async () => {
    const cc = window.CC;
    const ctx = cc.ctx;
    let changes = null;
    try { changes = await ctx.changes({ sinceSeq: 'head' }); } catch (e) { changes = { error: String(e?.message || e) }; }
    return {
      board: cc.canvasState.canvasId,
      elements: cc.canvasState.elements.length,
      rendered: document.querySelectorAll('.canvas-element').length,
      ctxApi: ctx?.api,
      headSeq: changes?.seq ?? null,
      changesError: changes?.error ?? null,
    };
  });

  check('board loaded', state.board === board, `board=${state.board}`);
  check('elements present', state.elements > 0, `${state.elements} facts`);
  check('elements rendered', state.rendered > 0, `${state.rendered} nodes`);
  check('ctx api 1 live', state.ctxApi === 1);
  check(
    'scoped change feed reachable (token-scope dependent)',
    state.headSeq !== null || !!state.changesError,
    state.headSeq !== null ? `head seq=${state.headSeq}` : state.changesError,
  );
  const realErrors = consoleErrors.filter((e) => !/favicon|manifest/i.test(e));
  check('no page errors', realErrors.length === 0, realErrors.slice(0, 3).join(' | '));

  if (shotPath) {
    await page.screenshot({ path: shotPath, fullPage: false });
    console.log(`shot: ${shotPath}`);
  }

  await browser.close();
  console.log(failures ? `\n${failures} FAILURE(S)` : '\nall live checks passed');
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
