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
const SPOT = process.env.FIX ? `fixture=${process.env.FIX}&cam=chase` : (process.env.SPOT ?? 'lat=-33.91661&lon=18.40784&h=179&cam=top&z=145');
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
// A control older than the probe still has the build log: derive the build
// order and the reasons from it, with distances from the tile keys.
const a = await q((spot) => {
  if (window.__streamAudit) return window.__streamAudit();
  const log = window.__buildLog();
  const t = window.__tstats();
  const m = /lat=(-?[\d.]+)&lon=(-?[\d.]+)/.exec(spot);
  const lat0 = m ? +m[1] : 0, lon0 = m ? +m[2] : 0;
  const centre = (key) => {
    const [x, y] = key.split('/').map(Number), n = 2 ** 14;
    const lon = ((x + 0.5) / n) * 360 - 180;
    const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + 0.5)) / n))) * 180) / Math.PI;
    return { d: Math.round(Math.hypot((lon - lon0) * 111320 * Math.cos((lat0 * Math.PI) / 180), (lat - lat0) * 111320)), ahead: null };
  };
  const byWhy = {}, perTile = new Map(), seen = new Set(), firstOrder = [];
  for (const b of log) {
    const w = b.why.split(':')[0]; byWhy[w] = (byWhy[w] ?? 0) + 1;
    perTile.set(b.key, (perTile.get(b.key) ?? 0) + 1);
    if (!seen.has(b.key)) { seen.add(b.key); firstOrder.push({ key: b.key, at: b.at, ...centre(b.key) }); }
  }
  return { fromBuildLog: true, terrain: { tiles: t.meshes, builds: t.builds, byWhy, perTile: [...perTile].map(([key, n]) => ({ key, n })).sort((p, q) => q.n - p.n).slice(0, 10), firstOrder, fetchOrder: [], dirty: t.dirty, held: null },
    osm: { ask: [], done: t.osmDone, inFlight: t.inFlight, queued: t.queued }, far: { level: null, tiles: null, asked: null, fetchOrder: [] }, drapes: { drapes: null, ofDrapes: null } };
}, SPOT);
if (a.fromBuildLog) console.log(`[${el()}] (no __streamAudit at this revision: build order and reasons from the last ${Math.min(400, a.terrain.builds)} entries of __buildLog)`);
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
