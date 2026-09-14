import type { CrossingKind } from './types';
import { resolveProductionRoadStructureProfile } from './road-profile';

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

/**
 * ── WHO DECIDES HOW HIGH A DECK STANDS OVER WATER ──
 *
 * The road's own profile is the chord between the terrain at a fragment's
 * ends, and over an estuary that is the bed: measured at the Pont de
 * Normandie, the deck lay 0.7 m under the resting water for a kilometre once
 * the elevation repair had taken the surface model's smear away. Nothing
 * had ever supplied a deck height over water; the registry below recorded
 * whatever the profile built. The decision belongs here, before the
 * geometry, in the same spirit as the intent above: construction consumes
 * the answer and does not reinterpret the evidence afterwards.
 *
 * Three authorities, in order. A LANDMARK HINT is the deck a famous bridge's
 * entry describes at this station — level between its towers, falling at
 * its grade beyond them — and it is taken at every station, portals
 * included, because every fragment reads the same function and the ends
 * agree without a weld. WATER CLEARANCE is the resting level plus a
 * clearance by road class, and it is taken only where the chord would
 * otherwise lie IN the water: an ordinary river bridge whose chord already
 * spans bank to bank keeps it, and its approaches keep their welds. It
 * keeps off the portals, whose height is the approach's business. Else the
 * CHORD stands.
 */
export type DeckAuthority = 'landmark-hint' | 'water-clearance' | 'chord';

export interface ProductionDeckInput {
  /** The profile's own height at this station before any lift. */
  chordY: number;
  /** The resting water under the station, in the same datum; null for none. */
  waterY: number | null;
  /** The deck a landmark entry describes here; null for no entry. */
  hintY: number | null;
  roadTags?: Readonly<Record<string, string>>;
  /** A portal station of the fragment. */
  portal: boolean;
  /** How far this deck runs over water, metres — the crossing's own width in
   *  the direction that matters. Zero or absent falls back to the class floor. */
  wetSpanM?: number;
}

export interface ProductionDeckDecision {
  deckY: number;
  authority: DeckAuthority;
  /** The deck's height over the water, where the water is known. */
  clearanceM: number | null;
  evidence: readonly string[];
}

/** The floor: clearance a bridge gets from its road class alone, before the
 *  crossing is measured. A motorway over a navigable river against a lane
 *  over a brook. */
export function waterClearanceForClass(highway: string | undefined): number {
  return highway === 'motorway' || highway === 'trunk' ? 10
    : highway === 'primary' || highway === 'secondary' ? 7 : 4.5;
}

/**
 * ── AIR DRAUGHT IS PROPORTIONAL TO THE CROSSING ──
 *
 * A flat clearance by road class is wrong at both ends: ten metres over a
 * two-kilometre estuary still reads as a bridge lying in the water, and it
 * is far more than a lane needs over a brook. What a bridge is built to
 * clear is the WATER IT CROSSES — a wide channel is a shipping channel, and
 * the air draught follows.
 *
 * The ratio is read off the bridges in the landmark store, deck height over
 * main span: Golden Gate 0.052, Normandie 0.061, Brooklyn 0.084, Severn
 * 0.037, Humber 0.021, Akashi 0.033, Tower Bridge 0.14. A twentieth of the
 * wet span sits in the middle of that and lands within a few metres of the
 * real thing on the big ones: 64 m against 67 at the Golden Gate, 43 against
 * 52 at the Normandie.
 *
 * Capped at 65 m, which is about the tallest air draught built anywhere, so
 * a mis-measured estuary cannot raise a road into the stratosphere; floored
 * at the class minimum, so a ditch does not lower one into the water. A
 * landmark entry overrides all of it with the surveyed number.
 */
export const WET_SPAN_RATIO = 0.05;
export const WET_CLEARANCE_MAX = 65;
export function navigableClearance(wetSpanM: number, highway: string | undefined): number {
  const floor = waterClearanceForClass(highway);
  if (!(wetSpanM > 0)) return floor;
  return Math.max(floor, Math.min(WET_CLEARANCE_MAX, WET_SPAN_RATIO * wetSpanM));
}

export function resolveProductionDeck(input: ProductionDeckInput): ProductionDeckDecision {
  const evidence: string[] = [];
  const over = (y: number): number | null => (input.waterY === null ? null : y - input.waterY);
  if (input.hintY !== null && input.hintY > input.chordY) {
    evidence.push(`landmark deck ${input.hintY.toFixed(1)} over chord ${input.chordY.toFixed(1)}`);
    return { deckY: input.hintY, authority: 'landmark-hint', clearanceM: over(input.hintY), evidence };
  }
  if (!input.portal && input.waterY !== null) {
    // NOT ONLY WHEN IT IS SUBMERGED. The first cut fired only where the chord
    // lay IN the water, which leaves a deck a metre over a two-kilometre
    // estuary exactly as wrong as one a metre under it. The test is the
    // clearance the crossing earns.
    const clear = navigableClearance(input.wetSpanM ?? 0, input.roadTags?.highway);
    if (input.chordY < input.waterY + clear) {
      evidence.push(`chord ${input.chordY.toFixed(1)} under ${clear.toFixed(1)}m over water at ${input.waterY.toFixed(1)}`
        + (input.wetSpanM ? `; wet span ${Math.round(input.wetSpanM)}m` : `; ${input.roadTags?.highway ?? 'road'} class floor`));
      return { deckY: input.waterY + clear, authority: 'water-clearance', clearanceM: clear, evidence };
    }
  }
  return { deckY: input.chordY, authority: 'chord', clearanceM: over(input.chordY), evidence };
}

export type ProductionBridgeLiftSource = 'hint' | 'water' | 'deck';

export interface ProductionBridgeProfileInput {
  stations: readonly (readonly [x: number, z: number])[];
  /** Aligned road profile before the bridge chord is constructed. */
  profile: readonly number[];
  /** Junction stations whose solved height the chord must preserve. */
  heldStations?: ArrayLike<number>;
  roadTags?: Readonly<Record<string, string>>;
  layer: number;
  /** Maximum descending grade away from a held clearance station. */
  grade: number;
  /** Stable authored landmark profile, when one claims the bridge. */
  hintAt?: (x: number, z: number) => number | null;
  /** Resting water in the profile datum. Called lazily. */
  waterAt: (x: number, z: number) => number | null;
  /** Highest already-built lower-layer deck near this point. Called lazily. */
  deckBelow: (x: number, z: number) => number | null;
  bridgeClearanceM?: number;
  portalReachM?: number;
  deckSampleStepM?: number;
}

export interface ProductionBridgeProfileResult {
  runs: readonly (readonly [start: number, end: number])[];
  chordProfile: number[];
  profile: number[];
  maximumLiftM: number;
  source?: ProductionBridgeLiftSource;
  /** Crossing records retain the water/landmark authority. A lower road can
   *  lift the geometry without changing the bridge-over-water authority. */
  deckAuthority: DeckAuthority;
}

export const PRODUCTION_BRIDGE_CLEARANCE_M = 5.5;
export const PRODUCTION_BRIDGE_PORTAL_REACH_M = 8;
export const PRODUCTION_BRIDGE_DECK_SAMPLE_STEP_M = 3;

/**
 * Resolve a bridge's complete clearance profile before geometry exists.
 *
 * Water/landmark decisions, lower-deck sampling and the two-pass grade cone
 * are one authority operation. The caller supplies only the streamed facts;
 * it must not reinterpret them after this function returns.
 */
export function resolveProductionBridgeProfile(
  input: ProductionBridgeProfileInput,
): ProductionBridgeProfileResult {
  if (input.stations.length !== input.profile.length) {
    throw new Error('bridge stations and profile must have matching lengths');
  }
  if (input.heldStations
    && input.heldStations.length !== input.profile.length) {
    throw new Error('bridge held stations and profile must have matching lengths');
  }
  const structure = resolveProductionRoadStructureProfile({
    stations: input.stations,
    alignedProfile: input.profile,
    mode: 'bridge',
    canopy: false,
    heldStations: input.heldStations,
  });
  const runs = structure.runs;
  const chordProfile = structure.chordProfile;
  const profile = [...chordProfile];
  const bridgeClearanceM = input.bridgeClearanceM
    ?? PRODUCTION_BRIDGE_CLEARANCE_M;
  const portalReachM = input.portalReachM
    ?? PRODUCTION_BRIDGE_PORTAL_REACH_M;
  const deckSampleStepM = input.deckSampleStepM
    ?? PRODUCTION_BRIDGE_DECK_SAMPLE_STEP_M;
  const grade = Math.max(0, input.grade);
  let source: ProductionBridgeLiftSource | undefined;
  let maximumLiftM = 0;
  const noteSource = (next: ProductionBridgeLiftSource): void => {
    if (next === 'hint') source = 'hint';
    else if (!source) source = next;
  };

  for (const [start, end] of runs) {
    const [portalAX, portalAZ] = input.stations[start];
    const [portalBX, portalBZ] = input.stations[end];
    const nearPortal = (x: number, z: number): boolean =>
      Math.hypot(x - portalAX, z - portalAZ) < portalReachM
      || Math.hypot(x - portalBX, z - portalBZ) < portalReachM;
    const portalAt = (station: number): boolean => {
      const [x, z] = input.stations[station];
      return station === start || station === end || nearPortal(x, z);
    };

    // The field is sampled only when its answer can change the profile. A
    // winning landmark hint and a portal need no water lookup. Once one low
    // station is found, the contiguous wet span is measured for air draught.
    const water: Array<number | null | undefined> =
      new Array(profile.length).fill(undefined);
    const hints: Array<number | null> =
      new Array(profile.length).fill(null);
    const waterAt = (station: number): number | null => {
      if (water[station] === undefined) {
        const [x, z] = input.stations[station];
        water[station] = input.waterAt(x, z);
      }
      return water[station] as number | null;
    };
    const hintWins = (station: number): boolean =>
      hints[station] !== null
      && (hints[station] as number) > profile[station];
    let anyLow = false;
    for (let station = start; station <= end; station++) {
      const [x, z] = input.stations[station];
      hints[station] = input.hintAt?.(x, z) ?? null;
      if (anyLow || portalAt(station) || hintWins(station)) continue;
      const waterY = waterAt(station);
      if (waterY !== null
        && profile[station]
          < waterY + waterClearanceForClass(input.roadTags?.highway)) {
        anyLow = true;
      }
    }

    let wetSpanM = 0;
    if (anyLow) {
      let wetRunM = 0;
      for (let station = start; station <= end; station++) {
        if (waterAt(station) === null) {
          wetRunM = 0;
          continue;
        }
        if (station > start && waterAt(station - 1) !== null) {
          wetRunM += Math.hypot(
            input.stations[station][0] - input.stations[station - 1][0],
            input.stations[station][1] - input.stations[station - 1][1],
          );
        }
        wetSpanM = Math.max(wetSpanM, wetRunM);
      }
    }

    for (let station = start; station <= end; station++) {
      const portal = portalAt(station);
      const decided = resolveProductionDeck({
        chordY: profile[station],
        hintY: hints[station],
        roadTags: input.roadTags,
        portal,
        wetSpanM,
        waterY: portal || hintWins(station) ? null : waterAt(station),
      });
      if (decided.authority === 'chord') continue;
      noteSource(decided.authority === 'landmark-hint' ? 'hint' : 'water');
      profile[station] = Math.max(profile[station], decided.deckY);
    }

    // Sample along each leg, not only at authored stations: a narrow road
    // beneath can fall between two bridge stations. Portals are excluded so
    // the bridge cannot discover and clear its own approach.
    if (input.layer > 0) {
      for (let station = start + 1; station <= end; station++) {
        const [x0, z0] = input.stations[station - 1];
        const [x1, z1] = input.stations[station];
        const steps = Math.max(
          1,
          Math.ceil(Math.hypot(x1 - x0, z1 - z0) / deckSampleStepM),
        );
        let below: number | null = null;
        for (let step = 0; step <= steps; step++) {
          const t = step / steps;
          const x = x0 + (x1 - x0) * t;
          const z = z0 + (z1 - z0) * t;
          if (nearPortal(x, z)) continue;
          const candidate = input.deckBelow(x, z);
          if (candidate !== null && (below === null || candidate > below)) {
            below = candidate;
          }
        }
        if (below === null) continue;
        const wanted = below + bridgeClearanceM;
        if (station - 1 > start && wanted > profile[station - 1]) {
          profile[station - 1] = wanted;
          noteSource('deck');
        }
        if (station < end && wanted > profile[station]) {
          profile[station] = wanted;
          noteSource('deck');
        }
      }
    }

    // The lowest profile satisfying every clearance witness is the forward
    // and backward cone at the bridge's ruling grade.
    for (let station = start + 1; station <= end; station++) {
      const distance = Math.max(0.1, Math.hypot(
        input.stations[station][0] - input.stations[station - 1][0],
        input.stations[station][1] - input.stations[station - 1][1],
      ));
      profile[station] = Math.max(
        profile[station],
        profile[station - 1] - grade * distance,
      );
    }
    for (let station = end - 1; station >= start; station--) {
      const distance = Math.max(0.1, Math.hypot(
        input.stations[station + 1][0] - input.stations[station][0],
        input.stations[station + 1][1] - input.stations[station][1],
      ));
      profile[station] = Math.max(
        profile[station],
        profile[station + 1] - grade * distance,
      );
    }
    for (let station = start; station <= end; station++) {
      maximumLiftM = Math.max(
        maximumLiftM,
        profile[station] - chordProfile[station],
      );
    }
  }

  return {
    runs,
    chordProfile,
    profile,
    maximumLiftM,
    source,
    deckAuthority: source === 'hint'
      ? 'landmark-hint'
      : source === 'water'
        ? 'water-clearance'
        : 'chord',
  };
}

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
  /** Who decided the deck this road was built at (see resolveProductionDeck). */
  deckAuthority?: DeckAuthority;
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
  deckAuthority: DeckAuthority;
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
  /** Bridges whose deck the landmark store or the water clearance decided. */
  deckByHint: number;
  deckByWater: number;
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
  const deckAuthority: DeckAuthority = input.deckAuthority ?? 'chord';
  if (deckAuthority !== 'chord') evidence.push(`deck by ${deckAuthority}`);

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
    deckAuthority,
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
        deckAuthority: next.deckAuthority,
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
      deckByHint: 0,
      deckByWater: 0,
    };
    for (const record of this.records.values()) {
      out[record.kind]++;
      if (record.implementation === 'missing') out.missingImplementation++;
      if (record.deckAuthority === 'landmark-hint') out.deckByHint++;
      if (record.deckAuthority === 'water-clearance') out.deckByWater++;
    }
    return out;
  }
}
