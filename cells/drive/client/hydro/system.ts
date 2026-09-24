import * as THREE from 'three';
import { HydroBodyRegistry } from './body-registry';
import { analyseHydroTile, buildHydroTile, estimateFlowingCoverageShare, seaTouching, seaTouchingStats, type HydroTileAnalysis } from './build-tile';
import { clamp, sampleElevation } from './geometry';
import { sampleFieldSurface } from './field-sample';
import { extractHydroShoreSegments } from './shore-contour';
import {
  createHydroFrameUniforms,
  createHydroMaterial,
  createHydroTextures,
  disposeHydroTextures,
  hydroBinding,
  type HydroFrameUniforms,
  type HydroTileGpuBinding,
  type HydroTileTextures,
  type SceneShade,
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
  /**
   * Ocean/lagoon geometry tier relative to the broad river/lake lattice.
   * Production's 32-cell base becomes 96 cells across coastal tiles: enough
   * for geometric swell and crest shape without charging every river tile.
   */
  coastalMeshMultiplier?: number;
  /** Registry-induced rebuilds admitted per frame. */
  rebuildsPerFrame?: number;
  /**
   * Higher field tier for river/stream/canal tiles. Dry and standing-water
   * records retain `fieldResolution`, avoiding a fourfold memory tax across
   * the streamed ring solely to place narrow channel banks more precisely.
   */
  flowingFieldResolution?: number;
  /** Replace with a worker bridge without changing the public lifecycle. */
  scheduleBuild?: (job: () => HydroTileField) => Promise<HydroTileField>;
  /** The scene's own darkening of a lit surface — the cloud deck's shadow —
   *  so the water shades where the ground beside it shades. */
  sceneShade?: SceneShade;
  /**
   * Build and retain fields without creating render resources. A versioned
   * substrate tile can then commit that exact field through `renderField`.
   * This is the guarded production-render cutover; false preserves rollback.
   */
  deferRendering?: boolean;
  /** See HydroBuildOptions.dryShortCircuit — `?hydrodry=0` is the A/B. */
  dryShortCircuit?: boolean;
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
  /** How many fields have been installed. The sward's ground revision adds
   *  it, so reed and mineral banks (client/shoreline.ts) re-sweep when the
   *  water they stand beside is built or rebuilt — started by another agent
   *  as a placeholder, made to count here. */
  readonly bankRevision: number;
  /** The built field under a point, for the bank sampler — undefined until
   *  the tile has built or where there is no tile. */
  fieldAt(x: number, z: number): HydroTileField | undefined;
  upsertTile(input: HydroTileInput): Promise<void>;
  removeTile(key: TileKey): void;
  setOceanLevelM(elevationM: number): void;
  setDebugView(view: HydroDebugView): void;
  setTuning(patch: Partial<HydroTuning>): void;
  getTuning(): Readonly<HydroTuning>;
  update(frame: HydroFrame): void;
  getTileBinding(key: TileKey): HydroTileBinding | undefined;
  debugTile(key: TileKey): object | null;
  /**
   * True only when `field` is the exact immutable field currently retained
   * for its tile and can therefore be committed without changing authority.
   * Substrate uses this as the non-mutating half of an atomic render preflight.
   */
  canRenderField(field: HydroTileField): boolean;
  /**
   * Commit the exact field retained by this system to GPU rendering.
   * Returns false for stale, foreign, or superseded fields.
   */
  renderField(field: HydroTileField): boolean;
  /**
   * Remove a tile's render resources while retaining its immutable field.
   * Substrate invalidation uses this while a replacement tile is assembled.
   */
  unrenderTile(key: TileKey): void;
  /**
   * Sample the field at a caller-owned coverage cut. The default preserves
   * the field's canonical 0.5 classification; rendering/physics callers pass
   * the same world-space shoreline cut used by the shader.
   */
  sampleRestingSurface(x: number, z: number, coverageCut?: number): HydroSample | undefined;
  /** Everything that decided the surface at a point: the texel, the bodies
   *  the tile holds and how each one's level was modelled. */
  debugAt(x: number, z: number): Record<string, unknown> | null;
  stats(): HydroStats;
  /** Per-tile fed-versus-held truth for the harness — see the implementation. */
  debugTiles(): Array<Record<string, unknown>>;
  dispose(): void;
}

interface TilePart {
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  geometry: THREE.BufferGeometry;
  material: THREE.ShaderMaterial;
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
  /** Standing, flowing, and (for coastal tiles) a narrow swash overlay. */
  parts: TilePart[];
  /** The field `parts` were built from. In deferred mode it lags `field`:
   *  the old picture stays up until the substrate admits the new one. */
  renderedField?: HydroTileField;
  binding?: HydroTileBinding;
  shoreRefinedCells: number;
  meshSegmentsX: number;
  meshSegmentsZ: number;
  coastalMesh: boolean;
  meshTriangles: number;
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
 *
 * ── AND THE CELLS ARE SPLIT BY REGIME ──
 *
 * Standing cells and flowing cells return as separate geometries, because
 * they take different material variants: the river shader samples the
 * structure field and carries the river-space machinery, and the open ocean
 * must pay for neither. A cell any of whose texels flow goes to the flowing
 * set — that variant still renders standing texels correctly (it keeps the
 * full shader; per-texel vFlowing selects), while the standing variant
 * cannot render flowing ones. The two sets are disjoint, so no fragment is
 * ever drawn by both.
 */
interface WaterGeometries {
  standing?: THREE.BufferGeometry;
  flowing?: THREE.BufferGeometry;
  /** Coastal cells only, locally subdivided for connected swash/run-up. */
  surf?: THREE.BufferGeometry;
  /** The corresponding body contains an inland shore and therefore compiles
   *  the continuous edge blend into that body rather than adding an overlay. */
  standingEdgeBlend: boolean;
  flowingEdgeBlend: boolean;
  /** Parent cells crossed by the canonical inland coverage contour and
   *  tessellated inside the same body. */
  shoreRefinedCells: number;
  segmentsX: number;
  segmentsZ: number;
}
function waterGeometry(field: HydroTileField, segments: number): WaterGeometries {
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
  // 0 dry, 1 standing water, 2 flowing water (any flowing texel claims the
  // cell — see the regime note above).
  const keep = new Uint8Array(segmentsX * segmentsZ);
  const fallKeep = new Uint8Array(segmentsX * segmentsZ);
  const shoreKeep = new Uint8Array(segmentsX * segmentsZ);
  // The surf strip is independent of the broad water cull: it is allowed into
  // the one-texel dry margin around waterBounds, but only where the propagated
  // body class is ocean/lagoon and signed distance says this is truly shore.
  const surfKeep = new Uint8Array(segmentsX * segmentsZ);
  let standingEdgeBlend = false;
  let flowingEdgeBlend = false;
  for (let j = 0; j < segmentsZ; j++) for (let i = 0; i < segmentsX; i++) {
    const x0 = rect.minX + (i / segmentsX) * rectSpanX;
    const x1 = rect.minX + ((i + 1) / segmentsX) * rectSpanX;
    const z0 = rect.minZ + (j / segmentsZ) * rectSpanZ;
    const z1 = rect.minZ + ((j + 1) / segmentsZ) * rectSpanZ;
    const ix0 = Math.max(0, Math.floor(fieldIx(x0)) - 1);
    const ix1 = Math.min(field.width - 1, Math.ceil(fieldIx(x1)) + 1);
    const iz0 = Math.max(0, Math.floor(fieldIz(z0)) - 1);
    const iz1 = Math.min(field.height - 1, Math.ceil(fieldIz(z1)) + 1);
    let regime = 0;
    let coastalShore = false;
    let inlandKind = false;
    let minCoverage = 1;
    let maxCoverage = 0;
    for (let iz = iz0; iz <= iz1; iz++) {
      for (let ix = ix0; ix <= ix1; ix++) {
        const t = iz * field.width + ix;
        const coverage = field.geometry[t * 4];
        const kind = field.material[t * 4];
        const signedShore = field.geometry[t * 4 + 1];
        minCoverage = Math.min(minCoverage, coverage);
        maxCoverage = Math.max(maxCoverage, coverage);
        if ((kind === 1 || kind === 2) && Math.abs(signedShore) <= 96) {
          coastalShore = true;
        }
        if (kind >= 3 && Math.abs(signedShore) <= 48) {
          inlandKind = true;
          if ((field.material[t * 4 + 3] & HydroFlags.Flowing) !== 0) {
            flowingEdgeBlend = true;
          } else {
            standingEdgeBlend = true;
          }
        }
        if (coverage <= 0.005) continue;
        if (field.waterfalls && (field.waterfalls[t * 4] > 0.01 || field.waterfalls[t * 4 + 2] > 0.05))
          fallKeep[j * segmentsX + i] = 1;
        regime = (field.material[t * 4 + 3] & HydroFlags.Flowing) !== 0 ? 2
          : Math.max(regime, 1);
      }
    }
    const cell = j * segmentsX + i;
    keep[cell] = regime;
    surfKeep[cell] = coastalShore ? 1 : 0;
    shoreKeep[cell] = inlandKind && minCoverage < .62 && maxCoverage > .38 ? 1 : 0;
  }
  const build = (regime: number): THREE.BufferGeometry | undefined => {
    const pos: number[] = [], uvs: number[] = [], idx: number[] = [];
    // Only connected drops and their landing regions need the fine grid.
    // Coarse neighbours stitch to fine edges, so this saving creates no
    // T-junctions whose displaced midpoint could open a crack.
    const subdivision = Math.min(8, Math.max(1, Math.ceil(Math.max(
      rectSpanX / segmentsX / (spanX / (field.resolution - 1)),
      rectSpanZ / segmentsZ / (spanZ / (field.resolution - 1)),
    ))));
    const fineX = segmentsX * subdivision, fineZ = segmentsZ * subdivision;
    const vert = new Map<string, number>();
    const at = (i: number, j: number): number => {
      const k = i + ':' + j;
      let v = vert.get(k);
      if (v === undefined) {
        v = pos.length / 3;
        pos.push(i / fineX - 0.5, 0, j / fineZ - 0.5);
        uvs.push(i / fineX, 1 - j / fineZ);
        vert.set(k, v);
      }
      return v;
    };
    for (let j = 0; j < segmentsZ; j++) for (let i = 0; i < segmentsX; i++) {
      if (keep[j * segmentsX + i] !== regime) continue;
      const x = i * subdivision, z = j * subdivision;
      const fine = (a: number, b: number): boolean =>
        a >= 0 && b >= 0 && a < segmentsX && b < segmentsZ
        && keep[b * segmentsX + a] === regime
        && (shoreKeep[b * segmentsX + a] !== 0
          || regime === 2 && fallKeep[b * segmentsX + a] !== 0);
      if (fine(i, j)) {
        for (let dz = 0; dz < subdivision; dz++) for (let dx = 0; dx < subdivision; dx++) {
          const a = at(x + dx, z + dz), b = at(x + dx + 1, z + dz);
          const c = at(x + dx, z + dz + 1), d = at(x + dx + 1, z + dz + 1);
          idx.push(a, c, b, b, c, d);
        }
      } else if (subdivision > 1 && (fine(i - 1, j) || fine(i + 1, j) || fine(i, j - 1) || fine(i, j + 1))) {
        const rim: number[] = [];
        const edge = (ax: number, az: number, bx: number, bz: number, split: boolean): void => {
          const n = split ? subdivision : 1;
          for (let k = 0; k < n; k++) rim.push(at(ax + (bx - ax) * k / n, az + (bz - az) * k / n));
        };
        edge(x, z, x, z + subdivision, fine(i - 1, j));
        edge(x, z + subdivision, x + subdivision, z + subdivision, fine(i, j + 1));
        edge(x + subdivision, z + subdivision, x + subdivision, z, fine(i + 1, j));
        edge(x + subdivision, z, x, z, fine(i, j - 1));
        const centre = at(x + subdivision / 2, z + subdivision / 2);
        for (let k = 0; k < rim.length; k++) idx.push(centre, rim[k], rim[(k + 1) % rim.length]);
      } else {
        const a = at(x, z), b = at(x + subdivision, z), c = at(x, z + subdivision), d = at(x + subdivision, z + subdivision);
        idx.push(a, c, b, b, c, d);
      }
    }
    if (!idx.length) return undefined;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(idx);
    geo.computeBoundingSphere();
    return geo;
  };
  // A production coastal cell is about 75m wide. Eight local subdivisions
  // bring only the swash cells down to about 9m without tessellating the open
  // ocean. Vertices are shared across neighbouring parent cells.
  const buildSurf = (): THREE.BufferGeometry | undefined => {
    const subdivision = 8;
    const fineX = segmentsX * subdivision;
    const fineZ = segmentsZ * subdivision;
    const pos: number[] = [], uvs: number[] = [], idx: number[] = [];
    const vert = new Map<number, number>();
    const at = (i: number, j: number): number => {
      const k = j * (fineX + 1) + i;
      let v = vert.get(k);
      if (v === undefined) {
        v = pos.length / 3;
        pos.push(i / fineX - 0.5, 0, j / fineZ - 0.5);
        uvs.push(i / fineX, 1 - j / fineZ);
        vert.set(k, v);
      }
      return v;
    };
    for (let j = 0; j < segmentsZ; j++) for (let i = 0; i < segmentsX; i++) {
      if (!surfKeep[j * segmentsX + i]) continue;
      const x0 = i * subdivision, z0 = j * subdivision;
      for (let sj = 0; sj < subdivision; sj++) for (let si = 0; si < subdivision; si++) {
        const x = x0 + si, z = z0 + sj;
        const a = at(x, z), b = at(x + 1, z);
        const c = at(x, z + 1), d = at(x + 1, z + 1);
        idx.push(a, c, b, b, c, d);
      }
    }
    if (!idx.length) return undefined;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(idx);
    geo.computeBoundingSphere();
    return geo;
  };
  return {
    standing: build(1),
    flowing: build(2),
    surf: buildSurf(),
    standingEdgeBlend,
    flowingEdgeBlend,
    shoreRefinedCells: shoreKeep.reduce((sum, refined) => sum + refined, 0),
    segmentsX,
    segmentsZ,
  };
}

function hasCoastalWater(field: HydroTileField): boolean {
  for (let i = 0; i < field.width * field.height; i++) {
    if (field.geometry[i * 4] <= 0.005) continue;
    const kind = field.material[i * 4];
    if (kind === 1 || kind === 2) return true;
  }
  return false;
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

export { sampleFieldSurface } from './field-sample';

class DefaultHydroSystem implements HydroSystem {
  readonly object3d = new THREE.Group();
  private bankRev = 0;
  get bankRevision(): number { return this.bankRev; }
  /** The last tile answered, because the sward asks texel after texel. */
  private fieldAtLast: TileRecord | null = null;
  fieldAt(x: number, z: number): HydroTileField | undefined {
    const inside = (r: TileRecord): boolean => {
      const b = r.input.bounds;
      return x >= b.minX && x < b.maxX && z >= b.minZ && z < b.maxZ;
    };
    const last = this.fieldAtLast;
    if (last && last.field && inside(last) && this.records.get(last.input.key) === last) return last.field;
    for (const r of this.records.values()) {
      if (r.field && inside(r)) { this.fieldAtLast = r; return r.field; }
    }
    return undefined;
  }
  private readonly records = new Map<TileKey, TileRecord>();
  private readonly registry: HydroBodyRegistry;
  private readonly frameUniforms: HydroFrameUniforms = createHydroFrameUniforms();
  private readonly buildOptions: HydroBuildOptions;
  private readonly meshSegments: number;
  private readonly coastalMeshMultiplier: number;
  private readonly flowingFieldResolution: number;
  private readonly scheduleBuild: (job: () => HydroTileField) => Promise<HydroTileField>;
  private readonly sceneShade: SceneShade | undefined;
  private readonly deferRendering: boolean;
  private readonly rebuildsPerFrame: number;
  private disposed = false;
  private tuning: HydroTuning = { ...DEFAULT_HYDRO_TUNING };
  private rigTrail: Array<{
    x: number;
    z: number;
    born: number;
    strength: number;
  }> = [];
  private wasWading = false;

  constructor(options: HydroSystemOptions = {}) {
    this.buildOptions = {
      fieldResolution: options.fieldResolution ?? DEFAULT_HYDRO_BUILD.fieldResolution,
      gutter: options.gutter ?? DEFAULT_HYDRO_BUILD.gutter,
      oceanLevelM: options.oceanLevelM ?? DEFAULT_HYDRO_BUILD.oceanLevelM,
      shoreDistanceLimitM: options.shoreDistanceLimitM ?? DEFAULT_HYDRO_BUILD.shoreDistanceLimitM,
      minimumDepthM: options.minimumDepthM ?? DEFAULT_HYDRO_BUILD.minimumDepthM,
      coastField: options.coastField ?? DEFAULT_HYDRO_BUILD.coastField,
      dryShortCircuit: options.dryShortCircuit ?? DEFAULT_HYDRO_BUILD.dryShortCircuit,
    };
    this.registry = new HydroBodyRegistry(this.buildOptions.oceanLevelM);
    this.scheduleBuild = options.scheduleBuild ?? immediateBuild;
    this.sceneShade = options.sceneShade;
    this.deferRendering = options.deferRendering ?? false;
    this.rebuildsPerFrame = Math.max(1, Math.floor(options.rebuildsPerFrame ?? 1));
    this.meshSegments = Math.max(4, Math.floor(options.meshResolution ?? 32));
    this.coastalMeshMultiplier = clamp(
      Math.floor(options.coastalMeshMultiplier ?? 3),
      1,
      4,
    );
    this.flowingFieldResolution = Math.max(
      this.buildOptions.fieldResolution,
      Math.floor(options.flowingFieldResolution ?? this.buildOptions.fieldResolution),
    );
    this.object3d.name = 'hydro-system';
  }

  /**
   * The share of the tile a river/stream/canal covers at which it counts as
   * "the water IS the tile" and earns the full `flowingFieldResolution`
   * tier — a wide river crossing corner to corner, not a thread clipping one.
   * Below it the tier ramps linearly from the base resolution, so a tile
   * whose flowing water is a sliver (Yosemite: ~0.4% of the grid) pays close
   * to nothing extra, while one nearer this share pays close to the full
   * fourfold grid it would have paid unconditionally before.
   */
  private static readonly FLOWING_FULL_SHARE = 0.15;

  private resolveFieldResolution(wetShareEstimate: number): number {
    const base = this.buildOptions.fieldResolution;
    if (!(wetShareEstimate > 0)) return base;
    const t = clamp(wetShareEstimate / DefaultHydroSystem.FLOWING_FULL_SHARE, 0, 1);
    return Math.round(base + (this.flowingFieldResolution - base) * t);
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
        chain: Promise.resolve(), parts: [], shoreRefinedCells: 0,
        meshSegmentsX: 0, meshSegmentsZ: 0, coastalMesh: false, meshTriangles: 0,
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
    const views: HydroDebugView[] = ['surface', 'coverage', 'shore', 'depth', 'flow', 'class', 'coast'];
    this.frameUniforms.uDebugView.value = Math.max(0, views.indexOf(view));
  }

  setTuning(patch: Partial<HydroTuning>): void {
    const finite = (value: number | undefined, fallback: number): number =>
      value === undefined || !Number.isFinite(value) ? fallback : clamp(value, 0, 8);
    this.tuning = {
      waveAmplitude: finite(patch.waveAmplitude, this.tuning.waveAmplitude),
      waveLength: finite(patch.waveLength, this.tuning.waveLength),
      waveChop: finite(patch.waveChop, this.tuning.waveChop),
      rippleStrength: finite(patch.rippleStrength, this.tuning.rippleStrength),
      foamStrength: finite(patch.foamStrength, this.tuning.foamStrength),
      shoreFade: finite(patch.shoreFade, this.tuning.shoreFade),
      shallowBedStrength: finite(patch.shallowBedStrength, this.tuning.shallowBedStrength),
      riverEdgeStrength: finite(patch.riverEdgeStrength, this.tuning.riverEdgeStrength),
      turbulenceStrength: finite(patch.turbulenceStrength, this.tuning.turbulenceStrength),
      eddyStrength: finite(patch.eddyStrength, this.tuning.eddyStrength),
      absorptionStrength: finite(patch.absorptionStrength, this.tuning.absorptionStrength),
      scatteringStrength: finite(patch.scatteringStrength, this.tuning.scatteringStrength),
      surfaceRoughness: finite(patch.surfaceRoughness, this.tuning.surfaceRoughness),
      lookModel: finite(patch.lookModel, this.tuning.lookModel),
    };
    this.frameUniforms.uWaveAmplitude.value = this.tuning.waveAmplitude;
    this.frameUniforms.uWaveLength.value = this.tuning.waveLength;
    this.frameUniforms.uWaveChop.value = this.tuning.waveChop;
    this.frameUniforms.uRippleStrength.value = this.tuning.rippleStrength;
    this.frameUniforms.uFoamStrength.value = this.tuning.foamStrength;
    this.frameUniforms.uShoreFade.value = this.tuning.shoreFade;
    this.frameUniforms.uShallowBedStrength.value = this.tuning.shallowBedStrength;
    this.frameUniforms.uRiverEdgeStrength.value = this.tuning.riverEdgeStrength;
    this.frameUniforms.uTurbulenceStrength.value = this.tuning.turbulenceStrength;
    this.frameUniforms.uEddyStrength.value = this.tuning.eddyStrength;
    this.frameUniforms.uAbsorptionStrength.value = this.tuning.absorptionStrength;
    this.frameUniforms.uScatteringStrength.value = this.tuning.scatteringStrength;
    this.frameUniforms.uSurfaceRoughness.value = this.tuning.surfaceRoughness;
    this.frameUniforms.uLookModel.value = this.tuning.lookModel;
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
    this.updateRigTrail(frame.timeSeconds, rig);
    const tf = frame.terrainField;
    this.frameUniforms.uSwardCol.value = tf?.texture ? (tf.texture as THREE.Texture) : null;
    this.frameUniforms.uSwardOrg.value.set(tf?.originX ?? 0, tf?.originZ ?? 0);
    this.frameUniforms.uSwardW.value = tf?.texture ? Math.max(0, tf.widthM) : 0;
    if (frame.sunDirection) {
      this.frameUniforms.uSunDirection.value
        .set(frame.sunDirection.x, frame.sunDirection.y, frame.sunDirection.z)
        .normalize();
    }
    if (frame.skyColour) {
      this.frameUniforms.uSkyColour.value.setRGB(
        frame.skyColour.r, frame.skyColour.g, frame.skyColour.b,
      );
    }
    if (frame.sceneLight) {
      this.frameUniforms.uSceneLight.value.set(frame.sceneLight.r, frame.sceneLight.g, frame.sceneLight.b);
    }
    if (frame.groundGain) {
      this.frameUniforms.uGroundGain.value.set(frame.groundGain.r, frame.groundGain.g, frame.groundGain.b);
    }
    if (frame.zenithColour) {
      this.frameUniforms.uZenith.value.setRGB(frame.zenithColour.r, frame.zenithColour.g, frame.zenithColour.b);
    }
    if (frame.moon) {
      this.frameUniforms.uMoonDirection.value.set(frame.moon.x, frame.moon.y, frame.moon.z).normalize();
      this.frameUniforms.uMoonColour.value.set(frame.moon.r, frame.moon.g, frame.moon.b);
    }
    if (frame.terrainColour) {
      this.frameUniforms.uTerrainColour.value.setRGB(
        frame.terrainColour.r, frame.terrainColour.g, frame.terrainColour.b,
      );
    }

    let admitted = 0;
    for (const [key, record] of this.records) {
      // THE SAME RECT THE MESH WAS SCALED TO. It spans the water, not the
      // tile, and re-placing it on the tile's centre every frame would undo
      // that — a mesh the size of the river sitting in the middle of the tile.
      for (const part of record.parts) {
        this.placeMesh(part.mesh, record.field?.waterBounds ?? record.input.bounds, frame.worldOrigin);
      }
      if (record.dirty && !record.building && admitted < this.rebuildsPerFrame) {
        admitted++;
        void this.queueBuild(key);
      }
    }
  }

  /**
   * Eight points are enough to leave roughly 20–35m of broken wake without
   * introducing a render target or a simulation texture. The newest live
   * vehicle position is uploaded separately from the retained samples, so
   * the first segment follows the truck continuously while older points keep
   * ageing after it leaves the water.
   */
  private updateRigTrail(
    time: number,
    rig: HydroFrame['rig'],
  ): void {
    const wading = !!rig && (rig.wakeStrength ?? rig.wadeM) > 0.02;
    this.rigTrail = this.rigTrail.filter((p) => time - p.born < 14);

    if (wading && rig) {
      const speed = Math.hypot(rig.vx, rig.vz);
      const strength = clamp(
        rig.wakeStrength
          ?? clamp(rig.wadeM / 0.55, 0, 1) * clamp(0.38 + speed * 0.09, 0.38, 1),
        0,
        1,
      );
      const latest = this.rigTrail[0];
      const gap = latest ? Math.hypot(rig.x - latest.x, rig.z - latest.z) : Infinity;

      // A fresh ford far from the previous one must not draw a segment across
      // dry land. The old trail is discarded only in that discontinuous case.
      if (!this.wasWading && latest && gap > 18) this.rigTrail = [];
      if (!this.rigTrail.length || gap >= 3.2) {
        this.rigTrail.unshift({ x: rig.x, z: rig.z, born: time, strength });
      }
    } else if (this.wasWading && rig) {
      // Freeze the exit point into history. It remains visible while the
      // vehicle climbs the bank instead of snapping away with uRigWade.
      this.rigTrail.unshift({
        x: rig.x,
        z: rig.z,
        born: time,
        strength: this.rigTrail[0]?.strength ?? 0.45,
      });
    }
    this.wasWading = wading;
    this.rigTrail.length = Math.min(this.rigTrail.length, wading ? 7 : 8);

    const upload = this.frameUniforms.uRigTrail.value;
    let count = 0;
    if (wading && rig) {
      const speed = Math.hypot(rig.vx, rig.vz);
      upload[count++].set(
        rig.x, rig.z, 0,
        clamp(
          rig.wakeStrength
            ?? clamp(rig.wadeM / 0.55, 0, 1) * clamp(0.38 + speed * 0.09, 0.38, 1),
          0,
          1,
        ),
      );
    }
    for (const point of this.rigTrail) {
      if (count >= upload.length) break;
      upload[count++].set(point.x, point.z, Math.max(0, time - point.born), point.strength);
    }
    for (let i = count; i < upload.length; i++) upload[i].set(0, 0, 99, 0);
    this.frameUniforms.uRigTrailCount.value = count;
  }

  getTileBinding(key: TileKey): HydroTileBinding | undefined {
    return this.records.get(key)?.binding;
  }

  /** WHAT WATER IS HERE, AND WHY: the tile's features as they were handed
   *  in, what the analysis makes of each (`seaTouching`), the coverage's
   *  state, and the bodies the field was painted from with the kind the
   *  registry settled on — because "why is this water a lake" took a
   *  screenshot, a probe and a guess before this answered it in one call. */
  debugTile(key: TileKey): object | null {
    const record = this.records.get(key);
    if (!record) return null;
    const input = record.input;
    return {
      key, revision: input.revision, oceanCoverage: input.oceanCoverage.status,
      features: input.features.map((f) => ({
        id: f.id, kind: f.kind, geometry: f.geometry.type,
        seaTouching: seaTouching(input, f),
        ...seaTouchingStats(input, f),
      })),
      bodies: (record.field?.bodyIds ?? []).map((id) => {
        const body = this.registry.get(id);
        return { id, kind: body?.kind ?? null, level: body?.level.type ?? null };
      }),
    };
  }

  canRenderField(field: HydroTileField): boolean {
    if (this.disposed) return false;
    const record = this.records.get(field.key);
    return !!record && record.field === field && record.input.revision === field.revision;
  }

  renderField(field: HydroTileField): boolean {
    if (!this.canRenderField(field)) return false;
    const record = this.records.get(field.key)!;
    // Identity matters as well as revision. A substrate tile must commit the
    // immutable field it captured, not an equal-looking field reconstructed
    // after the renderer's record advanced. And "already rendered" is asked
    // of the FIELD, not of the parts: in deferred mode the parts on screen
    // may be the previous field's, kept up until this admission swaps them.
    if (record.renderedField === field) return true;
    this.installRender(record, field);
    return true;
  }

  unrenderTile(key: TileKey): void {
    const record = this.records.get(key);
    if (record) this.releaseRender(record);
  }

  sampleRestingSurface(x: number, z: number, coverageCut = 0.5): HydroSample | undefined {
    // Active rings are small. If this grows, index records by the world tile
    // key already known to the caller rather than introducing another grid.
    for (const record of this.records.values()) {
      const field = record.field;
      if (!field || x < field.bounds.minX || x > field.bounds.maxX
        || z < field.bounds.minZ || z > field.bounds.maxZ) continue;
      return sampleFieldSurface(field, x, z, coverageCut);
    }
    return undefined;
  }

  /**
   * WHY THE WATER IS WHERE IT IS. `sampleRestingSurface` answers what the
   * field holds; this answers who put it there — the body, its kind, and
   * whether its level is one flat number for the whole footprint, a river
   * profile, or the ocean datum. A surface standing over the valley floor
   * is nearly always a `flat` body on sloping ground, and that is only
   * visible from here.
   */
  debugAt(x: number, z: number): Record<string, unknown> | null {
    for (const [key, record] of this.records) {
      const field = record.field;
      if (!field || x < field.bounds.minX || x > field.bounds.maxX
        || z < field.bounds.minZ || z > field.bounds.maxZ) continue;
      const u = (x - field.bounds.minX) / Math.max(Number.EPSILON, field.bounds.maxX - field.bounds.minX);
      const v = (z - field.bounds.minZ) / Math.max(Number.EPSILON, field.bounds.maxZ - field.bounds.minZ);
      const ix = clamp(Math.round(field.gutter + u * (field.resolution - 1)), 0, field.width - 1);
      const iz = clamp(Math.round(field.gutter + v * (field.resolution - 1)), 0, field.height - 1);
      const i = iz * field.width + ix;
      const bodies = this.registry.bodiesForTile(key).map((b) => ({
        id: b.id, kind: b.kind, level: b.level.type,
        bedMaterial: b.bedMaterial,
        bankMaterial: b.bankMaterial,
        elevationM: b.level.type === 'profile' ? null : +b.level.elevationM.toFixed(2),
        stations: b.level.type === 'profile' ? b.level.stations.length / 3 : 0,
        flow: [+b.flow[0].toFixed(2), +b.flow[1].toFixed(2)],
      }));
      const obs = record.analysis.observations.map((o) => ({
        id: o.id, kind: o.kind,
        bedMaterial: o.bedMaterial ?? null,
        bankMaterial: o.bankMaterial ?? null,
        cand: o.candidateLevelM === undefined ? null : +o.candidateLevelM.toFixed(2),
        tagged: o.taggedLevelM === undefined ? null : +o.taggedLevelM.toFixed(2),
        stations: o.profile ? o.profile.length / 3 : 0,
      }));
      // The raster the build levelled against, at this very point — the one
      // number that separates "the profile smoothed it" from "the field's
      // ground and the drawn ground disagree here".
      const rb = sampleElevation(record.input.elevation, record.input.bounds, x, z);
      return {
        key,
        rasterBedM: Number.isFinite(rb) ? +rb.toFixed(2) : null,
        coverage: +field.geometry[i * 4].toFixed(2),
        kind: HYDRO_ID_KIND[field.material[i * 4]] ?? null,
        restingLevelM: +(field.elevationBaseM + field.geometry[i * 4 + 2]).toFixed(2),
        fieldDepthM: +field.geometry[i * 4 + 3].toFixed(2),
        elevationBaseM: +field.elevationBaseM.toFixed(2),
        bodies, obs,
      };
    }
    return null;
  }

  stats(): HydroStats {
    let visibleTiles = 0, pendingBuilds = 0, dirtyTiles = 0;
    for (const record of this.records.values()) {
      if (record.parts.length) visibleTiles++;
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
      const shore = field ? extractHydroShoreSegments(field) : [];
      let shoreGroundMin = Infinity;
      let shoreGroundMax = -Infinity;
      for (const segment of shore) {
        shoreGroundMin = Math.min(
          shoreGroundMin,
          segment.a.groundM,
          segment.b.groundM,
        );
        shoreGroundMax = Math.max(
          shoreGroundMax,
          segment.a.groundM,
          segment.b.groundM,
        );
      }
      out.push({
        key, feats: record.input.features.length,
        kinds: record.input.features.map((f) => f.kind),
        ocean: record.input.oceanCoverage.status,
        built: !!field, hasWater: field?.hasWater ?? null,
        resolution: field?.resolution ?? null,
        gutter: field?.gutter ?? null,
        touched, wet, maxCov: +max.toFixed(3),
        shoreSegments: shore.length,
        shoreGroundSpanM: shore.length
          ? +(shoreGroundMax - shoreGroundMin).toFixed(3)
          : null,
        shoreRefinedCells: record.shoreRefinedCells,
        meshSegments: [record.meshSegmentsX, record.meshSegmentsZ],
        coastalMesh: record.coastalMesh,
        meshTriangles: record.meshTriangles,
        mesh: record.parts.length > 0,
        renderDeferred: this.deferRendering,
        flowingMesh: record.parts.some((p) => p.mesh.name.includes(':flowing')),
        surfMesh: record.parts.some((p) => p.mesh.name.endsWith(':surf')),
        edgeBlendMesh: record.parts.some((p) => p.mesh.name.endsWith(':edge-blend')),
        dirty: record.dirty, building: record.building,
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
        // Sized from the covered SHARE, not from "any flowing observation" —
        // see resolveFieldResolution's own comment for why.
        const wetShare = estimateFlowingCoverageShare(live.input);
        const fieldResolution = this.resolveFieldResolution(wetShare);
        // Preserve the gutter's metre reach when flowing texels shrink.
        const gutter = Math.max(
          this.buildOptions.gutter,
          Math.ceil(this.buildOptions.gutter
            * fieldResolution / this.buildOptions.fieldResolution),
        );
        const field = await this.scheduleBuild(() => buildHydroTile(
          live.input,
          this.registry,
          live.analysis,
          { ...this.buildOptions, fieldResolution, gutter },
          previous,
        ));
        const current = this.records.get(key);
        if (!current || current.generation !== generation || this.disposed) return;
        this.installField(current, field);
        // A late centreline can join two components whose fields were already
        // visible. Rebuild every rebased body except the tile just generated
        // from the final chart; this turns the former permanent seam into one
        // bounded topology correction.
        // Do not exempt the completing tile: builds may resolve asynchronously,
        // so another tile could consume a rebase that happened after this
        // field's snapshot. An empty second pass is cheaper than a stale seam.
        this.markBodiesDirty(this.registry.consumeRiverSpanChanges());
      } finally {
        const current = this.records.get(key);
        if (current) current.building = false;
      }
    });
    return record.chain;
  }

  private installField(record: TileRecord, field: HydroTileField): void {
    record.field = field;
    this.bankRev++;
    // Immediate mode swaps the picture here (installRender releases the old
    // parts first). Deferred mode keeps the OLD parts up: the substrate
    // admits the new field with the rest of its tile and `renderField` swaps
    // then. Releasing here is what made every hydro re-feed in render mode
    // take the water off the map until the tile was re-admitted.
    if (!this.deferRendering) this.installRender(record, field);
  }

  private installRender(record: TileRecord, field: HydroTileField): void {
    this.releaseRender(record);
    // Rendered even when it comes to no mesh: "no water" is this field's
    // picture, and a second admission of it must not rebuild the cull.
    record.renderedField = field;
    if (!field.hasWater) return;
    // The cull first: a tile can report water and still keep no cell, when the
    // coverage is a sliver the lattice cannot resolve. Building the textures
    // before finding that out would leak the float RGBA uploads per tile.
    const coastalMesh = hasCoastalWater(field);
    const geometrySegments = Math.min(
      128,
      this.meshSegments * (coastalMesh ? this.coastalMeshMultiplier : 1),
    );
    const geometries = waterGeometry(field, geometrySegments);
    record.shoreRefinedCells = geometries.shoreRefinedCells;
    record.meshSegmentsX = geometries.segmentsX;
    record.meshSegmentsZ = geometries.segmentsZ;
    record.coastalMesh = coastalMesh;
    if (!geometries.standing && !geometries.flowing && !geometries.surf) return;
    const textures = createHydroTextures(field);
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
    const origin = this.frameUniforms.uWorldOrigin.value;
    const install = (
      geometry: THREE.BufferGeometry,
      flowing: boolean,
      surf = false,
      edgeBlend = false,
    ): void => {
      const material = createHydroMaterial(
        field, textures, this.frameUniforms, flowing, surf, this.sceneShade, edgeBlend,
      );
      const mesh = new THREE.Mesh(geometry, material);
      mesh.scale.set(spanX, 1, spanZ);
      mesh.position.set(
        (rect.minX + rect.maxX) * 0.5 - origin.x,
        0,
        (rect.minZ + rect.maxZ) * 0.5 - origin.z,
      );
      // GPU displacement changes y beyond the CPU geometry bounds. The
      // streamed ring is already the culling structure, so do not let a flat
      // unit plane incorrectly cull a mountain lake.
      mesh.frustumCulled = false;
      mesh.renderOrder = surf ? 3 : 2;
      mesh.name = `hydro-tile:${field.key}${flowing ? ':flowing' : ''}${surf ? ':surf' : ''}${edgeBlend ? ':edge-blend' : ''}`;
      this.object3d.add(mesh);
      record.parts.push({ mesh, geometry, material });
    };
    if (geometries.standing) {
      install(geometries.standing, false, false, geometries.standingEdgeBlend);
    }
    if (geometries.flowing) {
      install(geometries.flowing, true, false, geometries.flowingEdgeBlend);
    }
    if (geometries.surf) install(geometries.surf, false, true);
    record.meshTriangles = record.parts.reduce((sum, part) =>
      sum + ((part.geometry.index?.count ?? 0) / 3), 0);
    const base = hydroBinding(field, textures);
    record.textures = textures;
    record.binding = {
      ...base,
      bounds: field.bounds,
      worldToHydroUv: worldToUv(field),
    };
  }

  private releaseGpu(record: TileRecord): void {
    this.releaseRender(record);
    record.field = undefined;
  }

  private releaseRender(record: TileRecord): void {
    // Per-tile now, so it is per-tile to dispose — the shared grid never was.
    for (const part of record.parts) {
      part.mesh.removeFromParent();
      part.geometry.dispose();
      part.material.dispose();
    }
    record.parts = [];
    record.renderedField = undefined;
    record.shoreRefinedCells = 0;
    record.meshSegmentsX = 0;
    record.meshSegmentsZ = 0;
    record.coastalMesh = false;
    record.meshTriangles = 0;
    if (record.textures) disposeHydroTextures(record.textures);
    record.textures = undefined;
    record.binding = undefined;
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
