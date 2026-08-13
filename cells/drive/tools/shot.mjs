/**
 * LOOK AT A PLACE.
 *
 *   node cells/drive/tools/shot.mjs NAME --spot='lat=..&lon=..&h=..&cam=cab' \
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
// AIM. `walkTo` arrives on the bearing it travelled, which is a straight line
// across country and almost never the way a road runs — the first shot taken
// with it was of a hillside. A step in a carriageway is only visible from along
// the carriageway, so say what to look at.
const face = arg('face', '');
if (face) {
  const [flat, flon] = face.split(',').map(Number);
  await d.page.evaluate((ll) => {
    const t = window.__tolocal(ll[0], ll[1]);
    const s = window.__drive;
    s.heading = Math.atan2(t[0] - s.x, -(t[1] - s.z));
  }, [flat, flon]);
}
await d.page.waitForTimeout(settle);
await d.shot(name);
console.log(`-> ${join(WORK, `${name}.png`)}`);
report(d.errors);
await d.close();
