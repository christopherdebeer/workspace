/** Coast-specific tangible lifeboat and geological dressing.
 * The original Rescue Race meshes remain unchanged. Geometry is combined into the same
 * instanced draw calls (not an additional draw call for every lifebuoy, mast or rock). */
import { Builder, P, STRIDE, bigBoat as baseBoat, person as basePerson, worldMesh as baseWorld, type Mesh, type RGB, type V3 } from '../rescue/mesh';
export { tinyBoat, buoy, STRIDE } from '../rescue/mesh';
export type { Mesh } from '../rescue/mesh';
import { heightAt, type Sea, type Decor } from '../rescue/sea';
import { hash, seeded } from '../kit/rng';

function join(meshes: Mesh[]): Mesh {
  const n = meshes.reduce((sum,m)=>sum+m.data.length,0), data = new Float32Array(n);
  let off=0; for(const m of meshes) {data.set(m.data,off);off+=m.data.length;}
  return {data,count:n/STRIDE};
}
/** Six-sided tube between arbitrary points: chunky, tangible rubber and painted metal. */
function rod(b: Builder, from:V3,to:V3,r:number,col:RGB, sides=7,part=0) {
  const vx=to[0]-from[0],vy=to[1]-from[1],vz=to[2]-from[2],l=Math.hypot(vx,vy,vz);
  if(l<1e-4)return;
  const axis:V3=[vx/l,vy/l,vz/l],ref:V3=Math.abs(axis[1])<.85?[0,1,0]:[1,0,0];
  let ux=axis[1]*ref[2]-axis[2]*ref[1],uy=axis[2]*ref[0]-axis[0]*ref[2],uz=axis[0]*ref[1]-axis[1]*ref[0];
  const ul=Math.hypot(ux,uy,uz)||1;ux/=ul;uy/=ul;uz/=ul;
  const wx=axis[1]*uz-axis[2]*uy,wy=axis[2]*ux-axis[0]*uz,wz=axis[0]*uy-axis[1]*ux;
  const pt=(c:V3,a:number):V3=>[c[0]+r*(ux*Math.cos(a)+wx*Math.sin(a)),c[1]+r*(uy*Math.cos(a)+wy*Math.sin(a)),c[2]+r*(uz*Math.cos(a)+wz*Math.sin(a))];
  const begin=b.out.length;
  for(let i=0;i<sides;i++){const a=2*Math.PI*i/sides,d=2*Math.PI*(i+1)/sides;b.quad(pt(from,a),pt(from,d),pt(to,d),pt(to,a),col,part);}
  for(let i=begin;i<b.out.length;i+=STRIDE){
    const dx=b.out[i]-from[0],dy=b.out[i+1]-from[1],dz=b.out[i+2]-from[2];
    const t=dx*axis[0]+dy*axis[1]+dz*axis[2];
    const nx=dx-t*axis[0],ny=dy-t*axis[1],nz=dz-t*axis[2],l=Math.hypot(nx,ny,nz)||1;
    b.out[i+3]=nx/l;b.out[i+4]=ny/l;b.out[i+5]=nz/l;
  }
}
/** Rounded cuboid built from six projected grids; analytic fillet normals. */
function roundedBox(b:Builder,c:V3,h:V3,r:number,col:RGB,part=0){
 const n=10,axes=[[0,1,2],[0,2,1],[1,2,0],[1,0,2],[2,0,1],[2,1,0]];
 for(let face=0;face<6;face++){
  const [a,u,v]=axes[face],sign=face%2===0?1:-1;
  const pt=(i:number,j:number):V3=>{
   const q:V3=[0,0,0];q[a]=sign*h[a];q[u]=(2*i/n-1)*h[u];q[v]=(2*j/n-1)*h[v];
   const core=q.map((x,k)=>Math.max(-h[k]+r,Math.min(h[k]-r,x)));
   const d=q.map((x,k)=>x-core[k]),l=Math.hypot(...d)||1;
   return q.map((_,k)=>c[k]+core[k]+d[k]*r/l) as V3;
  };
  const begin=b.out.length;
  for(let i=0;i<n;i++)for(let j=0;j<n;j++)b.quad(pt(i,j),pt(i+1,j),pt(i+1,j+1),pt(i,j+1),col,part);
  for(let k=begin;k<b.out.length;k+=STRIDE){
   const d=[0,1,2].map(j=>{const q=b.out[k+j]-c[j];return q-Math.max(-h[j]+r,Math.min(h[j]-r,q));}),l=Math.hypot(...d)||1;
   for(let j=0;j<3;j++)b.out[k+3+j]=d[j]/l;
  }
 }
}
/** Weld normal directions within a crease angle, retaining deliberate chines and seams. */
function soften(mesh:Mesh,threshold=.78):Mesh{
 const d=mesh.data,map=new Map<string,number[]>(),normals=new Float32Array(d);
 for(let i=0;i<d.length;i+=STRIDE){const key=[d[i],d[i+1],d[i+2],d[i+9]].map(v=>Math.round(v*1000)).join(',');const a=map.get(key)||[];a.push(i);map.set(key,a);}
 for(const ids of map.values())for(const i of ids){let x=0,y=0,z=0;for(const j of ids){if(normals[i+3]*normals[j+3]+normals[i+4]*normals[j+4]+normals[i+5]*normals[j+5]<threshold)continue;x+=normals[j+3];y+=normals[j+4];z+=normals[j+5];}const l=Math.hypot(x,y,z);if(l>0){d[i+3]=x/l;d[i+4]=y/l;d[i+5]=z/l;}}
 return mesh;
}
export function bigBoat():Mesh {
  const b=new Builder(), navy:RGB=[.075,.16,.27], rubber:RGB=[.065,.09,.12], orange:RGB=[.96,.37,.115], steel:RGB=[.52,.6,.64],white:RGB=[.94,.94,.9];
  // Dense rubber collar follows the hull sheer and draws a crisp shadow against its painted side.
  const sections:[number,number,number][]=[[-5.35,1.78,1.07],[-4.55,2.03,1.08],[-3,2.12,1.07],[-1,2.13,1.07],[1,2.1,1.08],[2.6,1.94,1.12],[3.7,1.62,1.2],[4.6,1.12,1.3],[5.2,.62,1.35],[5.53,.10,1.37]];
  for(const s of [-1,1])for(let i=0;i<sections.length-1;i++){
    const a=sections[i],c=sections[i+1];rod(b,[s*a[1],a[2],a[0]],[s*c[1],c[2],c[0]],.22,rubber,12,13);
    rod(b,[s*a[1],a[2]+.17,a[0]],[s*c[1],c[2]+.17,c[0]],.13,orange,12);
    rod(b,[s*(a[1]-.08),a[2]+.31,a[0]],[s*(c[1]-.08),c[2]+.31,c[0]],.055,white,6);
  }
  // The aft section: open gunwale, stanchions and hand rails.
  for(const side of [-1,1]) {
    for(const z of [-5.05,-4.2,-3.1,-1.1,1.15,2.65]) {
      const w=z>2?1.65:z>1?1.9:2.04;
      rod(b,[side*w,1.35,z],[side*w,2.05,z],.045,steel,10,14);
    }
    rod(b,[side*1.99,2.05,-5.1],[side*2.04,2.05,-3.1],.045,steel);
    rod(b,[side*2.04,2.05,-3.1],[side*2.04,2.05,-1.1],.045,steel);
    rod(b,[side*2.04,2.05,-1.1],[side*1.9,2.05,1.15],.045,steel);
    // Distinctive inflatable fenders.
    for(const z of [-4.1,-.9,1.9]) {
      b.at(side*2.05,.82,z);
      b.lump([0,0,0],.34,hash(91,Math.round(z*10),side),rubber,0,[.5,1,1],10,6);
      b.at(); // Reset after each fender: subsequent railings must not inherit this transform.
    }
  }
  b.at();
  // Pilot-house trim, inset panes, roof air intakes, amber beacon and deck bollards.
  for(const z of [-4.05,-1.24])for(const x of [-1.16,1.16]) {
    rod(b,[x,1.9,z],[x,2.74,z],.064,steel);
  }
  for(const z of [-3.74,-2.72,-1.7])for(const side of [-1,1]) {
    rod(b,[side*1.17,2.0,z],[side*1.17,2.72,z],.042,steel);
  }
  b.box(-1.42,1.42,2.92,3.05,-4.43,-.98,navy);
  b.box(-.42,.42,3.05,3.18,-2.85,-1.95,white);
  b.lathe(0,-2.4,[[.22,0],[.23,.12],[.16,.3],[0,.35]],12,orange,0,3.19);
  // Raised upper platform and rescue tackle details.
  for(const x of [-.8,.8])for(const z of [-4.8,-1.2]) {
    b.at(x,0,z);b.lathe(0,0,[[.1,1.0],[.12,1.22],[.15,1.27],[0,1.29]],8,steel);b.at();
  }
  b.at();
  rod(b,[-.75,3.34,-3.55],[.75,3.34,-3.55],.075,steel);
  for(const x of [-.75,.75])rod(b,[x,3.0,-3.55],[x,3.34,-3.55],.048,steel);
  // Coiled lines: a few deliberately legible rings on aft cabin.
  for(let i=0;i<2;i++) {
    const z=-4.55+i*.48;
    for(let k=0;k<10;k++){
      const a=k*Math.PI/5,c=(k+1)*Math.PI/5;
      rod(b,[.8+.2*Math.sin(a),1.46+.2*Math.cos(a),z],[.8+.2*Math.sin(c),1.46+.2*Math.cos(c),z],.047,[.82,.66,.35],5);
    }
  }

  // Keep every player identifiable by stripe and pennant while giving the five boats
  // a common lifeboat language: rescue-orange pilot house, navy hull, grey deck.
  const raw=baseBoat(),keep:number[]=[];
  for(let i=0;i<raw.data.length;i+=STRIDE*3){
    const triangle=raw.data.slice(i,i+STRIDE*3);
    const cabin=[0,STRIDE,STRIDE*2].every(j=>triangle[j+1]>=.99&&triangle[j+1]<=2.81&&Math.abs(triangle[j])<=1.151&&triangle[j+2]>=-4.101&&triangle[j+2]<=-1.299&&triangle[j+6]>.92&&triangle[j+7]>.9&&triangle[j+8]>.85);
    if(!cabin)keep.push(...triangle);
  }
  const original={data:new Float32Array(keep),count:keep.length/STRIDE},verts=original.data;
  roundedBox(b,[0,1.92,-2.7],[1.15,.92,1.4],.16,orange);
  roundedBox(b,[0,2.96,-2.7],[1.34,.12,1.64],.105,orange);
  for(let i=0;i<verts.length;i+=STRIDE){
    const x=verts[i],y=verts[i+1],z=verts[i+2],part=verts[i+9];
    const paint=(c:RGB)=>{verts[i+6]=c[0];verts[i+7]=c[1];verts[i+8]=c[2];verts[i+9]=P.OWN;};
    if(Math.floor(part+.001)===P.A)paint(navy);
    else if(z>-4.25&&z<-1.1&&Math.abs(x)<1.25&&y>=1&&y<2.82 &&
      verts[i+6]>.92&&verts[i+7]>.90&&verts[i+8]>.85)paint(orange);
    else if(verts[i+6]>.83&&verts[i+6]<.90&&verts[i+7]>.68&&verts[i+7]<.77&&
      verts[i+8]>.46&&verts[i+8]<.57&&y>.90)paint([.56,.63,.62]);
  }
  // Narrow colour-coded hull stripe remains an instanced part A on each boat.
  for(const side of [-1,1]){
    for(let k=0;k<sections.length-1;k++){
      const a=sections[k],c=sections[k+1];
      rod(b,[side*(a[1]+.02),a[2]-.34,a[0]],[side*(c[1]+.02),c[2]-.34,c[0]],.095,[1,1,1],7,P.A);
    }
    for(const z of [-4.55,-4.13,-3.71])rod(b,[side*1.75,.40,z],[side*1.75,1.37,z],.045,steel);
    rod(b,[side*1.75,.67,-4.58],[side*1.75,.67,-3.70],.05,steel);
    rod(b,[side*1.75,1.15,-4.58],[side*1.75,1.15,-3.70],.05,steel);
  }
  b.box(-.33,.33,3.06,3.42,-3.61,-3.17,orange);
  rod(b,[0,3.11,-3.5],[0,3.78,-3.5],.05,steel);
  b.box(-.58,.58,3.75,3.84,-3.57,-3.43,steel);
  // Forward raked windscreen: three recessed blue panes in a substantial orange surround.
  const windshield=(x0:number,x1:number,y0:number,y1:number,col:RGB,part=0)=>{
    const z=(y:number)=>-1.04-(y-1.9)*.22+(part===P.GLASS?.012:0);
    b.quad([x0,y0,z(y0)],[x1,y0,z(y0)],[x1,y1,z(y1)],[x0,y1,z(y1)],col,part);
  };
  windshield(-1.09,1.09,1.86,2.77,orange);
  for(const x of [-.71,0,.71])windshield(x-.27,x+.27,2.03,2.61,[.12,.27,.34],P.GLASS);
  // Rounded manufactured edges catch the sun; the dark inset windows retain their recess.
  for(const x of [-1.15,1.15])for(const z of [-4.1,-1.3])
    rod(b,[x,1.18,z],[x,2.77,z],.095,orange,12);
  for(const x of [-1.27,1.27])rod(b,[x,2.88,-4.18],[x,2.88,-1.18],.12,orange,12);
  for(const z of [-4.18,-1.18])rod(b,[-1.27,2.88,z],[1.27,2.88,z],.12,orange,12);
  // Vent slats, cleats and a dark rubber anti-slip foredeck.
  b.box(-.77,.77,1.025,1.045,.25,2.5,[.13,.19,.22],13);
  for(const side of [-1,1])for(let i=0;i<5;i++)
    b.box(side*1.168-.012,side*1.168+.012,1.36+i*.085,1.39+i*.085,-3.94,-3.48,rubber,13);
  for(const z of [-.1,2.6])for(const x of [-1.3,1.3]){
    rod(b,[x,1.05,z],[x,1.3,z],.065,steel,8,14);
    rod(b,[x-.19,1.3,z],[x+.19,1.3,z],.065,steel,8,14);
  }
  return soften(join([original,b.done()]));
}

/** Rounded little seafarers, with lifejackets, boots, ears and noses. Same animation contract. */
export function person(hat:boolean):Mesh {
  const original=basePerson(false),d=original.data;
  // Fabric and skin no longer inherit the hard painted-plastic specular response.
  for(let i=0;i<d.length;i+=STRIDE)if(d[i+9]===P.A)d[i+9]=15;
  const b=new Builder(),orange:RGB=[1,.36,.055],strap:RGB=[.12,.16,.19];
  for(const side of [-1,1]){
    b.sphere([side*.15,.53,.19],.16,12,8,orange,15,0,Math.PI,[.83,1.34,.58]);
    b.sphere([side*.13,.07,.07],.13,10,6,strap,13,0,Math.PI,[.8,.6,1.4]);
    b.sphere([side*.285,1.06,0],.065,8,6,[1,1,1],P.B);
    b.box(side*.15-.055,side*.15+.055,.62,.69,.274,.284,[.92,.94,.82],15);
  }
  b.sphere([0,1.055,.28],.066,10,6,[1,1,1],P.B,0,Math.PI,[.8,.9,1]);
  b.box(-.25,.25,.40,.445,.27,.29,strap,13);
  b.box(-.045,.045,.392,.453,.291,.30,[.75,.78,.73],14);
  // A restrained smile, visible in the close inspection view.
  for(let i=0;i<6;i++){
    const x=-.085+i*.034;
    rod(b,[x,.94+Math.abs(x)*.22,.276],[x+.029,.94+Math.abs(x+.029)*.22,.276],.009,[.28,.13,.10],5);
  }
  if(hat){
    b.sphere([0,1.13,-.015],.32,16,8,[.94,.94,.88],0,0,Math.PI*.49);
    b.sphere([0,1.16,.09],.33,16,4,[.94,.94,.88],0,Math.PI*.45,Math.PI*.53,[1,.25,1.14]);
    b.box(-.11,.11,1.27,1.31,.269,.28,[.85,.12,.09]);
  }
  return join([original,b.done()]);
}

// Strata in the vertex part attribute select a mineral shader branch.
const STONE: RGB[]=[[.57,.54,.47],[.63,.59,.51],[.52,.51,.47],[.68,.62,.53],[.54,.55,.51]];
const ROCK_PART=12;
function outcrop(m:Builder,x:number,z:number,h:number,r:number,seed:number,ground=0){
  const rand=seeded(seed),seg=17,off=Array.from({length:seg},()=>.77+rand()*.46);
  const shift=Array.from({length:5},()=>[rand()-.5,rand()-.5]);
  const width=[1.0,1.10,.89,1.04,.65];
  const levels=[ground-2,ground+h*.22,ground+h*.47,ground+h*.76,ground+h];
  const p=(j:number,i:number):V3=>{
    const k=i%seg,angle=k*Math.PI*2/seg;
    const w=width[j]*r*off[k]*(1+.12*Math.sin(k*1.8+j*2.31+seed));
    return [x+shift[j][0]*r*.27+Math.cos(angle)*w,
      levels[j]+r*.12*Math.sin(angle*3.2+j+seed),
      z+shift[j][1]*r*.27+Math.sin(angle)*w];
  };
  m.at();
  for(let j=0;j<4;j++)for(let i=0;i<seg;i++){
    const col=STONE[Math.abs((seed>>>3)+j)%STONE.length];
    m.quad(p(j,i),p(j,(i+1)%seg),p(j+1,(i+1)%seg),p(j+1,i),col,ROCK_PART);
  }
  // Close the rock top: the old ribbons were hollow when viewed from above.
  const cap:V3=[x+shift[4][0]*r*.27,ground+h-.05,z+shift[4][1]*r*.27];
  for(let i=0;i<seg;i++)m.tri(cap,p(4,(i+1)%seg),p(4,i),[.40,.49,.25],0);
  // A fractured talus apron interrupts the clean cone at the base.
  if(r>3){
    m.at(x+r*.30,ground+.1*r,z-.19*r);
    m.lump([0,0,0],r*.40,seed+43,STONE[(seed>>>5)%STONE.length],ROCK_PART,[1.25,.42,1],8,4);
  }
  m.at(x+shift[4][0]*r*.27,ground+h-.17,z+shift[4][1]*r*.27,rand()*6.28,1);
  if(rand()>.37)m.lump([0,0,0],r*.28,seed+17,[.33,.43,.27],0,[1,.12,.65],8,3);
  m.at();
}
/** Stone cottages and slate / old-red roofs, on the same footprint as the original
 * houses: harbour is still Lily's finish, without the pastel tropical village. */
function cottage(m:Builder,d:Decor){
  const rand=seeded(hash(Math.round(d.x),Math.round(d.z),27)),w=2.2,dd=2.0,h=3.05,ridge=1.48;
  const wall:RGB=rand()>.5?[.77,.75,.69]:[.83,.82,.75];
  const roof:RGB=rand()>.68?[.49,.27,.23]:[.25,.31,.35];
  const glass:RGB=[.13,.24,.29],pale:RGB=[.9,.88,.80];
  m.at(d.x,d.y-.25,d.z,d.yaw,d.s);
  m.box(-w,w,0,h,-dd,dd,wall);
  m.quad([-w-.35,h-.12,dd+.30],[w+.35,h-.12,dd+.30],[w+.35,h+ridge,0],[-w-.35,h+ridge,0],roof);
  m.quad([w+.35,h-.12,-dd-.30],[-w-.35,h-.12,-dd-.30],[-w-.35,h+ridge,0],[w+.35,h+ridge,0],roof);
  m.tri([w,h,dd],[w,h,-dd],[w,h+ridge-.05,0],wall);
  m.tri([-w,h,-dd],[-w,h,dd],[-w,h+ridge-.05,0],wall);
  m.box(-.43,.43,.01,1.92,dd,dd+.045,[.25,.31,.32]);
  for(const x of [-1.35,1.35]){
    m.box(x-.43,x+.43,1.15,2.17,dd+.017,dd+.042,pale);
    m.box(x-.33,x+.33,1.25,2.07,dd+.043,dd+.057,glass);
    m.box(x-.023,x+.023,1.25,2.07,dd+.059,dd+.063,pale);
    m.box(x-.33,x+.33,1.61,1.67,dd+.059,dd+.063,pale);
  }
  m.box(1.05,1.49,h+.49,h+ridge+.32,-.65,-.15,wall);
  m.box(1.00,1.53,h+ridge+.32,h+ridge+.44,-.71,-.11,roof);
  m.at();
}
/** Shoreline rock ribbons surround the existing playable channel; the procedural
 * AI and grounding physics still use exactly the original seeded sea. */
export function worldMesh(sea:Sea):Array<{z0:number;z1:number;mesh:Mesh}>{
  const original=baseWorld({...sea,decor:sea.decor.filter(d=>d.kind!=='palm'&&d.kind!=='house')});
  const pieces=new Map<number,Builder>();
  const at=(x:number,z:number)=>{
    const k=Math.floor(z/100),m=pieces.get(k)??new Builder();
    pieces.set(k,m);return m;
  };
  for(const d of sea.decor)if(d.kind==='house')cottage(at(d.x,d.z),d);
  // Overlapping high cliffs along the real shore, not isolated sea cones.
  for(let z=-112;z<1000;z+=16)for(const side of [-1,1]){
    // Break the bilateral cliff corridor into alternating headlands and low coves.
    if(side>0&&Math.sin(z*.025+(sea.seed%17))>.1)continue;
    const boundary=sea.centre(z)+side*sea.half(z);
    let x=boundary;
    for(let i=0;i<12;i++){if(heightAt(sea,x,z)>.9)break;x+=side*2;}
    const n=hash(sea.seed,Math.round(z),side),rand=seeded(n);
    const zz=z+(rand()-.5)*10,xx=x+side*(3+rand()*6),ht=heightAt(sea,xx,zz);
    if(ht>-.2&&ht<12){
      outcrop(at(xx,zz),xx,zz,8+rand()*10,8+rand()*4.6,n,Math.max(0,ht-2));
      if(rand()>.36){
        const xx2=xx+side*(5+rand()*5),zz2=zz+5+rand()*7;
        outcrop(at(xx2,zz2),xx2,zz2,6+rand()*11,4+rand()*3.2,n+17,Math.max(0,heightAt(sea,xx2,zz2)-2));
      }
    }
  }
  for(const [i,island] of sea.islands.entries()){
    const rand=seeded(hash(sea.seed,i,712));
    for(let j=0;j<5;j++){
      const a=j*1.31+rand()*.5,r=island.r*(.17+j*.13);
      const x=island.x+Math.sin(a)*r,z=island.z+Math.cos(a)*r;
      outcrop(at(x,z),x,z,4+rand()*6,3.2+rand()*3.8,hash(i,j,sea.seed),Math.max(-.2,heightAt(sea,x,z)-2));
    }
  }
  const chunks=new Map<number,Mesh>();
  for(const v of original)chunks.set(Math.floor((v.z0+12)/100),v.mesh);
  for(const [k,m] of pieces)chunks.set(k,chunks.has(k)?join([chunks.get(k)!,soften(m.done(),.62)]):soften(m.done(),.62));
  return [...chunks.entries()].sort((a,b)=>a[0]-b[0]).map(([k,mesh])=>({z0:k*100-22,z1:(k+1)*100+22,mesh}));
}

