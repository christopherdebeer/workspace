/** Reproduce and quantify dough elongation while touching a jar's sticky strip.
 * Headless: physics from the game, no renderer and no second dynamics model.
 * The metric is the maximum particle distance from the physical centre,
 * expressed as multiples of the rest body's maximum extent.
 */
import { bench } from '../squishy/course';
import { Dumpling } from '../squishy/body';
import { MAT, RADIUS, type V3 } from '../squishy/level';

export function jarStrainProbe(mode:'hang'|'glance'='hang',frames?:number,strain=true) {
  const lv=bench('look');
  const jar=lv.shapes.find(s=>s.mat===MAT.glass);
  const strip=lv.shapes.find(s=>s.mat===MAT.honey && s.ghost);
  if(!jar || !strip)return {error:'bench jar or honey contact strip missing'};
  const dx=strip.c[0]-jar.c[0], dz=strip.c[2]-jar.c[2], len=Math.hypot(dx,dz)||1;
  const n:V3=[dx/len,0,dz/len];
  const centre:V3=[strip.c[0]+n[0]*(RADIUS*.7),strip.c[1]+(mode==='hang'?0:4),strip.c[2]+n[2]*(RADIUS*.7)];
  const dumpling=new Dumpling(centre,'dough');dumpling.localStrainEnabled=strain;
  const restR=Math.max(...Array.from({length:dumpling.n},(_,i)=>Math.hypot(dumpling.x[3*i]-centre[0],dumpling.x[3*i+1]-centre[1],dumpling.x[3*i+2]-centre[2])));
  const unique=new Map<string,[number,number,number]>();
  for(let k=0;k<dumpling.tris.length;k+=3){
    const a=dumpling.tris[k],b=dumpling.tris[k+1],c=dumpling.tris[k+2];
    for(const [u,v] of [[a,b],[b,c],[c,a]]){
      const i=Math.min(u,v),j=Math.max(u,v),key=i+':'+j;
      if(unique.has(key))continue;
      const d=Math.hypot(dumpling.x[i*3]-dumpling.x[j*3],dumpling.x[i*3+1]-dumpling.x[j*3+1],dumpling.x[i*3+2]-dumpling.x[j*3+2]);
      if(d>.00001)unique.set(key,[i,j,d]);
    }
  }
  const edges=[...unique.values()];
  const steps=Math.max(1,Math.min(140,frames??(mode==='hang'?140:100))), trace: Array<{t:number,stretch:number,edgeStretch:number,pinned:number,deform:number,com:V3,volume:number}>=[];
  if(mode==='glance')dumpling.flick([-n[0]*48,100,-n[2]*48],0);
  let peak=0,peakT=0,nonfinite=0,edgePeak=0,edgePeakT=0;
  for(let i=0;i<steps;i++){
    dumpling.step(lv,1/60,i/60);
    let r=0;
    for(let k=0;k<dumpling.n;k++){
      const d=Math.hypot(dumpling.x[k*3]-dumpling.com[0],dumpling.x[k*3+1]-dumpling.com[1],dumpling.x[k*3+2]-dumpling.com[2]);
      if(!Number.isFinite(d))nonfinite++;
      r=Math.max(r,d);
    }
    const stretch=r/restR;if(stretch>peak){peak=stretch;peakT=i/60;}
    let local=0;
    for(const [a,b,d0] of edges){
      const ratio=Math.hypot(dumpling.x[3*a]-dumpling.x[3*b],dumpling.x[3*a+1]-dumpling.x[3*b+1],dumpling.x[3*a+2]-dumpling.x[3*b+2])/d0;
      if(ratio>local)local=ratio;
    }
    if(local>edgePeak){edgePeak=local;edgePeakT=i/60;}
    if(i%10===0 || i===steps-1)trace.push({t:+(i/60).toFixed(3),stretch:+stretch.toFixed(3),edgeStretch:+local.toFixed(3),pinned:dumpling.pinned,deform:+dumpling.deform.toFixed(3),com:dumpling.com.map(x=>+x.toFixed(2)) as V3,volume:+dumpling.volume().toFixed(2)});
  }
  return {mode,strain,restR,edges:edges.length,peak:+peak.toFixed(3),peakT:+peakT.toFixed(3),edgePeak:+edgePeak.toFixed(3),edgePeakT:+edgePeakT.toFixed(3),nonfinite,trace};
}
