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
import type { Box } from '../city';
import { TAG } from '../city';
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
      // (every box keeps its underpainting at any distance: it's solid in depth whatever else is drawn, so is painted)
      const base = baseOf(b), big = (b.x1 - b.x0) * (b.z1 - b.z0) > 12 && b.y1 - b.y0 > 2, rank = 1;
      if (b.tag === TAG.BAR) {
        const alongX = b.x1 - b.x0 >= b.z1 - b.z0, y = (b.y0 + b.y1) / 2, mx = (b.x0 + b.x1) / 2, mz = (b.z0 + b.z1) / 2;
        const a: V = alongX ? [b.x0, y, mz] : [mx, y, b.z0], e: V = alongX ? [b.x1, y, mz] : [mx, y, b.z1];
        put({ layer: LAYER.EDGE, kind: K.PULL + EDGE, a, b: e, width: Math.max(0.06, Math.min(b.y1 - b.y0, alongX ? b.z1 - b.z0 : b.x1 - b.x0)), col: mulv(base, T.shade([0, 0, 1])), alpha: 1, dry: 0.3, rank: 0.75, key: `bar:${a.join(',')}` });
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
        if (!keeps(BRUSH) || !big) continue;
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
        // (its shadow: one passage, masked by the plane's real shadow)
        if (m > 0.2 && keeps(SHADOW)) put(fillOf(`${p.key}/shade`, p.o, p.t, p.up, p.n, p.w, p.h, scale(mulv(pb, T.shade(p.n)), 0.92), p.clip, SHADOW, K.SHADE, LAYER.SHADOW, { col2: mulv(pb, T.deep), mix2: 0.35 }));
      }
    }
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
    const T = tints(light), under: Mark[] = [], body: Mark[] = [], lights: Mark[] = [], accents: Mark[] = [];
    for (const p of parts) {
      const col = (palette[p.mat] ?? palette[0]) as V, dark = mulv(col, mix([0.55, 0.57, 0.68], scale(T.deep, 0.8), T.dk)), lit = mulv(col, mix([1.05, 1.05, 1.05], T.sunlit, T.dk));
      const front = smooth(-0.35, 0.45, p.sunFront), tone = mix(dark, lit, 0.25 + 0.35 * front), key = `fig:${p.name}`;
      // (a little past each end, so the marks overlap at the joints and cover the body's depth whole)
      const ext = scale(unit(sub(p.b, p.a)), Math.min(0.06, p.width * 0.35)), pa = sub(p.a, ext), pb = add(p.b, ext);
      const m = (o: Partial<Mark>): Mark => ({ layer: 0, kind: K.PULL, a: pa, b: pb, side: p.side, width: p.width * 1.2, col: tone, col2: mix(tone, lit, 0.35), mix2: 0.35, alpha: 1, dry: 0.2, heart: 0.25, rank: 1, key, ...o });
      // (the lit pull: narrower, on the sun's side of it, where its turned face can be seen)
      const litPull = (k: number) => { if (front < 0.15 || Math.abs(p.sunSide) < 0.05) return; const off = scale(p.side, Math.sign(p.sunSide) * p.width * 0.25); lights.push(m({ a: add(pa, off), b: add(pb, off), width: p.width * k, col: lit, mix2: 0, alpha: 0.95, dry: 0.45, key: `${key}/lit` })); };
      // (seen end-on, a limb's pull shortens to nothing: its mass as a dab, so the body's depth is covered)
      if (p.endOn > 0.45 && p.kind !== 'head') { const c = scale(add(p.a, p.b), 0.5), up = scale(unit(cross(p.side, p.toEye)), p.girth * 0.5); under.push(m({ kind: K.DAB, a: sub(c, up), b: add(c, up), width: p.girth * 1.25, col: scale(dark, 0.45), key: `${key}/endU` })); body.push(m({ kind: K.DAB, a: sub(c, scale(up, 0.85)), b: add(c, scale(up, 0.85)), width: p.girth * 1.05, key: `${key}/end` })); }
      switch (p.kind) {
        case 'head': under.push(m({ width: p.width * 1.05, col: scale(dark, 0.6), mix2: 0, dry: 0, taper: [0.02, 0.02], key: `${key}/under` })); body.push(m({ kind: K.DAB, a: sub(p.a, scale(unit(sub(p.b, p.a)), p.length * 0.2)), b: add(p.b, scale(unit(sub(p.b, p.a)), p.length * 0.2)), width: p.width * 1.45, col: mix(tone, lit, 0.2), mix2: 0 })); break;
        case 'pelvis': case 'torso':
          under.push(m({ width: p.width * 1.38, col: scale(dark, 0.45), mix2: 0, dry: 0.1, key: `${key}/under` }));
          body.push(m({ heart: p.kind === 'torso' ? 0.7 : 0.4, taper: [0.06, 0.08] }));
          litPull(0.5);
          break;
        case 'foot': {
          under.push(m({ width: p.width * 1.45, col: scale(dark, 0.4), mix2: 0, dry: 0.05, key: `${key}/under` }));
          // (the shoe that bears weight loaded and dark, a small dark contact under it; the one in the air lighter, drier)
          body.push(m({ width: p.width * 1.25, col: p.planted ? scale(tone, 0.82) : mix(tone, lit, 0.4), dry: p.planted ? 0.05 : 0.45, heart: 0.5, taper: [0.03, 0.04] }));
          if (p.planted) { const g = p.ground + 0.004, a: V = [p.a[0], g, p.a[2]], b: V = [p.b[0], g, p.b[2]]; accents.push({ layer: 0, kind: K.DAB, a, b, n: [0, 1, 0], width: p.girth * 1.7, col: scale(T.deep, 0.35), alpha: 0.55, rank: 1, key: `${key}/contact` }); }
          break;
        }
        case 'worn': body.push(m({ taper: [0.02, 0.04] })); break;
        default: {
          // (a limb: a pull from the joint, tapering toward the hand or the foot)
          under.push(m({ width: p.width * 1.45, col: scale(dark, 0.45), mix2: 0, dry: 0.15, key: `${key}/under`, taper: [0.03, 0.05] }));
          body.push(m({ width: p.width * 1.22, heart: 0.15, taper: [0.03, 0.06] }));
          litPull(0.45);
          if (p.kind === 'foreArm') {
            // (the hand: closed and darker on a hold; open, lighter, a little larger reaching)
            const skin = (palette[p.mat - (p.mat % 8)] ?? col) as V, d = unit(sub(p.b, p.a)), s = p.gripping ? 0.085 : 0.11;
            accents.push(m({ kind: K.DAB, a: sub(p.b, scale(d, s * 0.3)), b: add(p.b, scale(d, s * 0.9)), width: s, mix2: 0, col: p.gripping ? scale(mulv(skin, [0.75, 0.72, 0.75]), 0.85) : mix(mulv(skin, mix([1, 1, 1], T.sunlit, T.dk)), scale(skin, 1.08), front * (1 - T.dk)), key: `${key}/hand` }));
          }
        }
      }
    }
    for (const m of [...under, ...body, ...lights, ...accents]) put(m);
  },
};

export const strokeGouache: LookDef = {
  name: 'stroke-gouache', fog: strokeGouacheRules.haze, fogNear: 0.12, sun: DAY_SUN, shadow: 'map', guides: false, strokes: strokeGouacheRules,
  glsl: `vec3 look(Surf s) { return clayOf(s); }`,
};

