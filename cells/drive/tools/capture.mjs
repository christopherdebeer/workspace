/**
 * CAPTURE A ROAD-SOLVER FIXTURE from a real session.
 *
 *   node cells/drive/tools/capture.mjs NAME [--heights] [--spot=lat=..&lon=..]
 *
 * Writes `client/fixtures/NAME.json`: the world origin, the terrain tiles, and
 * every renderWays call in the order the tiles actually arrived. That last part
 * is the point — the tests replay real arrival order rather than a tidy
 * reconstruction of it, because the bugs being chased live in the ordering.
 *
 * `--heights` includes the elevation samples. Without them a fixture is tens of
 * kilobytes and answers which ways reach the solver and how they chain; with
 * them it is megabytes and can also run the real bench DP, which is the only
 * way to tell a flyover from a turning. Take the small one unless the question
 * is about deck heights.
 *
 * The tape is armed from an init script, not after boot: renderWays runs while
 * the world streams, and a tape armed afterwards misses exactly the calls that
 * matter.
 */
import { writeFileSync, mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { openDrive, report, CELL } from './harness.mjs';

const args = process.argv.slice(2);
const name = args.find((a) => !a.startsWith('--')) ?? 'capture';
const heights = args.includes('--heights');
const spot = (args.find((a) => a.startsWith('--spot=')) ?? '').slice(7)
  || 'lat=-34.06719&lon=18.37021&h=27&cam=chase';
const soak = Number((args.find((a) => a.startsWith('--soak=')) ?? '').slice(7) || 90000);

const d = await openDrive({
  spot,
  tag: 'capture',
  // Arm the tape the instant the probe exists — before the world streams.
  init: () => {
    const arm = setInterval(() => {
      if (window.__tape) { window.__tape(true); clearInterval(arm); }
    }, 20);
  },
});
console.log(`streaming ${spot} for ${soak / 1000}s…`);
await d.page.waitForTimeout(soak);

const fix = await d.page.evaluate((h) => ({ ...window.__fixture(h), calls: window.__tapeout() }), heights);
const dir = join(CELL, 'client/fixtures');
mkdirSync(dir, { recursive: true });
const path = join(dir, `${name}.json`);
writeFileSync(path, JSON.stringify(fix));

const ways = fix.calls.reduce((n, c) => n + c.els.length, 0);
console.log(`${name}: ${fix.calls.length} renderWays calls, ${ways} ways, ${fix.tiles.length} terrain tiles`
  + `${heights ? ' (with heights)' : ''}`);
console.log(`  -> ${path}  ${(statSync(path).size / 1024).toFixed(0)} KB`);
report(d.errors);
await d.close();
