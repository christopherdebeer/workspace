import { sampleFieldSurface } from '../hydro/field-sample';
import type { HydroSample, HydroTileField } from '../hydro/types';
import { resolveFluidContact } from './contact';
import type {
  FluidContact,
  SupportContact,
  WaterContact,
} from './types';

export interface HydroAdapterOptions {
  coverageCut?: number;
  waterId?: string;
  minimumFluidDepthM?: number;
}

export interface HydroContactLayers {
  water: WaterContact;
  fluid?: FluidContact;
}

/**
 * Adapt one production sample without requiring access to HydroSystem internals.
 * This is the runtime shadow-integration seam; the field sampler below and the
 * shipping game's live HydroSystem both feed this same conversion.
 */
export function adaptHydroSample(
  sample: HydroSample,
  support: SupportContact,
  options: HydroAdapterOptions = {},
): HydroContactLayers {
  const water: WaterContact = {
    source: 'production-hydro',
    kind: sample.kind,
    yM: sample.restingLevelM,
    bedY: sample.restingLevelM - sample.depthM,
    depthM: sample.depthM,
    coverage: sample.coverage,
    shoreDistanceM: sample.shoreDistanceM,
    flow: sample.flow,
    speedMps: null,
    speedAuthority: 'unknown',
    energy: null,
    vorticity: null,
    fetchM: sample.fetchM,
    bedMaterial: sample.bedMaterial,
    bankMaterial: sample.bankMaterial,
    intermittent: sample.intermittent,
    tidal: sample.tidal,
    exposed: true,
    waterId: options.waterId ?? 'production-hydro:sample',
  };
  return {
    water,
    fluid: resolveFluidContact(water, support, options.minimumFluidDepthM),
  };
}

/**
 * Project the shipping hydro field into the canonical layered contact model.
 *
 * Hydro currently owns level, depth, coverage, shore distance and flow
 * direction. It does not own a physical flow speed or crossing occlusion, so
 * those facts stay explicitly unknown instead of inheriting gameplay's
 * historical constants.
 */
export function sampleHydroContactLayers(
  field: HydroTileField,
  x: number,
  z: number,
  support: SupportContact,
  options: HydroAdapterOptions = {},
): HydroContactLayers | undefined {
  const sample = sampleFieldSurface(field, x, z, options.coverageCut ?? .5);
  if (!sample) return undefined;
  return adaptHydroSample(sample, support, {
    ...options,
    waterId: options.waterId
      ?? (field.bodyIds.length === 1 ? field.bodyIds[0] : `${field.key}:water`),
  });
}
