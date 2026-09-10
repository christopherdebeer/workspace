import type { CrossingKind } from './types';

export type ProductionCrossingKind = CrossingKind | 'unresolved';
export type CrossingAuthority = 'explicit-tag' | 'built-structure' | 'unresolved';
export type CrossingImplementation = 'built' | 'missing' | 'not-required';
export type CrossingStructureOutcome =
  | 'bridge-deck'
  | 'culvert-built'
  | 'ford-fallback'
  | 'no-room'
  | 'infeasible'
  | 'none';

export interface ProductionCrossingInput {
  roadId: string;
  waterId: string;
  x: number;
  z: number;
  radiusM: number;
  roadTangent?: readonly [number, number];
  waterTangent?: readonly [number, number];
  roadHalfWidthM?: number;
  waterHalfWidthM?: number;
  roadLayer: number;
  roadTags?: Readonly<Record<string, string>>;
  waterTags?: Readonly<Record<string, string>>;
  deckY: number;
  waterBedY: number;
  waterSurfaceY: number | null;
  availableClearanceM: number | null;
  structureOutcome: CrossingStructureOutcome;
}

export type ProductionCrossingEvidenceInput = Pick<
  ProductionCrossingInput,
  'roadLayer' | 'roadTags' | 'waterTags'
>;

export interface ProductionCrossingIntent {
  kind: ProductionCrossingKind;
  authority: CrossingAuthority;
  evidence: readonly string[];
}

export interface ProductionCrossingFootprint {
  kind: CrossingKind;
  x: number;
  z: number;
  roadTangent: readonly [number, number];
  halfLengthM: number;
  halfWidthM: number;
}

export interface ProductionCrossingRecord {
  id: string;
  revision: number;
  kind: ProductionCrossingKind;
  authority: CrossingAuthority;
  implementation: CrossingImplementation;
  evidence: readonly string[];
  roadId: string;
  waterId: string;
  x: number;
  z: number;
  radiusM: number;
  roadTangent: readonly [number, number];
  waterTangent: readonly [number, number];
  roadHalfWidthM: number;
  waterHalfWidthM: number;
  deckY: number;
  waterBedY: number;
  waterSurfaceY: number | null;
  availableClearanceM: number | null;
}

export interface ProductionCrossingSnapshot {
  revision: number;
  total: number;
  bridge: number;
  culvert: number;
  ford: number;
  causeway: number;
  unresolved: number;
  missingImplementation: number;
}

const affirmative = (value: string | undefined): boolean =>
  value !== undefined && value !== 'no' && value !== 'false' && value !== '0';

const crossingId = (input: ProductionCrossingInput): string =>
  `${input.roadId}×${input.waterId}@${Math.round(input.x / 4)},${Math.round(input.z / 4)}`;

/**
 * Resolve semantic intent before any geometry is built.
 *
 * Construction consumes this answer; it must not independently reinterpret
 * source tags and then ask the authority to describe the result afterward.
 */
export function resolveProductionCrossingIntent(
  input: ProductionCrossingEvidenceInput,
): ProductionCrossingIntent {
  const road = input.roadTags ?? {};
  const water = input.waterTags ?? {};
  const evidence: string[] = [];
  const roadBridge = affirmative(road.bridge) || input.roadLayer > 0;
  const taggedCulvert = water.tunnel === 'culvert'
    || affirmative(water.culvert)
    || road.tunnel === 'culvert';
  const taggedFord = affirmative(road.ford)
    || road.highway === 'ford'
    || affirmative(water.ford);
  const taggedCauseway = affirmative(road.embankment)
    && !roadBridge
    && !taggedCulvert
    && !taggedFord;

  if (roadBridge) {
    if (affirmative(road.bridge)) evidence.push(`road bridge=${road.bridge}`);
    if (input.roadLayer > 0) evidence.push(`road layer=${input.roadLayer}`);
    return { kind: 'bridge', authority: 'explicit-tag', evidence };
  }
  if (taggedCulvert) {
    if (water.tunnel === 'culvert') evidence.push('water tunnel=culvert');
    if (affirmative(water.culvert)) evidence.push(`water culvert=${water.culvert}`);
    if (road.tunnel === 'culvert') evidence.push('road tunnel=culvert');
    return { kind: 'culvert', authority: 'explicit-tag', evidence };
  }
  if (taggedFord) {
    if (affirmative(road.ford)) evidence.push(`road ford=${road.ford}`);
    if (road.highway === 'ford') evidence.push('road highway=ford');
    if (affirmative(water.ford)) evidence.push(`water ford=${water.ford}`);
    return { kind: 'ford', authority: 'explicit-tag', evidence };
  }
  if (taggedCauseway) {
    evidence.push(`road embankment=${road.embankment}`);
    return { kind: 'causeway', authority: 'explicit-tag', evidence };
  }
  return { kind: 'unresolved', authority: 'unresolved', evidence };
}

/**
 * Resolve only from explicit source facts and construction outcomes.
 *
 * Height and width remain diagnostics. They do not silently turn an unknown
 * overlap into a bridge, culvert or ford.
 */
export function resolveProductionCrossing(
  input: ProductionCrossingInput,
): Omit<ProductionCrossingRecord, 'revision'> {
  const intent = resolveProductionCrossingIntent(input);
  const evidence = [...intent.evidence];
  let kind = intent.kind;
  let authority = intent.authority;
  let implementation: CrossingImplementation = 'missing';

  if (intent.kind === 'bridge') {
    implementation = input.structureOutcome === 'bridge-deck' ? 'built' : 'missing';
  } else if (intent.kind === 'culvert') {
    implementation = input.structureOutcome === 'culvert-built' ? 'built' : 'missing';
  } else if (intent.kind === 'ford') {
    implementation = 'not-required';
  } else if (intent.kind === 'causeway') {
    implementation = 'built';
  } else if (input.structureOutcome === 'culvert-built') {
    kind = 'culvert';
    authority = 'built-structure';
    implementation = 'built';
    evidence.push('procedural conduit built');
  } else if (input.structureOutcome === 'ford-fallback') {
    kind = 'ford';
    authority = 'built-structure';
    implementation = 'not-required';
    evidence.push('infrastructure recipe selected ford fallback');
  } else {
    evidence.push(`structure outcome=${input.structureOutcome}`);
  }

  if (input.availableClearanceM !== null) {
    evidence.push(`clearance=${input.availableClearanceM.toFixed(2)}m`);
  }

  return {
    id: crossingId(input),
    kind,
    authority,
    implementation,
    evidence,
    roadId: input.roadId,
    waterId: input.waterId,
    x: input.x,
    z: input.z,
    radiusM: Math.max(1, input.radiusM),
    roadTangent: input.roadTangent ?? [1, 0],
    waterTangent: input.waterTangent ?? [0, 1],
    roadHalfWidthM: Math.max(.5, input.roadHalfWidthM ?? input.radiusM * .35),
    waterHalfWidthM: Math.max(.5, input.waterHalfWidthM ?? input.radiusM * .35),
    deckY: input.deckY,
    waterBedY: input.waterBedY,
    waterSurfaceY: input.waterSurfaceY,
    availableClearanceM: input.availableClearanceM,
  };
}

const authorityRank = (authority: CrossingAuthority): number =>
  authority === 'explicit-tag' ? 2 : authority === 'built-structure' ? 1 : 0;

/** The canonical road-over-water footprint consumed by hydro and earthworks. */
export function productionCrossingFootprint(
  record: ProductionCrossingRecord,
): ProductionCrossingFootprint | undefined {
  if (record.kind === 'unresolved' || record.implementation === 'missing') return undefined;
  return {
    kind: record.kind,
    x: record.x,
    z: record.z,
    roadTangent: record.roadTangent,
    halfLengthM: record.waterHalfWidthM + 4,
    halfWidthM: record.roadHalfWidthM + 2,
  };
}

export function pointInProductionCrossingFootprint(
  footprint: ProductionCrossingFootprint,
  x: number,
  z: number,
  extraReachM = 0,
): boolean {
  const dx = x - footprint.x;
  const dz = z - footprint.z;
  const tx = footprint.roadTangent[0];
  const tz = footprint.roadTangent[1];
  const length = Math.hypot(tx, tz) || 1;
  const ux = tx / length;
  const uz = tz / length;
  const along = Math.abs(dx * ux + dz * uz);
  const across = Math.abs(dx * -uz + dz * ux);
  const extra = Math.max(0, extraReachM);
  return along <= footprint.halfLengthM + extra
    && across <= footprint.halfWidthM + extra;
}

export class ProductionCrossingRegistry {
  private records = new Map<string, ProductionCrossingRecord>();
  private revision = 0;

  reset(): void {
    if (this.records.size) this.revision++;
    this.records.clear();
  }

  observe(input: ProductionCrossingInput): ProductionCrossingRecord {
    const next = resolveProductionCrossing(input);
    const previous = this.records.get(next.id);
    let chosen = next;
    if (previous && authorityRank(previous.authority) > authorityRank(next.authority)) {
      chosen = {
        ...previous,
        x: next.x,
        z: next.z,
        radiusM: Math.max(previous.radiusM, next.radiusM),
        deckY: next.deckY,
        waterBedY: next.waterBedY,
        waterSurfaceY: next.waterSurfaceY,
        availableClearanceM: next.availableClearanceM,
      };
    }
    const comparable = previous ? { ...previous, revision: 0 } : undefined;
    const changed = !comparable || JSON.stringify(comparable) !== JSON.stringify({ ...chosen, revision: 0 });
    if (!changed && previous) return previous;
    this.revision++;
    const record = { ...chosen, revision: this.revision };
    this.records.set(record.id, record);
    return record;
  }

  at(x: number, z: number, extraReachM = 0): ProductionCrossingRecord | undefined {
    let best: ProductionCrossingRecord | undefined;
    let bestDistance = Infinity;
    for (const record of this.records.values()) {
      const distance = Math.hypot(x - record.x, z - record.z);
      if (distance > record.radiusM + Math.max(0, extraReachM) || distance >= bestDistance) continue;
      best = record;
      bestDistance = distance;
    }
    return best;
  }

  earthworkAt(
    x: number,
    z: number,
    extraReachM = 0,
  ): ProductionCrossingRecord | undefined {
    let best: ProductionCrossingRecord | undefined;
    let bestDistance = Infinity;
    for (const record of this.records.values()) {
      const footprint = productionCrossingFootprint(record);
      if (!footprint
        || !pointInProductionCrossingFootprint(footprint, x, z, extraReachM)) continue;
      const distance = Math.hypot(x - record.x, z - record.z);
      if (distance >= bestDistance) continue;
      best = record;
      bestDistance = distance;
    }
    return best;
  }

  forBounds(
    bounds: { minX: number; minZ: number; maxX: number; maxZ: number },
  ): readonly ProductionCrossingRecord[] {
    return [...this.records.values()].filter((record) =>
      record.x + record.radiusM >= bounds.minX
      && record.x - record.radiusM <= bounds.maxX
      && record.z + record.radiusM >= bounds.minZ
      && record.z - record.radiusM <= bounds.maxZ);
  }

  /**
   * A bounded, deterministic audit view. Problems sort first so a production
   * report remains useful even when a busy tile ring contains many crossings.
   */
  diagnostics(limit = 32): readonly ProductionCrossingRecord[] {
    const problemRank = (record: ProductionCrossingRecord): number =>
      record.kind === 'unresolved' ? 0 : record.implementation === 'missing' ? 1 : 2;
    return [...this.records.values()]
      .sort((a, b) => {
        const rank = problemRank(a) - problemRank(b);
        if (rank) return rank;
        return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
      })
      .slice(0, Math.max(0, Math.floor(limit)))
      .map((record) => ({ ...record, evidence: [...record.evidence] }));
  }

  snapshot(): ProductionCrossingSnapshot {
    const out: ProductionCrossingSnapshot = {
      revision: this.revision,
      total: this.records.size,
      bridge: 0,
      culvert: 0,
      ford: 0,
      causeway: 0,
      unresolved: 0,
      missingImplementation: 0,
    };
    for (const record of this.records.values()) {
      out[record.kind]++;
      if (record.implementation === 'missing') out.missingImplementation++;
    }
    return out;
  }
}
