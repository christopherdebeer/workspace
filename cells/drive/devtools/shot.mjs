/**
 * LOOK AT A PLACE.
 *
 *   node cells/drive/devtools/shot.mjs NAME --spot='lat=..&lon=..&h=..&cam=cab' \
 *        [--to=lat,lon] [--settle=20000]
 *
 * Writes a PNG beside the build. The eye check that goes with a measurement —
 * a number can say two decks agree and a picture can still show a wall, and
 * more than once here the picture was the thing that was wrong.
 *
 * `--to` walks the rig in rather than spawning on the spot, because several
 * defects in this world only exist on the arrival path.
 *
 * `--spot` is the whole query string, so anything the game reads from the URL
 * pins the conditions too — `&sunalt=` above all, without which a time-of-day
 * cycle makes two runs incomparable for reasons unrelated to the change.
 */
import { join } from 'node:path';
import { openDrive, report, walkTo, WORK } from './harness.mjs';

const args = process.argv.slice(2);
const arg = (k, d) => {
  const a = args.find((v) => v.startsWith(`--${k}=`));
  return a === undefined ? d : a.slice(k.length + 3);
};
const name = args.find((a) => !a.startsWith('--')) ?? 'shot';
const spot = arg('spot', 'lat=-34.06719&lon=18.37021&h=27&cam=cab');
const to = arg('to', '');
const settle = Number(arg('settle', 20000));

const d = await openDrive({ spot, tag: 'shot' });
if (to) {
  const [tlat, tlon] = to.split(',').map(Number);
  console.log(`booting at ${spot}, walking to ${tlat},${tlon}…`);
  await d.page.waitForTimeout(8000);
  await walkTo(d.page, tlat, tlon);
}
await d.page.waitForTimeout(settle);
// STAND IN A SHELL. Tunnels and galleries here are not tagged in OSM — they are
// found from the terrain — so their locations are not knowable until the world
// has been built, which is why this comes AFTER the settle and not with the
// other placement options.
const shell = arg('shell', '');
if (shell !== '') {
  const spot2 = await d.page.evaluate((i) => {
    const s = window.__shells().spots[Number(i)];
    if (!s) return null;
    const st = window.__drive;
    // A few metres INSIDE the mouth, aimed at the far end: a slot between two
    // bays only shows when you are looking along the wall it is in.
    const dx = s[2] - s[0], dz = s[3] - s[1], l = Math.hypot(dx, dz) || 1;
    st.x = s[0] + (dx / l) * 6; st.z = s[1] + (dz / l) * 6;
    st.heading = Math.atan2(dx, -dz);
    st.speed = 0;
    return [...s, Math.round(l)];
  }, shell);
  console.log(spot2 ? `shell ${shell}: standing at its mouth (${spot2[0]}, ${spot2[1]}), looking ${spot2[4]}m down it`
    : `no shell ${shell}`);
}
// AIM. `walkTo` arrives on the bearing it travelled, which is a straight line
// across country and almost never the way a road runs — the first shot taken
// with it was of a hillside. A step in a carriageway, or a slot in a tunnel
// wall, is only visible from ALONG the thing, so say what to look at.
const face = arg('face', '');
if (face) {
  const [flat, flon] = face.split(',').map(Number);
  await d.page.evaluate((ll) => {
    const t = window.__tolocal(ll[0], ll[1]);
    const s = window.__drive;
    s.heading = Math.atan2(t[0] - s.x, -(t[1] - s.z));
  }, [flat, flon]);
}
await d.page.waitForTimeout(8000);   // let the move settle wherever it landed
await d.shot(name);
console.log(`-> ${join(WORK, `${name}.png`)}`);
report(d.errors);
await d.close();
