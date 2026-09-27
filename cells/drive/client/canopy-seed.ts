/**
 * THE CANOPY'S TREES, ON THE CPU AS WELL AS IN THE SHADER.
 *
 * The canopy draws its crowns by ray-marching a jittered crown per 6.5 m cell,
 * every parameter of which comes from a hash of the cell. Up close a crown on
 * a pole reads as a green object hung in the air: what a forest interior is
 * made of is trunks, forks and the undersides of limbs, and those want real
 * geometry with parallax. For that geometry to belong to the SAME trees, the
 * CPU has to reproduce the shader's crowns exactly, which a float hash cannot
 * promise (fract amplifies the last bit, and a GPU's float32 is not a JS
 * double). So the crown hash is INTEGER — pcg4d over the cell index — and
 * this module holds both halves: the GLSL string the shader splices in, and
 * the same arithmetic in JS with Math.imul. Every input it is ever given is an
 * integer (a cell, or canN3's integer lattice corners), so the two agree to
 * the bit. The 24-bit output is exact in a float32.
 *
 * GLSL ES 1.00 has no unsigned ints; a WebGL1 context keeps the old float
 * hash, and its skeletons would not line up — the canopy's structure layer is
 * a WebGL2 feature, and main.ts only builds it there.
 */

export const CAN_HASH_GLSL = `
#if __VERSION__ >= 300
uvec4 canPcg(uvec4 v) {
  v = v * 1664525u + 1013904223u;
  v.x += v.y * v.w; v.y += v.z * v.x; v.z += v.x * v.y; v.w += v.y * v.z;
  v ^= v >> 16u;
  v.x += v.y * v.w; v.y += v.z * v.x; v.z += v.x * v.y; v.w += v.y * v.z;
  return v;
}
vec4 canH4(vec2 c) {
  ivec2 i = ivec2(floor(c + 0.5)) + 1048576;
  uvec4 h = canPcg(uvec4(uint(i.x), uint(i.y), uint(i.y) ^ 40503u, uint(i.x) ^ 2654435769u));
  return vec4(h >> 8u) * (1.0 / 16777216.0);
}
#else
vec4 canH4(vec2 c) {
  vec4 p4 = fract(vec4(c.xyx, c.y) * vec4(0.1031, 0.1030, 0.0973, 0.1099));
  p4 += dot(p4, p4.wzxy + 33.33);
  return fract((p4.xxyz + p4.yzzw) * p4.zywx);
}
#endif
`;

/** canH4 in JS: the same four 24-bit values, as the shader's floats. */
export function canH4(cx: number, cy: number): [number, number, number, number] {
  const ix = (Math.floor(cx + 0.5) + 1048576) >>> 0, iy = (Math.floor(cy + 0.5) + 1048576) >>> 0;
  let x = ix, y = iy, z = (iy ^ 40503) >>> 0, w = (ix ^ 2654435769) >>> 0;
  x = (Math.imul(x, 1664525) + 1013904223) >>> 0; y = (Math.imul(y, 1664525) + 1013904223) >>> 0;
  z = (Math.imul(z, 1664525) + 1013904223) >>> 0; w = (Math.imul(w, 1664525) + 1013904223) >>> 0;
  x = (x + Math.imul(y, w)) >>> 0; y = (y + Math.imul(z, x)) >>> 0; z = (z + Math.imul(x, y)) >>> 0; w = (w + Math.imul(y, z)) >>> 0;
  x = (x ^ (x >>> 16)) >>> 0; y = (y ^ (y >>> 16)) >>> 0; z = (z ^ (z >>> 16)) >>> 0; w = (w ^ (w >>> 16)) >>> 0;
  x = (x + Math.imul(y, w)) >>> 0; y = (y + Math.imul(z, x)) >>> 0; z = (z + Math.imul(x, y)) >>> 0; w = (w + Math.imul(y, z)) >>> 0;
  const k = 1 / 16777216;
  return [(x >>> 8) * k, (y >>> 8) * k, (z >>> 8) * k, (w >>> 8) * k];
}

const fract = (v: number): number => v - Math.floor(v);
const mix = (a: number, b: number, t: number): number => a + (b - a) * t;
const clamp = (v: number, a: number, b: number): number => Math.min(b, Math.max(a, v));

export interface CanopyCrown {
  /** Crown centre in plan, top y, radius; depth, ground y, lift. */
  x: number; z: number; top: number; R: number; D: number; ground: number; L: number;
  /** 0 round, 1 columnar, 2 conic, 3 umbrella, 4 palm. */
  family: number; rot: number; minor: number; h: [number, number, number, number];
}

/** The shader's canLoad for one cell, verbatim in arithmetic. gl answers
 *  (ground y in world metres, lift, density) at a point; species the stand's
 *  (conifer, acacia, palm, columnar) shares; fade the ring-edge fade. */
export function canopyCrownAt(cellX: number, cellY: number, S: number,
  gl: (x: number, z: number) => [number, number, number],
  species: (x: number, z: number) => [number, number, number, number],
  fade: (x: number, z: number) => number): CanopyCrown | null {
  const h = canH4(cellX, cellY);
  // Size first, place second — see the shader's canLoad.
  const rf = mix(0.50, 0.84, fract(h[2] * 3.7 + h[3]));
  const x = (cellX + (rf - 0.5) + h[0] * (2 - 2 * rf)) * S, z = (cellY + (rf - 0.5) + h[1] * (2 - 2 * rf)) * S;
  const g = gl(x, z);
  let L = g[1] * fade(x, z) * (0.84 + 0.3 * h[2]);
  const mixS = species(x, z);
  const pick = fract(h[3] * 7.17 + h[1] * 3.91);
  let family = pick < mixS[0] ? 2 : pick < mixS[0] + mixS[1] ? 3 : pick < mixS[0] + mixS[1] + mixS[2] ? 4 : 0;
  if (family === 0 && fract(h[2] * 9.13 + h[0]) < mixS[3]) family = 1;
  const cone = family === 2 ? 1 : 0;
  const minor = mix(0.70, 1.0, fract(h[0] * 11.3 + h[2]));
  const emergent = fract(h[0] * 5.31 + h[1] * 2.17) >= 0.86 ? 1 : 0;
  L *= 1.0 + 0.22 * emergent;
  let R = S * rf * mix(1.0, 0.66, cone) * clamp(L / 11.0, 0.55, 1.0);
  if (family === 1) R *= mix(0.48, 0.66, h[1]);
  if (family === 2) R *= mix(0.72, 1.0, h[0]);
  let D = cone ? L * mix(0.58, 0.88, h[1]) : Math.min(L * 0.72, R * mix(1.1, 1.85, h[0]));
  if (family === 1) D = L * mix(0.65, 0.85, h[0]);
  if (family === 3) D = Math.min(L * 0.32, R * mix(0.40, 0.68, h[2]));
  if (family === 4) D = Math.min(L * 0.28, R * mix(0.55, 0.85, h[2]));
  if (L < 2.5 || fract(h[0] * 13.7 + h[2] * 3.1) > g[2]) return null;
  return { x, z, top: g[0] + L, R, D, ground: g[0], L, family, rot: h[1] * 6.2832, minor, h };
}

/** Half-float bits to a number (the canopy lattice is RGBA16F on the GPU and
 *  its CPU copy is the very bits that were uploaded). */
export function halfToFloat(b: number): number {
  const s = b & 0x8000 ? -1 : 1, e = (b >> 10) & 0x1f, m = b & 0x3ff;
  if (e === 0) return s * m * 5.960464477539063e-8;
  if (e === 31) return m ? NaN : s * Infinity;
  return s * (1 + m / 1024) * Math.pow(2, e - 15);
}

/**
 * THE SKELETON: a trunk and its main limbs, per family, from the crown's own
 * seed, as tapered prisms appended to flat arrays. Every limb ends INSIDE its
 * crown's envelope, so the canopy's foliage covers the tips and what shows is
 * what a forest shows from under it — the bole, the fork, the undersides of
 * the limbs, and dead branch stubs under a conifer's living crown.
 */
export class SkeletonBuilder {
  pos: number[] = []; nrm: number[] = []; col: number[] = []; idx: number[] = [];
  private prism(ax: number, ay: number, az: number, bx: number, by: number, bz: number,
    r0: number, r1: number, sides: number, tone: number): void {
    let dx = bx - ax, dy = by - ay, dz = bz - az;
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-3) return;
    dx /= len; dy /= len; dz /= len;
    // A basis square to the axis.
    let ux = 0, uy = 1, uz = 0;
    if (Math.abs(dy) > 0.9) { ux = 1; uy = 0; }
    let px = uy * dz - uz * dy, py = uz * dx - ux * dz, pz = ux * dy - uy * dx;
    const pl = Math.hypot(px, py, pz); px /= pl; py /= pl; pz /= pl;
    const qx = dy * pz - dz * py, qy = dz * px - dx * pz, qz = dx * py - dy * px;
    const base = this.pos.length / 3;
    const c = [0.075 * tone, 0.050 * tone, 0.030 * tone];
    for (let s = 0; s <= sides; s++) {
      const a = (s / sides) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
      const nx = px * ca + qx * sa, ny = py * ca + qy * sa, nz = pz * ca + qz * sa;
      this.pos.push(ax + nx * r0, ay + ny * r0, az + nz * r0, bx + nx * r1, by + ny * r1, bz + nz * r1);
      this.nrm.push(nx, ny, nz, nx, ny, nz);
      // A touch darker at the base of the segment: the bark's own occlusion.
      this.col.push(c[0] * 0.85, c[1] * 0.85, c[2] * 0.85, c[0], c[1], c[2]);
    }
    for (let s = 0; s < sides; s++) {
      const i0 = base + s * 2, i1 = i0 + 2;
      this.idx.push(i0, i1, i0 + 1, i0 + 1, i1, i1 + 1);
    }
  }

  /** One tree. Returns the triangles it added. `groundAt` (optional) is the
   *  ground height at a nearby point, for what lies on the floor beside it. */
  tree(c: CanopyCrown, groundAt?: (x: number, z: number) => number): number {
    const t0 = this.idx.length;
    const { x, z, top, R, D, ground, L, family, rot, h } = c;
    const rt = 0.12 + 0.018 * L;
    const yB = top - D;
    const tone = 0.8 + 0.4 * h[2];
    const r = (n: number): number => fract(h[3] * (13.1 + n * 7.7) + h[0] * (3.3 + n * 1.9));
    // The crown's ground is the canopy lattice's (6 m, half floats); the drawn
    // mesh can sit a metre off it on a slope, so the bole and its roots stand
    // on the drawn ground where it is known and reach below both.
    const gDrawn = groundAt ? groundAt(x, z) : ground;
    const base = Math.min(ground, gDrawn) - 0.3;
    // ROOT FLARES: the bole does not stand on the ground like a post, it
    // spreads into it. Three or four buttresses running out and down.
    if (family !== 4) {
      const nr = 3 + (r(60) > 0.5 ? 1 : 0);
      for (let i = 0; i < nr; i++) {
        const a = rot + (i / nr) * 6.2832 + (r(61 + i) - 0.5) * 0.8;
        const reach = rt * (2.2 + 1.6 * r(70 + i));
        this.prism(x, gDrawn + rt * 1.6, z, x + Math.cos(a) * reach, (groundAt ? groundAt(x + Math.cos(a) * reach, z + Math.sin(a) * reach) : gDrawn) - 0.15, z + Math.sin(a) * reach, rt * 0.55, rt * 0.12, 3, tone * 0.85);
      }
    }
    // DEADFALL: a seeded minority of trees has a fallen limb or a log on the
    // floor beside it — the anchors that give the ground scale and history.
    if (groundAt && r(80) < (family === 2 ? 0.16 : 0.1)) {
      const a = rot + r(81) * 6.2832, d0 = 1.2 + 2.5 * r(82);
      const len = (family === 2 ? 3 : 2) + 5 * r(83);
      const ax = x + Math.cos(a) * d0, az = z + Math.sin(a) * d0;
      const b = a + 1.2 + r(84) * 2.0;
      const bx = ax + Math.cos(b) * len, bz = az + Math.sin(b) * len;
      const lr = rt * (r(85) > 0.6 ? 0.8 : 0.35);
      this.prism(ax, groundAt(ax, az) + lr * 0.6, az, bx, groundAt(bx, bz) + lr * 0.4, bz, lr, lr * 0.7, 5, tone * 0.7);
    }
    if (family === 4) {
      // Palm: a slender bole straight to the frond hub; the fronds are the shader's.
      this.prism(x, base, z, x, top - D * 0.3, z, rt * 0.8, rt * 0.6, 6, tone * 1.2);
      return (this.idx.length - t0) / 3;
    }
    if (family === 2) {
      // Conifer: a tapering bole nearly to the top, whorls of short limbs
      // drooping outward inside the cone, and dead stubs below the crown.
      const yTop = top - D * 0.1;
      this.prism(x, base, z, x, yTop, z, rt, rt * 0.2, 6, tone);
      const dy = 1.6 + 0.6 * r(1);
      let n = 0;
      for (let y = Math.max(ground + 1.6, yB - 2.5); y < top - D * 0.25 && n < 9; y += dy, n++) {
        const s = clamp((top - y) / D, 0, 1);
        const live = y >= yB;
        const reach = live ? R * s * 0.8 : 0.5 + 0.6 * r(n + 5);
        const rr = rt * (live ? 0.35 : 0.22) * (1 - 0.5 * (y - ground) / Math.max(1, top - ground));
        for (let b = 0; b < 4; b++) {
          const a = rot + b * 1.5708 + n * 0.7 + r(n * 4 + b) * 0.5;
          const ex = x + Math.cos(a) * reach, ez = z + Math.sin(a) * reach;
          this.prism(x, y, z, ex, y - reach * (live ? 0.18 : 0.35), ez, rr, rr * 0.3, 3, tone * 0.9);
        }
      }
      return (this.idx.length - t0) / 3;
    }
    // Broadleaf, columnar, umbrella: a bole to a fork, limbs out and up into
    // the crown, and a pair of branches off each limb toward its rim.
    const umb = family === 3, col = family === 1;
    const yF = umb ? yB - 0.3 - 0.6 * r(2) : yB + D * (col ? 0.12 : 0.18) * r(3);
    const lean = 0.15 * R * r(4), la = rot + r(5) * 6.28;
    const fx = x + Math.cos(la) * lean, fz = z + Math.sin(la) * lean;
    this.prism(x, base, z, fx, yF, fz, rt, rt * 0.72, 6, tone);
    const limbs = col ? 3 : umb ? 4 : 3 + (r(6) > 0.5 ? 1 : 0);
    for (let i = 0; i < limbs; i++) {
      const a = rot + (i / limbs) * 6.2832 + (r(10 + i) - 0.5) * 0.9;
      const reach = R * c.minor * (col ? 0.32 : umb ? 0.62 : 0.5) * (0.8 + 0.4 * r(20 + i));
      const ey = umb ? yB + D * (0.35 + 0.2 * r(30 + i)) : yB + D * (col ? 0.6 : 0.45) * (0.8 + 0.4 * r(30 + i));
      const ex = fx + Math.cos(a) * reach, ez = fz + Math.sin(a) * reach;
      const rl = rt * (umb ? 0.62 : 0.55);
      this.prism(fx, yF, fz, ex, ey, ez, rl, rl * 0.55, 5, tone);
      for (let j = 0; j < 2; j++) {
        const b = a + (j ? 0.7 : -0.7) * (0.6 + 0.6 * r(40 + i * 2 + j));
        const rch = reach * (umb ? 0.55 : 0.6);
        const ty = umb ? ey + D * 0.15 : ey + D * 0.22;
        this.prism(ex, ey, ez, ex + Math.cos(b) * rch, ty, ez + Math.sin(b) * rch, rl * 0.5, rl * 0.18, 3, tone);
      }
    }
    return (this.idx.length - t0) / 3;
  }
}
