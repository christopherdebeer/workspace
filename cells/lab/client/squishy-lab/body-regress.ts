/** Deterministic non-adhesive regression specimens. Reuse Squishy's actual
 * generator, collision geometry, particles and Dumpling.step() integration.
 */
import { bench } from '../squishy/course';
import { Dumpling } from '../squishy/body';
import { RADIUS, type V3 } from '../squishy/level';

export function bodyRegression(which:'edge'|'free',frames=40,strain=true,kind:'dough'|'jelly'='dough'){
  const lv=bench(which==='edge'?'coats':'look');
  const plate=lv.towers.find(t=>t.top==='plate');
  if(which==='edge'&&!plate)return {error:'plate bench missing'};
  const at:V3=which==='edge'
    ? [plate!.at[0]+plate!.r-1.1,plate!.at[1]+RADIUS*.72,plate!.at[2]]
    : [0,19.5,0];
  const d=new Dumpling(at,kind);d.localStrainEnabled=strain;
  const edgeMap=new Map<number,[number,number,number]>();
  for(let k=0;k<d.tris.length;k+=3){
    const a=d.tris[k],b=d.tris[k+1],c=d.tris[k+2];
    for(const [u,v] of [[a,b],[b,c],[c,a]]){
      const i=Math.min(u,v),j=Math.max(u,v),id=i*d.n+j;
      if(edgeMap.has(id))continue;
      const rest=Math.hypot(d.x[3*i]-d.x[3*j],d.x[3*i+1]-d.x[3*j+1],d.x[3*i+2]-d.x[3*j+2]);
      if(rest>1e-5)edgeMap.set(id,[i,j,rest]);
    }
  }
  const edges=[...edgeMap.values()],volume0=d.volume(),trace=[];
  if(which==='edge')d.flick([65,28,0],0);
  else d.flick([75,120,12],0);
  const started=Date.now();let maxEdge=0,invalid=0,minVol=Infinity,maxVol=0,peakContacts=0;
  for(let f=0;f<frames;f++){
    d.step(lv,1/60,f/60);
    const ratios=edges.map(([i,j,rest])=>Math.hypot(d.x[i*3]-d.x[j*3],d.x[i*3+1]-d.x[j*3+1],d.x[i*3+2]-d.x[j*3+2])/rest).sort((a,b)=>a-b);
    const worst=ratios[ratios.length-1],p95=ratios[Math.floor(ratios.length*.95)];
    maxEdge=Math.max(maxEdge,worst);
    for(const x of d.x)if(!Number.isFinite(x))invalid++;
    const volume=d.volume()/volume0;minVol=Math.min(minVol,volume);maxVol=Math.max(maxVol,volume);
    peakContacts=Math.max(peakContacts,d.contacts);
    if(f%5===0||f===frames-1)trace.push({t:+(f/60).toFixed(3),worst:+worst.toFixed(3),p95:+p95.toFixed(3),contacts:d.contacts,pins:d.pinned,volume:+volume.toFixed(3),com:d.com.map(x=>+x.toFixed(2))});
  }
  return {which,frames,strain,kind,elapsedMs:Date.now()-started,maxEdge:+maxEdge.toFixed(3),peakContacts,minVol:+minVol.toFixed(3),maxVol:+maxVol.toFixed(3),invalid,trace};
}
