/**
 * A composed scene (`backdrop=scene|set`, an experiment after Astra's proposal): the painting composed first, then given
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

export function buildScene(c: Course, firstId: number): Plane[] {
  const { h } = sceneView(c), F = [Math.sin(h), Math.cos(h)], Rt = [-Math.cos(h), Math.sin(h)];
  // (a place in the scene's own terms: a metres ahead, b out to the drop side, y metres from the eye's height)
  const P = (a: number, b: number, y: number) => [F[0] * a + Rt[0] * b, y, F[1] * a + Rt[1] * b];
  const floorY = (a: number) => -335 - a * 0.02;
  const planes: { name: string; mesh: Mesh; strokes: number[] }[] = [];
  const plane = (name: string) => { const p = { name, mesh: new Mesh(true), strokes: [] as number[] }; planes.push(p); return p; };
  let seed = 23; const R = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  // (a passage: one broad stroke between two places, in a material's band)
  const pass = (p: { strokes: number[] }, A: number[], B: number[], W: number, mt: number, band: number, stamp: number) => {
    const d = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], L = Math.hypot(d[0], d[1], d[2]) || 1, n = [-(A[0] + B[0]) / 2, 0, -(A[2] + B[2]) / 2], nl = Math.hypot(n[0], n[2]) || 1;
    p.strokes.push((A[0] + B[0]) / 2, (A[1] + B[1]) / 2, (A[2] + B[2]) / 2, mt, d[0] / L, d[1] / L, d[2] / L, L * 1.05, n[0] / nl, 0.3, n[2] / nl, W, R(), stamp, (R() - 0.5) * 0.1, 0, NEVER, 1 + band, 0, 1);
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
  const shoulder = (name: string, crest: number[][], mt: number, flankBand: [number, number]) => {
    const p = plane(name);
    for (let k = 0; k < crest.length - 1; k++) {
      const [a0, b0, y0] = crest[k], [a1, b1, y1] = crest[k + 1], da = a1 - a0, db = b1 - b0, L = Math.hypot(da, db), na = -db / L, nb = da / L;
      const w0 = (y0 - floorY(a0)) * 1.25 + 60, w1 = (y1 - floorY(a1)) * 1.25 + 60;
      for (const sg of [-1, 1]) {
        const f0 = P(a0 + na * w0 * sg, b0 + nb * w0 * sg, floorY(a0 + na * w0 * sg)), f1 = P(a1 + na * w1 * sg, b1 + nb * w1 * sg, floorY(a1 + na * w1 * sg));
        p.mesh.quad(P(a0, b0, y0), P(a1, b1, y1), f1, f0, mt, 0.5);
        // (a broad passage down the flank from the crest, in the flank's light)
        pass(p, P(a0 + da * 0.5, b0 + db * 0.5, (y0 + y1) / 2 - 10), P(a0 + da * 0.5 + na * (w0 + w1) * 0.35 * sg, b0 + db * 0.5 + nb * (w0 + w1) * 0.35 * sg, floorY(a0) + 20), Math.min(L, 160) * 0.9, M.GRASS, sg < 0 ? flankBand[0] : flankBand[1], 7);
      }
    }
  };
  // (the farther, behind the river's middle reach, laid first)
  shoulder('shoulderB', [[1500, 900, -10], [1900, 650, -25], [2300, 380, -80], [2650, 200, -210], [2850, 130, -340]], M.PATCH_NEAR, [1, 3]);
  // (the nearer, out from the near slope, crossing in front of the river)
  shoulder('shoulderA', [[500, 170, -45], [800, 260, -60], [1100, 340, -95], [1350, 420, -180], [1550, 480, -320]], M.PATCH_NEAR, [0, 2]);
  return planes.map((p, i) => ({ id: firstId + i, name: p.name, verts: new Float32Array(p.mesh.v), strokes: new Float32Array(p.strokes), world: true }));
}
