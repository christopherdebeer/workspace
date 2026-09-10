import { hashString, quantile } from './geometry';
import type {
  HydroBedMaterial,
  HydroBankMaterial,
  HydroBody,
  HydroBodyObservation,
  HydroKind,
  TileKey,
} from './types';

const ROUGHNESS: Record<HydroKind, number> = {
  ocean: 0.72,
  lagoon: 0.32,
  lake: 0.34,
  pond: 0.18,
  reservoir: 0.24,
  basin: 0.16,
  river: 0.62,
  stream: 0.76,
  canal: 0.22,
  wetland: 0.1,
};

const TURBIDITY: Record<HydroKind, number> = {
  ocean: 0.26,
  lagoon: 0.52,
  lake: 0.32,
  pond: 0.58,
  reservoir: 0.36,
  basin: 0.62,
  river: 0.54,
  stream: 0.38,
  canal: 0.5,
  wetland: 0.78,
};

const BED_MATERIAL: Record<HydroKind, HydroBedMaterial> = {
  ocean: 'sand',
  lagoon: 'silt',
  lake: 'silt',
  pond: 'silt',
  reservoir: 'gravel',
  basin: 'silt',
  river: 'gravel',
  stream: 'pebble',
  canal: 'silt',
  wetland: 'silt',
};

const BANK_MATERIAL: Record<HydroKind, HydroBankMaterial> = {
  ocean: 'soil',
  lagoon: 'mud',
  lake: 'soil',
  pond: 'mud',
  reservoir: 'gravel',
  basin: 'mud',
  river: 'gravel',
  stream: 'gravel',
  canal: 'soil',
  wetland: 'mud',
};

interface BodyState {
  observations: Map<TileKey, HydroBodyObservation>;
  body?: HydroBody;
}

/**
 * One installed stretch of a river's centreline, in downstream order: where it
 * starts, where it ends, how long it is, and the `s` its first station was
 * assigned. The registry keeps these so the river-space coordinate does not
 * restart at every tile — see riverSpanS0.
 */
interface RiverSpan {
  bodyId: string;
  component: number;
  headX: number;
  headZ: number;
  tailX: number;
  tailZ: number;
  lengthM: number;
  s0: number;
}

/** Overpass cuts share exact node coordinates, so this is slack for float
 *  drift and the resampler's endpoint preservation, not for real gaps. */
const SPAN_JOIN_M = 3;

export interface RegistryUpdate {
  changed: ReadonlySet<string>;
  removed: ReadonlySet<string>;
}

function bodyEquivalent(a: HydroBody | undefined, b: HydroBody): boolean {
  if (!a || a.kind !== b.kind || a.level.type !== b.level.type) return false;
  if (Math.abs(a.fetchM - b.fetchM) > 0.5
    || Math.abs(a.flow[0] - b.flow[0]) > 0.01
    || Math.abs(a.flow[1] - b.flow[1]) > 0.01
    || Math.abs(a.roughness - b.roughness) > 0.01
    || Math.abs(a.turbidity - b.turbidity) > 0.01
    || a.bedMaterial !== b.bedMaterial
    || a.bankMaterial !== b.bankMaterial
    || a.intermittent !== b.intermittent
    || a.tidal !== b.tidal) return false;
  if (a.level.type === 'flat' && b.level.type === 'flat') {
    return Math.abs(a.level.elevationM - b.level.elevationM) <= 0.08;
  }
  if (a.level.type === 'ocean' && b.level.type === 'ocean') {
    return Math.abs(a.level.elevationM - b.level.elevationM) <= 0.01;
  }
  if (a.level.type === 'profile' && b.level.type === 'profile') {
    const aa = a.level.stations, bb = b.level.stations;
    if (aa.length !== bb.length) return false;
    for (let i = 0; i < aa.length; i++) if (Math.abs(aa[i] - bb[i]) > 0.08) return false;
    return true;
  }
  return false;
}

function median(values: number[]): number | undefined {
  return quantile(values, 0.5);
}

function categoricalMode<T extends string>(values: readonly T[]): T | undefined {
  if (!values.length) return undefined;
  const counts = new Map<T, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  let winner = values[0];
  let winnerCount = counts.get(winner) ?? 0;
  for (const value of values) {
    const count = counts.get(value) ?? 0;
    if (count > winnerCount) {
      winner = value;
      winnerCount = count;
    }
  }
  return winner;
}

/**
 * Owns facts that must remain stable across streamed tile fragments: a lake's
 * level, a body's random seed, its material parameters and its broad flow.
 * Tile geometry remains outside the registry.
 */
export class HydroBodyRegistry {
  private states = new Map<string, BodyState>();
  private tileBodies = new Map<TileKey, Set<string>>();
  /** River topology is geometric, not keyed by OSM way id. OSM routinely
   * splits one physical river at bridges, tag changes and relation boundaries. */
  private riverSpans: RiverSpan[] = [];
  private nextRiverComponent = 1;
  /** Bodies whose already-built structure fields were rebased by a late join. */
  private riverSpanChanges = new Set<string>();

  constructor(private oceanLevel = 0) {}

  /**
   * Place one centreline fragment in a connected river-space chart.
   *
   * Connectivity is deliberately geometric and crosses OSM way ids. A newly
   * arrived bridge between two previously independent streamed components
   * rebases the downstream component, then records every affected body so the
   * system can rebuild those fields. The eventual chart is continuous
   * regardless of arrival order; only the smaller, unavoidable moment of
   * correction remains when previously disconnected knowledge becomes joined.
   */
  riverSpanS0(
    bodyId: string,
    headX: number,
    headZ: number,
    tailX: number,
    tailZ: number,
    lengthM: number,
  ): number {
    const near = (ax: number, az: number, bx: number, bz: number): boolean =>
      Math.abs(ax - bx) <= SPAN_JOIN_M && Math.abs(az - bz) <= SPAN_JOIN_M
      && Math.hypot(ax - bx, az - bz) <= SPAN_JOIN_M;

    // Rebuilds and tile returns retain their established coordinate. Refresh
    // the measured length so a revised fragment does not leave stale metadata.
    for (const span of this.riverSpans) {
      if (span.bodyId === bodyId
        && near(span.headX, span.headZ, headX, headZ)
        && near(span.tailX, span.tailZ, tailX, tailZ)) {
        span.lengthM = lengthM;
        return span.s0;
      }
    }

    // These searches intentionally cross body ids: an OSM way is an editing
    // primitive, not the identity of a river.
    const upstream = this.riverSpans.find((span) =>
      near(span.tailX, span.tailZ, headX, headZ));
    const downstream = this.riverSpans.find((span) =>
      near(span.headX, span.headZ, tailX, tailZ));

    let s0 = 0;
    let component = this.nextRiverComponent++;
    if (upstream) {
      s0 = upstream.s0 + upstream.lengthM;
      component = upstream.component;
    } else if (downstream) {
      s0 = downstream.s0 - lengthM;
      component = downstream.component;
    }

    if (upstream && downstream && upstream.component !== downstream.component) {
      // Keep the upstream chart fixed and translate the downstream chart so
      // both ends of the joining fragment agree. This heals the old permanent
      // seam when the middle tile arrived last.
      const oldComponent = downstream.component;
      const shift = s0 + lengthM - downstream.s0;
      for (const span of this.riverSpans) {
        if (span.component !== oldComponent) continue;
        span.component = component;
        span.s0 += shift;
        this.riverSpanChanges.add(span.bodyId);
      }
    }

    this.riverSpans.push({
      bodyId, component, headX, headZ, tailX, tailZ, lengthM, s0,
    });
    return s0;
  }

  /** Consume topology corrections exactly once after a tile build. */
  consumeRiverSpanChanges(): ReadonlySet<string> {
    const changed = this.riverSpanChanges;
    this.riverSpanChanges = new Set();
    return changed;
  }

  get oceanLevelM(): number { return this.oceanLevel; }

  setOceanLevelM(elevationM: number): ReadonlySet<string> {
    if (!Number.isFinite(elevationM) || Math.abs(elevationM - this.oceanLevel) <= 0.01) return new Set();
    this.oceanLevel = elevationM;
    const state = this.states.get('hydro:ocean');
    if (!state?.observations.size) return new Set();
    const next = this.resolve('hydro:ocean', state);
    const changed = !bodyEquivalent(state.body, next);
    next.version = changed ? (state.body?.version ?? 0) + 1 : (state.body?.version ?? 1);
    state.body = next;
    return changed ? new Set(['hydro:ocean']) : new Set();
  }

  updateTile(tileKey: TileKey, observations: readonly HydroBodyObservation[]): RegistryUpdate {
    const affected = new Set<string>(this.tileBodies.get(tileKey) ?? []);
    for (const id of affected) this.states.get(id)?.observations.delete(tileKey);

    const nextIds = new Set<string>();
    for (const observation of observations) {
      nextIds.add(observation.id);
      affected.add(observation.id);
      let state = this.states.get(observation.id);
      if (!state) {
        state = { observations: new Map() };
        this.states.set(observation.id, state);
      }
      // A tile can contain several fragments of one relation. Keep the richer
      // observation rather than making arrival order observable.
      const prior = state.observations.get(tileKey);
      const priorN = prior?.profile?.length ?? 0;
      const nextN = observation.profile?.length ?? 0;
      if (!prior || nextN >= priorN) state.observations.set(tileKey, observation);
    }
    this.tileBodies.set(tileKey, nextIds);

    const changed = new Set<string>();
    const removed = new Set<string>();
    for (const id of affected) {
      const state = this.states.get(id);
      if (!state || !state.observations.size) {
        this.states.delete(id);
        removed.add(id);
        continue;
      }
      const next = this.resolve(id, state);
      const didChange = !bodyEquivalent(state.body, next);
      next.version = didChange ? (state.body?.version ?? 0) + 1 : (state.body?.version ?? 1);
      if (didChange) changed.add(id);
      state.body = next;
    }
    return { changed, removed };
  }

  removeTile(tileKey: TileKey): RegistryUpdate {
    const ids = this.tileBodies.get(tileKey);
    if (!ids) return { changed: new Set(), removed: new Set() };
    this.tileBodies.delete(tileKey);
    const changed = new Set<string>();
    const removed = new Set<string>();
    for (const id of ids) {
      const state = this.states.get(id);
      state?.observations.delete(tileKey);
      if (!state || !state.observations.size) {
        this.states.delete(id);
        removed.add(id);
        continue;
      }
      const next = this.resolve(id, state);
      const didChange = !bodyEquivalent(state.body, next);
      next.version = didChange ? (state.body?.version ?? 0) + 1 : (state.body?.version ?? 1);
      if (didChange) changed.add(id);
      state.body = next;
    }
    return { changed, removed };
  }

  get(id: string): HydroBody | undefined {
    return this.states.get(id)?.body;
  }

  bodiesForTile(tileKey: TileKey): readonly HydroBody[] {
    const out: HydroBody[] = [];
    for (const id of this.tileBodies.get(tileKey) ?? []) {
      const body = this.get(id);
      if (body) out.push(body);
    }
    return out;
  }

  clear(): void {
    this.states.clear();
    this.tileBodies.clear();
    this.riverSpans = [];
    this.riverSpanChanges.clear();
    this.nextRiverComponent = 1;
  }

  private resolve(id: string, state: BodyState): HydroBody {
    // IN A FIXED ORDER, NOT INSERTION ORDER. The profile a river takes is the
    // longest observation's, and ties went to whichever tile was fed first —
    // but updateTile deletes and re-adds a tile's observation, so re-feeding
    // that tile (every terrain rebuild does) moved it to the END, another
    // tile's profile took over, the stations differed (each tile samples
    // its own ground and extrapolates the rest), and the body "changed":
    // every tile along the river rebuilt. On the Breede that was 277 hydro
    // builds for 77 terrain builds, measured by the telemetry. Ties break on
    // the tile key now, so the same tile answers until a longer profile
    // truly arrives.
    const observations = [...state.observations.entries()]
      .sort(([ka, oa], [kb, ob]) => (ob.profile?.length ?? 0) - (oa.profile?.length ?? 0) || (ka < kb ? -1 : ka > kb ? 1 : 0))
      .map(([, o]) => o);
    const first = observations[0];
    const tagged = observations.map((o) => o.taggedLevelM).filter((v): v is number => Number.isFinite(v));
    const candidates = observations.map((o) => o.candidateLevelM).filter((v): v is number => Number.isFinite(v));
    const profiles = observations.map((o) => o.profile).filter((v): v is Float32Array => !!v?.length);

    const kind = first.kind;
    const elevationM = median(tagged) ?? median(candidates) ?? this.oceanLevelM;
    const level = kind === 'ocean'
      ? { type: 'ocean' as const, elevationM: this.oceanLevelM }
      : profiles.length && ['river', 'stream', 'canal'].includes(kind)
        ? { type: 'profile' as const, stations: profiles[0] }
        : { type: 'flat' as const, elevationM };

    let flowX = 0, flowZ = 0;
    for (const o of observations) { flowX += o.flow[0]; flowZ += o.flow[1]; }
    const flowLength = Math.hypot(flowX, flowZ);
    if (flowLength > 0) { flowX /= flowLength; flowZ /= flowLength; }

    const roughness = median(observations.map((o) => o.roughness).filter((v): v is number => v !== undefined))
      ?? ROUGHNESS[kind];
    const turbidity = median(observations.map((o) => o.turbidity).filter((v): v is number => v !== undefined))
      ?? TURBIDITY[kind];
    const bedMaterial = categoricalMode(
      observations.map((o) => o.bedMaterial)
        .filter((v): v is HydroBedMaterial => v !== undefined),
    ) ?? BED_MATERIAL[kind];
    const bankMaterial = categoricalMode(
      observations.map((o) => o.bankMaterial)
        .filter((v): v is HydroBankMaterial => v !== undefined),
    ) ?? BANK_MATERIAL[kind];
    return {
      id,
      kind,
      level,
      flow: [flowX, flowZ],
      fetchM: Math.max(1, ...observations.map((o) => o.fetchM)),
      seed: hashString(id) / 0xffffffff,
      roughness,
      turbidity,
      bedMaterial,
      bankMaterial,
      intermittent: observations.some((o) => o.intermittent),
      tidal: observations.some((o) => o.tidal),
      version: state.body?.version ?? 1,
    };
  }
}
