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
  /** Per-tile fed-versus-held truth for the harness — see the implementation. */
  debugTiles(): Array<Record<string, unknown>>;
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
  mesh?: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  geometry?: THREE.BufferGeometry;
  binding?: HydroTileBinding;
}

const immediateBuild = async (job: () => HydroTileField): Promise<HydroTileField> => job();

/**
 * ── A MESH OVER THE WATER, NOT OVER THE TILE ──
 *
 * The shared unit grid spans whatever rect the mesh is scaled to, and every
 * quad of it is rasterised whether or not there is water under it. That is
 * cheap when the rect is a pond and ruinous when it is a tile: a river ten
 * metres wide crossing 2.4km of ground touches perhaps thirty of a 32x32
 * lattice's thousand cells, and the other 970 are shaded and discarded.
 *
 * Narrowing the rect to the water's bounding box helps a pond and does almost
 * nothing for that river, whose bbox is very nearly the whole tile. So the
 * cull has to follow the water's SHAPE, which is what this does: keep only the
 * cells with coverage under them, dilated by one so the shore fade and the
 * wave displacement have a cell to move into.
 *
 * The fragment shader carries a `discard`, which on most hardware forfeits
 * early-Z — so the cells being skipped here were not merely overdrawn, they
 * were shaded before the depth test could reject them, including where they
 * lay buried under a hillside. That is why the cost was so much worse from the
 * cab than from directly above: a near-horizontal sheet at eye level fills the
 * view, and a ring of tiles is that many screens of it.
 *
 * Positions are the same unit plane the shared grid used — x,z in [-0.5, 0.5],
 * uv.y=1 at the minZ edge to match `PlaneGeometry` after `rotateX(-PI/2)` — so
 * `fieldUvFor` and the shaders need no adjustment at all.
 */
function waterGeometry(field: HydroTileField, segments: number): THREE.BufferGeometry {
  const rect = field.waterBounds ?? field.bounds;
  const spanX = Math.max(Number.EPSILON, field.bounds.maxX - field.bounds.minX);
  const spanZ = Math.max(Number.EPSILON, field.bounds.maxZ - field.bounds.minZ);
  const rectSpanX = Math.max(Number.EPSILON, rect.maxX - rect.minX);
  const rectSpanZ = Math.max(Number.EPSILON, rect.maxZ - rect.minZ);

  // Keep approximately the same cell budget as the old square grid, but spend
  // it in metres rather than equally per axis. A 200m x 2.4km river used to
  // get 32 cells both ways: exquisite cross-channel sampling and 75m steps
  // downstream. The anisotropic grid is roughly square in world space
  // (~9 x 111 for that reach), restoring longitudinal volume at no meaningful
  // triangle or fragment cost. Square ocean tiles remain 32 x 32.
  const budget = segments * segments;
  const aspect = rectSpanX / rectSpanZ;
  const segmentsX = Math.round(clamp(Math.sqrt(budget * aspect), 4, 128));
  const segmentsZ = Math.round(clamp(Math.sqrt(budget / aspect), 4, 128));

  // ── A CELL IS TESTED OVER ITS WHOLE SPAN, NOT AT ITS CORNERS ──
  //
  // A lattice cell can cover several field texels and a ten-metre river may
  // cross through its middle without touching a corner. Each anisotropic cell
  // therefore asks every texel it spans, plus one texel of shoreline margin.
  const fieldIx = (x: number): number =>
    field.gutter + ((x - field.bounds.minX) / spanX) * (field.resolution - 1);
  const fieldIz = (z: number): number =>
    field.gutter + ((z - field.bounds.minZ) / spanZ) * (field.resolution - 1);
  const keep = new Uint8Array(segmentsX * segmentsZ);
  for (let j = 0; j < segmentsZ; j++) for (let i = 0; i < segmentsX; i++) {
    const x0 = rect.minX + (i / segmentsX) * rectSpanX;
    const x1 = rect.minX + ((i + 1) / segmentsX) * rectSpanX;
    const z0 = rect.minZ + (j / segmentsZ) * rectSpanZ;
    const z1 = rect.minZ + ((j + 1) / segmentsZ) * rectSpanZ;
    const ix0 = Math.max(0, Math.floor(fieldIx(x0)) - 1);
    const ix1 = Math.min(field.width - 1, Math.ceil(fieldIx(x1)) + 1);
    const iz0 = Math.max(0, Math.floor(fieldIz(z0)) - 1);
    const iz1 = Math.min(field.height - 1, Math.ceil(fieldIz(z1)) + 1);
    let any = false;
    for (let iz = iz0; iz <= iz1 && !any; iz++) {
      for (let ix = ix0; ix <= ix1; ix++) {
        if (field.geometry[(iz * field.width + ix) * 4] > 0.005) { any = true; break; }
      }
    }
    if (any) keep[j * segmentsX + i] = 1;
  }
  const pos: number[] = [], uvs: number[] = [], idx: number[] = [];
  const vert = new Map<number, number>();
  const at = (i: number, j: number): number => {
    const k = j * (segmentsX + 1) + i;
    let v = vert.get(k);
    if (v === undefined) {
      v = pos.length / 3;
      pos.push(i / segmentsX - 0.5, 0, j / segmentsZ - 0.5);
      uvs.push(i / segmentsX, 1 - j / segmentsZ);
      vert.set(k, v);
    }
    return v;
  };
  for (let j = 0; j < segmentsZ; j++) for (let i = 0; i < segmentsX; i++) {
    if (!keep[j * segmentsX + i]) continue;
    const a = at(i, j), b = at(i + 1, j), c = at(i, j + 1), d = at(i + 1, j + 1);
    idx.push(a, c, b, b, c, d);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(idx);
  geo.computeBoundingSphere();
  return geo;
}

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
  private readonly meshSegments: number;
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
    this.meshSegments = Math.max(4, Math.floor(options.meshResolution ?? 32));
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
    const rig = frame.rig;
    this.frameUniforms.uRig.value.set(rig?.x ?? 0, rig?.z ?? 0, rig?.vx ?? 0, rig?.vz ?? 0);
    this.frameUniforms.uRigWade.value = Math.max(0, rig?.wadeM ?? 0);
    if (frame.sunDirection) {
      this.frameUniforms.uSunDirection.value
        .set(frame.sunDirection.x, frame.sunDirection.y, frame.sunDirection.z)
        .normalize();
    }

    let admitted = 0;
    for (const [key, record] of this.records) {
      // THE SAME RECT THE MESH WAS SCALED TO. It spans the water, not the
      // tile, and re-placing it on the tile's centre every frame would undo
      // that — a mesh the size of the river sitting in the middle of the tile.
      if (record.mesh) {
        this.placeMesh(record.mesh, record.field?.waterBounds ?? record.input.bounds, frame.worldOrigin);
      }
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

  /** Per-tile truth for the harness: what each record was FED against what its
   *  field actually HOLDS. A world with features fed and every wet count at
   *  zero localises the fault to the build; features at zero localises it to
   *  the feed. `stats()` can say neither. */
  debugTiles(): Array<Record<string, unknown>> {
    const out: Array<Record<string, unknown>> = [];
    for (const [key, record] of this.records) {
      const field = record.field;
      let touched = 0, wet = 0, max = 0;
      if (field) {
        for (let i = 0; i < field.width * field.height; i++) {
          const c = field.geometry[i * 4];
          if (c > 0.005) touched++;
          if (c >= 0.5) wet++;
          if (c > max) max = c;
        }
      }
      out.push({
        key, feats: record.input.features.length,
        kinds: record.input.features.map((f) => f.kind),
        ocean: record.input.oceanCoverage.status,
        built: !!field, hasWater: field?.hasWater ?? null,
        touched, wet, maxCov: +max.toFixed(3),
        mesh: !!record.mesh, dirty: record.dirty, building: record.building,
      });
    }
    return out;
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
      // Captured before the build so the replacement can keep this field's
      // answers under any texel the new coverage cannot answer — a revision
      // may add knowledge, never destroy it (see buildHydroTile).
      const previous = live.field;
      try {
        const field = await this.scheduleBuild(() => buildHydroTile(
          live.input, this.registry, live.analysis, this.buildOptions, previous,
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
    // The cull first: a tile can report water and still keep no cell, when the
    // coverage is a sliver the lattice cannot resolve. Building the textures
    // before finding that out would leak two float RGBA uploads per tile.
    const geometry = waterGeometry(field, this.meshSegments);
    if (!geometry.getIndex()?.count) { geometry.dispose(); return; }
    const textures = createHydroTextures(field);
    const material = createHydroMaterial(field, textures, this.frameUniforms);
    const mesh = new THREE.Mesh(geometry, material);
    // ── THE MESH COVERS THE WATER, NOT THE TILE ──
    //
    // A tile is 2.4km across and a river ten metres wide, so spanning
    // `bounds` rasterised the whole tile to show about two per cent water —
    // and because the fragment shader carries a `discard` it forfeits early-Z,
    // so even the parts buried under a hillside were shaded before being
    // thrown away. From above that is merely wasteful; from the cab a
    // near-horizontal sheet at eye level fills the view, and with a ring of
    // tiles it is that many times the screen shaded for nothing. Reported as
    // 60fps falling to 4 in chase while top-down stayed fine, with no water
    // visible in chase at all — invisible and expensive being the same fact.
    //
    // `waterBounds` is the rect the coverage actually occupies, padded a
    // texel. Falls back to the tile when it is absent, which is the old
    // behaviour and only happens on a tile with no water — and those are not
    // meshed at all.
    const rect = field.waterBounds ?? field.bounds;
    const spanX = rect.maxX - rect.minX;
    const spanZ = rect.maxZ - rect.minZ;
    mesh.scale.set(spanX, 1, spanZ);
    const origin = this.frameUniforms.uWorldOrigin.value;
    mesh.position.set(
      (rect.minX + rect.maxX) * 0.5 - origin.x,
      0,
      (rect.minZ + rect.maxZ) * 0.5 - origin.z,
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
    record.geometry = geometry;
    record.binding = {
      ...base,
      bounds: field.bounds,
      worldToHydroUv: worldToUv(field),
    };
  }

  private releaseGpu(record: TileRecord): void {
    if (record.mesh) record.mesh.removeFromParent();
    // Per-tile now, so it is per-tile to dispose — the shared grid never was.
    record.geometry?.dispose();
    record.material?.dispose();
    if (record.textures) disposeHydroTextures(record.textures);
    record.mesh = undefined;
    record.geometry = undefined;
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
