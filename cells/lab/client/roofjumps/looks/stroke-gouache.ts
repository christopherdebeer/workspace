/**
 * Stroke gouache: the city and the runner in opaque, chalky gouache, every visible mark a brush stroke (strokes.ts),
 * the paint put where it does the most work. The light is the frame's (a time of day, menu.ts, or the look's own day):
 * at dusk, lit planes take the warm low horizon and every shadow one deep cool from the sky; at noon, as the deployed
 * gouache.
 *
 *   sky      one continuous field, deep above, warm only in a narrow band at the horizon (strokes.ts), and a few broad,
 *            quiet, close-valued pulls over it
 *   planes   each first underpainted flat in its mass (lit or shade), so no paper shows at its edges; far off, that is
 *            all (the skyline gathers into masses in the haze). Near: a wall dragged down in a few broad strokes from its
 *            top, two pigments in the brush, the exit drying out, a weathering streak or two from under the coping; a roof
 *            pulled across. The roof a picture leads to (the menu's first landing, `light.focus`) warm
 *   shadow   one passage on each lit plane, masked by its real shadow from the sun's map, its edge broken by the brush: the
 *            buildings' shadows on each other and the runner's (and the line's) whole, as shapes
 *   lips     every lip a hand can catch keeps a dark line on the roof; the full coping (a loaded band, its shadow under it)
 *            only near, where a hand might use it
 *   runner   masses and limbs in pulls, a lit pull on the sun's side, a dark under-stroke; a hand dab (closed and darker on
 *            a hold); the bearing shoe loaded, a small dark contact under it
 */
import type { LookDef } from '../looks';
import type { Box, Detail } from '../city';
import { TAG } from '../city';
import { DRESS } from '../dressing';
import type { Light, Mark, StrokeRules, V } from '../strokes';
import { EDGE, K, LAYER, add, boxSeed, cross, dot, lipsOf, mix, onLine, planesOf, rng, scale, smooth, sub, unit, hashKey } from '../strokes';

const DAY_SUN: V = [-0.55, 0.6, 0.58];
const WARM: V = [0.64, 0.62, 0.58], GREEN: V = [0.57, 0.61, 0.6], COOL: V = [0.6, 0.61, 0.63], TERRA: V = [0.67, 0.55, 0.51];
const concrete = (s: number): V => (s < 0.4 ? mix(WARM, COOL, s / 0.4) : s < 0.9 ? mix(COOL, GREEN, (s - 0.4) / 0.5) : mix(WARM, TERRA, 0.7));
const mulv = (a: V, b: V): V => [a[0] * b[0], a[1] * b[1], a[2] * b[2]];
const baseOf = (b: Box | null): V => {
  if (!b) return [0.36, 0.37, 0.41];
  switch (b.tag) {
    case TAG.UNIT: return [0.55, 0.58, 0.6];
    case TAG.TANK: return [0.5, 0.47, 0.44];
    case TAG.BEAM: return [0.34, 0.33, 0.35];
    case TAG.DEBRIS: case TAG.CLUTTER: return [0.42, 0.4, 0.38];
    case TAG.SKYLIGHT: return [0.55, 0.62, 0.68];
    case TAG.STAIR: return scale(concrete(boxSeed(b)), 0.9);
    case TAG.BAR: return [0.24, 0.22, 0.24];
    default: return concrete(boxSeed(b));
  }
};

/** the details' colours (dressing.ts tags), as the plain looks have them: a sign, an awning or a cloth one of a few by its seed */
const dressCol = (b: Box): V => {
  const k = b.seed ?? 0.5, pick: V = k < 0.25 ? [0.72, 0.28, 0.24] : k < 0.5 ? [0.24, 0.42, 0.62] : k < 0.75 ? [0.86, 0.72, 0.3] : [0.36, 0.56, 0.4];
  switch (b.tag) {
    case TAG.PIPE: return [0.42, 0.42, 0.4];
    case TAG.SIGN: case TAG.AWNING: return pick;
    case TAG.CLOTH: return scale(pick, 1.15);
    case TAG.WIRE: return [0.12, 0.12, 0.13];
    case TAG.POLE: return [0.38, 0.36, 0.34];
    case TAG.NEON: return k < 0.5 ? [1.0, 0.35, 0.6] : [0.35, 0.9, 1.0];
    case TAG.RUST: return [0.52, 0.32, 0.22];
    case TAG.FURNITURE: return k < 0.5 ? [0.75, 0.2, 0.18] : [0.3, 0.32, 0.36];
    default: return baseOf(b);
  }
};
/** the light as a painter masses it, from the frame's: in the sun or not (the edge between wider when it's low), a warm
 * lit colour from the horizon and one cool shade from the sky as the sun goes down; at noon, the day's */
function tints(L: Light) {
  const S = unit(L.sun), dk = 1 - smooth(0.17, 0.55, S[1]);
  const sunlit = mix([1.05, 0.99, 0.91], add(mulv(L.horizon, [1.25, 1.12, 1.0]), [0.07, 0.05, 0.04]), 0.75 * dk);
  // (the shade's colour: the sky's, greyed, as a wall in shadow at dusk takes it)
  const deep = mix(add(scale(L.top, 1.45), [0.13, 0.13, 0.14]), [0.6, 0.6, 0.66], 0.5);
  const shade = (n: V): V => mix(add([0.7, 0.71, 0.79], scale([0.06, 0.04, 0], (1 - Math.abs(n[1])) * smooth(0.5, -0.5, n[1] + 0.2))), deep, dk);
  const mass = (n: V) => smooth(0, 0.18 + 0.12 * dk, dot(n, S));
  const tone = (base: V, n: V, m = mass(n)) => mulv(base, mix(shade(n), sunlit, m));
  return { S, dk, sunlit, shade, mass, tone, deep };
}
const lipped = new Set<number>([TAG.BUILDING, TAG.HUT, TAG.RIM, TAG.STEP, TAG.STAIR, TAG.TANK, TAG.UNIT]);
/** ranks: what withdraws when (strokes.ts showsTo): the masses never; the brushwork by ~80 m; the coping by ~40 m */
const BRUSH = 0.55, SHADOW = 0.5, COPING = 0.33, DETAIL = 0.3;

/** the underpainting of a plane: the whole of it, flat, its mass's colour (the clip is its edge) */
const fillOf = (key: string, o: V, t: V, up: V, n: V, w: number, h: number, col: V, clip: [V, V], rank: number, kind: number = K.FILL, layer: number = LAYER.BROAD, extra: Partial<Mark> = {}): Mark => ({
  layer, kind, a: add(add(o, scale(t, -0.1)), scale(up, h / 2)), b: add(add(o, scale(t, w + 0.1)), scale(up, h / 2)), n, width: (h + 0.2) / 1.15, col, alpha: 1, rank, key, clip, taper: [0.001, 0.001], ...extra,
});
/** broad pulls across a plane, in rows, each row one way; two pigments in the brush */
function pulls(put: (m: Mark) => void, key: string, o: V, t: V, up: V, n: V, w: number, h: number, col: V, col2: V, rows: number, clip: [V, V], rank: number, rnd: () => number): void {
  const rh = h / rows;
  for (let r = 0; r < rows; r++) {
    const over = Math.min(0.9, rh * 0.45) + 0.25, v = (r + 0.5) * rh, fwd = rnd() < 0.5; let s = -over, i = 0;
    while (s < w + over) {
      const L = Math.min(w + 2 * over, 7 + rnd() * 7), e = Math.min(w + over, s + L);
      const a = add(add(o, scale(t, s)), scale(up, v + (rnd() - 0.5) * rh * 0.15)), b = add(add(o, scale(t, e)), scale(up, v + (rnd() - 0.5) * rh * 0.15));
      put({ layer: LAYER.BROAD, kind: K.PULL, a: fwd ? a : b, b: fwd ? b : a, n, width: rh * 1.35, col: scale(col, 0.93 + rnd() * 0.14), col2, mix2: 0.7, alpha: 0.95, dry: 0.25 + rnd() * 0.25, heart: 0.15, rank, key: `${key}/p${r}.${i++}`, clip, taper: [Math.min(0.9, rh * 0.45), Math.min(1.8, rh * 0.8)] });
      if (e >= w + over) break;
      s = e - Math.min(1.6, rh * 0.6);
    }
  }
}

/** one detail's marks (see `city`) */
function paintDetail(d: Detail, put: (m: Mark) => void, keeps: (rank: number) => boolean, T: ReturnType<typeof tints>): void {
  const key = `det:${d.kind}:${d.pts[0].map((v) => v.toFixed(2)).join(',')}`, r = rng(hashKey(key)), n: V = [d.n[0], 0, d.n[1]];
  if (d.kind === 'windows') {
    // (each pane: a pull across it, a little out from the wall; dark ones the sky's cool in them, lit ones warm, and at dusk
    // their own light)
    const [p, q] = d.pts, cnt = d.count ?? 1, u = unit(sub(q, p)), slot = d.w / cnt, pw = Math.min(1.1, slot * 0.62), y0 = p[1] + 0.15, y1 = p[1] + d.h - 0.1;
    const lit = new Set<number>(); for (const i of Array.from({ length: cnt }, (_, i) => i).sort(() => r() - 0.5).slice(0, d.lit ?? 0)) lit.add(i);
    for (let i = 0; i < cnt; i++) {
      const c0 = add(add(p, scale(u, slot * (i + 0.5))), scale(n, 0.03)), a = add(c0, scale(u, -pw / 2)), b = add(c0, scale(u, pw / 2)), my = (y0 + y1) / 2;
      const dark: V = mix(mulv([0.24, 0.27, 0.32], T.shade(n)), [0.4, 0.44, 0.52], 0.25 * (1 - T.dk));
      const col: V = lit.has(i) ? mix(mix(dark, [0.78, 0.66, 0.46], 0.45), [1.0, 0.8, 0.5], T.dk) : scale(dark, 1 - 0.3 * T.dk);
      const lo: V = [Math.min(a[0], b[0]) - 0.02, y0, Math.min(a[2], b[2]) - 0.02], hi: V = [Math.max(a[0], b[0]) + 0.02, y1, Math.max(a[2], b[2]) + 0.02];
      put({ layer: LAYER.ACCENT, kind: K.PULL, a: [a[0], my, a[2]], b: [b[0], my, b[2]], n, width: (y1 - y0) * 1.2, col, col2: scale(col, 1.12), mix2: 0.3, alpha: 1, dry: 0.15 + r() * 0.2, heart: r(), rank: 0.42, key: `${key}/${i}`, clip: [lo, hi], taper: [0.05, 0.12] });
    }
    return;
  }
  if (d.kind === 'wire') {
    // (a wire: one line a span, pole to sag to pole, not a mark a piece)
    if (!keeps(DETAIL)) return;
    for (let i = 0; i + 1 < d.pts.length; i++) put({ layer: LAYER.ACCENT, kind: K.PULL + EDGE, a: d.pts[i], b: d.pts[i + 1], width: 0.03, col: [0.13, 0.13, 0.15], alpha: 0.9, dry: 0.2, rank: DETAIL, key: `${key}/${i}`, taper: [0.02, 0.02] });
    return;
  }
  const small = d.kind === 'aerial' || d.kind === 'dish' || d.kind === 'laundry' || d.kind === 'rust' || d.kind === 'bin', rank = small ? DETAIL : 0.42;
  if (!keeps(rank)) return;
  DRESS[d.kind](d).forEach((b, j) => {
    if (b.tag === TAG.RUNGS) return;
    const col = dressCol(b), k = `${key}/${j}`, ext = [b.x1 - b.x0, b.y1 - b.y0, b.z1 - b.z0], order = [0, 1, 2].sort((i, l) => ext[l] - ext[i]);
    const glow = b.tag === TAG.NEON;
    if (b.flat) {
      // (a streak: a wash down the face)
      const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2, fn: V = [b.flat[0], 0, b.flat[1]];
      put({ layer: LAYER.ACCENT, kind: K.WASH, a: [cx, b.y1, cz], b: [cx, b.y0, cz], n: fn, width: Math.max(ext[0], ext[2]), col: scale(T.tone(col, fn), 0.9), alpha: 0.55, rank, key: k, taper: [0.05, (b.y1 - b.y0) * 0.5] });
      return;
    }
    if (ext[order[1]] < 0.2) {
      // (thin: one line along it, its width its own)
      const m: V = [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, (b.z0 + b.z1) / 2], ax = order[0], half = ext[ax] / 2;
      const a: V = [...m] as V, e: V = [...m] as V; a[ax] -= half; e[ax] += half;
      put({ layer: LAYER.ACCENT, kind: K.PULL + EDGE, a, b: e, width: Math.max(0.02, ext[order[1]]), col: glow ? col : scale(mulv(col, T.shade(n)), 0.85), alpha: 1, dry: 0.3, rank, key: k });
      return;
    }
    for (const p of planesOf(b, [])) put(fillOf(`${k}/${p.key}`, p.o, p.t, p.up, p.n, p.w, p.h, glow ? col : T.tone(col, p.n), p.clip, rank, K.FILL, LAYER.ACCENT));
  });
}

/** Switchback's coverage, over a near plane: strokes scattered by area (`cover` times over, as many as fit, each its own value
 * near the plane's mass, the next value over in the brush as its second pigment, a tint warm or cool of its own), in two sizes, masses then detail, laid the way the
 * surface goes: down a wall, along a roof's long way. Sized by the plane (a big wall broader strokes), so it's the same however
 * it's seen from; capped a plane, the survivors growing to keep the cover. */
function scatter(put: (m: Mark) => void, p: ReturnType<typeof planesOf>[number], col: V, T: ReturnType<typeof tints>, pb: V, m: number, r: () => number): void {
  const area = p.w * p.h, base = Math.min(3.2, Math.max(0.9, 0.7 + 0.12 * Math.sqrt(area)));
  const lit = (k: number): V => T.tone(pb, p.n, Math.max(0, Math.min(1, k)));
  for (const [pass, L0, wr, cover, cap] of [['m', base * 2.0, 0.42, 0.9, 16], ['d', base, 0.34, 0.7, 32]] as const) {
    let L = L0, W = L * wr, n = Math.round((area * cover) / (L * W));
    if (n > cap) { const g = Math.sqrt(n / cap); L *= g; W *= g; n = cap; }
    for (let i = 0; i < n; i++) {
      // (where: anywhere on it; which way: down a wall (a little off), along a roof's long way)
      const x = r() * p.w, y = r() * p.h, ang = p.top ? (r() - 0.5) * 0.6 : Math.PI / 2 + (r() - 0.5) * 0.5;
      const along = p.top ? (p.w >= p.h ? 0 : Math.PI / 2) + ang : ang;
      const ca = Math.cos(along) * L / 2, sa = Math.sin(along) * L / 2, c = add(add(p.o, scale(p.t, x)), scale(p.up, y));
      const a = add(add(c, scale(p.t, -ca)), scale(p.up, -sa)), b = add(add(c, scale(p.t, ca)), scale(p.up, sa));
      // (its value: about the plane's mass (no hard bands: on a shaded wall they broke it into camouflage); a tint of its own)
      const k = Math.max(0, Math.min(1, m + (r() - 0.5) * 0.22)), v = 0.94 + r() * 0.12, warm = (r() - 0.5) * 0.08;
      const c1 = mulv(lit(k), [v * (1 + warm), v, v * (1 - warm)]), c2 = lit(k + (r() < 0.5 ? -0.3 : 0.3));
      const down = !p.top && r() < 0.8;
      put({ layer: LAYER.BROAD, kind: K.PULL, a: down ? b : a, b: down ? a : b, n: p.n, width: W, col: pass === 'm' ? mix(c1, col, 0.35) : c1, col2: c2, mix2: 0.35, alpha: 0.92, dry: 0.3 + r() * 0.4, heart: r(), rank: pass === 'm' ? 0.42 : DETAIL + 0.06, key: `${p.key}/s${pass}${i}`, clip: p.clip, taper: [W * 0.4, L * 0.35] });
    }
  }
}

export const strokeGouacheRules: StrokeRules = {
  paper: [0.93, 0.9, 0.84], grain: 1, haze: [0.77, 0.74, 0.83], hazeNear: 0.12, fadeToPaper: 0, sun: DAY_SUN,
  skyField: { top: [0.58, 0.56, 0.7], horizon: [0.89, 0.83, 0.84] },
  city(c, city, put, keeps, light) {
    const T = tints(light), ox = c.cx * 64, oz = c.cz * 64, up0: V = [0, 1, 0], sKey = `street:${c.cx},${c.cz}`, rnd = rng(hashKey(sKey));
    // (the street: underpainted dark, a few pulls, its shadow)
    {
      const clip: [V, V] = [[ox - 0.01, -1, oz - 0.01], [ox + 64.01, 1, oz + 64.01]], col = T.tone(baseOf(null), up0);
      put(fillOf(`${sKey}/fill`, [ox, 0, oz], [1, 0, 0], [0, 0, 1], up0, 64, 64, scale(col, 0.82), clip, 0.9));
      if (keeps(BRUSH)) pulls(put, sKey, [ox, 0, oz], [1, 0, 0], [0, 0, 1], up0, 64, 64, col, scale(mulv(col, T.shade(up0)), 1.15), 6, clip, BRUSH, rnd);
      if (keeps(SHADOW)) put(fillOf(`${sKey}/shade`, [ox, 0, oz], [1, 0, 0], [0, 0, 1], up0, 64, 64, scale(mulv(baseOf(null), T.shade(up0)), 0.85), clip, SHADOW, K.SHADE, LAYER.SHADOW));
    }
    const f = light.focus;
    const isFocus = (b: Box) => !!f && Math.abs(b.y1 - f.y) < 0.01 && b.x0 < f.x1 && b.x1 > f.x0 && b.z0 < f.z1 && b.z1 > f.z0;
    for (const b of [...c.boxes, ...c.props]) {
      // (every box keeps its underpainting at any distance: it's solid in depth whatever else is drawn, so is painted; but the
      // small things fixed to a face (a fire escape's posts and steps, a unit, a sign's board) withdraw with the detail)
      const small = !!b.fixture;
      const base = baseOf(b), big = (b.x1 - b.x0) * (b.z1 - b.z0) > 12 && b.y1 - b.y0 > 2, rank = small ? DETAIL : 1;
      if (b.tag === TAG.BAR) {
        // (along its longest axis, whichever: a rail across, a post or a ladder's side up)
        const ext = [b.x1 - b.x0, b.y1 - b.y0, b.z1 - b.z0], ax = ext.indexOf(Math.max(...ext)), m: V = [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, (b.z0 + b.z1) / 2];
        const a: V = [...m] as V, e: V = [...m] as V; a[ax] -= ext[ax] / 2; e[ax] += ext[ax] / 2;
        const thick = Math.min(...ext.filter((_, i) => i !== ax).map((v) => Math.max(v, 0)), 1e9), wide = Math.max(...ext.filter((_, i) => i !== ax));
        put({ layer: LAYER.EDGE, kind: K.PULL + EDGE, a, b: e, width: Math.max(0.04, Math.min(wide, Math.max(thick, 0.04))), col: mulv(base, T.shade([0, 0, 1])), alpha: 1, dry: 0.3, rank: small ? 0.62 : 0.75, key: `bar:${a.join(',')}` });
        continue;
      }
      const near = city.boxesNear((b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2, Math.max(b.x1 - b.x0, b.z1 - b.z0) / 2 + 1);
      const focused = isFocus(b);
      for (const p of planesOf(b, near)) {
        const r = rng(hashKey(p.key)), pb = p.top ? scale(base, 1.04) : base, m = T.mass(p.n);
        // (the first landing: a warm roof, picked out, the way in)
        let col = p.top && focused ? mulv(scale(base, 1.12), mix(T.shade(p.n), T.sunlit, 0.9)) : T.tone(pb, p.n, m);
        if (!p.top) col = scale(col, 0.97);
        // (the second pigment: toward the sky's cool in the shade, the horizon's warmth in the light)
        const col2 = m > 0.5 ? mulv(col, [1.12, 1.0, 0.88]) : mix(col, scale(mulv(pb, T.deep), 0.9), 0.7);
        // (underpainted a value down and cooler, as gouache is laid dark to light: what the dry lifts and broken edges show)
        put(fillOf(`${p.key}/fill`, p.o, p.t, p.up, p.n, p.w, p.h, mix(scale(col, 0.8), scale(mulv(pb, T.deep), 0.85), 0.3), p.clip, rank));
        if (!keeps(BRUSH) || !big) { if (p.w * p.h > 4) scatter(put, p, col, T, pb, m, r); continue; }
        if (p.top) pulls(put, p.key, p.o, p.t, p.up, p.n, p.w, p.h, col, col2, Math.max(1, Math.min(4, Math.round(p.h / 3.5))), p.clip, BRUSH, r);
        else {
          // (a wall dragged down from its top, in a few broad strokes, drying out toward the street)
          const cols = Math.max(1, Math.min(3, Math.round(p.w / 3.5))), cw = p.w / cols;
          for (let i = 0; i < cols; i++) {
            const x = (i + 0.5 + (r() - 0.5) * 0.25) * cw, reach = p.h * (0.55 + 0.45 * r());
            const a = add(add(p.o, scale(p.t, x)), [0, p.h + 0.2, 0]), e = add(add(p.o, scale(p.t, x + (r() - 0.5) * 0.4)), [0, p.h - reach, 0]);
            put({ layer: LAYER.BROAD, kind: K.PULL, a, b: e, n: p.n, width: cw * 1.3, col: scale(col, 0.92 + r() * 0.16), col2, mix2: 0.75, alpha: 0.95, dry: 0.4 + r() * 0.25, heart: 0.1, rank: BRUSH, key: `${p.key}/d${i}`, clip: p.clip, taper: [0.1, Math.min(3, reach * 0.35)] });
          }
          // (weathering: a broken streak or two run down from under the coping)
          for (let i = r() < 0.65 ? 1 + (r() < 0.4 ? 1 : 0) : 0; i > 0; i--) {
            const x = 0.4 + r() * (p.w - 0.8), l = Math.min(p.h - 0.4, 1.5 + r() * 3.5);
            put({ layer: LAYER.BROAD, kind: K.PULL, a: add(add(p.o, scale(p.t, x)), [0, p.h - 0.3, 0]), b: add(add(p.o, scale(p.t, x)), [0, p.h - 0.3 - l, 0]), n: p.n, width: 0.25 + r() * 0.35, col: scale(col, 0.8), alpha: 0.55, dry: 0.7, heart: 0.05, rank: DETAIL, key: `${p.key}/w${i}`, clip: p.clip, taper: [0.05, l * 0.5] });
          }
        }
        // (over the broad strokes, Switchback's coverage: the plane broken into strokes of its own values)
        scatter(put, p, col, T, pb, m, r);
        // (its shadow: one passage, masked by the plane's real shadow)
        if (m > 0.2 && keeps(SHADOW)) put(fillOf(`${p.key}/shade`, p.o, p.t, p.up, p.n, p.w, p.h, scale(mulv(pb, T.shade(p.n)), 0.92), p.clip, SHADOW, K.SHADE, LAYER.SHADOW, { col2: mulv(pb, T.deep), mix2: 0.35 }));
      }
    }
    // (the details (dressing.ts), painted as Switchback paints its things: they claim no depth (render.ts), so each is all
    // marks, laid over what's behind it. A window row a mark a pane (lit or not by its dice; lit glows as the light goes);
    // anything thin (a wire, a pole, a rail, a bundle of pipes) one line along it; anything with faces, its faces filled; rust
    // a wash down the wall)
    if (keeps(0.42)) for (const d of c.details) paintDetail(d, put, keeps, T);
    // (lips: every one a hand can catch keeps its dark line on the roof; near, the full coping too)
    for (const l of lipsOf(c, city)) {
      if (!l.box || !lipped.has(l.box.tag) || l.box.y1 - l.box.y0 < 0.5) continue;
      const small = l.box.tag === TAG.UNIT || l.box.tag === TAG.TANK, keep = small ? 0.38 : 1;
      if (!keeps(keep)) continue;
      const r = rng(hashKey(l.key)), base = baseOf(l.box), heart = onLine(city, l.a, l.b) ?? 0.3 + r() * 0.4, y = l.a[1];
      const lo = (p: V, q: V): V => [Math.min(p[0], q[0]), Math.min(p[1], q[1]), Math.min(p[2], q[2])], hi = (p: V, q: V): V => [Math.max(p[0], q[0]), Math.max(p[1], q[1]), Math.max(p[2], q[2])];
      const at = (dy: number, inn = 0): [V, V] => [add(add(l.a, [0, dy, 0]), scale(l.n, -inn)), add(add(l.b, [0, dy, 0]), scale(l.n, -inn))];
      const [a2, b2] = at(0, 0.06), m0 = lo(add(l.a, [0, -0.6, 0]), add(l.b, scale(l.n, -0.3))), m1 = hi(add(l.a, [0, 0.6, 0]), add(l.b, scale(l.n, 0.01)));
      m0[1] = y - 0.6; m1[1] = y + 0.6;
      put({ layer: LAYER.EDGE, kind: K.PULL, a: a2, b: b2, n: [0, 1, 0], width: 0.08, col: scale(mulv(base, T.shade([0, 1, 0])), 0.55), alpha: 0.9, dry: 0.3, heart, rank: keep, key: `${l.key}/lip`, clip: [m0, m1], taper: [0.05, 0.3] });
      if (small || !keeps(COPING)) continue;
      const wallClip = (dy0: number, dy1: number): [V, V] => { const p = add(l.a, scale(l.n, -1)), q = add(l.b, scale(l.n, 1)); const n0 = lo(p, q), n1 = hi(p, q); n0[1] = y + dy0; n1[1] = y + dy1; return [n0, n1]; };
      const lit = T.mass(l.n) > 0.5, cap = lit ? scale(mulv(base, T.sunlit), 1.1) : scale(T.tone(base, l.n), 0.82);
      const [a0, b0] = at(-0.15), fwd = r() < 0.5;
      put({ layer: LAYER.EDGE, kind: K.PULL, a: fwd ? a0 : b0, b: fwd ? b0 : a0, n: l.n, width: 0.28, col: cap, col2: scale(cap, lit ? 0.92 : 1.1), mix2: 0.4, alpha: 1, dry: 0.45, heart: fwd ? heart : 1 - heart, rank: COPING, key: `${l.key}/cap`, clip: wallClip(-0.6, 0.01), taper: [0.1, 0.6] });
      const [a1, b1] = at(-0.36);
      put({ layer: LAYER.EDGE, kind: K.WASH, a: a1, b: b1, n: l.n, width: 0.13, col: scale(mulv(base, T.shade(l.n)), 0.72), alpha: 0.5, rank: DETAIL, key: `${l.key}/under`, clip: wallClip(-0.6, -0.3) });
    }
    // (sills a hand can take: a ledge and its shadow; pipes, a dark line; both only near)
    if (keeps(0.36)) for (const h of c.holds) {
      if (h.kind !== 'sill' && h.kind !== 'pipe') continue;
      const n: V = [h.nx, 0, h.nz], a: V = [h.ax, h.ay, h.az], b: V = [h.bx, h.by, h.bz], key = `${h.kind}:${a.map((v) => v.toFixed(2)).join(',')}`, r = rng(hashKey(key));
      const owner = c.boxes.find((o) => a[0] >= o.x0 - 0.02 && a[0] <= o.x1 + 0.02 && a[2] >= o.z0 - 0.02 && a[2] <= o.z1 + 0.02 && o.y1 >= a[1]) ?? null, base = baseOf(owner);
      if (h.kind === 'pipe') { put({ layer: LAYER.ACCENT, kind: K.PULL + EDGE, a: add(a, scale(n, 0.06)), b: add(b, scale(n, 0.06)), width: 0.08, col: scale(mulv(base, T.shade(n)), 0.6), alpha: 0.9, dry: 0.5, rank: DETAIL, key }); continue; }
      const lo: V = [Math.min(a[0], b[0]) - (n[0] ? 1 : 0), a[1] - 0.25, Math.min(a[2], b[2]) - (n[2] ? 1 : 0)], hi: V = [Math.max(a[0], b[0]) + (n[0] ? 1 : 0), a[1] + 0.12, Math.max(a[2], b[2]) + (n[2] ? 1 : 0)];
      put({ layer: LAYER.ACCENT, kind: K.PULL, a: add(a, [0, 0.03, 0]), b: add(b, [0, 0.03, 0]), n, width: 0.11, col: scale(T.tone(base, n), T.mass(n) > 0.5 ? 1.08 : 0.9), alpha: 1, dry: 0.4 + r() * 0.3, heart: r(), rank: 0.36, key: `${key}/ledge`, clip: [lo, hi] });
      put({ layer: LAYER.ACCENT, kind: K.WASH, a: add(a, [0, -0.08, 0]), b: add(b, [0, -0.08, 0]), n, width: 0.08, col: scale(mulv(base, T.shade(n)), 0.7), alpha: 0.55, rank: DETAIL, key: `${key}/under`, clip: [lo, hi] });
    }
  },
  sky(light) {
    // (over the field, a few broad quiet pulls carried across it, close in value to where they lie; and low down, a long
    // warm one or two along the horizon)
    const out: Mark[] = [], dirOf = (az: number, el: number): V => [Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)], rnd = rng(11);
    const at = (el: number): V => { const up = Math.sin(el), band = smooth(0, 0.09, up); return mix(light.horizon, mix(mix(light.horizon, light.top, 0.8), light.top, smooth(0.09, 0.45, up)), band); };
    for (const [deg, n, w] of [[30, 5, 0.2], [14, 6, 0.13], [6, 4, 0.06]] as const) {
      for (let k = 0; k < n; k++) {
        const az = ((k + rnd() * 0.6) / n) * Math.PI * 2, half = (32 + rnd() * 18) * (Math.PI / 180), el = (deg + (rnd() - 0.5) * 5) * (Math.PI / 180);
        const a = dirOf(az - half, el), b = dirOf(az + half, el + (rnd() - 0.5) * 0.05), nn = unit(scale(add(a, b), -0.5)), c = at(el);
        out.push({ layer: 0, kind: K.PULL, a, b, n: nn, width: w, col: scale(c, 0.98 + rnd() * 0.05), col2: mix(c, deg < 10 ? light.horizon : light.top, 0.3), mix2: 0.5, alpha: 0.5, dry: 0.5, heart: 0.2, rank: 1, key: `sky:${deg}.${k}`, sky: true, taper: [0.08, 0.3] });
      }
    }
    for (let k = 0; k < 2; k++) {
      const az = rnd() * Math.PI * 2, half = (40 + rnd() * 30) * (Math.PI / 180), el = (1.5 + rnd() * 2) * (Math.PI / 180);
      const a = dirOf(az - half, el), b = dirOf(az + half, el), nn = unit(scale(add(a, b), -0.5));
      out.push({ layer: 0, kind: K.PULL, a, b, n: nn, width: 0.02, col: scale(light.horizon, 1.06), alpha: 0.8, dry: 0.5, heart: 0.3, rank: 1, key: `glow:${k}`, sky: true, taper: [0.05, 0.4] });
    }
    return out;
  },
  figure(parts, palette, put, light) {
    // (all marks, no mask: the body claims no depth (render.ts), so each part is painted whole, far to near, its own body then
    // its lit pull then its accents, the near limbs over the far; contact shadows first, on the ground)
    const T = tints(light), ground: Mark[] = [], byPart: Mark[][] = [];
    for (const p of [...parts].sort((x, y) => y.dist - x.dist)) {
      const body: Mark[] = [], lights: Mark[] = [], accents: Mark[] = [], under = { push: (..._m: Mark[]) => 0 };
      byPart.push(body, lights, accents);
      const col = (palette[p.mat] ?? palette[0]) as V, dark = mulv(col, mix([0.55, 0.57, 0.68], scale(T.deep, 0.8), T.dk)), lit = mulv(col, mix([1.05, 1.05, 1.05], T.sunlit, T.dk));
      // (what's worn takes the light by its own face (a skirt's quads, a coat's: so a fold turns light to dark), the body's
      // parts by how their turned faces meet it)
      const face = p.kind === 'worn' ? (dot(p.fwd, p.toEye) >= 0 ? p.fwd : scale(p.fwd, -1)) : null;
      const front = face ? smooth(-0.25, 0.55, dot(face, T.S)) : smooth(-0.35, 0.45, p.sunFront), tone = mix(dark, lit, (face ? 0.3 : 0.45) + (face ? 0.55 : 0.35) * front), key = `fig:${p.name}`;
      // (a little past each end, so the marks overlap at the joints)
      const ext = scale(unit(sub(p.b, p.a)), Math.min(0.06, p.width * 0.35)), pa = sub(p.a, ext), pb = add(p.b, ext);
      const m = (o: Partial<Mark>): Mark => ({ layer: 0, kind: K.PULL, a: pa, b: pb, side: p.side, width: p.width * 1.2, col: tone, col2: mix(tone, lit, 0.35), mix2: 0.35, alpha: 1, dry: 0.2, heart: 0.25, rank: 1, key, ...o });
      // (the lit pull: narrower, on the sun's side of it, where its turned face can be seen)
      // (and the turned-away side: a narrow dark pull along the edge away from the sun, which models it as the mask once did
      // all round)
      const litPull = (k: number) => {
        const sg = Math.sign(p.sunSide) || 1, rt = Math.min(p.width * 0.3, 0.05);
        if (front > 0.1) { const off = scale(p.side, sg * p.width * 0.22); lights.push(m({ a: add(pa, off), b: add(pb, off), width: p.width * (k + 0.1), col: scale(lit, 1.06), mix2: 0, alpha: 0.9, dry: 0.5, key: `${key}/lit`, taper: [rt, rt * 1.5] })); }
        const off2 = scale(p.side, -sg * p.width * 0.4); lights.push(m({ a: add(pa, off2), b: add(pb, off2), width: p.width * 0.28, col: scale(dark, 0.8), mix2: 0, alpha: 0.85, dry: 0.3, key: `${key}/turn`, taper: [rt, rt * 1.5] }));
      };
      // (seen end-on, a limb's pull shortens to nothing: its mass as a dab, so the body's depth is covered)
      if (p.endOn > 0.45 && p.kind !== 'head') { const c = scale(add(p.a, p.b), 0.5), up = scale(unit(cross(p.side, p.toEye)), p.girth * 0.5); under.push(m({ kind: K.DAB, a: sub(c, up), b: add(c, up), width: p.girth * 1.25, col: scale(dark, 0.45), key: `${key}/endU` })); body.push(m({ kind: K.DAB, a: sub(c, scale(up, 0.85)), b: add(c, scale(up, 0.85)), width: p.girth * 1.05, key: `${key}/end` })); }
      switch (p.kind) {
        case 'head': {
          // (a face, the skin, where the head faces the eye; the hair over the crown and round the back)
          const skin = (palette[p.mat - (p.mat % 8)] ?? col) as V, d = unit(sub(p.b, p.a)), c = scale(add(p.a, p.b), 0.5), facing = dot(p.fwd, p.toEye);
          const sk = mix(mulv(skin, mix([0.62, 0.6, 0.68], scale(T.deep, 0.85), T.dk)), mulv(skin, mix([1.04, 1.02, 1.0], T.sunlit, T.dk)), 0.4 + 0.45 * front);
          body.push(m({ kind: K.DAB, a: sub(c, scale(d, p.length * 0.62)), b: add(c, scale(d, p.length * 0.55)), width: p.width * 1.25, col: sk, mix2: 0, key: `${key}/face` }));
          const back = scale(p.fwd, -p.width * 0.28 * Math.max(0.2, facing)), hc = add(add(c, scale(d, p.length * 0.2)), back);
          body.push(m({ kind: K.DAB, a: sub(hc, scale(d, p.length * (facing > 0.3 ? 0.35 : 0.6))), b: add(hc, scale(d, p.length * 0.55)), width: p.width * (facing > 0.3 ? 1.2 : 1.35), col: mix(tone, lit, 0.15), mix2: 0, key: `${key}/hair` }));
          break;
        }
        case 'pelvis': case 'torso':
          under.push(m({ width: p.width * 1.38, col: scale(dark, 0.45), mix2: 0, dry: 0.1, key: `${key}/under` }));
          body.push(m({ heart: p.kind === 'torso' ? 0.7 : 0.4, taper: [p.width * 0.3, p.width * 0.35] }));
          // (the pelvis lies across the body: its edges would be bands at the waist, so only the torso is modelled)
          if (p.kind === 'torso') litPull(0.5);
          break;
        case 'foot': {
          under.push(m({ width: p.width * 1.45, col: scale(dark, 0.4), mix2: 0, dry: 0.05, key: `${key}/under` }));
          // (the shoe that bears weight loaded and dark, a small dark contact under it; the one in the air lighter, drier)
          body.push(m({ width: p.width * 1.25, col: p.planted ? scale(tone, 0.82) : mix(tone, lit, 0.4), dry: p.planted ? 0.05 : 0.45, heart: 0.5, taper: [0.03, 0.04] }));
          if (p.planted) { const g = p.ground + 0.004, a: V = [p.a[0], g, p.a[2]], b: V = [p.b[0], g, p.b[2]]; ground.push({ layer: 0, kind: K.DAB, a, b, n: [0, 1, 0], width: p.girth * 1.7, col: scale(T.deep, 0.35), alpha: 0.55, rank: 1, key: `${key}/contact` }); }
          break;
        }
        case 'worn': body.push(m({ taper: [0.02, 0.04] })); break;
        default: {
          // (a limb: a pull from the joint, tapering toward the hand or the foot)
          under.push(m({ width: p.width * 1.45, col: scale(dark, 0.45), mix2: 0, dry: 0.15, key: `${key}/under`, taper: [0.03, 0.05] }));
          body.push(m({ width: p.width * 1.22, heart: 0.15, taper: [p.width * 0.4, p.width * 0.5] }));
          litPull(0.45);
          if (p.kind === 'foreArm') {
            // (the hand: closed and darker on a hold; open, lighter, a little larger reaching)
            const skin = (palette[p.mat - (p.mat % 8)] ?? col) as V, d = unit(sub(p.b, p.a)), s = p.gripping ? 0.085 : 0.11;
            accents.push(m({ kind: K.DAB, a: sub(p.b, scale(d, s * 0.3)), b: add(p.b, scale(d, s * 0.9)), width: s, mix2: 0, col: p.gripping ? scale(mulv(skin, [0.75, 0.72, 0.75]), 0.85) : mix(mulv(skin, mix([1, 1, 1], T.sunlit, T.dk)), scale(skin, 1.08), front * (1 - T.dk)), key: `${key}/hand` }));
          }
        }
      }
    }
    for (const m of [...ground, ...byPart.flat()]) put(m);
  },
};

export const strokeGouache: LookDef = {
  name: 'stroke-gouache', fog: strokeGouacheRules.haze, fogNear: 0.12, sun: DAY_SUN, shadow: 'map', guides: false, strokes: strokeGouacheRules,
  glsl: `vec3 look(Surf s) { return clayOf(s); }`,
};

