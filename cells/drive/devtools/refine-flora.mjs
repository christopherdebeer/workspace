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
const wood = {}, report = [];
for (const [family, f] of Object.entries(source.families)) for (const v of f.variants) {
  const pos = Float32Array.from(decode(v.pos, Int16Array), n => n / source.q);
  const idx = Uint32Array.from(decode(v.idx, Uint16Array));
  // Weld coincident positions before simplification; bark/facet colour is baked
  // afterwards. Keep positions, crown anchors and fork locations in their frame.
  const unique = new Map(), remap = [], verts = [];
  for (let i = 0; i < pos.length; i += 3) {
    const key = `${pos[i]},${pos[i+1]},${pos[i+2]}`;
    if (!unique.has(key)) { unique.set(key, verts.length / 3); verts.push(pos[i],pos[i+1],pos[i+2]); }
    remap.push(unique.get(key));
  }
  const p = Float32Array.from(verts), indices = Uint32Array.from(idx, i => remap[i]);
  const [out, error] = MeshoptSimplifier.simplify(indices, p, 3,
    Math.floor(indices.length * 0.48 / 3) * 3, 0.0015, []);
  // Convert back to original vertex IDs, preserving the original position data.
  const first = [];
  remap.forEach((r,i) => { if (first[r] === undefined) first[r] = i; });
  const reduced = Array.from(out, i => first[i]);
  wood[v.name] = encode(reduced, Uint16Array);
  report.push({family,name:v.name,before:idx.length/3,after:out.length/3,error});
}
const rng = seed => () => { seed |= 0; seed = seed + 0x6d2b79f5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t ^= t + Math.imul(t ^ t >>> 7, 61 | t); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const cross = (a,b) => [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const norm = a => { const l=Math.hypot(...a)||1; return a.map(x=>x/l); };
const profiles = [
  {name:'open whorled',clear:0.20,top:1,tiers:7,width:0.30,lean:0.018,flag:0},
  {name:'high crown',clear:0.48,top:1,tiers:5,width:0.29,lean:0.025,flag:0},
  {name:'wind shaped',clear:0.30,top:1,tiers:6,width:0.28,lean:0.12,flag:0.65},
  {name:'broken leader',clear:0.26,top:0.83,tiers:5,width:0.35,lean:0.045,flag:0},
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
  return {name:`Conifer ${profile.name} #${seed}`,habit:profile.name,form:'conic',verts:P.length/3,tris:I.length/3,
    drawn:I.length/3+anchors.length/3*8,crown:{shape:'flat',r:0.06},
    sil:{clear:profile.clear,width:profile.width,taper:-0.3,card:0},
    pos:encode(quant(P)),idx:encode(I,Uint16Array),cards:'',cardIdx:'',anc:encode(quant(anchors)),pads:encode(quant(pads))};
}
const conifers=profiles.flatMap((p,i)=>[conifer(p,101+i*97),conifer(p,307+i*71)]);
const result={wood,conifers};
fs.writeFileSync(new URL('client/flora-refined-baked.ts',root),
  '// GENERATED by devtools/refine-flora.mjs from flora-ez-baked.ts.\n'+
  'export const FLORA_REFINED = '+JSON.stringify(result,null,2)+';\n');
console.log(JSON.stringify({wood:report,conifers:conifers.map(v=>({name:v.name,tris:v.drawn}))},null,2));
