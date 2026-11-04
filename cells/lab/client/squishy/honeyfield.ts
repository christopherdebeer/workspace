/**
 * Honey over a rim as one surface: a film of it, its thickness a field over the vessel (round it, and down it from
 * inside the neck, over the lip, down the side), so where a run leaves the reservoir, where two runs meet, where a
 * bead hangs at a run's end, it's all one skin of honey with one silhouette and smooth normals, not a collar, a sheet
 * and tubes laid over each other.
 *
 * The field: a reservoir over the lip, thicker where the honey's gathering into runs (and by the cork's lifted
 * side, where it's poured from); its hem scalloped, low under each run; and the runs, a few that matter and some
 * small ones round the back, each its own width, thickness and pace, creeping down as the level goes on. Most are
 * short tongues (about two in three), some medium runs, one in ten long; and each ends its own way: tapering away
 * to nothing, swelling into a rounded tongue, or necking into a bead. Each run's cross-section is a rounded rivulet
 * (an ellipse's top); they join the reservoir and each other with a smooth fillet (a smooth max), as surface tension
 * would have it.
 *
 * Each vertex carries how thick the honey is there (uv.x), so the drawing can take the light's path through it from
 * the honey itself (main.ts); uv.y is -1, to tell it from honey.ts's tubes.
 */
import { MAT, type V3 } from './level';
import { honeyDrops, type HoneyRim } from './honey';

const hash = (k: number, salt: number) => {
  let h = Math.imul(k * 7919 + salt * 104729, 2654435761) >>> 0;
  h = (h ^ (h >>> 15)) >>> 0; h = Math.imul(h, 2246822519) >>> 0; h = (h ^ (h >>> 13)) >>> 0;
  return (h % 100000) / 100000;
};
/** the larger of two, joined with a fillet `k` wide; none where either's nothing (no honey's no honey) */
const smax = (a: number, b: number, k: number) => {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.max(a, b) + ((h * h * k) / 4) * Math.min(1, Math.min(a, b) / (k * 0.5));
};
/** how far round from one angle to another (radians, 0–π) */
const round = (a: number, b: number) => Math.abs(((a - b + Math.PI * 3) % (Math.PI * 2)) - Math.PI);

type End = 'taper' | 'tongue' | 'bead';
interface Run { a: number; w: number; t: number; L: number; end: End; k: number }

/** The runs, at a time: where, how wide and thick, how far down, how each ends. */
function runs(rim: HoneyRim, run: number, H: number): Run[] {
  const { front, seed } = rim, out: Run[] = [];
  for (let k = 0; k < 11; k++) {
    const u = hash(k, seed + 3), main = k < 5;
    // (the ones that matter round the front, not evenly; the rest anywhere)
    const a = main ? front + (hash(k, seed) - 0.5) * 1.8 : front + Math.PI * 2 * hash(k, seed + 11);
    // (two in three short, a quarter medium, one in ten long)
    // (the main five: two short, two medium, one long, in an order of the pot's own; the rest short)
    const order = [0, 0, 1, 1, 2], pick = Math.floor(hash(0, seed + 13) * 5);
    const kind = main ? order[(k + pick) % 5] : 0;
    void u;
    const target = kind === 0 ? 1 + 2.2 * hash(k, seed + 5) : kind === 1 ? H * (0.3 + 0.15 * hash(k, seed + 5)) : H * (0.6 + 0.12 * hash(k, seed + 5));
    const tau = 50 + 150 * hash(k, seed + 4), L0 = Math.min(target, 0.6 + 1.2 * hash(k, seed + 1));
    const L = L0 + (target - L0) * (1 - Math.exp(-run / tau));
    const w = main ? 0.65 + 0.6 * hash(k, seed + 2) : 0.3 + 0.3 * hash(k, seed + 2);
    const e = hash(k, seed + 6);
    const end: End = kind === 0 ? (e < 0.6 ? 'tongue' : 'taper') : kind === 1 ? (e < 0.5 ? 'bead' : e < 0.8 ? 'tongue' : 'taper') : e < 0.6 ? 'bead' : 'taper';
    out.push({ a, w, t: w * (0.6 + 0.25 * hash(k, seed + 7)), L, end, k });
  }
  return out;
}

/** The vessel's section, from inside its neck, over its lip, down its side: (r, y) and the outward normal, by arc length. */
function section(rim: HoneyRim, below: number) {
  const { top, side } = rim, lip = rim.lip ?? 0, pts: Array<{ r: number; y: number; nr: number; ny: number }> = [];
  if (lip > 0) {
    // (over the rolled lip, from just inside the neck)
    const r0 = side(top);
    for (let i = 0; i <= 14; i++) {
      const ph = Math.PI * (1.15 - (1.4 * i) / 14);
      pts.push({ r: r0 + lip * Math.cos(ph), y: top + lip * Math.sin(ph), nr: Math.cos(ph), ny: Math.sin(ph) });
    }
  }
  const y0 = lip > 0 ? top - lip * 0.8 : top;
  for (let y = y0; y >= y0 - below; y -= 0.15) {
    const dr = (side(y + 0.05) - side(y - 0.05)) / 0.1, l = Math.hypot(1, dr);
    pts.push({ r: side(y), y, nr: 1 / l, ny: -dr / l });
  }
  // (arc length, 0 where the side begins: negative over the lip)
  const at = lip > 0 ? 15 : 0, s: number[] = [0];
  for (let i = 1; i < pts.length; i++) s.push(s[i - 1] + Math.hypot(pts[i].r - pts[i - 1].r, pts[i].y - pts[i - 1].y));
  const s0 = s[at];
  return pts.map((p, i) => ({ ...p, s: s[i] - s0 }));
}

/** All of it for one rim, at `run` seconds in, onto `out`. */
export function honeyField(rim: HoneyRim, run: number, out: number[]) {
  const { c, top, foot, front, seed } = rim, H = top - foot - 0.6;
  const rs = runs(rim, run, H);
  const reach = Math.max(...rs.map((r) => r.L)) + 1.5;
  const sec = section(rim, Math.min(H, reach));
  const lift = front + 2.2;
  // (where the honey's gathering into runs, round the rim: 0–1; and a little more by the cork's lifted side)
  const gather = (th: number) => {
    let g = 0.35 * Math.exp(-((round(th, lift) / 0.5) ** 2));
    for (const r of rs) g += (r.w / 1.2) * Math.exp(-(((round(th, r.a) * rim.side(top)) / (r.w * 2.2 + 0.8)) ** 2));
    return Math.min(1, g);
  };
  const field = (th: number, s: number, g: number, R: number) => {
    // (the reservoir: over the lip, thicker where it's gathering; its hem lower under the runs, rounded)
    const res = 0.2 + 0.4 * g, hem = 0.35 + 1.5 * g ** 0.8, e = 0.45;
    let h = s < hem - e ? res : res * Math.sqrt(Math.max(0, 1 - ((s - (hem - e)) / e) ** 2));
    for (const r of rs) {
      if (s < -0.2 || s > r.L + r.w * 2) continue;
      if (round(th, r.a) * R > r.w * 3.2) continue;
      const centre = r.a + (0.05 * Math.sin(s * 0.7 + r.k) * r.w) / Math.max(R, 1), dx = round(th, centre) * R;
      if (dx > r.w * 3) continue;
      const f = Math.min(1, Math.max(0, s / Math.max(r.L, 0.5)));
      let w = r.w, t = r.t, len = r.L;
      if (r.end === 'taper') { w *= 1 - 0.55 * f; t *= 1 - f * f; }
      else if (r.end === 'tongue') { w *= 1 + 0.25 * f; t *= 1 + 0.25 * f; }
      else { w *= 0.7; t *= 0.7; len = r.L - r.w * 1.2; }
      // (a rounded end: its last stretch closing as an ellipse's quarter)
      const cap = r.end === 'taper' ? 1 : Math.sqrt(Math.max(0, 1 - Math.max(0, (s - (len - w)) / w) ** 2));
      // (a rivulet's section: rounded over the top, meeting the side at a shallow angle, as honey wets glaze)
      const q = Math.max(0, 1 - (dx / w) ** 2);
      let hr = s > len ? 0 : t * cap * q * (1.2 - 0.2 * q);
      if (r.end === 'bead') {
        // (a bead: a rounded swelling of it at the end, hanging off the run's narrowed neck)
        const rb = r.w * 1.15, sb = r.L - rb, d2 = dx * dx + (s - sb) * (s - sb);
        hr = smax(hr, rb * 0.95 * Math.sqrt(Math.max(0, 1 - d2 / (rb * rb))), 0.25);
      }
      h = smax(h, hr, 0.18);
    }
    return h;
  };

  const N = 300, M = sec.length, P: V3[][] = [], Hh: number[][] = [];
  const gs = Array.from({ length: N }, (_, i) => gather((i / N) * Math.PI * 2));
  for (let j = 0; j < M; j++) {
    const q = sec[j], row: V3[] = [], hr: number[] = [];
    for (let i = 0; i < N; i++) {
      const th = (i / N) * Math.PI * 2, cx = Math.cos(th), cz = Math.sin(th);
      const h = field(th, q.s, gs[i], q.r), lift2 = h + 0.015;
      row.push([c[0] + cx * (q.r + q.nr * lift2), q.y + q.ny * lift2, c[2] + cz * (q.r + q.nr * lift2)]);
      hr.push(h);
    }
    P.push(row); Hh.push(hr);
  }
  // (normals from the surface itself, across and down it; outward)
  const nrm = (i: number, j: number): V3 => {
    const a = P[j][(i + 1) % N], b = P[j][(i + N - 1) % N], u = P[Math.min(M - 1, j + 1)][i], d = P[Math.max(0, j - 1)][i];
    const tx = [a[0] - b[0], a[1] - b[1], a[2] - b[2]], ty = [u[0] - d[0], u[1] - d[1], u[2] - d[2]];
    let n: V3 = [tx[1] * ty[2] - tx[2] * ty[1], tx[2] * ty[0] - tx[0] * ty[2], tx[0] * ty[1] - tx[1] * ty[0]];
    const th = (i / N) * Math.PI * 2, out2: V3 = [Math.cos(th) * sec[j].nr, sec[j].ny, Math.sin(th) * sec[j].nr];
    if (n[0] * out2[0] + n[1] * out2[1] + n[2] * out2[2] < 0) n = [-n[0], -n[1], -n[2]];
    const l = Math.hypot(n[0], n[1], n[2]) || 1;
    return [n[0] / l, n[1] / l, n[2] / l];
  };
  // (each point's normal once, where there's honey near it)
  const NR: Array<Array<V3 | null>> = P.map((row) => row.map(() => null));
  const put = (i: number, j: number) => {
    const ii = i % N, p = P[j][ii], n = NR[j][ii] ?? (NR[j][ii] = nrm(ii, j));
    out.push(p[0], p[1], p[2], n[0], n[1], n[2], MAT.honeyDrip, Hh[j][i % N], -1);
  };
  for (let j = 0; j + 1 < M; j++) for (let i = 0; i < N; i++) {
    const i1 = i + 1;
    // (only where there's honey: a quad with none at any corner isn't drawn)
    if (Math.max(Hh[j][i], Hh[j][i1 % N], Hh[j + 1][i], Hh[j + 1][i1 % N]) < 0.02) continue;
    // (wound to face out, along its normals: the drawing flips what it sees from behind)
    const a = P[j][i], b = P[j][i1 % N], d = P[j + 1][i], n = NR[j][i] ?? (NR[j][i] = nrm(i, j));
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [d[0] - a[0], d[1] - a[1], d[2] - a[2]];
    const outward = (e1[1] * e2[2] - e1[2] * e2[1]) * n[0] + (e1[2] * e2[0] - e1[0] * e2[2]) * n[1] + (e1[0] * e2[1] - e1[1] * e2[0]) * n[2] > 0;
    if (outward) { put(i, j); put(i1, j); put(i1, j + 1); put(i, j); put(i1, j + 1); put(i, j + 1); }
    else { put(i, j); put(i, j + 1); put(i1, j + 1); put(i, j); put(i1, j + 1); put(i1, j); }
  }
  honeyDrops(rim, out);
  void top;
}
