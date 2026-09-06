/**
 * IS EVERY REEL START ACTUALLY ON A ROAD?
 *
 *   node cells/drive/devtools/reel-roads.mjs
 *
 * A driven slot is a place and a goal, and the place has to be somewhere the
 * autopilot can drive FROM. The first cut of the list put Chapman's Peak at
 * -34.0745,18.3590 — a coordinate this session had ALREADY established sits in
 * Hout Bay, out on the water — and the reel duly armed, engaged the autopilot,
 * found 1009 road cells and sat perfectly still for ninety seconds with
 * `src: none`, because there was no road under the rig to take.
 *
 * So the list is checked against the same OSM tiles the game streams: for each
 * start, the nearest drivable way and how far off it the spawn is. No browser
 * — the cell serves the vectors and this is one fetch a site.
 */
import { REEL_DRIVES } from '../client/reel-drives.ts';

const BASE = process.env.DRIVE_CELL ?? 'https://c15r-drive.on.parc.land';
const Z = 16;
const DRIVABLE = /^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|service|living_street|road|track)(_link)?$/;

const tileOf = (lat, lon) => {
  const n = 2 ** Z, r = (lat * Math.PI) / 180;
  return [Math.floor((lon + 180) / 360 * n),
    Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n)];
};
const meters = (aLat, aLon, bLat, bLon) => {
  const dLat = (bLat - aLat) * 111320;
  const dLon = (bLon - aLon) * 111320 * Math.cos((aLat * Math.PI) / 180);
  return Math.hypot(dLat, dLon);
};

/** The nearest point on a segment, in metres — a spawn between two nodes is on
 *  the road even when it is nowhere near either of them. */
function toSeg(lat, lon, a, b) {
  const k = Math.cos((lat * Math.PI) / 180);
  const px = (lon - a[1]) * k, py = lat - a[0];
  const vx = (b[1] - a[1]) * k, vy = b[0] - a[0];
  const L2 = vx * vx + vy * vy;
  const t = L2 > 0 ? Math.max(0, Math.min(1, (px * vx + py * vy) / L2)) : 0;
  return Math.hypot(px - vx * t, py - vy * t) * 111320;
}

let bad = 0;
for (const d of REEL_DRIVES) {
  for (const [what, lat, lon] of [['start', d.lat, d.lon], ['goal ', d.goal.lat, d.goal.lon]]) {
    const [tx, ty] = tileOf(lat, lon);
    let ways = [];
    try {
      const res = await fetch(`${BASE}/~/osm/v4/${Z}/${tx}/${ty}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      ways = (await res.json()).ways ?? [];
    } catch (err) {
      console.log(`${d.id.padEnd(10)} ${what}  TILE REFUSED (${err.message}) — cannot judge`);
      continue;
    }
    let best = Infinity, name = '', cls = '';
    for (const w of ways) {
      const hw = w.tags?.highway;
      if (!hw || !DRIVABLE.test(hw)) continue;
      const g = w.geometry ?? [];
      for (let i = 0; i + 1 < g.length; i++) {
        const dm = toSeg(lat, lon, g[i], g[i + 1]);
        if (dm < best) { best = dm; name = w.tags.name ?? '(unnamed)'; cls = hw; }
      }
    }
    // A START must be ON the road; a GOAL is only a direction and the router
    // aims for the closest it can get, so it is allowed to be well off one.
    const limit = what === 'start' ? 25 : 4000;
    const okd = best <= limit;
    if (!okd) bad++;
    console.log(`${okd ? 'ok   ' : 'FAIL '} ${d.id.padEnd(10)} ${what}  ${best === Infinity ? 'NO DRIVABLE WAY IN TILE'
      : `${best.toFixed(0)}m from ${cls} ${name}`}${okd ? '' : `   (limit ${limit}m)`}`);
  }
}
console.log(bad ? `\n${bad} FAILED` : '\nall ok');
process.exit(bad ? 1 : 0);
