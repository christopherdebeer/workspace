/**
 * Pure vegetation distribution maths.
 *
 * The world owns cover, terrain, collision vetoes, site storage and recycling.
 * This module only answers where bounded candidates are proposed and how the
 * continuous habitat field divides them between stand, fringe and open ground.
 * Keeping that part pure lets fixtures and tests exercise the shipping maths
 * without recreating main.ts's mutable world.
 */

/**
 * The four distribution populations, plus `polygon`.
 *
 * A polygon stand is not a fifth spatial layer — ecologically it is a stand
 * interior — but it is deposited by OSM `landuse=forest` on tile arrival rather
 * than proposed by the habitat field, so it must be counted separately or the
 * distribution numbers are measuring someone else's decision. It is also the
 * one population a re-seed cannot regenerate, which is worth knowing before
 * clearing the grid.
 */
export type VegetationRole =
  | 'interior' | 'fringe' | 'living-stray' | 'ground-event' | 'polygon';
export type VegetationHabitat = 'open' | 'wood' | 'water' | 'cliff' | 'ruin';

export const VEGETATION_DISTRIBUTION = {
  /** A 5x5 stratified proposal set. The previous forest maximum was 25 clumps. */
  clumpCandidates: 25,
  /** Existing clump demand: ceiling * (floor + density * span). */
  demandFloor: 0.15,
  demandSpan: 1.25,
  /**
   * Smooth responses over the same continuous density value.
   *
   * `fringeIn` opens LOW — clump weight is one from d≈0.20 upward — because it
   * is the gate on whether a cell forms groups at all, and the first cut at
   * [0.12, 0.38] silently deleted half the vegetation at mid density: measured
   * −51% sites at highland and −48% at Big Sur against the same fixtures.
   * Only genuinely open ground (the bottom fifth of the field) is left to the
   * stray floor, which is what step 2.2 asks for; everything above it forms
   * groups and the stand/fringe split decides what KIND of group.
   */
  standIn: [0.42, 0.70] as const,
  fringeIn: [0.04, 0.20] as const,
  fringeOut: [0.70, 0.94] as const,
  /** Fringe groups cover more ground with fewer mutually hidden members. */
  fringeRadiusMul: 1.18,
  fringeCountMul: 0.52,
  /** A bounded second proposal set, not a target count or retry loop. */
  livingCandidates: 6,
  livingChance: {
    open: 0.11,
    wood: 0.05,
    water: 0.16,
    cliff: 0.035,
    ruin: 0.13,
  } satisfies Record<VegetationHabitat, number>,
  /** Promotion of an accepted living site, never an additional instance. */
  anchorChance: 0.0025,
} as const;

export interface VegetationCandidate {
  /** Position within the owning cell, in [0,1). */
  u: number;
  v: number;
  /** Independent rolls: changing one decision cannot move or reroll another. */
  accept: number;
  role: number;
  seed: number;
}

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));
const smooth = (a: number, b: number, x: number): number => {
  const t = clamp01((x - a) / (b - a || 1));
  return t * t * (3 - 2 * t);
};

/** Integer hash for stable candidate jitter and independent decision streams. */
function hashWord(gx: number, gz: number, index: number, salt: number): number {
  let h = Math.imul(gx | 0, 73856093) ^ Math.imul(gz | 0, 19349663)
    ^ Math.imul((index + 1) | 0, 83492791) ^ salt;
  h = Math.imul(h ^ (h >>> 15), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^ (h >>> 16)) >>> 0;
}

const hash01 = (gx: number, gz: number, index: number, salt: number): number =>
  hashWord(gx, gz, index, salt) / 4294967296;

/**
 * One bounded, stratified candidate. Stratification avoids both retry loops and
 * accidental clusters while the independent jitter prevents a visible lattice.
 */
export function vegetationCandidate(
  gx: number, gz: number, index: number, count: number, salt: number,
): VegetationCandidate {
  const cols = Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / cols);
  const ix = index % cols, iz = Math.floor(index / cols);
  return {
    u: (ix + 0.1 + hash01(gx, gz, index, salt + 11) * 0.8) / cols,
    v: (iz + 0.1 + hash01(gx, gz, index, salt + 23) * 0.8) / rows,
    accept: hash01(gx, gz, index, salt + 37),
    role: hash01(gx, gz, index, salt + 53),
    seed: hashWord(gx, gz, index, salt + 71),
  };
}

/**
 * The existing low-frequency value-noise field, unchanged. Sampling this at
 * each candidate rather than once at the cell centre is the behavioural change.
 */
export function vegetationDensity(x: number, z: number): number {
  const h = (px: number, pz: number): number => {
    const n = Math.sin(px * 12.9898 + pz * 78.233) * 43758.5453;
    return n - Math.floor(n);
  };
  const sx = x * 0.0011, sz = z * 0.0011;
  const ix = Math.floor(sx), iz = Math.floor(sz);
  const fx = sx - ix, fz = sz - iz;
  const u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
  return (h(ix, iz) * (1 - u) + h(ix + 1, iz) * u) * (1 - v)
    + (h(ix, iz + 1) * (1 - u) + h(ix + 1, iz + 1) * u) * v;
}

export interface VegetationRoleWeights {
  stand: number;
  fringe: number;
  open: number;
  /** How much of the old clump demand remains eligible at this density. */
  clump: number;
}

export function vegetationRoleWeights(density: number): VegetationRoleWeights {
  const d = clamp01(density);
  const stand = smooth(VEGETATION_DISTRIBUTION.standIn[0], VEGETATION_DISTRIBUTION.standIn[1], d);
  const fringe = smooth(VEGETATION_DISTRIBUTION.fringeIn[0], VEGETATION_DISTRIBUTION.fringeIn[1], d)
    * (1 - smooth(VEGETATION_DISTRIBUTION.fringeOut[0], VEGETATION_DISTRIBUTION.fringeOut[1], d));
  return {
    stand,
    fringe,
    open: 1 - stand,
    clump: Math.min(1, stand + fringe),
  };
}

/**
 * ── THE BUDGET IS MEMBERS, NOT GROUPS ──
 *
 * A fringe group deliberately carries `fringeCountMul` of a stand's membership,
 * because a loose transitional layer covering more ground with fewer mutually
 * hidden plants is the whole point. But counting GROUPS against the old demand
 * then spends fewer instances than the old code did, and the shortfall is
 * invisible in the acceptance rate: measured, roughly half the vegetation at
 * mid-density fixtures, because near half the accepted groups were fringe.
 *
 * So the demand is divided by the membership this density expects. The freed
 * budget becomes MORE fringe groups rather than fewer plants — step 2.5's first
 * option, a fixed candidate budget assigned among roles — and expected members
 * land on the old demand wherever clump weight is one, falling below it only on
 * the genuinely open ground the stray floor answers for.
 */
export function vegetationClumpChance(ceiling: number, density: number): number {
  const demand = Math.max(0, ceiling)
    * (VEGETATION_DISTRIBUTION.demandFloor + clamp01(density) * VEGETATION_DISTRIBUTION.demandSpan);
  const w = vegetationRoleWeights(density);
  const total = w.stand + w.fringe;
  const fringeShare = total > 1e-6 ? w.fringe / total : 0;
  const memberMul = 1 - fringeShare * (1 - VEGETATION_DISTRIBUTION.fringeCountMul);
  return clamp01(demand / (VEGETATION_DISTRIBUTION.clumpCandidates * Math.max(0.2, memberMul)))
    * w.clump;
}

/** Choose a coherent group role after the candidate itself has been accepted. */
export function vegetationClumpRole(density: number, roll: number): 'interior' | 'fringe' | null {
  const w = vegetationRoleWeights(density);
  const total = w.stand + w.fringe;
  if (total <= 1e-6) return null;
  return roll < w.stand / total ? 'interior' : 'fringe';
}

/**
 * Living strays occupy open and transitional ground. The habitat floor is
 * independent of clump demand and fades to zero inside strong stand interiors.
 */
export function vegetationLivingChance(habitat: VegetationHabitat, density: number): number {
  const open = 1 - smooth(0.58, 0.86, clamp01(density));
  return VEGETATION_DISTRIBUTION.livingChance[habitat] * open;
}
