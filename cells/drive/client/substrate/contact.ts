import type {
  FluidContact,
  SupportContact,
  WaterContact,
} from './types';

/**
 * Resolve physical immersion from already-resolved layers.
 *
 * Water existing at x/z is not enough: it may be hidden in a culvert or lie
 * metres below a bridge deck. Physics and effects should consume this answer
 * rather than each repeating its own deck-versus-water comparison.
 */
export function resolveFluidContact(
  water: WaterContact | undefined,
  support: SupportContact,
  minimumDepthM = .01,
): FluidContact | undefined {
  if (!water?.exposed) return undefined;
  const depthAboveSupportM = water.yM - support.yM;
  if (!Number.isFinite(depthAboveSupportM)
    || depthAboveSupportM <= Math.max(0, minimumDepthM)) return undefined;
  return { ...water, depthAboveSupportM };
}
