/**
 * VEGETATION DISTRIBUTION, IN THE WORLD.
 *
 *   node cells/drive/devtools/veg-distribution.test.mjs
 *
 * `vegetation-field.test.mjs` proves the pure maths in under a second and is
 * the one to run while iterating. This asks the two questions that need the
 * real world under the wheels, and only those:
 *
 *  1. DETERMINISM. "A plant must not change species, move, appear or disappear
 *     merely because the vehicle or camera crossed a render-cell boundary" is
 *     the distribution work's hardest requirement and the easiest to break in
 *     silence — a role decision drawn from a clump's own RNG stream reorders
 *     every member generated after it, and nothing on screen says so.
 *
 *     It compares RE-SEED TO RE-SEED, not first-seed to re-seed. Cover,
 *     terrain and roads all feed the placement decisions and they arrive
 *     asynchronously, so a tile landing between two seedings is the world
 *     knowing more rather than the code being unstable. Measured that way the
 *     first cut differed in 3 of 224 sites and looked like a determinism bug
 *     for an afternoon; between two settled re-seeds it is exact.
 *
 *  2. THE FOUR POPULATIONS ARE ACTUALLY POPULATED. A layer that silently never
 *     places anything is the failure mode this whole phase risks, and site
 *     counts by role are the only thing that can see it.
 *
 * Headless on purpose. The harness can run headed, and a headed window is one
 * a passing human closes — which surfaces as `Target page has been closed`
 * mid-settle and reads exactly like a crash.
 */
import { openDrive } from './harness.mjs';

const SPOTS = [
  ['bigsur', 'lat=36.2935&lon=-121.8470&h=158&cam=top&wx=clear&t=NOON&sunalt=55'],
];

let bad = 0;
const ok = (name, cond, saw) => {
  if (!cond) bad++;
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${name}${cond ? '' : `\n        saw ${JSON.stringify(saw)}`}`);
};

for (const [tag, spot] of SPOTS) {
  const d = await openDrive({ spot, settle: 26000, tag: `vegdist-${tag}`, dpr: 2 });
  const ev = (fn, a) => d.page.evaluate(fn, a);

  // Let the streamed world go quiet before either seeding — see the note above.
  await d.page.waitForTimeout(22000);

  /** Every site in the 3x3 around the truck, as a sorted fingerprint. */
  const print = () => ev(() => {
    const cx = Math.floor(window.__drive.x / 220), cz = Math.floor(window.__drive.z / 220);
    const rows = [];
    for (let gx = cx - 1; gx <= cx + 1; gx++) for (let gz = cz - 1; gz <= cz + 1; gz++) {
      for (const v of window.__vegsites(gx, gz)) {
        rows.push([v.role, v.k, v.x, v.z, v.s, v.sw, v.sy, v.h, v.anchor ? 1 : 0].join('|'));
      }
    }
    return rows.sort().join('\n');
  });

  await ev(() => window.__vegreseed());
  await d.page.waitForTimeout(3000);
  const first = await print();
  await ev(() => window.__vegreseed());
  await d.page.waitForTimeout(3000);
  const second = await print();

  ok(`${tag}: the ring holds sites at all`, first.length > 0, first.length);
  ok(`${tag}: a re-seed reproduces every site exactly`, first === second, (() => {
    const a = first.split('\n'), b = second.split('\n');
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      if (a[i] !== b[i]) return { at: i, rows: [a.length, b.length], a: a[i], b: b[i] };
    }
    return { rows: [a.length, b.length] };
  })());

  const dist = await ev(() => window.__vegdist());
  const roles = dist.seeded.roles;
  for (const role of ['interior', 'fringe', 'living-stray', 'ground-event']) {
    ok(`${tag}: the ${role} population is placed`, roles[role] > 0, roles);
  }
  // Interior must still dominate: fringe is a transition, not a replacement.
  ok(`${tag}: interior outnumbers fringe`, roles.interior > roles.fringe, roles);
  // Strays are a long tail, not a population.
  ok(`${tag}: strays stay a long tail`,
    roles['living-stray'] * 20 < roles.interior, roles);
  // Anchors have to be rare enough to be individually meaningful.
  ok(`${tag}: anchors are rare`,
    dist.anchors.seeded > 0 && dist.anchors.seeded * 40 < roles.interior, dist.anchors);
  // And the budget the plan forbids moving.
  ok(`${tag}: range and cell size are unchanged`,
    dist.budget.range === 700 && dist.budget.cell === 220, dist.budget);
  ok(`${tag}: active instances stay inside the cap`,
    dist.active.total < dist.budget.capTotal, [dist.active.total, dist.budget.capTotal]);

  // The role view must not disturb the normal path: turning it on and off again
  // has to leave the same instance counts behind.
  const before = dist.active.total;
  await ev(() => window.__vegdist(true));
  await ev(() => window.__vegdist(false));
  const after = (await ev(() => window.__vegdist())).active.total;
  ok(`${tag}: the role view leaves the normal path alone`, before === after, [before, after]);

  console.log(`      roles ${JSON.stringify(roles)}  anchors ${dist.anchors.seeded}`
    + `  active ${dist.active.total}  trunks ${dist.active.trunks}`);
  ok(`${tag}: no page errors`, d.errors.length === 0, d.errors.slice(0, 3));
  await d.close();
}

console.log(bad ? `\n${bad} failed` : '\nall good — stable placement, four populations, budget held');
process.exit(bad ? 1 : 0);
