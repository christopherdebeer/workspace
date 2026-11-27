/**
 * A garment sewn round the body and let settle, off line (no hurry: many steps), for fitting a pattern (draft.ts,
 * devtools/piste-jacket.mjs). Position-based, Gauss–Seidel: each piece's grid keeps its lengths on the paper (along,
 * across, diagonally, and two along for bending), the seams draw closed over the first second, gravity pulls, and the
 * body (the fencer's capsules) is kept out, the cloth lying a few millimetres off it.
 *
 * What it gives back is where the cloth came to rest, for measuring: how stretched each edge is, how far each point
 * stands off the body, how far apart the seams still are.
 */
import type { Capsule } from '../fencer';
import type { Garment } from './draft';
import { type V } from '../v3';

export interface Settled { x: Float64Array; edges: { a: number; b: number; rest: number; dir: 'across' | 'along' | 'diag' | 'bend'; piece: number }[] }

export function settle(G: Garment, caps: Capsule[], o: { seconds?: number; thick?: number; sleeveCaps?: Capsule[]; passes?: number; gravity?: number; free?: boolean; body?: { at: (p: V) => { d: number; n: V } }; trunkBody?: { at: (p: V) => { d: number; n: V } } } = {}): Settled {
  const n = G.n, x = new Float64Array(n * 3), prev = new Float64Array(n * 3);
  G.at.forEach((p, i) => { x.set(p, i * 3); prev.set(p, i * 3); });
  const edges: Settled['edges'] = [];
  G.pieces.forEach((P, pi) => {
    const id = (r: number, c: number) => P.base + r * P.cols + c, rest = (a: number, b: number) => Math.hypot(G.flat[a][0] - G.flat[b][0], G.flat[a][1] - G.flat[b][1]);
    for (let r = 0; r < P.rows; r++) for (let c = 0; c < P.cols; c++) {
      const add = (r2: number, c2: number, dir: Settled['edges'][number]['dir']) => { if (r2 < P.rows && c2 >= 0 && c2 < P.cols) edges.push({ a: id(r, c), b: id(r2, c2), rest: rest(id(r, c), id(r2, c2)), dir, piece: pi }); };
      add(r, c + 1, 'across'); add(r + 1, c, 'along'); add(r + 1, c + 1, 'diag'); add(r + 1, c - 1, 'diag'); add(r + 2, c, 'bend'); add(r, c + 2, 'bend');
    }
  });
  // (the jacket's body goes round the trunk; its sleeves round the arms too, and the gussets under them)
  const isSleeve = new Uint8Array(n); G.pieces.forEach((pc) => { if (pc.kind !== 'body') isSleeve.fill(1, pc.base, pc.base + pc.rows * pc.cols); });
  const k = { across: 1, along: 1, diag: 0.5, bend: 0.12 };
  const STEP = 0.005;
  const h = 1 / 240, steps = Math.round((o.seconds ?? 6) / h), thick = o.thick ?? 0.004;
  const P = (i: number): V => [x[i * 3], x[i * 3 + 1], x[i * 3 + 2]];
  for (let s = 0; s < steps; s++) {
    // (the seams drawn closed gently, over two and a half seconds: pulled shut at once they fling the cloth)
    const seam = Math.min(1, (s * h) / 2.5);
    // inertia and gravity (damped hard: it's settling, not moving)
    for (let i = 0; i < n; i++) for (let a = 0; a < 3; a++) {
      const j = i * 3 + a, v = (x[j] - prev[j]) * 0.9;
      prev[j] = x[j]; x[j] += v + (a === 1 ? -(o.gravity ?? 9.81) * h * h : 0);
    }
    // (no point moves more than 5 mm a step, from where it was: much less than the thinnest part of the body, so the
    // cloth can't pass through it between one step and the next)
    for (let i = 0; i < n; i++) {
      const j = i * 3, dx = x[j] - prev[j], dy = x[j + 1] - prev[j + 1], dz = x[j + 2] - prev[j + 2], d = Math.hypot(dx, dy, dz);
      if (d > STEP) { const m = STEP / d; x[j] = prev[j] + dx * m; x[j + 1] = prev[j + 1] + dy * m; x[j + 2] = prev[j + 2] + dz * m; }
    }
    // (passes enough for stiff cloth to come to its lengths: off line, there's time)
    for (let it = 0; it < (o.passes ?? 10); it++) {
      for (const e of edges) {
        const a = e.a * 3, b = e.b * 3, dx = x[b] - x[a], dy = x[b + 1] - x[a + 1], dz = x[b + 2] - x[a + 2], l = Math.hypot(dx, dy, dz);
        if (l < 1e-9) continue;
        const c = (k[e.dir] * 0.5 * (l - e.rest)) / l;
        x[a] += dx * c; x[a + 1] += dy * c; x[a + 2] += dz * c; x[b] -= dx * c; x[b + 1] -= dy * c; x[b + 2] -= dz * c;
      }
      for (const st of G.stitches) {
        const p = st.p * 3, q = st.q * 3, q2 = st.q2 * 3;
        for (let a = 0; a < 3; a++) {
          const target = x[q + a] * (1 - st.t) + x[q2 + a] * st.t, d = (target - x[p + a]) * 0.5 * seam;
          x[p + a] += d; x[q + a] -= d * (1 - st.t); x[q2 + a] -= d * st.t;
        }
      }
      // (a tie pulls in only when it's taut: the crotch strap holding the hem to where it passes under the crotch)
      for (const tie of o.free ? [] : G.ties ?? []) {
        const a = tie.p * 3, dx = x[a] - tie.at[0], dy = x[a + 1] - tie.at[1], dz = x[a + 2] - tie.at[2], l = Math.hypot(dx, dy, dz);
        if (l > tie.len) { const m = tie.len / l; x[a] = tie.at[0] + dx * m; x[a + 1] = tie.at[1] + dy * m; x[a + 2] = tie.at[2] + dz * m; }
      }
      if (!o.free) for (const pn of G.pins ?? []) x.set(pn.at, pn.p * 3);
      // the body (look/body.ts): out of it, a little off it, the friction as below (the jacket's body out of the trunk
      // and thighs: an arm by the side is in its sleeve, outside the body of the jacket)
      if (o.body) { for (let i = 0; i < n; i++) {
        const j = i * 3, q = (isSleeve[i] || !o.trunkBody ? o.body : o.trunkBody).at([x[j], x[j + 1], x[j + 2]]);
        if (q.d >= thick) continue;
        const m = thick - q.d; x[j] += q.n[0] * m; x[j + 1] += q.n[1] * m; x[j + 2] += q.n[2] * m;
        prev[j] = prev[j] + (x[j] - prev[j]) * 0.3; prev[j + 1] = prev[j + 1] + (x[j + 1] - prev[j + 1]) * 0.3; prev[j + 2] = prev[j + 2] + (x[j + 2] - prev[j + 2]) * 0.3;
      } continue; }
      // the body: out of every capsule, a little off it
      for (let i = 0; i < n; i++) {
        const p = P(i);
        for (const c of (isSleeve[i] && o.sleeveCaps ? o.sleeveCaps : caps)) {
          const ab = [c.b[0] - c.a[0], c.b[1] - c.a[1], c.b[2] - c.a[2]], ap = [p[0] - c.a[0], p[1] - c.a[1], p[2] - c.a[2]];
          const t = Math.max(0, Math.min(1, (ab[0] * ap[0] + ab[1] * ap[1] + ab[2] * ap[2]) / Math.max(1e-12, ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2)));
          const cx = c.a[0] + ab[0] * t, cy = c.a[1] + ab[1] * t, cz = c.a[2] + ab[2] * t, R = c.ra + (c.rb - c.ra) * t + thick;
          const dx = p[0] - cx, dy = p[1] - cy, dz = p[2] - cz, d = Math.hypot(dx, dy, dz);
          if (d < R && d > 1e-9) {
            const m = R / d; p[0] = cx + dx * m; p[1] = cy + dy * m; p[2] = cz + dz * m;
            // (friction: in contact, most of this step's sliding along the body is taken back)
            const j = i * 3; prev[j] = prev[j] + (p[0] - prev[j]) * 0.3; prev[j + 1] = prev[j + 1] + (p[1] - prev[j + 1]) * 0.3; prev[j + 2] = prev[j + 2] + (p[2] - prev[j + 2]) * 0.3;
          }
        }
        x[i * 3] = p[0]; x[i * 3 + 1] = p[1]; x[i * 3 + 2] = p[2];
      }
    }
  }
  return { x, edges };
}
