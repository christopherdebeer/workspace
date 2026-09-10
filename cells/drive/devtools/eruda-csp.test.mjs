// THE CONSOLE'S PROMPT RUNS ONLY ON A LOAD THAT ASKED FOR IT — under the
// browser's own enforcement, not a grep of the header.
//
//   node cells/drive/devtools/eruda-csp.test.mjs
//
// The harness sends no CSP unless a test passes one in (`csp:`), and then the
// browser enforces it on the page exactly as the phone does: script-src
// decides whether the eruda tag may load at all, and 'unsafe-eval' decides
// whether anything on the page may evaluate a string. So the page is served
// twice, once under each policy the cell exports, and both halves of the
// contract are read off the browser: under CSP the console loads (jsdelivr is
// a listed host) and a string cannot be evaluated — the seat's exact report —
// and under CSP_EVAL it can.
//
// READ OFF PAGE SCRIPT, NOT OFF page.evaluate. The first cut tried
// `new Function` inside page.evaluate and it succeeded under the locked
// header: evaluation through the DevTools protocol is exempt from the
// policy's eval rule, so that probe says yes under any header and proves
// nothing. eruda's prompt is page script; so is the check main.ts makes once
// at boot and reports as __eruda().evalAllowed, and that is what is read.
// What this still cannot see is which policy the LIVE cell hands a `?eruda=1`
// navigation, or whether the service worker gives it the network rather than
// the cached shell; that is the curl after a deploy, and then the phone.
import { openDrive } from './harness.mjs';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let bad = 0;
const check = (name, cond, saw) => {
  if (!cond) bad++;
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${name}${cond ? '' : `\n        saw ${JSON.stringify(saw)}`}`);
};
const dir = mkdtempSync(join(tmpdir(), 'eruda-csp-'));
const out = join(dir, 'index.mjs');
execFileSync('npx', ['esbuild', 'cells/drive/index.ts', '--bundle', '--platform=node',
  '--format=esm', '--packages=external', `--outfile=${out}`], { stdio: 'pipe' });
const { CSP, CSP_EVAL } = await import(out);
check('the locked policy forbids eval', typeof CSP === 'string' && !/unsafe-eval/.test(CSP), CSP);
check('the console policy is the same policy plus eval', CSP_EVAL === CSP.replace("script-src 'self'", "script-src 'self' 'unsafe-eval'"), CSP_EVAL);
check('both carry the console\'s host', /cdn\.jsdelivr\.net/.test(CSP) && /cdn\.jsdelivr\.net/.test(CSP_EVAL), CSP);

const SPOT = 'lat=-29.9872&lon=24.7765&h=0&nodraw=1&eruda=1';
for (const [name, csp, evalExpected] of [['locked', CSP, false], ['console', CSP_EVAL, true]]) {
  const { page, close } = await openDrive({ spot: SPOT, tag: `eruda-${name}`, menu: true, settle: 0, csp });
  let st = null;
  for (let i = 0; i < 40; i++) {
    st = await page.evaluate(() => window.__eruda());
    if (st.state === 'on' || st.state === 'failed') break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  const dom = await page.evaluate(() => ({ panel: !!document.querySelector('#eruda') }));
  check(`${name}: the console loads (script-src carries its host)`, st.state === 'on' && dom.panel, { st, dom });
  check(`${name}: __eruda().evalOn says what this load is`, st.evalOn === true, st);
  if (evalExpected) check('console: page script may evaluate a string', st.evalAllowed === true, st);
  else check('locked: page script may not evaluate a string — the seat\'s report', st.evalAllowed === false, st);
  const errs = await page.evaluate(() => window.__pageErrors ?? []);
  check(`${name}: no page errors`, errs.length === 0, errs);
  await close();
}
if (bad) { console.log(`\n${bad} FAILED`); process.exit(1); }
console.log('\nall ok');
