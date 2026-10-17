/** Ordered garment contact: triangle broadphase, outer vertices against inner cloth surfaces.
 * Separate garments keep separate recipes/materials. Contacts do not stitch or pin layers together. */
import type { Cloth } from './cloth';
export function collideLayers(inner:Cloth,outer:Cloth,thickness=.45):number {
 const cell=5,bins=new Map<string,number[]>(),a=inner.pos,b=outer.pos,T=inner.tris;
 const key=(x:number,y:number,z:number)=>`${x},${y},${z}`;
 for(let t=0;t<T.length;t+=3){const ids=[T[t]*3,T[t+1]*3,T[t+2]*3];const lo=[0,1,2].map(c=>Math.floor((Math.min(...ids.map(i=>a[i+c]))-thickness)/cell)),hi=[0,1,2].map(c=>Math.floor((Math.max(...ids.map(i=>a[i+c]))+thickness)/cell));if((hi[0]-lo[0]+1)*(hi[1]-lo[1]+1)*(hi[2]-lo[2]+1)>100)continue;for(let x=lo[0];x<=hi[0];x++)for(let y=lo[1];y<=hi[1];y++)for(let z=lo[2];z<=hi[2];z++){const k=key(x,y,z);if(!bins.has(k))bins.set(k,[]);bins.get(k)!.push(t);}}
 let contacts=0;
 for(let i=0;i<outer.n;i++){if(!outer.inv[i])continue;const p=i*3,ts=bins.get(key(Math.floor(b[p]/cell),Math.floor(b[p+1]/cell),Math.floor(b[p+2]/cell)));if(!ts)continue;
  for(const t of ts){const ia=T[t]*3,ib=T[t+1]*3,ic=T[t+2]*3;const ux=a[ib]-a[ia],uy=a[ib+1]-a[ia+1],uz=a[ib+2]-a[ia+2],vx=a[ic]-a[ia],vy=a[ic+1]-a[ia+1],vz=a[ic+2]-a[ia+2];let nx=uy*vz-uz*vy,ny=uz*vx-ux*vz,nz=ux*vy-uy*vx;const L=Math.hypot(nx,ny,nz);if(L<1e-8)continue;nx/=L;ny/=L;nz/=L;
   // Consistent outward side at the torso/waist, where separate garment families overlap.
   if(nx*a[ia]+nz*a[ia+2]<0){nx=-nx;ny=-ny;nz=-nz;}
   const dx=b[p]-a[ia],dy=b[p+1]-a[ia+1],dz=b[p+2]-a[ia+2],dist=dx*nx+dy*ny+dz*nz;if(dist>=thickness||dist<-.8)continue;
   const d00=ux*ux+uy*uy+uz*uz,d01=ux*vx+uy*vy+uz*vz,d11=vx*vx+vy*vy+vz*vz,d20=dx*ux+dy*uy+dz*uz,d21=dx*vx+dy*vy+dz*vz,den=d00*d11-d01*d01;if(den<1e-9)continue;const v=(d11*d20-d01*d21)/den,w=(d00*d21-d01*d20)/den;if(v<0||w<0||v+w>1)continue;
   const push=Math.min(.6,thickness-dist);b[p]+=nx*push;b[p+1]+=ny*push;b[p+2]+=nz*push;
   // Position correction alone must not inject a velocity impulse.
   outer.prev[p]+=nx*push;outer.prev[p+1]+=ny*push;outer.prev[p+2]+=nz*push;contacts++;
  }
 }
 if(contacts){outer.version++;outer.normals();}return contacts;
}
