/**
 * The composed set (`backdrop=set`, an experiment after Astra's proposal): the painting composed first, then given
 * just enough depth. Designed from one viewpoint, the chase camera at station 2100 of seed 1 looking down the way, and
 * built relative to it: a broad valley floor sloping away, the river attached to it, winding out of the distance between
 * two shoulders that overlap it, the nearer crossing in front of the river, the farther behind; the far massif (backdrop.ts)
 * aimed straight down the valley, where a phone's narrow view looks. The same artwork two ways: `scene` draws all of it
 * about the eye (a flat painted cylinder: it turns with you, never moves); `set` puts the floor, the river and the
 * shoulders at their places in the world (a small theatrical set: they move by their distances, the nearer faster, and
 * overlap afresh), only the sky and the far massif kept about the eye.
 */
import type { Course } from './course';
import { M, Mesh } from './mesh';
import { NEVER } from './paint';
import type { Plane } from './backdrop';

export const SCENE_S = 2100;
/** the design viewpoint (world), and the way it looks (its heading) */
export function sceneView(c: Course) {
  const p = c.point(SCENE_S, 0), h = p.heading;
  return { D: [p.x - Math.sin(h) * 6, p.y + 3.5, p.z - Math.cos(h) * 6], h };
}

export function buildScene(c: Course): Plane[] {
  const { h } = sceneView(c), F = [Math.sin(h), Math.cos(h)], Rt = [-Math.cos(h), Math.sin(h)];
  // (a place in the scene's own terms: a metres ahead, b out to the drop side, y metres from the eye's height)
  const P = (a: number, b: number, y: number) => [F[0] * a + Rt[0] * b, y, F[1] * a + Rt[1] * b];
  const floorY = (a: number) => -335 - a * 0.02;
  const planes: { name: string; mesh: Mesh; strokes: number[] }[] = [];
  const plane = (name: string) => { const p = { name, mesh: new Mesh(true), strokes: [] as number[] }; planes.push(p); return p; };
  let seed = 23; const R = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  // (a passage: one broad stroke between two places, in a material's band)
  // (its normal: the surface's own, given; else up, for what lies on the floor)
  const pass = (p: { strokes: number[] }, A: number[], B: number[], W: number, mt: number, band: number, stamp: number, n: number[] = [0, 1, 0]) => {
    const d = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], L = Math.hypot(d[0], d[1], d[2]) || 1;
    p.strokes.push((A[0] + B[0]) / 2, (A[1] + B[1]) / 2, (A[2] + B[2]) / 2, mt, d[0] / L, d[1] / L, d[2] / L, L * 1.05, n[0], n[1], n[2], W, R(), stamp, (R() - 0.5) * 0.1, 0, NEVER, 1 + band, 0, 1);
  };

  // ── the valley floor, sloping away, wide
  const floor = plane('floor');
  for (let a = 200; a < 4200; a += 200) for (let b = -800; b < 2800; b += 300) {
    const q = (aa: number, bb: number) => P(aa, bb, floorY(aa));
    floor.mesh.quad(q(a, b), q(a, b + 300), q(a + 200, b + 300), q(a + 200, b), M.PATCH_FLOOR, 0.5);
  }
  // (a few long passages across it, a value step lighter and darker, so it's land seen far off, not a slab)
  for (const [a, b0, b1, w, band] of [[3800, -600, 900, 110, 1], [3100, -300, 1300, 120, 2], [2400, 100, 1500, 130, 1], [1900, -200, 300, 120, 3], [1500, 900, 1700, 140, 2], [1100, 200, 900, 150, 1]] as number[][])
    pass(floor, P(a, b0, floorY(a) + 1), P(a + 60, b1, floorY(a + 60) + 1), w, M.GRASS, band, 11);
  // ── the river, on the floor: out of the distance, between the shoulders, toward you
  const river = plane('river');
  // (composed inside a phone's narrow view: ±20° of straight ahead, the drop side's half of it mostly)
  const rv = [[4300, -150], [3600, 120], [3000, 380], [2550, 560], [2150, 470], [1750, 620], [1350, 520], [950, 640], [600, 560]];
  for (let k = 0; k < rv.length - 1; k++) {
    const [a0, b0] = rv[k], [a1, b1] = rv[k + 1], da = a1 - a0, db = b1 - b0, L = Math.hypot(da, db), w0 = 40 + a0 * 0.012, w1 = 40 + a1 * 0.012;
    const na = -db / L, nb = da / L;
    river.mesh.quad(P(a0 - na * w0, b0 - nb * w0, floorY(a0) + 1.5), P(a0 + na * w0, b0 + nb * w0, floorY(a0) + 1.5), P(a1 + na * w1, b1 + nb * w1, floorY(a1) + 1.5), P(a1 - na * w1, b1 - nb * w1, floorY(a1) + 1.5), M.MASS_RIVER, 0.5);
  }
  pass(river, P(2550, 560, floorY(2550) + 2), P(1750, 620, floorY(1750) + 2), 26, M.WHITE, 0, 0);
  // ── a shoulder: a crest line, its two flanks falling to the floor either side (lit or in shade by the sun as they turn)
  // (spread: how broad its flanks are for its height (broad and quiet, or steep and sharp); passes: which segments carry a
  // passage on its lit and shaded sides)
  const shoulder = (name: string, crest: number[][], mt: number, flankBand: [number, number], spread: number, base: number, passes: (k: number, lit: boolean) => boolean) => {
    const p = plane(name);
    for (let k = 0; k < crest.length - 1; k++) {
      const [a0, b0, y0] = crest[k], [a1, b1, y1] = crest[k + 1], da = a1 - a0, db = b1 - b0, L = Math.hypot(da, db), na = -db / L, nb = da / L;
      const w0 = (y0 - floorY(a0)) * spread + base, w1 = (y1 - floorY(a1)) * spread + base;
      for (const sg of [-1, 1]) {
        const f0 = P(a0 + na * w0 * sg, b0 + nb * w0 * sg, floorY(a0 + na * w0 * sg)), f1 = P(a1 + na * w1 * sg, b1 + nb * w1 * sg, floorY(a1 + na * w1 * sg));
        p.mesh.quad(P(a0, b0, y0), P(a1, b1, y1), f1, f0, mt, 0.5);
        // (a broad passage down the flank, on the flank itself: from just under the crest's middle toward the foot's middle,
        // the flank's own normal; not on every segment (a repetition that would show): every other one on the lit side,
        // one on the shaded side)
        if (passes(k, sg < 0)) {
          const c0 = P(a0, b0, y0), c1 = P(a1, b1, y1), C = c0.map((v, i) => (v + c1[i]) / 2), Fm = f0.map((v, i) => (v + f1[i]) / 2), dn = Fm.map((v, i) => v - C[i]), e = c1.map((v, i) => v - c0[i]);
          let n = [e[1] * dn[2] - e[2] * dn[1], e[2] * dn[0] - e[0] * dn[2], e[0] * dn[1] - e[1] * dn[0]]; const nl = Math.hypot(n[0], n[1], n[2]) || 1; n = n.map((v) => v / nl); if (n[1] < 0) n = n.map((v) => -v);
          pass(p, C.map((v, i) => v + dn[i] * 0.06), C.map((v, i) => v + dn[i] * 0.8), Math.min(Math.hypot(e[0], e[2]), 170) * 0.85, M.GRASS, sg < 0 ? flankBand[0] : flankBand[1], 7, n);
        }
      }
    }
  };
  // (the farther: a broad, quiet mass enclosing the valley's far side, its crest long and gently rounded, its flanks wide,
  // one passage on its lit side and the rest left alone)
  shoulder('shoulderB', [[1450, 1000, -40], [1750, 820, -12], [2100, 600, -8], [2450, 380, -40], [2750, 200, -140], [3000, 90, -300]], M.PATCH_NEAR, [1, 3], 2.1, 140, (k, lit) => lit && k === 2);
  // (the nearer: a short, sharp interruption out from the near slope, steep and narrow, ending abruptly so the river shows
  // past its end, between it and the far mass: the valley's opening)
  shoulder('shoulderA', [[520, 170, -35], [760, 250, -45], [960, 320, -70], [1080, 370, -170], [1150, 400, -300]], M.PATCH_NEAR, [0, 2], 0.75, 35, (k, lit) => (lit ? k === 1 : k === 2));
  return planes.map((p) => ({ id: 0, name: p.name, verts: new Float32Array(p.mesh.v), strokes: new Float32Array(p.strokes), world: true }));
}
