/**
 * A JOB FOR EVERY BENCHMARK DRIVE — authored from the real ways, not invented.
 *
 *   node cells/drive/devtools/bench-missions.mjs            # every bench drive
 *   node cells/drive/devtools/bench-missions.mjs MILLAU
 *   node cells/drive/devtools/bench-missions.mjs --emit     # campaign blocks
 *
 * A spawn is a place to stand; a JOB is a reason to drive the particular road
 * the fixture is about. Without one you arrive at Hardknott, look at it, and
 * wander off down the valley — which is the one direction that tells you
 * nothing about how the solver handled the pass.
 *
 * So each of these gets what Chapman's Peak already has: a giver where you
 * spawn, a destination at the far end of the road under test, and a `via` that
 * makes arriving mean having DRIVEN it rather than having reached the end of
 * it.
 *
 * ── WHY THIS IS A TOOL AND NOT A HAND-WRITTEN BLOCK ──
 *
 * `via.name` is matched against the way's OSM `name` tag — not its ref — so a
 * job naming a road the data does not name is a job that can never be
 * completed, and it fails silently: the checkpoints simply never appear. That
 * is not a thing to guess at from memory for sixteen roads in eight countries.
 * The same goes for the destination, which has to sit ON the road rather than
 * near it.
 *
 * Output is printed for a person to read and paste, the way line-legs.mjs
 * does. A campaign is authored data; a generated job still gets looked at
 * before it becomes one.
 *
 * OVERPASS IS NOT USED. All three mirrors were down while this was written and
 * the cell could not fill a single cold tile. The OSM API serves a bbox of raw
 * XML from a different service and was up throughout — and for "what is this
 * way called and where does it end" it is the more direct question anyway.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { XMLParser } from './xmlish.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const API = 'https://api.openstreetmap.org/api/0.6/map';
const DRIVABLE = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary',
  'unclassified', 'residential', 'motorway_link', 'trunk_link', 'primary_link']);

const hav = (a, b) => {
  const R = 6371000, r = Math.PI / 180;
  const dla = (b[0] - a[0]) * r, dlo = (b[1] - a[1]) * r;
  const s = Math.sin(dla / 2) ** 2
    + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dlo / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
};

/**
 * A box around a centre, or around both ends of an aimed job.
 *
 * `pad` is in degrees of longitude and the latitude half-span is 0.7 of it,
 * which is roughly square at these latitudes and small enough that the API
 * serves it.
 */
async function bbox(centre, pad) {
  const [lat, lon] = centre;
  const bb = `${(lon - pad).toFixed(4)},${(lat - pad * 0.7).toFixed(4)},`
    + `${(lon + pad).toFixed(4)},${(lat + pad * 0.7).toFixed(4)}`;
  for (let a = 0; a < 3; a++) {
    try {
      const res = await fetch(`${API}?bbox=${bb}`);
      if (res.ok) return XMLParser(await res.text());
      // 400 is the API refusing an area with too many nodes — a smaller box is
      // the answer, and the caller steps down.
      if (res.status === 400) return null;
    } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 2000));
  }
  return null;
}

/**
 * The road under the spawn, as one ordered polyline of NAMED points.
 *
 * Ways are chained by SHARED END NODES and matching ref, which is how OSM
 * splits one road: a ref changes nothing about the tarmac, but a bridge, a
 * surface change or a speed limit all start a new way.
 *
 * CHAIN BY REF, NAME ONLY AS A FALLBACK — and the two are genuinely different
 * questions. A ref is stable along a road; a NAME changes every few hundred
 * metres. Chaining by name found 630m of "High Street" and called it the A35
 * through the New Forest, and 470m of "Main Road" and called it SH 6 down the
 * West Coast. Chaining by ref finds the road.
 *
 * Each point carries the name of the way it came from, because `via` has to be
 * a NAME — so the caller can ask "what name covers the stretch I am asking
 * for" rather than "what name covers the most of everything nearby".
 */
function traceRoad(doc, lat, lon, want) {
  const nodes = new Map(doc.nodes.map((n) => [n.id, [n.lat, n.lon]]));
  const ways = doc.ways
    .filter((w) => DRIVABLE.has(w.tags.highway))
    .map((w) => ({ ...w, pts: w.nds.map((id) => nodes.get(id)).filter(Boolean) }))
    .filter((w) => w.pts.length >= 2);
  if (!ways.length) return null;

  // The nearest way that matches what we were told to look for — by name, ref
  // or class, so a road with no name is still findable.
  const hay = (w) => `${w.tags.ref ?? ''}|${w.tags.name ?? ''}|${w.tags.highway}`.toLowerCase();
  const near = (w) => Math.min(...w.pts.map((p) => hav([lat, lon], p)));
  const cands = ways.filter((w) => want.some((x) => hay(w).includes(x.toLowerCase())));
  if (!cands.length) return null;
  const seed = cands.reduce((a, b) => (near(a) <= near(b) ? a : b));

  const key = seed.tags.ref ?? seed.tags.name ?? null;
  const same = key
    ? ways.filter((w) => (w.tags.ref ?? w.tags.name) === key)
    : [seed];
  const endsOf = (w) => [w.pts[0], w.pts[w.pts.length - 1]];
  const chain = [seed];
  const used = new Set([seed.id]);
  let grew = true;
  while (grew) {
    grew = false;
    const [h] = endsOf(chain[0]);
    const t = endsOf(chain[chain.length - 1])[1];
    for (const w of same) {
      if (used.has(w.id)) continue;
      const [a, b] = endsOf(w);
      const j = (p, q) => hav(p, q) < 2;
      if (j(a, t)) { chain.push(w); used.add(w.id); grew = true; break; }
      if (j(b, t)) { chain.push({ ...w, pts: w.pts.slice().reverse() }); used.add(w.id); grew = true; break; }
      if (j(b, h)) { chain.unshift(w); used.add(w.id); grew = true; break; }
      if (j(a, h)) { chain.unshift({ ...w, pts: w.pts.slice().reverse() }); used.add(w.id); grew = true; break; }
    }
  }
  const line = [];
  for (const w of chain) for (const p of w.pts) {
    if (!line.length || hav(line[line.length - 1].p, p) > 1) {
      line.push({ p, name: w.tags.name ?? null });
    }
  }
  return { key, ref: seed.tags.ref ?? null, highway: seed.tags.highway,
    line, pieces: chain.length };
}

/**
 * What the job actually asks for: the stretch of the traced line between the
 * spawn and the destination, and what carries it.
 *
 * MEASURED OVER THE STRETCH, NOT THE CHAIN. The first version scored `via`
 * against everything traced, which is the wrong denominator twice over: it
 * dropped Cheddar to 67% because the B3135 continues past the job's end, and
 * it would have priced the New River Gorge Bridge at 11% of a US 19 chain the
 * job never touches. A job asks for one stretch; the name that carries THAT is
 * the one a via can honestly name.
 */
function stretch(line, from, to) {
  const idx = (q) => {
    let best = 0, bd = Infinity;
    for (let i = 0; i < line.length; i++) {
      const d = hav(q, line[i].p);
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  };
  const a = idx(from), b = idx(to);
  const seg = line.slice(Math.min(a, b), Math.max(a, b) + 1);
  let m = 0;
  const byName = new Map();
  for (let i = 1; i < seg.length; i++) {
    const d = hav(seg[i - 1].p, seg[i].p);
    m += d;
    // A segment belongs to the name of the point it runs INTO, so a piece's
    // own length is attributed to that piece rather than to its predecessor.
    const nm = seg[i].name;
    if (nm) byName.set(nm, (byName.get(nm) ?? 0) + d);
  }
  const top = [...byName.entries()].sort((x, y) => y[1] - x[1])[0];
  return { km: m / 1000, names: byName.size,
    viaName: top ? top[0] : null, viaKm: top ? top[1] / 1000 : 0,
    share: m > 0 && top ? top[1] / m : 0 };
}

/** The bench drives, by the sub line they were authored with. */
function benchDrives() {
  const src = readFileSync(join(HERE, '../campaigns/dakar.ts'), 'utf8');
  const out = [];
  const re = /name: "([^"]+)",\s*\n\s*sub: "([^"]+)",\s*\n\s*lat: (-?[\d.]+),\s*\n\s*lon: (-?[\d.]+),\s*\n\s*h: (-?\d+),/g;
  let m;
  while ((m = re.exec(src))) out.push({ name: m[1], sub: m[2], lat: +m[3], lon: +m[4], h: +m[5] });
  return out;
}

/**
 * What to look for at each, most specific first — and where to point.
 *
 * `aim` OVERRIDES "the far end of what was traced", and two fixtures need it
 * because they are about a FEATURE on a long road rather than the road. US 19
 * chains ten pieces and its farthest point is 6.6km up the highway NORTH of
 * the gorge — a job that never crosses the bridge the fixture exists for. The
 * D809's chain is clipped by the bbox above Millau, so its far end is uphill
 * away from the descent the fixture is about. Where `aim` is set the box is
 * grown to hold both ends and the destination is the traced point nearest it.
 */
const TARGET = {
  BELP: { want: ['belpbergstrasse', 'secondary'] },
  FURKA: { want: ['furka', 'primary'] },
  AXENSTRASSE: { want: ['axenstrasse', 'primary'] },
  FLEVOLAND: { want: ['bosruiterweg'] },
  AFSLUITDIJK: { want: ['a7', 'motorway'] },
  KLEINPOLDERPLEIN: { want: ['a20', 'motorway'] },
  HARDKNOTT: { want: ['hardknott', 'tertiary'] },
  'CHEDDAR GORGE': { want: ['cliff road', 'b3135', 'secondary'] },
  'NEW FOREST': { want: ['a35', 'primary'] },
  'ATLANTIC ROAD': { want: ['atlanterhavsvegen', '64', 'primary'] },
  // The far abutment, so the job is the span and nothing else.
  'NEW RIVER GORGE': { want: ['us 19', 'trunk'], aim: [38.0664, -81.0874] },
  'FAYETTE STATION': { want: ['fayette station', 'tertiary'] },
  MILLAU: { want: ['a 75', 'a75', 'motorway'] },
  // Down the valley into Millau, which is the direction the fixture is about.
  'TARN VALLEY': { want: ['d 809', 'd809', 'primary'], aim: [44.108, 3.081] },
  'REST AND BE THANKFUL': { want: ['a83', 'trunk'] },
  'SH6 WEST COAST': { want: ['sh 6', 'primary'] },
};

const EMIT = process.argv.includes('--emit');
const only = process.argv.slice(2).filter((a) => !a.startsWith('-')).map((s) => s.toUpperCase());
const drives = benchDrives().filter((d) => TARGET[d.name] && (!only.length || only.includes(d.name)));

console.log(`# ${drives.length} bench drive(s)\n`);
for (const d of drives) {
  const { want, aim } = TARGET[d.name];
  // An aimed job needs a box holding both ends; an open one grows from the
  // spawn until it has found enough road to be worth driving.
  const centre = aim ? [(d.lat + aim[0]) / 2, (d.lon + aim[1]) / 2] : [d.lat, d.lon];
  const reach = aim
    ? Math.max(Math.abs(d.lon - aim[1]), Math.abs(d.lat - aim[0]) / 0.7) / 2 + 0.006
    : 0;
  const pads = aim ? [reach, reach * 0.75] : [0.014, 0.008, 0.005];
  let r = null;
  for (const pad of pads) {
    const doc = await bbox(centre, pad);
    if (!doc) continue;
    r = traceRoad(doc, d.lat, d.lon, want);
    if (r && r.line.length > 4) break;
  }
  if (!r) { console.log(`${d.name.padEnd(22)} NO ROAD TRACED`); continue; }
  // Where the job ends: what it was aimed at, or the far end from the spawn so
  // it crosses the ground rather than starting beside its own destination.
  const far = aim
    ? r.line.reduce((a, q) => (hav(aim, q.p) < hav(aim, a.p) ? q : a), r.line[0]).p
    : r.line.reduce((a, q) => (hav([d.lat, d.lon], q.p) > hav([d.lat, d.lon], a.p) ? q : a), r.line[0]).p;
  const s = stretch(r.line, [d.lat, d.lon], far);
  const span = hav([d.lat, d.lon], far) / 1000;
  // A via is worth setting when one name carries most of the stretch. Below
  // that the job is dest-only, which is not a lesser job: where a road is the
  // only way through, reaching the far end IS having driven it.
  const named = s.viaName && s.share > 0.6;
  if (!EMIT) {
    const via = named ? `via "${s.viaName}" (${(s.share * 100).toFixed(0)}% of it)`
      : `NO VIA — ${s.names} name(s) over ${s.km.toFixed(1)}km, dest-only`;
    console.log(`${d.name.padEnd(22)} ${(r.ref ?? r.key ?? '?').padEnd(12)}`
      + ` [${r.highway}] ${r.pieces}pc, job ${s.km.toFixed(2)}km  ${via}`);
    console.log(`${''.padEnd(22)}   dest ${far[0].toFixed(5)}, ${far[1].toFixed(5)}`
      + ` — ${span.toFixed(2)}km out`);
    await new Promise((s2) => setTimeout(s2, 1200));
    continue;
  }
  const id = `bench-${d.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  const what = d.sub.split('·')[1]?.trim() ?? d.name;
  // HALF THE CHECKPOINTS ON THE NAMED RUN. The survey lays one every 250m for
  // claiming a road; Chapman's asks for 6 of its 18 and the note there explains
  // why a COUNT beats a majority for a job. Half is the same spirit: enough
  // that you have driven the thing, low enough to survive joining part way
  // along or a diversion round a closure.
  const atLeast = Math.max(3, Math.round((s.viaKm * 1000 / 250) * 0.5));
  const q = (t) => t.replace(/"/g, '\\"');
  const lines = [
    '        mission: {',
    `          id: "${id}",`,
    '          giver: {',
    `            name: "${q(d.name)}",`,
    `            lat: ${d.lat},`,
    `            lon: ${d.lon},`,
    '          },',
    `          title: "${q(what.toUpperCase())}",`,
    `          brief: "${q(named ? `DRIVE ${s.viaName.toUpperCase()} END TO END` : 'CROSS TO THE FAR SIDE')}",`,
    '          dest: {',
    `            name: "${q(named ? s.viaName.toUpperCase() : `${d.name} FAR END`)}",`,
    `            lat: ${+far[0].toFixed(5)},`,
    `            lon: ${+far[1].toFixed(5)},`,
    '          },',
    '          within: 140,',
  ];
  if (named) {
    lines.push('          via: {', `            name: "${q(s.viaName)}",`,
      `            atLeast: ${atLeast},`, '          },',
      `          viaNote: "${q(`${s.viaName} carries ${(s.share * 100).toFixed(0)}% of the ${s.km.toFixed(1)}km this job asks for, so a via can name it. ${atLeast} is about half the survey's checkpoints over that run — enough that you have driven it, low enough to survive joining part way along.`)}",`);
  } else {
    // Two different reasons to have no via, and they are worth telling apart:
    // an unnamed road cannot be named at all, a many-named one could be but
    // only for a fraction of itself.
    const road = r.ref ?? 'this road';
    const asks = `the ${s.km.toFixed(1)}km this job asks for`;
    const pct = `${(s.share * 100).toFixed(0)}%`;
    const why = s.names === 0
      ? `${road} carries no name tag at all over ${asks} — only a ref, and via matches the way's NAME.`
      : s.names === 1
        ? `The only name on ${road} over ${asks} is "${s.viaName}", and it covers ${pct} of it — so a via naming it would ask for that fraction and let the rest of the drive go uncounted.`
        : `${road} goes under ${s.names} different names over ${asks}, the longest carrying only ${pct} of it, and via matches the way's NAME rather than its ref — so naming any one of them would ask for a fraction of the road and the rest would not count.`;
    lines.push(`          viaNote: "${q(`NO VIA. ${why} Dest-only is not a lesser job here: this is the way through, so reaching the far end IS having driven it.`)}",`);
  }
  lines.push('        },');
  console.log(`// ${d.name}: ${r.ref ?? r.key} [${r.highway}] job ${s.km.toFixed(2)}km, ${span.toFixed(2)}km out`);
  console.log(lines.join('\n'));
  await new Promise((s3) => setTimeout(s3, 1200));
}
