/**
 * THE SHADOW BOX: A CROP THAT MOVED, AND A GRID THAT SLID.
 *
 *   node cells/drive/devtools/shadow.test.mjs
 *
 * Reported from the seat as one thing — "shadows seem dis/miss-connected to
 * the viewport, they slide in and out of a mask/crop" — and it was two, which
 * is why it reads as a single unplaceable wrongness:
 *
 * (1) THE CROP IS REAL AND IT RIDES YOU. The sun casts through ONE cascade
 *     about 220m across, re-centred on the truck every frame. A cab sees 900m.
 *     Everything past the box is lit as though the sun could see it, so a
 *     cliff's shadow SWITCHES ON as the box reaches it — at a radius, moving
 *     at driving speed, across ground that is standing still. The old comment
 *     claimed "the aerial haze hides the boundary"; haze hides things at a
 *     DISTANCE, and this boundary is at a RADIUS.
 *
 * (2) THE GRID SLID. The box was re-centred at whatever position the physics
 *     produced, so its texel lattice moved continuously under a world that was
 *     not moving. At 0.21m per texel and 25m/s that re-quantises every shadow
 *     edge in the world a hundred times a second, each stepping a texel back
 *     and forth. That is the swimming.
 *
 * WHAT THIS ASSERTS:
 *   - the fade patch actually took. It did NOT, first time, and reported a
 *     working feature: the anchor was a literal getShadow call copied from the
 *     r160 source, and the three that runs is not r160 — it passes a
 *     shadowIntensity argument the import pin does not predict. A silent
 *     String.replace miss is indistinguishable from a feature that does
 *     nothing, which is the whole reason this check exists.
 *   - the centre lands ON the texel grid when the snap is on, and off it when
 *     it is not. Measured AFTER the snap, so a basis that does not match the
 *     one three builds fails here rather than quietly buying nothing.
 *   - the box's own numbers, so the crop is written down rather than argued
 *     about: how far the shadows reach against how far the camera sees.
 */
import { openDrive, report } from './harness.mjs';

let bad = 0;
const check = (name, cond, saw) => {
  if (cond) { console.log(`ok    ${name}`); return; }
  bad++; console.log(`FAIL  ${name}\n      saw: ${JSON.stringify(saw)}`);
};

// A fjord: the most relief per square kilometre anywhere in the spot list, so
// there is something for the sun to cast past. Side-lit at fifteen degrees —
// straight into the sun is a lens flare and straight away from it is a scene
// with no shadows in it at all, and both have been photographed by mistake.
const d = await openDrive({
  spot: 'lat=62.54483&lon=7.71788&h=90&cam=cab&wx=clear&time=NOON&sunalt=15', tag: 'shadow', settle: 50000 });
const page = d.page;
await page.evaluate(() => { window.__hide('critters'); window.__hide('sward'); });
await page.evaluate(() => { window.__dial('shq', 2); window.__dial('sdark', 3); });
await page.waitForTimeout(7000);

const box = await page.evaluate(() => window.__shadowbox());
console.log(`      box ${box.box}m across at ${box.map} -> ${box.mPerTexel}m per texel`
  + ` · reach ${box.reach}m against a ${box.viewRadius}m view`
  + ` · fade ${box.fade} · darkness patch ${box.dark}`);

check('the sun is casting at all', box.on === true, box);
// THE ONE THAT HAS ALREADY CAUGHT A SILENT MISS.
check('the box-edge fade patch found its anchor in the running three',
  box.fade === true, { fade: box.fade, saw: box.fadeSaw });
check('and the darkness patch still has its own', box.dark === true, box);
// Not a fault — the design — but written down, because the round before
// argued about whether the boundary existed.
check(`the crop is smaller than the view, which is why it is visible`
  + ` (${box.reach}m of shadow in a ${box.viewRadius}m view)`,
  box.reach < box.viewRadius, box);

// ── the grid ──
//
// Seven centimetres a step: a third of a texel, so an unsnapped box lands
// somewhere different every time and a snapped one cannot move at all.
const walk = async () => {
  const out = [];
  for (let i = 0; i < 4; i++) {
    await page.evaluate(() => { window.__drive.x += 0.07; window.__drive.z += 0.07; });
    await page.waitForTimeout(600);
    out.push(await page.evaluate(() => window.__shadowbox().phase));
  }
  return out;
};
await page.evaluate(() => window.__shadowbox({ snap: false }));
const raw = await walk();
await page.evaluate(() => window.__shadowbox({ snap: true }));
const snapped = await walk();
console.log(`      sub-texel phase of the box centre: unsnapped ${raw.map((v) => v.toFixed(3)).join(' ')}`
  + ` · snapped ${snapped.map((v) => v.toFixed(3)).join(' ')}`);
check('unsnapped, the box centre wanders off the texel grid as the truck moves',
  Math.max(...raw) > 0.15 && new Set(raw.map((v) => v.toFixed(3))).size > 2, raw);
check('snapped, it lands on the grid every frame',
  Math.max(...snapped) < 1e-6, snapped);

check('no shader failed to compile', d.errors.filter((e) => e.startsWith('GLSL:')).length === 0,
  d.errors.filter((e) => e.startsWith('GLSL:')));
report(d.errors);
await d.close();
console.log(bad ? `\n${bad} FAILED` : '\nall good — the box holds still and its edge is not a line');
if (bad) process.exitCode = 1;
