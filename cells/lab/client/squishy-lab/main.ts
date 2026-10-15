/** Squishy Level Lab — SVG-only sibling experiment.
 * Imports the game's actual generator and simulation core; never initialises WebGL.
 */
import { candidatePairs, chain, composite, discover, makeLevel, mapEdge, readFlicks, routeStats, toPx, verify, type Analysis, type ControlMap, type Edge, type Flick } from './engine';
import { type V3, type Tower, type Shape } from '../squishy/level';
import { studyOne, assess, COMPOSITIONS, type SpatialStudy, type Composition } from './spatial';

const $ = (id:string) => document.getElementById(id)!;
const params=new URLSearchParams(location.search);
const preview=params.has('preview');
let level=Math.max(1,Math.min(80,Number(params.get('level'))||3));
let seed=Math.max(0,Math.floor(Number(params.get('seed'))||0));
let skin: 'dough'|'jelly'=params.get('skin')==='jelly'?'jelly':'dough';
let a:Analysis;
let view:'plan'|'elevation'|'graph'='plan';
let selectedNode=0;
let selectedEdge=-1;
let scanToken=0;
let animation=0;
let sigma=Math.max(1,Math.min(20,Number(params.get('sigma'))||4));
const pinned=params.get('fp');
let flicks:Flick[]=[];
const W=1120,H=530,M=58;
const esc=(v:unknown)=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const f=(n:number)=>Math.round(n*100)/100;
const colour=(top:string)=>top==='goal'?'#b18a48':top==='jelly'||top==='pudding'?'#b86d87':top==='rack'||top==='drainer'?'#759698':top==='honey'?'#b17c4b':top==='sill'||top==='shelf'?'#8b9a8c':top==='pad'?'#83a597':'#a58b71';
const tint=(e:Edge)=>e.status==='confirmed'?'#3e8065':e.status==='failed'?'#b45c5c':e.status==='marginal'?'#c0763f':'#bf9258';
const pc=(n:number)=>Math.round(n*100)+'%';
const OUT:Record<string,string>={target:'#3e8065',fall:'#b45c5c',rest:'#c9a24a',timeout:'#9a958a'};
const outColour=(k:string)=>OUT[k]??'#6f8fb3';
const target=(t:Tower)=>t.top==='goal'?'home':t.top;
// Single-seed spatial composition: shared geometry, visibility, route morphology.
type Variant=Composition;
let composition:Variant=COMPOSITIONS.includes(params.get('composition') as Variant)?params.get('composition') as Variant:'parallel';
const studyEnabled=params.has('study');let studies:SpatialStudy[]=[];let studyToken=0;
function smallPlan(s:SpatialStudy){
 const ps=studies.flatMap(z=>z.stops.map(t=>t.at));
 const x0=Math.min(...ps.map(v=>v[0]))-20,x1=Math.max(...ps.map(v=>v[0]))+20,z0=Math.min(...ps.map(v=>v[2]))-15,z1=Math.max(...ps.map(v=>v[2]))+15;
 const xy=(p:V3):[number,number]=>[12+296*(p[0]-x0)/(x1-x0||1),113-95*(p[2]-z0)/(z1-z0||1)];
 const F=s.forks[0],paths=s.ways.map(([i,j])=>{const a=xy(s.stops[i].at),b=xy(s.stops[j].at);const alt=F?.branches[1]?.some((v,k,q)=>k>0&&q[k-1]===i&&v===j);return '<path d="M'+a.map(f).join(' ')+' L'+b.map(f).join(' ')+'" stroke="'+(alt?'#bb925f':'#61917a')+'" stroke-width="2.3" fill="none"/>';}).join('');
 const dots=s.stops.map((t,i)=>{const [x,y]=xy(t.at);return '<circle cx="'+f(x)+'" cy="'+f(y)+'" r="'+(i===F?.at?6:4)+'" fill="'+(i===s.stops.length-1?'#bc9949':'#9e8970')+'" stroke="#fff" stroke-width="1"><title>'+i+' '+esc(t.top)+'</title></circle>';}).join('');
 return '<svg viewBox="0 0 320 125" aria-label="Common-scale physical plan"><rect width="320" height="125" fill="#fcfaf4"/>'+paths+dots+'</svg>';
}
function viewStudy(){
 const box=$('composition-panel');box.hidden=!studyEnabled;if(!studyEnabled)return;
 const base=studies.find(q=>q.composition==='parallel');
 box.innerHTML='<h2>Spatial composition · one generated encounter</h2><p class="study-note">Three generator constraints, identical level and seed. Solid lines: generator-checked jumps. Green: safe branch; ochre: alternative. The mini-plans use a common spatial scale.</p><div class="study-cards">'+COMPOSITIONS.map(c=>{
   const s=studies.find(q=>q.composition===c);if(!s)return '<article class="study-card"><h3>'+c+'</h3><p>Measuring…</p></article>';
   const F=s.forks[0];const controlled=!!base&&!!F&&JSON.stringify(s.stops.map(t=>t.top))===JSON.stringify(base.stops.map(t=>t.top))&&JSON.stringify(s.ways)===JSON.stringify(base.ways);
   return '<article class="study-card'+(c===composition?' selected':'')+'"><h3>'+c+'</h3><small>'+(F?(controlled?'Same stops and topology':'Comparison confounded'):'No fork retained')+'</small>'+smallPlan(s)+
   (F?'<dl><dt>Fork / merge</dt><dd>'+F.at+' → '+F.choices.join(' / ')+' → '+F.merge+'</dd><dt>Opening angle</dt><dd>'+f(F.forkAngleDeg)+'°</dd><dt>Branch separation</dt><dd>'+f(F.gapCm)+' cm</dd><dt>Path lengths</dt><dd>'+F.xzLength.map(f).join(' / ')+' cm</dd><dt>Accumulated turning</dt><dd>'+F.turnDeg.map(f).join(' / ')+'°</dd><dt>Camera choice visibility</dt><dd>'+F.visibility.slice(0,2).map(v=>v.clear+'/5').join(' / ')+'</dd><dt>Safe follow-on visibility</dt><dd>'+F.afterSafe.map(v=>v.clear+'/5').join(' / ')+'</dd></dl>':'<p>Fork placement failed feasibility; this is a different encounter.</p>')+
   '<button data-composition="'+c+'" '+(c===composition?'disabled':'')+'>Inspect this composition</button></article>';
 }).join('')+'</div><p class="study-note">Visibility counts five sampled target points in an approximate default mobile camera frustum, ray-tested against the game’s actual collision geometry. It is not measured player attention or a replay of camera smoothing. Generator hop checks establish ballistic witnesses, not robust soft-body or human success. Confounded variants cannot be used as controlled evidence of spatial quality.</p>';
}
async function computeStudy(){
 if(!studyEnabled)return;const id=++studyToken;studies=[];viewStudy();
 for(const c of COMPOSITIONS){if(id!==studyToken)return;await new Promise<void>(r=>setTimeout(r,0));try{studies.push(c===composition?assess(a.lv,level,seed,c):studyOne(level,seed,c));}catch(e){$('status').textContent='Spatial study '+c+': '+String(e);}viewStudy();}
}

function projection() {
  const ts=a.lv.towers;
  const xyz=ts.map(t=>t.at);
  const ranges=[0,1,2].map(i=>[Math.min(...xyz.map(p=>p[i])),Math.max(...xyz.map(p=>p[i]))]);
  const x0=ranges[0][0]-25,x1=ranges[0][1]+25;
  const vAxis=view==='elevation'?1:2;
  const v0=view==='graph' ? 0 : ranges[vAxis][0]-(view==='elevation'?20:25);
  const v1=view==='graph' ? 1 : ranges[vAxis][1]+(view==='elevation'?25:25);
  const px=(x:number)=>M+(x-x0)*(W-2*M)/(x1-x0||1);
  const py=(v:number)=>H-M-(v-v0)*(H-2*M)/(v1-v0||1);
  const p=(v:V3):[number,number]=>[px(v[0]), view==='graph'?H/2+(v[2]-ranges[2][0])/(ranges[2][1]-ranges[2][0]||1)*130-65:py(v[vAxis])];
  return {p,px,py};
}
const line=(pts:[number,number][],max=64)=> {
  if(!pts.length)return '';
  const stride=Math.max(1,Math.ceil(pts.length/max));
  const filtered=pts.filter((_,i)=>i%stride===0||i===pts.length-1);
  return filtered.map((q,i)=>(i?'L':'M')+f(q[0])+' '+f(q[1])).join(' ');
};
const outline=(t:Tower,p:(v:V3)=>[number,number]):string=>{
  const at=t.at, col=colour(t.top);
  if(view==='graph')return '';
  if(view==='elevation') {
    const xy=p(at);const w=Math.max(10,Math.min(46,(t.r||10)*1.7));
    return '<rect x="'+f(xy[0]-w/2)+'" y="'+f(xy[1]+11)+'" width="'+f(w)+'" height="5" rx="2" fill="'+col+'" fill-opacity=".34"/>';
  }
  if(t.box) {
    const c=Math.cos(t.yaw),s=Math.sin(t.yaw),hx=t.box[0],hz=t.box[1];
    const pts=([[-hx,-hz],[hx,-hz],[hx,hz],[-hx,hz]] as [number,number][]).map(([x,z])=>p([at[0]+c*x+s*z,at[1],at[2]-s*x+c*z]));
    return '<polygon points="'+pts.map(v=>v.map(f).join(',')).join(' ')+'" fill="'+col+'" fill-opacity=".30" stroke="'+col+'" stroke-width="1.6"/>';
  }
  const [cx,cz]=p(at),[rx]=p([at[0]+t.r,at[1],at[2]]),[,rz]=p([at[0],at[1],at[2]+t.r]);
  return '<ellipse cx="'+f(cx)+'" cy="'+f(cz)+'" rx="'+f(Math.abs(rx-cx))+'" ry="'+f(Math.abs(rz-cz))+'" fill="'+col+'" fill-opacity=".28" stroke="'+col+'" stroke-width="1.6"/>';
};
/** Outline shared collision shapes in schematic space, not visual mesh decoration. */
function physicalOutline(s:Shape,p:(v:V3)=>[number,number]):string {
  if(view==='graph')return '';
  if(view==='elevation'){
    const lo=p(s.lo),hi=p(s.hi);
    const x=Math.min(lo[0],hi[0]),y=Math.min(lo[1],hi[1]),w=Math.abs(hi[0]-lo[0]),h=Math.abs(hi[1]-lo[1]);
    if(w<1||h<1)return '';
    return '<rect x="'+f(x)+'" y="'+f(y)+'" width="'+f(w)+'" height="'+f(h)+'" fill="none" stroke="#897a67" stroke-width="1"/>';
  }
  if(s.kind==='cap'){
    const a=p(s.c),b=p(s.b);
    return '<path d="M'+a.map(f).join(' ')+' L'+b.map(f).join(' ')+'" stroke="#897a67" stroke-width="2" fill="none"/>';
  }
  if(s.kind==='box'){
    const c=Math.cos(s.yaw),sn=Math.sin(s.yaw),hx=s.h[0],hz=s.h[2];
    const q=([[-hx,-hz],[hx,-hz],[hx,hz],[-hx,hz]] as [number,number][]).map(([x,z])=>p([s.c[0]+c*x+sn*z,s.c[1],s.c[2]-sn*x+c*z]));
    return '<polygon points="'+q.map(v=>v.map(f).join(',')).join(' ')+'" fill="none" stroke="#897a67" stroke-width="1"/>';
  }
  if(s.kind==='cyl'||s.kind==='jelly'){
    const c=p(s.c),x=p([s.c[0]+s.r,s.c[1],s.c[2]]),z=p([s.c[0],s.c[1],s.c[2]+s.r]);
    return '<ellipse cx="'+f(c[0])+'" cy="'+f(c[1])+'" rx="'+f(Math.abs(x[0]-c[0]))+'" ry="'+f(Math.abs(z[1]-c[1]))+'" fill="none" stroke="#897a67" stroke-width="1"/>';
  }
  // An intricate cloth / spoon sheet: its real collision AABB as a faint bounded footprint.
  const aa=p(s.lo),bb=p(s.hi),x=Math.min(aa[0],bb[0]),y=Math.min(aa[1],bb[1]);
  return '<rect x="'+f(x)+'" y="'+f(y)+'" width="'+f(Math.abs(bb[0]-aa[0]))+'" height="'+f(Math.abs(bb[1]-aa[1]))+'" fill="none" stroke="#897a67" stroke-dasharray="2 4"/>';
}
function svg():string {
  const {p}=projection();const ts=a.lv.towers;
  const grid=Array.from({length:12},(_,i)=>'<line x1="'+(M+i*(W-2*M)/11)+'" y1="22" x2="'+(M+i*(W-2*M)/11)+'" y2="'+(H-22)+'"/>').join('')+
    Array.from({length:7},(_,i)=>'<line y1="'+(M+i*(H-2*M)/6)+'" x1="22" y2="'+(M+i*(H-2*M)/6)+'" x2="'+(W-22)+'"/>').join('');
  const edges=a.edges.map((e,i)=>{
    const x=p(ts[e.from].at),y=p(ts[e.to].at),on=i===selectedEdge;
    let d='';
    if(on&&view!=='graph'&&e.trajectory.length>2) d=line(e.trajectory.map(p),100);
    else if(view==='graph')d='M'+f(x[0])+' '+f(x[1])+' Q'+f((x[0]+y[0])/2)+' '+f(Math.min(x[1],y[1])-30-Math.abs(e.to-e.from)*4)+' '+f(y[0])+' '+f(y[1]);
    else d='M'+f(x[0])+' '+f(x[1])+' Q'+f((x[0]+y[0])/2)+' '+f((x[1]+y[1])/2-9)+' '+f(y[0])+' '+f(y[1]);
    return '<path data-edge="'+i+'" d="'+d+'" fill="none" stroke="'+tint(e)+'" stroke-width="'+(on?4.2:2.4)+'" stroke-opacity="'+(on?1:.48)+'" stroke-linecap="round" '+(e.status==='failed'?'stroke-dasharray="5 6"':'')+'><title>'+esc(e.from+' → '+e.to+' · '+e.status)+'</title></path>';
  }).join('');
  const intended=a.lv.ways?.length?a.lv.ways:ts.slice(1).map((_,i):[number,number]=>[i,i+1]);
  const proposed=intended.map(([i,j])=>{
    if(a.edges.some(e=>e.from===i&&e.to===j))return '';
    const x=p(ts[i].at),y=p(ts[j].at);
    return '<path d="M'+x.map(f).join(' ')+' L'+y.map(f).join(' ')+'" stroke="#9a9a92" stroke-width="1.5" stroke-dasharray="3 8" opacity=".6"/>';
  }).join('');
  const physical=ts.map((t,i)=>t.shapes.slice(0,i===selectedNode?130:32).map(s=>physicalOutline(s,p)).join('')).join('');
  const areas=ts.map(t=>outline(t,p)).join('');
  const nodes=ts.map((t,i)=>{
    const [x,y]=p(t.at),sel=i===selectedNode;
    return '<g data-node="'+i+'" style="cursor:pointer"><circle cx="'+f(x)+'" cy="'+f(y)+'" r="'+(sel?15:11)+'" fill="'+(i===0?'#466f60':i===ts.length-1?'#b6914f':colour(t.top))+'" stroke="'+(sel?'#342b25':'#f8f4e9')+'" stroke-width="'+(sel?3:2)+'"/><text x="'+f(x)+'" y="'+f(y+4)+'" text-anchor="middle" font-size="11" font-weight="700" fill="#fffaf0">'+i+'</text><text x="'+f(x)+'" y="'+f(y-21)+'" font-size="11" font-family="Georgia,serif" text-anchor="middle" fill="#574b3f">'+esc(target(t))+'</text>'+(a.chain&&Number.isFinite(a.chain.flicks[i])&&i<ts.length-1?'<text x="'+f(x)+'" y="'+f(y+28)+'" font-size="10" text-anchor="middle" fill="#6d6250">≈'+a.chain.flicks[i].toFixed(1)+'</text>':'')+'<title>'+esc('Stop '+i+' · '+target(t)+' · '+t.at.map(f).join(', '))+'</title></g>';
  }).join('');
  const aid=view==='graph'?'Topological layout · edges remain predictions until physically validated':view==='plan'?'Plan X–Z · axes independently scaled for readability':'Elevation X–Y · axes independently scaled';
  const current=a.edges[selectedEdge];const pathPoints=current?.validation?.traces[0]??current?.trajectory??[];
  const [ox,oy]=pathPoints.length?p(pathPoints[0]):[0,0];
  return '<svg id="diagram" viewBox="0 0 '+W+' '+H+'" role="img" aria-label="Squishy spatial level schematic" xmlns="http://www.w3.org/2000/svg">'+
    '<rect width="'+W+'" height="'+H+'" fill="#fcfaf4"/><g stroke="#bdb9ad" stroke-opacity=".28">'+grid+'</g>'+
    '<text x="28" y="28" font-size="13" fill="#897c68" font-family="Georgia,serif">'+esc(aid)+'</text>'+
    '<g opacity=".23">'+physical+'</g><g>'+proposed+'</g><g>'+areas+'</g><g>'+edges+'</g><g>'+nodes+'</g>'+
    '<circle id="traveller" cx="'+f(ox)+'" cy="'+f(oy)+'" r="7" fill="#db7c90" stroke="#fff" stroke-width="2" style="display:none;pointer-events:none"/>'+
    '<text x="'+(W-24)+'" y="'+(H-20)+'" text-anchor="end" font-size="12" fill="#a39986">seed '+a.seed+' / level '+a.level+' / '+a.skin+'</text></svg>';
}
function edgeInfo(e:Edge,i:number) {
  const v=e.validation,chosen=i===selectedEdge?' chosen':'';
  const m=e.map;
  const detail=(m?'P '+pc(m.best.p)+' · ±'+(m.clipped?'≥':'')+m.tolerance+' px · ':'')+(v?v.outcomes.target+'/'+v.total+' landed ['+pc(v.wilson[0])+'–'+pc(v.wilson[1])+']':composite(a.lv,e)?'multi-action: not mapped':e.method==='hop'?'generator witness':'ballistic witness');
  return '<button class="edge-row'+chosen+'" data-edge="'+i+'"><span class="swatch" style="background:'+tint(e)+'"></span><b>'+e.from+' → '+e.to+'</b><small>'+esc(e.status)+'</small><em>'+esc(detail)+'</em></button>';
}
/** a move's neighbourhood, in px of drag about the witness: what each flick did, where the ring showed the target, the best aim and its σ, and flicks played from the same top */
function mapSvg(e:Edge,m:ControlMap):string{
  const S=240,pad=18,sc=(S-2*pad)/(2*m.span),cx=(u:number)=>S/2+u*sc,cy=(v:number)=>S/2-v*sc,h=m.step*sc;
  const cells=m.cells.map(c=>{const k=c.out==='other'?'top '+c.at:c.out;return '<rect x="'+f(cx(c.u)-h/2)+'" y="'+f(cy(c.v)-h/2)+'" width="'+f(h)+'" height="'+f(h)+'" fill="'+outColour(k)+'" fill-opacity="'+(c.sampled?.88:.72)+'"><title>'+esc(k+' · '+c.u+', '+c.v+' px'+(c.sampled?'':' (between flicks that agree)'))+'</title></rect>';}).join('');
  const ring=m.cells.filter(c=>c.ring===e.to).map(c=>'<circle cx="'+f(cx(c.u))+'" cy="'+f(cy(c.v))+'" r="1.3" fill="#fff" fill-opacity=".9"/>').join('');
  const b=m.best;
  const played=flicks.filter(q=>q.from===e.from).map(q=>{const [u,v]=toPx(m.centre,{...m.centre,yaw:q.yaw,power:q.power});if(Math.abs(u)>m.span*1.4||Math.abs(v)>m.span*1.4)return '';return '<circle cx="'+f(cx(u))+'" cy="'+f(cy(v))+'" r="3.2" fill="none" stroke="'+(q.to===e.to?'#1f5d45':q.to===-1?'#8c2f2f':'#333')+'" stroke-width="1.6"><title>played: '+(q.to===undefined?'unsettled':q.to===-1?'fell':'stood on '+q.to)+'</title></circle>';}).join('');
  return '<svg class="map" viewBox="0 0 '+S+' '+S+'" aria-label="Outcome map in drag pixels"><rect width="'+S+'" height="'+S+'" fill="#f2eee3"/>'+cells+ring+
    '<circle cx="'+f(cx(b.u))+'" cy="'+f(cy(b.v))+'" r="'+f(m.sigma*sc)+'" fill="none" stroke="#fff" stroke-width="1.5"/>'+
    (m.tolerance?'<circle cx="'+f(cx(b.u))+'" cy="'+f(cy(b.v))+'" r="'+f(m.tolerance*sc)+'" fill="none" stroke="#fff" stroke-dasharray="3 3"/>':'')+
    '<path d="M'+f(cx(0)-5)+' '+f(cy(0))+'h10M'+f(cx(0))+' '+f(cy(0)-5)+'v10" stroke="#222" stroke-width="1.4"/>'+played+
    '<text x="'+(S/2)+'" y="'+(S-4)+'" font-size="9" text-anchor="middle" fill="#6b6253">← across the drag (px) →</text><text x="9" y="'+(S/2)+'" font-size="9" fill="#6b6253" transform="rotate(-90 9 '+(S/2)+')" text-anchor="middle">shorter · drag · longer</text></svg>';
}
function legend(m:ControlMap):string{
  const keys=[...new Set(m.cells.map(c=>c.out==='other'?'top '+c.at:c.out))];
  return '<p class="maplegend">'+keys.map(k=>'<span><i style="background:'+outColour(k)+'"></i>'+esc(k==='target'?'lands':k==='rest'?'stops off any top':k==='fall'?'falls (back where it was)':k==='timeout'?'still going':'onto '+k)+'</span>').join('')+'<span>white dots: the ring on the target · solid circle: σ round the best aim · dashed: tolerance · cross: witness · rings: flicks played</span></p>';
}
function edgeDetails(e:Edge):string{
  const m=e.map,v=e.validation,multi=composite(a.lv,e);
  const dest=m?Object.entries(m.best.dest).filter(([,p])=>p>.02).sort((x,y)=>y[1]-x[1]).map(([k,p])=>esc(k)+' '+pc(p)).join(' · '):'';
  return '<h3>Move '+e.from+' → '+e.to+'</h3><p>'+esc(a.lv.towers[e.from].top)+' → '+esc(a.lv.towers[e.to].top)+' · '+esc(e.method==='hop'?'generator witness':'ballistic witness')+' · drag '+f(14+e.control.power*0.3*402)+' px</p>'+
    (m?mapSvg(e,m)+legend(m)+'<dl><dt>Chance at the best aim (σ '+m.sigma+' px)</dt><dd>'+pc(m.best.p)+'</dd><dt>…at the witness</dt><dd>'+pc(m.atWitness)+'</dd><dt>Tolerance round the best aim</dt><dd>'+(m.clipped?'≥ ':'')+m.tolerance+' px</dd><dt>Area that lands</dt><dd>'+m.area+' px²</dd><dt>Where it goes</dt><dd>'+dest+'</dd><dt>Ring, where shown: green → lands</dt><dd>'+m.ring.greenLand+'/'+m.ring.green+'</dd><dt>Mapped</dt><dd>'+m.sims+' flicks · '+(m.ms/1000).toFixed(0)+' s</dd></dl>':
      multi?'<p class="muted">A move of more than one action (a rail, a climb, a jar): not mapped as one flick yet.</p>':'')+
    (v?'<dl><dt>Trials at the '+(m?'best aim':'witness')+', σ '+v.sigma+' px</dt><dd>'+v.outcomes.target+'/'+v.total+' · '+pc(v.wilson[0])+'–'+pc(v.wilson[1])+'</dd><dt>Same aim, after resting longer</dt><dd>'+v.timing[0]+'/'+v.timing[1]+'</dd><dt>Status</dt><dd>'+e.status+'</dd></dl>':'')+
    (multi?'':'<button id="map" class="primary">'+(m?'Map again':'Map in drag px · real body')+'</button><button id="verify">Trials · 12 at σ '+sigma+' px</button>')+'<button id="replay">Replay witness</button>';
}
function stopDetails(i:number):string{
  const k=a.chain?.forks.find(x=>x.at===i);
  const n=a.chain?.flicks[i];
  return (n!==undefined?'<p>Expected flicks home from here: <b>'+(Number.isFinite(n)?n.toFixed(2):'∞')+'</b>, falls '+(Number.isFinite(a.chain!.splats[i])?a.chain!.splats[i].toFixed(2):'∞')+'.</p>':'')+
    (k?'<dl>'+k.options.map(o=>'<dt>→ '+o.to+' (P '+pc(o.p)+')</dt><dd>'+(Number.isFinite(o.flicks)?o.flicks.toFixed(2):'∞')+' flicks</dd>').join('')+'</dl>':'');
}
function render(){
  const stats=routeStats(a);
  $('headline').textContent='Level '+a.level+' · seed '+a.seed+' · '+composition;
  $('metadata').textContent=a.lv.towers.length+' stops · '+a.lv.shapes.length+' physical shapes · '+(a.lv.made?.plain?'simplified fallback':'regular composition')+' · '+a.lv.made?.attempts+' generation attempt(s) · '+(a.lv.ways?.length??0)+' generator-checked hops · fingerprint '+a.fingerprint+(pinned&&pinned!==a.fingerprint?' — ⚠ not the level this link was made on ('+pinned+'): the generator has changed':'')+' · '+flicks.length+' logged flick(s) here';
  $('metrics').innerHTML='<div><b>'+stats.ways+'</b><small>predicted paths *</small></div><div><b>'+stats.reached+'/'+stats.total+'</b><small>reachable stops *</small></div><div><b>'+stats.confirmed+(stats.marginal?' +'+stats.marginal:'')+'</b><small>confirmed (+ marginal)</small></div>'+(a.chain?'<div><b>'+(Number.isFinite(a.chain.flicks[0])?a.chain.flicks[0].toFixed(1):'∞')+'</b><small>expected flicks home · σ '+sigma+' px</small></div>':'<div><b>'+stats.dead.length+'</b><small>discovered dead ends *</small></div>');
  $('plot').innerHTML=svg();
  $('edges').innerHTML=a.edges.length?a.edges.map(edgeInfo).join(''):'<p class="muted">Discover transitions to build the approximate reachability graph.</p>';
  const e=a.edges[selectedEdge];
  $('details').innerHTML=e?edgeDetails(e):
    '<h3>Stop '+selectedNode+'</h3><p>'+esc(target(a.lv.towers[selectedNode]))+'</p>'+stopDetails(selectedNode)+'<p class="muted">Tap a move to map it: every nearby flick, in pixels of drag, run through the real dumpling. Grey dashed links are the generator\'s own sequence, not proven.</p>';
  $('status').textContent=a.message;
  ($('level') as HTMLInputElement).value=String(level);($('seed') as HTMLInputElement).value=String(seed);($('skin') as HTMLSelectElement).value=skin;
  for(const b of document.querySelectorAll<HTMLButtonElement>('[data-view]'))b.classList.toggle('active',b.dataset.view===view);
}
function setState(refresh=true){
  level=Math.max(1,Math.min(80,Math.floor(Number(($('level') as HTMLInputElement).value)||1)));
  seed=Math.max(0,Math.floor(Number(($('seed') as HTMLInputElement).value)||0));
  skin=($('skin') as HTMLSelectElement).value==='jelly'?'jelly':'dough';
  scanToken++;cancelAnimationFrame(animation);
  selectedEdge=-1;selectedNode=0;
  const query=new URLSearchParams({level:String(level),seed:String(seed),skin,composition,sigma:String(sigma)});if(studyEnabled)query.set('study','');
  if(preview)query.set('preview','');
  history.replaceState(null,'','?'+query.toString());
  try {a=makeLevel(level,seed,skin,composition);flicks=readFlicks().filter(q=>q.level===level&&q.seed===seed&&q.fp===a.fingerprint);query.set('fp',a.fingerprint);history.replaceState(null,'','?'+query.toString());($('play') as HTMLAnchorElement).href='/squishy?level='+level+'&seed='+seed+'&skin='+skin;render();(window as unknown as {__squishyLab:unknown}).__squishyLab={level,seed,fingerprint:a.fingerprint};if(refresh)void computeStudy();}catch(err){
    $('status').textContent='Generation failed: '+String(err);
    $('plot').innerHTML='<p class="error">This seed failed to build. Try another, or inspect the generated error.</p>';
  }
}
async function scan() {
  const id=++scanToken;
  const candidates=candidatePairs(a.lv);a.edges=[];a.total=candidates.length;a.tested=0;a.scanning=true;selectedEdge=-1;
  a.message='Discovering approximate reachable transitions…';render();
  const found=new Set<string>();
  for(let k=0;k<candidates.length;k++){
    if(id!==scanToken)return;
    const [from,to]=candidates[k];
    try {
      const e=discover(a.lv,from,to);
      if(e&&!found.has(from+':'+to)){a.edges.push(e);found.add(from+':'+to);}
    }catch(err){a.message='Solver failed at '+from+' → '+to+': '+String(err);}
    a.tested=k+1;
    a.message='Examined '+a.tested+'/'+a.total+' candidate pairs · '+a.edges.length+' witnessed transitions';
    if(k%2===0 || k===candidates.length-1) {render();await new Promise<void>(r=>setTimeout(r,0));}
  }
  if(id!==scanToken)return;
  a.scanning=false;
  const stats=routeStats(a);
  a.message='Scan complete: '+a.edges.length+' ballistic witnesses, '+stats.ways+' predicted forward paths. *Sampled discovery; not proof of absence or human success.';
  render();
}
const tick=()=>new Promise<void>(r=>setTimeout(r,0));
async function mapOne(e:Edge,id:number):Promise<boolean>{
  const g=mapEdge(a,e,{sigma});
  for(;;){
    const r=g.next();
    if(id!==scanToken)return false;
    if(r.done){e.map=r.value;return true;}
    a.message='Mapping '+e.from+' → '+e.to+': flick '+r.value.done+' of about '+r.value.of+' (real body)…';
    $('status').textContent=a.message;await tick();
  }
}
/** every single-flick move: mapped, tried, then the way home priced */
async function measureLevel(){
  if(!a.edges.length)await scan();
  const id=++scanToken;
  const todo=a.edges.filter(e=>!composite(a.lv,e)&&!e.map);
  for(const [n,e] of todo.entries()){
    if(!(await mapOne(e,id)))return;
    verify(a,e,12,sigma);
    a.message='Measured '+(n+1)+'/'+todo.length+' moves';render();await tick();
  }
  a.chain=chain(a.lv,a.edges.filter(e=>e.map).map(e=>e.map!));
  const c=a.chain;
  a.message='Expected flicks home: '+(Number.isFinite(c.flicks[0])?c.flicks[0].toFixed(2):'∞ (no mapped way from the start)')+' at σ '+sigma+' px. '+c.forks.map(k=>'At '+k.at+': '+k.options.map(o=>'→'+o.to+' '+(Number.isFinite(o.flicks)?o.flicks.toFixed(1):'∞')).join(' vs ')).join('. ')+(c.forks.length?'. ':'')+c.assumption;
  render();
}
function replay(){
  const e=a.edges[selectedEdge];if(!e)return;
  const pathPoints=e.validation?.traces[0]?.length?e.validation.traces[0]:e.trajectory;
  if(!pathPoints.length)return;
  const {p}=projection(),dot=$('traveller') as unknown as SVGCircleElement;
  if(!dot)return;
  cancelAnimationFrame(animation);dot.style.display='';
  const started=performance.now();
  const duration=Math.max(1200,Math.min(4500,pathPoints.length*26));
  const tick=(at:number)=>{
    const progress=Math.min(1,(at-started)/duration),index=Math.min(pathPoints.length-1,Math.floor(progress*(pathPoints.length-1)));
    const [x,y]=p(pathPoints[index]);dot.setAttribute('cx',String(x));dot.setAttribute('cy',String(y));
    if(progress<1)animation=requestAnimationFrame(tick);
    else dot.style.display='none';
  };animation=requestAnimationFrame(tick);
}
function download(filename:string,data:string,type:string){
  const url=URL.createObjectURL(new Blob([data],{type}));const link=document.createElement('a');
  link.href=url;link.download=filename;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function exportJson() {
  const stats=routeStats(a);
  const output={level:a.level,seed:a.seed,skin:a.skin,made:a.lv.made,
    stops:a.lv.towers.map((t,i)=>({id:i,top:t.top,at:t.at,r:t.r,box:t.box,yaw:t.yaw})),
    edges:a.edges.map(e=>({from:e.from,to:e.to,control:e.control,status:e.status,method:e.method,trajectory:e.trajectory,validation:e.validation})),
    fingerprint:a.fingerprint,sigma,chain:a.chain,maps:a.edges.filter(e=>e.map).map(e=>e.map),
    metrics:stats,note:'Maps: every nearby flick in px of drag run through Dumpling.step. Chances are under σ px of drag error; trials report Wilson 95% intervals. Sampled discovery does not establish impossibility.'};
  download('squishy-level-'+level+'-'+seed+'.json',JSON.stringify(output,null,2),'application/json');
}
function attach(){
  $('build').addEventListener('click',()=>setState());
  $('composition-panel').addEventListener('click',ev=>{const b=(ev.target as Element).closest('[data-composition]') as HTMLElement|null;if(!b)return;composition=b.dataset.composition as Composition;setState(false);viewStudy();});
  $('discover').addEventListener('click',()=>void scan());
  $('verifyall').addEventListener('click',()=>void measureLevel());
  ($('sigma') as HTMLInputElement).value=String(sigma);
  $('sigma').addEventListener('change',()=>{sigma=Math.max(1,Math.min(20,Number(($('sigma') as HTMLInputElement).value)||4));for(const e of a.edges){e.map=undefined;e.validation=undefined;e.status='predicted';}a.chain=undefined;setState(false);});
  $('nextseed').addEventListener('click',()=>{($('seed') as HTMLInputElement).value=String(seed+1);setState();});
  $('exportsvg').addEventListener('click',()=>download('squishy-level-'+level+'-'+seed+'.svg',$('plot').querySelector('svg')?.outerHTML??'','image/svg+xml'));
  $('exportjson').addEventListener('click',exportJson);
  for(const b of document.querySelectorAll<HTMLButtonElement>('[data-view]'))b.addEventListener('click',()=>{view=b.dataset.view as typeof view;cancelAnimationFrame(animation);render();});
  $('plot').addEventListener('click',ev=>{
    const el=(ev.target as Element).closest('[data-edge],[data-node]') as HTMLElement|null;if(!el)return;
    if(el.dataset.edge!==undefined){selectedEdge=Number(el.dataset.edge);selectedNode=a.edges[selectedEdge].from;}
    else {selectedEdge=-1;selectedNode=Number(el.dataset.node);}render();
  });
  $('edges').addEventListener('click',ev=>{
    const el=(ev.target as Element).closest('[data-edge]') as HTMLElement|null;if(!el)return;
    selectedEdge=Number(el.dataset.edge);selectedNode=a.edges[selectedEdge].from;render();
  });
  $('details').addEventListener('click',ev=>{
    const el=ev.target as HTMLElement;
    if(el.id==='map' && selectedEdge>=0){const e=a.edges[selectedEdge];void mapOne(e,++scanToken).then(ok=>{if(ok){a.message='Mapped '+e.from+' → '+e.to+' with '+e.map!.sims+' real flicks.';render();}});}
    if(el.id==='verify' && selectedEdge>=0){
      try{verify(a,a.edges[selectedEdge],12,sigma);a.message='Twelve flicks as a player makes them: the aim, off by σ '+sigma+' px of drag, each through the real Dumpling.step.';}
      catch(error){a.message='Full-body verification failed: '+String(error);}
      render();
    }
    if(el.id==='replay')replay();
  });
}
attach();setState();
