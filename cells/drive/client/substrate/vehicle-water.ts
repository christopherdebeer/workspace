import { clamp } from '../num';

export type VehicleWaterAuthority = 'substrate' | 'legacy' | 'none';
export type VehicleWaterStampKind = 'track' | 'drip';

export interface VehicleWaterWheelSample {
  x: number;
  z: number;
  /** Render-space support height under the tyre. */
  yM: number;
  /** True only while this contact patch is in exposed water. */
  wet: boolean;
}

export interface VehicleWaterStamp {
  kind: VehicleWaterStampKind;
  x: number;
  z: number;
  yM: number;
  heading: number;
  bornSeconds: number;
  lifeSeconds: number;
  strength: number;
}

export interface VehicleWaterEvidenceInput {
  dt: number;
  timeSeconds: number;
  x: number;
  z: number;
  vx: number;
  vz: number;
  heading: number;
  /** Smoothed depth currently displacing the hull. */
  depthM: number;
  /** The resolved centre contact, before smoothing. */
  inWater: boolean;
  authority: VehicleWaterAuthority;
  wheels: readonly VehicleWaterWheelSample[];
}

export interface VehicleWaterEvidenceSnapshot {
  authority: VehicleWaterAuthority;
  inWater: boolean;
  entered: boolean;
  exited: boolean;
  depthM: number;
  wakeStrength: number;
  tyreWetness: readonly number[];
  hullWetness: number;
  exitAgeSeconds: number | null;
  activeTracks: number;
  activeDrips: number;
  emitted: readonly VehicleWaterStamp[];
}

interface TrackCursor {
  x: number;
  z: number;
}

/**
 * One deterministic history for every visible consequence of vehicle/water
 * contact. It owns carry after the contact has ended; renderers merely display
 * its stamps and wetness. No random source or frame-rate-dependent emission is
 * used, so representative drives can compare the evidence exactly.
 */
export class VehicleWaterEvidence {
  private readonly tyreWetness: number[];
  private readonly trackCursor: Array<TrackCursor | undefined>;
  private readonly stamps: VehicleWaterStamp[] = [];
  private wasInWater = false;
  private hullWetness = 0;
  private exitedAt: number | null = null;
  private nextDripAt = Infinity;
  private dripSide = -1;
  private snapshotValue: VehicleWaterEvidenceSnapshot;

  constructor(wheelCount = 4) {
    this.tyreWetness = Array.from({ length: wheelCount }, () => 0);
    this.trackCursor = Array.from({ length: wheelCount }, () => undefined);
    this.snapshotValue = {
      authority: 'none',
      inWater: false,
      entered: false,
      exited: false,
      depthM: 0,
      wakeStrength: 0,
      tyreWetness: [...this.tyreWetness],
      hullWetness: 0,
      exitAgeSeconds: null,
      activeTracks: 0,
      activeDrips: 0,
      emitted: [],
    };
  }

  step(input: VehicleWaterEvidenceInput): VehicleWaterEvidenceSnapshot {
    const dt = clamp(Number.isFinite(input.dt) ? input.dt : 0, 0, .25);
    const time = Number.isFinite(input.timeSeconds) ? input.timeSeconds : 0;
    const speed = Math.hypot(input.vx, input.vz);
    const depthM = input.inWater ? Math.max(0, input.depthM) : 0;
    const entered = input.inWater && !this.wasInWater;
    const exited = !input.inWater && this.wasInWater;
    const emitted: VehicleWaterStamp[] = [];

    if (input.inWater) {
      this.hullWetness += (1 - this.hullWetness) * Math.min(1, dt * 4.5);
      this.exitedAt = null;
      this.nextDripAt = Infinity;
    } else {
      this.hullWetness *= Math.exp(-dt / 13);
      if (this.hullWetness < .002) this.hullWetness = 0;
    }
    if (exited) {
      this.exitedAt = time;
      this.nextDripAt = time + .18;
    }

    for (let i = 0; i < this.tyreWetness.length; i++) {
      const wheel = input.wheels[i];
      const wet = wheel?.wet || input.inWater && depthM > .18;
      if (wet) {
        this.tyreWetness[i] += (1 - this.tyreWetness[i]) * Math.min(1, dt * 10);
        this.trackCursor[i] = undefined;
      } else {
        this.tyreWetness[i] *= Math.exp(-dt / 18);
        if (this.tyreWetness[i] < .002) this.tyreWetness[i] = 0;
      }

      // A contact patch carries a dark print out of the water. Distance, not
      // frame count, sets the cadence, so 30fps and 120fps produce the same
      // trail density over a representative drive.
      if (!wheel || wet || this.tyreWetness[i] < .075) continue;
      const cursor = this.trackCursor[i];
      const gap = cursor ? Math.hypot(wheel.x - cursor.x, wheel.z - cursor.z) : Infinity;
      if (gap < .62) continue;
      const stamp: VehicleWaterStamp = {
        kind: 'track',
        x: wheel.x,
        z: wheel.z,
        yM: wheel.yM + .018,
        heading: input.heading,
        bornSeconds: time,
        lifeSeconds: 32,
        strength: clamp(this.tyreWetness[i] * (.48 + speed * .025), .06, 1),
      };
      this.pushStamp(stamp);
      emitted.push(stamp);
      this.trackCursor[i] = { x: wheel.x, z: wheel.z };
    }

    // Water retained by the hull drains after exit. These are separate from
    // tyre prints: they continue briefly while parked and decay with the same
    // wetness state that darkens the tyres.
    if (!input.inWater && this.exitedAt !== null && this.hullWetness > .035
      && time >= this.nextDripAt && time - this.exitedAt < 11) {
      const rightX = Math.cos(input.heading);
      const rightZ = Math.sin(input.heading);
      const stamp: VehicleWaterStamp = {
        kind: 'drip',
        x: input.x + rightX * .42 * this.dripSide,
        z: input.z + rightZ * .42 * this.dripSide,
        yM: this.supportY(input.wheels),
        heading: input.heading,
        bornSeconds: time,
        lifeSeconds: 14,
        strength: clamp(this.hullWetness * .8, .06, .8),
      };
      this.dripSide *= -1;
      this.nextDripAt = time + .34 + (1 - this.hullWetness) * .72;
      this.pushStamp(stamp);
      emitted.push(stamp);
    }

    this.prune(time);
    this.wasInWater = input.inWater;
    const wakeStrength = input.inWater
      ? clamp(depthM / .55, 0, 1) * clamp(.38 + speed * .09, .38, 1)
      : 0;
    let activeTracks = 0;
    let activeDrips = 0;
    for (const stamp of this.stamps) {
      if (stamp.kind === 'track') activeTracks++;
      else activeDrips++;
    }
    this.snapshotValue = {
      authority: input.authority,
      inWater: input.inWater,
      entered,
      exited,
      depthM,
      wakeStrength,
      tyreWetness: [...this.tyreWetness],
      hullWetness: this.hullWetness,
      exitAgeSeconds: this.exitedAt === null ? null : Math.max(0, time - this.exitedAt),
      activeTracks,
      activeDrips,
      emitted,
    };
    return this.snapshotValue;
  }

  snapshot(): VehicleWaterEvidenceSnapshot {
    return this.snapshotValue;
  }

  activeStamps(timeSeconds: number): readonly VehicleWaterStamp[] {
    this.prune(timeSeconds);
    return this.stamps;
  }

  reset(): void {
    this.tyreWetness.fill(0);
    this.trackCursor.fill(undefined);
    this.stamps.length = 0;
    this.wasInWater = false;
    this.hullWetness = 0;
    this.exitedAt = null;
    this.nextDripAt = Infinity;
    this.snapshotValue = {
      authority: 'none',
      inWater: false,
      entered: false,
      exited: false,
      depthM: 0,
      wakeStrength: 0,
      tyreWetness: [...this.tyreWetness],
      hullWetness: 0,
      exitAgeSeconds: null,
      activeTracks: 0,
      activeDrips: 0,
      emitted: [],
    };
  }

  private supportY(wheels: readonly VehicleWaterWheelSample[]): number {
    let sum = 0;
    let count = 0;
    for (const wheel of wheels) {
      if (!Number.isFinite(wheel.yM)) continue;
      sum += wheel.yM;
      count++;
    }
    return count ? sum / count + .022 : .022;
  }

  private pushStamp(stamp: VehicleWaterStamp): void {
    this.stamps.push(stamp);
    if (this.stamps.length > 192) this.stamps.splice(0, this.stamps.length - 192);
  }

  private prune(time: number): void {
    let write = 0;
    for (const stamp of this.stamps) {
      if (time - stamp.bornSeconds >= stamp.lifeSeconds) continue;
      this.stamps[write++] = stamp;
    }
    this.stamps.length = write;
  }
}
