/** Squishy Level Lab: the real game geometry and physics, without its renderer.
 * NO WebGL, shaders, canvas or duplicate collision model.
 *
 * General purpose: any level and seed; the specimen is whatever the session is looking at, pinned by the
 * level's fingerprint. Discovery is a sampled ballistic witness; what a move is worth is measured in the
 * player's own units — pixels of drag on a phone — with the real soft body: where every nearby flick ends up,
 * how far off an aim may be and still land, and what the misses cost on the way home.
 */
import { buildLevel } from '../squishy/course';
import { Dumpling } from '../squishy/body';
import { launch, path, hop, aim, onTop, standing, towerAt, moveShapes, fingerprint,
  type Level, type V3, type Shape } from '../squishy/level';

export type Outcome = 'target' | 'other' | 'fall' | 'rest' | 'timeout';
export type EdgeStatus = 'predicted' | 'confirmed' | 'marginal' | 'failed';
export interface Control { yaw: number; power: number; spin: number; phase: number }
export interface Validation {
  outcomes: Record<Outcome, number>; total: number; traces: V3[][]; last: Outcome; landedAt: number;
  /** landings on the target / trials, its Wilson 95% interval, and the drag noise (px) the trials were drawn with */
  rate: number; wilson: [number, number]; sigma: number;
  /** the aim itself, flicked after resting a different while (and at another moment of anything that moves): landings / tries */
  timing: [number, number];
}
export interface Edge {
  from: number; to: number; control: Control;
  trajectory: V3[]; status: EdgeStatus; method: 'hop' | 'sample';
  validation?: Validation;
  map?: ControlMap;
}
export interface Trial { outcome: Outcome; landedAt: number; trace: V3[]; duration: number; end: V3 }
export interface Analysis {
  lv: Level; seed: number; level: number; skin: 'dough' | 'jelly'; edges: Edge[];
  tested: number; total: number; scanning: boolean; message: string; fingerprint: string;
  chain?: Chain;
}
export const makeLevel = (level: number, seed: number, skin: 'dough' | 'jelly', composition: 'parallel'|'convergent'|'offset'='parallel'): Analysis => {
  const lv = buildLevel(level, seed, composition);
  return { lv, level, seed, skin, edges: [], tested: 0, total: 0, scanning: false, fingerprint: fingerprint(lv), message: 'Level built. Discover transitions to inspect its affordances.' };
};

// ─── the player's units ─────────────────────────────────────────────────────────────────────────
/** The reference phone (portrait CSS px) the drag is measured on; the game's flick: power = (L − 14) / (0.3·min(w, h)). */
export const VIEW = { w: 402, h: 714 };
export const DEAD = 14;
export const PX_PER_POWER = 0.3 * Math.min(VIEW.w, VIEW.h);
export const dragLength = (power: number) => DEAD + power * PX_PER_POWER;
/** A control moved by (u, v) px of drag: u across the drag (at its length), v along it (longer = harder). */
export function offset(c: Control, u: number, v: number): Control {
  return { ...c, yaw: c.yaw + u / dragLength(c.power), power: Math.min(1, Math.max(0.02, c.power + v / PX_PER_POWER)) };
}
/** …and back: a control as px of drag from a centre. */
export function toPx(centre: Control, c: Control): [number, number] {
  let dy = c.yaw - centre.yaw;
  while (dy > Math.PI) dy -= 2 * Math.PI;
  while (dy < -Math.PI) dy += 2 * Math.PI;
  return [dy * dragLength(centre.power), (c.power - centre.power) * PX_PER_POWER];
}
/** Wilson 95% interval for k of n. */
export function wilson(k: number, n: number): [number, number] {
  if (!n) return [0, 1];
  const z = 1.96, p = k / n, d = 1 + z * z / n, c = (p + z * z / (2 * n)) / d, h = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d;
  return [Math.max(0, c - h), Math.min(1, c + h)];
}
/** small seeded random numbers, for repeatable noise */
function rng(seed: number) {
  let s = seed >>> 0 || 1;
  const u = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  return { u, normal: () => Math.sqrt(-2 * Math.log(u() || 1e-9)) * Math.cos(2 * Math.PI * u()) };
}

// ─── discovery ──────────────────────────────────────────────────────────────────────────────────
const distanceXZ = (a: V3, b: V3) => Math.hypot(a[0]-b[0], a[2]-b[2]);
const belongs = (lv: Level, index: number, hit: NonNullable<ReturnType<typeof path>['hit']>): boolean => {
  const tw = lv.towers[index];
  return (tw.land ?? tw.shapes).includes(hit.shape) && (tw.rail || tw.jar || hit.n[1] > .55) && onTop(tw, hit.p, -1);
};
/** a move that's more than one flick (a rail's shimmy, a climb, letting go of a jar): not mapped as one */
export const composite = (lv: Level, e: { from: number; to: number }) => {
  const a = lv.towers[e.from], b = lv.towers[e.to];
  return !!(a.rail || a.jar || b.wall || b.rail);
};
/** Cheap geometric filter, not a claim that the pair is impossible. */
export function candidatePairs(lv: Level): Array<[number, number]> {
  const out: Array<[number, number]> = [...(lv.ways ?? [])];
  const present=new Set(out.map(([i,j])=>i+':'+j));
  for (let i=0; i<lv.towers.length-1; i++) {
    const a=lv.towers[i];
    for (let j=i+1; j<Math.min(lv.towers.length,i+6); j++) {
      const b=lv.towers[j], dist=distanceXZ(a.at,b.at);
      if (dist < 125 && b.at[1]-a.at[1] < 82 && !present.has(i+':'+j)) {out.push([i,j]);present.add(i+':'+j);}
    }
  }
  return out;
}
/** A ballistic witness for from → to. The generator's own hop() is asked first for the moves it laid (it's the
 * only solver for rails, walls and jars), but a control is only reported if it was found for the place the
 * dumpling actually stands; otherwise the plain sweep. In the sweep, the middle of the widest run of landing
 * powers, not its end: the witness should have room either side.
 */
export function discover(lv: Level, from: number, to: number): Edge | null {
  const a=lv.towers[from], b=lv.towers[to], origin=standing(lv,from);
  const special = !!(b.wall || b.rail || a.rail || a.jar || b.land?.[0]?.lift || a.land?.[0]?.lift);
  if (special || to===from+1 || !!lv.ways?.some(([i,j])=>i===from&&j===to)) {
    const witness=hop(lv,from,to);
    if (witness) {
      const c=aim(lv,origin,to,witness.t);
      if (c) return {from,to,control:{yaw:c.yaw,power:c.power,spin:0,phase:witness.t},trajectory:witness.flights[0] ?? [],status:'predicted',method:'hop'};
      if (special) return {from,to,control:{yaw:Math.atan2(b.at[0]-origin[0],b.at[2]-origin[2]),power:.5,spin:0,phase:witness.t},trajectory:witness.flights[0] ?? [],status:'predicted',method:'hop'};
    }
    if (special) return null;
  }
  const theta=Math.atan2(b.at[0]-origin[0], b.at[2]-origin[2]);
  let best: {yaw:number;power:number;score:number;trajectory:V3[]} | null=null;
  for (const delta of [-.18,-.10,0,.10,.18]) {
    const yaw=theta+delta, good: Array<V3[] | null> = [];
    for (let pi=0;pi<=20;pi++) {
      const flight=path(lv,origin,launch(yaw,pi/20),2.4);
      good.push(flight.hit && flight.t>.06 && belongs(lv,to,flight.hit) ? flight.pts : null);
    }
    for (let i=0;i<good.length;) {
      if (!good[i]) { i++; continue; }
      let j=i; while (j+1<good.length && good[j+1]) j++;
      const mid=Math.round((i+j)/2), score=(j-i+1)+(delta===0?0.2:0);
      if (!best || score>best.score) best={yaw,power:mid/20,score,trajectory:good[mid]!};
      i=j+1;
    }
  }
  return best ? {from,to,control:{yaw:best.yaw,power:best.power,spin:0,phase:0},trajectory:best.trajectory,status:'predicted',method:'sample'} : null;
}

// ─── the real body ──────────────────────────────────────────────────────────────────────────────
function resetDynamics(lv:Level) {
  for(const s of lv.jellies ?? []) {
    if(!s.jel) continue;
    s.jel.z.fill(0);s.jel.w.fill(0);s.jel.t=-1;s.jel.held=0;s.jel.ride=undefined;s.jel.vin=undefined;
  }
  moveShapes(lv,0);
}
/** Real Dumpling.step at the game's fixed 1/60, from a body settled on the source for `settle` frames; each
 * trial is reset so mutable jelly/lid state can't leak between them. Ends: settled on a top (target or
 * other), below the kill line (a fall: the game puts you back on the top you left), at rest somewhere that
 * isn't a top, or still going after 3.5 s.
 */
export function simulate(lv:Level, from:number, to:number, control:Control, skin:'dough'|'jelly', record=true, settle=20):Trial {
  resetDynamics(lv);
  const body=new Dumpling(standing(lv,from,control.phase),skin);
  let t=control.phase;
  const dt=1/60;
  for(let i=0;i<settle;i++){body.step(lv,dt,t);t+=dt;}
  const origin=body.com;
  const trace:V3[]=record?[[...origin] as V3]:[];
  body.flick(launch(control.yaw,control.power),control.spin);
  let stable=0,still=0,last:Outcome='timeout',landedAt=-1;
  for(let i=0;i<210;i++){
    body.step(lv,dt,t);t+=dt;
    if(record && i%2===0)trace.push([...body.com] as V3);
    if(body.com[1]<lv.kill){last='fall';break;}
    const k=towerAt(lv,body.com,1);
    const quiet=body.contacts>0 && (body.moving<38 || body.onRail!==null) && body.sinceContact<.2;
    stable=quiet&&k>=0?stable+1:0;
    if(stable>=9 && i>=8){ last=k===to?'target':'other';landedAt=k;break; }
    still=quiet&&k<0&&body.moving<15?still+1:0;
    if(still>=30){ last='rest';break; }
  }
  const end=[...body.com] as V3;
  resetDynamics(lv);
  return {outcome:last,landedAt,trace,duration:t-control.phase,end};
}
/** where the dumpling would stand to flick this move from: the settled body, as the game has it */
export function settledAt(lv:Level, from:number, phase:number, skin:'dough'|'jelly'):V3 {
  resetDynamics(lv);
  const body=new Dumpling(standing(lv,from,phase),skin);
  let t=phase;
  for(let i=0;i<20;i++){body.step(lv,1/60,t);t+=1/60;}
  const at=[...body.com] as V3;
  resetDynamics(lv);
  return at;
}

/** Trials of a move as a player makes it: the aim, off by normally distributed drag error (σ px across and
 * along), each a real full-body flick; plus the aim itself after resting a different while. Confirmed when the
 * interval's low end is at least a half; failed when nothing landed; otherwise marginal.
 */
export function verify(a:Analysis,e:Edge,trials=12,sigma=4):Edge {
  if(composite(a.lv,e)){
    a.message='This transition is a multi-action rail/climb; ballistic witness only until composite verification is added.';
    return e;
  }
  const centre=e.map?.best ? {...e.control,yaw:e.map.best.yaw,power:e.map.best.power} : e.control;
  const r=rng(e.from*7919+e.to*104729+a.seed);
  const outcomes:Record<Outcome,number>={target:0,other:0,fall:0,rest:0,timeout:0};
  const traces:V3[][]=[];let last:Outcome='timeout',landedAt=-1;
  for(let i=0;i<trials;i++){
    const c=i===0?centre:offset(centre,r.normal()*sigma,r.normal()*sigma);
    const s=simulate(a.lv,e.from,e.to,c,a.skin,i<3);
    outcomes[s.outcome]++;if(i<3)traces.push(s.trace);last=s.outcome;landedAt=s.landedAt;
  }
  let held=0;const waits=[45,90,180];
  for(const w of waits)if(simulate(a.lv,e.from,e.to,{...centre,phase:centre.phase+w/60},a.skin,false,w).outcome==='target')held++;
  const iv=wilson(outcomes.target,trials);
  e.validation={outcomes,total:trials,traces,last,landedAt,rate:outcomes.target/trials,wilson:iv,sigma,timing:[held,waits.length]};
  e.status=iv[0]>=.5?'confirmed':outcomes.target===0?'failed':'marginal';
  return e;
}

// ─── what every nearby flick does ───────────────────────────────────────────────────────────────
export interface Cell { u: number; v: number; out: Outcome; at: number; ring: number; sampled: boolean }
export interface ControlMap {
  from: number; to: number; centre: Control; step: number; span: number; sigma: number;
  /** a lattice every `step` px across ±span: sampled on a coarse grid, then wherever neighbours disagree */
  cells: Cell[]; sims: number; ms: number;
  /** the aim with the best chance under σ px of drag error, that chance, and its other outcomes */
  best: { u: number; v: number; yaw: number; power: number; p: number; dest: Record<string, number> };
  /** chance at the witness itself */
  atWitness: number;
  /** the radius (px) round the best aim that all lands; `clipped` when it reaches the edge of what was mapped */
  tolerance: number; clipped: boolean; area: number;
  /** what the aim ring (where it's shown) would have said: of cells where it shows on the target, how many land; of landings, how many it showed */
  ring: { green: number; greenLand: number; land: number };
}
const key = (o: Outcome, at: number) => (o === 'other' ? 'top ' + at : o);
/** Map a move's neighbourhood in drag px with the real body. A generator: it yields after each flick so a page
 * can show progress; drain it in Node.
 */
export function* mapEdge(a: Analysis, e: Edge, o: { span?: number; coarse?: number; step?: number; sigma?: number } = {}): Generator<{ done: number; of: number }, ControlMap> {
  const span = o.span ?? 24, coarse = o.coarse ?? 8, step = o.step ?? 4, sigma = o.sigma ?? 4;
  const t0 = Date.now(), lv = a.lv, centre = e.control;
  const n = Math.round(span / step), side = 2 * n + 1, every = Math.round(coarse / step);
  const at = (i: number, j: number) => (j + n) * side + (i + n);
  const cells: Array<Cell | null> = new Array(side * side).fill(null);
  const origin = settledAt(lv, e.from, centre.phase, a.skin);
  let sims = 0;
  const run = (i: number, j: number) => {
    const c = offset(centre, i * step, j * step);
    const s = simulate(lv, e.from, e.to, c, a.skin, false);
    const pa = path(lv, origin, launch(c.yaw, c.power), 3, c.phase);
    cells[at(i, j)] = { u: i * step, v: j * step, out: s.outcome, at: s.landedAt, ring: pa.hit ? towerAt(lv, pa.hit.p, 0.5) : -1, sampled: true };
    sims++;
  };
  const coarseIdx: number[] = [];
  for (let k = -n; k <= n; k += every) coarseIdx.push(k);
  if (coarseIdx[coarseIdx.length - 1] !== n) coarseIdx.push(n);
  const total0 = coarseIdx.length ** 2;
  for (const j of coarseIdx) for (const i of coarseIdx) { run(i, j); yield { done: sims, of: total0 }; }
  // (refine: a lattice node is flicked when the coarse corners round it don't all agree)
  const near = (k: number) => { let lo = coarseIdx[0], hi = coarseIdx[coarseIdx.length - 1]; for (const c of coarseIdx) { if (c <= k) lo = c; if (c >= k) { hi = c; break; } } return [lo, hi]; };
  const todo: Array<[number, number]> = [];
  for (let j = -n; j <= n; j++) for (let i = -n; i <= n; i++) {
    if (cells[at(i, j)]) continue;
    const [i0, i1] = near(i), [j0, j1] = near(j);
    const corners = [cells[at(i0, j0)], cells[at(i1, j0)], cells[at(i0, j1)], cells[at(i1, j1)]].map((c) => key(c!.out, c!.at));
    if (corners.some((k) => k !== corners[0])) todo.push([i, j]);
    else { const c = cells[at(i0, j0)]!; cells[at(i, j)] = { u: i * step, v: j * step, out: c.out, at: c.at, ring: -2, sampled: false }; }
  }
  for (const [i, j] of todo) { run(i, j); yield { done: sims, of: total0 + todo.length }; }
  // (the ring where not flicked: it's cheap, so worked out everywhere)
  for (const c of cells as Cell[]) if (c.ring === -2) { const q = offset(centre, c.u, c.v), pa = path(lv, origin, launch(q.yaw, q.power), 3, q.phase); c.ring = pa.hit ? towerAt(lv, pa.hit.p, 0.5) : -1; }
  const all = cells as Cell[];
  // (the chance of each outcome round each node, under σ px of error; normalised over what was mapped)
  const w = (du: number, dv: number) => Math.exp(-(du * du + dv * dv) / (2 * sigma * sigma));
  const blur = (c: Cell) => {
    const out: Record<string, number> = {}; let W = 0;
    for (const d of all) { const k = w(d.u - c.u, d.v - c.v); if (k < 1e-3) continue; W += k; const s = key(d.out, d.at); out[s] = (out[s] ?? 0) + k; }
    for (const s in out) out[s] /= W;
    return out;
  };
  // (the best aim: away from the edge of the map where it can be, so the blur isn't guessing)
  const inner = all.filter((c) => Math.abs(c.u) <= span - sigma && Math.abs(c.v) <= span - sigma);
  let best = inner[0], bestD = blur(best);
  for (const c of inner) { const d = blur(c); const p = d.target ?? 0, bp = bestD.target ?? 0; if (p > bp + 1e-9 || (Math.abs(p - bp) < 1e-9 && Math.hypot(c.u, c.v) < Math.hypot(best.u, best.v))) { best = c; bestD = d; } }
  const atWitness = blur(all[at(0, 0)]).target ?? 0;
  let tolerance = 0, clipped = false;
  if (best.out === 'target') {
    for (let r = step; r <= 2 * span; r += step) {
      const ring = all.filter((c) => Math.hypot(c.u - best.u, c.v - best.v) <= r + 1e-6);
      if (ring.some((c) => c.out !== 'target')) break;
      tolerance = r;
      if (Math.abs(best.u) + r >= span || Math.abs(best.v) + r >= span) { clipped = true; break; }
    }
  }
  const area = all.filter((c) => c.out === 'target').length * step * step;
  const green = all.filter((c) => c.ring === e.to), land = all.filter((c) => c.out === 'target');
  const bc = offset(centre, best.u, best.v);
  return {
    from: e.from, to: e.to, centre, step, span, sigma, cells: all, sims, ms: Date.now() - t0,
    best: { u: best.u, v: best.v, yaw: bc.yaw, power: bc.power, p: bestD.target ?? 0, dest: bestD },
    atWitness, tolerance, clipped, area,
    ring: { green: green.length, greenLand: green.filter((c) => c.out === 'target').length, land: land.length },
  };
}
export function drain<T>(g: Generator<unknown, T>): T { for (;;) { const r = g.next(); if (r.done) return r.value; } }

// ─── the way home, priced ───────────────────────────────────────────────────────────────────────
export interface Chain {
  /** expected flicks home from each top, with the best move from each; Infinity where no mapped move gets on */
  flicks: number[]; splats: number[]; policy: number[];
  /** at every top with more than one mapped move: each move's expected flicks home */
  forks: Array<{ at: number; options: Array<{ to: number; flicks: number; p: number }> }>;
  assumption: string;
}
/** The level as a Markov chain: from each top, each mapped move's outcomes at its best aim under σ px. A fall
 * puts you back where you were (the game's rule); at rest off any top counts one more flick to get back on
 * (an assumption: not yet measured). Value iteration for the fewest expected flicks home.
 */
export function chain(lv: Level, maps: ControlMap[]): Chain {
  const N = lv.towers.length, home = N - 1;
  const moves = new Map<number, ControlMap[]>();
  for (const m of maps) moves.set(m.from, [...(moves.get(m.from) ?? []), m]);
  const V = new Array(N).fill(Infinity); V[home] = 0;
  const S = new Array(N).fill(0), pol = new Array(N).fill(-1);
  for (let it = 0; it < 400; it++) {
    let moved = 0;
    for (let i = 0; i < N; i++) {
      if (i === home) continue;
      for (const m of moves.get(i) ?? []) {
        // (a miss that leaves you where you were: x = 1 + p_stay·x + Σ p_j V_j, solved for x)
        const x = solveOne(m, V, i);
        if (x < V[i] - 1e-9) { V[i] = x; pol[i] = m.to; moved++; }
      }
    }
    if (!moved) break;
  }
  for (let it = 0; it < 400; it++) {
    for (let i = 0; i < N; i++) {
      const m = (moves.get(i) ?? []).find((m) => m.to === pol[i]);
      if (!m) continue;
      let stay = 0, s = 0;
      for (const [k, p] of Object.entries(m.best.dest)) {
        const to = k === 'target' ? m.to : k.startsWith('top ') ? Number(k.slice(4)) : i;
        if (k === 'fall') s += p;
        if (to === i) stay += p; else s += p * S[to];
      }
      S[i] = stay < 0.999 ? s / (1 - stay) : Infinity;
    }
  }
  const forks = [...moves].filter(([, ms]) => ms.length > 1).map(([at, ms]) => ({ at, options: ms.map((m) => ({ to: m.to, flicks: solveOne(m, V, at), p: m.best.p })).sort((x, y) => x.flicks - y.flicks) }));
  return { flicks: V, splats: S, policy: pol, forks, assumption: 'A fall puts you back on the top you left (the game); at rest off any top costs one more flick to get back (assumed, not yet measured). Each move at its best aim under the map\'s σ.' };
}
function solveOne(m: ControlMap, V: number[], i: number): number {
  let stay = 0, rest = 1;
  for (const [k, p] of Object.entries(m.best.dest)) {
    const to = k === 'target' ? m.to : k.startsWith('top ') ? Number(k.slice(4)) : i;
    if (to === i) { stay += p; if (k === 'rest' || k === 'timeout') rest += p; } else rest += p * V[to];
  }
  return stay < 0.999 ? rest / (1 - stay) : Infinity;
}

// ─── the graph ──────────────────────────────────────────────────────────────────────────────────
export function adjacency(a:Analysis):Map<number,number[]> {
  const g=new Map<number,number[]>();
  for(let i=0;i<a.lv.towers.length;i++)g.set(i,[]);
  for(const e of a.edges)if(e.status!=='failed')g.get(e.from)!.push(e.to);
  return g;
}
export function routeStats(a:Analysis) {
  const g=adjacency(a),last=a.lv.towers.length-1;
  const memo=new Map<number,number>();
  const count=(node:number):number=>{
    if(node===last)return 1;
    if(memo.has(node))return memo.get(node)!;
    let ways=0;
    for(const dest of g.get(node)??[])ways=Math.min(100000,ways+count(dest));
    memo.set(node,ways);return ways;
  };
  const ways=count(0);
  const reachable=new Set<number>([0]),todo=[0];
  while(todo.length){const i=todo.pop()!;for(const j of g.get(i)??[])if(!reachable.has(j)){reachable.add(j);todo.push(j);}}
  return {ways,reached:reachable.size,total:a.lv.towers.length,dead:[...reachable].filter(i=>i!==last && !(g.get(i)??[]).length),confirmed:a.edges.filter(e=>e.status==='confirmed').length,failed:a.edges.filter(e=>e.status==='failed').length,marginal:a.edges.filter(e=>e.status==='marginal').length,mapped:a.edges.filter(e=>e.map).length};
}

// ─── what was played ────────────────────────────────────────────────────────────────────────────
/** a flick the game logged (see squishy/flicklog.ts): read here from the same origin's storage */
export { readFlicks, type Flick } from '../squishy/flicklog';
export type { Shape };
