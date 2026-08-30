import { hashString, quantile } from './geometry';
import type { HydroBody, HydroBodyObservation, HydroKind, TileKey } from './types';

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

interface BodyState {
  observations: Map<TileKey, HydroBodyObservation>;
  body?: HydroBody;
}

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

/**
 * Owns facts that must remain stable across streamed tile fragments: a lake's
 * level, a body's random seed, its material parameters and its broad flow.
 * Tile geometry remains outside the registry.
 */
export class HydroBodyRegistry {
  private states = new Map<string, BodyState>();
  private tileBodies = new Map<TileKey, Set<string>>();

  constructor(private oceanLevel = 0) {}

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
  }

  private resolve(id: string, state: BodyState): HydroBody {
    const observations = [...state.observations.values()];
    const first = observations[0];
    const tagged = observations.map((o) => o.taggedLevelM).filter((v): v is number => Number.isFinite(v));
    const candidates = observations.map((o) => o.candidateLevelM).filter((v): v is number => Number.isFinite(v));
    const profiles = observations.map((o) => o.profile).filter((v): v is Float32Array => !!v?.length);
    profiles.sort((a, b) => b.length - a.length);

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
    return {
      id,
      kind,
      level,
      flow: [flowX, flowZ],
      fetchM: Math.max(1, ...observations.map((o) => o.fetchM)),
      seed: hashString(id) / 0xffffffff,
      roughness,
      turbidity,
      intermittent: observations.some((o) => o.intermittent),
      tidal: observations.some((o) => o.tidal),
      version: state.body?.version ?? 1,
    };
  }
}
