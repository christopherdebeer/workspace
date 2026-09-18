/**
 * NOTHING VANISHES WHILE YOU ARE LOOKING AT IT.
 *
 *   node cells/drive/devtools/critter-hold.test.mjs
 *
 * The herd lives in a box that follows the camera, wrapping anything that
 * falls out the back round to the front. That is what keeps animals wherever
 * you are, and it had one thing wrong with it: it wrapped whatever was there,
 * including the deer you were watching. In a 240m box the wrap edge stood 120m
 * from the camera — the middle distance a herd is most legible at — so driving
 * past it teleported the animals you could see to somewhere behind you.
 * Reported from the seat as herds disappearing arbitrarily, and as herds
 * popping into view, which is the same event from the other end.
 *
 * The law, and it is about the PICTURE rather than about the box:
 *
 *   AN ANIMAL IN FRAME DOES NOT MOVE FURTHER IN A TICK THAN IT COULD WALK.
 *
 * Sampled while driving, because standing still never crosses the wrap edge.
 */
import { openDrive, report } from './harness.mjs';

let bad = 0;
const check = (name, cond, saw) => {
  if (!cond) bad++;
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${name}${cond ? '' : `\n        saw ${JSON.stringify(saw)}`}`);
};

// Open ground, so the herd is on land and in the open rather than penned by a
// coastline. Uyuni: flat, empty, and the same every run.
// nodraw: the law is about positions, and a drawn frame under load takes seconds,
// which starves module time (dt caps at 50 ms) and makes a 70 s drive a 5 s one.
const d = await openDrive({ spot: 'lat=-20.1338&lon=-67.4891&h=45&cam=chase&wx=clear&time=NOON&nodraw=1', tag: 'herd-hold', settle: 20000 });

/** One sample: every animal, plus where the truck is and which way it looks. */
// THE FRAME IS THE MODULE'S OWN FRUSTUM TEST, not a cone. The old 57° cone
// stood in for a frustum that is ±15° on a portrait phone; now that herd
// animals are BORN just outside the real wedge (a flank spawn at 20° off-axis
// is out of frame, not a pop) the proxy would flag the law's own remedy.
// `seenAgo` is the module's word for "in the frustum or within 45 m this
// tick"; the guard below that something was watched keeps it honest. And
// past HERD_DOT_M an appearance inside the wedge is two art pixels — the dot
// spawn — which the law allows as it always allowed one past 900 m.
// Distances are from the CAMERA, which is what the module's dot rule and its
// frustum test measure from; the truck sits some ten metres ahead of it.
const snap = () => d.page.evaluate(() => { const w = window.__wildlife(); return {
  herd: w.actors.slice(0, 30).filter((a) => a.active)
    .map((a) => ({ id: a.id, x: a.x, z: a.z, seen: a.seenAgo < 0.8 })),
  x: w.camera[0], z: w.camera[1], h: window.__drive.heading, born: w.born,
}; });
const DOT_M = 300; // HERD_DOT_M in client/wildlife.ts

// Drive. The wrap edge is only crossed by moving, and the fault needs enough
// ground covered to push a whole box past the camera.
// THE TRUCK IS HOPPED, NOT THROTTLED. `__drive.speed = 26` never moved it:
// the physics holds a stopped truck and derives speed from the throttle, so
// every earlier run of this test — the original included — sampled a
// STATIONARY truck and proved the law over a drive that never happened
// (the probe: x 0, z 0, v 0 for twelve ticks, the herd standing where it
// arrived). The harness's own walkTo does what a drive needs here: advance
// the truck along its heading by a tick's worth of 26 m/s and let the chase
// camera follow. The animals see a truck at rest (no flee), which is the
// stricter case for the law — nothing outruns the frustum on its own.
const hop = () => d.page.evaluate(() => { const s = window.__drive; s.x += Math.sin(s.heading) * 18.2; s.z += -Math.cos(s.heading) * 18.2; });
let jumps = [];
let watched = 0;
let prev = await snap();
// LONG ENOUGH FOR A RENEWAL. A herd born ahead flees the truck at 22 m/s
// against its 26, so for the first half-minute nothing is passed, nothing
// falls 364 m behind and nothing is reborn — 26 ticks of that proved the law
// over a drive that never recycled an animal. A hundred ticks (70 s, 1.8 km
// of salt flat) sees the herd overtaken, left behind, reborn ahead and passed
// again, which is where a pop would be.
for (let i = 0; i < 100; i++) {
  await hop();
  await d.page.waitForTimeout(700);
  const now = await snap();
  // BOTH ENDS OF THE TELEPORT. Checking only where an animal STARTED misses
  // the half of the fault that is actually loudest — driving forward, animals
  // wrap from behind you, which is out of frame at the start of the tick and
  // squarely in frame at the end of it. That is the pop-into-view, and it is
  // the same event as the vanishing seen from the other side.
  const seen = (s, a) => {
    const dist = Math.hypot(a.x - s.x, a.z - s.z);
    if (dist >= DOT_M) return false;
    if (dist < 45) return true;
    return a.seen;
  };
  const before = new Map(prev.herd.map((a) => [a.id, a]));
  for (const a of now.herd) {
    const b = before.get(a.id);
    if (!b) continue;
    const [px, pz] = [b.x, b.z];
    const [nx, nz] = [a.x, a.z];
    const was = seen(prev, b), is = seen(now, a);
    if (!was && !is) continue;
    watched++;
    const k = a.id;
    const moved = Math.hypot(nx - px, nz - pz);
    // A deer at full flight covers a few metres in 700ms. Fifty is generous
    // for that and nowhere near a wrap, which moves a whole box at once.
    if (moved > 50) {
      jumps.push({ k, moved: Math.round(moved), was, is, from: [Math.round(px), Math.round(pz)] });
    }
  }
  prev = now;
}
check('the drive actually watched some animals', watched > 40, { watched });
check('nothing was teleported into or out of frame', jumps.length === 0, jumps.slice(0, 5));
console.log(`        ${watched} in-frame animal-ticks, ${jumps.length} jumps`);

// …and the population is RENEWED out of frame, not in it. This used to read
// the farthest animal at the end (> 200 m, a proxy for the old box being big
// enough that wraps landed where a body is a mark). With births in the
// truck's frame that distance says nothing: a herd the truck bears down on
// flees ahead of it at 22 m/s and the whole population can sit within
// 110 m at the final tick while every birth happened at 60-340 m. So read the
// births themselves: after the arrival window, every one is a DOT (ahead,
// beyond HERD_DOT_M) or a FLANK (outside the wedge), and there were some.
const born = await d.page.evaluate(() => window.__wildlife().born);
check('the population is renewed out of frame (dot or flank births, none in it)',
  born.dot + born.flank > 0, born);

report(d.errors);
await d.close();
console.log(bad ? `\n${bad} FAILED` : '\nall good — the herd holds still while you watch it');
if (bad) process.exitCode = 1;
