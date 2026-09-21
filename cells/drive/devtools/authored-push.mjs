#!/usr/bin/env node
/**
 * File an authored entry into the live drive cell's store from the shell.
 *
 *   PARC_TOKEN=… node devtools/authored-push.mjs entry.json        # file
 *   PARC_TOKEN=… node devtools/authored-push.mjs --retract 16/x/y  # retract
 *   node devtools/authored-push.mjs --index                          # read
 *
 * entry.json is `{ "tile": "16/x/y", "ways": [...] }`, or `{ "ways": [...] }`
 * with the tiles inferred: each way is filed under every z16 tile one of
 * its points falls in, so a way across an edge is drawn once (one id per
 * slot, and renderWays dedupes on it). A way is `{ tags, geometry: [{lat,
 * lon}] }` — OSM's own shape, so an authored building is a building.
 *
 * The bearer is the caller: the cell's dispatch turns it into x-cell-caller,
 * and the drive cell's own grant (owner, or a principal it is shared with)
 * decides whether the POST reaches the handler at all. Mint a token scoped
 * to the cell, use it, revoke it.
 */
import { readFileSync } from 'node:fs';
const BASE = process.env.DRIVE_BASE ?? 'https://c15r-drive.on.parc.land';
const args = process.argv.slice(2);
const flag = (f) => { const i = args.indexOf(f); return i >= 0 ? (args[i + 1] ?? true) : null; };
const tileOf = (lat, lon) => {
  const n = 2 ** 16;
  const x = Math.floor(((lon + 180) / 360) * n);
  const y = Math.floor(((1 - Math.log(Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)) / Math.PI) / 2) * n);
  return `16/${x}/${y}`;
};
const post = async (body) => {
  const tok = process.env.PARC_TOKEN;
  if (!tok) { console.error('PARC_TOKEN is not set'); process.exit(2); }
  const r = await fetch(`${BASE}/authored`, { method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${tok}` }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  console.log(r.status, JSON.stringify(j));
  return r.ok;
};
if (flag('--index')) {
  const r = await fetch(`${BASE}/authored`, { cache: 'no-store' });
  console.log(r.status, JSON.stringify(await r.json().catch(() => ({})), null, 1));
} else if (flag('--retract')) {
  process.exit((await post({ tile: flag('--retract'), ways: [] })) ? 0 : 1);
} else {
  const file = args.find((a) => !a.startsWith('--'));
  if (!file) { console.error('usage: authored-push.mjs entry.json | --retract 16/x/y | --index'); process.exit(2); }
  const entry = JSON.parse(readFileSync(file, 'utf8'));
  const byTile = new Map();
  for (const w of entry.ways ?? []) {
    const tiles = entry.tile ? [entry.tile] : [...new Set(w.geometry.map((g) => tileOf(g.lat, g.lon)))];
    for (const t of tiles) { if (!byTile.has(t)) byTile.set(t, []); byTile.get(t).push(w); }
  }
  let ok = true;
  for (const [tile, ways] of byTile) { console.log(`→ ${tile}: ${ways.length} way(s)`); ok = (await post({ tile, ways })) && ok; }
  process.exit(ok ? 0 : 1);
}
