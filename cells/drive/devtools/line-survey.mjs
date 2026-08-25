/**
 * THE CORRIDOR SURVEY — the authoring tool for observations on the line.
 *
 * The narrative forbids fictional places (drive-narrative.md §10): every
 * station sits on a real OSM feature, and so must every observation. This
 * walks the corridor between two authored stations and asks what is actually
 * standing there. The author still writes the prose — this only guarantees the
 * COORDINATE is real.
 *
 * IT ASKS THROUGH THE CELL'S OWN TILE ROUTE, and that is the whole design:
 *
 *   1. `~/osm/v3/{z}/{x}/{y}` is a READ-THROUGH CACHE — a miss fetches
 *      upstream, trims, and putTile()s the result at the edge. Surveying a leg
 *      therefore BANKS it: the corridor the author reads about is the corridor
 *      the player later drives, already warm.
 *   2. It is the path the game itself uses, at the zoom the game itself asks
 *      (z16), through the same trim. A survey through another door would
 *      report features the client would never see.
 *   3. Tiles already banked keep answering through the Overpass outages that
 *      take the public mirrors down for days.
 *
 *   node cells/drive/devtools/line-survey.mjs 47.945,1.904 47.250,2.060
 *        [--band KM] [--miss-ms N] [--host URL]
 */
const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf(`--${n}`); return i < 0 ? d : args[i + 1]; };
const pts = args.filter((a) => /^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/.test(a));
if (pts.length < 2) { console.error('usage: line-survey <lat,lon> <lat,lon> [--band KM] [--miss-ms N]'); process.exit(1); }
const [aLat, aLon] = pts[0].split(',').map(Number);
const [bLat, bLon] = pts[1].split(',').map(Number);
// ±3 km by default. The straight line between two stations is NOT the road —
// over forty kilometres the old N20 wanders kilometres off the chord — and a
// band that hugs the chord misses both the road and the point, which is to
// find what sits OFF it.
const BAND = Number(flag('band', 3)) * 1000;
const MISS_MS = Number(flag('miss-ms', 3500));
const HOST = flag('host', 'https://c15r-drive.on.parc.land');
const Z = 16;

const R = 6371000, rad = Math.PI / 180;
const hav = (la1, lo1, la2, lo2) => {
  const s = Math.sin(((la2 - la1) * rad) / 2) ** 2
    + Math.cos(la1 * rad) * Math.cos(la2 * rad) * Math.sin(((lo2 - lo1) * rad) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
};
const tileOf = (la, lo) => {
  const n = 2 ** Z;
  return [Math.floor(((lo + 180) / 360) * n),
    Math.floor(((1 - Math.log(Math.tan(la * rad) + 1 / Math.cos(la * rad)) / Math.PI) / 2) * n)];
};
const tileCentre = (tx, ty) => {
  const n = 2 ** Z, lo = ((tx + 0.5) / n) * 360 - 180;
  const k = Math.PI - (2 * Math.PI * (ty + 0.5)) / n;
  return [(180 / Math.PI) * Math.atan(0.5 * (Math.exp(k) - Math.exp(-k))), lo];
};
/** Metres off the A->B line, and how far along it (0..1). */
const offLine = (la, lo) => {
  const kx = Math.cos(aLat * rad);
  const x = (lo - aLon) * kx, y = la - aLat;
  const bx = (bLon - aLon) * kx, by = bLat - aLat;
  const t = Math.max(0, Math.min(1, (x * bx + y * by) / (bx * bx + by * by || 1e-9)));
  return { off: hav(la, lo, aLat + (bLat - aLat) * t, aLon + (bLon - aLon) * t), t };
};

// THE TILES, CHOSEN EXACTLY: walk the grid over the leg's box and keep those
// whose centre falls inside the band. (The first cut stepped along the line
// throwing a 5x5 of offsets at each step — it asked for the same tile dozens
// of times and still missed corners.)
const legM = hav(aLat, aLon, bLat, bLon);
const want = new Map();
{
  const padLa = BAND / 111320 + 0.01;
  const padLo = padLa / Math.cos(((aLat + bLat) / 2) * rad);
  const c1 = tileOf(Math.max(aLat, bLat) + padLa, Math.min(aLon, bLon) - padLo);
  const c2 = tileOf(Math.min(aLat, bLat) - padLa, Math.max(aLon, bLon) + padLo);
  for (let tx = Math.min(c1[0], c2[0]); tx <= Math.max(c1[0], c2[0]); tx++) {
    for (let ty = Math.min(c1[1], c2[1]); ty <= Math.max(c1[1], c2[1]); ty++) {
      const [la, lo] = tileCentre(tx, ty);
      const { off, t } = offLine(la, lo);
      if (off <= BAND + 450 && t > 0 && t < 1) want.set(`${tx}/${ty}`, [tx, ty]);
    }
  }
}
// WALK THE CORRIDOR IN ORDER, station to station. Enumerating the grid gives
// tx-major order — a north-south strip down the far edge of the bounding box,
// which on a diagonal leg is entirely off the road. The first cut did exactly
// that, met sixty cold tiles before reaching the line, and reported "the
// upstream is down" about a corridor that was serving fine.
const tiles = [...want.entries()]
  .map(([k, v]) => { const [la, lo] = tileCentre(v[0], v[1]); return { k, v, t: offLine(la, lo).t }; })
  .sort((a, b) => a.t - b.t).map((r) => r.v);
console.error(`corridor ${(legM / 1000).toFixed(1)} km · band ±${BAND / 1000} km · ${tiles.length} z${Z} tiles`);
console.error(`through ${HOST}/~/osm/v3/${Z}/… — a miss fetches upstream AND banks it`);

// THE VOCABULARY a ranger would record. Deliberately not "tourist attraction":
// an observation is infrastructure and land use, not scenery.
const KEEP = (t) => {
  if (/^(ruins|aqueduct|castle|fort|archaeological_site|boundary_stone|milestone|memorial)$/.test(t.historic ?? '')) return `historic=${t.historic}`;
  if (/^(water_tower|water_works|reservoir_covered|pipeline|chimney|silo|communications_tower|survey_point|windmill|lighthouse|storage_tank)$/.test(t.man_made ?? '')) return `man_made=${t.man_made}`;
  if (/^(dam|weir|lock_gate)$/.test(t.waterway ?? '')) return `waterway=${t.waterway}`;
  if (/^(bunker|training_area|airfield)$/.test(t.military ?? '')) return `military=${t.military}`;
  if (t.power === 'substation') return 'power=substation';
  if (/^(quarry|landfill)$/.test(t.landuse ?? '')) return `landuse=${t.landuse}`;
  if (t.aeroway === 'aerodrome') return 'aeroway=aerodrome';
  return null;
};

let ok = 0, refused = 0, emptyT = 0, run = 0, dead = false, done = 0;
/** Consecutive misses. A long run means the upstream is down, not that the
 *  country is empty — stop asking rather than grinding a thousand timeouts
 *  through a service that is already struggling. */
// Trip only when a long run of misses comes with NOTHING served: that is an
// outage. A long run beside real answers is just a stretch of empty country,
// which most of the line is.
const miss = () => { run++; if (run >= 80 && ok === 0) dead = true; };
const found = new Map();
let next = 0;
const lane = async () => {
  for (;;) {
    const i = next++;
    if (i >= tiles.length || dead) return;
    const [tx, ty] = tiles[i];
    try {
      // A MISS COSTS THE CELL A FULL UPSTREAM BUDGET (~15s) and, while Overpass
      // refuses, buys nothing. Hang up early: a banked tile answers from the
      // edge in well under a second. The cell's own fill may still finish and
      // bank it after we have gone, which is the outcome we wanted anyway.
      const ac = new AbortController();
      const bell = setTimeout(() => ac.abort(), MISS_MS);
      const r = await fetch(`${HOST}/~/osm/v3/${Z}/${tx}/${ty}`, { signal: ac.signal });
      clearTimeout(bell);
      if (!r.ok) { refused++; miss(); continue; }
      const j = await r.json();
      const ways = j.ways ?? [];
      ok++; run = 0;
      if (!ways.length) emptyT++;
      for (const e of ways) {
        const t = e.tags ?? {};
        const cat = KEEP(t);
        if (!cat) continue;
        // THE CELL'S TRIM STORES GEOMETRY AS [lat, lon] PAIRS, not the {lat,
        // lon} objects Overpass emits — reading `.lat` off them yields
        // undefined for every feature, which this tool did, and then reported
        // an empty corridor with total confidence. Take the MIDPOINT of a way
        // rather than its first vertex: the Medici aqueduct is 145 points and
        // kilometres long, and its first vertex is not where it is.
        const g = e.geometry ?? [];
        const mid = g.length ? g[Math.floor(g.length / 2)] : null;
        const la = mid ? (Array.isArray(mid) ? mid[0] : mid.lat) : e.lat;
        const lo = mid ? (Array.isArray(mid) ? mid[1] : mid.lon) : e.lon;
        if (typeof la !== 'number' || typeof lo !== 'number') continue;
        const key = String(e.id ?? `${la},${lo}`);
        if (found.has(key)) continue;
        const { off, t: along } = offLine(la, lo);
        found.set(key, { cat, name: t.name ?? '(unnamed)', lat: +la.toFixed(5), lon: +lo.toFixed(5),
          km: +((along * legM) / 1000).toFixed(1), off: Math.round(off) });
      }
    } catch { refused++; miss(); }
    if (++done % 50 === 0) console.error(`  … ${done}/${tiles.length} · served ${ok} · refused ${refused} · found ${found.size}`);
  }
};
await Promise.all(Array.from({ length: 5 }, lane));

console.error(`\ntiles served ${ok} (${emptyT} with nothing in them) · refused ${refused}${dead ? ' · STOPPED EARLY' : ''}`);
if (dead) {
  console.error('NOTHING SERVED IN EIGHTY TRIES — the upstream is down for everything not');
  console.error('already banked, so the survey stopped rather than grind. What follows');
  console.error('is only the part of the corridor that was already warm.');
} else if (refused > tiles.length * 0.3) {
  console.error('A THIRD OF THE CORRIDOR DID NOT ANSWER. Partial: re-run to fill it.');
}
const rows = [...found.values()].filter((r) => r.km > 0.4 && r.km < legM / 1000 - 0.4)
  .sort((x, y) => x.km - y.km);
console.log(`\n${rows.length} candidates along ${(legM / 1000).toFixed(1)} km\n`);
console.log('    KM    OFF   CATEGORY                  NAME');
for (const r of rows) {
  console.log(`  ${String(r.km).padStart(5)} ${String(r.off).padStart(5)}m   ${r.cat.padEnd(24)} ${String(r.name).slice(0, 30)}`);
  console.log(`        ${r.lat},${r.lon}`);
}
console.log('\nA candidate is a COORDINATE THAT EXISTS — never a story.');
console.log('The author picks from these and writes the two columns by hand.');
