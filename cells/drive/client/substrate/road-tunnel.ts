import type { StructureRecipe } from '../infrastructure';
import {
  buildCulvertHeadwallGeometry,
  type CulvertHeadwallGeometry,
} from './culvert-detail';

export interface ProductionTunnelWall {
  ax: number; az: number; bx: number; bz: number; ya: number; yb: number;
}
export interface ProductionGalleryInput {
  stations: readonly (readonly [number, number])[];
  profileY: readonly number[];
  widthM: number;
  liftM: number;
  roofHeightM: number;
  uphillSide: 1 | -1;
  columnAllowed?: (x: number, z: number) => boolean;
}
export interface ProductionGalleryGeometry {
  positions: Float32Array<ArrayBuffer>;
  walls: ProductionTunnelWall[];
  refusedColumns: number;
}
export interface ProductionTunnelInput {
  stations: readonly (readonly [number, number])[];
  profileY: readonly number[];
  terrainY: readonly number[];
  start: number;
  end: number;
  widthM: number;
  liftM: number;
  roofHeightM: number;
  recipe?: Pick<StructureRecipe, 'family' | 'lighting'>;
}
export interface ProductionTunnelGeometry {
  shellPositions: Float32Array<ArrayBuffer>;
  lampPositions: Float32Array<ArrayBuffer>;
  portals: CulvertHeadwallGeometry[];
  walls: ProductionTunnelWall[];
  ceilingY: Float32Array<ArrayBuffer>;
}

const clamp = (value: number, low: number, high: number): number =>
  Math.max(low, Math.min(high, value));
const quad = (
  output: number[],
  a: readonly [number, number, number],
  b: readonly [number, number, number],
  c: readonly [number, number, number],
  d: readonly [number, number, number],
): void => { output.push(...a, ...b, ...c, ...b, ...d, ...c); };
const offsets = (
  stations: readonly (readonly [number, number])[],
  start: number,
  end: number,
  halfWidthM: number,
): Array<readonly [number, number]> => {
  const bay = (index: number): readonly [number, number] => {
    const station = clamp(index, start, end - 1);
    const dx = stations[station + 1][0] - stations[station][0];
    const dz = stations[station + 1][1] - stations[station][1];
    const length = Math.hypot(dx, dz) || 1;
    return [-dz / length, dx / length];
  };
  return Array.from({ length: end - start + 1 }, (_, offset) => {
    const station = start + offset;
    const [ax, az] = bay(station - 1);
    const [bx, bz] = bay(station);
    const mx = (ax + bx) * .5;
    const mz = (az + bz) * .5;
    const magnitude = Math.hypot(mx, mz);
    if (magnitude < .2) return [bx * halfWidthM, bz * halfWidthM] as const;
    const scale = halfWidthM * clamp(1 / magnitude, 1, 2.4);
    return [mx / magnitude * scale, mz / magnitude * scale] as const;
  });
};
const validate = (
  stations: readonly unknown[],
  ...arrays: readonly (readonly unknown[])[]
): void => {
  if (stations.length < 2 || arrays.some((array) => array.length !== stations.length)) {
    throw new Error('road shell station arrays must have matching lengths');
  }
};

/** Author final gallery roof, wall and column arrays from the solved profile. */
export function buildProductionGalleryGeometry(
  input: ProductionGalleryInput,
): ProductionGalleryGeometry {
  validate(input.stations, input.profileY);
  const off = offsets(input.stations, 0, input.stations.length - 1, input.widthM / 2 + .7);
  const positions: number[] = [];
  const walls: ProductionTunnelWall[] = [];
  let refusedColumns = 0;
  let columnRunM = 6;
  for (let station = 0; station < input.stations.length - 1; station++) {
    const [x0, z0] = input.stations[station];
    const [x1, z1] = input.stations[station + 1];
    const [ax, az] = off[station];
    const [bx, bz] = off[station + 1];
    const floorA = input.profileY[station] + input.liftM;
    const floorB = input.profileY[station + 1] + input.liftM;
    const roofA = floorA + input.roofHeightM;
    const roofB = floorB + input.roofHeightM;
    quad(positions, [x0+ax,roofA,z0+az], [x1+bx,roofB,z1+bz],
      [x0-ax,roofA,z0-az], [x1-bx,roofB,z1-bz]);
    const uax = ax * input.uphillSide, uaz = az * input.uphillSide;
    const ubx = bx * input.uphillSide, ubz = bz * input.uphillSide;
    quad(positions, [x0+uax,floorA,z0+uaz], [x1+ubx,floorB,z1+ubz],
      [x0+uax,roofA,z0+uaz], [x1+ubx,roofB,z1+ubz]);
    walls.push({ ax:x0+uax, az:z0+uaz, bx:x1+ubx, bz:z1+ubz, ya:roofA, yb:roofB });
    columnRunM += Math.hypot(x1 - x0, z1 - z0) || 1;
    if (columnRunM < 9) continue;
    const x = x0 - uax, z = z0 - uaz;
    if (input.columnAllowed && !input.columnAllowed(x, z)) {
      refusedColumns++;
      continue;
    }
    columnRunM = 0;
    quad(positions, [x-.3,floorA,z], [x+.3,floorA,z], [x-.3,roofA,z], [x+.3,roofA,z]);
    quad(positions, [x,floorA,z-.3], [x,floorA,z+.3], [x,roofA,z-.3], [x,roofA,z+.3]);
  }
  return { positions: new Float32Array(positions), walls, refusedColumns };
}

/** Author final tunnel shell, lamp and portal arrays from the solved chord. */
export function buildProductionTunnelGeometry(
  input: ProductionTunnelInput,
): ProductionTunnelGeometry {
  validate(input.stations, input.profileY, input.terrainY);
  if (input.start < 0 || input.end >= input.stations.length || input.end <= input.start) {
    throw new Error('production tunnel bounds are invalid');
  }
  const ceilingY = new Float32Array(input.stations.length);
  for (let station = 0; station < input.stations.length; station++) {
    const nominal = input.profileY[station] + input.liftM + input.roofHeightM;
    ceilingY[station] = station <= input.start + 1 || station >= input.end - 1
      ? nominal : Math.min(nominal, input.terrainY[station] - .4);
  }
  const off = offsets(input.stations, input.start, input.end, input.widthM / 2 + .6);
  const shell: number[] = [];
  const walls: ProductionTunnelWall[] = [];
  for (let station = input.start; station < input.end; station++) {
    const [x0,z0] = input.stations[station], [x1,z1] = input.stations[station+1];
    const [ax,az] = off[station-input.start], [bx,bz] = off[station+1-input.start];
    const floorA = input.profileY[station]+input.liftM;
    const floorB = input.profileY[station+1]+input.liftM;
    const roofA = ceilingY[station], roofB = ceilingY[station+1];
    quad(shell,[x0+ax,floorA,z0+az],[x1+bx,floorB,z1+bz],[x0+ax,roofA,z0+az],[x1+bx,roofB,z1+bz]);
    quad(shell,[x0-ax,floorA,z0-az],[x1-bx,floorB,z1-bz],[x0-ax,roofA,z0-az],[x1-bx,roofB,z1-bz]);
    quad(shell,[x0+ax,roofA,z0+az],[x1+bx,roofB,z1+bz],[x0-ax,roofA,z0-az],[x1-bx,roofB,z1-bz]);
    const top = Math.max(roofA, roofB);
    walls.push(
      { ax:x0+ax,az:z0+az,bx:x1+bx,bz:z1+bz,ya:top,yb:top },
      { ax:x0-ax,az:z0-az,bx:x1-bx,bz:z1-bz,ya:top,yb:top },
    );
  }
  const lamps: number[] = [];
  const every = input.recipe?.lighting === 'none' ? Infinity
    : input.recipe?.lighting === 'portal' ? 36
      : input.recipe?.lighting === 'continuous' ? 12 : 24;
  let run = every * .5;
  for (let station = input.start; station < input.end; station++) {
    const [x0,z0] = input.stations[station], [x1,z1] = input.stations[station+1];
    const dx=x1-x0, dz=z1-z0, length=Math.hypot(dx,dz)||1;
    run += length;
    if (run < every) continue;
    run = 0;
    const ux=dx/length, uz=dz/length, px=-uz*.4, pz=ux*.4;
    const x=x0+ux*.9, z=z0+uz*.9, y=ceilingY[station]-.18;
    quad(lamps,[x+px,y,z+pz],[x+px+ux*1.4,y,z+pz+uz*1.4],
      [x-px,y,z-pz],[x-px+ux*1.4,y,z-pz+uz*1.4]);
  }
  const portals: CulvertHeadwallGeometry[] = [];
  const raw = input.recipe?.family === 'rock' || input.recipe?.family === 'gallery';
  for (const end of [input.start, input.end]) {
    const i0=end===input.start?input.start:input.end-1, i1=end===input.start?input.start+1:input.end;
    const [x0,z0]=input.stations[i0], [x1,z1]=input.stations[i1], [x,z]=input.stations[end];
    const height = raw ? .9 : 1.6;
    const portal=buildCulvertHeadwallGeometry({
      x,z,bottomY:ceilingY[end]+.3-height/2,topY:ceilingY[end]+.3+height/2,
      widthM:input.widthM+(raw?1.8:3),depthM:raw ? .8 : 1.2,
      rotationY:Math.atan2(z1-z0,x1-x0)+Math.PI/2,
    });
    if (portal) portals.push(portal);
  }
  return {
    shellPositions:new Float32Array(shell),
    lampPositions:new Float32Array(lamps),
    portals,walls,ceilingY,
  };
}
