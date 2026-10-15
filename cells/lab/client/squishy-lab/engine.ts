/** Squishy Level Lab: the real game geometry and physics, without its renderer.
 * NO WebGL, shaders, canvas or duplicate collision model.
 * Discovery is a sampled ballistic witness; full validation is explicitly separate.
 */
import { buildLevel } from '../squishy/course';
import { Dumpling } from '../squishy/body';
import { launch, path, hop, aim, onTop, standing, towerAt, moveShapes,
  type Level, type V3, type Shape } from '../squishy/level';

export type Outcome = 'target' | 'other' | 'fall' | 'timeout';
export type EdgeStatus = 'predicted' | 'confirmed' | 'failed';
export interface Control { yaw: number; power: number; spin: number; phase: number }
export interface Edge {
  from: number; to: number; control: Control;
  trajectory: V3[]; status: EdgeStatus; method: 'hop' | 'sample';
  validation?: { outcomes: Record<Outcome, number>; total: number; traces: V3[][]; last: Outcome; landedAt: number };
}
export interface Trial { outcome: Outcome; landedAt: number; trace: V3[]; duration: number }
export interface Analysis {
  lv: Level; seed: number; level: number; skin: 'dough' | 'jelly'; edges: Edge[];
  tested: number; total: number; scanning: boolean; message: string;
}
export const makeLevel = (level: number, seed: number, skin: 'dough' | 'jelly', composition: 'parallel'|'convergent'|'offset'='parallel'): Analysis =>
  ({ lv: buildLevel(level, seed, composition), level, seed, skin, edges: [], tested: 0, total: 0, scanning: false, message: 'Level built. Discover transitions to inspect its affordances.' });

const distanceXZ = (a: V3, b: V3) => Math.hypot(a[0]-b[0], a[2]-b[2]);
const belongs = (lv: Level, index: number, hit: NonNullable<ReturnType<typeof path>['hit']>): boolean => {
  const tw = lv.towers[index];
  return (tw.land ?? tw.shapes).includes(hit.shape) && (tw.rail || tw.jar || hit.n[1] > .55) && onTop(tw, hit.p, -1);
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
/** Search multiple directions and powers, then pick a witness with some control margin.
 * Existing hop() is the authority for difficult rails, walls and the intended adjacent route.
 * These are still approximate ballistic predictions, not full-body proofs.
 */
export function discover(lv: Level, from: number, to: number): Edge | null {
  const a=lv.towers[from], b=lv.towers[to], origin=standing(lv,from);
  const special = !!(b.wall || b.rail || a.rail || a.jar || b.land?.[0]?.lift || a.land?.[0]?.lift);
  if (special || to===from+1 || !!lv.ways?.some(([i,j])=>i===from&&j===to)) {
    const witness=hop(lv,from,to);
    if (witness) {
      const c=aim(lv,origin,to,witness.t);
      const yaw=c?.yaw ?? Math.atan2(b.at[0]-origin[0],b.at[2]-origin[2]);
      const power=c?.power ?? .5;
      return {from,to,control:{yaw,power,spin:0,phase:witness.t},trajectory:witness.flights[0] ?? [],status:'predicted',method:'hop'};
    }
    if (special) return null;
  }
  const theta=Math.atan2(b.at[0]-origin[0], b.at[2]-origin[2]);
  let best: {yaw:number;power:number;score:number;trajectory:V3[]} | null=null;
  for (const delta of [-.18,-.10,0,.10,.18]) {
    const yaw=theta+delta;
    let run=0;
    for (let pi=0;pi<=20;pi++) {
      const power=pi/20, flight=path(lv,origin,launch(yaw,power),2.4);
      const good=!!flight.hit && flight.t>.06 && belongs(lv,to,flight.hit);
      if (good) {
        run++;
        const score=run + (delta===0?0.2:0) - Math.abs(power-.5)*.04;
        if (!best || score>best.score) best={yaw,power,score,trajectory:flight.pts};
      } else run=0;
    }
  }
  return best ? {from,to,control:{yaw:best.yaw,power:best.power,spin:0,phase:0},trajectory:best.trajectory,status:'predicted',method:'sample'} : null;
}
function resetDynamics(lv:Level) {
  for(const s of lv.jellies ?? []) {
    if(!s.jel) continue;
    s.jel.z.fill(0);s.jel.w.fill(0);s.jel.t=-1;s.jel.held=0;s.jel.ride=undefined;s.jel.vin=undefined;
  }
  moveShapes(lv,0);
}
/** Real Dumpling.step simulation; each trial is reset so the mutable jelly/lid
 * state from previous trajectories cannot pollute subsequent measurements.
 */
export function simulate(lv:Level, from:number, to:number, control:Control, skin:'dough'|'jelly', record=true):Trial {
  resetDynamics(lv);
  const body=new Dumpling(standing(lv,from,control.phase),skin);
  let t=control.phase;
  const dt=1/60;
  // settle on the source before firing: a fresh placed body is not always at equilibrium
  for(let i=0;i<20;i++){body.step(lv,dt,t);t+=dt;}
  const origin=body.com;
  const trace:V3[]=record?[[...origin] as V3]:[];
  body.flick(launch(control.yaw,control.power),control.spin);
  let stable=0,last:Outcome='timeout',landedAt=-1;
  for(let i=0;i<210;i++){
    body.step(lv,dt,t);t+=dt;
    if(record && i%2===0)trace.push([...body.com] as V3);
    if(body.com[1]<lv.kill){last='fall';break;}
    const k=towerAt(lv,body.com,1);
    const quiet=k>=0 && body.contacts>0 && (body.moving<38 || body.onRail!==null) && body.sinceContact<.2;
    stable=quiet?stable+1:0;
    if(stable>=9 && i>=8){
      last=k===to?'target':'other';landedAt=k;break;
    }
  }
  resetDynamics(lv);
  return {outcome:last,landedAt,trace,duration:t-control.phase};
}
export function verify(a:Analysis,e:Edge,variations=3):Edge {
  const controls:Control[]= [{...e.control}];
  if(variations>=3) {
    controls.push({...e.control,yaw:e.control.yaw-.024,power:Math.max(0,e.control.power-.025)});
    controls.push({...e.control,yaw:e.control.yaw+.024,power:Math.min(1,e.control.power+.025)});
  }
  if(variations>=5) {
    controls.push({...e.control,yaw:e.control.yaw-.045});
    controls.push({...e.control,yaw:e.control.yaw+.045});
  }
  // A rail/wall hop may need a composite, not a single launch: report as unverified
  // rather than falsely claiming the special-case witness was physically validated.
  const aTower=a.lv.towers[e.from],bTower=a.lv.towers[e.to];
  if(aTower.rail||aTower.jar||bTower.wall||bTower.rail){
    a.message='This transition is a multi-action rail/climb; ballistic witness only until composite verification is added.';
    return e;
  }
  const outcomes:Record<Outcome,number>={target:0,other:0,fall:0,timeout:0};
  const traces:V3[][]=[];let last:Outcome='timeout',landedAt=-1;
  for(const c of controls) {
    const r=simulate(a.lv,e.from,e.to,c,a.skin);
    outcomes[r.outcome]++;traces.push(r.trace);last=r.outcome;landedAt=r.landedAt;
  }
  e.validation={outcomes,total:controls.length,traces,last,landedAt};
  e.status=outcomes.target>0?'confirmed':'failed';
  return e;
}
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
  return {ways,reached:reachable.size,total:a.lv.towers.length,dead:[...reachable].filter(i=>i!==last && !(g.get(i)??[]).length),confirmed:a.edges.filter(e=>e.status==='confirmed').length,failed:a.edges.filter(e=>e.status==='failed').length};
}
