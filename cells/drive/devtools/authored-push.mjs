#!/usr/bin/env node
/**
 * File an authored entry into the live drive cell's store from the shell.
 *
 *   PARC_TOKEN=… node devtools/authored-push.mjs entry.json        # file
 *   PARC_TOKEN=… node devtools/authored-push.mjs --retract 16/x/y  # retract
 *   node devtools/authored-push.mjs --index                          # read
 *
 * entry.json is `{ "tile": "16/x/y", "ways": [...], "patch": {...}, "dems":
 * [...] }` — any of the three. Without a `tile`, ways are filed under every
 * z16 tile one of their points falls in (one id per slot, and renderWays
 * dedupes on it) and dem cells under their own; a patch needs the tile. A
 * way is `{ tags, geometry: [{lat, lon}] }`, OSM's own shape; a patch is
 * `{ "<osm id>": { tags } }` merged onto the map's own way; a dem cell is
 * `[lat, lon, metres]` written into the height raster.
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
  // Three kinds in one file: ways (filed under every tile they touch), a
  // patch by osm id (needs the file's `tile`), and dem cells (by their own
  // position, or the file's tile). With a `tile`, everything goes there.
  const byTile = new Map();
  const bodyFor = (t) => { if (!byTile.has(t)) byTile.set(t, { tile: t, ways: [], patch: {}, dems: [] }); return byTile.get(t); };
  for (const w of entry.ways ?? []) {
    const tiles = entry.tile ? [entry.tile] : [...new Set(w.geometry.map((g) => tileOf(g.lat, g.lon)))];
    for (const t of tiles) bodyFor(t).ways.push(w);
  }
  if (entry.patch && Object.keys(entry.patch).length) {
    if (!entry.tile) { console.error('a patch needs the file to name its tile — an osm id carries no position'); process.exit(2); }
    Object.assign(bodyFor(entry.tile).patch, entry.patch);
  }
  for (const c of entry.dems ?? []) bodyFor(entry.tile ?? tileOf(c[0], c[1])).dems.push(c);
  let ok = true;
  for (const [tile, body] of byTile) {
    console.log(`→ ${tile}: ${body.ways.length} way(s), ${Object.keys(body.patch).length} patched, ${body.dems.length} dem cell(s)`);
    ok = (await post(body)) && ok;
  }
  process.exit(ok ? 0 : 1);
}
