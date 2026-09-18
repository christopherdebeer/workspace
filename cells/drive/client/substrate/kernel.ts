import {
  CROSSING_ID,
  DRIVE_MATERIAL,
  GROUND_MATERIAL,
  WATER_STATE,
  type CorridorStation,
  type CrossingKind,
  type DriveMaterial,
  type GroundMaterialId,
  type GroundMaterialName,
  type ResolvedCrossing,
  type ResolvedSubstrateTile,
  type SubstrateBounds,
  type SubstrateContact,
  type SubstrateElevation,
  type SubstrateTileInput,
} from './types';
import { resolveFluidContact } from './contact';

const clamp = (v: number, lo: number, hi: number): number =>
  Math.max(lo, Math.min(hi, v));
const smoothstep = (lo: number, hi: number, value: number): number => {
  if (hi <= lo) return value >= hi ? 1 : 0;
  const t = clamp((value - lo) / (hi - lo), 0, 1);
  return t * t * (3 - 2 * t);
};
const mix = (a: number, b: number, t: number): number => a + (b - a) * t;

interface Projection {
  x: number;
  z: number;
  yM: number;
  distanceM: number;
  nM: number;
  sM: number;
  tangent: [number, number];
}

function cumulative(stations: readonly CorridorStation[]): Float64Array {
  const out = new Float64Array(stations.length);
  for (let i = 1; i < stations.length; i++) {
    out[i] = out[i - 1] + Math.hypot(
      stations[i].x - stations[i - 1].x,
      stations[i].z - stations[i - 1].z,
    );
  }
  return out;
}

function project(
  stations: readonly CorridorStation[],
  along: Float64Array,
  x: number,
  z: number,
): Projection {
  let best: Projection | undefined;
  for (let i = 1; i < stations.length; i++) {
    const a = stations[i - 1], b = stations[i];
    const dx = b.x - a.x, dz = b.z - a.z;
    const length = Math.hypot(dx, dz);
    if (length < 1e-6) continue;
    const t = clamp(((x - a.x) * dx + (z - a.z) * dz) / (length * length), 0, 1);
    const px = a.x + dx * t, pz = a.z + dz * t;
    const ox = x - px, oz = z - pz;
    const distanceM = Math.hypot(ox, oz);
    if (best && distanceM >= best.distanceM) continue;
    const tx = dx / length, tz = dz / length;
    best = {
      x: px,
      z: pz,
      yM: mix(a.yM, b.yM, t),
      distanceM,
      nM: tx * oz - tz * ox,
      sM: along[i - 1] + length * t,
      tangent: [tx, tz],
    };
  }
  if (best) return best;
  const a = stations[0];
  return {
    x: a?.x ?? x,
    z: a?.z ?? z,
    yM: a?.yM ?? 0,
    distanceM: a ? Math.hypot(x - a.x, z - a.z) : Infinity,
    nM: 0,
    sM: 0,
    tangent: [1, 0],
  };
}

interface SegmentIntersection {
  x: number;
  z: number;
}

function segmentIntersection(
  a: CorridorStation,
  b: CorridorStation,
  c: CorridorStation,
  d: CorridorStation,
): SegmentIntersection | undefined {
  const rx = b.x - a.x, rz = b.z - a.z;
  const sx = d.x - c.x, sz = d.z - c.z;
  const den = rx * sz - rz * sx;
  if (Math.abs(den) < 1e-8) return undefined;
  const qx = c.x - a.x, qz = c.z - a.z;
  const t = (qx * sz - qz * sx) / den;
  const u = (qx * rz - qz * rx) / den;
  if (t < 0 || t > 1 || u < 0 || u > 1) return undefined;
  return { x: a.x + rx * t, z: a.z + rz * t };
}

function findIntersection(input: SubstrateTileInput): SegmentIntersection {
  for (let ri = 1; ri < input.road.stations.length; ri++) {
    for (let wi = 1; wi < input.water.stations.length; wi++) {
      const hit = segmentIntersection(
        input.road.stations[ri - 1],
        input.road.stations[ri],
        input.water.stations[wi - 1],
        input.water.stations[wi],
      );
      if (hit) return hit;
    }
  }
  throw new Error(`substrate ${input.key}: road and water corridors do not intersect`);
}

export function resolveCrossingKind(input: SubstrateTileInput): CrossingKind {
  const evidence = input.crossing;
  if (evidence.intent !== 'auto') return evidence.intent;
  if (evidence.bridgeTagged || (input.road.layer ?? 0) > 0) return 'bridge';
  if (evidence.fordTagged) return 'ford';
  if (evidence.culvertTagged) return 'culvert';
  if ((input.road.tier ?? 1) <= 1
    && input.water.depthM <= .75
    && input.water.halfWidthM <= 5) return 'ford';
  if ((evidence.availableClearanceM ?? 0) >= .6
    && input.water.halfWidthM <= 6) return 'culvert';
  return 'causeway';
}

export function resolveCrossing(input: SubstrateTileInput): ResolvedCrossing {
  if (input.road.stations.length < 2 || input.water.stations.length < 2) {
    throw new Error(`substrate ${input.key}: each corridor needs at least two stations`);
  }
  const hit = findIntersection(input);
  const roadAlong = cumulative(input.road.stations);
  const waterAlong = cumulative(input.water.stations);
  const road = project(input.road.stations, roadAlong, hit.x, hit.z);
  const water = project(input.water.stations, waterAlong, hit.x, hit.z);
  const waterSurfaceM = water.yM + input.water.depthM;
  const kind = resolveCrossingKind(input);
  const clearance = input.crossing.bridgeClearanceM ?? 2.4;
  const roadDeckM = kind === 'bridge'
    ? Math.max(road.yM, waterSurfaceM + clearance)
    : kind === 'culvert'
      ? Math.max(road.yM, waterSurfaceM + .62)
      : kind === 'ford'
        ? water.yM + .12
        : Math.max(road.yM, waterSurfaceM + .38);
  return {
    id: `${input.road.id}×${input.water.id}`,
    kind,
    x: hit.x,
    z: hit.z,
    roadS: road.sM,
    waterS: water.sM,
    roadTangent: road.tangent,
    waterTangent: water.tangent,
    spanRoadM: input.water.halfWidthM * 2 + Math.min(8, input.water.bankWidthM),
    spanWaterM: (input.road.halfWidthM + input.road.shoulderM) * 2,
    approachM: input.crossing.approachM ?? 20,
    roadDeckM,
    waterSurfaceM,
    waterBedM: water.yM,
  };
}

function sampleElevation(
  elevation: SubstrateElevation,
  bounds: SubstrateBounds,
  x: number,
  z: number,
): number {
  const u = clamp((x - bounds.minX) / Math.max(1e-6, bounds.maxX - bounds.minX), 0, 1)
    * (elevation.width - 1);
  const v = clamp((z - bounds.minZ) / Math.max(1e-6, bounds.maxZ - bounds.minZ), 0, 1)
    * (elevation.height - 1);
  const x0 = Math.floor(u), z0 = Math.floor(v);
  const x1 = Math.min(elevation.width - 1, x0 + 1);
  const z1 = Math.min(elevation.height - 1, z0 + 1);
  const tx = u - x0, tz = v - z0;
  const a = mix(elevation.data[z0 * elevation.width + x0],
    elevation.data[z0 * elevation.width + x1], tx);
  const b = mix(elevation.data[z1 * elevation.width + x0],
    elevation.data[z1 * elevation.width + x1], tx);
  return mix(a, b, tz);
}

function groundMaterialName(id: number): GroundMaterialName {
  switch (id) {
    case GROUND_MATERIAL.cut: return 'cut';
    case GROUND_MATERIAL.fill: return 'fill';
    case GROUND_MATERIAL.riverbed: return 'riverbed';
    case GROUND_MATERIAL.bank: return 'bank';
    case GROUND_MATERIAL.shoulder: return 'shoulder';
    default: return 'terrain';
  }
}

function driveMaterialName(id: number): DriveMaterial {
  if (id === DRIVE_MATERIAL.gravel) return 'gravel';
  if (id === DRIVE_MATERIAL.ford) return 'ford';
  return 'asphalt';
}

export function buildSubstrateTile(input: SubstrateTileInput): ResolvedSubstrateTile {
  const n = Math.max(3, Math.floor(input.resolution));
  if (input.elevation.width < 2 || input.elevation.height < 2
    || input.elevation.data.length !== input.elevation.width * input.elevation.height) {
    throw new Error(`substrate ${input.key}: invalid elevation grid`);
  }
  const crossing = resolveCrossing(input);
  const count = n * n;
  const groundY = new Float32Array(count);
  const groundMaterial = new Uint8Array(count);
  const driveY = new Float32Array(count); driveY.fill(NaN);
  const driveMaterial = new Uint8Array(count);
  const waterY = new Float32Array(count); waterY.fill(NaN);
  const waterBedY = new Float32Array(count); waterBedY.fill(NaN);
  const waterDepthM = new Float32Array(count);
  const waterShoreDistanceM = new Float32Array(count);
  const waterFlowX = new Float32Array(count);
  const waterFlowZ = new Float32Array(count);
  const waterSpeedMps = new Float32Array(count);
  const waterEnergy = new Float32Array(count);
  const waterVorticity = new Float32Array(count);
  const waterState = new Uint8Array(count);
  const crossingId = new Uint8Array(count);
  const roadAlong = cumulative(input.road.stations);
  const waterAlong = cumulative(input.water.stations);
  const spanX = input.bounds.maxX - input.bounds.minX;
  const spanZ = input.bounds.maxZ - input.bounds.minZ;
  const halfStructure = crossing.spanRoadM * .5;

  for (let iz = 0; iz < n; iz++) {
    const z = input.bounds.minZ + (iz / (n - 1)) * spanZ;
    for (let ix = 0; ix < n; ix++) {
      const x = input.bounds.minX + (ix / (n - 1)) * spanX;
      const i = iz * n + ix;
      const base = sampleElevation(input.elevation, input.bounds, x, z);
      const road = project(input.road.stations, roadAlong, x, z);
      const water = project(input.water.stations, waterAlong, x, z);
      const absWaterN = Math.abs(water.nM);
      const absRoadN = Math.abs(road.nM);
      const waterSurface = water.yM + input.water.depthM;
      const inWater = absWaterN <= input.water.halfWidthM;
      const inBank = absWaterN <= input.water.halfWidthM + input.water.bankWidthM;
      const inRoad = absRoadN <= input.road.halfWidthM;
      const inRoadEarthwork = absRoadN <= input.road.halfWidthM + input.road.shoulderM;
      const roadDistanceFromCrossing = Math.abs(road.sM - crossing.roadS);
      const inStructureSpan = roadDistanceFromCrossing <= halfStructure;
      const approach = 1 - smoothstep(
        halfStructure,
        halfStructure + crossing.approachM,
        roadDistanceFromCrossing,
      );

      let ground = base;
      let material: GroundMaterialId = GROUND_MATERIAL.terrain;
      let channelBed = base;
      if (inBank) {
        const edgeBed = waterSurface - .08;
        if (inWater) {
          const across = clamp(absWaterN / Math.max(.01, input.water.halfWidthM), 0, 1);
          channelBed = mix(water.yM, edgeBed, Math.pow(across, 1.65));
          if (channelBed < ground) ground = channelBed;
          material = GROUND_MATERIAL.riverbed;
        } else {
          const bankT = smoothstep(
            input.water.halfWidthM,
            input.water.halfWidthM + input.water.bankWidthM,
            absWaterN,
          );
          const bankTarget = mix(edgeBed, base, bankT);
          if (bankTarget < ground) ground = bankTarget;
          channelBed = ground;
          material = GROUND_MATERIAL.bank;
        }
      }

      let deck = mix(road.yM, crossing.roadDeckM, approach);
      const bridgeAir = crossing.kind === 'bridge' && inStructureSpan;
      if (inRoadEarthwork && !bridgeAir) {
        const roadWeight = 1 - smoothstep(
          input.road.halfWidthM,
          input.road.halfWidthM + input.road.shoulderM,
          absRoadN,
        );
        const target = deck - input.road.thicknessM;
        const prior = ground;
        ground = mix(ground, target, roadWeight);
        if (roadWeight > .01) {
          material = absRoadN > input.road.halfWidthM
            ? GROUND_MATERIAL.shoulder
            : target < prior ? GROUND_MATERIAL.cut : GROUND_MATERIAL.fill;
        }
      }

      if (inRoad) {
        driveY[i] = deck;
        driveMaterial[i] = crossing.kind === 'ford' && inStructureSpan
          ? DRIVE_MATERIAL.ford
          : input.road.material === 'gravel' ? DRIVE_MATERIAL.gravel : DRIVE_MATERIAL.asphalt;
      }

      if (inWater) {
        waterY[i] = waterSurface;
        waterBedY[i] = channelBed;
        waterShoreDistanceM[i] = Math.max(0, input.water.halfWidthM - absWaterN);
        waterFlowX[i] = water.tangent[0];
        waterFlowZ[i] = water.tangent[1];
        waterSpeedMps[i] = Math.max(0, input.water.flowSpeedMps);
        const overlap = inRoadEarthwork && inStructureSpan;
        if (crossing.kind === 'causeway' && overlap) {
          waterState[i] = WATER_STATE.blocked;
        } else if (crossing.kind === 'culvert' && overlap) {
          waterState[i] = WATER_STATE.hidden;
          waterDepthM[i] = Math.max(.05, waterSurface - channelBed);
        } else {
          waterState[i] = WATER_STATE.exposed;
          const floor = crossing.kind === 'ford' && inRoad && inStructureSpan
            ? deck : channelBed;
          waterDepthM[i] = Math.max(.05, waterSurface - floor);
        }

        const regimeEnergy = input.water.regime === 'rapid' ? .48
          : input.water.regime === 'riffle' ? .28
            : input.water.regime === 'run' ? .12 : .04;
        let energy = clamp(
          regimeEnergy
          + input.water.roughness * .28
          + input.water.flowSpeedMps / 7 * .42,
          0,
          1,
        );
        let vorticity = 0;
        const waterDistance = water.sM - crossing.waterS;
        const halfOpening = crossing.spanWaterM * .5;
        const edgeDistance = Math.abs(Math.abs(waterDistance) - halfOpening);
        const bankFactor = smoothstep(0, input.water.halfWidthM, absWaterN);
        if (crossing.kind === 'ford') {
          const disturbance = Math.exp(-Math.abs(waterDistance) / 12);
          energy = clamp(energy + disturbance * .35, 0, 1);
          vorticity = Math.sign(water.nM || 1) * disturbance * bankFactor * .22;
        } else if (crossing.kind === 'culvert') {
          const mouth = Math.exp(-edgeDistance / 4.5);
          const downstream = waterDistance > halfOpening ? 1 : .45;
          energy = clamp(energy + mouth * downstream * .58, 0, 1);
          vorticity = Math.sign(water.nM || 1) * mouth * downstream * bankFactor * .62;
        } else if (crossing.kind === 'causeway') {
          const impoundment = Math.exp(-edgeDistance / 5.5);
          const upstream = waterDistance < -halfOpening ? 1 : .35;
          energy = clamp(energy + impoundment * upstream * .46, 0, 1);
          vorticity = Math.sign(water.nM || 1) * impoundment * upstream * bankFactor * .72;
        }
        waterEnergy[i] = energy;
        waterVorticity[i] = vorticity;
      }

      if (inRoadEarthwork && inStructureSpan) {
        crossingId[i] = CROSSING_ID[crossing.kind];
      }
      groundY[i] = ground;
      groundMaterial[i] = material;
    }
  }

  return {
    schemaVersion: 1,
    key: input.key,
    revision: input.revision,
    bounds: input.bounds,
    resolution: n,
    crossing,
    roadId: input.road.id,
    roadQuality: clamp(input.road.quality, 0, 1),
    waterId: input.water.id,
    waterKind: input.water.kind,
    waterRegime: input.water.regime,
    bedMaterial: input.water.bedMaterial,
    bankMaterial: input.water.bankMaterial,
    groundY,
    groundMaterial,
    driveY,
    driveMaterial,
    waterY,
    waterBedY,
    waterDepthM,
    waterShoreDistanceM,
    waterFlowX,
    waterFlowZ,
    waterSpeedMps,
    waterEnergy,
    waterVorticity,
    waterState,
    crossingId,
  };
}

function bilinear(
  values: Float32Array<ArrayBuffer>,
  n: number,
  fx: number,
  fz: number,
  fallback: number,
): number {
  const x0 = Math.floor(fx), z0 = Math.floor(fz);
  const x1 = Math.min(n - 1, x0 + 1), z1 = Math.min(n - 1, z0 + 1);
  const tx = fx - x0, tz = fz - z0;
  const a = values[z0 * n + x0], b = values[z0 * n + x1];
  const c = values[z1 * n + x0], d = values[z1 * n + x1];
  if (![a, b, c, d].every(Number.isFinite)) return fallback;
  return mix(mix(a, b, tx), mix(c, d, tx), tz);
}

export function sampleSubstrate(
  tile: ResolvedSubstrateTile,
  x: number,
  z: number,
): SubstrateContact | undefined {
  const { bounds, resolution: n } = tile;
  if (x < bounds.minX || x > bounds.maxX || z < bounds.minZ || z > bounds.maxZ) {
    return undefined;
  }
  const fx = clamp((x - bounds.minX) / Math.max(1e-6, bounds.maxX - bounds.minX), 0, 1) * (n - 1);
  const fz = clamp((z - bounds.minZ) / Math.max(1e-6, bounds.maxZ - bounds.minZ), 0, 1) * (n - 1);
  const ix = clamp(Math.round(fx), 0, n - 1);
  const iz = clamp(Math.round(fz), 0, n - 1);
  const i = iz * n + ix;
  const groundFallback = tile.groundY[i];
  const groundY = bilinear(tile.groundY, n, fx, fz, groundFallback);
  const sx = (bounds.maxX - bounds.minX) / (n - 1);
  const sz = (bounds.maxZ - bounds.minZ) / (n - 1);
  const left = tile.groundY[iz * n + Math.max(0, ix - 1)];
  const right = tile.groundY[iz * n + Math.min(n - 1, ix + 1)];
  const up = tile.groundY[Math.max(0, iz - 1) * n + ix];
  const down = tile.groundY[Math.min(n - 1, iz + 1) * n + ix];
  const nx = -(right - left) / Math.max(1e-6, sx * 2);
  const nz = -(down - up) / Math.max(1e-6, sz * 2);
  const normalLength = Math.hypot(nx, 1, nz) || 1;
  const crossing = tile.crossingId[i]
    ? tile.crossing.kind
    : undefined;
  const ground = {
    yM: groundY,
    normal: [nx / normalLength, 1 / normalLength, nz / normalLength] as const,
    material: groundMaterialName(tile.groundMaterial[i]),
  };
  const contact: SubstrateContact = {
    x,
    z,
    ground,
    support: {
      kind: 'ground',
      yM: ground.yM,
      material: ground.material,
    },
    crossing,
    blockedWater: tile.waterState[i] === WATER_STATE.blocked,
  };

  if (Number.isFinite(tile.driveY[i])) {
    contact.drive = {
      yM: bilinear(tile.driveY, n, fx, fz, tile.driveY[i]),
      material: driveMaterialName(tile.driveMaterial[i]),
      quality: tile.driveMaterial[i] === DRIVE_MATERIAL.ford
        ? tile.roadQuality * .55
        : tile.roadQuality,
      roadId: tile.roadId,
    };
    contact.support = {
      kind: 'drive',
      yM: contact.drive.yM,
      material: contact.drive.material,
      featureId: contact.drive.roadId,
    };
  }
  if (tile.waterState[i] === WATER_STATE.exposed || tile.waterState[i] === WATER_STATE.hidden) {
    contact.water = {
      source: 'resolved-substrate',
      kind: tile.waterKind,
      yM: bilinear(tile.waterY, n, fx, fz, tile.waterY[i]),
      bedY: bilinear(tile.waterBedY, n, fx, fz, tile.waterBedY[i]),
      depthM: tile.waterDepthM[i],
      coverage: 1,
      shoreDistanceM: tile.waterShoreDistanceM[i],
      flow: [tile.waterFlowX[i], tile.waterFlowZ[i]],
      speedMps: tile.waterSpeedMps[i],
      speedAuthority: 'resolved',
      energy: tile.waterEnergy[i],
      vorticity: tile.waterVorticity[i],
      fetchM: null,
      regime: tile.waterRegime,
      bedMaterial: tile.bedMaterial,
      bankMaterial: tile.bankMaterial,
      intermittent: false,
      tidal: false,
      exposed: tile.waterState[i] === WATER_STATE.exposed,
      waterId: tile.waterId,
    };
    contact.fluid = resolveFluidContact(contact.water, contact.support);
  }
  if (crossing === 'bridge' && contact.drive) {
    contact.structure = {
      kind: 'bridge-deck',
      bottomY: contact.drive.yM - .72,
      topY: contact.drive.yM,
    };
  } else if (crossing === 'culvert' && contact.drive && contact.water) {
    contact.structure = {
      kind: 'culvert-roof',
      bottomY: Math.min(contact.drive.yM - .22, contact.water.yM + .28),
      topY: contact.drive.yM - .08,
    };
  } else if (crossing === 'causeway' && contact.drive) {
    contact.structure = {
      kind: 'causeway-fill',
      bottomY: tile.waterBedY[i],
      topY: contact.drive.yM - .08,
    };
  }
  return contact;
}
