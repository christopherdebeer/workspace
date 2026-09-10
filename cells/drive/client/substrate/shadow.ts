import type { CrossingKind, SupportContact } from './types';
import type { HydroContactLayers } from './hydro-adapter';

export interface LegacyFluidObservation {
  wet: boolean;
  depthM: number | null;
  speedMps: number | null;
  flow: readonly [number, number] | null;
}

export interface ShadowCrossingObservation {
  /**
   * Runtime production data currently has no authoritative crossing record.
   * Keep that absence explicit; do not infer a bridge or culvert from heights.
   */
  authority: 'canonical' | 'unresolved';
  kind?: CrossingKind;
  source?: 'tile' | 'registry' | 'none';
}

export interface SubstrateShadowObservation {
  x: number;
  z: number;
  /** Canonical support from the revisioned production substrate tile. */
  support: SupportContact;
  /** The shipping wheel/support answer being shadowed. */
  legacySupport?: SupportContact;
  hydro?: HydroContactLayers;
  /** Depth delivered to the active vehicle consumer after runtime clamping. */
  canonicalConsumerDepthM?: number | null;
  legacy: LegacyFluidObservation;
  crossing: ShadowCrossingObservation;
  substrateAuthority?: 'tile' | 'fallback';
}

export interface SubstrateShadowLastProbe {
  x: number;
  z: number;
  support: {
    kind: SupportContact['kind'];
    yM: number;
    material: SupportContact['material'];
    featureId?: string;
  };
  legacySupport: {
    kind: SupportContact['kind'];
    yM: number;
    material: SupportContact['material'];
    featureId?: string;
  } | null;
  canonical: {
    water: boolean;
    fluid: boolean;
    levelM: number | null;
    depthAboveSupportM: number | null;
    consumerDepthM: number | null;
    speedAuthority: 'resolved' | 'unknown' | null;
  };
  legacy: LegacyFluidObservation;
  crossing: ShadowCrossingObservation;
  substrateAuthority: 'tile' | 'fallback';
  wetAgreement: boolean;
  depthDeltaM: number | null;
  supportDeltaM: number | null;
}

export interface SubstrateShadowSnapshot {
  enabled: true;
  probes: number;
  tileProbes: number;
  fallbackProbes: number;
  hydroWater: number;
  canonicalFluid: number;
  driveWaterOverlap: number;
  wetAgreement: number;
  wetDisagreement: number;
  wetDisagreementRate: number;
  canonicalWetLegacyDry: number;
  legacyWetCanonicalDry: number;
  hydroBelowSupport: number;
  legacyWetWithoutHydro: number;
  unknownSpeed: number;
  unresolvedCrossing: number;
  support: {
    ground: number;
    drive: number;
    compared: number;
    meanAbsDeltaM: number | null;
    p95AbsDeltaM: number | null;
    maxAbsDeltaM: number | null;
  };
  depth: {
    compared: number;
    meanAbsDeltaM: number | null;
    p95AbsDeltaM: number | null;
    maxAbsDeltaM: number | null;
  };
  readyForCutover: boolean;
  gates: readonly SubstrateCutoverGate[];
  blockers: readonly string[];
  last: SubstrateShadowLastProbe | null;
}

export interface SubstrateCutoverGate {
  id:
    | 'total-probes'
    | 'tile-availability'
    | 'hydro-probes'
    | 'immersed-comparisons'
    | 'road-water-overlap'
    | 'wet-disagreement-rate'
    | 'depth-p95'
    | 'depth-maximum'
    | 'support-p95'
    | 'speed-authority'
    | 'crossing-authority';
  label: string;
  pass: boolean;
  observed: number | null;
  operator: 'gte' | 'lte' | 'lt' | 'eq';
  limit: number;
  unit: 'count' | 'ratio' | 'm';
}

const finiteOrNull = (value: number | null): number | null =>
  value !== null && Number.isFinite(value) ? value : null;

/** Fixed-memory 1mm histogram used for production parity percentiles. */
class DeltaHistogram {
  private static readonly BIN_M = .001;
  private static readonly MAX_M = 2;
  private readonly bins = new Uint32Array(
    Math.ceil(DeltaHistogram.MAX_M / DeltaHistogram.BIN_M) + 1,
  );
  private count = 0;

  reset(): void {
    this.bins.fill(0);
    this.count = 0;
  }

  observe(valueM: number): void {
    const index = Math.min(
      this.bins.length - 1,
      Math.floor(Math.max(0, valueM) / DeltaHistogram.BIN_M),
    );
    this.bins[index]++;
    this.count++;
  }

  percentile(fraction: number): number | null {
    if (!this.count) return null;
    const target = Math.max(1, Math.ceil(this.count * fraction));
    let seen = 0;
    for (let i = 0; i < this.bins.length; i++) {
      seen += this.bins[i];
      if (seen >= target) return i * DeltaHistogram.BIN_M;
    }
    return DeltaHistogram.MAX_M;
  }
}

/**
 * Read-only parity monitor for the production cutover.
 *
 * It consumes both answers but owns neither. In particular, it never returns
 * a contact to gameplay, so enabling the shadow cannot change rendering,
 * support, drag, wakes or vehicle motion.
 */
export class SubstrateShadowMonitor {
  private probes = 0;
  private tileProbes = 0;
  private fallbackProbes = 0;
  private hydroWater = 0;
  private canonicalFluid = 0;
  private driveWaterOverlap = 0;
  private wetAgreement = 0;
  private wetDisagreement = 0;
  private canonicalWetLegacyDry = 0;
  private legacyWetCanonicalDry = 0;
  private hydroBelowSupport = 0;
  private legacyWetWithoutHydro = 0;
  private unknownSpeed = 0;
  private unresolvedCrossing = 0;
  private groundSupport = 0;
  private driveSupport = 0;
  private supportCompared = 0;
  private supportAbsDeltaSumM = 0;
  private supportMaxAbsDeltaM = 0;
  private readonly supportAbsDelta = new DeltaHistogram();
  private depthCompared = 0;
  private depthAbsDeltaSumM = 0;
  private depthMaxAbsDeltaM = 0;
  private readonly depthAbsDelta = new DeltaHistogram();
  private last: SubstrateShadowLastProbe | null = null;

  reset(): void {
    this.probes = 0;
    this.tileProbes = 0;
    this.fallbackProbes = 0;
    this.hydroWater = 0;
    this.canonicalFluid = 0;
    this.driveWaterOverlap = 0;
    this.wetAgreement = 0;
    this.wetDisagreement = 0;
    this.canonicalWetLegacyDry = 0;
    this.legacyWetCanonicalDry = 0;
    this.hydroBelowSupport = 0;
    this.legacyWetWithoutHydro = 0;
    this.unknownSpeed = 0;
    this.unresolvedCrossing = 0;
    this.groundSupport = 0;
    this.driveSupport = 0;
    this.supportCompared = 0;
    this.supportAbsDeltaSumM = 0;
    this.supportMaxAbsDeltaM = 0;
    this.supportAbsDelta.reset();
    this.depthCompared = 0;
    this.depthAbsDeltaSumM = 0;
    this.depthMaxAbsDeltaM = 0;
    this.depthAbsDelta.reset();
    this.last = null;
  }

  observe(observation: SubstrateShadowObservation): void {
    this.probes++;
    const substrateAuthority = observation.substrateAuthority ?? 'tile';
    if (substrateAuthority === 'tile') this.tileProbes++;
    else this.fallbackProbes++;
    if (observation.support.kind === 'drive') this.driveSupport++;
    else this.groundSupport++;

    const canonicalWet = !!observation.hydro?.fluid;
    const canonicalWater = !!observation.hydro?.water;
    const legacyWet = observation.legacy.wet;
    if (canonicalWater) this.hydroWater++;
    if (canonicalWet) this.canonicalFluid++;
    if (canonicalWater && observation.support.kind === 'drive') this.driveWaterOverlap++;
    const agrees = canonicalWet === legacyWet;
    if (agrees) this.wetAgreement++;
    else {
      this.wetDisagreement++;
      if (canonicalWet) this.canonicalWetLegacyDry++;
      else this.legacyWetCanonicalDry++;
    }
    if (canonicalWater && !canonicalWet) this.hydroBelowSupport++;
    if (legacyWet && !canonicalWater) this.legacyWetWithoutHydro++;
    if (observation.hydro?.water.speedAuthority === 'unknown') this.unknownSpeed++;
    if (observation.crossing.authority === 'unresolved') this.unresolvedCrossing++;

    const canonicalRawDepth = observation.hydro?.fluid?.depthAboveSupportM ?? null;
    const canonicalDepth = finiteOrNull(
      Object.prototype.hasOwnProperty.call(observation, 'canonicalConsumerDepthM')
        ? observation.canonicalConsumerDepthM ?? null
        : canonicalRawDepth,
    );
    const legacyDepth = finiteOrNull(observation.legacy.depthM);
    const depthDeltaM = canonicalDepth !== null && legacyWet && legacyDepth !== null
      ? canonicalDepth - legacyDepth
      : null;
    if (depthDeltaM !== null) {
      const absDelta = Math.abs(depthDeltaM);
      this.depthCompared++;
      this.depthAbsDeltaSumM += absDelta;
      this.depthMaxAbsDeltaM = Math.max(this.depthMaxAbsDeltaM, absDelta);
      this.depthAbsDelta.observe(absDelta);
    }
    const supportDeltaM = observation.legacySupport
      ? observation.support.yM - observation.legacySupport.yM
      : null;
    if (supportDeltaM !== null && Number.isFinite(supportDeltaM)) {
      const absDelta = Math.abs(supportDeltaM);
      this.supportCompared++;
      this.supportAbsDeltaSumM += absDelta;
      this.supportMaxAbsDeltaM = Math.max(this.supportMaxAbsDeltaM, absDelta);
      this.supportAbsDelta.observe(absDelta);
    }

    this.last = {
      x: observation.x,
      z: observation.z,
      support: {
        kind: observation.support.kind,
        yM: observation.support.yM,
        material: observation.support.material,
        ...(observation.support.featureId
          ? { featureId: observation.support.featureId }
          : {}),
      },
      legacySupport: observation.legacySupport ? {
        kind: observation.legacySupport.kind,
        yM: observation.legacySupport.yM,
        material: observation.legacySupport.material,
        ...(observation.legacySupport.featureId
          ? { featureId: observation.legacySupport.featureId }
          : {}),
      } : null,
      canonical: {
        water: canonicalWater,
        fluid: canonicalWet,
        levelM: observation.hydro?.water.yM ?? null,
        depthAboveSupportM: canonicalRawDepth,
        consumerDepthM: canonicalDepth,
        speedAuthority: observation.hydro?.water.speedAuthority ?? null,
      },
      legacy: {
        wet: legacyWet,
        depthM: legacyDepth,
        speedMps: finiteOrNull(observation.legacy.speedMps),
        flow: observation.legacy.flow,
      },
      crossing: { ...observation.crossing },
      substrateAuthority,
      wetAgreement: agrees,
      depthDeltaM,
      supportDeltaM,
    };
  }

  snapshot(): SubstrateShadowSnapshot {
    const wetDisagreementRate = this.probes
      ? this.wetDisagreement / this.probes
      : 0;
    const depthP95 = this.depthAbsDelta.percentile(.95);
    const supportP95 = this.supportAbsDelta.percentile(.95);
    const gates: SubstrateCutoverGate[] = [
      {
        id: 'total-probes',
        label: 'fewer than 100 probes',
        pass: this.probes >= 100,
        observed: this.probes,
        operator: 'gte',
        limit: 100,
        unit: 'count',
      },
      {
        id: 'tile-availability',
        label: 'substrate tile unavailable for some probes',
        pass: this.fallbackProbes === 0,
        observed: this.fallbackProbes,
        operator: 'eq',
        limit: 0,
        unit: 'count',
      },
      {
        id: 'hydro-probes',
        label: 'fewer than 25 hydro-water probes',
        pass: this.hydroWater >= 25,
        observed: this.hydroWater,
        operator: 'gte',
        limit: 25,
        unit: 'count',
      },
      {
        id: 'immersed-comparisons',
        label: 'fewer than 10 immersed-depth comparisons',
        pass: this.depthCompared >= 10,
        observed: this.depthCompared,
        operator: 'gte',
        limit: 10,
        unit: 'count',
      },
      {
        id: 'road-water-overlap',
        label: 'no road/water overlap probes',
        pass: this.driveWaterOverlap >= 1,
        observed: this.driveWaterOverlap,
        operator: 'gte',
        limit: 1,
        unit: 'count',
      },
      {
        id: 'wet-disagreement-rate',
        label: 'wet-contact disagreement at or above 0.1%',
        pass: wetDisagreementRate < .001,
        observed: wetDisagreementRate,
        operator: 'lt',
        limit: .001,
        unit: 'ratio',
      },
      {
        id: 'depth-p95',
        label: 'fluid-depth p95 delta above 0.10m',
        pass: depthP95 !== null && depthP95 <= .1,
        observed: depthP95,
        operator: 'lte',
        limit: .1,
        unit: 'm',
      },
      {
        id: 'depth-maximum',
        label: 'fluid-depth maximum delta above 0.25m',
        pass: this.depthCompared > 0 && this.depthMaxAbsDeltaM <= .25,
        observed: this.depthCompared ? this.depthMaxAbsDeltaM : null,
        operator: 'lte',
        limit: .25,
        unit: 'm',
      },
      {
        id: 'support-p95',
        label: 'support-height p95 delta above 0.03m',
        pass: supportP95 !== null && supportP95 <= .03,
        observed: supportP95,
        operator: 'lte',
        limit: .03,
        unit: 'm',
      },
      {
        id: 'speed-authority',
        label: 'production hydro has no speed authority',
        pass: this.unknownSpeed === 0,
        observed: this.unknownSpeed,
        operator: 'eq',
        limit: 0,
        unit: 'count',
      },
      {
        id: 'crossing-authority',
        label: 'crossing semantics unresolved',
        pass: this.unresolvedCrossing === 0,
        observed: this.unresolvedCrossing,
        operator: 'eq',
        limit: 0,
        unit: 'count',
      },
    ];
    const blockers = gates.filter((gate) => !gate.pass).map((gate) => gate.label);
    return {
      enabled: true,
      probes: this.probes,
      tileProbes: this.tileProbes,
      fallbackProbes: this.fallbackProbes,
      hydroWater: this.hydroWater,
      canonicalFluid: this.canonicalFluid,
      driveWaterOverlap: this.driveWaterOverlap,
      wetAgreement: this.wetAgreement,
      wetDisagreement: this.wetDisagreement,
      wetDisagreementRate,
      canonicalWetLegacyDry: this.canonicalWetLegacyDry,
      legacyWetCanonicalDry: this.legacyWetCanonicalDry,
      hydroBelowSupport: this.hydroBelowSupport,
      legacyWetWithoutHydro: this.legacyWetWithoutHydro,
      unknownSpeed: this.unknownSpeed,
      unresolvedCrossing: this.unresolvedCrossing,
      support: {
        ground: this.groundSupport,
        drive: this.driveSupport,
        compared: this.supportCompared,
        meanAbsDeltaM: this.supportCompared
          ? this.supportAbsDeltaSumM / this.supportCompared
          : null,
        p95AbsDeltaM: supportP95,
        maxAbsDeltaM: this.supportCompared ? this.supportMaxAbsDeltaM : null,
      },
      depth: {
        compared: this.depthCompared,
        meanAbsDeltaM: this.depthCompared
          ? this.depthAbsDeltaSumM / this.depthCompared
          : null,
        p95AbsDeltaM: depthP95,
        maxAbsDeltaM: this.depthCompared ? this.depthMaxAbsDeltaM : null,
      },
      readyForCutover: blockers.length === 0,
      gates,
      blockers,
      last: this.last,
    };
  }
}
