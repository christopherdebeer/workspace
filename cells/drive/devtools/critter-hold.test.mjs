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
const d = await openDrive({ spot: 'lat=-20.1338&lon=-67.4891&h=45&cam=chase&wx=clear&time=NOON', tag: 'herd-hold', settle: 20000 });

/** One sample: every animal, plus where the truck is and which way it looks. */
const snap = () => d.page.evaluate(() => ({
  herd: window.__herd().map((c) => [c.x, c.z]),
  x: window.__drive.x, z: window.__drive.z, h: window.__drive.heading,
}));

// Drive. The wrap edge is only crossed by moving, and the fault needs enough
// ground covered to push a whole box past the camera.
await d.page.evaluate(() => { window.__drive.speed = 26; });
let jumps = [];
let watched = 0;
let prev = await snap();
for (let i = 0; i < 26; i++) {
  await d.page.evaluate(() => { window.__drive.speed = 26; });
  await d.page.waitForTimeout(700);
  const now = await snap();
  // BOTH ENDS OF THE TELEPORT. Checking only where an animal STARTED misses
  // the half of the fault that is actually loudest — driving forward, animals
  // wrap from behind you, which is out of frame at the start of the tick and
  // squarely in frame at the end of it. That is the pop-into-view, and it is
  // the same event as the vanishing seen from the other side.
  const seen = (s, x, z) => {
    const dx = x - s.x, dz = z - s.z, dist = Math.hypot(dx, dz);
    if (dist > 900) return false;
    if (dist < 45) return true;
    return (dx * Math.sin(s.h) + dz * -Math.cos(s.h)) / dist > 0.55;
  };
  for (let k = 0; k < now.herd.length && k < prev.herd.length; k++) {
    const [px, pz] = prev.herd[k];
    const [nx, nz] = now.herd[k];
    const was = seen(prev, px, pz), is = seen(now, nx, nz);
    if (!was && !is) continue;
    watched++;
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

// …and they are not all crowded against the camera: the box has to be big
// enough that arrivals happen out where a body is a mark rather than a shape.
const far = await d.page.evaluate(() => {
  const s = window.__drive;
  return Math.max(...window.__herd().map((c) => Math.hypot(c.x - s.x, c.z - s.z)));
});
check('the population reaches out past sight, not just past the bonnet',
  far > 200, { farthest: Math.round(far) });

report(d.errors);
await d.close();
console.log(bad ? `\n${bad} FAILED` : '\nall good — the herd holds still while you watch it');
if (bad) process.exitCode = 1;
