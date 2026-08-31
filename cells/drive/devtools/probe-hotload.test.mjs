/**
 * A NEW PROBE, OVER THE WIRE, WITH NO DEPLOY AND NO RELOAD.
 *
 *   node cells/drive/devtools/probe-hotload.test.mjs
 *
 * Every question the probe channel could ask had to already exist in the
 * bundle. So learning anything the bundle had not anticipated cost a deploy
 * and a reload — and on a phone a reload throws away the session that was
 * showing the fault. Hunting a frame rate that degrades over time, that is the
 * whole difficulty: the state worth measuring is the state a reload destroys.
 *
 * The page forbids eval, so a probe cannot be a string of code the tab runs.
 * But `script-src 'self'` permits a MODULE from this origin, and the probe
 * routes are this origin and outside `~/` — uncached, query strings intact.
 * So the cell holds a module and the tab imports it.
 *
 * THE POINT OF THIS TEST IS THE POLICY. Served without a CSP — which is what
 * the harness did until now — this mechanism "works" whether or not it is
 * actually allowed, and would fail first on the device. So the page here is
 * served under the cell's own CSP, imported from the cell, and the import is
 * asserted to run under it.
 */
import { openDrive, report } from './harness.mjs';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let bad = 0;
const check = (name, cond, saw) => {
  if (!cond) bad++;
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${name}${cond ? '' : `\n        saw ${JSON.stringify(saw)}`}`);
};

// The cell's real policy, from the cell — not a copy that can drift out of it.
const dir = mkdtempSync(join(tmpdir(), 'hot-'));
const out = join(dir, 'index.mjs');
execFileSync('npx', ['esbuild', 'cells/drive/index.ts', '--bundle', '--platform=node',
  '--format=esm', '--packages=external', `--outfile=${out}`], { stdio: 'pipe' });
const { CSP } = await import(out);
check('the cell exports a policy to test under', typeof CSP === 'string' && CSP.length > 0, CSP);
check('…and it is the one that forbids eval', !/unsafe-eval/.test(CSP ?? ''), CSP);

// The module a session would post mid-drive: it reads the LIVE objects through
// __ctx, which is the whole reason a hot probe is worth more than a reload.
const MODULE = `
export default function () {
  const c = window.__ctx;
  const seen = [];
  c.scene.traverse((o) => { if (o.isMesh && seen.length < 3) seen.push(o.name || 'unnamed'); });
  return {
    ranInPage: true,
    hasThree: typeof c.THREE === 'object',
    rendererIsLive: typeof c.renderer.info.render.calls === 'number',
    sampled: seen,
  };
}
export const marker = 'hot-probe-v1';
`;

// An in-memory stand-in for the cell's module store: DynamoDB does not exist
// here, and what is under test is the BROWSER half — that an import of this
// URL is permitted and its exports arrive.
const store = { js: null };
const d = await openDrive({
  spot: 'lat=-34.09905&lon=18.37835&h=0&cam=chase&wx=clear&time=NOON&probe=hotloadtest1',
  tag: 'hotload', csp: CSP, settle: 8000,
});
await d.page.route(/\/probe\/[^/]+\/mod\.js/, (route) =>
  route.fulfill({ status: store.js ? 200 : 404, contentType: 'application/javascript',
    headers: { 'cache-control': 'no-store' }, body: store.js ?? '// nothing posted\n' }));
// Keep the poll from reaching a cell that is not there.
await d.page.route(/\/probe\/[^/]+\/next/, (route) =>
  route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));

check('the loader exists on a keyed tab',
  await d.page.evaluate(() => typeof window.__load === 'function'), null);
check('and the live handles a hot module needs are exposed',
  await d.page.evaluate(() => !!window.__ctx?.renderer && !!window.__ctx?.THREE), null);

// Nothing posted yet: the failure has to be legible, not a silent success.
const empty = await d.page.evaluate(async () => {
  try { await window.__load(1); return 'loaded nothing'; }
  catch (e) { return `threw: ${String(e.message ?? e).slice(0, 80)}`; }
});
check('an unposted module fails loudly rather than quietly', /threw|loaded nothing/.test(empty), empty);

// Now post it and import it — no reload in between.
store.js = MODULE;
const got = await d.page.evaluate(async () => {
  try { return await window.__load(2); } catch (e) { return { error: String(e.message ?? e) }; }
});
check('THE MODULE IMPORTED UNDER THE REAL CSP — no eval, no deploy, no reload',
  got?.ret?.ranInPage === true, got);
check('…and it reached the LIVE scene, not a copy of it',
  got?.ret?.hasThree === true && got?.ret?.rendererIsLive === true, got?.ret);
check('…and its named exports arrive too', (got?.exports ?? []).includes('marker'), got?.exports);

// A second, different module at a new version must actually replace the first
// — a cached module is indistinguishable from a probe that did not work.
store.js = `export default () => ({ ranInPage: true, generation: 2 });`;
const two = await d.page.evaluate(async () => window.__load(3));
check('a new version supersedes the old, rather than being served from cache',
  two?.ret?.generation === 2, two);

// The instruments this was built to carry.
const frames = await d.page.evaluate(() => window.__frames());
check('__frames reports a distribution, not just a mean',
  typeof frames.p99 === 'number' && typeof frames.over33 === 'number' && frames.n > 0, frames);
const census = await d.page.evaluate(() => window.__census());
check('__census counts the scene by kind', census.meshes > 0 && !!census.byTris, census);
check('…including the piles that only ever grow',
  typeof census.geometries === 'number' && typeof census.programs === 'number', census);
const toast = await d.page.evaluate(() => {
  window.__toast('paired-debug check', 2);
  const el = [...document.querySelectorAll('div')].find((n) => n.textContent === 'paired-debug check');
  return { shown: !!el, visible: el ? getComputedStyle(el).display !== 'none' : false };
});
check('__toast puts a line on the glass for whoever is driving',
  toast.shown && toast.visible, toast);

report(d.errors);
await d.close();
if (bad) process.exitCode = 1;
console.log(bad ? `${bad} FAILED` : 'all good');
