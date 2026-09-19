/** Bounded river footprint correction, against immutable pre-hydro ground.
 * Never grows from its own output, changes levels, or manufactures bank fill.
 * Candidate counts are raster samples, NOT metres of solved shoreline. */
export interface ShoreContactStats {
  candidates: number; extended: number; noJoin: number; tooHigh: number;
  protected: number; missingGround: number; maxExtensionM: number;
}
export function extendRiverContact(a: {
  width: number; height: number; pixelX: number; pixelZ: number;
  coverage: Float32Array; nearest: Int32Array; owner: Int32Array;
  level: Float32Array; kind: Uint8Array; flowX: Float32Array; flowZ: Float32Array;
  halfWidth: (i: number) => number; falling: (i: number) => boolean;
  ground: (x: number, z: number) => number;
  blocked: (x: number, z: number) => boolean;
  copy: (to: number, from: number, ground: number) => void;
}): ShoreContactStats {
  const stats: ShoreContactStats = { candidates: 0, extended: 0, noJoin: 0,
    tooHigh: 0, protected: 0, missingGround: 0, maxExtensionM: 0 };
  const src = a.coverage.slice(), owner = a.owner.slice(), {width: w, height: h} = a;
  const bilinear = (x: number, z: number): number => {
    const ix = Math.floor(x), iz = Math.floor(z), tx = x-ix, tz = z-iz;
    if (ix < 0 || iz < 0 || ix+1 >= w || iz+1 >= h) return NaN;
    return (src[iz*w+ix]*(1-tx)+src[iz*w+ix+1]*tx)*(1-tz)
      +(src[(iz+1)*w+ix]*(1-tx)+src[(iz+1)*w+ix+1]*tx)*tz;
  };
  for (let i = 0; i < src.length; i++) {
    if (src[i] >= .5) continue;
    const n = a.nearest[i];
    // Only identified rivers/streams; canals and unprofiled areas need their
    // own level/structure authority. Unknown retained sources cannot expand.
    if (n < 0 || owner[n] < 0 || (a.kind[n] !== 7 && a.kind[n] !== 8)
      || a.falling(n) || (src[i] > .005 && owner[i] !== owner[n])) continue;
    const x = i%w, z = Math.floor(i/w), nx = n%w, nz = Math.floor(n/w);
    const dx = (x-nx)*a.pixelX, dz = (z-nz)*a.pixelZ, d = Math.hypot(dx,dz);
    const reach = Math.min(18, Math.max(2, a.halfWidth(n)*.5));
    const pixel = Math.max(a.pixelX,a.pixelZ);
    if (!d || d > reach+pixel*1.5) continue;
    const ux = dx/d, uz = dz/d, speed = Math.hypot(a.flowX[n],a.flowZ[n]);
    // No end-cap growth: this is a lateral bank correction, not an extension
    // downstream over a drop or upstream into an unknown reach.
    if (speed < .001 || Math.abs((ux*a.flowX[n]+uz*a.flowZ[n])/speed) > .5) continue;
    let lo = 0, hi = d;
    for (let k=0;k<12;k++) {
      const m=(lo+hi)/2, c=bilinear(nx+ux*m/a.pixelX,nz+uz*m/a.pixelZ);
      if (c >= .5) lo=m; else hi=m;
    }
    const edge=(lo+hi)/2, ex=nx+ux*edge/a.pixelX, ez=nz+uz*edge/a.pixelZ;
    const g0=a.ground(ex,ez), level=a.level[n];
    if (!Number.isFinite(g0)) { stats.missingGround++; continue; }
    if (level-g0 <= .08) continue;
    stats.candidates++;
    if (level-g0 > 2.5) { stats.tooHigh++; continue; }
    let join=-1, previous=0, previousGap=level-g0, refused=false;
    const step=Math.min(1,reach/8);
    for (let s=0;s<=reach+1e-6;s+=step) {
      const qx=ex+ux*s/a.pixelX, qz=ez+uz*s/a.pixelZ;
      const qix=Math.round(qx), qiz=Math.round(qz);
      if(qix<0||qiz<0||qix>=w||qiz>=h) { stats.missingGround++; refused=true; break; }
      const qi=qiz*w+qix;
      if(a.blocked(qx,qz) || (src[qi]>.005 && owner[qi]!==owner[n])) {
        stats.protected++; refused=true; break;
      }
      const g=a.ground(qx,qz);
      if(!Number.isFinite(g)) { stats.missingGround++; refused=true; break; }
      const gap=level-g;
      if(gap<=0) { join=previous+(s-previous)*previousGap/(previousGap-gap); break; }
      previous=s; previousGap=gap;
    }
    if(refused) continue;
    if(join<0) { stats.noJoin++; continue; }
    const offset=d-edge;
    // A continuous coverage shoulder puts the 0.5 contour at contact.
    // Only the bounded corridor may be painted; do not grow another ring.
    if(offset>join+pixel*.7) continue;
    const amount=Math.max(0,Math.min(1,.5+(join-offset)/(pixel*1.4)));
    if(amount<=src[i]) continue;
    const g=a.ground(x,z);
    if(!Number.isFinite(g)) {stats.missingGround++;continue;}
    a.copy(i,n,g); a.coverage[i]=amount;
    stats.extended++; stats.maxExtensionM=Math.max(stats.maxExtensionM,join);
  }
  return stats;
}
