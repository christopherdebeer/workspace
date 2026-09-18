export interface Support {
  known: boolean; y: number; depth: number; current: number | null;
  blocked: boolean; ocean?: boolean; layer?: string;
}
export type SampleSupport = (x: number, z: number, previousY?: number, radius?: number) => Support;
export interface AnimalPoint { x: number; y: number; z: number; sz: number; sp: number }
export function habitable(s: Support, size: number, leg: number): boolean {
  return s.known && Number.isFinite(s.y) && !s.blocked && !s.ocean &&
    s.depth <= Math.min(.22, leg * .22) * size &&
    (s.depth <= .025 || (s.current !== null && s.current <= .35));
}
/** Sweep the centre and both flanks, following the support layer from the
 * last accepted station. A destination alone cannot detect a crossed ditch. */
export function tracePath(sample: SampleSupport, c: AnimalPoint, x: number, z: number,
  clear: (ax: number, az: number, bx: number, bz: number, y: number) => boolean = () => true) {
  const dx = x - c.x, dz = z - c.z, distance = Math.hypot(dx, dz);
  const n = Math.max(1, Math.ceil(distance / .4));
  const radius = [ .31, .56, .38 ][c.sp] * c.sz, leg = [.92,.82,1.12][c.sp];
  const sideX = distance > .0001 ? -dz / distance : 1, sideZ = distance > .0001 ? dx / distance : 0;
  let px = c.x, pz = c.z, y = c.y, travelled = 0;
  for (let i = 1; i <= n; i++) {
    const nx = c.x + dx * i / n, nz = c.z + dz * i / n, ds = distance / n;
    const middle = sample(nx, nz, y, radius);
    if (!habitable(middle, c.sz, leg) || Math.abs(middle.y-y) > Math.max(.16*c.sz, ds*.65))
      return {x:px,y,z:pz,travelled,complete:false};
    for (const side of [-1, 1]) {
      const ox=sideX*radius*side, oz=sideZ*radius*side;
      const flank = sample(nx+ox,nz+oz,y,radius);
      if (!habitable(flank,c.sz,leg) || Math.abs(flank.y-middle.y)>radius*.75 ||
          !clear(px+ox,pz+oz,nx+ox,nz+oz,Math.min(y,middle.y)+leg*c.sz*.6))
        return {x:px,y,z:pz,travelled,complete:false};
    }
    // Front and rear feet need support too: a centre-only cylinder lets a
    // long animal overhang a bank while its middle remains on dry ground.
    const halfLength=[.70,.85,.90][c.sp]*c.sz;
    const forwardX=distance>.0001?dx/distance:0,forwardZ=distance>.0001?dz/distance:1;
    for(const end of [-1,1]){
      const support=sample(nx+forwardX*halfLength*end,nz+forwardZ*halfLength*end,y,radius);
      if(!habitable(support,c.sz,leg)||Math.abs(support.y-middle.y)>halfLength*.65+.08)
        return {x:px,y,z:pz,travelled,complete:false};
    }
    if (!clear(px,pz,nx,nz,Math.min(y,middle.y)+leg*c.sz*.6))
      return {x:px,y,z:pz,travelled,complete:false};
    px=nx;pz=nz;y=middle.y;travelled=distance*i/n;
  }
  return {x:px,y,z:pz,travelled,complete:true};
}
export function random(seed: number): () => number {
  let a = seed | 0;
  return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
export function seedString(value: string): number {
  let h = 2166136261; for (let i=0;i<value.length;i++) h=Math.imul(h^value.charCodeAt(i),16777619); return h>>>0;
}
export function gaitFoot(phase: number, leg: number, speed: number, size: number): {stance:boolean; z:number; lift:number} {
  // Walk -> diagonal trot -> paired gallop; phase advances with travelled
  // distance, so stopped animals do not treadmill and a blocked dash stops.
  const walk=[0,.5,.75,.25], trot=[0,.5,.5,0], gallop=[0,.13,.52,.65];
  const blend=Math.max(0,Math.min(1,(speed-1.6)/2.5));
  const run=Math.max(0,Math.min(1,(speed-6)/5));
  const offset=(walk[leg]*(1-blend)+trot[leg]*blend)*(1-run)+gallop[leg]*run;
  const p=((phase/(Math.PI*2)+offset)%1+1)%1, duty=.66-.23*run;
  const stride=(.38+.30*Math.min(1,speed/5))*Math.min(1,speed/.7);
  const t=p<duty?p/duty:(p-duty)/(1-duty);
  return {stance:p<duty,z:stride*(p<duty?.5-t:t-.5),lift:p<duty?0:Math.sin(Math.PI*t)*(.12+.16*run)*Math.min(1,speed/.7)};
}
