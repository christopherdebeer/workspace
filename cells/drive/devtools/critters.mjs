/**
 * ARE THE ANIMALS STANDING ON ANYTHING?
 *
 *   node cells/drive/devtools/critters.mjs [--rev=HEAD] [--spot=...]
 *
 * A herd is meant to walk ON a road it crosses rather than through it, so a
 * critter takes the deck's height when it is over one. The failure that leaves
 * is subtler than walking through: an animal a little way PAST the kerb also
 * gets the deck, and on a cliff road that is precisely where the barrier
 * stands — so it stands on the barrier with the sea underneath. Photographed on
 * Chapman's Peak.
 *
 * `out` is metres outside the kerb, negative on the carriageway. On deck AND
 * outside the kerb is the bug, and it is one filter over the population rather
 * than a search for a horse in a screenshot.
 */
import { openDrive, report, walkTo } from './harness.mjs';

const args = process.argv.slice(2);
const arg = (k, d) => {
  const a = args.find((v) => v.startsWith(`--${k}=`));
  return a === undefined ? d : a.slice(k.length + 3);
};
const rev = arg('rev', '');
const spot = arg('spot', 'lat=-34.07551&lon=18.36420&h=21&cam=cab&time=NOON');
const to = arg('to', '');
const settle = Number(arg('settle', 45000));

// The older build's __herd predates the `out` field. roadEdge and groundAt are
// both already there, so the whole probe grafts on unchanged.
const SHIM = `
(window as unknown as { __herd?: object }).__herd = (): object =>
  graze.map((c) => ({
    x: +c.x.toFixed(1), z: +c.z.toFixed(1), sp: ['deer', 'bison', 'horse'][c.sp],
    onDeck: c.y > groundAt(c.x, c.z) + 0.15,
    out: +(roadEdge(c.x, c.z)?.out ?? 99).toFixed(2),
  }));
`;

const d = await openDrive({ spot, tag: `critters${rev ? '-old' : ''}`, rev, shim: rev ? SHIM : '' });
if (to) {
  const [tlat, tlon] = to.split(',').map(Number);
  await d.page.waitForTimeout(8000);
  await walkTo(d.page, tlat, tlon);
}
await d.page.waitForTimeout(settle);

const herd = await d.page.evaluate(() => window.__herd());
const near = herd.filter((c) => c.out < 8);            // anywhere near a road at all
const onDeck = herd.filter((c) => c.onDeck);
const floating = onDeck.filter((c) => c.out > 0);      // on the deck, past the kerb
console.log(rev ? `rev ${rev}` : 'working tree');
console.log(`  population ${herd.length}, within 8m of a kerb ${near.length}, on a deck ${onDeck.length}`);
console.log(`  ON DECK BUT OUTSIDE THE KERB: ${floating.length}`);
for (const c of floating.slice(0, 6)) console.log(`    ${c.sp} at ${c.x}, ${c.z} — ${c.out}m past the kerb`);

// NO REACH SWEEP HERE. One was written — step outward from the rig across a
// kerb and watch the two margins disagree — and it reported "no road underfoot"
// at every distance, because the rig spawns beside the carriageway rather than
// on it and the sweep had nothing to cross. A check that passes while measuring
// nothing is worse than no check. The population count above is honest but
// weak: a herd wanders, and two runs of it had no animal near a kerb at all, so
// zero offenders is partly luck. Drive to a herd on a cliff road and look.

report(d.errors);
await d.close();
