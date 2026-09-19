/**
 * THE TRUCK'S OWN SHAPE, HELD IN PURE NODE.
 *
 * Every claim here is about `client/hull-collide.ts`, which has no THREE, no
 * DOM and no world state — so this runs in a second and needs no browser. What
 * it cannot check is that main.ts CALLS it; that is `hit-gap.mjs`, in a page.
 *
 * THE FRAME IS CHECKED AGAINST main.ts's OWN INTEGRATION, by text. A module
 * that declares the truck's axes and a `stepDrive` that advances the truck by
 * different ones is the worst failure available here — the hull would be
 * rotated against the vehicle and every push would be sideways — and asserting
 * the module against the same expression written twice would be a tautology.
 * So the integration's lines must be PRESENT in main.ts verbatim, and the
 * module's axes are checked against what they do.
 */
import assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CELL = join(HERE, '..');
const OUT = join(CELL, 'node_modules/.cache/hullcollide');
mkdirSync(OUT, { recursive: true });
execFileSync('npx', ['esbuild', join(CELL, 'client/hull-collide.ts'),
  '--bundle', '--format=esm', `--outfile=${join(OUT, 'hull.mjs')}`],
  { cwd: CELL, stdio: 'pipe' });
const H = await import(pathToFileURL(join(OUT, 'hull.mjs')).href);

let fails = 0;
const ok = (name, cond, detail) => {
  if (cond) { console.log(`ok   ${name}`); return; }
  fails++;
  console.log(`FAIL ${name}${detail === undefined ? '' : `  ${JSON.stringify(detail)}`}`);
};
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

const BOX = { halfWidthM: 1.08, halfLengthM: 2.546 };   // the measured hull

// ── 1. THE FRAME IS main.ts's ───────────────────────────────────────────
const main = readFileSync(join(CELL, 'client/main.ts'), 'utf8');
const FWD_X = 'state.x += Math.sin(state.heading) * state.speed * dt;';
const FWD_Z = 'state.z -= Math.cos(state.heading) * state.speed * dt;';
const RIGHT = 'state.x += cH * slideV * dt;';
ok('main.ts still drives forward along (sin h, -cos h)',
  main.includes(FWD_X) && main.includes(FWD_Z));
ok('main.ts still slides right along (cos h, sin h)',
  main.includes(RIGHT) && main.includes('state.z += sH * slideV * dt;'));
for (const h of [0, 0.3, 1.1, -2.2, 3.0]) {
  const a = H.hullAxes(h);
  ok(`the hull's forward is the integration's at h=${h}`,
    near(a.fx, Math.sin(h)) && near(a.fz, -Math.cos(h)), a);
  ok(`the hull's right is the integration's at h=${h}`,
    near(a.rx, Math.cos(h)) && near(a.rz, Math.sin(h)), a);
  ok(`the two axes are orthonormal at h=${h}`,
    near(a.rx * a.fx + a.rz * a.fz, 0, 1e-12)
    && near(Math.hypot(a.rx, a.rz), 1, 1e-12)
    && near(Math.hypot(a.fx, a.fz), 1, 1e-12));
}

// ── 2. THE SUPPORT FUNCTION IS THE BOX, NOT A CIRCLE ────────────────────
{
  const h = 0.7;
  const a = H.hullAxes(h);
  ok('reach along the nose is the half-length',
    near(H.hullReachM(h, BOX, a.fx, a.fz), BOX.halfLengthM, 1e-9));
  ok('reach across the flank is the half-width',
    near(H.hullReachM(h, BOX, a.rx, a.rz), BOX.halfWidthM, 1e-9));
  ok('reach at 45° in the hull frame is the sum over root two',
    near(H.hullReachM(h, BOX, a.fx + a.rx, a.fz + a.rz),
      (BOX.halfWidthM + BOX.halfLengthM) / Math.SQRT2, 1e-9));
  ok('the containing circle is the half-diagonal',
    near(H.hullRadiusM(BOX), Math.hypot(BOX.halfWidthM, BOX.halfLengthM)));
  // THE FAULT THE MODULE EXISTS FOR, as a number: the shipped circle against
  // the hull it stood in for, at the flank and at the nose.
  const CAR_R = 2.4;
  ok('the shipped circle stands 1.32 m proud of the flank',
    near(CAR_R - H.hullReachM(h, BOX, a.rx, a.rz), 1.32, 0.005),
    { proud: CAR_R - BOX.halfWidthM });
  ok('and sinks 0.146 m into a wall taken head-on',
    near(CAR_R - H.hullReachM(h, BOX, a.fx, a.fz), -0.146, 0.005));
}

// ── 3. A POINT'S DISTANCE IS EXACT, AND ZERO INSIDE ─────────────────────
{
  const h = -1.3;
  const a = H.hullAxes(h);
  const at = (u, v) => [20 + u * a.rx + v * a.fx, -7 + u * a.rz + v * a.fz];
  ok('a point on the flank face is at zero',
    near(H.hullPointDistanceM(20, -7, h, BOX, ...at(BOX.halfWidthM, 0)), 0, 1e-9));
  ok('a point a metre outside the flank is a metre away',
    near(H.hullPointDistanceM(20, -7, h, BOX, ...at(BOX.halfWidthM + 1, 0)), 1, 1e-9));
  ok('a point inside is zero, not negative',
    H.hullPointDistanceM(20, -7, h, BOX, ...at(0.2, 0.2)) === 0);
  ok('past a CORNER it is the diagonal, not the support',
    near(H.hullPointDistanceM(20, -7, h, BOX,
      ...at(BOX.halfWidthM + 3, BOX.halfLengthM + 4)), 5, 1e-9));
}

// ── 4. THE PUSH-OUT ─────────────────────────────────────────────────────
{
  const h = 0.4;
  const a = H.hullAxes(h);
  // A wall lying ALONG the truck, 0.3 m inside the flank.
  const d = BOX.halfWidthM - 0.3;
  const mid = [5 + d * a.rx, 9 + d * a.rz];
  const seg = [mid[0] - a.fx * 8, mid[1] - a.fz * 8, mid[0] + a.fx * 8, mid[1] + a.fz * 8];
  const p = H.hullPushFromSegment(5, 9, h, BOX, ...seg);
  ok('a wall inside the flank pushes across by the overlap', p !== null && near(p.depthM, 0.3, 1e-9), p);
  ok('and pushes AWAY from it',
    p !== null && near(p.x, -0.3 * a.rx, 1e-9) && near(p.z, -0.3 * a.rz, 1e-9), p);
  // The same wall moved just clear.
  const d2 = BOX.halfWidthM + 0.001;
  const mid2 = [5 + d2 * a.rx, 9 + d2 * a.rz];
  ok('a wall a millimetre clear of the flank does not push',
    H.hullPushFromSegment(5, 9, h, BOX,
      mid2[0] - a.fx * 8, mid2[1] - a.fz * 8, mid2[0] + a.fx * 8, mid2[1] + a.fz * 8) === null);
  // A wall ACROSS the truck, ahead, 0.3 m inside the nose.
  const e = BOX.halfLengthM - 0.3;
  const m3 = [5 + e * a.fx, 9 + e * a.fz];
  const p3 = H.hullPushFromSegment(5, 9, h, BOX,
    m3[0] - a.rx * 8, m3[1] - a.rz * 8, m3[0] + a.rx * 8, m3[1] + a.rz * 8);
  ok('a wall inside the nose pushes back along by the overlap',
    p3 !== null && near(p3.depthM, 0.3, 1e-9), p3);
  ok('a wall well clear does not push',
    H.hullPushFromSegment(0, 0, h, BOX, 40, -10, 40, 10) === null);
  // A DEGENERATE SEGMENT IS A POINT and must not divide by its own length.
  const pp = H.hullPushFromSegment(0, 0, 0, BOX, 0.5, 0.5, 0.5, 0.5);
  ok('a zero-length segment inside the hull still pushes, finitely',
    pp !== null && Number.isFinite(pp.depthM) && pp.depthM > 0, pp);
}

// ── 5. ROTATION INVARIANCE, which is the claim a hand-written frame breaks ─
// Rotate the hull, the wall and the whole scene together and the push must be
// the same length. THIS IS THE CHECK THAT CATCHES A MIS-DERIVED FRAME: the
// first cut of hit-gap.mjs inverted the heading with (sin, cos) instead of
// (sin, -cos) and every per-angle number it printed was mislabelled.
{
  const base = { cx: 3, cz: 0.5, h: 0.21, ax: -6, az: 1.4, bx: 6, bz: 1.4 };
  const ref = H.hullPushFromSegment(base.cx, base.cz, base.h, BOX,
    base.ax, base.az, base.bx, base.bz);
  ok('the reference case touches', ref !== null, ref);
  let worst = 0;
  for (const t of [0.4, 1.0, 2.0, -1.7, 3.1]) {
    const c = Math.cos(t), s = Math.sin(t);
    const rot = (x, z) => [x * c - z * s, x * s + z * c];
    const [cx, cz] = rot(base.cx, base.cz);
    const [ax, az] = rot(base.ax, base.az);
    const [bx, bz] = rot(base.bx, base.bz);
    // A world rotation by t about +y turns a heading by -t: the hull's axes
    // are (cos h, sin h) and (sin h, -cos h), and rot() advances both by t.
    const p = H.hullPushFromSegment(cx, cz, base.h + t, BOX, ax, az, bx, bz);
    if (p === null) { worst = Infinity; break; }
    worst = Math.max(worst, Math.abs(p.depthM - ref.depthM));
    // and the push itself must be the rotated push
    const [rx, rz] = rot(ref.x, ref.z);
    worst = Math.max(worst, Math.hypot(p.x - rx, p.z - rz));
  }
  ok('the push is the same under a rotation of the whole scene', worst < 1e-9, { worst });
}

// ── 6. THE CONTROL: the circle the module replaces fails the flank case ───
// A check that has not been shown to fail on the fault it names is decoration.
{
  const h = 0.4;
  const a = H.hullAxes(h);
  const CAR_R = 2.4;
  const d = BOX.halfWidthM + 1.0;       // a wall a metre clear of the flank
  const mid = [d * a.rx, d * a.rz];
  const hull = H.hullPushFromSegment(0, 0, h, BOX,
    mid[0] - a.fx * 8, mid[1] - a.fz * 8, mid[0] + a.fx * 8, mid[1] + a.fz * 8);
  ok('the hull leaves a wall a metre off the flank alone', hull === null);
  ok('the circle it replaces would have pushed it', d < CAR_R, { d, CAR_R });
}

console.log(fails === 0 ? '\nall ok' : `\n${fails} FAILED`);
process.exit(fails === 0 ? 0 : 1);
