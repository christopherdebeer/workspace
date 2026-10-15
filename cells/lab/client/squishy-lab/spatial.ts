/** Squishy spatial case study.
 * Source: actual generated colliders, fork graph, game camera construction and
 * collision contact tests. Geometry-based visibility, not a model of attention.
 * Kept renderer-independent; usable by browser Level Lab and Node Lambda.
 */
import { buildLevel } from '../squishy/course';
import { touch, type Level, type Tower, type V3, type Shape, type Hit } from '../squishy/level';
export type Composition='parallel'|'convergent'|'offset';
export const COMPOSITIONS: Composition[]=['parallel','convergent','offset'];
export interface Visibility { target:number; angularX:number; angularY:number; inFrustum:boolean; clear:number; samples:number; blockers:string[] }
export interface ForkStudy {
  at:number; choices:number[]; merge:number; branches:number[][]; routeNames:string[][];
  camera:{eye:V3;look:V3;yaw:number;pitch:number;distance:number};
  visibility:Visibility[]; gapCm:number; forkAngleDeg:number;
  xzLength:number[]; climbCm:number[]; routeCount:number; source:V3; afterSafe:Visibility[]; turnDeg:number[];
}
export interface SpatialStudy { level:number; seed:number; composition:Composition; shapeCount:number; stopCount:number; inventory:string[]; ways:Array<[number,number]>;
  stops:Array<{at:V3;top:string;r:number}>;
  chapter:string; made:Level['made']; forks:ForkStudy[]; warnings:string[] }
const add=(a:V3,b:V3):V3=>[a[0]+b[0],a[1]+b[1],a[2]+b[2]];
const sub=(a:V3,b:V3):V3=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]];
const mul=(a:V3,v:number):V3=>[a[0]*v,a[1]*v,a[2]*v];
const dot=(a:V3,b:V3)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const norm=(a:V3):V3=>{const L=Math.hypot(...a)||1;return mul(a,1/L)};
const cross=(a:V3,b:V3):V3=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const dist=(a:V3,b:V3)=>Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2]);
const dXZ=(a:V3,b:V3)=>Math.hypot(a[0]-b[0],a[2]-b[2]);
const deg=(n:number)=>n*180/Math.PI;
const adj=(lv:Level)=>{
 const g=new Map<number,number[]>();
 for(let i=0;i<lv.towers.length;i++)g.set(i,[]);
 for(const [i,j] of lv.ways??lv.towers.slice(1).map((_,k):[number,number]=>[k,k+1]))g.get(i)?.push(j);
 return g;
};
const walk=(g:Map<number,number[]>,from:number,to:number):number[]=>{
 const seen=new Set<number>([from]),queue:number[][]=[[from]];
 while(queue.length){const p=queue.shift()!,n=p[p.length-1];if(n===to)return p;
 for(const next of g.get(n)??[])if(!seen.has(next)){seen.add(next);queue.push([...p,next]);}}
 return [];
};
const descendants=(g:Map<number,number[]>,n:number)=>{
 const out=new Set<number>([n]),todo=[n];
 while(todo.length)for(const v of g.get(todo.pop()!)??[])if(!out.has(v)){out.add(v);todo.push(v);}
 return out;
};
/** Approximate camera pose adapted directly from main.ts settled camera: wallYaw, pitch,
 * look-ahead 0.5, distance=clamp(34+sep*.95,44,120). Not a replay of its smoothing,
 * user-controlled orbit, boom collision or viewport-specific movement. */
export function cameraAt(lv:Level,index:number,next:number){
 const a=lv.towers[index].at,b=lv.towers[next].at;
 const d=dXZ(a,b),yaw=lv.walls?.length?Math.atan2(.62*Math.sign(b[0]-a[0]||1),.78):Math.atan2(b[0]-a[0],b[2]-a[2]);
 const pitch=lv.walls?.length?.56:.48;
 const distCam=Math.max(44,Math.min(120,34+.95*d));
 const at=add(add(a,[0,3,0]),mul(sub(b,a),.5*Math.min(1,110/Math.max(1,d))));
 const backwards:V3=[-Math.sin(yaw)*Math.cos(pitch),Math.sin(pitch),-Math.cos(yaw)*Math.cos(pitch)];
 const eye=add(at,mul(backwards,distCam));
 return {eye,look:at,yaw,pitch,distance:distCam};
}
function segmentBlock(lv:Level,eye:V3,at:V3,exclude:Set<Shape>):string[] {
 const dir=sub(at,eye),L=dist(eye,at);
 if(L<.001)return [];
 const N=Math.min(165,Math.ceil(L/1.5));
 const hit:Hit={nx:0,ny:0,nz:0,d:0,vx:0,vy:0,vz:0};
 const blockers=new Set<string>();
 for(const s of lv.shapes) {
  if(exclude.has(s)||s===lv.shapes[0])continue;
  // Broad-phase ray/AABB; conservative, then narrow-phase shared 'touch'.
  let low=0,hi=1;
  for(let axis=0;axis<3;axis++){
   const v=dir[axis],e=eye[axis];
   if(Math.abs(v)<1e-8){if(e<s.lo[axis]-.2||e>s.hi[axis]+.2){low=2;break;}continue;}
   const u=(s.lo[axis]-.2-e)/v,w=(s.hi[axis]+.2-e)/v;
   low=Math.max(low,Math.min(u,w));hi=Math.min(hi,Math.max(u,w));
  }
  if(low>hi||low>=.985)continue;
  const start=Math.max(0,Math.floor(low*N)),end=Math.min(N-1,Math.ceil(hi*N));
  for(let k=start;k<=end;k++){
   const t=k/N;
   if(t<.02)continue;
   const q=add(eye,mul(dir,t));
   if(touch(s,q[0],q[1],q[2],.2,hit)&&hit.d>0){blockers.add(String(s.kind)+':'+String(s.mat));break;}
  }
 }
 return [...blockers];
}
export function visibility(lv:Level,eye:V3,look:V3,index:number):Visibility {
 const tw=lv.towers[index];
 const forward=norm(sub(look,eye)),right=norm(cross(forward,[0,1,0])),up=norm(cross(right,forward));
 const spread=Math.min(6,Math.max(2,tw.r*.5));
 const test:V3[]=[tw.at,add(tw.at,[spread,0,0]),add(tw.at,[-spread,0,0]),add(tw.at,[0,0,spread]),add(tw.at,[0,0,-spread])];
 const exclude=new Set(tw.shapes);
 // Include the source under the camera if it is between eye and target; actual camera might differ.
 const blockers=new Set<string>();let clear=0,within=0;
 let ax=0,ay=0;
 for(const q of test) {
  const d=norm(sub(q,eye)),z=dot(d,forward);
  if(z<=.01)continue;
  const x=Math.atan2(dot(d,right),z),y=Math.atan2(dot(d,up),z);
  ax+=x;ay+=y;
  // approximate mobile viewport 402x714, vertical half-angle .45.
  if(Math.abs(x)>Math.atan(Math.tan(.45)*402/714)||Math.abs(y)>.45)continue;
  within++;
  const occluded=segmentBlock(lv,eye,q,exclude);
  if(!occluded.length)clear++;
  occluded.forEach(b=>blockers.add(b));
 }
 return {target:index,angularX:deg(ax/5),angularY:deg(ay/5),inFrustum:within>0,clear,samples:5,blockers:[...blockers].slice(0,5)};
}
export function assess(lv:Level,level:number,seed:number,composition:Composition): SpatialStudy {
 const g=adj(lv),forks:ForkStudy[]=[],warn:string[]=[];
 for(const [F,choices] of g){
  if(choices.length<2)continue;
  const desc=choices.map(c=>descendants(g,c));
  const common=[...desc[0]].filter(v=>desc.every(s=>s.has(v))&&v>Math.max(...choices)).sort((a,b)=>a-b);
  if(!common.length){warn.push('No found merge after fork '+F);continue;}
  const M=common[0],paths=choices.map(c=>[F,...walk(g,c,M)]);
  if(paths.some(p=>p.length<3)){warn.push('Incomplete branch at '+F);continue;}
  const from=lv.towers[F].at;
  const cam=cameraAt(lv,F,choices[0]);
  const targets=[...new Set([...choices,M])];
  const v=targets.map(k=>visibility(lv,cam.eye,cam.look,k));
  const gapCm=dXZ(lv.towers[choices[0]].at,lv.towers[choices[1]].at);
  const ux=norm(sub(lv.towers[choices[0]].at,from)),vx=norm(sub(lv.towers[choices[1]].at,from));
  const forkAngleDeg=deg(Math.acos(Math.max(-1,Math.min(1,dot(ux,vx)))));
  const xzLength=paths.map(p=>p.slice(1).reduce((sum,k,i)=>sum+dXZ(lv.towers[p[i]].at,lv.towers[k].at),0));
  const climbCm=paths.map(p=>p.slice(1).reduce((sum,k,i)=>sum+Math.max(0,lv.towers[k].at[1]-lv.towers[p[i]].at[1]),0));
  const afterSafe=paths[0].length>2?paths[0].slice(2,4).map(k=>visibility(lv,cameraAt(lv,paths[0][1],paths[0][2]).eye,cameraAt(lv,paths[0][1],paths[0][2]).look,k)):[];
  const turnDeg=paths.map(path=>path.slice(1,-1).reduce((sum,k,i)=>{const a=lv.towers[path[i]].at,b=lv.towers[k].at,c=lv.towers[path[i+2]].at;const u=norm(sub(b,a)),v=norm(sub(c,b));return sum+deg(Math.acos(Math.max(-1,Math.min(1,dot(u,v)))));},0));
  forks.push({at:F,choices:[...choices],merge:M,branches:paths,routeNames:paths.map(path=>path.map(k=>lv.towers[k].top)),camera:cam,visibility:v,gapCm,forkAngleDeg,xzLength,climbCm,turnDeg,afterSafe,routeCount:paths.length,source:from});
 }
 if(!forks.length)warn.push('This seed contains no genuine fork; variants cannot be compared as route-choice encounters.');
 return {level,seed,composition,shapeCount:lv.shapes.length,stopCount:lv.towers.length,chapter:lv.chapter,made:lv.made,
  inventory:lv.towers.map(t=>t.top).sort(),stops:lv.towers.map(t=>({at:[...t.at] as V3,top:t.top,r:t.r})),ways:lv.ways??[],forks,warnings:warn};
}
export function studyOne(level:number,seed:number,composition:Composition='parallel'):SpatialStudy {
 return assess(buildLevel(level,seed,composition),level,seed,composition);
}
export function studyVariants(level:number,seed:number):SpatialStudy[] {
 return COMPOSITIONS.map(c=>studyOne(level,seed,c));
}
