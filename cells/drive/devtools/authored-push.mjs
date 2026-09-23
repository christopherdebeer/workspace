#!/usr/bin/env node
/**
 * File an authored entry into the live drive cell's store from the shell.
 *
 *   PARC_TOKEN=… node devtools/authored-push.mjs entry.json         # file
 *   PARC_TOKEN=… node devtools/authored-push.mjs --retract osm 16/x/y
 *   node devtools/authored-push.mjs --index                          # read
 *
 * An entry names its LAYER and a tile of that layer's own grid — `osm` at
 * z16 (like `~/osm/v5`), `cover` at z12 (`~/cover/v1`), `dem` at z14
 * (`~/dem/v1`) — and carries what that layer takes:
 *   osm:   `ways`  — `{ tags, geometry: [{lat, lon}] }`, OSM's own shape, so
 *                    an authored building is a building;
 *          `patch` — `{ "<osm id>": { tags } }` merged onto the map's own way,
 *                    which needs the file's `tile` (an id carries no position);
 *   cover: `cells` — `[index, class]` over the tile's 256×256 class raster;
 *   dem:   `cells` — `[index, metres]` over its 256×256 height raster.
 * An entry REPLACES the tile's overlay for that layer; an empty one retracts
 * it. With no `tile`, ways are filed under every z16 tile they touch.
 *
 * The bearer is the caller: the cell's dispatch turns it into x-cell-caller,
 * and the drive cell's own grant (owner, or a principal it is shared with)
 * decides whether the POST reaches the handler at all. Mint a token scoped
 * to the cell, use it, revoke it.
 */
import { readFileSync } from 'node:fs';
const BASE = process.env.DRIVE_BASE ?? 'https://c15r-drive.on.parc.land';
const Z = { osm: 16, cover: 12, dem: 14 };
const args = process.argv.slice(2);
const flag = (f) => { const i = args.indexOf(f); return i >= 0 ? (args[i + 1] ?? true) : null; };
const tileOf = (lat, lon, z = 16) => {
  const n = 2 ** z;
  const x = Math.floor(((lon + 180) / 360) * n);
  const y = Math.floor(((1 - Math.log(Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)) / Math.PI) / 2) * n);
  return `${z}/${x}/${y}`;
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
  const layer = flag('--retract');
  const tile = args[args.indexOf('--retract') + 2];
  if (!Z[layer] || !tile) { console.error('usage: --retract <osm|cover|dem> <z/x/y>'); process.exit(2); }
  process.exit((await post(layer === 'osm' ? { layer, tile, ways: [] } : { layer, tile, cells: [] })) ? 0 : 1);
} else {
  const file = args.find((a) => !a.startsWith('--'));
  if (!file) { console.error('usage: authored-push.mjs entry.json | --retract <layer> <z/x/y> | --index'); process.exit(2); }
  const entry = JSON.parse(readFileSync(file, 'utf8'));
  const layer = entry.layer ?? 'osm';
  if (!Z[layer]) { console.error(`layer must be osm, cover or dem (saw ${layer})`); process.exit(2); }
  if (layer !== 'osm') {
    if (!entry.tile) { console.error(`a ${layer} entry must name its tile at z${Z[layer]}`); process.exit(2); }
    console.log(`→ ${layer} ${entry.tile}: ${(entry.cells ?? []).length} cell(s)`);
    process.exit((await post({ layer, tile: entry.tile, cells: entry.cells ?? [] })) ? 0 : 1);
  }
  // One body per z16 tile: ways under every tile they touch, the patch under
  // the file's own tile.
  const byTile = new Map();
  const bodyFor = (t) => { if (!byTile.has(t)) byTile.set(t, { layer: 'osm', tile: t, ways: [], patch: {} }); return byTile.get(t); };
  for (const w of entry.ways ?? []) {
    const tiles = entry.tile ? [entry.tile] : [...new Set(w.geometry.map((g) => tileOf(g.lat, g.lon)))];
    for (const t of tiles) bodyFor(t).ways.push(w);
  }
  if (entry.patch && Object.keys(entry.patch).length) {
    if (!entry.tile) { console.error('a patch needs the file to name its tile — an osm id carries no position'); process.exit(2); }
    Object.assign(bodyFor(entry.tile).patch, entry.patch);
  }
  if (!byTile.size) { console.error('nothing to file'); process.exit(2); }
  let ok = true;
  for (const [tile, body] of byTile) {
    console.log(`→ osm ${tile}: ${body.ways.length} way(s), ${Object.keys(body.patch).length} patched`);
    ok = (await post(body)) && ok;
  }
  process.exit(ok ? 0 : 1);
}
