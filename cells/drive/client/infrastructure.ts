/**
 * Deterministic infrastructure grammar.
 *
 * Pure arithmetic only: no THREE, DOM, tile state, or mutable PRNG. Callers pass
 * stable geographic/cultural facts and receive a recipe plus canonical support
 * stations. Rendering and world collision queries remain in main.ts.
 */

export type InfrastructureKind = 'bridge' | 'tunnel' | 'conduit';
export type BridgeFamily = 'slab' | 'beam' | 'viaduct' | 'arch' | 'truss' | 'cable';
export type TunnelFamily = 'rock' | 'shotcrete' | 'segmental' | 'cut-cover' | 'gallery';
export type ConduitFamily = 'pipe' | 'box' | 'twin-cell' | 'masonry-arch' | 'ford' | 'none';
export type StructureFamily = BridgeFamily | TunnelFamily | ConduitFamily;
export type StructureMaterial = 'concrete' | 'stone' | 'brick' | 'steel' | 'timber' | 'raw-rock';
export type InfrastructureEra = 'vernacular' | 'industrial' | 'modern' | 'repair';
export type MaintenanceState = 'maintained' | 'weathered' | 'patched' | 'reclaimed';

export interface InfrastructureContext {
  /** Canonical OSM identity: type/id, never a tile-local array index. */
  key: string;
  kind: InfrastructureKind;
  /** Total canonical structure length and principal unsupported span. */
  lengthM: number;
  spanM: number;
  roadWidthM: number;
  /** 0 path/local, 1 collector, 2 arterial, 3 motorway/rail-scale. */
  tier: 0 | 1 | 2 | 3;
  lanes?: number;
  layer?: number;
  /** OSM facts. These override procedural guesses whenever recognised. */
  taggedFamily?: string;
  taggedMaterial?: string;
  taggedStructure?: string;
  startYear?: number;
  /** World evidence. */
  climate: readonly number[]; // [arid,tropical,temperate,boreal,alpine]
  temperatureC: number;
  moisture: number;
  snow: number;
  reliefM: number;
  sideSlope: number;
  coverM: number;
  daylightM: number;
  waterWidthM: number;
  urbanity: number;
  bedrock: 'igneous' | 'sedimentary' | 'metamorphic' | 'soft' | 'unknown';
  /** Stable seeds from the 96km, 6km, and 320m culture scopes. */
  regionSeed: number;
  districtSeed: number;
  settlementSeed: number;
  /** Measured geometric room after mandatory clearances. */
  availableClearanceM: number;
}

export interface StructureRecipe {
  kind: InfrastructureKind;
  family: StructureFamily;
  material: StructureMaterial;
  era: InfrastructureEra;
  maintenance: MaintenanceState;
  supportSpacingM: number;
  supportRadiusM: number;
  rail: 'parapet' | 'open-rail' | 'stone-wall' | 'none';
  lining: 'none' | 'raw' | 'shotcrete' | 'segmental' | 'masonry';
  lighting: 'none' | 'portal' | 'sparse' | 'continuous';
  weathering: number;
  accent: number;
  /** False means the only safe procedural treatment is to omit the structure. */
  feasible: boolean;
  reason: string;
}

const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));
const U32 = 0x100000000;

export function hashString(s: string, salt = 0): number {
  let h = (0x811c9dc5 ^ salt) >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d) >>> 0;
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

export function deterministicUnit(key: string, salt: number): number {
  return hashString(key, salt) / U32;
}

function norm(s?: string): string {
  return (s ?? '').trim().toLowerCase().replace(/[ _]/g, '-');
}

function weighted<T>(items: readonly [T, number][], roll: number): T {
  let total = 0;
  for (const [, w] of items) total += Math.max(0, w);
  if (total <= 0) return items[0][0];
  let t = roll * total;
  for (const [v, w0] of items) {
    const w = Math.max(0, w0);
    if (t < w) return v;
    t -= w;
  }
  return items[items.length - 1][0];
}

function explicitBridge(c: InfrastructureContext): BridgeFamily | null {
  const s = norm(c.taggedStructure || c.taggedFamily);
  if (/suspension|cable-stayed/.test(s)) return 'cable';
  if (/truss|lattice/.test(s)) return 'truss';
  if (/arch/.test(s)) return 'arch';
  if (/viaduct/.test(s)) return 'viaduct';
  if (/beam|girder/.test(s)) return 'beam';
  if (/slab/.test(s)) return 'slab';
  return null;
}

function explicitTunnel(c: InfrastructureContext): TunnelFamily | null {
  const s = norm(c.taggedStructure || c.taggedFamily);
  if (/avalanche|gallery/.test(s)) return 'gallery';
  if (/cut-and-cover|cut-cover/.test(s)) return 'cut-cover';
  if (/segment|immersed/.test(s)) return 'segmental';
  if (/shotcrete/.test(s)) return 'shotcrete';
  if (/rock|bored/.test(s)) return 'rock';
  return null;
}

function explicitConduit(c: InfrastructureContext): ConduitFamily | null {
  const s = norm(c.taggedStructure || c.taggedFamily);
  if (/twin|double|multi/.test(s)) return 'twin-cell';
  if (/masonry|arch/.test(s)) return 'masonry-arch';
  if (/box/.test(s)) return 'box';
  if (/pipe|culvert/.test(s)) return 'pipe';
  if (/ford/.test(s)) return 'ford';
  return null;
}

function eraFor(c: InfrastructureContext): InfrastructureEra {
  if (c.startYear && c.startYear < 1900) return 'vernacular';
  if (c.startYear && c.startYear < 1960) return 'industrial';
  if (c.startYear && c.startYear > 1995) return 'modern';
  const r = deterministicUnit(c.key, c.regionSeed ^ 0x455241);
  const oldBias = 0.18 + 0.32 * clamp01(c.urbanity) + 0.15 * clamp01(c.climate[2] ?? 0);
  if (r < oldBias * 0.35) return 'vernacular';
  if (r < oldBias) return 'industrial';
  if (r > 0.91) return 'repair';
  return 'modern';
}

function materialFor(c: InfrastructureContext, family: StructureFamily, era: InfrastructureEra): StructureMaterial {
  const tag = norm(c.taggedMaterial);
  if (/stone|masonry/.test(tag)) return 'stone';
  if (/brick/.test(tag)) return 'brick';
  if (/steel|metal|iron/.test(tag)) return 'steel';
  if (/wood|timber/.test(tag)) return 'timber';
  if (/rock/.test(tag)) return 'raw-rock';
  if (/concrete/.test(tag)) return 'concrete';

  if (family === 'truss' || family === 'cable') return 'steel';
  if (family === 'rock') return 'raw-rock';
  if (family === 'masonry-arch') return deterministicUnit(c.key, c.districtSeed) < 0.3 ? 'brick' : 'stone';
  if (family === 'arch' && (era === 'vernacular' || era === 'industrial')) return 'stone';
  if (family === 'gallery' && c.bedrock !== 'soft' && c.coverM > 2) return 'raw-rock';
  return 'concrete';
}

function bridgeFamily(c: InfrastructureContext): { family: BridgeFamily; reason: string } {
  const tagged = explicitBridge(c);
  if (tagged) return { family: tagged, reason: 'explicit OSM structure' };

  const hardRock = c.bedrock === 'igneous' || c.bedrock === 'metamorphic';
  const old = deterministicUnit(c.key, c.regionSeed ^ 0xb41d) < 0.34;
  const roll = deterministicUnit(c.key, c.districtSeed ^ 0xb12d);
  const f = weighted<BridgeFamily>([
    ['slab', c.spanM <= 16 ? 5 : 0],
    ['beam', c.spanM <= 55 ? 4 + c.tier : 0],
    ['viaduct', c.lengthM >= 55 && c.daylightM >= 7 ? 2.5 + c.lengthM / 100 : 0],
    ['arch', c.spanM <= 75 && c.daylightM >= 5 ? (old ? 4 : 1) * (hardRock ? 1.4 : 0.8) : 0],
    ['truss', c.spanM >= 28 && c.spanM <= 150 ? 1.2 + c.tier * 0.8 : 0],
    ['cable', c.spanM >= 110 && c.tier >= 2 ? 0.18 + c.spanM / 500 : 0],
  ], roll);
  return { family: f, reason: 'context-weighted feasible bridge family' };
}

function tunnelFamily(c: InfrastructureContext): { family: TunnelFamily; reason: string } {
  const tagged = explicitTunnel(c);
  if (tagged) return { family: tagged, reason: 'explicit OSM structure' };
  const hardRock = c.bedrock === 'igneous' || c.bedrock === 'metamorphic';
  const roll = deterministicUnit(c.key, c.districtSeed ^ 0x7a11);
  const f = weighted<TunnelFamily>([
    ['cut-cover', c.coverM < 10 ? 2 + c.urbanity * 5 : 0.2],
    ['gallery', c.sideSlope > 0.42 && c.daylightM > 1 ? 2.5 + c.sideSlope * 3 : 0],
    ['rock', hardRock && c.coverM >= 7 ? 4 : 0.4],
    ['shotcrete', c.bedrock !== 'soft' ? 3 : 0.8],
    ['segmental', 1 + c.moisture * 3 + c.urbanity * 2 + (c.bedrock === 'soft' ? 3 : 0)],
  ], roll);
  return { family: f, reason: 'context-weighted feasible tunnel family' };
}

function conduitFamily(c: InfrastructureContext): { family: ConduitFamily; reason: string } {
  const tagged = explicitConduit(c);
  if (tagged) return { family: tagged, reason: 'explicit OSM structure' };
  // Clearance is a hard gate. A ford is visual treatment, not a buried solid.
  if (c.availableClearanceM < 0.55) {
    return c.tier <= 1 && c.waterWidthM < 5
      ? { family: 'ford', reason: 'insufficient buried clearance; non-solid fallback' }
      : { family: 'none', reason: 'insufficient buried clearance' };
  }
  const roll = deterministicUnit(c.key, c.settlementSeed ^ 0xc017);
  const f = weighted<ConduitFamily>([
    ['pipe', c.waterWidthM < 2.4 ? 5 : 0.5],
    ['box', c.waterWidthM < 8 ? 4 : 1],
    ['twin-cell', c.waterWidthM >= 4 && c.availableClearanceM >= 1.2 ? 3 : 0],
    ['masonry-arch', c.waterWidthM < 9 && c.availableClearanceM >= 1.4 ? 1.3 : 0],
    ['ford', c.tier === 0 && c.waterWidthM < 7 ? 1 : 0],
    ['none', 0],
  ], roll);
  return { family: f, reason: 'context-weighted feasible conduit family' };
}

export function pickInfrastructureRecipe(c: InfrastructureContext): StructureRecipe {
  const selected = c.kind === 'bridge' ? bridgeFamily(c) : c.kind === 'tunnel' ? tunnelFamily(c) : conduitFamily(c);
  const era = eraFor(c);
  const material = materialFor(c, selected.family, era);
  const wet = clamp01(c.moisture * 0.7 + Math.max(0, c.snow) * 0.3);
  const maintenanceRoll = deterministicUnit(c.key, c.settlementSeed ^ 0x4d4e54);
  const maintenance: MaintenanceState =
    maintenanceRoll < 0.16 + wet * 0.12 ? 'weathered' :
    maintenanceRoll > 0.88 ? 'reclaimed' :
    era === 'repair' || maintenanceRoll < 0.34 ? 'patched' : 'maintained';
  const weathering = clamp01(0.14 + wet * 0.5 + (maintenance === 'weathered' ? 0.24 : 0) + (maintenance === 'reclaimed' ? 0.35 : 0));

  let supportSpacingM = 0;
  let supportRadiusM = 0;
  if (c.kind === 'bridge') {
    supportSpacingM = selected.family === 'slab' ? 12 : selected.family === 'beam' ? 24 :
      selected.family === 'viaduct' ? 31 : selected.family === 'arch' ? 38 : selected.family === 'truss' ? 58 : 0;
    supportRadiusM = Math.max(0.45, Math.min(2.4, c.roadWidthM * (selected.family === 'viaduct' ? 0.105 : 0.075)));
  }

  const rail: StructureRecipe['rail'] = c.kind !== 'bridge' ? 'none' :
    material === 'stone' || material === 'brick' ? 'stone-wall' :
    selected.family === 'truss' || selected.family === 'cable' ? 'open-rail' : 'parapet';
  const lining: StructureRecipe['lining'] = c.kind !== 'tunnel' ? (selected.family === 'masonry-arch' ? 'masonry' : 'none') :
    selected.family === 'rock' ? 'raw' : selected.family === 'shotcrete' || selected.family === 'gallery' ? 'shotcrete' :
    selected.family === 'segmental' || selected.family === 'cut-cover' ? 'segmental' : 'none';
  const lighting: StructureRecipe['lighting'] = c.kind !== 'tunnel' ? 'none' :
    c.lengthM < 35 ? 'portal' : c.urbanity > 0.55 || c.tier >= 2 ? 'continuous' : 'sparse';

  return {
    kind: c.kind,
    family: selected.family,
    material,
    era,
    maintenance,
    supportSpacingM,
    supportRadiusM,
    rail,
    lining,
    lighting,
    weathering,
    accent: hashString(c.key, c.regionSeed ^ c.districtSeed),
    feasible: selected.family !== 'none',
    reason: selected.reason,
  };
}

export interface ChainPoint { x: number; z: number }
export interface CanonicalAlignment {
  points: readonly ChainPoint[];
  lengthM: number;
  reversed: boolean;
}

/** Canonicalises orientation from absolute endpoints, then measures chainage. */
export function canonicalAlignment(points: readonly ChainPoint[]): CanonicalAlignment {
  if (points.length < 2) return { points: points.slice(), lengthM: 0, reversed: false };
  const a = points[0], b = points[points.length - 1];
  const reverse = a.x > b.x || (a.x === b.x && a.z > b.z);
  const out = reverse ? points.slice().reverse() : points.slice();
  let lengthM = 0;
  for (let i = 1; i < out.length; i++) lengthM += Math.hypot(out[i].x - out[i - 1].x, out[i].z - out[i - 1].z);
  return { points: out, lengthM, reversed: reverse };
}

export interface SupportStation {
  stationM: number;
  nominalM: number;
  shiftM: number;
}
export interface SupportPlan {
  accepted: SupportStation[];
  refused: number;
}

export interface SupportPlanOptions {
  key: string;
  lengthM: number;
  spacingM: number;
  endClearanceM: number;
  /**
   * Canonical chainage of this fragment's start. Supplying an absolute
   * projection makes stations survive clipping; zero preserves whole-way use.
   */
  stationOffsetM?: number;
  /** Pure world query supplied by caller; station is local to this fragment. */
  clearAt: (stationM: number) => boolean;
}

/**
 * Canonical supports. The phase is keyed to identity; every collision fallback
 * is tried in the same order. Refusal omits a support—it never relaxes safety.
 */
export function planSupportStations(o: SupportPlanOptions): SupportPlan {
  const accepted: SupportStation[] = [];
  if (!(o.lengthM > 0 && o.spacingM > 0)) return { accepted, refused: 0 };
  const phase = deterministicUnit(o.key, 0x53555050) * o.spacingM;
  const offset = o.stationOffsetM ?? 0;
  const shifts = [0, -0.18, 0.18, -0.34, 0.34].map((v) => v * o.spacingM);
  let refused = 0;
  const first = Math.ceil((offset + o.endClearanceM - phase) / o.spacingM);
  const last = Math.floor((offset + o.lengthM - o.endClearanceM - phase) / o.spacingM);
  for (let k = first; k <= last; k++) {
    const nominalM = phase + k * o.spacingM - offset;
    let chosen: number | null = null;
    for (const shift of shifts) {
      const s = nominalM + shift;
      if (s < o.endClearanceM || s > o.lengthM - o.endClearanceM) continue;
      if (accepted.length && s - accepted[accepted.length - 1].stationM < o.spacingM * 0.52) continue;
      if (o.clearAt(s)) { chosen = s; break; }
    }
    if (chosen == null) refused++;
    else accepted.push({ stationM: chosen, nominalM, shiftM: chosen - nominalM });
  }
  return { accepted, refused };
}

export interface RoadCorridor {
  points: readonly ChainPoint[];
  halfWidthM: number;
  verticalMinM?: number;
  verticalMaxM?: number;
}

export function pointSegmentDistance(p: ChainPoint, a: ChainPoint, b: ChainPoint): number {
  const dx = b.x - a.x, dz = b.z - a.z;
  const d2 = dx * dx + dz * dz;
  if (d2 <= 1e-9) return Math.hypot(p.x - a.x, p.z - a.z);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / d2));
  return Math.hypot(p.x - (a.x + dx * t), p.z - (a.z + dz * t));
}

/** Conservative circular footprint against all carriageway corridors. */
export function supportFootprintClear(p: ChainPoint, radiusM: number, roads: readonly RoadCorridor[], marginM = 0.45): boolean {
  for (const road of roads) {
    for (let i = 1; i < road.points.length; i++) {
      if (pointSegmentDistance(p, road.points[i - 1], road.points[i]) < radiusM + road.halfWidthM + marginM) return false;
    }
  }
  return true;
}
