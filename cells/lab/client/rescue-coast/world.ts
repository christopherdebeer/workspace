/**
 * The coast made drawable, in pieces along the course (only the pieces in view are drawn):
 * - **the ground**: the heightfield as triangles, coloured by the shader (granite where it's steep, grass on top,
 *   sand and shingle low down, the seabed under the water); deep seabed nobody can see is left out;
 * - **the boulders**: the coast's rocks, as instances of the boulder library (near pieces drawn finer than far ones);
 * - **what's built**: cottages, lighthouses, the station and slipway, the quay, gorse, the finish posts and banner; (the
 *   Service's harbour) the jetties, lamps, bunting and what's left about on the quay.
 */
import { CELL, GATE_HALF, GATE_Z, NX, NZ, X0, Z0, type Coast } from './coast';
import { Builder, type Mesh } from './shapes';
import { banner, boulder, bunting, clutter, column, cottage, gorse, jetty, lamp, lighthouse, post, station } from './models';

export const PIECE = 80;
export const ISTRIDE = 20;
export interface Piece { z0: number; z1: number }
export interface TerrainPiece extends Piece { verts: Float32Array; index: Uint32Array; far: Uint32Array }
export interface RockPiece extends Piece { kind: number; inst: Float32Array; n: number }
/** what's built, in pieces; `rally` for what only the Rally has (the finish banner) */
export interface PropPiece extends Piece { mesh: Mesh; rally?: boolean }
export interface World { terrain: TerrainPiece[]; rocks: RockPiece[]; props: PropPiece[]; boulders: Mesh[]; bouldersFar: Mesh[] }

/** granite: warm, grey, a darker weathered one (sRGB) */
const GRANITE = [[0.94, 0.82, 0.66], [0.84, 0.77, 0.68], [0.8, 0.68, 0.54], [0.96, 0.86, 0.7], [0.88, 0.78, 0.64]];

export function makeWorld(c: Coast): World {
  // ─── the ground ───
  const terrain: TerrainPiece[] = [], H = c.ground, ROWS = PIECE / CELL;
  for (let j0 = 0; j0 < NZ - 1; j0 += ROWS) {
    const j1 = Math.min(NZ - 1, j0 + ROWS), nr = j1 - j0 + 1, v = new Float32Array(nr * NX * 6), idx: number[] = [];
    for (let j = j0; j <= j1; j++) for (let i = 0; i < NX; i++) {
      const o = ((j - j0) * NX + i) * 6, h = H[j * NX + i];
      const hx = (H[j * NX + Math.min(NX - 1, i + 1)] - H[j * NX + Math.max(0, i - 1)]) / (2 * CELL), hz = (H[Math.min(NZ - 1, j + 1) * NX + i] - H[Math.max(0, j - 1) * NX + i]) / (2 * CELL), l = Math.hypot(hx, 1, hz);
      v[o] = X0 + i * CELL; v[o + 1] = h; v[o + 2] = Z0 + j * CELL; v[o + 3] = -hx / l; v[o + 4] = 1 / l; v[o + 5] = -hz / l;
    }
    for (let j = j0; j < j1; j++) for (let i = 0; i < NX - 1; i++) {
      const a = j * NX + i;
      if (Math.max(H[a], H[a + 1], H[a + NX], H[a + NX + 1]) < -2.5) continue;
      const la = (j - j0) * NX + i;
      idx.push(la, la + NX, la + 1, la + 1, la + NX, la + NX + 1);
    }
    // (and every other sample, for far off)
    const far: number[] = [];
    for (let j = j0; j + 2 <= j1; j += 2) for (let i = 0; i + 2 < NX; i += 2) {
      const a = j * NX + i;
      if (Math.max(H[a], H[a + 2], H[a + 2 * NX], H[a + 2 * NX + 2]) < -2.5) continue;
      const la = (j - j0) * NX + i;
      far.push(la, la + 2 * NX, la + 2, la + 2, la + 2 * NX, la + 2 * NX + 2);
    }
    if (idx.length) terrain.push({ z0: Z0 + j0 * CELL, z1: Z0 + j1 * CELL, verts: v, index: new Uint32Array(idx), far: new Uint32Array(far) });
  }
  // ─── the boulders, by piece and kind ───
  const buckets = new Map<string, number[]>();
  for (const r of c.rocks) {
    const k = `${Math.floor((r.z - Z0) / PIECE)}:${r.kind}`, list = buckets.get(k) ?? buckets.set(k, []).get(k)!;
    const g = GRANITE[Math.floor(r.tint * 5) % 5], t = 0.85 + (r.tint * 7.31 % 1) * 0.25;
    list.push(r.x, r.y, r.z, r.yaw, r.sx, r.sy, r.sz, 0, g[0] * t, g[1] * t, g[2] * t, 0, 1, 1, 1, 0, 1, 1, 1, 0);
  }
  const rocks: RockPiece[] = [];
  for (const [k, list] of buckets) {
    const [p, kind] = k.split(':').map(Number);
    rocks.push({ z0: Z0 + p * PIECE - 14, z1: Z0 + (p + 1) * PIECE + 14, kind, inst: new Float32Array(list), n: list.length / ISTRIDE });
  }
  // ─── what's built ───
  const pieces = new Map<number, Builder>();
  const at = (z: number) => { const k = Math.floor((z - Z0) / PIECE); return pieces.get(k) ?? pieces.set(k, new Builder()).get(k)!; };
  for (const p of c.props) {
    if (p.kind === 'post') continue;
    const b = at(p.z);
    b.at(p.x, p.y, p.z, p.yaw, p.s);
    if (p.kind === 'cottage') cottage(b, p.v);
    else if (p.kind === 'lighthouse') lighthouse(b, p.v);
    else if (p.kind === 'station') station(b);
    else if (p.kind === 'gorse') gorse(b, Math.round(p.x * 13 + p.z * 7), p.v === 1);
    else if (p.kind === 'jetty' || p.kind === 'lamp' || p.kind === 'bunting' || p.kind === 'clutter') {
      // (made in their own frame, then placed)
      const q = new Builder(), seed = Math.round(p.x * 13 + p.z * 7) >>> 0;
      if (p.kind === 'jetty') jetty(q, p.v, seed); else if (p.kind === 'lamp') lamp(q); else if (p.kind === 'bunting') bunting(q, p.v, seed); else clutter(q, p.v);
      b.put(q);
    }
    else if (p.kind === 'quay') {
      b.use(0, 0, 4); b.box(-2.9, 2.9, -3.5, 2.75, -0.3, 2.6, [0.66, 0.64, 0.6]);
      b.use(0, 0, 4); b.box(-2.95, 2.95, 2.75, 2.95, -0.45, 1.2, [0.82, 0.8, 0.76]);
      if (Math.round(p.yaw / 0.035) % 4 === 0) { b.use(0, 0, 1); b.tube([0, 2.95, 0.3], [0, 3.5, 0.3], 0.18, [0.08, 0.08, 0.09], 8); }
    }
    b.at();
  }
  const props: PropPiece[] = [...pieces.entries()].map(([k, b]) => ({ z0: Z0 + k * PIECE - 20, z1: Z0 + (k + 1) * PIECE + 20, mesh: b.done() }));
  {
    // (the finish across the harbour mouth, posts and banner: the Rally's; the Service comes home between the lighthouses)
    const x0 = c.gateX - GATE_HALF + 2, x1 = c.gateX + GATE_HALF - 2, y = 10.4, b = new Builder();
    banner(b, x0, x1, GATE_Z, y);
    for (const p of c.props) if (p.kind === 'post') { b.at(p.x, p.y, p.z, p.yaw, p.s); post(b); b.at(); }
    props.push({ z0: GATE_Z - 20, z1: GATE_Z + 20, mesh: b.done(), rally: true });
  }
  const columns = [0, 1, 2, 3].map((k) => column(k + 1));
  return { terrain, rocks, props, boulders: [...[0, 1, 2, 3].map((k) => boulder(k + 1, 4)), ...columns], bouldersFar: [...[0, 1, 2, 3].map((k) => boulder(k + 1, 2)), ...columns] };
}
