/**
 * THE TERRAIN KERNEL: everything a terrain tile build computes, over plain
 * arrays and a store of world facts, with no THREE and no DOM — so the same
 * code runs on the main thread today and in a worker next (see
 * docs/terrain-worker.md). `buildTile` is the whole build: the lattice or the
 * road-refined geometry, the heights, the corridor and channel carves, the
 * border ownership, the colour pass and the vertex normals. The main thread
 * wraps the arrays in a BufferGeometry and places the mesh.
 *
 * Every fact the build reads comes through `TerrainStore`; nothing here
 * touches a module global of main.ts. That is the contract that makes the
 * worker possible: a worker-side store answers the same questions from a
 * mirror of the rasters, strips and channels.
 */
export interface HeightTile { tx: number; ty: number; xs: number; zs: number; w: number; h: number; data: Float32Array }
export type Rgb = [number, number, number];
export type MmPt = [number, number, number];
export interface CarveLog { s: number[][]; v: number[][] }
export interface BreakLine { ax: number; az: number; bx: number; bz: number }
/** The part of a road or channel strip the build reads. main.ts's Seg has more. */
export interface StripLike {
  ax: number; az: number; bx: number; bz: number; hw: number;
  ya?: number; yb?: number; tk?: boolean; tn?: boolean; ca?: number; cb?: number; pc?: number; pp?: number;
  bl?: BreakLine[]; reach?: number;
}
/** The triangles of each lattice cell: `offs[c]..offs[c+1]` index `tris` in threes. */
export interface CellTris { seg: number; offs: Int32Array; tris: Int32Array }
export interface RefinedMesh { pos: Float32Array; uv: Float32Array; idx: Uint32Array; kinds: Uint8Array; cells: number; tris: number; cellTris: CellTris }
export interface TileBuild {
  pos: Float32Array; uv: Float32Array; idx: Uint32Array; colors: Float32Array; normals: Float32Array;
  kinds: Uint8Array | null; cellTris: CellTris; refined: boolean; corridor: boolean;
}
/** The world, as the build asks it. Getters on the main thread; a mirror in a worker. */
export interface TerrainStore {
  readonly heights: Map<string, HeightTile>;
  hasHeight(x: number, z: number): boolean;
  sampleHeight(x: number, z: number): number;
  sampleHeightRaw(x: number, z: number): number;
  sampleCover(x: number, z: number): number | null;
  coverPaint(x: number, z: number): number | null;
  coverWater(x: number, z: number): boolean;
  readonly cover: { water: number; built: number };
  seaAbs(): number;
  readonly baseElev: number;
  readonly strips: Map<string, StripLike[]>;
  readonly cutL: number;
  readonly channels: Map<string, StripLike[]>;
  readonly grid: number;
  onRoad(x: number, z: number): boolean;
  palette(elevAbs: number, slope: number, cover: number | null, x: number, z: number): Rgb;
  areaTint(x: number, z: number): Rgb | null;
  readonly borders: Map<string, Float64Array>;
  readonly nrmScale: number;
  readonly cutWash: number;
  readonly cprobe: boolean;
  readonly carveLog: Map<string, CarveLog>;
  readonly cutRelief: boolean;
}
export type Poly = Array<[number, number]>;

/** Everything the raster side of the store answers, over plain maps of
 *  tiles — the same code on the main thread and in the worker. */
export interface RasterWorld {
  heights: Map<string, HeightTile>;
  cover: Map<string, CoverTile>;
  origin: { lat: number; lon: number; mLon: number };
  baseElev: number;
  /** Landmark pads: x, z, pad radius, pad elevation (local), in fours. */
  pads: ArrayLike<number>;
  waterTilt: number;
  coverPx: number;
}
export interface CoverTile { xs: number; zs: number; w: number; h: number; data: Uint8Array }
export interface PaletteState {
  ramp: Array<[number, Rgb]>;
  ramps: Array<Array<[number, Rgb]>>;
  coverTint: Record<number, Rgb>;
  coverMix: number;
  water: number; built: number;
  seaOn: boolean; dryAt: boolean; seaAbs: number;
  climate(x: number, z: number, elevAbs: number): ArrayLike<number> | null;
}
export interface AreaPatchLike { pts: Array<[number, number]>; tint: Rgb; x0: number; z0: number; x1: number; z1: number }
/**
 * THE FACTORY. Everything below is one closure so that `createTerrainKernel
 * .toString()` is a complete program: the worker is built from that string
 * (see terrain-worker.ts), the way the road profile worker is. Nothing in
 * here may reach a module-scope binding of this file — types only, which
 * erase — or the worker would throw on its first job.
 */
export function createTerrainKernel() {
  const cutSet = new Set<StripLike>();
  /** A relief step smaller than this is not worth a pass. */
  const RELIEF_MIN = 0.06;
  /** Rolling carve cost: [tiles carved, total ms, tiles that needed relief]. */
  const carveCost = { tiles: 0, ms: 0, relieved: 0 };
  const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v));
  const BANK_K = 0.6;         // a fill bank falls this much per metre out from the crest
  const CUTF_K = 0.62;        // a cut face rises this much per metre out — the carve's own slope
  const CUT_REACH_M = 8;      // past this an unmet cut face steps up to the hill: a wall
  const TOE_REACH = 16;       // how far out a bank or a face is looked for at all
  const DECK_GAP_T = 3;       // a crest this far above the ground is a structure: no bank
  const EARTH_T: Rgb = [0.42, 0.34, 0.26];
  /** The corridor is built into tiles this close to the truck; further out a
   *  tile keeps the plain grid and the carve, and STITCHES to any refined
   *  neighbour along their shared border. A tile that comes into range while
   *  plain is rebuilt — see flushTerrain. */
  // ── the road corridor: a volume, not a decal ───────────────────────
  // A ribbon draped on the heightfield is a zero-thickness surface, and the
  // terrain MESH is not the heightfield: it carries one vertex every ~21m and
  // interpolates flat between them, while the ribbon samples the bilinear field
  // every 12m and again at both kerbs. On any curved hillside the two disagree
  // by metres, and the road either floats or is swallowed. Two halves fix it:
  //
  //   DOWN — every carriageway is extruded into a solid (see `apron` below), so
  //          the gap under a floating road is filled with earth instead of sky.
  //   UP   — the terrain is cut back out of the corridor, so nothing stands in
  //          the road's airspace. The cut is graded outward into a bank rather
  //          than left as a wall.
  // The ceiling sits BELOW the tarmac across the carriageway and rises beyond
  // the kerb — but NOT at the batter straight away, and the reason is the
  // terrain mesh's own sampling. The cut lives in a FIELD; the mesh samples it
  // at terrainSeg vertices per tile (~16m apart) and draws straight triangles
  // between them. A ceiling that rises 32° from the kerb permits a vertex 10m
  // out to stand 6m over the road, and the chord from there to the far side
  // bridges clean over the corridor: Natural Bridge Road measured 5.6% of its
  // length under such chords, the truck roof-deep in a hillside that the field
  // said was cut. So the ceiling holds a near-flat BENCH (a 1.7° wash, enough
  // to shed the dead-level look) out to the mesh cell diagonal — every corner
  // of every triangle a road can pass through is inside that distance, so no
  // chord can stand higher than wash·slack ≈ 0.7m below the road surface — and
  // only beyond the bench does the 32° batter climb away.
  // ── THE VERTICAL BUDGET, in one place ──────────────────────────────
  // The visible daylight between tarmac and ground on FLAT land is exactly
  // CUT_CLEAR + the road lift: the cut lowers the ground to profile−CUT_CLEAR
  // and the deck is drawn at profile+lift. Measured before this was named:
  // 0.55m median at Noordhoek, Big Sur AND dead-flat Death Valley.
  // Was 0.12, which with the old 0.18 lift guaranteed 0.30m of daylight at every
  // kerb on dead-flat ground — a kerb, systematically, on every paved road in the
  // world. Safe to cut now for a reason that did not hold before: `groundAt` IS
  // the carved mesh, so this no longer has to cover a disagreement between the
  // closed form and the surface actually drawn. Measured at Rio before the
  // change: the ground never came within 0.31m of the tarmac at the 95th
  // percentile, so the whole budget was unused headroom.
  const CUT_CLEAR = 0.04;    // how far below the deck floor the cut plane sits
  // ── the cut, as a raster of where carriageways actually are ────────
  // This replaces a 22m flat bench, a 14m graded tail, a 32° batter, a "bed"
  // and a "hard" layer — five mechanisms that were all compensating for one
  // fact: the terrain mesh draws straight chords between vertices a cell
  // apart, so any triangle a road passes through must have ALL THREE corners
  // held below the deck or the chord over the road stands proud of it.
  //
  // The old answer clamped every point within a cell-diagonal of every kerb to
  // a flat terrace, and took the MIN across all roads in reach — which planed
  // whole junctions down to their lowest carriageway and carved a canyon
  // either side of every road (measured at Noordhoek: ground 9.5m below
  // natural, 34m from a 7m road).
  //
  // The new answer marks the lattice cells the carriageway strip actually
  // crosses, with the LOCAL deck floor of the strip in that cell. A consumer
  // asks the 3×3 neighbourhood around its point, which is precisely "could a
  // triangle through my point be crossed by that strip" — so the guarantee
  // (no chord over a deck) survives, while the clamp reaches at most two
  // cells past the kerb instead of a bench plus a tail, and the value it
  // clamps to is the nearest strip's own height rather than the minimum of
  // every road within forty metres.
  /** How far under the surface the seabed is dropped where cover says water.
   *  Deep enough to read as open sea through the water shader, shallow enough
   *  that the shelf at the shoreline stays a shelf rather than a trench. */
  const SEA_BED = 6;
  /** Every built terrain tile overlapping a world rectangle, marked for rebuild. */
  const AREA_MIX = 0.5;               // how far the ramp is pulled, after the raster's own tint
  /** Cost of the refinement, for `__refine`. */
  const refineCost = { tiles: 0, cells: 0, tris: 0, ms: 0, plainTris: 0, verts: 0, msLines: 0, msSplit: 0, msHeights: 0, msGeo: 0 };
  /** The plain build by phase, every build: where a 115ms tile goes. */
  /** The plain build by phase, every build: where a 115ms tile goes. */
  const plainCost = { builds: 0, refine: 0, heights: 0, carve: 0, channels: 0, pins: 0, colour: 0, normals: 0, mesh: 0, nan: '' as string };
  /** The first phase that wrote a non-finite height, recorded once. */
  function nanScan(pos: Float32Array, phase: string, key: string): void {
    if (plainCost.nan) return;
    for (let i = 1; i < pos.length; i += 3) if (!Number.isFinite(pos[i])) { plainCost.nan = `${phase} ${key} v${(i - 1) / 3} x=${pos[i - 1]} z=${pos[i + 1]}`; return; }
  }

  /** How far out along (ox,oz) from a crest point (cx,cz) whose floor is y the
   *  wedge meets the ground: 0 at the crest already, CUT_REACH_M for a wall,
   *  -1 where the road stands clear of the ground (a structure: no bank). */

  /** A point's millimetre cell. */
  const mmKey = (x: number, z: number): string => `${Math.round(x * 1000)},${Math.round(z * 1000)}`;
  /** A border row indexed by millimetre cell, and the lookup that finds a
   *  point WITHIN a millimetre rather than in exactly its cell: a world
   *  position recovered from a Float32 local one carries up to 6e-5 of error,
   *  so the same point can sit either side of a cell boundary. */
  function mmIndex(row: ArrayLike<number>): Map<string, MmPt> {
    const m = new Map<string, MmPt>();
    for (let i = 0; i + 2 < row.length; i += 3) m.set(mmKey(row[i], row[i + 1]), [row[i], row[i + 1], row[i + 2]]);
    return m;
  }
  function mmNear(idx: Map<string, MmPt>, x: number, z: number, tol = 1.5e-3): MmPt | undefined {
    const kx = Math.round(x * 1000), kz = Math.round(z * 1000);
    const exact = idx.get(`${kx},${kz}`);
    if (exact && Math.abs(exact[0] - x) <= tol && Math.abs(exact[1] - z) <= tol) return exact;
    let best: MmPt | undefined, bd = tol * tol;
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      const p = idx.get(`${kx + dx},${kz + dz}`);
      if (!p) continue;
      const d = (p[0] - x) * (p[0] - x) + (p[1] - z) * (p[1] - z);
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }
  /** Is (x, z) on the tile's boundary — one of its four edges, within it? */
  /** Is (x, z) on the tile's boundary — one of its four edges, within it? */
  function onTileEdge(t: HeightTile, x: number, z: number): boolean {
    const e = 1e-3;
    if (x < t.xs - e || x > t.xs + t.w + e || z < t.zs - e || z > t.zs + t.h + e) return false;
    return Math.abs(x - t.xs) < e || Math.abs(x - (t.xs + t.w)) < e || Math.abs(z - t.zs) < e || Math.abs(z - (t.zs + t.h)) < e;
  }
  /** Where the quiet-path border audit is in its round of the tiles. */
  /** Split a convex polygon by the infinite line through a break line. Points
   *  that land on a cell boundary are recomputed from the line and the boundary
   *  coordinate, so the neighbouring cell — split by the same line, from its own
   *  pieces — arrives at the same point bit for bit. */
  function splitPoly(poly: Poly, L: BreakLine, x0: number, x1: number, z0: number, z1: number, eps: number): Poly[] {
    const ax = L.ax, az = L.az, dx = L.bx - ax, dz = L.bz - az;
    const n = poly.length;
    const sd = new Float64Array(n);
    let pos = false, neg = false;
    for (let i = 0; i < n; i++) {
      sd[i] = (poly[i][0] - ax) * dz - (poly[i][1] - az) * dx;
      if (sd[i] > eps) pos = true; else if (sd[i] < -eps) neg = true;
    }
    if (!pos || !neg) return [poly];
    const left: Poly = [], right: Poly = [];
    const onX = (x: number): boolean => Math.abs(x - x0) < 1e-7 || Math.abs(x - x1) < 1e-7;
    const onZ = (z: number): boolean => Math.abs(z - z0) < 1e-7 || Math.abs(z - z1) < 1e-7;
    for (let i = 0; i < n; i++) {
      const p = poly[i], q = poly[(i + 1) % n], sp = sd[i], sq = sd[(i + 1) % n];
      if (sp >= -eps) left.push(p);
      if (sp <= eps) right.push(p);
      if ((sp > eps && sq < -eps) || (sp < -eps && sq > eps)) {
        const f = sp / (sp - sq);
        let ix = p[0] + (q[0] - p[0]) * f, iz = p[1] + (q[1] - p[1]) * f;
        if (onX(p[0]) && onX(q[0]) && Math.abs(p[0] - q[0]) < 1e-7 && Math.abs(dx) > 1e-9) {
          ix = p[0]; iz = az + (ix - ax) * (dz / dx);
        } else if (onZ(p[1]) && onZ(q[1]) && Math.abs(p[1] - q[1]) < 1e-7 && Math.abs(dz) > 1e-9) {
          iz = p[1]; ix = ax + (iz - az) * (dx / dz);
        }
        left.push([ix, iz]); right.push([ix, iz]);
      }
    }
    const out: Poly[] = [];
    if (left.length >= 3) out.push(left);
    if (right.length >= 3) out.push(right);
    return out;
  }
  /** Does a segment touch an axis-aligned box? (Liang–Barsky.) */
  /** Does a segment touch an axis-aligned box? (Liang–Barsky.) */
  function segTouchesBox(L: BreakLine, x0: number, x1: number, z0: number, z1: number): boolean {
    const dx = L.bx - L.ax, dz = L.bz - L.az;
    let t0 = 0, t1 = 1;
    const clip = (p: number, q: number): boolean => {
      if (Math.abs(p) < 1e-12) return q >= 0;
      const r = q / p;
      if (p < 0) { if (r > t1) return false; if (r > t0) t0 = r; }
      else { if (r < t0) return false; if (r < t1) t1 = r; }
      return true;
    };
    return clip(-dx, L.ax - x0) && clip(dx, x1 - L.ax) && clip(-dz, L.az - z0) && clip(dz, z1 - L.az);
  }
  /** The deck FLOOR of a strip at the point of it nearest (x,z): profile minus
   *  the cross-fall (the tilted kerb is the lowest thing ground must respect),
   *  and the plan distance to the strip's edge. */
  function stripFloor(s: StripLike, x: number, z: number): { y: number; out: number } {
    const dx = s.bx - s.ax, dz = s.bz - s.az;
    const t = clamp(((x - s.ax) * dx + (z - s.az) * dz) / (dx * dx + dz * dz || 1), 0, 1);
    const px = s.ax + dx * t, pz = s.az + dz * t;
    // THE CUT FOLLOWS THE CAMBER. This used to take `ya − |cross-fall|` — the
    // LOWER kerb — for the whole width, which is safe and leaves a step exactly
    // twice the cross-fall along the high side of every cambered road. Measured
    // in flat Rio it was the largest term left in the kerb lip by some way, worth
    // a median 0.68m against the 0.08m vertical budget. Reading the same tilted
    // plane the deck was built on removes it and cannot expose anything: where
    // the deck is higher, the ground under it is allowed to be higher too.
    const l = Math.hypot(dx, dz) || 1;
    const side = clamp(((x - px) * (-dz / l) + (z - pz) * (dx / l)) / (s.hw || 1), -1, 1);
    const cross = ((s.ca ?? 0) + ((s.cb ?? 0) - (s.ca ?? 0)) * t) * side;
    const fA = (s.ya as number) + (s.pc ?? 0), fB = (s.yb as number) + (s.pc ?? 0);
    return {
      y: fA + (fB - fA) * t + cross,
      out: Math.hypot(x - px, z - pz) - (s.hw + 0.6),
    };
  }
  // TWO CONSUMERS, TWO RULES — because they need different things from the
  // same raster, and the first version of this used one rule and measured the
  // consequence. The MESH needs the hard rule: every vertex within one cell of
  // a crossed cell clamps flat to that cell's deck floor, which is what makes
  // "no chord over a deck" provable, and measured ZERO breaches at four sites
  // where the old bench had six. The WHEELS need a continuous rule: the hard
  // one steps by the whole cut depth at every cell boundary, and the suspension
  // read that as a 32m teleport beside a Bormio hairpin stack. So the field
  // version grades away from the marked cells at a cut-face slope instead —
  // same raster, same values, continuous everywhere, and equal to the hard rule
  // inside the cells where the guarantee actually binds.
  /** Gather the distinct strips indexed in the (2R+1)² cells around a point. */
  function stripsNear(S: TerrainStore, x: number, z: number, R: number, into: Set<StripLike>): void {
    const cx = Math.floor(x / S.cutL), cz = Math.floor(z / S.cutL);
    for (let ax = cx - R; ax <= cx + R; ax++) {
      for (let az = cz - R; az <= cz + R; az++) {
        const arr = S.strips.get(`${ax},${az}`);
        if (arr) for (const sg of arr) into.add(sg);
      }
    }
  }
  function roadFloorHard(S: TerrainStore, x: number, z: number, wash = S.cutWash): number | null {
    cutSet.clear();
    stripsNear(S, x, z, 2, cutSet);
    let best: number | null = null;
    for (const sg of cutSet) {
      const f = stripFloor(sg, x, z);
      // A WASH, not a plane. Dead flat out to the limit of reach planes a ~21m
      // shelf either side of every road — the mesh cell is that wide, so a kerb
      // sample drags corners that far out — and the road then reads as a plinth
      // with the country stepping up away from it. A gentle rise lets the ground
      // beyond the shoulder keep its own height while the corners that actually
      // hold the carriageway still come all the way down.
      const y = f.y + Math.max(0, f.out) * wash;
      if (best === null || y < best) best = y;
    }
    return best === null ? null : best - CUT_CLEAR;
  }
  /** The FIELD's ceiling: the same strips, graded off the kerb at the face
   *  slope so nothing the tyres ride is discontinuous. */
  /** How far out along (ox,oz) from a crest point (cx,cz) whose floor is y the
   *  wedge meets the ground: 0 at the crest already, CUT_REACH_M for a wall,
   *  -1 where the road stands clear of the ground (a structure: no bank). */
  function toeOut(S: TerrainStore, cx: number, cz: number, ox: number, oz: number, y: number): number {
    const N0 = S.sampleHeight(cx, cz);
    if (y - N0 > DECK_GAP_T) return -1;
    if (Math.abs(N0 - y) < 0.25) return 0;
    const cut = N0 > y;
    let pd = 0, pg = Math.abs(N0 - y);
    for (let d = 0.5; d <= TOE_REACH + 1e-6; d += 0.5) {
      const N = S.sampleHeight(cx + ox * d, cz + oz * d);
      const w = cut ? y + d * CUTF_K : y - d * BANK_K;
      const g = cut ? N - w : w - N;                 // positive while still off the ground
      if (g <= 0) return pd + (d - pd) * (pg / (pg - g || 1));
      if (cut && d >= CUT_REACH_M) return CUT_REACH_M;
      pd = d; pg = g;
    }
    return cut ? CUT_REACH_M : -1;
  }
  /** The break lines a strip adds to the terrain: its crest (the shoulder's
   *  outer edge) and its toe, on both sides. */
  function stripBreakLines(S: TerrainStore, s: StripLike): BreakLine[] {
    if (s.bl) return s.bl;
    const out: BreakLine[] = [];
    s.bl = out;
    s.reach = s.hw + 0.6;
    if (s.tk || s.tn || s.ya === undefined || s.yb === undefined) return out;
    const dx = s.bx - s.ax, dz = s.bz - s.az, l = Math.hypot(dx, dz);
    if (l < 0.5) return out;
    const nx = -dz / l, nz = dx / l;
    const r = s.hw + 0.6;
    // Not until the ground is there: a toe marched over a missing DEM tile is
    // marched over zero, and it would be cached for the strip's whole life.
    for (const side of [-1, 1]) {
      if (!S.hasHeight(s.ax + nx * side * r, s.az + nz * side * r) || !S.hasHeight(s.bx + nx * side * r, s.bz + nz * side * r)) { s.bl = undefined; return out; }
    }
    // AT GRADE, NO LINES. Where the shoulder's edge meets the ground within a
    // decimetre at both ends on both sides there is no face and no bank, and
    // the grid corners the profile sets to the floor already hold the
    // carriageway within that decimetre. A town's flat streets cost nothing.
    let flat = true;
    const crest: Array<[number, number, number, number, number, number]> = [];
    for (const side of [-1, 1]) {
      const ox = nx * side, oz = nz * side;
      const cax = s.ax + ox * r, caz = s.az + oz * r, cbx = s.bx + ox * r, cbz = s.bz + oz * r;
      const ya = stripFloor(s, cax, caz).y - CUT_CLEAR, yb = stripFloor(s, cbx, cbz).y - CUT_CLEAR;
      if (Math.abs(ya - S.sampleHeight(cax, caz)) > 0.12 || Math.abs(yb - S.sampleHeight(cbx, cbz)) > 0.12) flat = false;
      crest.push([cax, caz, cbx, cbz, ya, yb]);
    }
    if (flat) return out;
    let far = 0;
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? -1 : 1, ox = nx * side, oz = nz * side;
      const [cax, caz, cbx, cbz, ya, yb] = crest[i];
      out.push({ ax: cax, az: caz, bx: cbx, bz: cbz });
      const ta = toeOut(S, cax, caz, ox, oz, ya), tb = toeOut(S, cbx, cbz, ox, oz, yb);
      if (ta < 0 || tb < 0) continue;
      far = Math.max(far, ta, tb);
      if (ta > 0.3 || tb > 0.3) out.push({ ax: cax + ox * ta, az: caz + oz * ta, bx: cbx + ox * tb, bz: cbz + oz * tb });
    }
    s.reach = r + far + 0.5;
    return out;
  }
  /** The natural ground at a strip's crest, at the foot of (x,z) — the
   *  structure test's witness: a crest standing DECK_GAP_T over it is a deck
   *  in the air, and a deck gets no bank. */
  function crestGround(S: TerrainStore, s: StripLike, x: number, z: number): number {
    const dx = s.bx - s.ax, dz = s.bz - s.az, l2 = dx * dx + dz * dz || 1;
    const tt = clamp(((x - s.ax) * dx + (z - s.az) * dz) / l2, 0, 1);
    const px = s.ax + dx * tt, pz = s.az + dz * tt, l = Math.sqrt(l2);
    const sgn = ((x - px) * (-dz / l) + (z - pz) * (dx / l)) >= 0 ? 1 : -1;
    const r = s.hw + 0.6;
    return S.sampleHeight(px + (-dz / l) * sgn * r, pz + (dx / l) * sgn * r);
  }
  /**
   * The corridor profile at a point: the height the terrain takes there and
   * what it is — 0 ground, 1 floor, 2 cut face, 3 fill bank.
   *
   * EVERY STRIP IN REACH HAS A SAY, NOT THE NEAREST ALONE. The first cut read
   * the nearest strip's wedge and nobody else's, and between two roads that
   * is wrong twice over. In the angle of a junction the answer flipped from
   * one kerb's wedge to the other's along the bisector, so the corner carried
   * whichever bank or face happened to be nearer, with a seam where they met.
   * And between two terraced roads — Simon's Town's report spot, a road 2.9m
   * above its neighbour and 2.5m from it — the lower road's cut face was the
   * nearer wedge, so the mesh ran that face up the gap while the batter
   * strip, drawn per bay from the upper kerb, laid the upper road's bank down
   * the same gap: a bank standing 1.4m over the ground the wheels read,
   * measured with __batterLine. Earthworks are a union. Every fill bank that
   * stands over the ground is built and the highest of them IS the ground;
   * every cut face is dug and the lowest of them is; and a fill stands on a
   * cut, so where both apply the bank wins and stops at the lower road's
   * shoulder — the retaining wall two terraces actually have.
   */
  function corridorH(S: TerrainStore, x: number, z: number, N: number, cands?: Iterable<StripLike>): { h: number; k: number } {
    let list: Iterable<StripLike> | undefined = cands;
    if (!list) {
      cutSet.clear();
      stripsNear(S, x, z, Math.ceil(TOE_REACH / Math.max(1, S.cutL)) + 1, cutSet);
      list = cutSet;
    }
    let floor = Infinity;
    let near: StripLike | null = null, nearOut = Infinity, nearY = 0;
    // The highest fill bank standing over the ground here, and the lowest cut
    // face dug under it, over every strip whose wedge reaches this point.
    let up = -Infinity, down = Infinity;
    let wet: boolean | null = null;
    for (const s of list) {
      if (s.tk || s.tn || s.ya === undefined || s.yb === undefined) continue;
      const f = stripFloor(s, x, z);
      const y = f.y - CUT_CLEAR;
      if (f.out <= 0) floor = Math.min(floor, y);
      if (f.out < nearOut) { nearOut = f.out; near = s; nearY = y; }
      if (f.out <= 0 || f.out > TOE_REACH) continue;
      if (N > y) {
        // A cut face, while it can still meet the hill: past CUT_REACH an
        // unmet face has stepped up to the ground and says nothing.
        const face = y + f.out * CUTF_K;
        if (f.out < CUT_REACH_M && face < N) down = Math.min(down, face);
      } else {
        const bank = y - f.out * BANK_K;
        if (bank <= N) continue;
        // Water takes no bank, and neither does a deck standing in the air.
        if (wet === null) wet = S.coverWater(x, z);
        if (wet || y - crestGround(S, s, x, z) > DECK_GAP_T) continue;
        up = Math.max(up, bank);
      }
    }
    if (near === null) return { h: N, k: 0 };
    if (floor < Infinity) {
      // Under a carriageway or its shoulder: the floor. Dug to it where the
      // ground stands above, raised to it where the ground falls away so an
      // embankment is solid — unless the road stands clear, or this is water.
      if (N >= floor) return { h: floor, k: 1 };
      const structure = nearY - crestGround(S, near, x, z) > DECK_GAP_T;
      return structure || S.coverWater(x, z) ? { h: N, k: 0 } : { h: floor, k: 1 };
    }
    if (up > -Infinity) return { h: up, k: 3 };
    if (down < Infinity) return { h: down, k: 2 };
    return { h: N, k: 0 };
  }
  /** The triangles of each lattice cell of a terrain geometry: `offs[c]..offs[c+1]`
   *  index triples into `tris`. Two per cell on a plain grid, any number on a
   *  refined one. Built once per geometry. */

  /** Split a convex polygon by the infinite line through a break line. Points
   *  that land on a cell boundary are recomputed from the line and the boundary
   *  coordinate, so the neighbouring cell — split by the same line, from its own
   *  pieces — arrives at the same point bit for bit. */
  function cellTable(pos: Float32Array, idx: Uint32Array | Uint16Array, SEG: number): CellTris {
    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
    for (let i = 0; i < (pos.length / 3); i++) {
      const x = pos[(i) * 3], z = pos[(i) * 3 + 2];
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    }
    const cw = (maxX - minX) / SEG || 1, ch = (maxZ - minZ) / SEG || 1;
    const nT = idx.length / 3;
    const cellOf = new Int32Array(nT);
    const counts = new Int32Array(SEG * SEG);
    for (let f = 0; f < nT; f++) {
      const a = idx[f * 3], b = idx[f * 3 + 1], c = idx[f * 3 + 2];
      const mx = (pos[(a) * 3] + pos[(b) * 3] + pos[(c) * 3]) / 3 - minX;
      const mz = (pos[(a) * 3 + 2] + pos[(b) * 3 + 2] + pos[(c) * 3 + 2]) / 3 - minZ;
      const ix = clamp(Math.floor(mx / cw), 0, SEG - 1), iz = clamp(Math.floor(mz / ch), 0, SEG - 1);
      const k = iz * SEG + ix;
      cellOf[f] = k; counts[k]++;
    }
    const offs = new Int32Array(SEG * SEG + 1);
    for (let k = 0; k < SEG * SEG; k++) offs[k + 1] = offs[k] + counts[k];
    const fill = new Int32Array(SEG * SEG);
    const tris = new Int32Array(nT * 3);
    for (let f = 0; f < nT; f++) {
      const k = cellOf[f];
      const o = (offs[k] + fill[k]++) * 3;
      tris[o] = idx[f * 3]; tris[o + 1] = idx[f * 3 + 1]; tris[o + 2] = idx[f * 3 + 2];
    }
    const out = { seg: SEG, offs, tris };
    return out;
  }
  /** The lattice resolution a terrain geometry was built at. */
  /** A terrain tile with the road corridors built into its geometry, or null
   *  where no strip comes near it (a plain grid is the right answer there). */
  function refineTileGeometry(S: TerrainStore, t: HeightTile, SEG: number, corridor: boolean): RefinedMesh | null {
    const t0 = performance.now();
    const cw = t.w / SEG, ch = t.h / SEG;
    const near = new Set<StripLike>();
    const m = TOE_REACH + S.cutL;
    for (let cx = Math.floor((t.xs - m) / S.cutL); cx <= Math.floor((t.xs + t.w + m) / S.cutL); cx++) {
      for (let cz = Math.floor((t.zs - m) / S.cutL); cz <= Math.floor((t.zs + t.h + m) / S.cutL); cz++) {
        const arr = S.strips.get(`${cx},${cz}`);
        if (arr) for (const s of arr) if (corridor && !s.tk && !s.tn && s.ya !== undefined && s.yb !== undefined) near.add(s);
      }
    }
    // THE NEIGHBOURS' BORDERS. A refined tile next door has vertices on the
    // shared edge that this tile must share too, at its heights.
    // A BORDER HAS ONE OWNER. Two corridor tiles computing the same border
    // row from their own raster edges and their own line sets disagreed by up
    // to 0.91m with 41 points missing (Vélizy, north edge) — the crack that
    // drew as a dark line. The west and the north tile own a shared border; a
    // corridor tile follows only the owners of its west and north edges, a
    // plain tile follows every refined neighbour.
    // Every tile — plain or corridor — follows the owners of its west and
    // north edges. Reading the field "a hair inside" each tile made the two
    // sides of a plain border read two different rasters, a DEM pixel apart,
    // and on a Lesotho hillside that is a wall of metres along every seam
    // (measured live at Senqu from the drone). The owner reads its own raster;
    // the follower takes the owner's row.
    const seeds: Array<[number, number, number]> = [];
    let extraSeed = false;
    for (const [dx, dy] of [[-1, 0], [0, -1]]) {
      const nk = `${t.tx + dx}/${t.ty + dy}`;
      const nb = S.borders.get(nk);
      if (!nb) continue;
      for (let i = 0; i < nb.length; i += 3) {
        const x = nb[i], z = nb[i + 1];
        // ON ONE OF MY EDGES — within my box, not merely on the edge's line.
        // The line test took the north owner's whole east column as seeds:
        // phantom vertices a hundred metres outside the tile, pinned, stored
        // as this tile's border, and fanned into the corner cell's ring.
        if (!onTileEdge(t, x, z)) continue;
        seeds.push([x, z, nb[i + 2]]);
        const ix = Math.round((x - t.xs) / cw), iz = Math.round((z - t.zs) / ch);
        if (Math.abs(x - (t.xs + ix * cw)) > 1e-3 || Math.abs(z - (t.zs + iz * ch)) > 1e-3) extraSeed = true;
      }
    }
    // Lattice-only seeds are pins the plain path applies itself; only a
    // neighbour's extra edge points need the ring machinery.
    if (!near.size && !extraSeed) return null;
    // The break lines, and the cells each one crosses. A cell within reach of
    // any strip is `close`: its vertices take the corridor profile, the rest
    // take the ground and never pay for the lookup.
    const lines: BreakLine[] = [];
    const ordered = [...near].sort((a, b) => b.hw - a.hw);
    for (const s of ordered) for (const L of stripBreakLines(S, s)) lines.push(L);
    const cellLines = new Map<number, number[]>();
    const close = new Uint8Array(SEG * SEG);
    for (const s of near) {
      const mm = (s.reach ?? s.hw + 0.6 + TOE_REACH) + 1;
      const ix0 = Math.max(0, Math.floor((Math.min(s.ax, s.bx) - mm - t.xs) / cw)), ix1 = Math.min(SEG - 1, Math.floor((Math.max(s.ax, s.bx) + mm - t.xs) / cw));
      const iz0 = Math.max(0, Math.floor((Math.min(s.az, s.bz) - mm - t.zs) / ch)), iz1 = Math.min(SEG - 1, Math.floor((Math.max(s.az, s.bz) + mm - t.zs) / ch));
      for (let iz = iz0; iz <= iz1; iz++) for (let ix = ix0; ix <= ix1; ix++) close[iz * SEG + ix] = 1;
    }
    for (let li = 0; li < lines.length; li++) {
      const L = lines[li];
      const ix0 = Math.max(0, Math.floor((Math.min(L.ax, L.bx) - t.xs) / cw) - 1), ix1 = Math.min(SEG - 1, Math.floor((Math.max(L.ax, L.bx) - t.xs) / cw) + 1);
      const iz0 = Math.max(0, Math.floor((Math.min(L.az, L.bz) - t.zs) / ch) - 1), iz1 = Math.min(SEG - 1, Math.floor((Math.max(L.az, L.bz) - t.zs) / ch) + 1);
      if (ix1 < 0 || iz1 < 0 || ix0 > SEG - 1 || iz0 > SEG - 1) continue;
      for (let iz = iz0; iz <= iz1; iz++) for (let ix = ix0; ix <= ix1; ix++) {
        const x0 = t.xs + ix * cw, z0 = t.zs + iz * ch;
        if (!segTouchesBox(L, x0 - 1e-6, x0 + cw + 1e-6, z0 - 1e-6, z0 + ch + 1e-6)) continue;
        const k = iz * SEG + ix;
        const arr = cellLines.get(k);
        if (arr) { if (arr.length < 16) arr.push(li); } else cellLines.set(k, [li]);
      }
    }
    if (!cellLines.size && !extraSeed) return null;
    const t1 = performance.now();
    // The strips within reach of each cell, indexed once per tile, so the
    // height of a vertex asks a short list rather than the world's raster.
    const cellStrips = new Map<number, StripLike[]>();
    for (const s of near) {
      const mm = (s.reach ?? s.hw + 0.6 + TOE_REACH) + 1;
      const ix0 = Math.max(0, Math.floor((Math.min(s.ax, s.bx) - mm - t.xs) / cw)), ix1 = Math.min(SEG - 1, Math.floor((Math.max(s.ax, s.bx) + mm - t.xs) / cw));
      const iz0 = Math.max(0, Math.floor((Math.min(s.az, s.bz) - mm - t.zs) / ch)), iz1 = Math.min(SEG - 1, Math.floor((Math.max(s.az, s.bz) + mm - t.zs) / ch));
      for (let iz = iz0; iz <= iz1; iz++) for (let ix = ix0; ix <= ix1; ix++) {
        const k = iz * SEG + ix;
        const arr = cellStrips.get(k);
        if (arr) arr.push(s); else cellStrips.set(k, [s]);
      }
    }
    // The vertex pool: the grid corners first, in lattice order, then whatever
    // the splits add, deduplicated on a millimetre key so a point two cells
    // both produce is one vertex.
    const px: number[] = [], pz: number[] = [];
    const pool = new Map<string, number>();
    // …and within a millimetre, not only in the same cell: a seed comes back
    // from the owner's Float32 geometry up to 6e-5 off the point this tile's
    // own split lands on, and a pair a hair apart — one pinned, one solved —
    // is a vertical sliver with a height step, a crack along the seam.
    const vtx = (x: number, z: number): number => {
      const kx = Math.round(x * 1000), kz = Math.round(z * 1000);
      const k = `${kx},${kz}`;
      let i = pool.get(k);
      if (i !== undefined) return i;
      let bd = 1.5e-3 * 1.5e-3;
      for (let dx = -1; dx <= 1 && i === undefined; dx++) for (let dz = -1; dz <= 1; dz++) {
        if (!dx && !dz) continue;
        const j = pool.get(`${kx + dx},${kz + dz}`);
        if (j === undefined) continue;
        const d = (px[j] - x) * (px[j] - x) + (pz[j] - z) * (pz[j] - z);
        if (d < bd) { bd = d; i = j; }
      }
      if (i === undefined) { i = px.length; pool.set(k, i); px.push(x); pz.push(z); }
      return i;
    };
    for (let iz = 0; iz <= SEG; iz++) for (let ix = 0; ix <= SEG; ix++) vtx(t.xs + ix * cw, t.zs + iz * ch);
    const corner = (ix: number, iz: number): number => iz * (SEG + 1) + ix;
    const pinned = new Map<number, number>();                 // vertex → the neighbour's height
    // Extra points on cell edges, by edge, so a plain neighbour can pick them up.
    const edgePts = new Map<string, number[]>();
    const noteEdge = (ix: number, iz: number, x: number, z: number, x0: number, z0: number, v: number): void => {
      const onL = Math.abs(x - x0) < 1e-6, onR = Math.abs(x - (x0 + cw)) < 1e-6;
      const onT = Math.abs(z - z0) < 1e-6, onB = Math.abs(z - (z0 + ch)) < 1e-6;
      if ((onL || onR) && (onT || onB)) return;                 // a corner
      let key: string | null = null;
      if (onL) key = `v${ix}_${iz}`; else if (onR) key = `v${ix + 1}_${iz}`;
      else if (onT) key = `h${iz}_${ix}`; else if (onB) key = `h${iz + 1}_${ix}`;
      if (!key) return;
      const arr = edgePts.get(key);
      if (arr) { if (!arr.includes(v)) arr.push(v); } else edgePts.set(key, [v]);
    };
    // The owners' rows along each followed edge, sorted along the edge, so a
    // follower's OWN extra points on that edge (its lines' crossings the owner
    // does not have) can be pinned onto the owner's polyline rather than
    // solved apart from it — a point standing off the neighbour's straight
    // edge by even a decimetre is a hairline of sky.
    const ownerRows = new Map<string, Array<[number, number]>>();   // edge → [along, y]
    const edgeOf = (x: number, z: number): string | null =>
      Math.abs(x - t.xs) < 1e-3 ? 'W' : Math.abs(x - (t.xs + t.w)) < 1e-3 ? 'E' : Math.abs(z - t.zs) < 1e-3 ? 'N' : Math.abs(z - (t.zs + t.h)) < 1e-3 ? 'S' : null;
    for (const [x, z, y] of seeds) {
      const e = edgeOf(x, z);
      if (!e) continue;
      const arr = ownerRows.get(e) ?? ownerRows.set(e, []).get(e) as Array<[number, number]>;
      arr.push([e === 'W' || e === 'E' ? z : x, y]);
    }
    for (const arr of ownerRows.values()) arr.sort((a, b) => a[0] - b[0]);
    const ownerY = (x: number, z: number): number | undefined => {
      const e = edgeOf(x, z);
      if (!e) return undefined;
      const arr = ownerRows.get(e);
      if (!arr || arr.length < 2) return undefined;
      const a = e === 'W' || e === 'E' ? z : x;
      if (a < arr[0][0] - 1e-3 || a > arr[arr.length - 1][0] + 1e-3) return undefined;
      let lo = 0, hi = arr.length - 1;
      while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (arr[mid][0] <= a) lo = mid; else hi = mid; }
      const span = arr[hi][0] - arr[lo][0];
      return span < 1e-9 ? arr[lo][1] : arr[lo][1] + ((a - arr[lo][0]) / span) * (arr[hi][1] - arr[lo][1]);
    };
    for (const [x, z, y] of seeds) {
      // Snapped to the lattice along the border, exactly as the neighbour's
      // own splits were, so the key matches; a lattice corner is pinned too.
      const v = vtx(x, z);
      pinned.set(v, y);
      const ix = clamp(Math.round((x - t.xs) / cw), 0, SEG), iz = clamp(Math.round((z - t.zs) / ch), 0, SEG);
      const isCorner = Math.abs(x - (t.xs + ix * cw)) < 1e-3 && Math.abs(z - (t.zs + iz * ch)) < 1e-3;
      if (isCorner) continue;
      if (Math.abs(x - t.xs) < 1e-3) { const jz = clamp(Math.floor((z - t.zs) / ch), 0, SEG - 1); const k = `v0_${jz}`; (edgePts.get(k) ?? edgePts.set(k, []).get(k) as number[]).push(v); }
      else if (Math.abs(x - (t.xs + t.w)) < 1e-3) { const jz = clamp(Math.floor((z - t.zs) / ch), 0, SEG - 1); const k = `v${SEG}_${jz}`; (edgePts.get(k) ?? edgePts.set(k, []).get(k) as number[]).push(v); }
      else if (Math.abs(z - t.zs) < 1e-3) { const jx = clamp(Math.floor((x - t.xs) / cw), 0, SEG - 1); const k = `h0_${jx}`; (edgePts.get(k) ?? edgePts.set(k, []).get(k) as number[]).push(v); }
      else if (Math.abs(z - (t.zs + t.h)) < 1e-3) { const jx = clamp(Math.floor((x - t.xs) / cw), 0, SEG - 1); const k = `h${SEG}_${jx}`; (edgePts.get(k) ?? edgePts.set(k, []).get(k) as number[]).push(v); }
    }
    const TA: number[] = [], TB: number[] = [], TC: number[] = [], TK: number[] = [];
    const tri = (a: number, b: number, c: number, k: number): void => {
      // Wound so the normal points up: (b-a) x (c-a) has a positive y.
      const cy = (pz[b] - pz[a]) * (px[c] - px[a]) - (px[b] - px[a]) * (pz[c] - pz[a]);
      if (Math.abs(cy) < 1e-4) return;                            // a sliver
      if (cy > 0) { TA.push(a); TB.push(b); TC.push(c); } else { TA.push(a); TB.push(c); TC.push(b); }
      TK.push(k);
    };
    let refinedCells = 0;
    const done = new Uint8Array(SEG * SEG);
    const cellPolys = new Map<number, number[][]>();          // cell → polygons as vertex ids
    for (const [k, lis] of cellLines) {
      const ix = k % SEG, iz = (k - ix) / SEG;
      const x0 = t.xs + ix * cw, z0 = t.zs + iz * ch, x1 = x0 + cw, z1 = z0 + ch;
      let polys: Poly[] = [[[x0, z0], [x1, z0], [x1, z1], [x0, z1]]];
      const eps = 1e-6 * cw;
      for (const li of lis) {
        const L = lines[li];
        const next: Poly[] = [];
        for (const p of polys) for (const q of splitPoly(p, L, x0, x1, z0, z1, eps)) next.push(q);
        polys = next;
      }
      const idPolys: number[][] = [];
      for (const p of polys) {
        const ids = p.map(([x, z]) => vtx(x, z));
        for (let i = 0; i < p.length; i++) noteEdge(ix, iz, p[i][0], p[i][1], x0, z0, ids[i]);
        idPolys.push(ids);
      }
      cellPolys.set(k, idPolys);
      done[k] = 1;
      refinedCells++;
    }
    // T-JUNCTION REPAIR. A cell's line list is capped, and the cell next door
    // may have kept a line this one dropped — or lie in the next tile — so a
    // point can stand on the shared edge for one side only. Measured at
    // Vélizy as black dashes along the horizon. Every point any neighbour put
    // on one of this cell's edges is inserted into the side of the polygon it
    // lies on, and the fan then gives it a triangle.
    const onSide = (ax: number, az: number, bx: number, bz: number, x: number, z: number): boolean => {
      const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
      if (l2 < 1e-12) return false;
      const u = ((x - ax) * dx + (z - az) * dz) / l2;
      if (u <= 1e-6 || u >= 1 - 1e-6) return false;
      return Math.abs((x - ax) * dz - (z - az) * dx) / Math.sqrt(l2) < 2e-3;
    };
    for (const [k, idPolys] of cellPolys) {
      const ix = k % SEG, iz = (k - ix) / SEG;
      const have = new Set<number>();
      for (const ids of idPolys) for (const v of ids) have.add(v);
      for (const key of [`h${iz}_${ix}`, `h${iz + 1}_${ix}`, `v${ix}_${iz}`, `v${ix + 1}_${iz}`]) {
        const pts = edgePts.get(key);
        if (!pts) continue;
        for (const v of pts) {
          if (have.has(v)) continue;
          let placed = false;
          for (const ids of idPolys) {
            for (let i = 0; i < ids.length; i++) {
              const a = ids[i], b = ids[(i + 1) % ids.length];
              if (onSide(px[a], pz[a], px[b], pz[b], px[v], pz[v])) { ids.splice(i + 1, 0, v); placed = true; break; }
            }
            if (placed) break;
          }
          if (placed) have.add(v);
        }
      }
      for (const ids of idPolys) {
        // FROM THE CENTROID, not a vertex, where a side carries a collinear
        // point: a fan from any vertex drops the points on its own two sides
        // out of every triangle — a T-junction on the edge the neighbour has
        // them on. The centroid of a convex polygon is interior, so every side
        // is an edge of exactly one triangle and every point on it a vertex of
        // one. A polygon whose every vertex is a true corner fans from one of
        // them at half the triangles. Judged on the FINAL ring, after repair.
        if (ids.length === 3) { tri(ids[0], ids[1], ids[2], k); continue; }
        let flat = false;
        for (let i = 0; i < ids.length && !flat; i++) {
          const a = ids[(i + ids.length - 1) % ids.length], b = ids[i], c = ids[(i + 1) % ids.length];
          if (Math.abs((px[b] - px[a]) * (pz[c] - pz[a]) - (pz[b] - pz[a]) * (px[c] - px[a])) < 1e-3) flat = true;
        }
        if (!flat) { for (let i = 1; i + 1 < ids.length; i++) tri(ids[0], ids[i], ids[i + 1], k); continue; }
        let mx = 0, mz = 0;
        for (const v of ids) { mx += px[v]; mz += pz[v]; }
        const cc = vtx(mx / ids.length, mz / ids.length);
        for (let i = 0; i < ids.length; i++) tri(cc, ids[i], ids[(i + 1) % ids.length], k);
      }
    }
    // The plain cells: two triangles, or a fan round a ring that takes in
    // whatever points its neighbours put on the shared edges.
    const along = (key: string): number[] => {
      const arr = edgePts.get(key);
      if (!arr) return [];
      const horiz = key[0] === 'h';
      return arr.slice().sort((a, b) => (horiz ? px[a] - px[b] : pz[a] - pz[b]));
    };
    for (let iz = 0; iz < SEG; iz++) for (let ix = 0; ix < SEG; ix++) {
      const k = iz * SEG + ix;
      if (done[k]) continue;
      const c00 = corner(ix, iz), c10 = corner(ix + 1, iz), c11 = corner(ix + 1, iz + 1), c01 = corner(ix, iz + 1);
      const top = along(`h${iz}_${ix}`), right = along(`v${ix + 1}_${iz}`), bottom = along(`h${iz + 1}_${ix}`), left = along(`v${ix}_${iz}`);
      if (!top.length && !right.length && !bottom.length && !left.length) {
        tri(c00, c10, c11, k); tri(c00, c11, c01, k);
        continue;
      }
      const ring = [c00, ...top, c10, ...right, c11, ...bottom.reverse(), c01, ...left.reverse()];
      // From the cell's centre, for the same reason the polygons fan from theirs.
      const cc = vtx(t.xs + (ix + 0.5) * cw, t.zs + (iz + 0.5) * ch);
      for (let i = 0; i < ring.length; i++) tri(cc, ring[i], ring[(i + 1) % ring.length], k);
    }
    const t2 = performance.now();
    // Heights and kinds: the corridor profile where a strip is close, the
    // ground elsewhere. The sea floor rule is the same one the plain build uses.
    const n = px.length;
    const pos = new Float32Array(n * 3), uv = new Float32Array(n * 2);
    const kinds = new Uint8Array(n);
    const cxm = t.xs + t.w / 2, czm = t.zs + t.h / 2;
    const seaLocal = S.seaAbs() - S.baseElev;
    const candsAt = (x: number, z: number): StripLike[] | null => {
      const ix = clamp(Math.floor((x - t.xs) / cw), 0, SEG - 1), iz = clamp(Math.floor((z - t.zs) / ch), 0, SEG - 1);
      if (!close[iz * SEG + ix]) return null;
      return cellStrips.get(iz * SEG + ix) ?? null;
    };
    // THE FIELD, READ INSIDE THIS TILE'S OWN BOX. A vertex exactly on the
    // border is outside the tile's half-open box, so `sampleHeight` looks to the
    // neighbour — and answers ZERO while the neighbour's DEM has not loaded.
    // Stored as this tile's border, pinned into the neighbour when it built,
    // and taken back as a seed when this tile rebuilt, that zero lived for
    // ever: measured at Vélizy as border vertices 18m and 89m off the field
    // with the row inside within 3m, and drawn as the dark line along every
    // tile edge. Clamped a hair inside, the read is this tile's raster, which
    // is loaded by construction.
    // …BUT AT THE EXACT EDGE WHERE THE FIELD HAS A TILE. Clamping inside
    // unconditionally made the two sides of a plain border read two rasters a
    // DEM pixel apart — a wall of metres along every seam on a hillside (Senqu,
    // from the drone). The half-open tile box hands a border point to ONE
    // raster for both sides; only where that raster is missing does the read
    // fall back inside this tile, and the owner's row then pins the follower.
    const fieldAt = (x: number, z: number): number => S.hasHeight(x, z) ? S.sampleHeight(x, z)
      : S.sampleHeight(clamp(x, t.xs + 1e-4, t.xs + t.w - 1e-4), clamp(z, t.zs + 1e-4, t.zs + t.h - 1e-4));
    for (let i = 0; i < n; i++) {
      const x = px[i], z = pz[i];
      let N = fieldAt(x, z);
      if (S.sampleCover(x, z) === S.cover.water && N <= seaLocal + 2) N = Math.min(N, seaLocal - SEA_BED);
      let h = N, k = 0;
      const pin = pinned.get(i) ?? ownerY(x, z);
      if (pin !== undefined) h = pin;
      else {
        const cands = candsAt(x, z);
        if (cands) { const c = corridorH(S, x, z, N, cands); h = c.h; k = c.k; }
      }
      pos[i * 3] = x - cxm; pos[i * 3 + 1] = h; pos[i * 3 + 2] = z - czm;
      uv[i * 2] = 0.5 + (x - cxm) / t.w; uv[i * 2 + 1] = 0.5 - (z - czm) / t.h;
      kinds[i] = k;
    }
    const t3 = performance.now();
    const idx = new Uint32Array(TA.length * 3);
    for (let f = 0; f < TA.length; f++) { idx[f * 3] = TA[f]; idx[f * 3 + 1] = TB[f]; idx[f * 3 + 2] = TC[f]; }
    // The cell table, straight from the emitter — no need to rediscover it.
    const counts = new Int32Array(SEG * SEG);
    for (let f = 0; f < TK.length; f++) counts[TK[f]]++;
    const offs = new Int32Array(SEG * SEG + 1);
    for (let k = 0; k < SEG * SEG; k++) offs[k + 1] = offs[k] + counts[k];
    const fill = new Int32Array(SEG * SEG), tris = new Int32Array(TK.length * 3);
    for (let f = 0; f < TK.length; f++) {
      const o = (offs[TK[f]] + fill[TK[f]]++) * 3;
      tris[o] = TA[f]; tris[o + 1] = TB[f]; tris[o + 2] = TC[f];
    }
    const t4 = performance.now();
    refineCost.tiles++; refineCost.cells += refinedCells; refineCost.tris += TA.length; refineCost.verts += n;
    refineCost.plainTris += SEG * SEG * 2; refineCost.ms += t4 - t0;
    refineCost.msLines += t1 - t0; refineCost.msSplit += t2 - t1; refineCost.msHeights += t3 - t2; refineCost.msGeo += t4 - t3;
    return { pos, uv, idx, kinds, cells: refinedCells, tris: TA.length, cellTris: { seg: SEG, offs, tris } };
  }
  /** A tile's normal map along its four edges against the row just inside:
   *  the mean angle between them, degrees. A seam in the lighting is a number
   *  here before it is a line on the chart. Also the vertex colour on the
   *  border against one lattice row in. */
  function carveCorridors(S: TerrainStore, t: HeightTile, pos: Float32Array, ct: CellTris, SEG: number): void {
    const t0 = performance.now();
    const cell = t.w / SEG;
    // Strips overlapping the tile. S.cutL IS the mesh cell, so the raster's own
    // index is the right thing to walk — no geometry test needed to gather.
    const near = new Set<StripLike>();
    const cx0 = Math.floor(t.xs / S.cutL) - 1, cx1 = Math.floor((t.xs + t.w) / S.cutL) + 1;
    const cz0 = Math.floor(t.zs / S.cutL) - 1, cz1 = Math.floor((t.zs + t.h) / S.cutL) + 1;
    for (let cx = cx0; cx <= cx1; cx++) {
      for (let cz = cz0; cz <= cz1; cz++) {
        const arr = S.strips.get(`${cx},${cz}`);
        if (arr) for (const s of arr) near.add(s);
      }
    }
    if (!near.size) return;
    // HOW DEEP THIS VERTEX IS ALLOWED TO BE DUG.
    //
    // The carve satisfies a constraint at a point INSIDE a triangle by lowering
    // all three corners, and a mesh cell is ~21m while a road is 7m wide — so
    // corners far out in the field were being dragged down to hold a kerb sample.
    // Measured beside the road in flat Rio: the deck sat 0.04m over natural
    // ground (i.e. flush, its lift and no more) while the MESH sat 0.63m under
    // it. All of the kerb step was excavation, none of it was the road.
    //
    // A vertex may be taken down to the DECK FLOOR of the road it is serving —
    // `roadFloorHard`, the corridor rule without the batter's climb — and never
    // below the ground the world put there. Not `roadCeiling`: that lets the
    // ground rise away from the kerb, which is right for a field and disastrous
    // as a digging limit, because the chord from a vertex standing proud bridges
    // the carriageway. Computed lazily: only the handful of vertices a deck
    // sample actually touches ever need it.
    const lim = new Float32Array((pos.length / 3));
    const limDone = new Uint8Array((pos.length / 3));
    const cxm = t.xs + t.w / 2, czm = t.zs + t.h / 2;
    const limBase = (v: number): number => {
      if (!limDone[v]) {
        limDone[v] = 1;
        const c = roadFloorHard(S, pos[(v) * 3] + cxm, pos[(v) * 3 + 2] + czm);
        lim[v] = c === null ? -Infinity : Math.min(pos[(v) * 3 + 1], c);
      }
      return lim[v];
    };
    // ── THE WASH YIELDS TO THE ROAD ────────────────────────────────────
    //
    // S.cutWash lets the floor climb away from the kerb so a road is not a flat
    // 21m shelf, and it was tuned at Noordhoek with the cost written down and
    // accepted: "terrain through the tarmac 13.5%, p95 0.09m — pokes that are
    // centimetres, which do not read at all". That reasoning is sound on gentle
    // ground and fails completely on steep, and the failure is arithmetic rather
    // than bad luck. The wash's cap on a corner is its LEVER ARM times 0.1, the
    // lever arm is set by the mesh cell (~21m, fixed) and not by the terrain, and
    // the drop a corner needs is set by the RELIEF. Flat country needs almost no
    // drop so the cap never binds; a road cut into a hillside needs a metre and
    // the cap forbids 0.9 of it. Measured on the Wadi Rum road the report came
    // from: 19 of 36 samples with ground through the tarmac by 8–24cm, and all
    // three corners of every offending triangle sitting exactly on their limit.
    // The carve was not undershooting. It was caged.
    //
    // So the wash stops being a floor and becomes a PREFERENCE. The normal
    // passes respect it; if they finish with the deck still buried, a relief
    // pass re-runs with the wash removed — the bare deck floor, which is what
    // this limit was before the wash existed. Only vertices that would otherwise
    // bury a road move, so ground that never needed the excavation never gets
    // it, and Noordhoek's verge is untouched.
    const lim2 = new Float32Array((pos.length / 3));
    const lim2Done = new Uint8Array((pos.length / 3));
    let relief = false;
    const limOf = (v: number): number => {
      const base = limBase(v);
      if (!relief) return base;
      if (!lim2Done[v]) {
        lim2Done[v] = 1;
        const c = roadFloorHard(S, pos[(v) * 3] + cxm, pos[(v) * 3 + 2] + czm, 0);
        // NEVER ABOVE THE BASE LIMIT. limOf is used through Math.max, so a limit
        // that came out higher than the vertex would RAISE ground — and `base`
        // already carries the "no deeper than natural" rule that keeps a sea bed
        // a sea bed.
        lim2[v] = c === null ? base : Math.min(base, c);
      }
      return lim2[v];
    };
    let recPass = 0, recOff = 0;
    /** Did the last pass leave a deck buried? The relief pass is only worth its
     *  cost where it has something to do, which on gentle ground is nowhere. */
    let buried = false;
    const log: CarveLog | null = S.cprobe ? { s: [], v: [] } : null;
    if (log) S.carveLog.set(`${t.tx}/${t.ty}`, log);
    const enforce = (px: number, pz: number, tgt: number): void => {
      const fx = (px - t.xs) / cell, fz = (pz - t.zs) / cell;
      if (fx < 0 || fz < 0 || fx >= SEG || fz >= SEG) return;
      const kc = Math.floor(fz) * SEG + Math.floor(fx);
      for (let h = ct.offs[kc]; h < ct.offs[kc + 1]; h++) {
        const a = ct.tris[h * 3], b = ct.tris[h * 3 + 1], c = ct.tris[h * 3 + 2];
        // Barycentric in the XZ plane. Local coords, so shift the sample too.
        const ax = pos[(a) * 3] + t.xs + t.w / 2, az = pos[(a) * 3 + 2] + t.zs + t.h / 2;
        const bx = pos[(b) * 3] + t.xs + t.w / 2, bz = pos[(b) * 3 + 2] + t.zs + t.h / 2;
        const cx = pos[(c) * 3] + t.xs + t.w / 2, cz = pos[(c) * 3 + 2] + t.zs + t.h / 2;
        const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
        if (Math.abs(d) < 1e-9) continue;
        const w1 = ((bz - cz) * (px - cx) + (cx - bx) * (pz - cz)) / d;
        const w2 = ((cz - az) * (px - cx) + (ax - cx) * (pz - cz)) / d;
        const w3 = 1 - w1 - w2;
        if (w1 < -1e-6 || w2 < -1e-6 || w3 < -1e-6) continue;   // not this half
        const cur = w1 * pos[(a) * 3 + 1] + w2 * pos[(b) * 3 + 1] + w3 * pos[(c) * 3 + 1];
        // Recorded on the first pass only, and BEFORE the early-out, so the
        // samples that needed nothing are counted too — the denominator is the
        // whole point.
        if (log && recPass === 0) log.s.push([px, pz, tgt, cur, S.sampleHeight(px, pz), recOff]);
        const over = cur - tgt;
        if (over <= (relief ? RELIEF_MIN : 0)) return;
        // WHICH CORNER PAYS. Any set of drops with Σ wᵢ·dropᵢ = over satisfies the
        // constraint exactly; the family dropᵢ = over·wᵢᵏ / Σwᵢᵏ⁺¹ does so for
        // every k, and k picks how the bill is split. k=1 is least squares — the
        // smallest total movement — and it is what spread the excavation into the
        // field: a mesh cell is ~16m and a road 7m, so a corner ten metres out in
        // the grass carries a real share of every kerb sample and takes a real
        // share of every correction. Measured at Noordhoek under k=1: vertices
        // 5–12m past the kerb dropped a median 0.19m and 12–25m out up to 1.3m,
        // and the ground half a metre outside the tarmac ended 0.45m below the
        // height the world gives it — which is not a road on a plinth, it is a
        // trench around a road that never moved.
        //
        // k=2 bills by wᵢ² instead. A corner under the carriageway pays more, a
        // corner out in the field pays almost nothing, and the constraint is
        // satisfied just as exactly. Digging deeper next to the road is free: the
        // tarmac and its apron cover it, and `limOf` still refuses to take any
        // vertex below the deck floor it is serving, so concentrating the drop
        // cannot dig a pit — it just stops the hole reaching the grass.
        const norm = w1 * w1 * w1 + w2 * w2 * w2 + w3 * w3 * w3;
        if (norm < 1e-9) return;
        if (relief) {
          // GREEDY, NEAREST CORNER FIRST — not the w² share.
          //
          // Relief lifts the wash cap, and spreading the bill by w² then let
          // every corner of the triangle take some of it uncapped: measured at
          // Noordhoek, the ground beside the road went from 0.05m under natural
          // to 0.25m (p95 0.47m to 1.19m), which is the excavated bench the wash
          // was introduced to kill. The share rule is right for the normal pass,
          // where the cap bounds the damage; with the cap gone it is the damage.
          //
          // So relief bills the corner with the LARGEST weight — the one under
          // the carriageway, where tarmac and apron cover the hole — until it is
          // exhausted, and only then spills outward. Σwᵢ·dropᵢ = over still holds
          // exactly whenever the capacity is there; what changes is that a corner
          // out in the grass is paid last instead of first.
          let rem = over;
          const ord: Array<[number, number]> = [[a, w1], [b, w2], [c, w3]];
          ord.sort((p, q) => q[1] - p[1]);
          for (const [v, w] of ord) {
            if (rem <= 1e-6 || w <= 1e-6) break;
            const can = Math.min(rem / w, pos[(v) * 3 + 1] - limOf(v));
            if (can > 0) { pos[(v) * 3 + 1] = pos[(v) * 3 + 1] - can; rem -= can * w; }
          }
          return;
        }
        pos[(a) * 3 + 1] = Math.max(limOf(a), pos[(a) * 3 + 1] - (over * w1 * w1) / norm);
        pos[(b) * 3 + 1] = Math.max(limOf(b), pos[(b) * 3 + 1] - (over * w2 * w2) / norm);
        pos[(c) * 3 + 1] = Math.max(limOf(c), pos[(c) * 3 + 1] - (over * w3 * w3) / norm);
        // DID IT ACTUALLY LAND? The drops are clamped by limOf, so a caged corner
        // silently pays less than its share and the deck stays buried. Asking the
        // residual is exact and costs three lookups — the alternative, treating
        // "some sample was over at the start of the last pass" as the signal,
        // fires on every road that merely needed two passes.
        if (recPass === 2
          && w1 * pos[(a) * 3 + 1] + w2 * pos[(b) * 3 + 1] + w3 * pos[(c) * 3 + 1] - tgt > RELIEF_MIN) buried = true;
        return;
      }
    };
    // Three passes now, not two: a vertex shared by several deck samples wants
    // the deepest of them, and with the floor above a corner that hits its limit
    // cannot take its share of a correction — so the remainder has to find its
    // way onto the corners that still can, which takes another sweep.
    const y0 = S.cprobe ? Float32Array.from({ length: (pos.length / 3) }, (_, i) => pos[(i) * 3 + 1]) : null;
    // Three normal passes, then — only where they were not enough — two more
    // with the wash lifted. Five in the worst case and three in the common one.
    for (let pass = 0; pass < 5; pass++) {
      if (pass === 3) {
        if (!buried || !S.cutRelief) break;
        relief = true;
      }
      recPass = pass;
      for (const s of near) {
        const len = Math.hypot(s.bx - s.ax, s.bz - s.az);
        const steps = Math.max(1, Math.ceil(len / (cell * 0.3)));
        const ux = (s.bx - s.ax) / (len || 1), uz = (s.bz - s.az) / (len || 1);
        for (let i = 0; i <= steps; i++) {
          const u = i / steps;
          const px = s.ax + (s.bx - s.ax) * u, pz = s.az + (s.bz - s.az) * u;
          const f = stripFloor(s, px, pz);
          const tgt = f.y - CUT_CLEAR;
          // Centreline and both kerbs, plus a touch beyond, so the shoulder the
          // apron sits on is held down too.
          const offs = [0, -s.hw, s.hw, -(s.hw + 0.6), s.hw + 0.6];
          for (let o = 0; o < offs.length; o++) {
            recOff = o;
            enforce(px - uz * offs[o], pz + ux * offs[o], tgt);
          }
        }
      }
    }
    if (y0 && log) {
      for (let i = 0; i < (pos.length / 3); i++) {
        if (y0[i] - pos[(i) * 3 + 1] > 1e-4) {
          log.v.push([pos[(i) * 3] + cxm, pos[(i) * 3 + 2] + czm, y0[i], pos[(i) * 3 + 1]]);
        }
      }
    }
    carveCost.tiles++;
    carveCost.ms += performance.now() - t0;
    if (relief) carveCost.relieved++;
  }
  /**
   * THE RENDERED SURFACE, read analytically from the triangles it was built from.
   *
   * The same barycentric lookup `carveCorridors` uses to enforce its constraint,
   * run in reverse: locate the tile, the lattice cell, the half of that cell, and
   * interpolate. `meshHeightAt` answers the same question with a raycast against
   * every terrain mesh in the world, which is fine for a probe and hopeless on a
   * path the sward walks thousands of times a pass.
   */
  /** The three corners of the terrain triangle under a point, in world coords —
   *  the same lattice walk meshSurfaceAt does, stopping one step earlier. Probe
   *  only: a proud vertex is a claim about a TRIANGLE, and answering it with an
   *  interpolated height cannot say which corner is at fault or why. */
  /** Every channel indexed near a point, from the 3×3 cells around it. */
  function channelsNear(S: TerrainStore, x: number, z: number, into: Set<StripLike>): void {
    const cx = Math.floor(x / S.grid), cz = Math.floor(z / S.grid);
    for (let ax = cx - 1; ax <= cx + 1; ax++) {
      for (let az = cz - 1; az <= cz + 1; az++) {
        const arr = S.channels.get(`${ax},${az}`);
        if (arr) for (const c of arr) into.add(c);
      }
    }
  }
  const chanSet = new Set<StripLike>();
  /**
   * THE BED, as a ceiling on the terrain — but never under a carriageway.
   *
   * A watercourse cuts its own channel, or it is a blue stripe lying on top of
   * the countryside. The exception is the whole point of a culvert: where a road
   * passes over, the ground must stay up to hold the road, and the water goes
   * through the bore instead. So this returns null on tarmac, which leaves an
   * open channel on each side and a plug of earth between them for the road to
   * sit on and the bore to pass through.
   */
  /**
   * THE BED, as a ceiling on the terrain — but never under a carriageway.
   *
   * A watercourse cuts its own channel, or it is a blue stripe lying on top of
   * the countryside. The exception is the whole point of a culvert: where a road
   * passes over, the ground must stay up to hold the road, and the water goes
   * through the bore instead. So this returns null on tarmac, which leaves an
   * open channel on each side and a plug of earth between them for the road to
   * sit on and the bore to pass through.
   */
  function channelFloorAt(S: TerrainStore, x: number, z: number, ceiling: number): number | null {
    chanSet.clear();
    channelsNear(S, x, z, chanSet);
    let best: number | null = null;
    for (const c of chanSet) {
      const dx = c.bx - c.ax, dz = c.bz - c.az;
      const t = clamp(((x - c.ax) * dx + (z - c.az) * dz) / (dx * dx + dz * dz || 1), 0, 1);
      const px = c.ax + dx * t, pz = c.az + dz * t;
      const out = Math.hypot(x - px, z - pz) - c.hw;
      if (out > 3) continue;
      // Banks, not a trench: the bed at the middle, rising away at 1:1.
      const y = (c.ya as number) + ((c.yb as number) - (c.ya as number)) * t + Math.max(0, out);
      if (best === null || y < best) best = y;
    }
    // ORDER MATTERS FOR COST, not just for correctness. `onCarriageway` is a road
    // grid walk, and asking it of every vertex a river passes near — before
    // knowing whether the bed is even below the ground there — put twelve tiles
    // behind on the rebuild queue at Chapman's, where before there were none.
    // The vertex is only interesting if the bed would actually lower it, and that
    // is a handful of arithmetic; the walk is asked of those alone.
    if (best === null || best >= ceiling) return null;
    if (S.onRoad(x, z)) return null;   // the road's plug of earth
    return best;
  }
  /**
   * WHAT THE WATER HERE IS DOING — depth and current, for the physics.
   *
   * The truck used to know one fact about water: that it was in some. A ford, a
   * lake margin, mid-river and open sea were the same three numbers, and the
   * flow field the shader had been reading all along pushed nothing. This is the
   * physics' one window onto all of it:
   *
   *   RIVERS — the nearest channel segment answers. Direction is toward the
   *   lower invert (the same monotone solve the ribbon was built from), speed by
   *   the same sqrt-of-slope law the shader shades with, so what shoves the
   *   truck is exactly what the eye says should. Depth from the channel's
   *   width: the carve is raster-limited, so class width is the honest proxy —
   *   a stream wets the rims, a river floats the doors.
   *
   *   SEA — depth is real: surface minus seabed, which the terrain build
   *   actually dropped. No current; the wind's work on the truck is not worth
   *   modelling at this scale.
   *
   *   LAKES & PONDS — cover says water, nothing says how much. Half a metre:
   *   wadeable, honest for the tarns and margins this mostly is.
   */
  /** Is this point inside a watercourse's own water — within the channel's half
   *  width of its centreline? Allocation-free, because `surfaceAt` asks this for
   *  every wheel every frame and for every ring point of a vegetation pass. */
  /** Dig the watercourse beds inside a tile. Runs after `carveCorridors`, and
   *  only ever lowers, so it cannot lift ground back over a road.
   *
   *  Driven from the CHANNELS, not from the vertices. Asking all 16k vertices of
   *  a tile whether a river runs past them is a grid walk and a set allocation
   *  each, on a path that already costs a tile rebuild; walking the handful of
   *  channels instead and touching only the lattice under each one's bounding box
   *  does the same work for the length of river actually present. */
  function carveChannels(S: TerrainStore, t: HeightTile, pos: Float32Array, SEG: number): void {
    if (!S.channels.size) return;
    const cell = t.w / SEG;
    const seen = new Set<StripLike>();
    const cx0 = Math.floor(t.xs / S.grid) - 1, cx1 = Math.floor((t.xs + t.w) / S.grid) + 1;
    const cz0 = Math.floor(t.zs / S.grid) - 1, cz1 = Math.floor((t.zs + t.h) / S.grid) + 1;
    for (let gx = cx0; gx <= cx1; gx++) for (let gz = cz0; gz <= cz1; gz++) {
      for (const c of S.channels.get(`${gx},${gz}`) ?? []) seen.add(c);
    }
    if (!seen.size) return;
    // By position, not by lattice index: a refined tile's vertices are not on
    // the lattice. The boxes are few and the vertices are walked once.
    const boxes: number[][] = [];
    for (const c of seen) {
      const m = c.hw + 3 + cell;
      boxes.push([Math.min(c.ax, c.bx) - m, Math.max(c.ax, c.bx) + m, Math.min(c.az, c.bz) - m, Math.max(c.az, c.bz) + m]);
    }
    const touched = new Set<number>();
    const ox = t.xs + t.w / 2, oz = t.zs + t.h / 2;
    for (let v = 0; v < (pos.length / 3); v++) {
      const x = pos[(v) * 3] + ox, z = pos[(v) * 3 + 2] + oz;
      for (const b of boxes) if (x >= b[0] && x <= b[1] && z >= b[2] && z <= b[3]) { touched.add(v); break; }
    }
    for (const v of touched) {
      const x = pos[(v) * 3] + t.xs + t.w / 2, z = pos[(v) * 3 + 2] + t.zs + t.h / 2;
      const f = channelFloorAt(S, x, z, pos[(v) * 3 + 1]);
      if (f !== null) pos[(v) * 3 + 1] = f;
    }
  }
  /**
   * A WATERCOURSE: solved profile, carved bed, and a bore wherever it runs under
   * something. Replaces the plain drape the river used to be.
   */
  /** Every tile's border row, world x, z, y in threes, stored as it was built
   *  — what a follower pins to and what `borderShared` compares. */
  function storeBorder(S: TerrainStore, t: HeightTile, pos: Float32Array): void {
    const cxm = t.xs + t.w / 2, czm = t.zs + t.h / 2;
    const b: number[] = [];
    for (let v = 0; v < (pos.length / 3); v++) {
      const x = pos[(v) * 3] + cxm, z = pos[(v) * 3 + 2] + czm;
      if (onTileEdge(t, x, z)) b.push(x, z, pos[(v) * 3 + 1]);
    }
    S.borders.set(`${t.tx}/${t.ty}`, Float64Array.from(b));
  }
  /** Does the tile at `nk` already carry every point of `t`'s border along
   *  their shared edge, at the same heights? */
  /** The vertices of a plain tile that lie on a refined neighbour's border,
   *  with the neighbour's heights — re-applied after the carve. */
  function refinedBorderPins(S: TerrainStore, t: HeightTile, pos: Float32Array): Array<[number, number]> {
    const out: Array<[number, number]> = [];
    const cxm = t.xs + t.w / 2, czm = t.zs + t.h / 2;
    const want = new Map<string, MmPt>();
    for (const [dx, dy] of [[-1, 0], [0, -1]]) {                 // the owners of this tile's west and north edges
      const nb = S.borders.get(`${t.tx + dx}/${t.ty + dy}`);
      if (!nb) continue;
      for (let i = 0; i < nb.length; i += 3) {
        const x = nb[i], z = nb[i + 1];
        if (!onTileEdge(t, x, z)) continue;                       // the owner's OTHER edges are not ours
        want.set(mmKey(x, z), [x, z, nb[i + 2]]);
      }
    }
    if (!want.size) return out;
    for (let v = 0; v < (pos.length / 3); v++) {
      const x = pos[(v) * 3] + cxm, z = pos[(v) * 3 + 2] + czm;
      if (!onTileEdge(t, x, z)) continue;
      const p = mmNear(want, x, z);
      if (p) out.push([v, p[2]]);
    }
    return out;
  }
  // Rebuilds are not free — 16.6k vertices, each sampling the heightfield and
  // asking the road grid whether it is in a cutting. A tile arriving used to
  // rebuild all eight neighbours SYNCHRONOUSLY, and roads now want rebuilds too,
  // so they queue instead and the main loop spends one per frame on them.
  /** Does the tile at `nk` already carry every point of `t`'s border along
   *  their shared edge, at the same heights? */
  function borderShared(S: TerrainStore, t: HeightTile, nk: string): boolean {
    const mine = S.borders.get(`${t.tx}/${t.ty}`), theirs = S.borders.get(nk);
    if (!mine) return true;
    if (!theirs) return false;
    const nt = S.heights.get(nk);
    if (!nt) return true;
    const have = mmIndex(theirs);
    for (let i = 0; i < mine.length; i += 3) {
      const x = mine[i], z = mine[i + 1];
      // On the shared edge: inside the neighbour's box (with slack) and on ours.
      if (x < nt.xs - 1e-3 || x > nt.xs + nt.w + 1e-3 || z < nt.zs - 1e-3 || z > nt.zs + nt.h + 1e-3) continue;
      const p = mmNear(have, x, z);
      if (!p || Math.abs(p[2] - mine[i + 2]) > 0.02) return false;
    }
    return true;
  }
  /** The vertices of a plain tile that lie on a refined neighbour's border,
   *  with the neighbour's heights — re-applied after the carve. */
  // OBJECT SPACE, not tangent space. A tangent-space map would need the handedness
  // of three's UVs against PlaneGeometry's winding to come out right, and getting
  // that wrong inverts the shading of every north-facing slope in a way that is
  // easy to stare past. The terrain mesh carries no rotation, so its object space
  // IS world space, and the vector to store is simply the world normal — which is
  // checkable against the heightfield rather than against a rendering. See
  // __nrmcheck.
  //
  // The one mapping still to get right is which texel a world point lands on.
  // PlaneGeometry's uv.y grows with local +Y, and the geometry is rotated -90°
  // about X, so uv.y grows toward world -Z. A DataTexture does not flip, so v=0
  // is buffer row 0 — which therefore sits at MAX z, while the tile's own data
  // row 0 sits at MIN z. The rows are stored reversed for exactly that reason.
  function normalMapBytes(S: TerrainStore, t: { w: number; data: Float32Array; xs?: number; zs?: number; h?: number }): Uint8Array {
    const W = 256;
    const mpp = t.w / W;
    const buf = new Uint8Array(W * W * 4);
    // THE EDGE ROWS READ THE NEIGHBOUR. The one-sided difference at a tile's
    // border lit its edge pixels differently from the interior — a seam along
    // every tile boundary. At the border the sample beyond the edge is taken
    // from the field, which has the neighbouring tile when it is loaded.
    // IN THE RASTER'S FRAME. `t.data` is absolute elevation and `sampleHeight`
    // is local (minus S.baseElev); the first version mixed them, so every border
    // pixel got a gradient the size of the base elevation and the tile edges
    // drew as black lines at close zoom — the exact seam this exists to remove,
    // inverted (Senqu, live, with the tile debug lines to correlate against).
    const beyond = (i: number, j: number): number | null => {
      if (t.xs === undefined || t.zs === undefined || t.h === undefined) return null;
      // The raster's samples sit at xs + i·w/255 — 256 of them spanning the
      // tile edge to edge, as the colour pass reads them — not at pixel
      // centres on a w/256 pitch, and half a pixel of misplacement is a
      // quarter of the slope in the edge gradient.
      const ex = t.xs + i * (t.w / (W - 1)), ez = t.zs + j * (t.h / (W - 1));
      return S.hasHeight(ex, ez) ? S.sampleHeightRaw(ex, ez) + S.baseElev : null;
    };
    for (let j = 0; j < W; j++) {
      const j0 = Math.max(0, j - 1) * W, j1 = Math.min(W - 1, j + 1) * W;
      const dj = (Math.min(W - 1, j + 1) - Math.max(0, j - 1)) * mpp;
      for (let i = 0; i < W; i++) {
        const i0 = Math.max(0, i - 1), i1 = Math.min(W - 1, i + 1);
        const di = (i1 - i0) * mpp;
        let dzdx = (t.data[j * W + i1] - t.data[j * W + i0]) / di;
        let dzdz = (t.data[j1 + i] - t.data[j0 + i]) / dj;
        if (i === 0 || i === W - 1) {
          const a = i === 0 ? beyond(-1, j) : t.data[j * W + i - 1];
          const b = i === W - 1 ? beyond(W, j) : t.data[j * W + i + 1];
          if (a !== null && b !== null) dzdx = (b - a) / (2 * mpp);
        }
        if (j === 0 || j === W - 1) {
          const a = j === 0 ? beyond(i, -1) : t.data[(j - 1) * W + i];
          const b = j === W - 1 ? beyond(i, W) : t.data[(j + 1) * W + i];
          if (a !== null && b !== null) dzdz = (b - a) / (2 * mpp);
        }
        // World normal of the heightfield: y is up, and the surface falls away
        // from the gradient in x and z.
        // FLATTENED TOWARD UP by S.nrmScale. Taken raw, a 9.5m/px gradient on a
        // sea cliff is a near-horizontal normal, and Chapman's rock faces went
        // black under a high sun — physically defensible and much worse to look
        // at than the smoothed mesh facets they replaced. Easing the gradient
        // keeps the ridges and gullies the mesh cannot hold without pretending
        // the whole cliff faces the camera.
        const nx = -dzdx * S.nrmScale, ny = 1, nz = -dzdz * S.nrmScale;
        const l = Math.hypot(nx, ny, nz) || 1;
        const o = ((W - 1 - j) * W + i) * 4;     // rows reversed — see above
        buf[o] = Math.round((nx / l * 0.5 + 0.5) * 255);
        buf[o + 1] = Math.round((ny / l * 0.5 + 0.5) * 255);
        buf[o + 2] = Math.round((nz / l * 0.5 + 0.5) * 255);
        buf[o + 3] = 255;
      }
    }
    return buf;
  }
  /** One material per terrain tile, because each carries its own normal map.
   *  Retired with the mesh it belonged to — a DataTexture per tile is 256KB, and
   *  the streamer rebuilds tiles constantly. */

  /** The plain lattice: THREE.PlaneGeometry(w, h, SEG, SEG).rotateX(-π/2), as
   *  arrays — vertex rows north to south, uv (ix/SEG, 1 - iz/SEG), two
   *  up-facing triangles a cell, and the cell table for free. */
  function plainLattice(t: HeightTile, SEG: number): { pos: Float32Array; uv: Float32Array; idx: Uint32Array; cellTris: CellTris } {
    const n = (SEG + 1) * (SEG + 1);
    const pos = new Float32Array(n * 3), uv = new Float32Array(n * 2);
    const cw = t.w / SEG, ch = t.h / SEG;
    for (let iz = 0; iz <= SEG; iz++) for (let ix = 0; ix <= SEG; ix++) {
      const v = iz * (SEG + 1) + ix;
      pos[v * 3] = -t.w / 2 + ix * cw; pos[v * 3 + 1] = 0; pos[v * 3 + 2] = -t.h / 2 + iz * ch;
      uv[v * 2] = ix / SEG; uv[v * 2 + 1] = 1 - iz / SEG;
    }
    const idx = new Uint32Array(SEG * SEG * 6), tris = new Int32Array(SEG * SEG * 6), offs = new Int32Array(SEG * SEG + 1);
    for (let iz = 0; iz < SEG; iz++) for (let ix = 0; ix < SEG; ix++) {
      const a = ix + (SEG + 1) * iz, b = ix + (SEG + 1) * (iz + 1), c = ix + 1 + (SEG + 1) * (iz + 1), d = ix + 1 + (SEG + 1) * iz;
      const k = iz * SEG + ix, o = k * 6;
      idx[o] = a; idx[o + 1] = b; idx[o + 2] = d; idx[o + 3] = b; idx[o + 4] = c; idx[o + 5] = d;
      tris[o] = a; tris[o + 1] = b; tris[o + 2] = d; tris[o + 3] = b; tris[o + 4] = c; tris[o + 5] = d;
      // `offs` counts TRIANGLES, not index entries: two a cell. Counting six
      // sent every reader three cells past its own and off the end of the
      // table — undefined vertices, NaN heights, a truck with no ground.
      offs[k + 1] = (k + 1) * 2;
    }
    return { pos, uv, idx, cellTris: { seg: SEG, offs, tris } };
  }
  /** THREE's computeVertexNormals, on arrays: area-weighted face normals summed
   *  per vertex and normalised. */
  function vertexNormals(pos: Float32Array, idx: Uint32Array | Uint16Array): Float32Array {
    const nrm = new Float32Array(pos.length);
    for (let f = 0; f < idx.length; f += 3) {
      const a = idx[f] * 3, b = idx[f + 1] * 3, c = idx[f + 2] * 3;
      const cbx = pos[c] - pos[b], cby = pos[c + 1] - pos[b + 1], cbz = pos[c + 2] - pos[b + 2];
      const abx = pos[a] - pos[b], aby = pos[a + 1] - pos[b + 1], abz = pos[a + 2] - pos[b + 2];
      const nx = cby * abz - cbz * aby, ny = cbz * abx - cbx * abz, nz = cbx * aby - cby * abx;
      nrm[a] += nx; nrm[a + 1] += ny; nrm[a + 2] += nz;
      nrm[b] += nx; nrm[b + 1] += ny; nrm[b + 2] += nz;
      nrm[c] += nx; nrm[c + 1] += ny; nrm[c + 2] += nz;
    }
    for (let v = 0; v < nrm.length; v += 3) {
      const l = Math.hypot(nrm[v], nrm[v + 1], nrm[v + 2]);
      if (l > 0) { nrm[v] /= l; nrm[v + 1] /= l; nrm[v + 2] /= l; } else nrm[v + 1] = 1;
    }
    return nrm;
  }
  /** THE BUILD. Geometry, heights, carves, borders, colour, normals — the
   *  arrays a mesh is made of, and nothing that needs a renderer. */
  function buildTile(S: TerrainStore, t: HeightTile, SEG: number, corridor: boolean, refine: boolean): TileBuild {
    const p0 = performance.now();
    const refined = refine ? refineTileGeometry(S, t, SEG, corridor) : null;
    const p1 = performance.now();
    let pos: Float32Array, uv: Float32Array, idx: Uint32Array, cellTris: CellTris;
    if (refined) { pos = refined.pos; uv = refined.uv; idx = refined.idx; cellTris = refined.cellTris; }
    else { const g = plainLattice(t, SEG); pos = g.pos; uv = g.uv; idx = g.idx; cellTris = g.cellTris; }
    const cxm = t.xs + t.w / 2, czm = t.zs + t.h / 2;
    const cell = t.w / SEG;
    const colors = new Float32Array(pos.length);
    for (let i = 0; i < (refined ? 0 : (pos.length / 3)); i++) {
      const ex = pos[(i) * 3] + cxm, ez = pos[(i) * 3 + 2] + czm;
      const cv = S.sampleCover(ex, ez);
      // The exact edge where the field has a tile, inside this one where it
      // does not — see refineTileGeometry's fieldAt.
      let elev = S.hasHeight(ex, ez) ? S.sampleHeight(ex, ez)
        : S.sampleHeight(clamp(ex, t.xs + 1e-4, t.xs + t.w - 1e-4), clamp(ez, t.zs + 1e-4, t.zs + t.h - 1e-4));
      // GIVE THE SEA A FLOOR. The elevation source carries no bathymetry: it
      // fills the ocean with a flat plate AT the waterline, so once the water
      // plane was placed correctly the Pacific rendered as a 40cm lagoon over
      // its own bed — measured 0.4m deep for two kilometres straight out. Where
      // cover says water, the bed drops to a depth that reads as sea. It only
      // ever lowers ground, and the step at the shoreline is itself underwater.
      //
      // ONLY THE SEA GETS A FLOOR. Cover calls mountain rivers and tarns water
      // too, and they run hundreds of metres above sea level — cutting those to
      // the waterline carves a chasm down the hillside they sit on, and leaves
      // whatever escaped the cut standing over it as a slab. So the cut applies
      // only where the ground is ALREADY at the water: within two metres of the
      // sea surface, which is precisely the flat ocean plate the DEM draws and
      // nothing else. That also makes it safe against a bad sea datum, which is
      // the failure that found this.
      if (cv === S.cover.water) {
        const seaLocal = S.seaAbs() - S.baseElev;
        if (elev <= seaLocal + 2) elev = Math.min(elev, seaLocal - SEA_BED);
      }
      pos[(i) * 3 + 1] = elev;
    }
    // A stitched plain tile still carves — its own roads are the old grid's —
    // but never the vertices pinned to a refined neighbour's border (the carve
    // only lowers, and a pinned border vertex is already where it must be, so
    // the carve is simply run on the plain lattice and the border re-pinned).
    const p2 = performance.now();
    const tk = `${t.tx}/${t.ty}`;
    nanScan(pos, 'heights', tk);
    if (!refined || !corridor) carveCorridors(S, t, pos, cellTris, SEG);
    nanScan(pos, 'carve', tk);
    const p3 = performance.now();
    carveChannels(S, t, pos, SEG);
    nanScan(pos, 'channels', tk);
    const p4 = performance.now();
    if (!refined || !corridor) {
      const pinned = refinedBorderPins(S, t, pos);
      for (const [v, y] of pinned) pos[v * 3 + 1] = y;
    }
    nanScan(pos, 'pins', tk);
    storeBorder(S, t, pos);
    const p5 = performance.now();
    const kinds = refined ? refined.kinds : null;
    for (let i = 0; i < (pos.length / 3); i++) {
      const ex = pos[(i) * 3] + cxm, ez = pos[(i) * 3 + 2] + czm;
      const elevAbs = pos[(i) * 3 + 1] + S.baseElev;
      const u = clamp(Math.round(((ex - t.xs) / t.w) * 255), 0, 255);
      const v = clamp(Math.round(((ez - t.zs) / t.h) * 255), 0, 255);
      // THE SLOPE READS ACROSS THE TILE EDGE. A forward difference clamped
      // inside the tile gave the last column and row of every tile a slope of
      // zero, so they took no shade darkening and drew a one-vertex bright line
      // along two edges of each tile — the cross through the truck on every
      // chart frame (Colcha K, Walter Sisulu). Central difference on the field
      // itself, which knows the neighbouring tile; where no tile is loaded the
      // in-tile one-sided read stands in, so the world's edge is not shaded as
      // a cliff down to sea level.
      let du: number, dv: number;
      if (S.hasHeight(ex + cell, ez) && S.hasHeight(ex - cell, ez) && S.hasHeight(ex, ez + cell) && S.hasHeight(ex, ez - cell)) {
        du = (S.sampleHeight(ex + cell, ez) - S.sampleHeight(ex - cell, ez)) / 2;
        dv = (S.sampleHeight(ex, ez + cell) - S.sampleHeight(ex, ez - cell)) / 2;
      } else {
        du = t.data[v * 256 + Math.min(255, u + 1)] - t.data[v * 256 + Math.max(0, u - (u === 255 ? 1 : 0))];
        dv = t.data[Math.min(255, v + 1) * 256 + u] - t.data[Math.max(0, v - (v === 255 ? 1 : 0)) * 256 + u];
      }
      // coverPaint, not sampleCover: this is the one consumer that only decides a
      // COLOUR, so it takes the dithered read and the 38m block edges dissolve
      // into a ragged boundary at vertex resolution. See coverPaint.
      // A cut face is steeper than any DEM slope and is fresh earth; a bank is
      // as steep and grassed. Both shade by their own slope, the face wears
      // the earth the batter strip used to.
      const kind = kinds ? kinds[i] : 0;
      let slope = Math.hypot(du, dv) / Math.max(cell, 1);
      if (kind === 2) slope = Math.max(slope, CUTF_K); else if (kind === 3) slope = Math.max(slope, BANK_K);
      let [r, g, bb] = S.palette(elevAbs, slope, S.coverPaint(ex, ez), ex, ez);
      if (kind === 2) { r += (EARTH_T[0] - r) * 0.6; g += (EARTH_T[1] - g) * 0.6; bb += (EARTH_T[2] - bb) * 0.6; }
      // …and then whoever actually drew this ground. The 38m raster says what is
      // growing across a landscape; an OSM area says where a particular wood
      // STOPS, which is the thing the raster cannot resolve. Applied after it,
      // and only part of the way, for the same reason the raster is: the ramp is
      // where the art direction lives.
      const at2 = S.areaTint(ex, ez);
      if (at2) {
        r += (at2[0] - r) * AREA_MIX; g += (at2[1] - g) * AREA_MIX; bb += (at2[2] - bb) * AREA_MIX;
      }
      colors[i * 3] = r; colors[i * 3 + 1] = g; colors[i * 3 + 2] = bb;
    }
    const p6 = performance.now();
    const normals = vertexNormals(pos, idx);
    const p7 = performance.now();
    plainCost.builds++; plainCost.refine += p1 - p0; plainCost.heights += p2 - p1; plainCost.carve += p3 - p2; plainCost.channels += p4 - p3;
    plainCost.pins += p5 - p4; plainCost.colour += p6 - p5; plainCost.normals += p7 - p6;
    return { pos, uv, idx, colors, normals, kinds: refined ? refined.kinds : null, cellTris, refined: !!refined, corridor };
  }

  const M_LAT = 111320, TERRAIN_Z = 14;
  const tileAt = (lat: number, lon: number, z: number): [number, number] => {
    const n = 2 ** z;
    const x = Math.floor(((lon + 180) / 360) * n);
    const r = (lat * Math.PI) / 180;
    const y = Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n);
    return [x, clamp(y, 0, n - 1)];
  };
  function hash2(a: number, b: number): number {
    let h = (a * 73856093) ^ (b * 19349663);
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }
  function pointInPoly(px: number, pz: number, pts: Array<[number, number]>): boolean {
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [xi, zi] = pts[i], [xj, zj] = pts[j];
      if (zi > pz !== zj > pz && px < ((xj - xi) * (pz - zi)) / (zj - zi) + xi) inside = !inside;
    }
    return inside;
  }
  function closestOnSeg(px: number, pz: number, s: StripLike): [number, number] {
    const dx = s.bx - s.ax, dz = s.bz - s.az;
    const t = clamp(((px - s.ax) * dx + (pz - s.az) * dz) / (dx * dx + dz * dz || 1), 0, 1);
    return [s.ax + dx * t, s.az + dz * t];
  }
  /** Height and cover sampling over a RasterWorld — main.ts's own readers,
   *  which the worker cannot reach, as one implementation for both sides. */
  function makeSampler(H: RasterWorld) {
    const texel = (tx: number, ty: number, px: number, pz: number): number | null => {
      const t = H.heights.get(`${tx + Math.floor(px / 256)}/${ty + Math.floor(pz / 256)}`);
      if (!t) return null;
      return t.data[(((pz % 256) + 256) % 256) * 256 + (((px % 256) + 256) % 256)];
    };
    // The tile a point is in is asked ten times a vertex (the slope's four
    // neighbours, twice each, and the point itself) and each ask was the
    // web-mercator tile math — atan, sinh, log — so the answer is kept per
    // 64m cell; the half-open box test below still decides.
    const cellTile = new Map<string, HeightTile | undefined>();
    const heightTileAt = (ex: number, ez: number): HeightTile | undefined => {
      const inside = (t: HeightTile | undefined): HeightTile | undefined =>
        t && ex >= t.xs && ez >= t.zs && ex < t.xs + t.w && ez < t.zs + t.h ? t : undefined;
      const ck = `${Math.floor(ex / 64)},${Math.floor(ez / 64)}`;
      const cached = cellTile.get(ck);
      if (cached) { const c = inside(cached); if (c) return c; }
      const [tx, ty] = tileAt(H.origin.lat - ez / M_LAT, H.origin.lon + ex / H.origin.mLon, TERRAIN_Z);
      const hit = inside(H.heights.get(`${tx}/${ty}`));
      if (hit) { cellTile.set(ck, hit); return hit; }
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
        if (!dx && !dy) continue;
        const n = inside(H.heights.get(`${tx + dx}/${ty + dy}`));
        if (n) { cellTile.set(ck, n); return n; }
      }
      return undefined;
    };
    const hasHeight = (ex: number, ez: number): boolean => heightTileAt(ex, ez) !== undefined;
    const sampleHeightRaw = (ex: number, ez: number): number => {
      const t = heightTileAt(ex, ez);
      if (!t) return 0;
      const u = ((ex - t.xs) / t.w) * 256 - 0.5, v = ((ez - t.zs) / t.h) * 256 - 0.5;
      const x0 = Math.floor(u), z0 = Math.floor(v), fx = u - x0, fz = v - z0;
      const base = texel(t.tx, t.ty, clamp(x0, 0, 255), clamp(z0, 0, 255)) ?? 0;
      const g = (px: number, pz: number): number => texel(t.tx, t.ty, px, pz) ?? base;
      return (g(x0, z0) * (1 - fx) + g(x0 + 1, z0) * fx) * (1 - fz)
        + (g(x0, z0 + 1) * (1 - fx) + g(x0 + 1, z0 + 1) * fx) * fz - H.baseElev;
    };
    let box: [number, number, number, number] | null = null;
    for (let i = 0; i + 3 < H.pads.length; i += 4) {
      const x = H.pads[i], z = H.pads[i + 1], r = H.pads[i + 2] * 2;
      if (!box) box = [x - r, z - r, x + r, z + r];
      else { box[0] = Math.min(box[0], x - r); box[1] = Math.min(box[1], z - r); box[2] = Math.max(box[2], x + r); box[3] = Math.max(box[3], z + r); }
    }
    const landmarkFlatten = (ex: number, ez: number, raw: number): number => {
      let wSum = 0, eSum = 0, wMax = 0;
      for (let i = 0; i + 3 < H.pads.length; i += 4) {
        const pad = H.pads[i + 2];
        const dx = ex - H.pads[i], dz = ez - H.pads[i + 1];
        if (Math.abs(dx) > pad * 2 || Math.abs(dz) > pad * 2) continue;
        const d = Math.hypot(dx, dz);
        if (d > pad * 2) continue;
        const w = d <= pad ? 1 : 1 - (d - pad) / pad;
        wSum += w * w * w; eSum += w * w * w * H.pads[i + 3];
        const sk = w * w * (3 - 2 * w);
        if (sk > wMax) wMax = sk;
      }
      if (wSum <= 0) return raw;
      const padE = eSum / wSum;
      if (wMax >= 1) return padE;
      return Math.min(raw, padE * wMax + raw * (1 - wMax));
    };
    const sampleHeight = (ex: number, ez: number): number => {
      const raw = sampleHeightRaw(ex, ez);
      if (box === null || ex < box[0] || ex > box[2] || ez < box[1] || ez > box[3]) return raw;
      return landmarkFlatten(ex, ez, raw);
    };
    // Cover tiles by 2km cell, built once a sampler: the scan of every tile
    // for every read was three scans a vertex over seventy tiles.
    const coverCells = new Map<string, CoverTile[]>();
    const CC = 2000;
    for (const t of H.cover.values()) {
      for (let cx = Math.floor(t.xs / CC); cx <= Math.floor((t.xs + t.w) / CC); cx++) {
        for (let cz = Math.floor(t.zs / CC); cz <= Math.floor((t.zs + t.h) / CC); cz++) {
          const k = `${cx},${cz}`;
          const arr = coverCells.get(k);
          if (arr) arr.push(t); else coverCells.set(k, [t]);
        }
      }
    }
    const sampleCoverRaw = (ex: number, ez: number): number | undefined => {
      const arr = coverCells.get(`${Math.floor(ex / CC)},${Math.floor(ez / CC)}`);
      if (!arr) return undefined;
      for (const t of arr) {
        if (ex < t.xs || ez < t.zs || ex >= t.xs + t.w || ez >= t.zs + t.h) continue;
        const px = Math.min(255, Math.max(0, Math.floor(((ex - t.xs) / t.w) * 256)));
        const pz = Math.min(255, Math.max(0, Math.floor(((ez - t.zs) / t.h) * 256)));
        return t.data[pz * 256 + px];
      }
      return undefined;
    };
    const sampleCover = (ex: number, ez: number): number | null => {
      const v = sampleCoverRaw(ex, ez);
      return v === undefined || v === 0 ? null : v;
    };
    const coverPaint = (ex: number, ez: number, water: number): number | null => {
      const truth = sampleCover(ex, ez);
      if (truth === null || truth === water) return truth;
      const h1 = hash2(Math.round(ex * 0.37), Math.round(ez * 0.37));
      const h2 = hash2(Math.round(ez * 0.41) + 7717, Math.round(ex * 0.43));
      const j = H.coverPx * 0.55;
      const alt = sampleCover(ex + (h1 - 0.5) * j, ez + (h2 - 0.5) * j);
      return alt === null || alt === water ? truth : alt;
    };
    const memo = new Map<string, boolean>();
    const coverWater = (ex: number, ez: number, water: number): boolean => {
      if (sampleCover(ex, ez) !== water) return false;
      if (!hasHeight(ex, ez)) return true;
      const k = `${Math.round(ex / 20)},${Math.round(ez / 20)}`;
      const hit = memo.get(k);
      if (hit !== undefined) return hit;
      const r = H.coverPx / 2;
      const c = sampleHeight(ex, ez);
      const e = sampleHeight(ex + r, ez), w = sampleHeight(ex - r, ez);
      const s = sampleHeight(ex, ez + r), n = sampleHeight(ex, ez - r);
      const tilt = Math.hypot(e - w, s - n) / (2 * r);
      const holds = tilt < H.waterTilt && c < Math.min(e, w, s, n) + 1.2;
      if (memo.size > 40000) memo.clear();
      memo.set(k, holds);
      return holds;
    };
    return { hasHeight, sampleHeight, sampleHeightRaw, sampleCover, coverPaint, coverWater, heightTileAt };
  }
  /** The ground colour over a PaletteState — main.ts's terrainPalette with
   *  its globals made arguments; the climate comes as weights per biome. */
  function makePalette(P: PaletteState) {
    const palette = (elev: number, slope: number, cover: number | null, px: number, pz: number): Rgb => {
      // Solarpunk desert: cyan shallows → warm sand → ochre scrub → dry upland →
      // bare rock → snow. The emerald in this world comes from the VEGETATION
      // standing on the sand, not from painting the ground green.
      //
      // THE RAMP IS NOW BLENDED PER PLACE. Given a position, the five archetype
      // ramps are mixed by the climate weights there, so a coast that shades into
      // highland shades in COLOUR too instead of holding one palette until the
      // session ends. All five share breakpoints (RAMP_STEPS, asserted at load),
      // so this costs one band lookup and a weighted sum of five colours rather
      // than five separate scans. Without a position — a caller I have missed, or
      // one that genuinely has none — it falls back to the settled `biome`, which
      // is exactly the old behaviour.
      const cl = P.climate(px, pz, elev);
      const ramp = P.ramp;
      let c: Rgb = ramp[ramp.length - 1][1];
      // THE SHALLOWS BAND IS ABOUT WATER, NOT ABOUT ALTITUDE. Every ramp opens
      // with a cyan for ground at or below sea level, which is right on a coast
      // and catastrophic in a basin: Death Valley's floor is 86m down, so the
      // whole of it — salt pan, alluvial fan, the road itself — came out painted
      // as sea shallows, and every screenshot of it looked like a flood. Where
      // this world has already proved it has dry land below sea level, skip
      // straight to the land colours.
      //
      // …AND THE OTHER HALF OF THE SAME FAULT: the band keys on HEIGHT ALONE, so
      // any ground that reads as sea level is painted as seabed whether or not
      // there is a drop of water anywhere near it. Reported from the seat as
      // PARIS IS FLOODED, and it is: the aperture sits at 61m, the cover raster
      // says 63% urban and 0% water for three kilometres around, and the moment a
      // DEM tile is missing or wrong the ground under it reads as 0m and the
      // whole tile goes cyan. `P.dryAt` cannot catch this — it only arms once the
      // world has PROVED dry land below sea level, which never happens in a city
      // sixty metres up.
      //
      // So the band now wants corroboration, from a raster this function is
      // already being handed. If the cover says built, forest, crops — anything
      // but water — then this is not a seabed however low the DEM claims it is.
      // Unknown cover keeps the old behaviour: absence of evidence is not
      // evidence of dry land, and a genuine coast still has water under its
      // shallows.
      const knownDry = cover !== null && cover !== undefined && cover !== P.water;
      const start = (P.dryAt || knownDry) ? 1 : 0;
      for (let i = start; i < ramp.length; i++) {
        const [max, col] = ramp[i];
        if (elev <= max || i === ramp.length - 1) {
          // The band is found on shared breakpoints, so `i` indexes every
          // archetype's ramp alike and the blend is a weighted sum in place.
          if (cl) {
            let r = 0, g = 0, b = 0;
            for (let k = 0; k < P.ramps.length; k++) {
              const w = cl[k];
              if (w <= 0.001) continue;
              const bc = P.ramps[k][i][1];
              r += bc[0] * w; g += bc[1] * w; b += bc[2] * w;
            }
            c = [r, g, b];
          } else c = col;
          break;
        }
      }
      // WHAT IS ACTUALLY GROWING ON IT. The elevation ramp knows how high the
      // ground is and nothing else, so farmland, forest and salt pan at the same
      // altitude came out the same colour. Cover pulls the ramp toward the real
      // character of the ground — but only PART of the way, because the ramp is
      // where the art direction lives and a photographic land-cover map would
      // flatten the whole look. Data sets the fact; the palette keeps the feel.
      if (cover === P.built) {
        // BUILT GROUND IS THE RAMP, GREYED — NOT A FIXED GREY. WorldCover's
        // built class is a 10m pixel, and along a rural road those pixels ARE the
        // road and its shoulders, which are already drawn. Pulled 55% toward one
        // dark grey they read from the chart as blocky brown blotches following
        // every desert road (Badwater Road, Giza, San Juan County — measured on
        // the live frames, with the mesh sitting exactly on natural ground). So
        // the tint is the ramp's own colour desaturated to a warm neutral at 92%
        // of its luminance — a made surface, in this ground's own key — mixed
        // more lightly than the other classes. (Gating it by road density was
        // tried: `builtUpAt` saturates beside a single carriageway.)
        const l = c[0] * 0.3 + c[1] * 0.59 + c[2] * 0.11;
        const t: Rgb = [l * 0.92, l * 0.91, l * 0.9];
        const k = P.coverMix * 0.75;
        c = [c[0] + (t[0] - c[0]) * k, c[1] + (t[1] - c[1]) * k, c[2] + (t[2] - c[2]) * k];
      } else if (cover !== null && cover !== undefined) {
        const t = P.coverTint[cover];
        if (t) c = [c[0] + (t[0] - c[0]) * P.coverMix, c[1] + (t[1] - c[1]) * P.coverMix, c[2] + (t[2] - c[2]) * P.coverMix];
      }
      // THE WATERLINE WRITES ITSELF ON THE LAND. The sea had an edge only because
      // two meshes stopped at the same place; nothing on the ground said the water
      // ever touched it. A narrow pale band — wet sand below a half-metre of
      // reach, the ghost of a foam line at the lapping height — is what a coast
      // looks like from this altitude, and it costs one blend per vertex that is
      // already this close to sea level. Skipped over proven-dry basins, where a
      // shoreline would be drawing the flood this palette just avoided.
      if (P.seaOn && !P.dryAt && cover !== P.water) {
        const sAbs = P.seaAbs;
        const band = 1 - clamp(Math.abs(elev - sAbs - 0.2) / 0.6, 0, 1);
        if (band > 0) {
          c = [c[0] + (0.62 - c[0]) * 0.5 * band, c[1] + (0.6 - c[1]) * 0.5 * band, c[2] + (0.5 - c[2]) * 0.5 * band];
          const foam = 1 - clamp(Math.abs(elev - sAbs) / 0.22, 0, 1);
          if (foam > 0) c = [c[0] + (0.78 - c[0]) * 0.55 * foam, c[1] + (0.84 - c[1]) * 0.55 * foam, c[2] + (0.82 - c[2]) * 0.55 * foam];
        }
      }
      const shade = 1 - clamp(slope * 1.4, 0, 0.45);
      return [c[0] * shade, c[1] * shade, c[2] * shade];
    };
    return palette;
  }
  /** The hydro system's elevation raster for a tile — EN×EN absolute
   *  heights, NaN where the field has no tile — off the same sampler the
   *  build used. main.ts's hydroFeed sampled this on the main thread, 17k
   *  reads a tile, and it was the whole post-step cost once the build moved. */
  function hydroElevation(S: TerrainStore, t: HeightTile, EN: number): Float32Array {
    const out = new Float32Array(EN * EN);
    for (let iz = 0; iz < EN; iz++) {
      const ez = t.zs + (iz / (EN - 1)) * t.h;
      for (let ix = 0; ix < EN; ix++) {
        const ex = t.xs + (ix / (EN - 1)) * t.w;
        out[iz * EN + ix] = S.hasHeight(ex, ez) ? S.sampleHeight(ex, ez) + S.baseElev : NaN;
      }
    }
    return out;
  }
  /** An area tint: the patches overlapping a point, last one wins. */
  function areaTintOf(patches: AreaPatchLike[], x: number, z: number): Rgb | null {
    let hit: Rgb | null = null;
    for (const q of patches) {
      if (x < q.x0 || x > q.x1 || z < q.z0 || z > q.z1) continue;
      if (pointInPoly(x, z, q.pts)) hit = q.tint;
    }
    return hit;
  }
  /** On a carriageway — onCarriageway(x, z, 0.6).road, answered from strips:
   *  any road strip (not a track) within its half width plus the margins. */
  function onRoadOf(strips: Map<string, StripLike[]>, cutL: number, x: number, z: number): boolean {
    const cx = Math.floor(x / cutL), cz = Math.floor(z / cutL);
    for (let ax = cx - 1; ax <= cx + 1; ax++) for (let az = cz - 1; az <= cz + 1; az++) {
      const arr = strips.get(`${ax},${az}`);
      if (!arr) continue;
      for (const s of arr) {
        if (s.tk) continue;
        const [px, pz] = closestOnSeg(x, z, s);
        if (Math.hypot(x - px, z - pz) <= s.hw + 0.8 + 0.6) return true;
      }
    }
    return false;
  }
  return {
    buildTile, borderShared, roadFloorHard, corridorH, stripBreakLines, stripFloor, cellTable, normalMapBytes, plainLattice, vertexNormals,
    refineCost, plainCost, carveCost, mmKey, mmIndex, mmNear, onTileEdge, channelsNear, makeSampler, makePalette, areaTintOf, onRoadOf, hydroElevation,
    BANK_K, CUTF_K, CUT_REACH_M, TOE_REACH, DECK_GAP_T, EARTH_T, CUT_CLEAR, SEA_BED, AREA_MIX, RELIEF_MIN,
  };
}
