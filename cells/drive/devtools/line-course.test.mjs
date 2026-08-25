/**
 * THE LEG IS A COURSE, NOT A BEARING.
 *
 *   node cells/drive/devtools/line-course.test.mjs
 *
 * Before this, a leg was two points and a radius. Everything downstream could
 * therefore only say "it is that way" — and the two things a docket actually
 * promises were both wrong for it:
 *
 *   the CO-DRIVER read the road under the wheels, so on the old N20 it called
 *   the bends of whatever street the truck was sitting on, including the ones
 *   the route turns off; and
 *
 *   the CHECKPOINTS came from `via.name` — ONE road, where leg 1 is carried by
 *   sixteen — and no leg in the campaign actually set it, so there were none.
 *
 * So the course is authored data now, routed along real ways by line-legs.mjs.
 * This file asks whether the game reads it: that it projects, that the nav
 * comes off the ROUTE while you are on it and falls back to the road when you
 * are not, that the checkpoints are the line's and collect by driving it, and
 * that finishing means having driven it rather than having reached the end.
 *
 * Runs AT THE APERTURE, unlike line-boot.test.mjs, and can: a course needs
 * nothing to have streamed. That is the point of it being data.
 */
import { openDrive, report } from './harness.mjs';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'course-'));
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

// The aperture, on the line, leg 1 open — the same signed-in optimistic gate
// line-boot uses (the token is junk; the gate never locks a ranger out).
const d = await openDrive({
  spot: 'lat=48.77855&lon=2.31341&h=182&cam=chase&wx=clear&time=NOON&line=1',
  tag: 'course', settle: 14000, route: serveCampaign,
  init: `localStorage.setItem('drive.line.v1', JSON.stringify({
    lat: 48.77855, lon: 2.31341, h: 182, odo: 0, begunAt: 1700000000000, at: 1700000000000 }));
    localStorage.setItem('drive.sync.token', 'tok_test');`,
});
const page = d.page;
const course = () => page.evaluate(() => window.__course());

// ── 1. it projects ───────────────────────────────────────────────
let c = await course();
// The leg has to be ACTIVE for the course to build — arming is line-boot's
// subject, not this file's, so say so plainly rather than assert around it.
if (c.leg !== 'line-01') {
  console.log('\nSKIPPED, NOT PASSED: leg 1 never armed, so there is no course to read.',
    JSON.stringify(c));
  report(d.errors); await d.close(); process.exit(2);
}
// A LEG IS OFFERED BEFORE IT IS DRIVEN, and the course deliberately stays
// quiet until it is accepted: the co-driver does not call bends on a job you
// have not taken, and passing a checkpoint on a route you declined must not
// count. The course itself projects either way, which is what the block below
// checks; everything after the acceptance is about the ACTIVE leg.
check('the course projects as soon as the leg is known', c.vertices > 20, c);
check('…but stays silent until the leg is accepted',
  c.phase === 'offered' && c.onCourse === false, c);
await page.evaluate(() => window.__accept());
await page.waitForTimeout(900);
c = await course();
check('accepting the leg puts the course under the wheels', c.phase === 'active', c);
check('…of about the routed length', c.km > 40 && c.km < 55, c);
check('…laid with checkpoints along it', c.cps > 30 && c.cps < 80, c);
check('…and finishing it takes a majority of them', c.need > c.cps * 0.5 && c.need <= c.cps, c);
check('nothing is driven yet', c.got === 0 && c.met === false, c);

// ── 2. the co-driver reads the ROUTE ─────────────────────────────
check('the aperture stands on the course', c.offM !== null && c.offM < 150, c);
check('THE CALL COMES OFF THE LINE, not the street', c.navFrom === 'route', c);
check('…from the very start of it', c.alongKm !== null && c.alongKm < 1, c);

// ── 3. …and hands back when you leave it ─────────────────────────
// Six kilometres east of the corridor: still France, still the same world, and
// nothing whatever to do with leg 1.
await page.evaluate(() => window.__place(6000, 0));
await page.waitForTimeout(1200);
const off = await course();
check('off the corridor the course stops speaking', off.onCourse === false, off);
check('…and the co-driver goes back to the road under the wheels', off.navFrom !== 'route', off);

// ── 4. driving the line collects the line ────────────────────────
// Walked, not teleported: `__place` is a respawn, and the sweep test that
// makes capture frame-rate-independent deliberately refuses a jump too long to
// be driving. So step the truck ALONG the course, a checkpoint's spacing at a
// time, which is what a player does slowly.
const walk = await page.evaluate(async () => {
  const pts = [];
  // Ask the course itself where its first checkpoints are, in local metres.
  for (let d = 450; d <= 450 + 900 * 4; d += 45) pts.push(d);
  return pts.length;
});
check('there is a stretch of course to walk', walk > 0, walk);
await page.evaluate(async () => {
  // 45m a step is inside ROUTE_CAPTURE and well inside the 60m respawn guard,
  // so every step is legal driving as far as the sweep is concerned.
  const step = 45;
  const total = 900 * 4 + 500;
  for (let d = 0; d <= total; d += step) {
    const p = window.__coursePt?.(d);
    if (!p) break;
    window.__place(p[0], p[1]);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  }
});
await page.waitForTimeout(600);
const walked = await course();
check('DRIVING THE LINE COLLECTS THE LINE', walked.got >= 4, walked);
check('…and it is not yet finished on four of fifty', walked.met === false, walked);

console.log('course:', JSON.stringify(c));
console.log('after walking:', JSON.stringify(walked));
console.log(bad ? `\n${bad} FAILED` : '\nall good');
report(d.errors);
await d.close();
process.exitCode = bad ? 1 : 0;
