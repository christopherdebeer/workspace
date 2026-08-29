/**
 * THE ROAD PROFILE SOLVER, out of the browser.
 *
 * Chain assembly, the hint store and the junction registry — the stage that
 * decides how a road sits on the ground and where two roads meet. It was
 * embedded in a fifteen-thousand-line module that opens a WebGL context at
 * import time, so the only way to ask it a question was to drive a headless
 * browser at two frames a second and read a probe. Five rounds of chasing one
 * junction step cost minutes per question and answered four wrong hypotheses.
 *
 * Measured before extracting, because "it is entangled" deserved a count
 * rather than a feeling: across the hundred and forty lines of chain assembly
 * there was ONE reference to THREE and ONE to window, and both were a debug
 * probe. Everything else was arithmetic over numbers and arrays. This stage had
 * no reason to be in a browser at all.
 *
 * Nothing here imports three, touches the DOM, or reads a global. What it needs
 * from the world arrives as `SolveEnv` — the terrain sampler above all, which a
 * test supplies from a captured fixture and the game supplies from live tiles.
 * That is the seam: the same code, the same numbers, no renderer.
 */

/** One OSM way, as much of it as this stage cares about. */
export interface SolveWay {
  id: string | number;
  tags?: Record<string, string>;
  geometry?: Array<{ lat: number; lon: number }>;
}

/**
 * Everything the solver cannot compute for itself. The terrain sampler is the
 * one that matters: pass the real one and you get the road the game draws, pass
 * a synthetic surface and you get a road nobody drives — which is why the
 * fixtures carry DECODED HEIGHT GRIDS rather than a formula. Real
 * misregistration is exactly what the bench search exists to cope with, so a
 * smooth test surface would assert on a problem the solver never has.
 */
export interface SolveEnv {
  /** Lat/lon → local metres. */
  toLocal(lat: number, lon: number): [number, number];
  /** Is there real elevation under this point yet? */
  hasHeight(x: number, z: number): boolean;
  /** The deck a neighbouring tile already settled at this end, if any. */
  deckAnchorAt(x: number, z: number): number | null;
  /** The bench DP. Injected because it is numerically delicate and worth
   *  moving on its own, later, with its own tests. */
  solveChain(
    dense: Array<[number, number]>, maxGrade: number,
    p0: number | null, p1: number | null, pins: Array<number | null>,
  ): number[];
  /** The spatial-hash key the junction grid shares with the road grid. */
  gkey(x: number, z: number): string;
  /** Steepest grade per highway class. */
  gradeMax: Record<string, number>;
  /** How far a road deck sits above the surface it is drawn on. */
  roadLift: number;
  /** How close two stations must be to count as the same node. */
  juncR: number;
  /** Off only from a probe, to measure what the pins are worth. */
  juncPins: boolean;
}

/** Ways that are drawn but never solved as part of a chain — plus `services`,
 *  which is not drawn at all: it tags a service AREA, and its outline runs
 *  alongside the carriageway it belongs to. Chained as a road it solved a
 *  profile of its own and pinned the real road to it. */
const NOT_DRIVABLE = ['track', 'path', 'bridleway', 'cycleway', 'footway', 'steps', 'services'];

const HINT_CELL = 24;

/**
 * The stores. Deliberately instance state rather than module globals: a test
 * that cannot start from an empty world can only ever measure the order its own
 * cases happened to run in, which is the exact class of bug being chased here.
 */
export class RoadSolver {
  /** Settled deck heights, spatially hashed. Advisory — rebuilt per tile. */
  readonly hints = new Map<string, Array<[number, number, number]>>();
  /** Ways already solved in some chain, so a later tile does not redo them. */
  readonly hinted = new Set<string>();
  /** Where roads were found to meet. */
  readonly junctions = new Map<string, Array<[number, number]>>();
  readonly stats = {
    pinned: 0, chains: 0, maxChainM: 0, totalChainM: 0,
    /** Why a way never reached the solver. Counted rather than reasoned about:
     *  four rounds of debugging failed for want of the distinction between
     *  "filtered out" and "never arrived". */
    considered: 0, noHeight: 0, notDrivable: 0, chained: 0,
    /** Kerbs cut back so you can turn through them. Counted here because it
     *  belongs with the junction numbers it is read beside, even though the
     *  apron that increments it lives with the ribbon builder. */
    opened: 0,
    dropped: [] as string[],
  };

  /**
   * SOLVED PROFILES IN STATION ORDER, kept only while a capture asks for them.
   *
   * The hint store is spatially hashed, which is right for the question it
   * answers — "what deck is at this point" — and destroys the one thing a
   * drivability question needs: which station follows which. A road is
   * drivable or not ALONG itself, and no amount of nearest-neighbour searching
   * recovers that ordering, because two stations 12m apart may be consecutive
   * on one road or a stacked pair of switchback legs.
   *
   * Off by default and never trimmed, so it must stay off in a real session:
   * it is a tape, not a cache.
   */
  recording = false;
  readonly profiles: Array<Array<[number, number, number]>> = [];

  constructor(private readonly env: SolveEnv) {}

  /**
   * THE SOLVER SPEAKS IN LOCAL METRES, SO A WORLD HOP MUST EMPTY IT.
   *
   * `hints` is keyed by a spatial cell of LOCAL x/z and carries a settled deck
   * ELEVATION; `junctions` likewise holds local positions. Both survive a
   * world rebase unless emptied — and because every world seats the truck at
   * local (0,0), the hints the last postcard left under its own wheels sit
   * exactly where the next one spawns. hintAt then hands the new road the OLD
   * world's deck height, the carve digs the hillside down to meet a deck that
   * is not there, and the truck arrives at the bottom of a phantom trench
   * (owner-caught, live). Advisory data with a hard spatial meaning is the
   * most dangerous thing to carry across a rebase precisely because nothing
   * about it looks like a coordinate.
   */
  /** How many times a world hop has emptied this solver, and what the last
   *  sweep discarded — a hop's awaits let the NEW world start writing hints
   *  before the caller resumes, so "is it empty now" is an unobservable
   *  instant and cannot be the assertion. What the sweep THREW AWAY can. */
  sweeps = 0;
  readonly lastSwept = { hints: 0, juncs: 0 };

  reset(): void {
    this.sweeps++;
    this.lastSwept.hints = this.hints.size;
    this.lastSwept.juncs = this.junctions.size;
    this.hints.clear();
    this.hinted.clear();
    this.junctions.clear();
    this.profiles.length = 0;
    const st = this.stats;
    st.pinned = 0; st.chains = 0; st.maxChainM = 0; st.totalChainM = 0;
    st.considered = 0; st.noHeight = 0; st.notDrivable = 0; st.chained = 0;
    st.opened = 0; st.dropped.length = 0;
  }

  writeHints(dense: Array<[number, number]>, alg: number[]): void {
    if (this.recording) this.profiles.push(dense.map((p, i) => [p[0], p[1], alg[i]]));
    if (this.hints.size > 6000) this.hints.clear();   // advisory data; rebuilt per tile
    for (let i = 0; i < dense.length; i++) {
      const k = `${Math.floor(dense[i][0] / HINT_CELL)},${Math.floor(dense[i][1] / HINT_CELL)}`;
      const e: [number, number, number] = [dense[i][0], dense[i][1], alg[i]];
      const arr = this.hints.get(k);
      if (arr) arr.push(e); else this.hints.set(k, [e]);
    }
  }

  hintAt(x: number, z: number, reach = 6): number | null {
    let best: number | null = null, bd = reach;
    for (const dx of [0, -HINT_CELL, HINT_CELL]) for (const dz of [0, -HINT_CELL, HINT_CELL]) {
      const arr = this.hints.get(`${Math.floor((x + dx) / HINT_CELL)},${Math.floor((z + dz) / HINT_CELL)}`);
      if (arr) for (const [hx, hz, he] of arr) {
        const d = Math.hypot(hx - x, hz - z);
        if (d < bd) { bd = d; best = he; }
      }
    }
    return best;
  }

  noteJunction(x: number, z: number): void {
    this.stats.pinned++;
    if (this.junctions.size > 8000) this.junctions.clear();
    const k = this.env.gkey(x, z);
    const arr = this.junctions.get(k);
    if (arr) { if (arr.length < 400) arr.push([x, z]); } else this.junctions.set(k, [[x, z]]);
  }

  /** Every recorded junction within `r` of a point. */
  junctionsNear(x: number, z: number, r: number): Array<[number, number]> {
    const out: Array<[number, number]> = [];
    for (const arr of this.junctions.values()) {
      for (const j of arr) if (Math.hypot(j[0] - x, j[1] - z) <= r) out.push(j);
    }
    return out;
  }

  /**
   * CHAIN A TILE'S DRIVABLE WAYS END TO END and solve each chain's profile
   * whole — hundreds of stations of real evidence rather than one way's worth —
   * publishing the result as hints the per-way builds consume instead of
   * solving alone.
   *
   * `els` are the ways this tile must build; `halo` are a neighbour's cached
   * copies, which reach further and make a better thing to solve over.
   */
  plan(els: SolveWay[], halo: SolveWay[] = []): void {
    const env = this.env;
    interface Mem { pts: Array<[number, number]>; name?: string; g: number; key: string; fresh: boolean }
    // ONE ENTRY PER OSM WAY, longest geometry wins. The same road reaches here
    // twice: clipped to this tile in `els`, and whole in a neighbour's cached
    // copy. The whole one is the better thing to solve over — the clip is a
    // rendering boundary, not a feature of the road — while the build loop
    // elsewhere still draws only the clipped piece belonging to this tile.
    const byId = new Map<string, { el: SolveWay; fresh: boolean }>();
    const consider = (el: SolveWay, fresh: boolean): void => {
      const t = el.tags ?? {};
      if (!el.geometry || !t.highway) return;
      if (NOT_DRIVABLE.includes(t.highway)) { this.stats.notDrivable++; return; }
      const id = String(el.id);
      const prev = byId.get(id);
      // `fresh` is sticky: a way this tile actually has to build stays fresh
      // even when the neighbour's longer copy is the one we solve over.
      if (!prev) byId.set(id, { el, fresh });
      else {
        if ((el.geometry?.length ?? 0) > (prev.el.geometry ?? []).length) prev.el = el;
        prev.fresh ||= fresh;
      }
    };
    for (const el of els) consider(el, !this.hinted.has(String(el.id)));
    for (const el of halo) consider(el, false);

    const mems: Mem[] = [];
    for (const [id, { el, fresh }] of byId) {
      const t = el.tags ?? {};
      const pts: Array<[number, number]> = (el.geometry ?? []).map((g2) => env.toLocal(g2.lat, g2.lon));
      if (pts.length < 2) continue;
      let ok = true;
      for (const [px, pz] of pts) if (!env.hasHeight(px, pz)) { ok = false; break; }
      this.stats.considered++;
      if (ok) mems.push({ pts, name: t.name, g: env.gradeMax[t.highway] ?? 0.15, key: id, fresh });
      else {
        this.stats.noHeight++;
        if (this.stats.dropped.length < 12) {
          this.stats.dropped.push(`${t.name ?? '(unnamed)'} [${t.highway}] ${pts.length}pts`);
        }
      }
    }

    const joins = (a: [number, number], b: [number, number]): boolean =>
      Math.hypot(a[0] - b[0], a[1] - b[1]) < 2;
    while (mems.length) {
      const chain: Mem[] = [mems.pop() as Mem];
      let grew = true;
      while (grew) {
        grew = false;
        const head = chain[0].pts[0];
        const tail = chain[chain.length - 1].pts[chain[chain.length - 1].pts.length - 1];
        for (let i = 0; i < mems.length; i++) {
          const m = mems[i];
          if (m.name !== chain[0].name) continue;      // one road, one chain
          const a = m.pts[0], b = m.pts[m.pts.length - 1];
          if (joins(a, tail)) { chain.push(m); mems.splice(i, 1); grew = true; break; }
          if (joins(b, tail)) { chain.push({ ...m, pts: m.pts.slice().reverse() }); mems.splice(i, 1); grew = true; break; }
          if (joins(b, head)) { chain.unshift(m); mems.splice(i, 1); grew = true; break; }
          if (joins(a, head)) { chain.unshift({ ...m, pts: m.pts.slice().reverse() }); mems.splice(i, 1); grew = true; break; }
        }
      }
      // Nothing new in this chain — every member was already solved in some
      // earlier tile's halo. Re-solving it would redo the same DP on every
      // neighbouring tile that streams in, and publish hints identical to the
      // ones already standing.
      if (!chain.some((m) => m.fresh)) continue;
      const all: Array<[number, number]> = [];
      for (const m of chain) for (const pt of m.pts) {
        if (!all.length || Math.hypot(pt[0] - all[all.length - 1][0], pt[1] - all[all.length - 1][1]) > 0.5) all.push(pt);
      }
      const dense = densifyPts(all);
      if (dense.length < 8) continue;                  // single crumbs keep the fallback path
      const a0 = env.deckAnchorAt(dense[0][0], dense[0][1]);
      const a1 = env.deckAnchorAt(dense[dense.length - 1][0], dense[dense.length - 1][1]);
      // JUNCTION PINS. Chains are solved one after another, so the hint store
      // holds every road settled before this one — earlier chains this tile,
      // and every tile already streamed. A hint sitting within juncR of a
      // station is another road's deck at this exact spot, which in OSM means
      // the two ways share a node: a junction. Roads that cross WITHOUT a
      // shared node are grade separated, their vertices land nowhere near each
      // other, and nothing is pinned — which is precisely the distinction
      // between a turning and a flyover, taken from the data rather than
      // guessed from heights.
      const pins = dense.map(([px, pz]) => (env.juncPins ? this.hintAt(px, pz, env.juncR) : null));
      for (let i = 0; i < dense.length; i++) if (pins[i] != null) this.noteJunction(dense[i][0], dense[i][1]);
      const alg = env.solveChain(dense, Math.min(...chain.map((m) => m.g)),
        a0 === null ? null : a0 - env.roadLift, a1 === null ? null : a1 - env.roadLift, pins);
      this.writeHints(dense, alg);
      {
        let len = 0;
        for (let i = 1; i < dense.length; i++) {
          len += Math.hypot(dense[i][0] - dense[i - 1][0], dense[i][1] - dense[i - 1][1]);
        }
        this.stats.chains++;
        this.stats.totalChainM += len;
        this.stats.maxChainM = Math.max(this.stats.maxChainM, Math.round(len));
      }
      this.stats.chained += chain.length;
      for (const m of chain) this.hinted.add(m.key);
    }
  }
}

/**
 * OSM ways only carry vertices where the road BENDS, so a long straight
 * segment would bridge every terrain dip between its endpoints like a
 * causeway. ~12m steps make the profile hug the ground it crosses.
 *
 * AND THE CORNERS ARE ROUNDED FIRST (road audit, finding 1). Densifying
 * alone cannot help a bend: the added points are collinear, so the corner
 * keeps its whole angle at the original vertex — which is exactly what
 * drives the kerb mitre past its 2.4x cap and parts neighbouring bays on
 * every hairpin. A real road arcs through its bends, so a sharp interior
 * vertex becomes a short quadratic arc: shoulders pulled back along each
 * leg, the vertex itself the control point. ENDPOINTS NEVER MOVE — they
 * are the weld anchors, the junction pins and the kerbseam keys — and an
 * interior vertex stays within its arc's sagitta (bounded by the shoulder
 * length) of where OSM put it.
 */
export function densifyPts(pts: Array<[number, number]>): Array<[number, number]> {
  const rounded: Array<[number, number]> = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    const [px, pz] = pts[i - 1], [vx, vz] = pts[i], [qx, qz] = pts[i + 1];
    const la = Math.hypot(vx - px, vz - pz) || 1, lb = Math.hypot(qx - vx, qz - vz) || 1;
    const turn = Math.acos(Math.max(-1, Math.min(1,
      ((vx - px) * (qx - vx) + (vz - pz) * (qz - vz)) / (la * lb))));
    // Gentle bends keep their vertex; 0.45 keeps consecutive arcs off each
    // other's legs; under 1.5m of shoulder an arc is noise, not a corner.
    const r = Math.min(9, la * 0.45, lb * 0.45);
    if (turn < 0.2 || r < 1.5) { rounded.push(pts[i]); continue; }
    const ax = vx - ((vx - px) / la) * r, az = vz - ((vz - pz) / la) * r;
    const bx = vx + ((qx - vx) / lb) * r, bz = vz + ((qz - vz) / lb) * r;
    const segs = Math.max(2, Math.ceil(turn / 0.18));   // ~10 degrees per arc step
    for (let s = 0; s <= segs; s++) {
      const t = s / segs, u = 1 - t;
      rounded.push([u * u * ax + 2 * u * t * vx + t * t * bx,
        u * u * az + 2 * u * t * vz + t * t * bz]);
    }
  }
  rounded.push(pts[pts.length - 1]);
  const dense: Array<[number, number]> = [rounded[0]];
  for (let i = 1; i < rounded.length; i++) {
    const [ax, az] = rounded[i - 1], [bx, bz] = rounded[i];
    const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 12));
    for (let s = 1; s <= steps; s++) dense.push([ax + ((bx - ax) * s) / steps, az + ((bz - az) * s) / steps]);
  }
  return dense;
}
