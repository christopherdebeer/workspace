/**
 * THE SHELL IS SEALED, AND IT LOOKS MADE.
 *
 *   node cells/drive/devtools/cover-face.test.mjs
 *
 * Three claims, all about the same object seen two ways.
 *
 * ON THE CHART. Nothing under a Cover is on the map. The fine tiles have been
 * gated on this since the Cover was built and the summits since the peak
 * layer was — but the OVERVIEW layer never was, so the chart wrote the
 * arrondissements and their motorway network straight across the dome. The
 * one place the fiction was most visible was the one place it leaked.
 *
 * IN THE NAME. "PARIS COVER" is this codebase's word for the object, not
 * something the Service would put on a horizon marker.
 *
 * ON THE GLASS. The shell was two flat colours, so the biggest object in the
 * game read as a landform. Panels, panel tone, weathering and a rim sheen say
 * MANUFACTURED — and a panel grid is measurable: a flat Lambert dome varies
 * smoothly across its face, a panelled one does not.
 */
import { openDrive, report, decodePng } from './harness.mjs';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'cover-'));
const out = join(dir, 'index.cjs');
execFileSync('npx', ['esbuild', 'cells/drive/index.ts', '--bundle', '--platform=node', '--format=cjs',
  '--external:@aws-sdk/*', `--outfile=${out}`], { stdio: 'pipe' });
const { handler } = await import(out);

let bad = 0;
const check = (name, cond, saw) => {
  if (!cond) bad++;
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${name}${cond ? '' : `\n        saw ${JSON.stringify(saw)}`}`);
};
const serveCampaign = async (page) => {
  await page.route(/\/~\/campaign\//, async (route) => {
    const v = new URL(route.request().url()).pathname.split('/').pop();
    const r = await handler({ rawPath: `/~/campaign/${v}`, requestContext: { http: { method: 'GET' } } });
    if (r.statusCode !== 200) return route.fulfill({ status: r.statusCode, body: '{}', contentType: 'application/json' });
    return route.fulfill({ status: 200, body: gunzipSync(Buffer.from(r.body, 'base64')).toString(), contentType: 'application/json' });
  });
};

// ── the name, before any pixels ──────────────────────────────────
const campaign = JSON.parse(gunzipSync(Buffer.from(
  (await handler({ rawPath: '/~/campaign/8', requestContext: { http: { method: 'GET' } } })).body, 'base64')).toString());
for (const c of campaign.covers ?? []) {
  check(`cover ${c.id}: its label is not our word for it`, !/cover/i.test(c.name), c.name);
  check(`cover ${c.id}: …and it is still named something`, (c.name ?? '').length >= 3, c.name);
}

// The aperture, facing NORTH into the shell — it stands at the Cover's foot,
// so the dome fills the upper frame from here.
const d = await openDrive({
  spot: 'lat=48.77855&lon=2.31341&h=0&cam=chase&wx=clear&time=NOON&line=1',
  tag: 'coverface', settle: 16000, route: serveCampaign,
  init: `localStorage.setItem('drive.line.v1', JSON.stringify({
    lat: 48.77855, lon: 2.31341, h: 0, odo: 0, begunAt: 1700000000000, at: 1700000000000 }));
    localStorage.setItem('drive.sync.token', 'tok_test');`,
});
const page = d.page;

// ── the chart keeps out ──────────────────────────────────────────
const built = await page.evaluate(() => window.__ovinside());
check('the shell stood up', built.shells > 0, built);

// Open the chart wide enough that the overview layer streams, then ask what
// it holds. Every label and every way vertex must be OUTSIDE the dome.
// THE OVERVIEW LAYER ONLY STREAMS FOR THE CHART — it is a map layer and only
// the chart draws it (see streamWorld's `camMode === 'top'` gate), so this has
// to be in top view and zoomed past the fine ring before there is anything to
// ask about.
await page.evaluate(() => window.__setcam('top'));
await page.waitForTimeout(1500);
await page.evaluate(() => window.__zoom(9000));
const leaked = await page.waitForFunction(() => {
  const w = window.__ovinside();
  return w.total > 0 && w.totalPts > 0 ? w : false;
}, null, { timeout: 150000 }).then((h) => h.jsonValue()).catch(() => null);
if (!leaked) {
  console.log('\nSKIPPED, NOT PASSED: the overview layer never filled, so there is nothing to ask about it.');
  report(d.errors); await d.close(); process.exit(2);
}
const inside = await page.evaluate(() => window.__ovinside());
check('NO CHART LABEL SITS UNDER THE SHELL', inside.places === 0, inside);
check('…and no overview way runs under it either', inside.wayPts === 0, inside);
// NOT a place count: most of the places NEAR the aperture are Paris, and
// those are exactly the ones that should now be gone. The evidence that the
// layer filled at all is the way geometry — hundreds of vertices of road,
// rail and water, every one of them outside the dome.
check('…because the layer DID fill, and all of it is outside',
  inside.totalPts > 200 && inside.total > 0, inside);

// A look at the shell itself. The panel grid, the weathering and the rim
// sheen are a judgement call rather than a threshold — what IS asserted is
// that the material compiles, because a bad shell shader takes the whole
// frame down with it (it did: 'modelMatrix' is a vertex uniform, and reaching
// for it in the fragment shader invalidated the program).
check('THE SHELL MATERIAL COMPILES — a bad one kills the frame', d.errors.length === 0, d.errors);
await page.evaluate(() => { window.__setcam('chase'); });
await page.waitForTimeout(2500);
await page.screenshot({ path: 'docs/line/cover-shell.png' }).catch(() => {});
console.log('overview:', JSON.stringify(leaked), 'inside:', JSON.stringify(inside));
console.log(bad ? `\n${bad} FAILED` : '\nall good');
report(d.errors);
await d.close();
process.exitCode = bad ? 1 : 0;
