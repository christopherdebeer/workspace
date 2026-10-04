/**
 * What the dung is made of, close to: grass, chewed and digested — fragments of leaf and stem,
 * flattened ribbons a few millimetres long, straw-coloured to dark brown, veined lengthwise,
 * lying every way on the surface and half sunk into it. Drawn as limbs (flattened tubes) with a
 * material of their own.
 */
import { hash, seeded } from '../kit/rng';
import type { V3 } from './genome';
import type { Limbs } from './critters';
import { MAT_PLANT, ribbon } from './critters';

export interface Blade {
  /** where it lies: along the ground (x, z) */
  pts: Array<[number, number]>;
  w: number;
  col: V3;
  seed: number;
  /** how far sunk in (0 lying on it, 1 mostly under) */
  sink: number;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** The fragments over a patch of this radius (mm), from the seed. */
export function straw(seed: number, radius: number, count: number): Blade[] {
  const r = seeded(hash(seed, 0x57a));
  const out: Blade[] = [];
  const cols: V3[] = [[0.62, 0.5, 0.28], [0.48, 0.36, 0.18], [0.3, 0.22, 0.12], [0.2, 0.15, 0.09], [0.55, 0.52, 0.32]];
  for (let i = 0; i < count; i++) {
    const d = Math.sqrt(r()) * radius;
    const a = r() * Math.PI * 2;
    const len = lerp(0.8, 6, r() * r());
    const h = r() * Math.PI * 2;
    const bend = (r() - 0.5) * 0.6;
    const n = 6;
    const pts: Array<[number, number]> = [];
    let x = Math.cos(a) * d - (Math.cos(h) * len) / 2;
    let z = Math.sin(a) * d - (Math.sin(h) * len) / 2;
    for (let k = 0; k < n; k++) {
      pts.push([x, z]);
      const hh = h + bend * (k / (n - 1));
      x += (Math.cos(hh) * len) / (n - 1);
      z += (Math.sin(hh) * len) / (n - 1);
    }
    const c = cols[Math.floor(r() * cols.length)];
    const m = lerp(0.75, 1.15, r());
    out.push({ pts, w: lerp(0.12, 0.5, r() * r()), col: [c[0] * m, c[1] * m, c[2] * m], seed: r() * 100, sink: r() * r() });
  }
  return out;
}

/** Into the frame's limbs: the near ones finely, the far ones coarsely, the farthest not at all. */
export function drawStraw(list: Blade[], groundY: (x: number, z: number) => number, eye: V3, out: Limbs) {
  for (const b of list) {
    const m = b.pts[Math.floor(b.pts.length / 2)];
    const d = Math.hypot(eye[0] - m[0], eye[2] - m[1], eye[1]) / (b.w * 3);
    if (d > 260) continue;
    const pts: V3[] = b.pts.map(([x, z]) => [x, groundY(x, z) + b.w * (0.1 - 0.12 * b.sink), z]);
    const rad = b.pts.map((_, k) => b.w * 0.5 * (k === 0 || k === b.pts.length - 1 ? 0.75 : 1));
    ribbon(d < 12 ? out.hi : d < 50 ? out.mid : out.lo, pts, rad, b.col, MAT_PLANT, b.seed);
  }
}
