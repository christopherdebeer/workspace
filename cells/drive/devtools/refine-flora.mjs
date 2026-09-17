// Reproducible refinement of the original EZ bake; no generator in the game loop.
// Run: node devtools/refine-flora.mjs (meshoptimizer 0.18.x dev dependency).
import fs from 'node:fs';
import { MeshoptSimplifier } from 'meshoptimizer';
await MeshoptSimplifier.ready;
const root = new URL('../', import.meta.url);
const text = fs.readFileSync(new URL('client/flora-ez-baked.ts', root), 'utf8');
const source = JSON.parse(text.slice(text.indexOf('= {') + 2).trim().replace(/;$/, ''));
const decode = (s, Type) => { const b = Buffer.from(s, 'base64'); return new Type(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); };
const encode = (a, Type = Int16Array) => Buffer.from(new Type(a).buffer).toString('base64');
/**
 * ── THE MID RUNG'S WOOD: THE SAME VERTICES, A FIFTH OF THE TRIANGLES ──
 *
 * `wood` is the refined index the game draws by default (48% of the bake's
 * triangles, error 0.0015 of the tree's height). `woodMid` is a second index
 * over the SAME positions for the representation drawn between the impostor
 * card and the full skeleton — a tree between about 30 and 60 art pixels,
 * where a trunk is one to three pixels wide and a branch is under one.
 *
 * It is a simplification and not a re-generation on purpose: EZ-Tree consumes
 * its random draws per section, so a recipe re-run with fewer sections is a
 * DIFFERENT tree, and a tree that changes shape as you drive at it is the
 * fault the seat already rejected once. Collapsing edges of the geometry that
 * is already there keeps every branch where it was to within the error bound.
 *
 * MEASURED before the numbers were chosen, over all thirty-seven variants: at
 * a 20% target the EZ-bake variants land at 17-20% with error 0.002-0.004
 * (two to four centimetres on a ten-metre tree) before the bound binds at
 * all. The procedural broadleaves are the exception — five-sided trunk tubes
 * and prop roots that refuse to go under 58% at 0.004 — and reach 14-18% at
 * 0.008. Eight centimetres on a 23 cm trunk, at a range where that trunk is
 * two pixels wide, is not a thing anyone can see; the bound is 0.008 for all.
 */
const MID_RATIO = 0.20, MID_ERR = 0.008;
/** Weld coincident positions, simplify to `ratio` of the triangles within
 *  `err` of the tree's height, and hand back an index in the ORIGINAL vertex
 *  ids — so the reduced mesh reads the very same positions, colours and
 *  frame the full one does. Bark/facet colour is baked afterwards. */
function simplified(pos, idx, ratio, err) {
  const unique = new Map(), remap = [], verts = [];
  for (let i = 0; i < pos.length; i += 3) {
    const key = `${pos[i]},${pos[i+1]},${pos[i+2]}`;
    if (!unique.has(key)) { unique.set(key, verts.length / 3); verts.push(pos[i],pos[i+1],pos[i+2]); }
    remap.push(unique.get(key));
  }
  const p = Float32Array.from(verts), indices = Uint32Array.from(idx, i => remap[i]);
  const [out, error] = MeshoptSimplifier.simplify(indices, p, 3,
    Math.floor(indices.length * ratio / 3) * 3, err, []);
  const first = [];
  remap.forEach((r,i) => { if (first[r] === undefined) first[r] = i; });
  return { index: Array.from(out, i => first[i]), tris: out.length / 3, error };
}
const wood = {}, woodMid = {}, report = [];
for (const [family, f] of Object.entries(source.families)) for (const v of f.variants) {
  const pos = Float32Array.from(decode(v.pos, Int16Array), n => n / source.q);
  const idx = Uint32Array.from(decode(v.idx, Uint16Array));
  const fine = simplified(pos, idx, 0.48, 0.0015);
  const mid = simplified(pos, idx, MID_RATIO, MID_ERR);
  wood[v.name] = encode(fine.index, Uint16Array);
  woodMid[v.name] = encode(mid.index, Uint16Array);
  report.push({family,name:v.name,before:idx.length/3,after:fine.tris,error:fine.error,mid:mid.tris,midError:mid.error});
}
const rng = seed => () => { seed |= 0; seed = seed + 0x6d2b79f5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t ^= t + Math.imul(t ^ t >>> 7, 61 | t); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const cross = (a,b) => [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const norm = a => { const l=Math.hypot(...a)||1; return a.map(x=>x/l); };
const profiles = [
  // `open whorled` is architecture. The other three are site responses and
  // must not consume a district's two-species vocabulary: a dense stand lifts
  // its crowns, an exposed ridge flags them together, and damage is individual.
  {name:'open whorled',habit:'open whorled',clear:0.20,top:1,tiers:7,width:0.30,lean:0.018,flag:0},
  {name:'high crown',habit:'conic',state:'competition',clear:0.48,top:1,tiers:5,width:0.29,lean:0.025,flag:0},
  {name:'wind shaped',habit:'conic',state:'exposure',clear:0.30,top:1,tiers:6,width:0.28,lean:0.12,flag:0.65},
  {name:'broken leader',habit:'conic',state:'damage',clear:0.26,top:0.83,tiers:5,width:0.35,lean:0.045,flag:0},
];
function conifer(profile, seed) {
  const r=rng(seed), P=[], I=[], anchors=[], pads=[];
  const trunk = y => [profile.lean*y*y, y, 0.012*Math.sin(y*5+seed)*y];
  function tube(points, radii, sides) {
    const start=P.length/3;
    for(let j=0;j<points.length;j++) {
      const prev=points[Math.max(0,j-1)],next=points[Math.min(points.length-1,j+1)];
      const dir=norm(next.map((v,i)=>v-prev[i]));
      const a=norm(cross(dir,Math.abs(dir[1])>0.9?[1,0,0]:[0,1,0])),b=cross(dir,a);
      for(let k=0;k<sides;k++) {
        const t=k/sides*Math.PI*2;
        P.push(...points[j].map((v,i)=>v+radii[j]*(a[i]*Math.cos(t)+b[i]*Math.sin(t))));
      }
    }
    for(let j=0;j<points.length-1;j++) for(let k=0;k<sides;k++) {
      const a=start+j*sides+k,b=start+j*sides+(k+1)%sides,c=a+sides,d=b+sides;
      I.push(a,b,c,b,d,c);
    }
    // Cap the broken leader, retaining its visible blunt top.
    const end=start+(points.length-1)*sides;
    for(let k=1;k<sides-1;k++) I.push(end,end+k,end+k+1);
  }
  const trunkPts=Array.from({length:7},(_,i)=>trunk(i/6*profile.top));
  tube(trunkPts,trunkPts.map(p=>0.018*(1-p[1]/1.08)+0.001),5);
  const spin=r()*6.283;
  for(let tier=0;tier<profile.tiers;tier++) {
    const t=tier/(profile.tiers-1), y=profile.clear+(profile.top-profile.clear-0.045)*t;
    const count=tier===profile.tiers-1?2:3;
    for(let b=0;b<count;b++) {
      const a=spin+tier*2.399+b/count*6.283+(r()-0.5)*0.6;
      const length=profile.width*(0.90-0.65*t)*(0.75+r()*0.45)*(1+profile.flag*Math.cos(a));
      const from=trunk(y), dip=0.022*(1-t)*(0.4+r());
      const middle=[from[0]+Math.cos(a)*length*0.52,y-dip,from[2]+Math.sin(a)*length*0.52];
      const end=[from[0]+Math.cos(a)*length,y+0.012+0.02*t,from[2]+Math.sin(a)*length];
      tube([from,middle,end],[0.0055*(1-t*0.6),0.003,0.0007],3);
      // Distinct radial sprays, with an open interior and small lifted tips.
      for(const u of [0.57,0.94]) {
        const along=0.043*(0.8+r()*0.45)*(1-t*0.38), across=along*(0.65+r()*0.4);
        anchors.push(from[0]+Math.cos(a)*length*u,y+(u>0.8?0.018:-dip*0.5),from[2]+Math.sin(a)*length*u);
        pads.push(along,0.013*(0.75+r()*0.5),across,a/6.283);
      }
    }
  }
  if(profile.top===1) { anchors.push(...trunk(0.985)); pads.push(0.025,0.04,0.025,0); }
  const q=source.q, quant=a=>a.map(n=>Math.round(n*q));
  return {name:`Conifer ${profile.name} #${seed}`,habit:profile.habit,state:profile.state,form:'conic',verts:P.length/3,tris:I.length/3,
    drawn:I.length/3+anchors.length/3*8,crown:{shape:'flat',r:0.06},
    sil:{clear:profile.clear,width:profile.width,taper:-0.3,card:0},
    pos:encode(quant(P)),idx:encode(I,Uint16Array),cards:'',cardIdx:'',anc:encode(quant(anchors)),pads:encode(quant(pads))};
}
const conifers=profiles.flatMap((p,i)=>[conifer(p,101+i*97),conifer(p,307+i*71)]);

/**
 * Compact broadleaf architectures built directly into the refinement bake.
 * They deliberately use eight to twelve large crown masses instead of several
 * hundred leaf cards: at Drive's 12-50 pixel tree scale those masses survive
 * the quantiser, leave authored holes nearby, and close through the existing
 * hull merge before they become stipple at distance.
 */
const broadProfiles = [
  {name:'spreading',form:'round',habitats:['temperate','grassland'],clear:0.22,width:0.46,
    branches:7,branchLo:0.24,branchHi:0.58,rise:0.16,lean:0.035,crownR:0.125},
  {name:'vase',form:'round',habitats:['temperate','wet'],clear:0.30,width:0.36,
    branches:6,branchLo:0.30,branchHi:0.52,rise:0.38,lean:0.025,crownR:0.115},
  {name:'sclerophyll',form:'round',habitats:['dry','mediterranean'],clear:0.18,width:0.34,
    branches:7,branchLo:0.20,branchHi:0.62,rise:0.20,lean:0.075,crownR:0.105},
  {name:'mangrove',form:'umbrella',habitats:['salt'],clear:0.48,width:0.50,
    branches:8,branchLo:0.54,branchHi:0.68,rise:0.10,lean:0.045,crownR:0.12,props:7},
];
function broadleaf(profile, seed) {
  const r=rng(seed), P=[], I=[], anchors=[];
  const trunk = y => [profile.lean*y*y+0.008*Math.sin(y*7+seed),y,0.012*Math.sin(y*4+seed*0.3)*y];
  function tube(points,radii,sides,cap=false) {
    const start=P.length/3;
    for(let j=0;j<points.length;j++) {
      const prev=points[Math.max(0,j-1)],next=points[Math.min(points.length-1,j+1)];
      const dir=norm(next.map((v,i)=>v-prev[i]));
      const a=norm(cross(dir,Math.abs(dir[1])>0.9?[1,0,0]:[0,1,0])),b=cross(dir,a);
      for(let k=0;k<sides;k++) {
        const t=k/sides*Math.PI*2;
        P.push(...points[j].map((v,i)=>v+radii[j]*(a[i]*Math.cos(t)+b[i]*Math.sin(t))));
      }
    }
    for(let j=0;j<points.length-1;j++) for(let k=0;k<sides;k++) {
      const a=start+j*sides+k,b=start+j*sides+(k+1)%sides,c=a+sides,d=b+sides;
      I.push(a,b,c,b,d,c);
    }
    if(cap) {
      const end=start+(points.length-1)*sides;
      for(let k=1;k<sides-1;k++) I.push(end,end+k,end+k+1);
    }
  }
  const trunkPts=Array.from({length:7},(_,i)=>trunk(i/6));
  tube(trunkPts,trunkPts.map(p=>0.027*(1-p[1]*0.82)+0.0025),5,true);
  const spin=r()*Math.PI*2;
  for(let b=0;b<profile.branches;b++) {
    const t=b/Math.max(1,profile.branches-1);
    const y=profile.branchLo+(profile.branchHi-profile.branchLo)*t+(r()-0.5)*0.035;
    const a=spin+b*2.399+(r()-0.5)*0.5;
    const length=profile.width*(0.72+r()*0.34)*(profile.name==='vase'?0.78+0.25*t:1-0.16*t);
    const from=trunk(y);
    const middle=[from[0]+Math.cos(a)*length*0.52,y+profile.rise*0.36+(r()-0.5)*0.035,
      from[2]+Math.sin(a)*length*0.52];
    const end=[from[0]+Math.cos(a)*length,y+profile.rise*(0.76+r()*0.3)+0.12*t,
      from[2]+Math.sin(a)*length];
    tube([from,middle,end],[0.008*(1-0.35*t),0.0045,0.001],3);
    anchors.push(...end);
    // A second, inset mass makes each bough a lobe rather than a bead and
    // leaves the gaps BETWEEN boughs intact.
    anchors.push(
      middle[0]+(end[0]-middle[0])*0.42,
      middle[1]+(end[1]-middle[1])*0.42+profile.crownR*0.35,
      middle[2]+(end[2]-middle[2])*0.42,
    );
  }
  anchors.push(...trunk(0.96));
  // Mangrove prop roots are wood, not another crown primitive: broad forks
  // leave the bole above the tide line and land around it as a visible cage.
  for(let k=0;k<(profile.props??0);k++) {
    const a=spin+k/(profile.props??1)*Math.PI*2+(r()-0.5)*0.25;
    const d=0.12+r()*0.12, from=trunk(0.25+r()*0.10);
    tube([from,[Math.cos(a)*d*0.55,0.08,Math.sin(a)*d*0.55],[Math.cos(a)*d,0,Math.sin(a)*d]],
      [0.006,0.004,0.001],3);
  }
  let lo=1,width=0,rLo=0,rHi=0;
  for(let i=0;i<anchors.length;i+=3) {
    lo=Math.min(lo,anchors[i+1]);
    width=Math.max(width,Math.hypot(anchors[i],anchors[i+2]));
  }
  const mid=lo+(1-lo)*0.5;
  for(let i=0;i<anchors.length;i+=3) {
    const rr=Math.hypot(anchors[i],anchors[i+2]);
    if(anchors[i+1]<mid) rLo=Math.max(rLo,rr); else rHi=Math.max(rHi,rr);
  }
  const q=source.q,quant=a=>a.map(n=>Math.round(n*q));
  return {name:`Broadleaf ${profile.name} #${seed}`,habit:profile.name,habitats:profile.habitats,
    form:profile.form,verts:P.length/3,tris:I.length/3,drawn:I.length/3+anchors.length/3*20,
    crown:{shape:'icosa',r:profile.crownR},
    sil:{clear:+lo.toFixed(3),width:+width.toFixed(3),taper:+((rHi-rLo)/Math.max(width,1e-6)).toFixed(3),card:0},
    pos:encode(quant(P)),idx:encode(I,Uint16Array),cards:'',cardIdx:'',anc:encode(quant(anchors))};
}
const broadleaves=broadProfiles.flatMap((p,i)=>[broadleaf(p,43+i*89),broadleaf(p,211+i*67)]);
// The growth forms carry their own wood and are not in `wood` (their tubes
// are already three- to five-sided); the mid rung wants them cut the same way.
for (const v of [...conifers, ...broadleaves]) {
  const pos = Float32Array.from(decode(v.pos, Int16Array), n => n / source.q);
  const idx = Uint32Array.from(decode(v.idx, Uint16Array));
  const mid = simplified(pos, idx, MID_RATIO, MID_ERR);
  woodMid[v.name] = encode(mid.index, Uint16Array);
  report.push({family:v.habit,name:v.name,before:idx.length/3,after:idx.length/3,error:0,mid:mid.tris,midError:mid.error});
}
const result={wood,woodMid,conifers,broadleaves};
fs.writeFileSync(new URL('client/flora-refined-baked.ts',root),
  '// GENERATED by devtools/refine-flora.mjs from flora-ez-baked.ts.\n'+
  'export const FLORA_REFINED = '+JSON.stringify(result,null,2)+';\n');
console.log(JSON.stringify({wood:report,conifers:conifers.map(v=>({name:v.name,tris:v.drawn,state:v.state??null})),
  broadleaves:broadleaves.map(v=>({name:v.name,form:v.form,tris:v.drawn,habitats:v.habitats}))},null,2));
