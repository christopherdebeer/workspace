import type { ProductionSubstrateLookup } from './production-tile';
import type { SubstrateContact } from './types';

export type SubstrateContactConsumer =
  | 'surface'
  | 'fluid'
  | 'wheel-support'
  | 'wet-effects'
  | 'frame-centre';

export interface SubstrateConsumerAvailability {
  queries: number;
  tile: number;
  fallback: number;
}

export interface SubstrateFallbackSnapshot {
  queries: number;
  tileQueries: number;
  fallbackQueries: number;
  fallbackRate: number;
  reasons: {
    noTile: number;
    invalidTile: number;
    staleTerrain: number;
    staleHydro: number;
  };
  byConsumer: Record<SubstrateContactConsumer, SubstrateConsumerAvailability>;
  lastFallback: {
    consumer: SubstrateContactConsumer;
    x: number;
    z: number;
    reason: 'no-tile' | 'invalid-tile' | 'stale-terrain' | 'stale-hydro';
  } | null;
}

const CONSUMERS: readonly SubstrateContactConsumer[] = [
  'surface',
  'fluid',
  'wheel-support',
  'wet-effects',
  'frame-centre',
];

const emptyAvailability = (): Record<
  SubstrateContactConsumer,
  SubstrateConsumerAvailability
> => ({
  surface: { queries: 0, tile: 0, fallback: 0 },
  fluid: { queries: 0, tile: 0, fallback: 0 },
  'wheel-support': { queries: 0, tile: 0, fallback: 0 },
  'wet-effects': { queries: 0, tile: 0, fallback: 0 },
  'frame-centre': { queries: 0, tile: 0, fallback: 0 },
});

/**
 * Counts the real guarded-cutover consumers, not shadow/audit probes.
 *
 * Returning the contact through this monitor makes the rollback boundary
 * explicit: only an `unavailable` lookup can reach a legacy consumer.
 */
export class SubstrateFallbackMonitor {
  private queries = 0;
  private tileQueries = 0;
  private fallbackQueries = 0;
  private noTile = 0;
  private invalidTile = 0;
  private staleTerrain = 0;
  private staleHydro = 0;
  private byConsumer = emptyAvailability();
  private lastFallback: SubstrateFallbackSnapshot['lastFallback'] = null;

  reset(): void {
    this.queries = 0;
    this.tileQueries = 0;
    this.fallbackQueries = 0;
    this.noTile = 0;
    this.invalidTile = 0;
    this.staleTerrain = 0;
    this.staleHydro = 0;
    this.byConsumer = emptyAvailability();
    this.lastFallback = null;
  }

  consume(
    consumer: SubstrateContactConsumer,
    x: number,
    z: number,
    lookup: ProductionSubstrateLookup,
  ): SubstrateContact | undefined {
    this.queries++;
    const counts = this.byConsumer[consumer];
    counts.queries++;
    if (lookup.status === 'available') {
      this.tileQueries++;
      counts.tile++;
      return lookup.contact;
    }
    this.fallbackQueries++;
    counts.fallback++;
    if (lookup.reason === 'no-tile') this.noTile++;
    else if (lookup.reason === 'stale-terrain') this.staleTerrain++;
    else if (lookup.reason === 'stale-hydro') this.staleHydro++;
    else this.invalidTile++;
    this.lastFallback = { consumer, x, z, reason: lookup.reason };
    return undefined;
  }

  snapshot(): SubstrateFallbackSnapshot {
    const byConsumer = emptyAvailability();
    for (const consumer of CONSUMERS) {
      byConsumer[consumer] = { ...this.byConsumer[consumer] };
    }
    return {
      queries: this.queries,
      tileQueries: this.tileQueries,
      fallbackQueries: this.fallbackQueries,
      fallbackRate: this.queries ? this.fallbackQueries / this.queries : 0,
      reasons: {
        noTile: this.noTile,
        invalidTile: this.invalidTile,
        staleTerrain: this.staleTerrain,
        staleHydro: this.staleHydro,
      },
      byConsumer,
      lastFallback: this.lastFallback ? { ...this.lastFallback } : null,
    };
  }
}
