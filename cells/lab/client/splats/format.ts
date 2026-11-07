/**
 * Splats as data. A 3D Gaussian splat is a fuzzy ellipsoid: a centre, a shape (three scales along its own axes, turned
 * by a rotation), a colour and an opacity. A scene is hundreds of thousands to millions of them, and what you see is
 * all of them blended, back to front, as soft ellipses on the screen.
 *
 * Kept here as plain arrays, one per attribute (`Splats`), whatever file they came from:
 * - **.splat** (the antimatter15 viewer's format): 32 bytes a splat, already baked: position (3 × f32), scale (3 × f32,
 *   linear), colour + opacity (4 × u8), rotation (4 × u8, a quaternion w x y z mapped from [-1, 1] to [0, 255]).
 * - **.ply** (what the 3DGS trainer writes): a header naming each property, then a binary row a splat. Its numbers are
 *   as the optimiser held them: scale as a log (`exp` it), opacity before its sigmoid, colour as spherical-harmonic
 *   coefficients (only the first, "DC", band is used here: the colour seen from every side alike; the other 45 make
 *   colour change with the viewing angle, and are left for later).
 * - **made here** (`garden`): a small scene of splats generated from shapes, so there's something to look at without a
 *   download, and to see how surfaces are built of flat discs.
 */
export interface Splats {
  n: number;
  /** centres, x y z */
  pos: Float32Array;
  /** sizes along the splat's own three axes (one standard deviation), linear */
  scale: Float32Array;
  /** rotations, unit quaternions w x y z */
  rot: Float32Array;
  /** colour and opacity, r g b a in 0..255 */
  rgba: Uint8Array;
  /** (a drawing's, stone.ts) what kind of mark each is, how long it survives as the drawing simplifies (1 the last),
   * and the surface it lies on (for the marks that show only edge-on) */
  mark?: Uint8Array; rank?: Float32Array; normal?: Float32Array;
  /** (a drawing's) a feature id per mark (any 32-bit number: its development is looked up in a texture), where it's
   * attached (brush.ts SUPPORT: none, surface, edge, free), an edge mark's second face's normal, and the element (stroke
   * or wash) it came from */
  feature?: Uint8Array | Uint32Array; support?: Uint8Array; normal2?: Float32Array; element?: Uint32Array;
}

export function alloc(n: number): Splats {
  return { n, pos: new Float32Array(n * 3), scale: new Float32Array(n * 3), rot: new Float32Array(n * 4), rgba: new Uint8Array(n * 4) };
}

/** .splat: 32 bytes each (see above) */
export function parseSplat(buf: ArrayBuffer): Splats {
  const n = Math.floor(buf.byteLength / 32), f = new Float32Array(buf, 0, n * 8), u = new Uint8Array(buf, 0, n * 32), s = alloc(n);
  for (let i = 0; i < n; i++) {
    for (let a = 0; a < 3; a++) { s.pos[i * 3 + a] = f[i * 8 + a]; s.scale[i * 3 + a] = f[i * 8 + 3 + a]; }
    for (let a = 0; a < 4; a++) s.rgba[i * 4 + a] = u[i * 32 + 24 + a];
    let w = (u[i * 32 + 28] - 128) / 128, x = (u[i * 32 + 29] - 128) / 128, y = (u[i * 32 + 30] - 128) / 128, z = (u[i * 32 + 31] - 128) / 128;
    const l = Math.hypot(w, x, y, z) || 1; w /= l; x /= l; y /= l; z /= l;
    s.rot.set([w, x, y, z], i * 4);
  }
  return s;
}

/** the same back to .splat bytes (to save what's made here, and to test the reader against) */
export function encodeSplat(s: Splats): ArrayBuffer {
  const buf = new ArrayBuffer(s.n * 32), f = new Float32Array(buf), u = new Uint8Array(buf);
  for (let i = 0; i < s.n; i++) {
    for (let a = 0; a < 3; a++) { f[i * 8 + a] = s.pos[i * 3 + a]; f[i * 8 + 3 + a] = s.scale[i * 3 + a]; }
    for (let a = 0; a < 4; a++) { u[i * 32 + 24 + a] = s.rgba[i * 4 + a]; u[i * 32 + 28 + a] = Math.max(0, Math.min(255, Math.round(s.rot[i * 4 + a] * 128 + 128))); }
  }
  return buf;
}

const SH_C0 = 0.28209479177387814;
const TYPES: Record<string, [number, (d: DataView, o: number) => number]> = {
  float: [4, (d, o) => d.getFloat32(o, true)], float32: [4, (d, o) => d.getFloat32(o, true)], double: [8, (d, o) => d.getFloat64(o, true)], float64: [8, (d, o) => d.getFloat64(o, true)],
  uchar: [1, (d, o) => d.getUint8(o)], uint8: [1, (d, o) => d.getUint8(o)], char: [1, (d, o) => d.getInt8(o)], int8: [1, (d, o) => d.getInt8(o)],
  ushort: [2, (d, o) => d.getUint16(o, true)], uint16: [2, (d, o) => d.getUint16(o, true)], short: [2, (d, o) => d.getInt16(o, true)], int16: [2, (d, o) => d.getInt16(o, true)],
  uint: [4, (d, o) => d.getUint32(o, true)], uint32: [4, (d, o) => d.getUint32(o, true)], int: [4, (d, o) => d.getInt32(o, true)], int32: [4, (d, o) => d.getInt32(o, true)],
};

/** .ply, binary little-endian, as the 3DGS trainer writes it (and plain coloured point clouds, as small round splats) */
export function parsePly(buf: ArrayBuffer): Splats {
  const head = new TextDecoder().decode(new Uint8Array(buf, 0, Math.min(buf.byteLength, 64 * 1024)));
  const end = head.indexOf('end_header');
  if (!head.startsWith('ply') || end < 0) throw new Error('not a PLY file');
  if (!/format binary_little_endian/.test(head)) throw new Error('only binary little-endian PLY is read');
  const lines = head.slice(0, end).split(/\r?\n/);
  let n = 0, inVertex = false, stride = 0;
  const props: Record<string, { off: number; read: (d: DataView, o: number) => number }> = {};
  for (const line of lines) {
    const w = line.trim().split(/\s+/);
    if (w[0] === 'element') { inVertex = w[1] === 'vertex'; if (inVertex) n = Number(w[2]); else if (n) break; }
    else if (w[0] === 'property' && inVertex) {
      if (w[1] === 'list') throw new Error('PLY lists in the vertex element are not read');
      const t = TYPES[w[1]];
      if (!t) throw new Error(`PLY property type ${w[1]} not read`);
      props[w[2]] = { off: stride, read: t[1] }; stride += t[0];
    }
  }
  const body = head.indexOf('\n', end) + 1, d = new DataView(buf, body), s = alloc(n);
  const P = (k: string) => props[k];
  const gauss = !!P('scale_0'), dc = !!P('f_dc_0'), rgb = !!P('red');
  for (let i = 0; i < n; i++) {
    const o = i * stride, g = (k: string, def = 0) => { const p = props[k]; return p ? p.read(d, o + p.off) : def; };
    s.pos[i * 3] = g('x'); s.pos[i * 3 + 1] = g('y'); s.pos[i * 3 + 2] = g('z');
    if (gauss) { for (let a = 0; a < 3; a++) s.scale[i * 3 + a] = Math.exp(g(`scale_${a}`)); }
    else s.scale.fill(0.01, i * 3, i * 3 + 3);
    let w = g('rot_0', 1), x = g('rot_1'), y = g('rot_2'), z = g('rot_3');
    const l = Math.hypot(w, x, y, z) || 1; w /= l; x /= l; y /= l; z /= l;
    s.rot.set([w, x, y, z], i * 4);
    const c = (v: number) => Math.max(0, Math.min(255, Math.round(v * 255)));
    if (dc) for (let a = 0; a < 3; a++) s.rgba[i * 4 + a] = c(0.5 + SH_C0 * g(`f_dc_${a}`));
    else if (rgb) { s.rgba[i * 4] = g('red'); s.rgba[i * 4 + 1] = g('green'); s.rgba[i * 4 + 2] = g('blue'); }
    else s.rgba.fill(200, i * 4, i * 4 + 3);
    s.rgba[i * 4 + 3] = P('opacity') ? c(1 / (1 + Math.exp(-g('opacity')))) : 255;
  }
  return s;
}

/** whichever it is, by its first bytes */
export function parse(buf: ArrayBuffer): Splats {
  const magic = new TextDecoder().decode(new Uint8Array(buf, 0, Math.min(3, buf.byteLength)));
  return magic === 'ply' ? parsePly(buf) : parseSplat(buf);
}

/**
 * Each splat's 3D covariance: the shape of its ellipsoid as one symmetric matrix, Σ = R S Sᵀ Rᵀ (R its rotation, S its
 * scales on the diagonal). Six numbers, xx xy xz yy yz zz. This is what the shader projects to the screen.
 */
export function covariance(s: Splats, i: number, out: Float32Array | number[], o = 0, mult = 1) {
  const w = s.rot[i * 4], x = s.rot[i * 4 + 1], y = s.rot[i * 4 + 2], z = s.rot[i * 4 + 3];
  const sx = s.scale[i * 3] * mult, sy = s.scale[i * 3 + 1] * mult, sz = s.scale[i * 3 + 2] * mult;
  // (R from the quaternion, its columns scaled: M = R S)
  const m00 = (1 - 2 * (y * y + z * z)) * sx, m01 = 2 * (x * y - w * z) * sy, m02 = 2 * (x * z + w * y) * sz;
  const m10 = 2 * (x * y + w * z) * sx, m11 = (1 - 2 * (x * x + z * z)) * sy, m12 = 2 * (y * z - w * x) * sz;
  const m20 = 2 * (x * z - w * y) * sx, m21 = 2 * (y * z + w * x) * sy, m22 = (1 - 2 * (x * x + y * y)) * sz;
  // (Σ = M Mᵀ)
  out[o] = m00 * m00 + m01 * m01 + m02 * m02; out[o + 1] = m00 * m10 + m01 * m11 + m02 * m12; out[o + 2] = m00 * m20 + m01 * m21 + m02 * m22;
  out[o + 3] = m10 * m10 + m11 * m11 + m12 * m12; out[o + 4] = m10 * m20 + m11 * m21 + m12 * m22; out[o + 5] = m20 * m20 + m21 * m21 + m22 * m22;
}

/** a robust middle and size of a scene (medians, and the distance most of it lies within), for framing it */
export function bounds(s: Splats): { centre: [number, number, number]; radius: number } {
  const step = Math.max(1, Math.floor(s.n / 20000)), xs: number[][] = [[], [], []];
  for (let i = 0; i < s.n; i += step) for (let a = 0; a < 3; a++) xs[a].push(s.pos[i * 3 + a]);
  const med = (v: number[]) => { const q = [...v].sort((a, b) => a - b); return q[Math.floor(q.length / 2)] ?? 0; };
  const c: [number, number, number] = [med(xs[0]), med(xs[1]), med(xs[2])];
  const ds = xs[0].map((_, k) => Math.hypot(xs[0][k] - c[0], xs[1][k] - c[1], xs[2][k] - c[2])).sort((a, b) => a - b);
  return { centre: c, radius: Math.max(0.1, ds[Math.floor(ds.length * 0.8)] ?? 1) };
}

// ─── made here ───
const rng = (seed: number) => () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
/** the rotation that turns a splat's own z axis to a normal n (so a splat flattened in z lies flat on a surface) */
function facing(nx: number, ny: number, nz: number): [number, number, number, number] {
  // (the half-way quaternion: w = 1 + z·n, xyz = z × n)
  let w = 1 + nz, x = -ny, y = nx, z = 0;
  if (w < 1e-6) return [0, 1, 0, 0];
  const l = Math.hypot(w, x, y, z); w /= l; x /= l; y /= l; z /= l;
  return [w, x, y, z];
}

/**
 * A pebble in a garden, made of splats (y up): a ground of flat discs, a banded stone of discs lying on its surface,
 * tufts of grass as needles (a splat long in one axis), and a few bright motes floating over it. About `count` in all.
 */
export function garden(count = 120000, seed = 7): Splats {
  const r = rng(seed), s = alloc(count);
  let i = 0;
  const put = (p: number[], sc: number[], q: number[], c: number[]) => {
    if (i >= count) return;
    s.pos.set(p, i * 3); s.scale.set(sc, i * 3); s.rot.set(q, i * 4);
    s.rgba.set(c.map((v) => Math.max(0, Math.min(255, Math.round(v)))), i * 4); i++;
  };
  const UP = facing(0, 1, 0);
  const noise = (x: number, z: number) => Math.sin(x * 3.1 + Math.sin(z * 2.3)) * 0.5 + Math.sin(z * 4.7 + x * 1.3) * 0.3 + Math.sin((x + z) * 9.1) * 0.2;
  // (the ground: discs on a disc, earth with lighter gravel and darker moss)
  for (let k = 0; k < count * 0.5; k++) {
    const a = r() * Math.PI * 2, d = Math.sqrt(r()) * 3.2, x = Math.cos(a) * d, z = Math.sin(a) * d, nz = noise(x, z);
    const moss = nz > 0.35, near = Math.hypot(x / 1.1, z / 0.85) < 1;
    const c = moss ? [70 + 30 * r(), 95 + 40 * r(), 45 + 20 * r()] : [150 + 40 * nz + 30 * r(), 128 + 30 * nz + 25 * r(), 100 + 20 * nz + 20 * r()];
    const shade = near ? 0.6 : 1;
    put([x, 0.01 * nz, z], [0.035 + 0.02 * r(), 0.035 + 0.02 * r(), 0.004], UP, [c[0] * shade, c[1] * shade, c[2] * shade, 235]);
  }
  // (the pebble: an ellipsoid, discs lying on its surface, banded like sedimentary stone, lit from above)
  const A = 1.1, B = 0.62, C = 0.85, cy = 0.55;
  for (let k = 0; k < count * 0.38; k++) {
    const u = r() * 2 - 1, t = r() * Math.PI * 2, rr = Math.sqrt(1 - u * u);
    const ex = rr * Math.cos(t), ey = u, ez = rr * Math.sin(t);
    const x = ex * A, y = ey * B + cy, z = ez * C;
    if (y < 0) continue;
    let nx = ex / A, ny = ey / B, nzz = ez / C; const l = Math.hypot(nx, ny, nzz); nx /= l; ny /= l; nzz /= l;
    const band = Math.sin(y * 22 + Math.sin(x * 3) * 1.5) * 0.5 + 0.5, light = 0.55 + 0.45 * Math.max(0, ny * 0.8 + nx * 0.3);
    const c = [(95 + 70 * band) * light, (98 + 55 * band) * light, (105 + 35 * band) * light];
    put([x, y, z], [0.03 + 0.015 * r(), 0.03 + 0.015 * r(), 0.004], facing(nx, ny, nzz), [c[0], c[1], c[2], 245]);
  }
  // (grass: tufts of needles round the stone's foot and in the moss)
  while (i < count * 0.995) {
    const a = r() * Math.PI * 2, d = 1.05 + Math.pow(r(), 0.7) * 2, cx = Math.cos(a) * d * 1.05, cz = Math.sin(a) * d * 0.9;
    if (noise(cx, cz) < 0.1 && r() < 0.7) continue;
    for (let b = 0; b < 40; b++) {
      const lean = r() * Math.PI * 2, tilt = 0.25 * r(), h = 0.08 + 0.14 * r();
      const nx = Math.cos(lean) * tilt, nzz = Math.sin(lean) * tilt, ny = 1;
      const q = facing(nx, ny, nzz); // (the splat's z along the blade, so its long axis is z)
      const x = cx + (r() - 0.5) * 0.18, z = cz + (r() - 0.5) * 0.18;
      put([x + nx * h * 0.5, h * 0.5, z + nzz * h * 0.5], [0.004, 0.004, h * 0.5], q, [60 + 50 * r(), 120 + 60 * r(), 40 + 20 * r(), 230]);
    }
  }
  // (motes: small, bright, round, hanging in the air)
  while (i < count) put([(r() - 0.5) * 5, 0.4 + r() * 1.6, (r() - 0.5) * 5], [0.006, 0.006, 0.006], [1, 0, 0, 0], [255, 236, 180, 170]);
  return s;
}
