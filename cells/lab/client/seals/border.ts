/**
 * A card's border, from sparse to dense on one dial (`bDensity`), as the reference frames run:
 *
 * - **sparse** (the default end): a double rule broken at the top by a crest (a compass or a
 *   target) and at the foot by a lozenge; in each corner a star (or the suit's crescent), a
 *   quarter arc with a dashed echo, and a pendant of ring and lozenge; rails from the corners
 *   toward the crest, punctuated with dots and sparkles; down each side a chain of segments
 *   strung with rings, dots, stars and lozenges; short rails either side of the caption;
 * - **dense**: more rules with beads between; open medallions in the corners with fans of rays
 *   on their inner side; an arched window whose corners curve round the medallions; the crest
 *   carrying the suit's motif with scroll wings; pendants hanging from the window; a medallion
 *   at the middle of each side; a cartouche round the caption.
 *
 * Mirrored left to right; the top (crest) and the foot (lozenge, caption) differ. Every element
 * sizes itself to the words and the seal it sits beside (their zones), and the whole border is
 * clipped clear of them, so nothing crosses a label. Card millimetres; pure; seeded.
 */
import { hash, seeded } from '../kit/rng';
import { sdf, sdfAll, type Pt, type Shape } from './field';
import { accentW, f, glyph, pol, pt, type Mark } from './ornament';
import type { Style } from './styles';

export interface BorderLayout {
  /** the title's baseline and half-width; the caption's (the summary line), if any */
  title: { y: number; hw: number; size: number };
  caption: { y: number; hw: number; size: number } | null;
  /** the seal's centre and reach */
  seal: { c: Pt; r: number };
  /** every zone the border keeps clear of */
  zones: Shape[];
}

const CW = 63, CH = 88, MX = CW / 2;
const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

export function cardBorder(s: Style, seed: number, L: BorderLayout): { marks: Mark[]; clip: string } {
  const out: Mark[] = [];
  /** 'corners': the rules, the crest, the foot and the corners only */
  const full = s.border !== 'corners';
  const d = clamp(s.bDensity, 0, 1);
  const r = seeded(hash(seed, 0xb0d3));
  const W = s.weight * 0.45;
  const ink = (dd: string, w = W, fill: 'none' | 'ink' | 'paper' = 'none') => { if (dd) out.push({ k: 'path', d: dd, w, fill, layer: 'ground' }); };
  const circ = (c: Pt, rr: number, w: number, fill: 'none' | 'ink' | 'paper' = 'none') => out.push({ k: 'circle', x: f(c[0]), y: f(c[1]), r: f(rr), w, fill, layer: 'ground' });
  const poly = (ps: Pt[]) => ps.map((p, i) => `${i ? 'L' : 'M'}${pt(p)}`).join('');
  const arcPts = (c: Pt, rr: number, a0: number, a1: number, n = 28): Pt[] => Array.from({ length: n + 1 }, (_, i) => { const q = pol(rr, a0 + ((a1 - a0) * i) / n); return [c[0] + q[0], c[1] + q[1]] as Pt; });
  // the marks that punctuate rails and chains
  const dot = (c: Pt, rr = 0.32) => circ(c, rr, 0, 'ink');
  const ring = (c: Pt, rr = 0.7) => circ(c, rr, W * 0.9, 'paper');
  const lozenge = (c: Pt, h = 1.1, fill: 'paper' | 'ink' = 'paper') => ink(`M${pt([c[0], c[1] - h])}L${pt([c[0] + h * 0.6, c[1]])}L${pt([c[0], c[1] + h])}L${pt([c[0] - h * 0.6, c[1]])}Z`, W * 0.9, fill);
  const star4 = (c: Pt, sz: number, a = 0) => ink(glyph('star', c, sz, a), 0, 'ink');
  const star8 = (c: Pt, sz: number) => { star4(c, sz); star4(c, sz * 0.55, 45); };
  const motif = (c: Pt, sz: number, a = 0) => ink(glyph(s.motif, c, sz, a), W * 0.8, s.motifFill ? 'ink' : 'paper');
  /** a node on a chain or rail: its kind, drawn; returns the half-length it takes up */
  type Kind = 'dot' | 'ring' | 'star4' | 'star8' | 'lozenge' | 'motif' | 'pair';
  const node = (k: Kind, c: Pt, scale = 1, along: 'x' | 'y' = 'y'): number => {
    switch (k) {
      case 'dot': dot(c, 0.34 * scale); return 0.6 * scale;
      case 'ring': ring(c, 0.7 * scale); return 1.0 * scale;
      case 'star4': star4(c, 1.25 * scale, along === 'x' ? 0 : 0); return 1.2 * scale;
      case 'star8': star8(c, 1.35 * scale); return 1.3 * scale;
      case 'lozenge': lozenge(c, 1.1 * scale); return 1.2 * scale;
      case 'motif': motif(c, 0.95 * scale); return 1.2 * scale;
      case 'pair': { const o = along === 'x' ? [0.55, 0] : [0, 0.55]; dot([c[0] - o[0], c[1] - o[1]], 0.26); dot([c[0] + o[0], c[1] + o[1]], 0.26); return 1.0; }
    }
  };
  const VOCAB: Kind[] = ['ring', 'dot', 'star8', 'lozenge', 'pair', 'star4'];
  const pick = (): Kind => VOCAB[Math.floor(r() * VOCAB.length)];
  /** room for an element at c: its distance to the nearest zone */
  const room = (c: Pt) => sdfAll(L.zones, c);

  // ── the rules ────────────────────────────────────────────────────────────────────────────
  const n = Math.round(clamp(s.bRules + d * 2, 1, 5));
  const gap = 0.8, inner = 2.4 + (n - 1) * gap;
  const ruleY = 2.4 + ((n - 1) * gap) / 2;
  // the crest's size: as large as the density asks, no lower than the title allows
  const titleTop = L.title.y - L.title.size * 0.95;
  let cr = (2.0 + d * 3.2) * s.bCrestSize;
  cr = Math.max(1.4, Math.min(cr, (titleTop - ruleY - 0.8) / 1.25));
  const gTop = cr * 1.2 + 0.6, lz = 1.0 + d * 1.2, gBot = lz * 0.6 + 0.9;
  for (let i = 0; i < n; i++) {
    const ins = 2.4 + i * gap, rx = Math.max(0.6, 2.2 - i * 0.5), x0 = ins, y0 = ins, x1 = CW - ins, y1 = CH - ins;
    const g = gTop, gb = gBot;
    const dd = `M${f(MX + g)} ${f(y0)}H${f(x1 - rx)}A${f(rx)} ${f(rx)} 0 0 1 ${f(x1)} ${f(y0 + rx)}V${f(y1 - rx)}A${f(rx)} ${f(rx)} 0 0 1 ${f(x1 - rx)} ${f(y1)}H${f(MX + gb)}M${f(MX - gb)} ${f(y1)}H${f(x0 + rx)}A${f(rx)} ${f(rx)} 0 0 1 ${f(x0)} ${f(y1 - rx)}V${f(y0 + rx)}A${f(rx)} ${f(rx)} 0 0 1 ${f(x0 + rx)} ${f(y0)}H${f(MX - g)}`;
    ink(dd, i === 0 ? accentW(W, 1.7, s.accent) : W * (i % 2 ? 0.6 : 0.85));
  }
  // beads between the outer two rules, at the denser end
  if (d > 0.35 && n >= 2) {
    const ins = 2.4 + gap / 2, sp = 2.2 - d;
    let dd = '';
    for (const [a, b] of [[[ins + 4, ins], [MX - gTop - 1, ins]], [[MX + gTop + 1, ins], [CW - ins - 4, ins]], [[ins, ins + 4], [ins, CH - ins - 4]], [[CW - ins, ins + 4], [CW - ins, CH - ins - 4]], [[ins + 4, CH - ins], [MX - gBot - 1, CH - ins]], [[MX + gBot + 1, CH - ins], [CW - ins - 4, CH - ins]]] as Array<[Pt, Pt]>) {
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]), k = Math.floor(len / sp);
      for (let i = 0; i <= k; i++) { const t = i / Math.max(1, k), c: Pt = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]; dd += `M${f(c[0] - 0.16)} ${f(c[1])}a.16 .16 0 1 0 .32 0a.16 .16 0 1 0 -.32 0`; }
    }
    ink(dd, 0, 'ink');
  }

  // ── the crest, on the rules at the top ─────────────────────────────────────────────────
  const C: Pt = [MX, ruleY];
  const kind = s.bCrest;
  const r1 = cr * 0.62;
  ink(`M${pt([MX, ruleY - r1 - 0.2])}L${pt([MX, 1.1])}`, W * 0.7); dot([MX, 1.1], 0.3);
  ink(`M${pt([MX - gTop + 0.2, ruleY])}L${pt([MX - r1, ruleY])}M${pt([MX + r1, ruleY])}L${pt([MX + gTop - 0.2, ruleY])}`, W * 0.7);
  dot([MX - gTop + 0.1, ruleY], 0.32); dot([MX + gTop - 0.1, ruleY], 0.32);
  if (kind === 'compass') star4(C, cr * 1.15);
  else for (const a of [0, 90, 180, 270]) { const p0 = pol(r1, a), p1 = pol(cr * 1.2, a); ink(`M${pt([MX + p0[0], ruleY + p0[1]])}L${pt([MX + p1[0], ruleY + p1[1]])}`, W * 0.8); }
  circ(C, r1, accentW(W, 1.2, s.accent), 'paper');
  circ(C, r1 * 0.7, W * 0.5);
  if (d > 0.5) motif(C, r1 * 0.45); else circ(C, r1 * 0.38, 0, 'ink');
  if (kind === 'target') circ(C, cr * 0.95, W * 0.45);
  // scroll wings, at the dense end
  if (d > 0.6) for (const sx of [-1, 1]) {
    const ps: Pt[] = [];
    const len = 3 + 6 * (d - 0.6) / 0.4;
    for (let t = 0; t <= 1.0001; t += 1 / 30) ps.push([MX + sx * (r1 + 0.4 + len * t), ruleY + 0.9 + Math.sin(t * Math.PI) * 1.3]);
    const end = ps[ps.length - 1];
    for (let t = 0; t <= 1.0001; t += 1 / 20) { const a = Math.PI * 1.6 * t, rr = 1.1 * (1 - 0.7 * t); ps.push([end[0] + sx * (rr * Math.sin(a)), end[1] - 1.1 + rr * Math.cos(a)]); }
    ink(poly(ps), W * 0.8);
  }

  // ── the foot: a lozenge on the rules ───────────────────────────────────────────────────
  const footY = CH - ruleY;
  lozenge([MX, footY], lz, 'paper'); dot([MX, footY], lz * 0.25);
  dot([MX - gBot + 0.1, footY], 0.3); dot([MX + gBot - 0.1, footY], 0.3);

  // ── the corners ────────────────────────────────────────────────────────────────────────
  // (drawn top-left, mirrored to the others: the medallion's size is the least room any corner has)
  const corners: Array<{ m: (p: Pt) => Pt; out: number }> = [
    { m: (p) => p, out: 315 }, { m: (p) => [CW - p[0], p[1]], out: 45 },
    { m: (p) => [p[0], CH - p[1]], out: 225 }, { m: (p) => [CW - p[0], CH - p[1]], out: 135 },
  ];
  const O: Pt = [inner, inner];
  const ca = (5.0 + d * 4) * s.bCornerSize;
  const medal = d > 0.4;
  const want = medal ? (2.2 + 7 * (d - 0.4) / 0.6) * s.bCornerSize : 0;
  // (as large as asked, but clear of every zone: the largest that fits, by halving — the top
  // pair and the foot pair each their own size, since the card's top and foot differ)
  const fitFor = (cs: typeof corners) => {
    if (!medal) return 0;
    const fits = (rr: number) => cs.every((c) => room(c.m([inner + rr + 0.6, inner + rr + 0.6])) - 0.8 >= rr);
    if (fits(want)) return want;
    let lo = 0, hi = want;
    for (let it = 0; it < 18; it++) { const mid = (lo + hi) / 2; if (fits(mid)) lo = mid; else hi = mid; }
    return lo;
  };
  const geomOf = (cm: number) => { const M: Pt = [inner + cm + 0.6, inner + cm + 0.6]; return { cm, M, reach: medal && cm > 1.2 ? M[0] + cm + 0.8 : inner + ca * 0.75 }; };
  const top = geomOf(fitFor(corners.slice(0, 2))), foot = geomOf(fitFor(corners.slice(2)));
  const glyphAt: Pt = [inner + 2.3, inner + 2.3];
  for (const [ci, c] of corners.entries()) {
    const m = c.m, P = (q: Pt) => m(q);
    const { cm, M, reach } = ci < 2 ? top : foot;
    // the glyph in the corner
    const g = P(glyphAt), gs = 1.6 + d * 1.0;
    // (a medallion fills the corner: the glyph gives way to a small ring on the rules)
    if (cm > 2.5) { const q = P([inner - (n - 1) * gap / 2 + 0.25, inner - (n - 1) * gap / 2 + 0.25]); ring(q, 0.55); dot(q, 0.2); }
    else if (s.bCorner === 'crescent') ink(glyph('crescent', g, gs * 0.85, c.out), 0, 'ink');
    else if (s.bCorner === 'motif') motif(g, gs * 0.75, c.out + 180);
    else if (s.bCorner === 'ring') { ring(g, gs * 0.55); dot(g, gs * 0.2); }
    else star8(g, gs);
    // the quarter arc (and a dashed echo, at the sparse end)
    if (cm <= 1.2 || d < 0.75) {
      ink(poly(arcPts(O, ca, 98, 172).map(P)), W * 0.9);
      if (d < 0.55) out.push({ k: 'path', d: poly(arcPts(O, ca + 1.5, 108, 162).map(P)), w: W * 0.5, fill: 'none', dash: '.5 .6', layer: 'ground' });
    }
    // the medallion, its rings, and a fan of rays on its inner side
    if (cm > 1.2) {
      const mc = P(M);
      circ(mc, cm, accentW(W, 1.1, s.accent));
      circ(mc, cm - 0.55, W * 0.45);
      if (d > 0.55 && cm > 2.5) {
        const span = 30 + 40 * d, step = 5.5 - 3 * d;
        let rays = '';
        for (let a = 135 - span; a <= 135 + span + 1e-6; a += step) {
          const len = (0.8 + 2.4 * d) * (1 - 0.65 * Math.abs(a - 135) / span) * (0.8 + 0.4 * r());
          const a0 = M[0] + pol(cm + 0.4, a)[0], b0 = M[1] + pol(cm + 0.4, a)[1], a1 = M[0] + pol(cm + 0.4 + len, a)[0], b1 = M[1] + pol(cm + 0.4 + len, a)[1];
          rays += `M${pt(P([a0, b0]))}L${pt(P([a1, b1]))}`;
        }
        ink(rays, W * 0.45);
      }
      // beads on the medallion's ring
      let beads = '';
      const nb = 12 + Math.round(d * 12);
      for (let i = 0; i < nb; i++) { const q = P([M[0] + pol(cm - 0.28, (i * 360) / nb)[0], M[1] + pol(cm - 0.28, (i * 360) / nb)[1]]); beads += `M${f(q[0] - 0.13)} ${f(q[1])}a.13 .13 0 1 0 .26 0a.13 .13 0 1 0 -.26 0`; }
      ink(beads, 0, 'ink');
    }
    // the pendant down the side: ring, lozenge, dot
    const px = inner + 1.9, py = reach + 1.2;
    ink(poly([P([px, py - 0.8]), P([px, py + 0.2])]), W * 0.6);
    ring(P([px, py + 0.9]), 0.65);
    ink(poly([P([px, py + 1.6]), P([px, py + 2.3])]), W * 0.6);
    lozenge(P([px, py + 3.5]), 1.1);
    dot(P([px, py + 5.1]), 0.3);
  }

  // ── the rails along the top, from each corner toward the crest ────────────────────────
  const railY = inner + 1.9, xs = top.reach + 0.6, xe = MX - gTop - 1.2, xsF = foot.reach + 0.6;
  if (full && xe - xs > 4) {
    const marks: Array<{ t: number; k: Kind }> = [];
    const count = 1 + Math.round(d * 3);
    for (let i = 0; i < count; i++) marks.push({ t: (i + 0.5 + (r() - 0.5) * 0.4) / count, k: pick() });
    for (const sx of [1, -1]) {
      const X = (x: number) => (sx > 0 ? x : CW - x);
      // the rail, broken round each mark
      const stops = marks.map((mk) => ({ x: xs + (xe - xs) * mk.t, k: mk.k })).sort((a, b) => a.x - b.x);
      let x = xs + 0.6, dd = '';
      for (const st of stops) { const h = node(st.k, [X(st.x), railY], 0.9, 'x'); if (st.x - h - x > 0.5) dd += `M${pt([X(x), railY])}L${pt([X(st.x - h - 0.3), railY])}`; x = st.x + h + 0.3; }
      if (xe - 1.3 - x > 0.5) dd += `M${pt([X(x), railY])}L${pt([X(xe - 1.3), railY])}`;
      ink(dd, W * 0.75);
      dot([X(xs), railY], 0.3);
      star4([X(xe), railY], 1.2);
      // at the foot, a short rail from each corner
      const fy = CH - railY, fe = xsF + Math.min(8, (xe - xsF) * 0.4);
      if (fe - xsF > 2.5) { ink(`M${pt([X(xsF + 0.6), fy])}L${pt([X(fe - 1.2), fy])}`, W * 0.75); dot([X(xsF), fy], 0.3); star4([X(fe), fy], 0.9); }
    }
  }

  // ── the chains down each side ─────────────────────────────────────────────────────────
  const chainX = inner + 1.9, y0 = top.reach + 8.5, y1 = CH - (foot.reach + 8.5);
  if (full && y1 - y0 > 10) {
    const K = 5 + 2 * Math.round(d * 2); // (odd: there is a middle)
    const half = Math.floor(K / 2);
    const kinds: Kind[] = Array.from({ length: half }, () => pick());
    const ys = Array.from({ length: K }, (_, i) => y0 + ((y1 - y0) * i) / (K - 1));
    const jit = ys.map((_, i) => (i === 0 || i === K - 1 || i === half ? 0 : (r() - 0.5) * (y1 - y0) / (K - 1) * 0.3));
    for (const sx of [1, -1]) {
      const X = sx > 0 ? chainX : CW - chainX;
      const at = ys.map((y, i) => (i < half ? y + jit[i] : i > half ? y - jit[K - 1 - i] : y));
      const hs: number[] = [];
      at.forEach((y, i) => {
        const j = i <= half ? i : K - 1 - i;
        if (i === half) {
          // the middle: a medallion with the suit's motif at the dense end, a star at the sparse
          const roomR = room([X, y]) - 0.6;
          if (d > 0.55 && roomR > 1.6) { const mr = Math.min(1.4 + 2.4 * d, roomR); circ([X, y], mr, accentW(W, 1, s.accent), 'paper'); circ([X, y], mr * 0.78, W * 0.4); motif([X, y], mr * 0.5); hs.push(mr + 0.2); }
          else hs.push(node('star8', [X, y], 1.1));
        } else hs.push(node(j === 0 ? 'dot' : kinds[j - 1] ?? 'ring', [X, y], 0.95));
      });
      let dd = '';
      for (let i = 0; i < K - 1; i++) {
        const a = at[i] + hs[i] + 0.35, b = at[i + 1] - hs[i + 1] - 0.35;
        if (b - a > 0.6) { dd += `M${pt([X, a])}L${pt([X, b])}`; dot([X, a + 0.25], 0.18); dot([X, b - 0.25], 0.18); }
      }
      ink(dd, W * 0.75);
    }
  }

  // ── the window: an arched inner line round the corner medallions (dense) ─────────────
  if (full && d > 0.45) {
    const wI = inner + 3.7;
    const topGap = L.title.hw + 2, footGap = L.caption ? L.caption.hw + 3.5 : 3;
    const quarter = ({ cm, M }: { cm: number; M: Pt }, gapX: number): Pt[] => {
      const rw = cm + 1.3, seg: Pt[] = [[MX - gapX, wI]];
      if (cm > 1.2 && Math.abs(wI - M[1]) < rw && Math.abs(wI - M[0]) < rw) {
        const xi = M[0] + Math.sqrt(rw * rw - (wI - M[1]) ** 2), yi = M[1] + Math.sqrt(rw * rw - (wI - M[0]) ** 2);
        const aTop = (Math.atan2(xi - M[0], -(wI - M[1])) * 180) / Math.PI, aSide = (Math.atan2(wI - M[0], -(yi - M[1])) * 180) / Math.PI;
        seg.push([xi, wI], ...arcPts(M, rw, aTop, aSide < aTop ? aSide + 360 : aSide, 24).slice(1), [wI, yi]);
      } else seg.push(...arcPts([wI + 2, wI + 2], 2, 0, -90, 8));
      seg.push([wI, CH / 2]);
      return seg;
    };
    const qTop = quarter(top, topGap), qFoot = quarter(foot, footGap);
    corners.forEach((c, ci) => ink(poly((ci < 2 ? qTop : qFoot).map(c.m)), W * 0.85));
    // pendants hanging from the top of the window, either side of the title
    if (d > 0.7) for (const sx of [-1, 1]) {
      // (between the title and the corner medallion: skip it if there is no room)
      const x = MX + sx * (topGap + 2.2), y = wI;
      const medalEdge = top.cm > 1.2 ? top.M[0] + top.cm + 1.6 : 0;
      if (Math.abs(x - MX) > MX - medalEdge - 1 || room([x, y + 3]) < 1) continue;
      ink(`M${pt([x, y])}L${pt([x, y + 2.2])}`, W * 0.6);
      lozenge([x, y + 3.4], 0.9, 'ink');
      dot([x, y + 4.8], 0.26);
    }
  }

  // ── the caption: rails either side of it, a short rail beneath; a cartouche when dense ─
  if (full && L.caption) {
    const cy = L.caption.y - L.caption.size * 0.36, hw = L.caption.hw;
    if (d > 0.5) {
      const ch = L.caption.size * 0.95, cw = hw + 2.2;
      const box = (w: number, h: number) => `M${f(MX - w + h)} ${f(cy - h)}H${f(MX + w - h)}A${f(h)} ${f(h)} 0 0 1 ${f(MX + w - h)} ${f(cy + h)}H${f(MX - w + h)}A${f(h)} ${f(h)} 0 0 1 ${f(MX - w + h)} ${f(cy - h)}Z`;
      ink(box(cw, ch), accentW(W, 1, s.accent));
      ink(box(cw - 0.5, ch - 0.5), W * 0.45);
      lozenge([MX - cw - 1.2, cy], 0.9, 'ink'); lozenge([MX + cw + 1.2, cy], 0.9, 'ink');
    } else {
      const a = hw + 1.4, len = Math.min(MX - a - inner - 4, 4 + d * 5);
      if (len > 1.5) for (const sx of [-1, 1]) {
        ink(`M${pt([MX + sx * a, cy])}L${pt([MX + sx * (a + len - 1.4), cy])}`, W * 0.75);
        dot([MX + sx * (a - 0.2), cy], 0.24); dot([MX + sx * (a + 0.5), cy], 0.24);
        star4([MX + sx * (a + len), cy], 1.15);
      }
      const by = cy + L.caption.size * 0.95 + 0.9, bl = hw * 0.55;
      if (by < CH - inner - 1.2) { ink(`M${pt([MX - bl, by])}L${pt([MX + bl, by])}`, W * 0.6); star4([MX - bl - 0.6, by], 0.75); star4([MX + bl + 0.6, by], 0.75); }
    }
  }

  // the clip: the card, less every zone (even–odd), so no line crosses a label or the seal
  const holes = L.zones.map((z) => zoneOutline(z)).filter(Boolean).join('');
  return { marks: out, clip: `M0 0H${CW}V${CH}H0Z${holes}` };
}

/** a zone's outline as a closed subpath (boxes and circles, grown) */
function zoneOutline(z: Shape, by = 0): string {
  if (z.k === 'grow') return zoneOutline(z.s, by + z.by);
  if (z.k === 'circle') { const rr = z.r + by; return `M${f(z.c[0] - rr)} ${f(z.c[1])}a${f(rr)} ${f(rr)} 0 1 0 ${f(2 * rr)} 0a${f(rr)} ${f(rr)} 0 1 0 ${f(-2 * rr)} 0Z`; }
  if (z.k === 'box') {
    const hw = z.hw + by, hh = z.hh + by, rx = Math.min((z.rx ?? 0) + by, hw, hh);
    const [cx, cy] = z.c;
    return `M${f(cx - hw + rx)} ${f(cy - hh)}H${f(cx + hw - rx)}A${f(rx)} ${f(rx)} 0 0 1 ${f(cx + hw)} ${f(cy - hh + rx)}V${f(cy + hh - rx)}A${f(rx)} ${f(rx)} 0 0 1 ${f(cx + hw - rx)} ${f(cy + hh)}H${f(cx - hw + rx)}A${f(rx)} ${f(rx)} 0 0 1 ${f(cx - hw)} ${f(cy + hh - rx)}V${f(cy - hh + rx)}A${f(rx)} ${f(rx)} 0 0 1 ${f(cx - hw + rx)} ${f(cy - hh)}Z`;
  }
  return '';
}
void sdf;
