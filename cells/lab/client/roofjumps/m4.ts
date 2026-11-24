/** Roof Jumps' matrices: 4×4, column-major, as GL wants them. Each returns a new one. */
export type M4 = Float32Array;

export function ident(): M4 { const m = new Float32Array(16); m[0] = m[5] = m[10] = m[15] = 1; return m; }

/** a · b */
export function mul(a: M4, b: M4): M4 {
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  return o;
}
export function translate(m: M4, x: number, y: number, z: number): M4 { const t = ident(); t[12] = x; t[13] = y; t[14] = z; return mul(m, t); }
export function rotX(m: M4, a: number): M4 { const r = ident(), c = Math.cos(a), s = Math.sin(a); r[5] = c; r[6] = s; r[9] = -s; r[10] = c; return mul(m, r); }
export function rotY(m: M4, a: number): M4 { const r = ident(), c = Math.cos(a), s = Math.sin(a); r[0] = c; r[2] = -s; r[8] = s; r[10] = c; return mul(m, r); }
export function rotZ(m: M4, a: number): M4 { const r = ident(), c = Math.cos(a), s = Math.sin(a); r[0] = c; r[1] = s; r[4] = -s; r[5] = c; return mul(m, r); }

export function perspective(fovy: number, aspect: number, near: number, far: number): M4 {
  const f = 1 / Math.tan(fovy / 2), m = new Float32Array(16);
  m[0] = f / aspect; m[5] = f; m[10] = (far + near) / (near - far); m[11] = -1; m[14] = (2 * far * near) / (near - far);
  return m;
}
export function lookAt(e: number[], t: number[], up: number[]): M4 {
  let zx = e[0] - t[0], zy = e[1] - t[1], zz = e[2] - t[2]; const zl = Math.hypot(zx, zy, zz); zx /= zl; zy /= zl; zz /= zl;
  let xx = up[1] * zz - up[2] * zy, xy = up[2] * zx - up[0] * zz, xz = up[0] * zy - up[1] * zx; const xl = Math.hypot(xx, xy, xz); xx /= xl; xy /= xl; xz /= xl;
  const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
  const m = ident();
  m[0] = xx; m[4] = xy; m[8] = xz; m[1] = yx; m[5] = yy; m[9] = yz; m[2] = zx; m[6] = zy; m[10] = zz;
  m[12] = -(xx * e[0] + xy * e[1] + xz * e[2]); m[13] = -(yx * e[0] + yy * e[1] + yz * e[2]); m[14] = -(zx * e[0] + zy * e[1] + zz * e[2]);
  return m;
}
/** a point through m */
export function point(m: M4, x: number, y: number, z: number): [number, number, number] {
  return [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]];
}
