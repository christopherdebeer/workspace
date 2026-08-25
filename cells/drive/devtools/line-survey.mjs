/**
 * THE CORRIDOR SURVEY — the authoring tool for observations on the line.
 *
 * The narrative forbids fictional places (drive-narrative.md §10): every
 * station sits on a real OSM feature, and so must every observation. This
 * walks the corridor between two authored stations, asks the map what is
 * actually standing there, and prints candidates in the campaign's own shape.
 * The author still chooses and writes the prose — this only guarantees the
 * COORDINATE is real.
 *
 * WHY IT IS A TOOL AND NOT A ONE-OFF QUERY: the mirrors refuse for days at a
 * time (see the R57 record), so the survey has to be re-runnable rather than
 * done once by hand. A run that cannot reach the map says so and exits 2 —
 * it never prints a candidate it could not verify.
 *
 *   node cells/drive/devtools/line-survey.mjs 47.945,1.904 47.250,2.060
 */
const [fromArg, toArg] = process.argv.slice(2);
if (!fromArg || !toArg) { console.error('usage: line-survey <lat,lon> <lat,lon>'); process.exit(1); }
const [aLat, aLon] = fromArg.split(',').map(Number);
const [bLat, bLon] = toArg.split(',').map(Number);
const pad = 0.12;   // ~13km either side: the corridor, not the motorway's world
const bbox = [Math.min(aLat, bLat) - pad, Math.min(aLon, bLon) - pad,
  Math.max(aLat, bLat) + pad, Math.max(aLon, bLon) + pad].map((n) => n.toFixed(4)).join(',');

// The vocabulary the fiction actually uses: things a ranger would record, and
// things the map's categories handle badly. Deliberately NOT "tourist
// attraction" — a waymark is infrastructure and land use, not scenery.
const Q = `[out:json][timeout:90];
(
  nwr["historic"~"^(ruins|aqueduct|castle|fort|archaeological_site|boundary_stone|milestone)$"](${bbox});
  nwr["man_made"~"^(water_tower|water_works|reservoir_covered|pipeline|chimney|silo|communications_tower|survey_point)$"](${bbox});
  nwr["waterway"~"^(dam|weir|lock_gate)$"](${bbox});
  nwr["landuse"~"^(quarry|landfill|forest)$"]["name"](${bbox});
  nwr["military"~"^(bunker|training_area|airfield)$"](${bbox});
  nwr["power"="substation"]["name"](${bbox});
);
out center 400;`;

const MIRRORS = ['https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter'];
const hav = (la1, lo1, la2, lo2) => {
  const R = 6371000, r = Math.PI / 180;
  const dla = (la2 - la1) * r, dlo = (lo2 - lo1) * r;
  const s = Math.sin(dla / 2) ** 2 + Math.cos(la1 * r) * Math.cos(la2 * r) * Math.sin(dlo / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
};
/** Metres from the straight A->B line, and how far along it (0..1). */
const offLine = (la, lo) => {
  const x = (lo - aLon) * Math.cos((aLat * Math.PI) / 180), y = la - aLat;
  const bx = (bLon - aLon) * Math.cos((aLat * Math.PI) / 180), by = bLat - aLat;
  const t = Math.max(0, Math.min(1, (x * bx + y * by) / (bx * bx + by * by || 1e-9)));
  const px = aLon + ((bLon - aLon) * t), py = aLat + ((bLat - aLat) * t);
  return { off: hav(la, lo, py, px), t };
};

let data = null;
for (const m of MIRRORS) {
  try {
    const r = await fetch(m, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ data: Q }) });
    if (!r.ok) { console.error(`  ${m} -> ${r.status}`); continue; }
    data = await r.json();
    console.error(`  served by ${m}`);
    break;
  } catch (e) { console.error(`  ${m} -> ${String(e).slice(0, 60)}`); }
}
if (!data) {
  console.error('\nNO MAP AVAILABLE — every mirror refused. This is the documented');
  console.error('outage class, not an empty corridor. Re-run later; nothing is printed');
  console.error('rather than printing a candidate that could not be verified.');
  process.exit(2);
}
const cat = (t) => ['historic', 'man_made', 'waterway', 'military', 'power', 'landuse']
  .filter((k) => t[k]).map((k) => `${k}=${t[k]}`)[0] ?? '?';
const rows = [];
for (const e of data.elements ?? []) {
  const t = e.tags ?? {};
  const c = e.center ?? { lat: e.lat, lon: e.lon };
  if (!c?.lat) continue;
  const { off, t: along } = offLine(c.lat, c.lon);
  // ON THE CORRIDOR BUT OFF THE STRAIGHT LINE is the whole point: a candidate
  // that sits ON the trunk line teaches the player nothing about leaving it.
  if (off > 12000 || along <= 0.02 || along >= 0.98) continue;
  rows.push({ km: +(along * hav(aLat, aLon, bLat, bLon) / 1000).toFixed(1),
    off: Math.round(off), cat: cat(t), name: t.name ?? '(unnamed)',
    lat: +c.lat.toFixed(5), lon: +c.lon.toFixed(5) });
}
rows.sort((x, y) => x.km - y.km);
console.log(`\n${rows.length} candidates along ${hav(aLat, aLon, bLat, bLon) / 1000 | 0} km\n`);
console.log('   KM   OFF-LINE  CATEGORY                 NAME');
for (const r of rows) {
  console.log(`  ${String(r.km).padStart(5)}  ${String(r.off).padStart(6)}m  ${r.cat.padEnd(24)} ${r.name.slice(0, 34)}`);
  console.log(`         ${r.lat},${r.lon}`);
}
console.log('\nThe author picks from these and writes map/field/note by hand.');
console.log('A candidate is a COORDINATE THAT EXISTS — never a story.');
