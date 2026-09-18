/**
 * THE TERRAIN WORKER. The kernel (terrain-kernel.ts) is one closure whose
 * source is embedded here as text, the way the road profile worker is built,
 * so the cell stays one bundle. The worker keeps a MIRROR of what does not
 * change once it exists — the height rasters, the cover rasters — and takes
 * everything that does with each job: the strips and channels near the
 * tile, the area patches, the landmark pads, a climate raster, the palette
 * state. Border rows live in the worker (the kernel writes them); the main
 * thread keeps a copy from each reply for its probes and for dirtying the
 * followers the reply names.
 *
 * A job is self-contained on purpose. Mirroring the strips would mean
 * shadowing every mutation a road makes to its segments after they are
 * rasterised; shipping the few hundred near the tile costs tens of
 * kilobytes and cannot go stale.
 */
import { buildSubstrateCells, SUB_FIELD_N } from './substrate-field';
import { createTerrainKernel, type HeightTile, type CoverTile, type StripLike, type Rgb, type AreaPatchLike, type TerrainCrossingMask, type TerrainStore, type CarveLog, type BreakLine } from './terrain-kernel';

export interface TerrainJob {
  id: number; epoch: number; key: string;
  tile: HeightTile;
  seg: number; corridor: boolean; refine: boolean;
  /** Side of the hydro elevation raster wanted with the reply, 0 for none. */
  hydroN: number;
  /** Only the hydro raster: no build, no mesh — a refeed with no build behind it. */
  hydroOnly?: boolean;
  baseElev: number; seaAbs: number; seaOn: boolean; dryAt: boolean;
  nrmCoarsePx: number; nrmRes: number;
  cutWash: number; cprobe: boolean; cutRelief: boolean;
  cutL: number; grid: number; water: number; built: number; waterTilt: number; coverPx: number;
  origin: { lat: number; lon: number; mLon: number };
  strips: Float64Array; stripCells: Array<[string, number[]]>;
  channels: Float64Array; chanCells: Array<[string, number[]]>;
  hydroBreakLines: Float64Array;
  /** The field's bed lattice (see TerrainStore.hydroFloor); empty with n 0 when the tile has no field. */
  hydroFloor: Float32Array; hydroFloorN: number;
  crossings: TerrainCrossingMask[];
  areas: AreaPatchLike[];
  pads: Float64Array;
  clim: Float32Array; climN: number; climK: number;
  ramp: Array<[number, Rgb]>; ramps: Array<Array<[number, Rgb]>>; coverTint: Record<number, Rgb>; coverMix: number;
}
export interface TerrainReply {
  id: number; key: string; epoch: number; error?: string; hydroOnly?: boolean;
  pos: Float32Array; uv: Float32Array; idx: Uint32Array; colors: Float32Array; normals: Float32Array;
  /** Per vertex [rough, grain, slope, coverClass] for the substrate renderer
   *  and the ground views — see the kernel's TileBuild.mats. */
  mats: Float32Array;
  /** The tile's geomorphic substrate field — see the kernel's TileBuild.sub.
   *  Two RGBA byte lattices, retained on the main thread for the sward and
   *  uploaded as the terrain material's own pair of textures. */
  subA: Uint8Array;
  subB: Uint8Array;
  kinds: Uint8Array | null; cellOffs: Int32Array; cellTris: Int32Array;
  border: Float64Array; normalMap: Uint8Array; refined: boolean; corridor: boolean;
  hydroElev: Float32Array | null;
  followers: string[]; workerMs: number;
  carveLog: CarveLog | null;
  refineCost: Record<string, number>; plainCost: Record<string, number | string>; carveCost: Record<string, number>;
}
export interface TerrainWorkerStats { jobs: number; failures: number; workerMs: number; lastWorkerMs: number; waitMs: number; mirrored: number }

/** The worker's whole program, as a function so its source can be embedded.
 *  Self-contained: nothing from this module's scope. */
function terrainWorkerMain(K: ReturnType<typeof createTerrainKernel>): void {
  const heights = new Map<string, HeightTile>();
  const cover = new Map<string, CoverTile>();
  const borders = new Map<string, Float64Array>();
  const carveLog = new Map<string, CarveLog>();
  const unflat = (a: Float64Array, cells: Array<[string, number[]]>): Map<string, StripLike[]> => {
    const n = a.length / 14, objs: StripLike[] = [];
    for (let i = 0; i < n; i++) {
      const o = i * 14;
      const u = (v: number): number | undefined => Number.isNaN(v) ? undefined : v;
      objs.push({ ax: a[o], az: a[o + 1], bx: a[o + 2], bz: a[o + 3], hw: a[o + 4], ya: u(a[o + 5]), yb: u(a[o + 6]),
        tk: a[o + 7] > 0.5, tn: a[o + 8] > 0.5, ca: u(a[o + 9]), cb: u(a[o + 10]), pc: u(a[o + 11]), pp: u(a[o + 12]),
        cv: u(a[o + 13]) });
    }
    const map = new Map<string, StripLike[]>();
    for (const [key, ids] of cells) map.set(key, ids.map((i) => objs[i]));
    return map;
  };
  self.onmessage = (event: MessageEvent): void => {
    const msg = event.data as { type: string } & Record<string, unknown>;
    if (msg.type === 'height') { heights.set(msg.key as string, msg.tile as HeightTile); return; }
    if (msg.type === 'cover') { cover.set(msg.key as string, msg.tile as CoverTile); return; }
    if (msg.type === 'reset') { heights.clear(); cover.clear(); borders.clear(); carveLog.clear(); return; }
    if (msg.type !== 'build') return;
    const job = msg as unknown as TerrainJob;
    const t0 = performance.now();
    try {
      // The tile itself always arrives with the job — its raster may be newer
      // than the mirror's copy, or the mirror may not have it yet.
      heights.set(job.key, job.tile);
      const sampler = K.makeSampler({ heights, cover, origin: job.origin, baseElev: job.baseElev, pads: job.pads, waterTilt: job.waterTilt, coverPx: job.coverPx });
      const strips = unflat(job.strips, job.stripCells);
      const channels = unflat(job.channels, job.chanCells);
      const hydroBreakLines: BreakLine[] = [];
      for (let i = 0; i + 3 < job.hydroBreakLines.length; i += 4) {
        hydroBreakLines.push({
          ax: job.hydroBreakLines[i],
          az: job.hydroBreakLines[i + 1],
          bx: job.hydroBreakLines[i + 2],
          bz: job.hydroBreakLines[i + 3],
        });
      }
      const N = job.climN, KW = job.climK, t = job.tile;
      const climate = (x: number, z: number): ArrayLike<number> | null => {
        if (!N) return null;
        const fx = Math.min(N - 1 - 1e-9, Math.max(0, ((x - t.xs) / t.w) * (N - 1)));
        const fz = Math.min(N - 1 - 1e-9, Math.max(0, ((z - t.zs) / t.h) * (N - 1)));
        const i0 = Math.floor(fx), j0 = Math.floor(fz), a = fx - i0, b = fz - j0;
        const out = new Array<number>(KW);
        for (let k = 0; k < KW; k++) {
          const q = (i: number, j: number): number => job.clim[(j * N + i) * KW + k];
          out[k] = (q(i0, j0) * (1 - a) + q(i0 + 1, j0) * a) * (1 - b) + (q(i0, j0 + 1) * (1 - a) + q(i0 + 1, j0 + 1) * a) * b;
        }
        return out;
      };
      const palette = K.makePalette({ ramp: job.ramp, ramps: job.ramps, coverTint: job.coverTint, coverMix: job.coverMix, water: job.water, built: job.built,
        seaOn: job.seaOn, dryAt: job.dryAt, seaAbs: job.seaAbs, climate });
      const S: TerrainStore = {
        heights,
        hasHeight: sampler.hasHeight, sampleHeight: sampler.sampleHeight, sampleHeightRaw: sampler.sampleHeightRaw,
        sampleCover: sampler.sampleCover,
        coverPaint: (x, z) => sampler.coverPaint(x, z, job.water),
        coverWater: (x, z) => sampler.coverWater(x, z, job.water),
        crossingAt: (x, z) => K.crossingKindAt(job.crossings, x, z),
        cover: { water: job.water, built: job.built },
        seaAbs: () => job.seaAbs, baseElev: job.baseElev,
        strips, cutL: job.cutL, channels, grid: job.grid,
        hydroBreakLines: () => hydroBreakLines,
        hydroFloor: () => job.hydroFloorN > 0 ? { n: job.hydroFloorN, data: job.hydroFloor } : null,
        onRoad: (x, z) => K.onRoadOf(strips, job.cutL, x, z),
        palette, areaTint: (x, z) => K.areaTintOf(job.areas, x, z),
        borders, nrmCoarsePx: job.nrmCoarsePx, nrmRes: job.nrmRes, cutWash: job.cutWash, cprobe: job.cprobe, carveLog, cutRelief: job.cutRelief,
      };
      if (job.hydroOnly) {
        const hydroElev = K.hydroElevation(S, t, job.hydroN || 132);
        (self as unknown as { postMessage(m: unknown, t: Transferable[]): void }).postMessage({ id: job.id, key: job.key, epoch: job.epoch, hydroOnly: true, hydroElev, workerMs: performance.now() - t0 }, [hydroElev.buffer as unknown as Transferable]);
        return;
      }
      const b = K.buildTile(S, t, job.seg, job.corridor, job.refine);
      const normalMap = K.normalMapBytes(S, t);
      const hydroElev = job.hydroN > 0 ? K.hydroElevation(S, t, job.hydroN) : null;
      const border = borders.get(job.key) ?? new Float64Array(0);
      const followers: string[] = [];
      for (const [dx, dy] of [[1, 0], [0, 1]]) {
        const nk = `${t.tx + dx}/${t.ty + dy}`;
        if (borders.has(nk) && !K.borderShared(S, t, nk)) followers.push(nk);
      }
      const reply: TerrainReply = {
        id: job.id, key: job.key, epoch: job.epoch,
        pos: b.pos, uv: b.uv, idx: b.idx, colors: b.colors, normals: b.normals, mats: b.mats, kinds: b.kinds,
        subA: b.sub.a, subB: b.sub.b,
        cellOffs: b.cellTris.offs, cellTris: b.cellTris.tris, border, normalMap, refined: b.refined, corridor: b.corridor,
        hydroElev, followers, workerMs: performance.now() - t0, carveLog: carveLog.get(job.key) ?? null,
        refineCost: { ...K.refineCost }, plainCost: { ...K.plainCost }, carveCost: { ...K.carveCost },
      };
      const transfer = [b.pos.buffer, b.uv.buffer, b.idx.buffer, b.colors.buffer, b.normals.buffer, b.mats.buffer, b.sub.a.buffer, b.sub.b.buffer, b.cellTris.offs.buffer, b.cellTris.tris.buffer, normalMap.buffer] as unknown as Transferable[];
      if (b.kinds) transfer.push(b.kinds.buffer as unknown as Transferable);
      if (hydroElev) transfer.push(hydroElev.buffer as unknown as Transferable);
      (self as unknown as { postMessage(m: unknown, t: Transferable[]): void }).postMessage(reply, transfer);
    } catch (error) {
      (self as unknown as { postMessage(m: unknown): void }).postMessage({ id: job.id, key: job.key, epoch: job.epoch, error: String(error && (error as Error).stack || error) });
    }
  };
}
export function terrainWorkerSource(): string {
  // THE GEOMORPHIC BUILDER TRAVELS AS TEXT, not as a hand-copy. It is written
  // to close over nothing for exactly this line; `substrate-morph.test.mjs`
  // re-evaluates it with no scope and requires byte-identical output, which is
  // the check that fails instead of the worker throwing on its first job.
  return `'use strict';\n(${terrainWorkerMain.toString()})((${createTerrainKernel.toString()})(`
    + `${buildSubstrateCells.toString()}, ${SUB_FIELD_N}));`;
}
interface Pending { at: number; resolve: (r: TerrainReply) => void; reject: (e: Error) => void }
export class TerrainWorker {
  private worker: Worker | null = null;
  disabled = false;
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  readonly stats: TerrainWorkerStats = { jobs: 0, failures: 0, workerMs: 0, lastWorkerMs: 0, waitMs: 0, mirrored: 0 };
  private readonly mirrored = new Set<string>();

  get busy(): boolean { return this.pending.size > 0; }
  /** A height raster the worker will need. Sent once; a hop resets. */
  mirrorHeight(key: string, t: HeightTile): void {
    if (this.disabled || this.mirrored.has('h' + key)) return;
    try {
      const data = t.data.slice();
      this.ensureWorker().postMessage({ type: 'height', key, tile: { tx: t.tx, ty: t.ty, xs: t.xs, zs: t.zs, w: t.w, h: t.h, data } }, [data.buffer as unknown as Transferable]);
      this.mirrored.add('h' + key); this.stats.mirrored++;
    } catch { this.disabled = true; }
  }
  /**
   * A raster that has CHANGED since it was mirrored.
   *
   * The guard above exists so a tile is sent once rather than with every job,
   * and it is exactly right until something repairs a raster in place — a
   * bridge's deck taken out of the elevation (see noteBridgeSpan in main.ts).
   * Without this the worker keeps the first copy for ever: the wheels, the
   * water and the road solve read the repaired ground while the MESH is still
   * built from the ridge, which is the picture and the physics disagreeing
   * about the floor.
   */
  remirrorHeight(key: string, t: HeightTile): void {
    this.mirrored.delete('h' + key);
    this.mirrorHeight(key, t);
  }
  mirrorCover(key: string, t: CoverTile): void {
    if (this.disabled || this.mirrored.has('c' + key)) return;
    try {
      const data = t.data.slice();
      this.ensureWorker().postMessage({ type: 'cover', key, tile: { xs: t.xs, zs: t.zs, w: t.w, h: t.h, data } }, [data.buffer as unknown as Transferable]);
      this.mirrored.add('c' + key); this.stats.mirrored++;
    } catch { this.disabled = true; }
  }
  /** The authoring surface changes canonical cover bytes in place. As with a
   * repaired height tile, the worker's first mirrored copy must be retired
   * before the new authority is sent. */
  remirrorCover(key: string, t: CoverTile): void {
    this.mirrored.delete('c' + key);
    this.mirrorCover(key, t);
  }
  reset(): void {
    this.mirrored.clear();
    if (this.worker) try { this.worker.postMessage({ type: 'reset' }); } catch { /* the next job will fail and disable */ }
  }
  build(job: Omit<TerrainJob, 'id'>, transfer: Transferable[]): Promise<TerrainReply> {
    let worker: Worker;
    try { worker = this.ensureWorker(); } catch (error) { return Promise.reject(error instanceof Error ? error : new Error(String(error))); }
    const id = this.nextId++;
    return new Promise<TerrainReply>((resolve, reject) => {
      this.pending.set(id, { at: performance.now(), resolve, reject });
      try { worker.postMessage({ type: 'build', id, ...job }, transfer); }
      catch (error) { this.pending.delete(id); reject(error instanceof Error ? error : new Error(String(error))); }
    });
  }
  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    if (this.disabled || typeof Worker !== 'function') throw new Error('terrain worker unavailable');
    const url = URL.createObjectURL(new Blob([terrainWorkerSource()], { type: 'application/javascript' }));
    try {
      const worker = new Worker(url, { name: 'drive-terrain' });
      worker.onmessage = (event: MessageEvent<TerrainReply>) => this.receive(event.data);
      worker.onerror = (event: ErrorEvent) => this.fail(new Error(event.message || 'terrain worker failed'));
      worker.onmessageerror = () => this.fail(new Error('terrain worker message failed'));
      this.worker = worker;
      return worker;
    } catch (error) { this.disabled = true; throw error; } finally { URL.revokeObjectURL(url); }
  }
  private receive(reply: TerrainReply): void {
    const p = this.pending.get(reply.id);
    if (!p) return;
    this.pending.delete(reply.id);
    if (reply.error) { this.stats.failures++; p.reject(new Error(reply.error)); return; }
    this.stats.jobs++; this.stats.workerMs += reply.workerMs; this.stats.lastWorkerMs = reply.workerMs;
    this.stats.waitMs += performance.now() - p.at - reply.workerMs;
    p.resolve(reply);
  }
  private fail(error: Error): void {
    this.disabled = true; this.stats.failures++;
    for (const p of this.pending.values()) p.reject(error);
    this.pending.clear();
    if (this.worker) { try { this.worker.terminate(); } catch { /* gone */ } this.worker = null; }
  }
}
