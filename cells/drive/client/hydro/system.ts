import * as THREE from 'three';
import { HydroBodyRegistry } from './body-registry';
import { analyseHydroTile, buildHydroTile, type HydroTileAnalysis } from './build-tile';
import { clamp } from './geometry';
import {
  createHydroFrameUniforms,
  createHydroMaterial,
  createHydroTextures,
  disposeHydroTextures,
  hydroBinding,
  type HydroFrameUniforms,
  type HydroTileGpuBinding,
  type HydroTileTextures,
} from './material';
import {
  DEFAULT_HYDRO_BUILD,
  DEFAULT_HYDRO_TUNING,
  HYDRO_ID_KIND,
  HydroFlags,
  type HydroBuildOptions,
  type HydroDebugView,
  type HydroFrame,
  type HydroSample,
  type HydroTuning,
  type HydroTileField,
  type HydroTileInput,
  type TileKey,
  type WorldBounds,
} from './types';

export interface HydroSystemOptions extends Partial<HydroBuildOptions> {
  /** Broad displacement geometry only; shoreline precision comes from fields. */
  meshResolution?: number;
  /** Registry-induced rebuilds admitted per frame. */
  rebuildsPerFrame?: number;
  /** Replace with a worker bridge without changing the public lifecycle. */
  scheduleBuild?: (job: () => HydroTileField) => Promise<HydroTileField>;
}

export interface HydroTileBinding extends HydroTileGpuBinding {
  readonly bounds: WorldBounds;
  /** Homogeneous transform from absolute world (x,z,1) to hydro texture UV. */
  readonly worldToHydroUv: THREE.Matrix3;
}

export interface HydroStats {
  tiles: number;
  visibleTiles: number;
  pendingBuilds: number;
  dirtyTiles: number;
}

export interface HydroSystem {
  readonly object3d: THREE.Object3D;
  upsertTile(input: HydroTileInput): Promise<void>;
  removeTile(key: TileKey): void;
  setOceanLevelM(elevationM: number): void;
  setDebugView(view: HydroDebugView): void;
  setTuning(patch: Partial<HydroTuning>): void;
  getTuning(): Readonly<HydroTuning>;
  update(frame: HydroFrame): void;
  getTileBinding(key: TileKey): HydroTileBinding | undefined;
  sampleRestingSurface(x: number, z: number): HydroSample | undefined;
  stats(): HydroStats;
  dispose(): void;
}

interface TileRecord {
  input: HydroTileInput;
  analysis: HydroTileAnalysis;
  generation: number;
  dirty: boolean;
  building: boolean;
  chain: Promise<void>;
  field?: HydroTileField;
  textures?: HydroTileTextures;
  material?: THREE.ShaderMaterial;
  mesh?: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  binding?: HydroTileBinding;
}

const immediateBuild = async (job: () => HydroTileField): Promise<HydroTileField> => job();

function worldToUv(field: HydroTileField): THREE.Matrix3 {
  const centralScale = field.resolution / field.width;
  const offset = field.gutter / field.width;
  const spanX = Math.max(Number.EPSILON, field.bounds.maxX - field.bounds.minX);
  const spanZ = Math.max(Number.EPSILON, field.bounds.maxZ - field.bounds.minZ);
  const sx = centralScale / spanX, sz = centralScale / spanZ;
  return new THREE.Matrix3().set(
    sx, 0, offset - field.bounds.minX * sx,
    0, sz, offset - field.bounds.minZ * sz,
    0, 0, 1,
  );
}

class DefaultHydroSystem implements HydroSystem {
  readonly object3d = new THREE.Group();
  private readonly records = new Map<TileKey, TileRecord>();
  private readonly registry: HydroBodyRegistry;
  private readonly frameUniforms: HydroFrameUniforms = createHydroFrameUniforms();
  private readonly buildOptions: HydroBuildOptions;
  private readonly grid: THREE.PlaneGeometry;
  private readonly scheduleBuild: (job: () => HydroTileField) => Promise<HydroTileField>;
  private readonly rebuildsPerFrame: number;
  private disposed = false;
  private tuning: HydroTuning = { ...DEFAULT_HYDRO_TUNING };

  constructor(options: HydroSystemOptions = {}) {
    this.buildOptions = {
      fieldResolution: options.fieldResolution ?? DEFAULT_HYDRO_BUILD.fieldResolution,
      gutter: options.gutter ?? DEFAULT_HYDRO_BUILD.gutter,
      oceanLevelM: options.oceanLevelM ?? DEFAULT_HYDRO_BUILD.oceanLevelM,
      shoreDistanceLimitM: options.shoreDistanceLimitM ?? DEFAULT_HYDRO_BUILD.shoreDistanceLimitM,
      minimumDepthM: options.minimumDepthM ?? DEFAULT_HYDRO_BUILD.minimumDepthM,
    };
    this.registry = new HydroBodyRegistry(this.buildOptions.oceanLevelM);
    this.scheduleBuild = options.scheduleBuild ?? immediateBuild;
    this.rebuildsPerFrame = Math.max(1, Math.floor(options.rebuildsPerFrame ?? 1));
    const segments = Math.max(4, Math.floor(options.meshResolution ?? 32));
    this.grid = new THREE.PlaneGeometry(1, 1, segments, segments);
    this.grid.rotateX(-Math.PI / 2);
    this.grid.computeBoundingSphere();
    this.object3d.name = 'hydro-system';
  }

  async upsertTile(input: HydroTileInput): Promise<void> {
    if (this.disposed) throw new Error('HydroSystem is disposed');
    this.validateInput(input);
    const current = this.records.get(input.key);
    if (current && input.revision < current.input.revision) return;

    const analysis = analyseHydroTile(input);
    const update = this.registry.updateTile(input.key, analysis.observations);
    let record = current;
    if (!record) {
      record = {
        input, analysis, generation: 1, dirty: true, building: false,
        chain: Promise.resolve(),
      };
      this.records.set(input.key, record);
    } else {
      record.input = input;
      record.analysis = analysis;
      record.generation++;
      record.dirty = true;
    }
    this.markBodiesDirty(update.changed, input.key);
    return this.queueBuild(input.key);
  }

  removeTile(key: TileKey): void {
    const record = this.records.get(key);
    if (!record) return;
    this.records.delete(key);
    record.generation++;
    this.releaseGpu(record);
    const update = this.registry.removeTile(key);
    this.markBodiesDirty(update.changed);
  }

  setOceanLevelM(elevationM: number): void {
    if (!Number.isFinite(elevationM)) throw new Error('ocean level must be finite');
    this.buildOptions.oceanLevelM = elevationM;
    this.markBodiesDirty(this.registry.setOceanLevelM(elevationM));
  }

  setDebugView(view: HydroDebugView): void {
    const views: HydroDebugView[] = ['surface', 'coverage', 'shore', 'depth', 'flow', 'class'];
    this.frameUniforms.uDebugView.value = Math.max(0, views.indexOf(view));
  }

  setTuning(patch: Partial<HydroTuning>): void {
    const finite = (value: number | undefined, fallback: number): number =>
      value === undefined || !Number.isFinite(value) ? fallback : clamp(value, 0, 8);
    this.tuning = {
      waveAmplitude: finite(patch.waveAmplitude, this.tuning.waveAmplitude),
      waveLength: finite(patch.waveLength, this.tuning.waveLength),
      rippleStrength: finite(patch.rippleStrength, this.tuning.rippleStrength),
      foamStrength: finite(patch.foamStrength, this.tuning.foamStrength),
      shoreFade: finite(patch.shoreFade, this.tuning.shoreFade),
    };
    this.frameUniforms.uWaveAmplitude.value = this.tuning.waveAmplitude;
    this.frameUniforms.uWaveLength.value = this.tuning.waveLength;
    this.frameUniforms.uRippleStrength.value = this.tuning.rippleStrength;
    this.frameUniforms.uFoamStrength.value = this.tuning.foamStrength;
    this.frameUniforms.uShoreFade.value = this.tuning.shoreFade;
  }

  getTuning(): Readonly<HydroTuning> { return { ...this.tuning }; }

  update(frame: HydroFrame): void {
    if (this.disposed) return;
    this.frameUniforms.uTime.value = frame.timeSeconds;
    this.frameUniforms.uWorldOrigin.value.set(frame.worldOrigin.x, frame.worldOrigin.y, frame.worldOrigin.z);
    const windLength = Math.hypot(frame.wind.x, frame.wind.z) || 1;
    this.frameUniforms.uWind.value.set(
      frame.wind.x / windLength,
      frame.wind.z / windLength,
      Math.max(0, frame.wind.speedMps),
    );
    this.frameUniforms.uRain.value = clamp(frame.rain, 0, 1);
    if (frame.sunDirection) {
      this.frameUniforms.uSunDirection.value
        .set(frame.sunDirection.x, frame.sunDirection.y, frame.sunDirection.z)
        .normalize();
    }

    let admitted = 0;
    for (const [key, record] of this.records) {
      if (record.mesh) this.placeMesh(record.mesh, record.input.bounds, frame.worldOrigin);
      if (record.dirty && !record.building && admitted < this.rebuildsPerFrame) {
        admitted++;
        void this.queueBuild(key);
      }
    }
  }

  getTileBinding(key: TileKey): HydroTileBinding | undefined {
    return this.records.get(key)?.binding;
  }

  sampleRestingSurface(x: number, z: number): HydroSample | undefined {
    // Active rings are small. If this grows, index records by the world tile
    // key already known to the caller rather than introducing another grid.
    for (const record of this.records.values()) {
      const field = record.field;
      if (!field || x < field.bounds.minX || x > field.bounds.maxX
        || z < field.bounds.minZ || z > field.bounds.maxZ) continue;
      const u = (x - field.bounds.minX) / Math.max(Number.EPSILON, field.bounds.maxX - field.bounds.minX);
      const v = (z - field.bounds.minZ) / Math.max(Number.EPSILON, field.bounds.maxZ - field.bounds.minZ);
      const ix = clamp(Math.round(field.gutter + u * (field.resolution - 1)), 0, field.width - 1);
      const iz = clamp(Math.round(field.gutter + v * (field.resolution - 1)), 0, field.height - 1);
      const i = iz * field.width + ix;
      const coverage = field.geometry[i * 4];
      if (coverage < 0.5) continue;
      const kindId = field.material[i * 4];
      const kind = HYDRO_ID_KIND[kindId];
      if (!kind) continue;
      const flag = field.material[i * 4 + 3];
      return {
        kind,
        coverage,
        restingLevelM: field.elevationBaseM + field.geometry[i * 4 + 2],
        shoreDistanceM: field.geometry[i * 4 + 1],
        depthM: field.geometry[i * 4 + 3],
        flow: [field.dynamics[i * 4], field.dynamics[i * 4 + 1]],
        fetchM: field.dynamics[i * 4 + 2],
        intermittent: (flag & HydroFlags.Intermittent) !== 0,
        tidal: (flag & HydroFlags.Tidal) !== 0,
      };
    }
    return undefined;
  }

  stats(): HydroStats {
    let visibleTiles = 0, pendingBuilds = 0, dirtyTiles = 0;
    for (const record of this.records.values()) {
      if (record.mesh) visibleTiles++;
      if (record.building) pendingBuilds++;
      if (record.dirty) dirtyTiles++;
    }
    return { tiles: this.records.size, visibleTiles, pendingBuilds, dirtyTiles };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const record of this.records.values()) {
      record.generation++;
      this.releaseGpu(record);
    }
    this.records.clear();
    this.registry.clear();
    this.grid.dispose();
    this.object3d.removeFromParent();
  }

  private queueBuild(key: TileKey): Promise<void> {
    const record = this.records.get(key);
    if (!record) return Promise.resolve();
    record.dirty = true;
    // A failed source tile must not poison every later revision's promise.
    // The caller that submitted the failed build still receives its rejection;
    // a subsequent upsert starts from a recovered queue.
    const prior = record.chain.catch(() => undefined);
    record.chain = prior.then(async () => {
      const live = this.records.get(key);
      if (!live || this.disposed || !live.dirty) return;
      const generation = live.generation;
      live.dirty = false;
      live.building = true;
      try {
        const field = await this.scheduleBuild(() => buildHydroTile(
          live.input, this.registry, live.analysis, this.buildOptions,
        ));
        const current = this.records.get(key);
        if (!current || current.generation !== generation || this.disposed) return;
        this.installField(current, field);
      } finally {
        const current = this.records.get(key);
        if (current) current.building = false;
      }
    });
    return record.chain;
  }

  private installField(record: TileRecord, field: HydroTileField): void {
    this.releaseGpu(record);
    record.field = field;
    if (!field.hasWater) return;
    const textures = createHydroTextures(field);
    const material = createHydroMaterial(field, textures, this.frameUniforms);
    const mesh = new THREE.Mesh(this.grid, material);
    const spanX = field.bounds.maxX - field.bounds.minX;
    const spanZ = field.bounds.maxZ - field.bounds.minZ;
    mesh.scale.set(spanX, 1, spanZ);
    const origin = this.frameUniforms.uWorldOrigin.value;
    mesh.position.set(
      (field.bounds.minX + field.bounds.maxX) * 0.5 - origin.x,
      0,
      (field.bounds.minZ + field.bounds.maxZ) * 0.5 - origin.z,
    );
    // GPU displacement changes y beyond the CPU geometry bounds. The streamed
    // ring is already the culling structure, so do not let a flat unit plane
    // incorrectly cull a mountain lake.
    mesh.frustumCulled = false;
    mesh.renderOrder = 2;
    mesh.name = `hydro-tile:${field.key}`;
    this.object3d.add(mesh);
    const base = hydroBinding(field, textures);
    record.textures = textures;
    record.material = material;
    record.mesh = mesh;
    record.binding = {
      ...base,
      bounds: field.bounds,
      worldToHydroUv: worldToUv(field),
    };
  }

  private releaseGpu(record: TileRecord): void {
    if (record.mesh) record.mesh.removeFromParent();
    record.material?.dispose();
    if (record.textures) disposeHydroTextures(record.textures);
    record.mesh = undefined;
    record.material = undefined;
    record.textures = undefined;
    record.binding = undefined;
    record.field = undefined;
  }

  private placeMesh(
    mesh: THREE.Mesh,
    bounds: WorldBounds,
    origin: HydroFrame['worldOrigin'],
  ): void {
    mesh.position.x = (bounds.minX + bounds.maxX) * 0.5 - origin.x;
    mesh.position.z = (bounds.minZ + bounds.maxZ) * 0.5 - origin.z;
  }

  private markBodiesDirty(ids: ReadonlySet<string>, exceptKey?: TileKey): void {
    if (!ids.size) return;
    for (const [key, record] of this.records) {
      if (key === exceptKey) continue;
      if (record.analysis.observations.some((observation) => ids.has(observation.id))) record.dirty = true;
    }
  }

  private validateInput(input: HydroTileInput): void {
    const b = input.bounds;
    if (!input.key || !Number.isFinite(input.revision)) throw new Error('HydroTileInput requires key and revision');
    if (![b.minX, b.minZ, b.maxX, b.maxZ].every(Number.isFinite)
      || b.maxX <= b.minX || b.maxZ <= b.minZ) throw new Error(`invalid hydro bounds for ${input.key}`);
    const elevationCells = input.elevation.width * input.elevation.height;
    if (input.elevation.width < 1 || input.elevation.height < 1
      || input.elevation.data.length < elevationCells) throw new Error(`invalid elevation grid for ${input.key}`);
    if (input.oceanCoverage.status === 'ready') {
      const grid = input.oceanCoverage.grid;
      if (grid.width < 1 || grid.height < 1 || grid.data.length < grid.width * grid.height) {
        throw new Error(`invalid ocean coverage for ${input.key}`);
      }
    }
  }
}

export function createHydroSystem(options: HydroSystemOptions = {}): HydroSystem {
  return new DefaultHydroSystem(options);
}
