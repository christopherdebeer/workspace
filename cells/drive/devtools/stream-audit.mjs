/**
 * WHAT THE STREAM ASKS FOR, IN WHAT ORDER, AND WHAT IT REBUILDS — live, at a
 * spot, for a fixed wall-clock budget. Reported from the chart over the Cape
 * Town CBD (\`?lat=-33.91661&lon=18.40784&h=179&cam=top&z=145\`): the tile
 * overlay showed the fine ring filling from the sea to the north while the
 * peninsula ahead waited, and the telemetry showed 260 terrain builds for 26
 * tiles in 85 s, 58 ms of main thread each. \`__streamAudit\` says, per layer,
 * what was asked and in what order against distance and heading, how many
 * times each terrain tile was built and why, and the order tiles were FIRST
 * built against how far ahead they stood.
 *
 *   node devtools/stream-audit.mjs                # the CBD spot, 240 s
 *   SPOT='lat=…&lon=…&h=…&cam=top&z=145' BUDGET=300 REV=<sha> TAG=<name> node …
 *
 * Live through the curl relay: the network is not the phone's, so compare
 * runs against each other on the same day, never against the device.
 */
import { openDrive, WORK } from './harness.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
const OUT = process.env.AUDIT_OUT ?? join(WORK, 'stream-audit');
mkdirSync(OUT, { recursive: true });
const SPOT = process.env.SPOT ?? 'lat=-33.91661&lon=18.40784&h=179&cam=top&z=145';
const REV = process.env.REV || '';
const TAG = process.env.TAG ?? `stream-audit${REV ? '-ctl' : ''}`;
const BUDGET = +(process.env.BUDGET ?? 240);
const t0 = Date.now();
const el = () => `${((Date.now() - t0) / 1000).toFixed(0)}s`;
const d = await openDrive({ spot: `${SPOT}&time=NOON&nodraw=1`, tag: TAG, settle: 0, bootTimeout: 240000, rev: REV });
const q = async (fn, ...a) => d.page.evaluate(fn, ...a);
const samples = [];
for (let s = 0; s < BUDGET; s += 10) {
  await d.page.waitForTimeout(10000);
  const t = await q(() => window.__tstats());
  samples.push({ t: s + 10, ...t });
  console.log(`[${el()}] t+${s + 10}s tiles ${t.heightTiles} meshes ${t.meshes} builds ${t.builds} dirty ${t.dirty} corridor ${t.corridorMeshes} | osmDone ${t.osmDone} inFlight ${t.inFlight} queued ${t.queued} ways ${t.seenWays} roadCells ${t.roadCells}`);
}
const a = await q(() => window.__streamAudit());
writeFileSync(join(OUT, `audit-${TAG}.json`), JSON.stringify({ samples, audit: a }, null, 1));
const tr = a.terrain;
console.log(`[${el()}] terrain: ${tr.tiles} tiles, ${tr.builds} builds (${(tr.builds / Math.max(1, tr.tiles)).toFixed(1)} per tile), by reason ${JSON.stringify(tr.byWhy)}; worst tiles ${JSON.stringify(tr.perTile.slice(0, 6))}`);
console.log(`[${el()}] first-build order (rank: distance m, ahead?): ${tr.firstOrder.slice(0, 16).map((f, i) => `${i + 1}:${f.d}${f.ahead ? 'A' : 'B'}`).join(' ')}`);
console.log(`[${el()}] terrain fetch order: ${tr.fetchOrder.slice(0, 16).map((f, i) => `${i + 1}:${f.d}${f.ahead ? 'A' : 'B'}`).join(' ')}`);
console.log(`[${el()}] osm ask (rank: distance m, ahead?): ${a.osm.ask.slice(0, 16).map((f, i) => `${i + 1}:${f.d}${f.ahead ? 'A' : 'B'}`).join(' ')} · done ${a.osm.done} inFlight ${a.osm.inFlight} queued ${a.osm.queued}`);
console.log(`[${el()}] far: level z${a.far.level} ${a.far.tiles}/${a.far.asked}; fetch order ${a.far.fetchOrder.slice(0, 10).map((f, i) => `${i + 1}:${f.d}`).join(' ')}`);
console.log(`[${el()}] redrape: last build touched ${a.drapes.drapes} of ${a.drapes.ofDrapes} drapes`);
console.log(`[${el()}] errors ${d.errors.length} ${JSON.stringify(d.errors.slice(0, 2))}`);
await d.close();
