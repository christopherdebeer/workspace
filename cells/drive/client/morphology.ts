/**
 * ── MORPHOLOGY: WHAT THE FOOTPRINTS SAY WHEN THE TAGS SAY NOTHING ──
 *
 * Counted over the nine captures this game ships, 7,114 footprints: 75% are
 * `building=yes`, 5% carry a level count, 1.7% a roof shape, under half a
 * percent a material or a colour. Tags cannot carry local character. The
 * FOOTPRINTS can, and the same captures prove it without a single tag:
 *
 *   Paris west / south    74% / 73% attached, runs to 38 buildings, 62m² plots
 *   Camps Bay             7% attached, runs of 2, 216m² plots
 *   Carmel                8-10% attached, 162-265m² plots, no grid to speak of
 *
 * A Haussmann perimeter block and a hillside of villas are different PLACES
 * before anyone looks at a wall, and everything here is arithmetic over the
 * rings alone: whether a footprint shares a wall, how long the terrace it is
 * part of runs, how big its plot is, and whether the street it stands on is a
 * grid. Every downstream building rule — party walls, height coherence along
 * a run, terrace against villa against hall — reads these rows rather than
 * re-deriving them.
 *
 * Nothing here touches THREE or the DOM, so the same module runs in the game
 * (`__bldcensus`), over a capture in node (`devtools/building-census.mjs`)
 * and under a unit test — and the three cannot disagree, because there is one
 * of it. A census probe that reimplements the rule it measures proves nothing
 * about the rule the world runs.
 */

export interface Footprint {
  /** Anything that tells two footprints apart. An OSM id, an index, the
   *  ring's own object identity — it is only compared for equality. */
  id: number | string;
  /** The ring in local metres. A CLOSED ring (first point repeated last) is
   *  accepted and the repeat is ignored — see `attached`. */
  pts: Array<[number, number]>;
}

export interface MorphRow {
  id: number | string;
  /** Plot area, m². */
  area: number;
  /** The oriented box on the longest edge: its short and long sides, m. */
  short: number;
  long: number;
  /** Bearing of the longest edge, degrees modulo 90 — a building's grid
   *  alignment has no front or back, so 0 and 90 are the same answer. */
  ang: number;
  /** Footprints this one shares a wall with. */
  nbrs: Array<number | string>;
  /** The terrace or block this footprint belongs to, and how many are in it.
   *  A detached building is a run of one. */
  run: number;
  runN: number;
}

export interface MorphSummary {
  n: number;
  attached: number;
  /** 0..1 — the share sharing a wall with any other footprint. */
  attachedShare: number;
  /** Runs of two or more: how many, the median length, the longest. */
  runs: number;
  runMedian: number;
  runMax: number;
  /** Plot area percentiles: 25, 50, 75, 95. */
  areaQ: [number, number, number, number];
  /** 0..1 — the share of long axes within 15° of the modal 5° bin. A grid
   *  reads near 0.6 or above; a hillside that follows its contours near 0.35;
   *  the floor for random bearings is a third. */
  gridCoherence: number;
  /** The modal bearing itself, degrees modulo 90. */
  modalAng: number;
}

export interface Morphology { rows: MorphRow[]; summary: MorphSummary }

/**
 * WHAT "SHARES A WALL" MEANS HERE: two DISTINCT vertices of mine each within
 * 0.2m of one of the other footprint's. One shared vertex is a corner touch,
 * which a mapper's snapping produces between buildings that do not touch at
 * all; two shared vertices is an edge, which is a party wall. 0.2m is the snap
 * tolerance of the data: OSM nodes shared between two ways are the same node
 * and land on the same coordinate exactly, and 0.2m forgives the rest without
 * joining across an alley.
 *
 * WITHIN 0.2m IS A DISTANCE, NOT A CELL. The first cut keyed every vertex by
 * its 0.2m cell and counted cells seen twice, and the unit test's fifteen-
 * centimetre gap fell either side of a cell boundary: 10.0 rounds to cell 50
 * and 10.15 to cell 51, so a wall the rule meant to join read as an alley.
 * That is the route solver's lesson over again ("match endpoints, do not
 * quantise them") and the terrain border's (mmNear): the hash finds the
 * CANDIDATES and the distance decides, looked up over the 3x3 of cells about
 * a point so a neighbour just across a boundary is seen.
 *
 * AND A FOOTPRINT MUST NOT ATTACH TO ITSELF. The first cut of this census keyed
 * every vertex and counted keys seen twice - and every closed ring in the
 * captures repeats its first vertex last, so every building was "attached"
 * and Camps Bay read 100% terraces. A footprint's own points within 0.2m of
 * each other are ONE vertex here, which folds the closing repeat, and the test
 * holds a closed ring to a run of one.
 */
export function morphology(fps: Footprint[], cellM = 0.2): Morphology {
  type V = { id: number | string; x: number; z: number };
  const cellOf = (v: number): number => Math.round(v / cellM);
  const key = (cx: number, cz: number): string => `${cx},${cz}`;
  const within = (a: V, x: number, z: number): boolean => (a.x - x) ** 2 + (a.z - z) ** 2 <= cellM * cellM;
  const hash = new Map<string, V[]>();
  const vertsOf = new Map<number | string, V[]>();
  for (const f of fps) {
    const vs: V[] = [];
    for (const [x, z] of f.pts) {
      if (vs.some((v) => within(v, x, z))) continue;
      vs.push({ id: f.id, x, z });
    }
    vertsOf.set(f.id, vs);
    for (const v of vs) {
      const k = key(cellOf(v.x), cellOf(v.z));
      const b = hash.get(k);
      if (b) b.push(v); else hash.set(k, [v]);
    }
  }
  // Neighbours: another footprint with a vertex within cellM of two or more
  // of MINE. Counted over my distinct vertices, so two of theirs landing on
  // one of mine is still one shared corner.
  const nbrsOf = new Map<number | string, Array<number | string>>();
  for (const f of fps) {
    const shared = new Map<number | string, number>();
    for (const v of vertsOf.get(f.id)!) {
      const cx = cellOf(v.x), cz = cellOf(v.z);
      const seen = new Set<number | string>();
      for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
        const bucket = hash.get(key(cx + i, cz + j));
        if (!bucket) continue;
        for (const o of bucket) {
          if (o.id === f.id || seen.has(o.id) || !within(o, v.x, v.z)) continue;
          seen.add(o.id);
          shared.set(o.id, (shared.get(o.id) ?? 0) + 1);
        }
      }
    }
    nbrsOf.set(f.id, [...shared.entries()].filter(([, c]) => c >= 2).map(([o]) => o));
  }
  // Runs: connected components of the party-wall graph.
  const runOf = new Map<number | string, number>();
  const runSize: number[] = [];
  for (const f of fps) {
    if (runOf.has(f.id)) continue;
    const run = runSize.length;
    let n = 0;
    const stack: Array<number | string> = [f.id];
    runOf.set(f.id, run);
    while (stack.length) {
      const id = stack.pop()!;
      n++;
      for (const o of nbrsOf.get(id) ?? []) {
        if (!runOf.has(o)) { runOf.set(o, run); stack.push(o); }
      }
    }
    runSize.push(n);
  }
  const rows: MorphRow[] = fps.map((f) => {
    const { area, short, long, ang } = plan(f.pts);
    const run = runOf.get(f.id)!;
    return { id: f.id, area, short, long, ang, nbrs: nbrsOf.get(f.id) ?? [], run, runN: runSize[run] };
  });
  // ── THE SUMMARY ──
  const n = rows.length;
  const attached = rows.filter((r) => r.nbrs.length > 0).length;
  const runs = runSize.filter((s) => s > 1).sort((a, b) => a - b);
  const areas = rows.map((r) => r.area).sort((a, b) => a - b);
  const q = (p: number): number => (areas.length ? areas[Math.min(areas.length - 1, Math.floor(p * (areas.length - 1)))] : 0);
  // Grid coherence: a 5° histogram over the long axes modulo 90, and the
  // share standing within 15° (either way, wrapping) of the fullest bin.
  const bins = new Array<number>(18).fill(0);
  for (const r of rows) bins[Math.floor(r.ang / 5) % 18]++;
  let modal = 0;
  for (let i = 1; i < 18; i++) if (bins[i] > bins[modal]) modal = i;
  const modalAng = modal * 5 + 2.5;
  let near = 0;
  for (const r of rows) {
    let d = Math.abs(r.ang - modalAng);
    d = Math.min(d, 90 - d);
    if (d <= 15) near++;
  }
  return {
    rows,
    summary: {
      n, attached, attachedShare: n ? attached / n : 0,
      runs: runs.length,
      runMedian: runs.length ? runs[Math.floor(runs.length / 2)] : 0,
      runMax: runs.length ? runs[runs.length - 1] : 0,
      areaQ: [q(0.25), q(0.5), q(0.75), q(0.95)],
      gridCoherence: n ? near / n : 0,
      modalAng,
    },
  };
}

/** The plan facts of one ring: shoelace area, the oriented box on its longest
 *  edge, and that edge's bearing modulo 90. The same box `footprintSize` in
 *  main.ts and `roofGeo` compute — it is THE frame a rectangular building is
 *  reasoned about in, so it is computed one way. */
export function plan(pts: Array<[number, number]>): { area: number; short: number; long: number; ang: number } {
  const n = pts.length;
  if (n < 3) return { area: 0, short: 0, long: 0, ang: 0 };
  let a2 = 0, bi = 0, bl = -1;
  for (let i = 0; i < n; i++) {
    const [x1, z1] = pts[i], [x2, z2] = pts[(i + 1) % n];
    a2 += x1 * z2 - x2 * z1;
    const l = (x2 - x1) ** 2 + (z2 - z1) ** 2;
    if (l > bl) { bl = l; bi = i; }
  }
  const [ex1, ez1] = pts[bi], [ex2, ez2] = pts[(bi + 1) % n];
  const el = Math.hypot(ex2 - ex1, ez2 - ez1) || 1;
  const ux = (ex2 - ex1) / el, uz = (ez2 - ez1) / el;
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
  for (const [x, z] of pts) {
    const u = x * ux + z * uz, v = x * -uz + z * ux;
    if (u < u0) u0 = u; if (u > u1) u1 = u;
    if (v < v0) v0 = v; if (v > v1) v1 = v;
  }
  const du = u1 - u0, dv = v1 - v0;
  const ang = ((Math.atan2(uz, ux) * 180) / Math.PI % 90 + 90) % 90;
  return { area: Math.abs(a2) / 2, short: Math.min(du, dv), long: Math.max(du, dv), ang };
}
