/**
 * THE LINE'S ACTUAL COURSE — routed along real ways, not a chord.
 *
 * A straight line between two stations is not the line. The old N20 wanders
 * kilometres off the chord, and everything that matters — which tiles the
 * corridor covers, how far along a leg a feature sits, which roads the docket
 * should name — is measured against the ROAD or it is measured against
 * nothing.
 *
 * THE ROUTE IS WHERE THE DESIGN INTENT LIVES. The weights below prefer the
 * old road and price the autoroute out: a motorway edge costs six times its
 * length, a secondary costs its length exactly. That is the whole "bias the
 * player onto B roads" instruction expressed as a number, and it comes out as
 * a polyline plus the ordered list of named roads that carry it — which is
 * precisely the `via` the campaign schema already has a field for.
 *
 * It reads the CELL'S OVERVIEW route (~/osm/ov1 at z12: motorway through
 * tertiary, ~10km a tile), so a leg costs a dozen tiles rather than a
 * thousand, and every tile it touches is banked on the way past.
 *
 *   node cells/drive/devtools/line-route.mjs 48.7784,2.31318 48.4372,2.1725
 */
const HOST = 'https://c15r-drive.on.parc.land';
const OZ = 12;
const rad = Math.PI / 180, R = 6371000;
export const hav = (la1, lo1, la2, lo2) => {
  const s = Math.sin(((la2 - la1) * rad) / 2) ** 2
    + Math.cos(la1 * rad) * Math.cos(la2 * rad) * Math.sin(((lo2 - lo1) * rad) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
};
const tileOf = (la, lo, z) => {
  const n = 2 ** z;
  return [Math.floor(((lo + 180) / 360) * n),
    Math.floor(((1 - Math.log(Math.tan(la * rad) + 1 / Math.cos(la * rad)) / Math.PI) / 2) * n)];
};
/** THE PRICE OF EACH CLASS, as a multiple of its own length. The autoroute is
 *  not forbidden — it is simply not the line, and costs like it. */
const COST = {
  // THE MOTORWAY IS PRICED OUT; THE OLD TRUNK ROAD IS NOT. First cut charged
  // primary 1.35 against secondary 1.0 on the theory that "B roads" means
  // secondary — and sent the Paris leg 68% long, out east via Corbeil. The old
  // N20 IS classified primary (it is a former route nationale), so penalising
  // primary pushes the route off the very line it is meant to follow. Primary
  // and secondary are near-equal now; what stays expensive is the autoroute a
  // ranger would never certify, and the residential streets a through-route
  // has no business threading.
  motorway: 6, motorway_link: 6, trunk: 1.15, trunk_link: 1.15,
  primary: 1, primary_link: 1,
  secondary: 1.04, secondary_link: 1.04,
  tertiary: 1.3, tertiary_link: 1.3,
  unclassified: 2.1, residential: 3.4,
};
const SNAP = 1e-4;   // ~11 m. The overview clips each way to its own tile, so
                     // vertices either side of a tile edge never coincide
                     // exactly; snapping is what keeps the graph connected.
const key = (la, lo) => `${Math.round(la / SNAP)},${Math.round(lo / SNAP)}`;

export async function routeLine(aLat, aLon, bLat, bLon, log = () => {}) {
  const pad = 0.09;
  const c1 = tileOf(Math.max(aLat, bLat) + pad, Math.min(aLon, bLon) - pad, OZ);
  const c2 = tileOf(Math.min(aLat, bLat) - pad, Math.max(aLon, bLon) + pad, OZ);
  const tiles = [];
  for (let x = Math.min(c1[0], c2[0]); x <= Math.max(c1[0], c2[0]); x++) {
    for (let y = Math.min(c1[1], c2[1]); y <= Math.max(c1[1], c2[1]); y++) tiles.push([x, y]);
  }
  log(`route graph: ${tiles.length} overview tiles at z${OZ}`);
  const adj = new Map();     // node -> [{to, cost, m, name, ref, cls}]
  const pos = new Map();     // node -> [lat, lon]
  let served = 0, refused = 0, edges = 0;
  const filled = new Set();
  const addEdge = (k1, k2, m, cost, meta) => {
    if (!adj.has(k1)) adj.set(k1, []);
    adj.get(k1).push({ to: k2, cost, m, ...meta });
    edges++;
  };
  await Promise.all(tiles.map(async ([x, y]) => {
    try {
      const ac = new AbortController();
      const bell = setTimeout(() => ac.abort(), 14000);
      const r = await fetch(`${HOST}/~/osm/ov1/${OZ}/${x}/${y}`, { signal: ac.signal });
      clearTimeout(bell);
      if (!r.ok) { refused++; return; }
      const j = await r.json();
      served++; filled.add(`${x}/${y}`);
      eat(j);
    } catch { refused++; }
  }));
  function eat(j) {
      for (const w of j.ways ?? []) {
        const t = w.tags ?? {};
        const cls = t.highway;
        const mult = COST[cls];
        if (!mult) continue;
        const g = w.geometry ?? [];
        const meta = { name: t.name ?? null, ref: t.ref ?? null, cls };
        for (let i = 1; i < g.length; i++) {
          const p = g[i - 1], q = g[i];
          const la1 = Array.isArray(p) ? p[0] : p.lat, lo1 = Array.isArray(p) ? p[1] : p.lon;
          const la2 = Array.isArray(q) ? q[0] : q.lat, lo2 = Array.isArray(q) ? q[1] : q.lon;
          if (typeof la1 !== 'number' || typeof la2 !== 'number') continue;
          const k1 = key(la1, lo1), k2 = key(la2, lo2);
          if (k1 === k2) continue;
          pos.set(k1, [la1, lo1]); pos.set(k2, [la2, lo2]);
          const m = hav(la1, lo1, la2, lo2);
          addEdge(k1, k2, m, m * mult, meta);
          addEdge(k2, k1, m, m * mult, meta);   // oneway is not a survey's problem
        }
      }
  }
  // ONE RETRY PASS. A refusal is the cell's upstream failing, not a verdict —
  // the next attempt goes to a different mirror on the cell's own rotation, and
  // a tile that fills now is banked for everyone after.
  if (refused) {
    log(`  retrying ${refused} refused tiles…`);
    const again = tiles.filter(([x, y]) => !filled.has(`${x}/${y}`));
    refused = 0;
    await Promise.all(again.map(async ([x, y]) => {
      try {
        const ac = new AbortController();
        const bell = setTimeout(() => ac.abort(), 20000);
        const r = await fetch(`${HOST}/~/osm/ov1/${OZ}/${x}/${y}`, { signal: ac.signal });
        clearTimeout(bell);
        if (!r.ok) { refused++; return; }
        const j = await r.json();
        served++; filled.add(`${x}/${y}`);
        eat(j);
      } catch { refused++; }
    }));
  }
  log(`  tiles served ${served}, refused ${refused} · ${pos.size} nodes, ${edges} edges`);
  if (!pos.size) throw new Error('no road network available — every overview tile refused');

  const nearest = (la, lo) => {
    let best = null, bd = Infinity;
    for (const [k, [pla, plo]] of pos) {
      const d = hav(la, lo, pla, plo);
      if (d < bd) { bd = d; best = k; }
    }
    return { k: best, d: bd };
  };
  const s = nearest(aLat, aLon), e = nearest(bLat, bLon);
  log(`  anchored ${Math.round(s.d)} m from A and ${Math.round(e.d)} m from B`);

  // Dijkstra with a binary heap. The graph is a few hundred thousand edges at
  // most; a sorted array would spend the whole run in splice().
  const dist = new Map([[s.k, 0]]), prev = new Map();
  const heap = [[0, s.k]];
  const push = (d, k) => {
    heap.push([d, k]);
    let i = heap.length - 1;
    while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; }
  };
  const pop = () => {
    const top = heap[0], last = heap.pop();
    if (heap.length) { heap[0] = last; let i = 0;
      for (;;) { const l = 2 * i + 1, r = l + 1; let m = i;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } }
    return top;
  };
  const seen = new Set();
  while (heap.length) {
    const [d, k] = pop();
    if (seen.has(k)) continue;
    seen.add(k);
    if (k === e.k) break;
    for (const ed of adj.get(k) ?? []) {
      const nd = d + ed.cost;
      if (nd < (dist.get(ed.to) ?? Infinity)) { dist.set(ed.to, nd); prev.set(ed.to, { from: k, ed }); push(nd, ed.to); }
    }
  }
  if (!prev.has(e.k) && s.k !== e.k) {
    // NOT "there is no road" — there is, and the map knows it. The graph has a
    // hole where the overview tiles never filled, which during an upstream
    // outage is most of them. Say which, so the next run is a fix and not a
    // repeat.
    throw new Error(`no route: the graph is holed — ${served} of ${served + refused} overview tiles `
      + `served, ${refused} still cold. The road exists; the map of it does not yet. `
      + `Re-run when the upstream recovers (each run banks what it does get).`);
  }

  const legs = [];
  for (let k = e.k; k !== s.k;) { const p = prev.get(k); if (!p) break; legs.push({ k, ...p }); k = p.from; }
  legs.reverse();
  const line = [pos.get(s.k)];
  let metres = 0;
  const roads = new Map();
  for (const l of legs) {
    line.push(pos.get(l.k));
    metres += l.ed.m;
    const nm = l.ed.ref ? `${l.ed.ref}` : (l.ed.name ?? `(${l.ed.cls})`);
    roads.set(nm, (roads.get(nm) ?? 0) + l.ed.m);
  }
  const chord = hav(aLat, aLon, bLat, bLon);
  return { line, metres, chord, roads: [...roads.entries()].sort((x, y) => y[1] - x[1]), served, refused };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const pts = process.argv.slice(2).filter((a) => /^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/.test(a));
  if (pts.length < 2) { console.error('usage: line-route <lat,lon> <lat,lon>'); process.exit(1); }
  const [aLat, aLon] = pts[0].split(',').map(Number);
  const [bLat, bLon] = pts[1].split(',').map(Number);
  const r = await routeLine(aLat, aLon, bLat, bLon, (m) => console.error(m));
  console.log(`\nroute ${(r.metres / 1000).toFixed(1)} km along the ways`);
  console.log(`chord ${(r.chord / 1000).toFixed(1)} km — the route is ${((r.metres / r.chord - 1) * 100).toFixed(0)}% longer, which is the point`);
  console.log(`${r.line.length} vertices\n`);
  console.log('THE ROADS THAT CARRY IT — the docket\'s `via`, in order of share:');
  for (const [nm, m] of r.roads.slice(0, 14)) {
    if (m < 400) continue;
    console.log(`  ${(m / 1000).toFixed(1).padStart(6)} km  ${nm}`);
  }
}
