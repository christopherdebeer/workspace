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
import { STYLE, TAG } from '../city';
import { DRESS } from '../dressing';
import type { Light, Lod, Mark, Spline, StrokeRules, V } from '../strokes';
import type { Room } from '../interiors';
import { STOREY } from '../city';
import { EDGE, K, LAYER, add, boxSeed, cross, dot, lipsOf, mix, onLine, planesOf, rng, scale, smooth, sub, unit, hashKey } from '../strokes';
const len = (v: V) => Math.hypot(v[0], v[1], v[2]);

const DAY_SUN: V = [-0.55, 0.6, 0.58];
const WARM: V = [0.64, 0.62, 0.58], GREEN: V = [0.57, 0.61, 0.6], COOL: V = [0.6, 0.61, 0.63], TERRA: V = [0.67, 0.55, 0.51];
const concrete = (s: number): V => (s < 0.4 ? mix(WARM, COOL, s / 0.4) : s < 0.9 ? mix(COOL, GREEN, (s - 0.4) / 0.5) : mix(WARM, TERRA, 0.7));
const mulv = (a: V, b: V): V => [a[0] * b[0], a[1] * b[1], a[2] * b[2]];
const baseOf = (b: Box | null): V => {
  if (!b) return [0.36, 0.37, 0.41];
  switch (b.tag) {
    // (a building by its style: a mansard's limestone, a tenement's tile, a slab's pale concrete, an office's dark glass, a
    // plain block's concrete; a mansard's top storey slate, its chimneys brick)
    case TAG.BUILDING: { const s = boxSeed(b), j = (s - 0.5) * 0.06;
      switch (b.style) {
        case STYLE.MANSARD: return [0.86 + j, 0.8 + j, 0.7 + j * 0.5];
        case STYLE.TENEMENT: return s < 0.5 ? [0.64 + j, 0.55 + j, 0.47] : [0.58 + j, 0.52 + j, 0.5];
        case STYLE.SLAB: return [0.84 + j, 0.83 + j, 0.8 + j];
        case STYLE.OFFICE: return s < 0.5 ? [0.2, 0.24, 0.28] : [0.24, 0.26, 0.24];
        default: return concrete(s);
      } }
    case TAG.MANSARD: return [0.34, 0.4, 0.5];
    case TAG.CHIMNEY: return [0.58, 0.36, 0.27];
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
const lipped = new Set<number>([TAG.BUILDING, TAG.HUT, TAG.RIM, TAG.STEP, TAG.STAIR, TAG.TANK, TAG.UNIT, TAG.MANSARD, TAG.CHIMNEY]);
/** ranks: what withdraws when (strokes.ts showsTo): the masses never; the brushwork by ~80 m; the coping by ~40 m */
const BRUSH = 0.55, SHADOW = 0.5, COPING = 0.33, DETAIL = 0.3;

/** the underpainting of a plane: the whole of it, flat, its mass's colour (the clip is its edge) */
const fillOf = (key: string, o: V, t: V, up: V, n: V, w: number, h: number, col: V, clip: [V, V], rank: number, kind: number = K.FILL, layer: number = LAYER.BROAD, extra: Partial<Mark> = {}): Mark => ({
  layer, kind, a: add(add(o, scale(t, -0.1)), scale(up, h / 2)), b: add(add(o, scale(t, w + 0.1)), scale(up, h / 2)), n, width: (h + 0.2) / 1.15, col, alpha: 1, rank, key, clip, taper: [0.001, 0.001], ...extra,
});
/** broad pulls across a plane, in rows, each row one way; two pigments in the brush */
function pulls(put: (m: Mark) => void, key: string, o: V, t: V, up: V, n: V, w: number, h: number, col: V, col2: V, rows0: number, clip: [V, V], rank: number, rnd: () => number, size = 1): void {
  // (further off, a bigger brush: fewer rows, longer pulls, the same cover)
  const rows = Math.max(1, Math.round(rows0 / size)), rh = h / rows;
  for (let r = 0; r < rows; r++) {
    const over = Math.min(0.9, rh * 0.45) + 0.25, v = (r + 0.5) * rh, fwd = rnd() < 0.5; let s = -over, i = 0;
    while (s < w + over) {
      const L = Math.min(w + 2 * over, (7 + rnd() * 7) * size), e = Math.min(w + over, s + L);
      const a = add(add(o, scale(t, s)), scale(up, v + (rnd() - 0.5) * rh * 0.15)), b = add(add(o, scale(t, e)), scale(up, v + (rnd() - 0.5) * rh * 0.15));
      put({ layer: LAYER.BROAD, kind: K.PULL, a: fwd ? a : b, b: fwd ? b : a, n, width: rh * 1.35, col: scale(col, 0.93 + rnd() * 0.14), col2, mix2: 0.7, alpha: 0.95, dry: 0.5 + rnd() * 0.3, heart: 0.15, rank, key: `${key}/p${r}.${i++}`, clip, taper: [Math.min(0.9, rh * 0.45), Math.min(1.8, rh * 0.8)] });
      if (e >= w + over) break;
      s = e - Math.min(1.6, rh * 0.6);
    }
  }
}

/**
 * A box laid in brush pulls, each face its own: across its long way, as many as its short way takes at this brush (`size`),
 * overlapping, each its own value about the face's tone with a second pigment toward its shade, loaded where it lands and
 * dry at its exit; cut to the face. No flat fill: what was a placeholder block is paint.
 */
function brushBox(put: (m: Mark) => void, b: Box, col: V, T: ReturnType<typeof tints>, rank: number, key: string, layer: number, size: number, glow = false): void {
  for (const p of planesOf(b, [])) brushPlane(put, p, col, T, rank, key, layer, size, glow);
}
/** one face laid in pulls (see brushBox) */
function brushPlane(put: (m: Mark) => void, p: ReturnType<typeof planesOf>[number], col: V, T: ReturnType<typeof tints>, rank: number, key: string, layer: number, size: number, glow = false): void {
  const r = rng(hashKey(key + p.key));
  {
    if (p.w * p.h < 0.004) return;
    const longW = p.w >= p.h, L = longW ? p.w : p.h, S = longW ? p.h : p.w, n = Math.max(1, Math.min(3, Math.round(S / (0.5 * size)))), sw = S / n;
    const tone = glow ? col : T.tone(col, p.n), shade = glow ? scale(col, 0.85) : mulv(col, T.shade(p.n));
    for (let i = 0; i < n; i++) {
      const v = (i + 0.5) * sw + (r() - 0.5) * sw * 0.15, fwd = r() < 0.5, over = Math.min(0.08, L * 0.05);
      const at = (u: number): V => longW ? add(add(p.o, scale(p.t, u)), scale(p.up, v)) : add(add(p.o, scale(p.t, v)), scale(p.up, u));
      const a = at(-over), e = at(L + over), c = scale(tone, 0.86 + r() * 0.26);
      put({ layer, kind: K.PULL, a: fwd ? a : e, b: fwd ? e : a, n: p.n, width: sw * 1.3, col: c, col2: mix(c, shade, 0.6), mix2: 0.45, alpha: 1, dry: 0.4 + r() * 0.4, heart: r() * 0.5, load: 0.75, rank, key: `${key}/${p.key}.${i}`, clip: p.clip, taper: [Math.min(0.05, L * 0.1), Math.min(0.15, L * 0.25)] });
    }
    // (over them, a few shorter strokes a value either side, a little across: broken colour, as the walls have it; near only)
    const area = p.w * p.h, extra = size < 3 && area > 0.25 ? Math.min(3, Math.round(area / (0.8 * size * size))) : 0;
    for (let j = 0; j < extra; j++) {
      const u0 = r() * L, v0 = r() * S, l = Math.min(L, (0.35 + r() * 0.6) * Math.max(0.6, Math.sqrt(area)) * size), tilt = (r() - 0.5) * 0.6;
      const at = (u: number, v: number): V => longW ? add(add(p.o, scale(p.t, u)), scale(p.up, v)) : add(add(p.o, scale(p.t, v)), scale(p.up, u));
      const a = at(u0 - l / 2, v0 - tilt * l / 2), e = at(u0 + l / 2, v0 + tilt * l / 2), c = r() < 0.5 ? scale(tone, 1.04 + r() * 0.05) : mix(tone, shade, 0.4 + r() * 0.3);
      put({ layer, kind: K.PULL, a, b: e, n: p.n, width: Math.min(S, sw) * (0.45 + r() * 0.25), col: c, alpha: 0.85, dry: 0.5 + r() * 0.4, heart: r(), load: 0.6, rank, key: `${key}/${p.key}.x${j}`, clip: p.clip, taper: [0.02, l * 0.3] });
    }
  }
}

/** a ladder's rungs (dressing.ts gives them as one flat face): a short pull across every 0.3 m up it */
function rungs(put: (m: Mark) => void, b: Box, col: V, rank: number, key: string, size: number): void {
  const n: V = b.flat ? [b.flat[0], 0, b.flat[1]] : [0, 0, 1], wide = b.x1 - b.x0 > b.z1 - b.z0, step = 0.3 * Math.max(1, size);
  for (let y = b.y0 + 0.15, i = 0; y < b.y1; y += step, i++) {
    const a: V = wide ? [b.x0, y, (b.z0 + b.z1) / 2] : [(b.x0 + b.x1) / 2, y, b.z0], e: V = wide ? [b.x1, y, (b.z0 + b.z1) / 2] : [(b.x0 + b.x1) / 2, y, b.z1];
    put({ layer: LAYER.ACCENT, kind: K.PULL + EDGE, a, b: e, width: 0.035 * Math.max(1, size * 0.7), col, alpha: 0.95, dry: 0.3, rank, key: `${key}/r${i}`, taper: [0.01, 0.01] });
  }
  void n;
}

/**
 * A window row's panes as they're painted near (one a slot; see paintDetail): where each is, how wide, and its state, by the
 * same dice the painting uses, so the room behind a pane (interiors.ts) is the room its painted pane says.
 */
function paneLayout(d: Detail): { key: string; form: string; u: V; n: V; p: V; slot: number; pw: number; y0: number; y1: number; panes: { t: number; state: string }[] } {
  const key = `det:${d.kind}:${d.pts[0].map((v) => v.toFixed(2)).join(',')}`, r = rng(hashKey(key)), n: V = [d.n[0], 0, d.n[1]];
  const form = d.form ?? 'pane', [p, q] = d.pts, cnt = d.count ?? 1, u = unit(sub(q, p)), slot = d.w / cnt;
  const ratio = form === 'ribbon' ? 0.97 : form === 'curtain' ? 0.92 : form === 'tall' ? 0.5 : form === 'frame' ? 0.56 : 0.62;
  const pw = Math.min(form === 'ribbon' || form === 'curtain' ? 9 : 1.1, slot * ratio), y0 = p[1] + 0.12, y1 = p[1] + d.h - 0.08;
  const litN = Math.min(cnt, d.lit ?? 0), order = Array.from({ length: cnt }, (_, i) => i).sort(() => r() - 0.5), lit = new Set(order.slice(0, litN));
  const panes = Array.from({ length: cnt }, (_, i) => { const sr = rng(hashKey(`${key}/s${i}`))(), on = lit.has(i);
    return { t: slot * (i + 0.5), state: !on ? (sr < 0.06 ? 'lamp' : 'dark') : sr < 0.45 ? 'warm' : sr < 0.65 ? 'curtain' : sr < 0.82 ? 'blinds' : sr < 0.92 ? 'screen' : 'warm' }; });
  return { key, form, u, n, p, slot, pw, y0, y1, panes };
}

/** one detail's marks (see `city`) */
function paintDetail(d: Detail, put: (m: Mark) => void, keeps: (rank: number) => boolean, T: ReturnType<typeof tints>, size0 = 1, rk: (r: number) => number = (r) => r): void {
  // (a detail's brush grows slower than the masses' (it's small), and its colour quiets toward the wall's further off)
  const size = Math.min(size0, 1 + (size0 - 1) * 0.4), quiet = Math.min(0.75, (size0 - 1) * 0.2);
  const key = `det:${d.kind}:${d.pts[0].map((v) => v.toFixed(2)).join(',')}`, r = rng(hashKey(key)), n: V = [d.n[0], 0, d.n[1]];
  if (d.kind === 'windows') {
    // (a row of windows, by its building's form (parts.ts): punched panes, framed ones with a cross, tall French ones with a
    // railing and now and then shutters, a ribbon running the face, or a curtain wall of glass bays. Each pane its own state by
    // the row's dice: dark (the sky's cool in it), lit warm, a curtain drawn, blinds down, a screen's blue, a lamp in the dark.
    // Near, a lit room shows something of itself: someone in it, a lamp, the line of a table. Further off, panes run together:
    // a stroke for every few, the lit ones still their own)
    const form = d.form ?? 'pane', [p, q] = d.pts, g = Math.max(1, Math.round(size)), cnt0 = d.count ?? 1, cnt = Math.max(1, Math.round(cnt0 / g)), u = unit(sub(q, p)), slot = d.w / cnt;
    const ratio = form === 'ribbon' ? 0.97 : form === 'curtain' ? 0.92 : form === 'tall' ? 0.5 : form === 'frame' ? 0.56 : 0.62;
    const pw = Math.min((form === 'ribbon' || form === 'curtain' ? 9 : 1.1) * g, slot * (g > 1 ? Math.max(ratio, 0.8) : ratio)), y0 = p[1] + 0.12, y1 = p[1] + d.h - 0.08, my = (y0 + y1) / 2, hh = y1 - y0;
    const near = size < 1.5 && keeps(DETAIL), glow = T.dk, rkW = rk(0.42);
    const litN = Math.min(cnt, Math.round(((d.lit ?? 0) / cnt0) * cnt)), order = Array.from({ length: cnt }, (_, i) => i).sort(() => r() - 0.5), lit = new Set(order.slice(0, litN));
    const dark: V = mix(mulv([0.22, 0.25, 0.3], T.shade(n)), [0.4, 0.44, 0.52], 0.25 * (1 - glow));
    const warm: V = mix(mix(dark, [0.8, 0.66, 0.44], 0.5), [1.0, 0.78, 0.48], glow);
    const at = (t: number, y: number, out = 0.03): V => { const c = add(p, scale(u, t)); return [c[0] + n[0] * out, y, c[2] + n[2] * out]; };
    const line = (a: V, b: V, w: number, col: V, k: string, alpha = 0.9) => put({ layer: LAYER.ACCENT, kind: K.PULL + EDGE, a, b, width: w, col, alpha, dry: 0.25, rank: DETAIL, key: `${key}/${k}`, taper: [0.005, 0.01] });
    const frameCol = scale(mulv([0.82, 0.8, 0.76], T.shade(n)), 0.95), iron: V = [0.12, 0.12, 0.13];
    for (let i = 0; i < cnt; i++) {
      const t = slot * (i + 0.5), a = at(t - pw / 2, my), b = at(t + pw / 2, my), kr = rng(hashKey(`${key}/s${i}`)), sr = kr();
      // (its state)
      const on = lit.has(i), state = !on ? (sr < 0.06 && glow > 0.3 ? 'lamp' : 'dark') : sr < 0.45 ? 'warm' : sr < 0.65 ? 'curtain' : sr < 0.82 ? 'blinds' : sr < 0.92 ? 'screen' : 'warm';
      const col: V = state === 'dark' || state === 'lamp' ? scale(dark, 1 - 0.3 * glow) : state === 'screen' ? mix(dark, [0.46, 0.6, 0.78], 0.35 + 0.5 * glow) : state === 'curtain' ? mix(warm, [0.95, 0.88, 0.72], 0.35) : warm;
      const lo: V = [Math.min(a[0], b[0]) - 0.02, y0, Math.min(a[2], b[2]) - 0.02], hi: V = [Math.max(a[0], b[0]) + 0.02, y1, Math.max(a[2], b[2]) + 0.02];
      put({ layer: LAYER.ACCENT, kind: K.PULL, a, b, n, width: hh * 1.2, col, col2: scale(col, state === 'dark' ? 1.15 : 1.08), mix2: 0.3, alpha: 1, dry: 0.15 + kr() * 0.2, heart: kr(), rank: rkW, key: `${key}/${i}`, clip: [lo, hi], taper: [0.02, 0.04], crisp: true });
      if (!near) continue;
      // (the room, near: someone in it (a head and shoulders, dark against the light), a lamp, the line of a table or a sofa)
      if (state === 'warm' || state === 'curtain') {
        const ir = kr();
        if (ir < 0.3) { const x = t + (kr() - 0.5) * pw * 0.5, sh: V = mix(warm, [0.22, 0.18, 0.17], 0.7), base = y0 + hh * 0.05, top = y0 + hh * (0.55 + 0.15 * kr());
          put({ layer: LAYER.ACCENT, kind: K.PULL, a: at(x, base, 0.035), b: at(x, top, 0.035), n, width: Math.min(pw * 0.42, 0.52), col: sh, alpha: 0.95, dry: 0.2, rank: DETAIL, key: `${key}/${i}fig`, taper: [0.06, 0.1], crisp: true }); /* (shoulders: the top of the body as wide as they are, rounding over) */
          put({ layer: LAYER.ACCENT, kind: K.DAB, a: at(x, top - 0.02, 0.036), b: at(x, top + 0.24, 0.036), n, width: Math.min(pw * 0.26, 0.26), col: sh, alpha: 0.95, rank: DETAIL, key: `${key}/${i}head` }); }
        else if (ir < 0.5) put({ layer: LAYER.ACCENT, kind: K.PULL, a: at(t - pw * 0.4, y0 + hh * 0.18, 0.035), b: at(t + pw * 0.4, y0 + hh * 0.18, 0.035), n, width: hh * 0.14, col: mix(warm, [0.3, 0.22, 0.18], 0.55), alpha: 0.85, dry: 0.3, rank: DETAIL, key: `${key}/${i}tab`, taper: [0.02, 0.03] });
        else if (ir < 0.65) put({ layer: LAYER.ACCENT, kind: K.DAB, a: at(t + (kr() - 0.5) * pw * 0.6, y0 + hh * 0.5, 0.036), b: at(t + (kr() - 0.5) * pw * 0.6, y0 + hh * 0.62, 0.036), n, width: 0.14, col: [1.0, 0.9, 0.62], alpha: 0.95, rank: DETAIL, key: `${key}/${i}lamp` });
      }
      if (state === 'lamp') put({ layer: LAYER.ACCENT, kind: K.DAB, a: at(t, y0 + hh * 0.45, 0.036), b: at(t, y0 + hh * 0.55, 0.036), n, width: 0.12, col: [1.0, 0.82, 0.52], alpha: 0.9, rank: DETAIL, key: `${key}/${i}lmp` });
      // (drawn curtains: a lighter fall down each side; blinds: slats across)
      if (state === 'curtain') for (const sd of [-1, 1]) put({ layer: LAYER.ACCENT, kind: K.PULL, a: at(t + sd * pw * 0.36, y1 - 0.02, 0.034), b: at(t + sd * pw * 0.38, y0 + 0.02, 0.034), n, width: pw * 0.22, col: mix(warm, [0.97, 0.92, 0.8], 0.6), alpha: 0.9, dry: 0.3, rank: DETAIL, key: `${key}/${i}c${sd}`, taper: [0.01, 0.04] });
      if (state === 'blinds') for (let k = 1; k < 5; k++) line(at(t - pw * 0.48, y0 + (hh * k) / 5, 0.035), at(t + pw * 0.48, y0 + (hh * k) / 5, 0.035), 0.025, mix(warm, [0.35, 0.28, 0.24], 0.5), `${i}b${k}`, 0.7);
      // (the form's own: a frame's cross; a French window's railing across its foot, and shutters either side; mullions between bays)
      if (form === 'frame') { line(at(t, y0, 0.04), at(t, y1, 0.04), 0.035, frameCol, `${i}fv`); line(at(t - pw / 2, y0 + hh * 0.62, 0.04), at(t + pw / 2, y0 + hh * 0.62, 0.04), 0.03, frameCol, `${i}fh`); }
      if (form === 'tall') {
        line(at(t - pw * 0.58, y0 + hh * 0.3, 0.12), at(t + pw * 0.58, y0 + hh * 0.3, 0.12), 0.035, iron, `${i}r`);
        for (let k = 0; k < 4; k++) { const x = t - pw * 0.55 + (pw * 1.1 * k) / 3; line(at(x, y0 - 0.05, 0.12), at(x, y0 + hh * 0.3, 0.12), 0.02, iron, `${i}rv${k}`, 0.8); }
        line(at(t, y0, 0.04), at(t, y1, 0.04), 0.03, frameCol, `${i}fv`);
        if (kr() < 0.4) { const sc = mix(mulv([0.42, 0.5, 0.48], T.shade(n)), mulv([0.42, 0.5, 0.48], T.sunlit), T.mass(n) * 0.6);
          for (const sd of [-1, 1]) put({ layer: LAYER.ACCENT, kind: K.PULL, a: at(t + sd * pw * 0.8, y1, 0.05), b: at(t + sd * pw * 0.8, y0, 0.05), n, width: pw * 0.55, col: sc, alpha: 1, dry: 0.3, rank: DETAIL, key: `${key}/${i}sh${sd}`, taper: [0.01, 0.02] }); }
      }
      if ((form === 'curtain' || form === 'ribbon') && i > 0) line(at(t - slot / 2, y0 - (form === 'curtain' ? 0.1 : 0), 0.04), at(t - slot / 2, y1, 0.04), 0.04, form === 'curtain' ? [0.1, 0.11, 0.12] : frameCol, `${i}m`);
    }
    // (a curtain wall's spandrel: the dark band at each floor, under the glass)
    if (form === 'curtain') put({ layer: LAYER.ACCENT, kind: K.PULL, a: at(0, y0 - 0.12, 0.035), b: at(d.w, y0 - 0.12, 0.035), n, width: 0.22, col: [0.12, 0.13, 0.15], alpha: 0.9, dry: 0.2, rank: rkW, key: `${key}/spandrel`, taper: [0.01, 0.01], crisp: true });
    return;
  }
  if (d.kind === 'dormer') {
    // (a dormer: its cheeks and little roof in the slate, a window in its face (lit or not by its dice), a lighter sill)
    const [p0] = d.pts, nn: V = [d.n[0], 0, d.n[1]], ux: V = [-d.n[1], 0, d.n[0]], w = d.w, h = d.h, at2 = (x: number, y: number, o: number): V => [p0[0] + ux[0] * x + nn[0] * o, p0[1] + y, p0[2] + ux[2] * x + nn[2] * o];
    const slate = T.tone([0.34, 0.4, 0.5], nn), on = (d.lit ?? 0) > 0, wc: V = on ? mix(mix(slate, [0.8, 0.66, 0.44], 0.5), [1.0, 0.78, 0.48], T.dk) : scale(mulv([0.22, 0.25, 0.3], T.shade(nn)), 1 - 0.3 * T.dk);
    put({ layer: LAYER.ACCENT, kind: K.PULL, a: at2(0, h, 0.5), b: at2(0, 0, 0.5), n: nn, width: w * 1.15, col: scale(T.tone([0.8, 0.76, 0.7], nn), 0.95), alpha: 1, dry: 0.3, rank: rk(0.42), key: `${key}/face`, taper: [0.01, 0.02] });
    put({ layer: LAYER.ACCENT, kind: K.PULL, a: at2(0, h * 0.82, 0.52), b: at2(0, h * 0.18, 0.52), n: nn, width: w * 0.62, col: wc, alpha: 1, dry: 0.2, rank: rk(0.42), key: `${key}/win`, taper: [0.01, 0.02], crisp: true, clip: ((c0: V, c1: V): [V, V] => [[Math.min(c0[0], c1[0]) - 0.02, c0[1], Math.min(c0[2], c1[2]) - 0.02], [Math.max(c0[0], c1[0]) + 0.02, c1[1], Math.max(c0[2], c1[2]) + 0.02]])(at2(-w * 0.3, h * 0.2, 0.49), at2(w * 0.3, h * 0.8, 0.56)) });
    put({ layer: LAYER.ACCENT, kind: K.PULL, a: at2(-w * 0.62, h * 0.95, 0.3), b: at2(w * 0.62, h * 0.95, 0.3), n: [0, 1, 0], width: 0.7, col: T.tone([0.34, 0.4, 0.5], [0, 1, 0]), alpha: 1, dry: 0.3, rank: rk(0.42), key: `${key}/roof`, taper: [0.02, 0.04] });
    return;
  }
  if (d.kind === 'wire') {
    // (a wire: one line a span, pole to sag to pole, not a mark a piece)
    if (!keeps(DETAIL)) return;
    for (let i = 0; i + 1 < d.pts.length; i++) put({ layer: LAYER.ACCENT, kind: K.PULL + EDGE, a: d.pts[i], b: d.pts[i + 1], width: 0.03, col: [0.13, 0.13, 0.15], alpha: 0.9, dry: 0.2, rank: DETAIL, key: `${key}/${i}`, taper: [0.02, 0.02] });
    return;
  }
  // (kept as far as the brush goes: further off, painted with it, bigger and fewer)
  const small = d.kind === 'aerial' || d.kind === 'dish' || d.kind === 'laundry' || d.kind === 'rust' || d.kind === 'bin', rank = rk(small ? DETAIL : 0.42);
  if (!keeps(rank)) return;
  DRESS[d.kind](d).forEach((b, j) => {
    const col = mix(dressCol(b), [0.52, 0.52, 0.55], quiet), k = `${key}/${j}`, ext = [b.x1 - b.x0, b.y1 - b.y0, b.z1 - b.z0], order = [0, 1, 2].sort((i, l) => ext[l] - ext[i]);
    const glow = b.tag === TAG.NEON;
    if (b.tag === TAG.RUNGS) { rungs(put, b, scale(mulv(col, T.shade(n)), 0.8), rank, k, size); return; }
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
    brushBox(put, b, col, T, rank, k, LAYER.ACCENT, size, glow);
  });
}

/** Switchback's coverage, over a near plane: strokes scattered by area (`cover` times over, as many as fit, each its own value
 * near the plane's mass, the next value over in the brush as its second pigment, a tint warm or cool of its own), in two sizes, masses then detail, laid the way the
 * surface goes: down a wall, along a roof's long way. Sized by the plane (a big wall broader strokes), so it's the same however
 * it's seen from; capped a plane, the survivors growing to keep the cover. */
function scatter(put: (m: Mark) => void, p: ReturnType<typeof planesOf>[number], col: V, T: ReturnType<typeof tints>, pb: V, m: number, r: () => number, size = 1, rk: (r: number) => number = (x) => x): void {
  // (the brush by the distance too: further off, bigger strokes, so fewer, the same cover)
  const area = p.w * p.h, base = Math.min(3.2, Math.max(0.9, 0.7 + 0.12 * Math.sqrt(area))) * size;
  const lit = (k: number): V => T.tone(pb, p.n, Math.max(0, Math.min(1, k)));
  // (near, more of it: the masses' pass and the detail pass covering more, and a third of small accents a value either side, the
  // brush's last touches)
  for (const [pass, L0, wr, cover, cap] of [['m', base * 2.0, 0.42, 1.25, 26], ['d', base, 0.34, 1.0, 52], ['a', base * 0.55, 0.3, 0.3, 28]] as const) {
    let L = L0, W = L * wr, n = Math.round((area * cover) / (L * W));
    if (n > cap) { const g = Math.sqrt(n / cap); L *= g; W *= g; n = cap; }
    for (let i = 0; i < n; i++) {
      // (where: anywhere on it; which way: down a wall (a little off), along a roof's long way)
      const ang = p.top ? (r() - 0.5) * 0.6 : Math.PI / 2 + (r() - 0.5) * 0.5;
      const along = p.top ? (p.w >= p.h ? 0 : Math.PI / 2) + ang : ang;
      // (uncut, a stroke is kept mostly on its face: its middle far enough in that little more than a tenth of it hangs over)
      const et = (Math.abs(Math.cos(along)) * L + Math.abs(Math.sin(along)) * W) / 2 * 0.85, eu = (Math.abs(Math.sin(along)) * L + Math.abs(Math.cos(along)) * W) / 2 * 0.85;
      const x = p.w > 2 * et ? et + r() * (p.w - 2 * et) : p.w / 2, y = p.h > 2 * eu ? eu + r() * (p.h - 2 * eu) : p.h / 2;
      const ca = Math.cos(along) * L / 2, sa = Math.sin(along) * L / 2, c = add(add(p.o, scale(p.t, x)), scale(p.up, y));
      const a = add(add(c, scale(p.t, -ca)), scale(p.up, -sa)), b = add(add(c, scale(p.t, ca)), scale(p.up, sa));
      // (its value: about the plane's mass (no hard bands: on a shaded wall they broke it into camouflage); a tint of its own)
      // (the accents push further: a wider value either side of the mass, warmer or cooler)
      const acc = pass === 'a', k = Math.max(0, Math.min(1, m + (r() - 0.5) * (acc ? 0.55 : 0.26))), v = (acc ? 0.88 : 0.93) + r() * (acc ? 0.28 : 0.14), warm = (r() - 0.5) * (acc ? 0.16 : 0.1);
      const c1 = mulv(lit(k), [v * (1 + warm), v, v * (1 - warm)]), c2 = lit(k + (r() < 0.5 ? -0.3 : 0.3));
      const down = !p.top && r() < 0.8;
      put({ layer: LAYER.BROAD, kind: K.PULL, a: down ? b : a, b: down ? a : b, n: p.n, width: W, col: pass === 'm' ? mix(c1, col, 0.35) : c1, col2: c2, mix2: 0.35, alpha: 0.92, dry: 0.55 + r() * 0.35, heart: r(), rank: rk(pass === 'm' ? 0.42 : DETAIL + 0.06), load: acc ? 0.85 : 0.6, key: `${p.key}/s${pass}${i}`, clip: p.clip, taper: [W * 0.4, L * 0.35] });
    }
  }
}

export const strokeGouacheRules: StrokeRules = {
  // (the paper: pale, as it always was. The ochre board of the round-four and -five studies was the generator's, not ours; the
  // brush board (?brushes) can use it to judge whites, the game doesn't)
  paper: [0.93, 0.9, 0.84], grain: 1, haze: [0.77, 0.74, 0.83], hazeNear: 0.12, fadeToPaper: 0, sun: DAY_SUN,
  skyField: { top: [0.58, 0.56, 0.7], horizon: [0.89, 0.83, 0.84] },
  city(c, city, put, keeps, light, lod?: Lod) {
    // (the brush for the distance (strokes.ts lodOf): bigger further off; and what it lays kept as far as it's drawn, its rank
    // raised with the brush, so a far roof is painted in a few big strokes rather than left as its flat underpainting)
    const size = lod?.size ?? 1, rk = (r: number) => Math.min(1, r * (1 + 0.32 * (size - 1)));
    // (beyond the near chunks, blocked in: each face its mass's colour flat, its shadow passage, the windows as a few merged bands;
    // no brushwork, no edges, no small things. The strokes are all spent near: the foreground first, the background later)
    const blocked = size > 1;
    const T = tints(light), ox = c.cx * 64, oz = c.cz * 64, up0: V = [0, 1, 0], sKey = `street:${c.cx},${c.cz}`, rnd = rng(hashKey(sKey));
    // (the street: underpainted dark, a few pulls, its shadow)
    {
      const clip: [V, V] = [[ox - 0.01, -1, oz - 0.01], [ox + 64.01, 1, oz + 64.01]], col = T.tone(baseOf(null), up0);
      put(fillOf(`${sKey}/fill`, [ox, 0, oz], [1, 0, 0], [0, 0, 1], up0, 64, 64, scale(col, 0.82), clip, 0.9));
      if (!blocked && keeps(rk(BRUSH))) pulls(put, sKey, [ox, 0, oz], [1, 0, 0], [0, 0, 1], up0, 64, 64, col, scale(mulv(col, T.shade(up0)), 1.15), 6, clip, rk(BRUSH), rnd, size);
      if (keeps(SHADOW)) put(fillOf(`${sKey}/shade`, [ox, 0, oz], [1, 0, 0], [0, 0, 1], up0, 64, 64, scale(mulv(baseOf(null), T.shade(up0)), 0.85), clip, SHADOW, K.SHADE, LAYER.SHADOW));
    }
    const f = light.focus;
    const isFocus = (b: Box) => !!f && Math.abs(b.y1 - f.y) < 0.01 && b.x0 < f.x1 && b.x1 > f.x0 && b.z0 < f.z1 && b.z1 > f.z0;
    for (const b of [...c.boxes, ...c.props]) {
      // (every box keeps its underpainting at any distance: it's solid in depth whatever else is drawn, so is painted; but the
      // small things fixed to a face (a fire escape's posts and steps, a unit, a sign's board) withdraw with the detail)
      const small = !!b.fixture;
      const base = baseOf(b), big = (b.x1 - b.x0) * (b.z1 - b.z0) > 12 && b.y1 - b.y0 > 2, rank = small ? DETAIL : 1;
      if (b.tag === TAG.BAR && blocked) continue;
      if (b.tag === TAG.BAR) {
        // (along its longest axis, whichever: a rail across, a post or a ladder's side up)
        const ext = [b.x1 - b.x0, b.y1 - b.y0, b.z1 - b.z0], ax = ext.indexOf(Math.max(...ext)), m: V = [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, (b.z0 + b.z1) / 2];
        const a: V = [...m] as V, e: V = [...m] as V; a[ax] -= ext[ax] / 2; e[ax] += ext[ax] / 2;
        const thick = Math.min(...ext.filter((_, i) => i !== ax).map((v) => Math.max(v, 0)), 1e9), wide = Math.max(...ext.filter((_, i) => i !== ax));
        put({ layer: LAYER.EDGE, kind: K.PULL + EDGE, a, b: e, width: Math.max(0.04, Math.min(wide, Math.max(thick, 0.04))), col: mulv(base, T.shade([0, 0, 1])), alpha: 1, dry: 0.3, rank: small ? 0.62 : 0.75, key: `bar:${a.join(',')}` });
        continue;
      }
      // (a small thing fixed to a face (a fire escape's step, a unit, a sign's board): laid in pulls, face by face, no flat block)
      if (small && blocked) { for (const p of planesOf(b, [])) put(fillOf(`fx:${p.key}`, p.o, p.t, p.up, p.n, p.w, p.h, T.tone(base, p.n), p.clip, rank)); continue; }
      if (small) { brushBox(put, b, base, T, rank, `fx:${b.x0},${b.y0},${b.z0}`, LAYER.ACCENT, size); continue; }
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
        // (a small thing (a unit, a hut's side, a fire escape's step): laid in pulls, no flat block; a big plane underpainted first)
        if (blocked) { put(fillOf(`${p.key}/fill`, p.o, p.t, p.up, p.n, p.w, p.h, col, p.clip, rank)); if (m > 0.2 && keeps(SHADOW)) put(fillOf(`${p.key}/shade`, p.o, p.t, p.up, p.n, p.w, p.h, scale(mulv(pb, T.shade(p.n)), 0.92), p.clip, SHADOW, K.SHADE, LAYER.SHADOW)); continue; }
        if (p.w * p.h <= 4) { brushPlane(put, p, pb, T, rank, `${p.key}/b`, LAYER.BROAD, size); continue; }
        put(fillOf(`${p.key}/fill`, p.o, p.t, p.up, p.n, p.w, p.h, mix(scale(col, 0.8), scale(mulv(pb, T.deep), 0.85), 0.3), p.clip, rank));
        if (!keeps(rk(BRUSH)) || !big) { scatter(put, p, col, T, pb, m, r, size, rk); continue; }
        if (p.top) pulls(put, p.key, p.o, p.t, p.up, p.n, p.w, p.h, col, col2, Math.max(1, Math.min(4, Math.round(p.h / 3.5))), p.clip, rk(BRUSH), r, size);
        else {
          // (a wall dragged down from its top, in a few broad strokes, drying out toward the street)
          const cols = Math.max(1, Math.min(3, Math.round(p.w / (3.5 * size)))), cw = p.w / cols;
          for (let i = 0; i < cols; i++) {
            const x = (i + 0.5 + (r() - 0.5) * 0.25) * cw, reach = p.h * (0.55 + 0.45 * r());
            const a = add(add(p.o, scale(p.t, x)), [0, p.h + 0.2, 0]), e = add(add(p.o, scale(p.t, x + (r() - 0.5) * 0.4)), [0, p.h - reach, 0]);
            put({ layer: LAYER.BROAD, kind: K.PULL, a, b: e, n: p.n, width: cw * 1.3, col: scale(col, 0.92 + r() * 0.16), col2, mix2: 0.75, alpha: 0.95, dry: 0.6 + r() * 0.3, heart: 0.1, rank: rk(BRUSH), load: 0.7, key: `${p.key}/d${i}`, clip: p.clip, taper: [0.1, Math.min(3, reach * 0.35)] });
          }
          // (weathering: a broken streak or two run down from under the coping)
          for (let i = size < 3 && r() < 0.65 ? 1 + (r() < 0.4 ? 1 : 0) : 0; i > 0; i--) {
            const x = 0.4 + r() * (p.w - 0.8), l = Math.min(p.h - 0.4, 1.5 + r() * 3.5);
            put({ layer: LAYER.BROAD, kind: K.PULL, a: add(add(p.o, scale(p.t, x)), [0, p.h - 0.3, 0]), b: add(add(p.o, scale(p.t, x)), [0, p.h - 0.3 - l, 0]), n: p.n, width: 0.25 + r() * 0.35, col: scale(col, 0.8), alpha: 0.55, dry: 0.7, heart: 0.05, rank: DETAIL, key: `${p.key}/w${i}`, clip: p.clip, taper: [0.05, l * 0.5] });
          }
        }
        // (over the broad strokes, Switchback's coverage: the plane broken into strokes of its own values)
        scatter(put, p, col, T, pb, m, r, size, rk);
        // (its shadow: one passage, masked by the plane's real shadow)
        if (m > 0.2 && keeps(SHADOW)) put(fillOf(`${p.key}/shade`, p.o, p.t, p.up, p.n, p.w, p.h, scale(mulv(pb, T.shade(p.n)), 0.92), p.clip, SHADOW, K.SHADE, LAYER.SHADOW, { col2: mulv(pb, T.deep), mix2: 0.35 }));
      }
    }
    // (the details (dressing.ts), painted as Switchback paints its things: they claim no depth (render.ts), so each is all
    // marks, laid over what's behind it. A window row a mark a pane (lit or not by its dice; lit glows as the light goes);
    // anything thin (a wire, a pole, a rail, a bundle of pipes) one line along it; anything with faces, its faces filled; rust
    // a wash down the wall)
    if (keeps(rk(0.42))) for (const d of c.details) if (!blocked || d.kind === 'windows') paintDetail(d, put, keeps, T, blocked ? 4 : size, rk);
    // (lips: every one a hand can catch keeps its dark line on the roof; near, the full coping too)
    if (!blocked) for (const l of lipsOf(c, city)) {
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
    if (!blocked && keeps(0.36)) for (const h of c.holds) {
      if (h.kind !== 'sill' && h.kind !== 'pipe') continue;
      const n: V = [h.nx, 0, h.nz], a: V = [h.ax, h.ay, h.az], b: V = [h.bx, h.by, h.bz], key = `${h.kind}:${a.map((v) => v.toFixed(2)).join(',')}`, r = rng(hashKey(key));
      const owner = c.boxes.find((o) => a[0] >= o.x0 - 0.02 && a[0] <= o.x1 + 0.02 && a[2] >= o.z0 - 0.02 && a[2] <= o.z1 + 0.02 && o.y1 >= a[1]) ?? null, base = baseOf(owner);
      if (h.kind === 'pipe') { put({ layer: LAYER.ACCENT, kind: K.PULL + EDGE, a: add(a, scale(n, 0.06)), b: add(b, scale(n, 0.06)), width: 0.08, col: scale(mulv(base, T.shade(n)), 0.6), alpha: 0.9, dry: 0.5, rank: DETAIL, key }); continue; }
      const lo: V = [Math.min(a[0], b[0]) - (n[0] ? 1 : 0), a[1] - 0.25, Math.min(a[2], b[2]) - (n[2] ? 1 : 0)], hi: V = [Math.max(a[0], b[0]) + (n[0] ? 1 : 0), a[1] + 0.12, Math.max(a[2], b[2]) + (n[2] ? 1 : 0)];
      put({ layer: LAYER.ACCENT, kind: K.PULL, a: add(a, [0, 0.03, 0]), b: add(b, [0, 0.03, 0]), n, width: 0.11, col: scale(T.tone(base, n), T.mass(n) > 0.5 ? 1.08 : 0.9), alpha: 1, dry: 0.4 + r() * 0.3, heart: r(), rank: 0.36, key: `${key}/ledge`, clip: [lo, hi] });
      put({ layer: LAYER.ACCENT, kind: K.WASH, a: add(a, [0, -0.08, 0]), b: add(b, [0, -0.08, 0]), n, width: 0.08, col: scale(mulv(base, T.shade(n)), 0.7), alpha: 0.55, rank: DETAIL, key: `${key}/under`, clip: [lo, hi] });
    }
  },
  // (the rooms behind the near panes (interiors.ts): a pane's room by its state (a kitchen or a living room lit, curtains, a
  // screen's blue, a lamp in the dark, dark); a residential pane its own room, an office's or a ribbon's panes one room the row
  // long, so its ceiling lights run on behind the mullions; someone in some of the lit ones)
  windows(c) {
    const out: Room[] = [];
    for (const d of c.details) {
      if (d.kind !== 'windows') continue;
      const L = paneLayout(d), shared = L.form === 'curtain' || L.form === 'ribbon', h = L.y1 - L.y0, floorY = Math.floor((L.y0 + 0.05) / STOREY) * STOREY;
      const reveal = L.form === 'curtain' ? 0.07 : L.form === 'ribbon' ? 0.12 : L.form === 'tall' ? 0.3 : 0.22;
      for (const [i, pn] of L.panes.entries()) {
        const kr = rng(hashKey(`${L.key}/room${i}`)), seed = kr(), x0 = pn.t - L.pw / 2, o = add(L.p, scale(L.u, x0)); o[1] = L.y0;
        const lit = pn.state !== 'dark' && pn.state !== 'lamp';
        const type = shared ? (lit ? 3 : 0) : pn.state === 'dark' ? 0 : pn.state === 'lamp' ? 6 : pn.state === 'screen' ? 5 : pn.state === 'curtain' || pn.state === 'blinds' ? 4 : seed < 0.5 ? 1 : 2;
        out.push({ o, u: L.u, n: L.n, w: L.pw, h, D: shared ? 7 : 3.2 + seed * 0.8, L: shared ? x0 : 0.8, R: shared ? d.w - (x0 + L.pw) : 0.8, F: Math.max(0.75, L.y0 - floorY), C: Math.max(0.35, floorY + STOREY - 0.2 - L.y1),
          type, lit: lit ? 1 : 0, seed, occ: lit && (type === 1 || type === 2 ? kr() < 0.45 : type === 3 ? kr() < 0.25 : false) ? 1 : 0, reveal, ox: shared ? x0 : 0 });
      }
    }
    return out;
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
  bodyLight(light) { const T = tints(light); return { sunlit: scale(T.sunlit, 1.08), shade: mix([0.82, 0.8, 0.95], add(T.deep, [0.12, 0.11, 0.15]), T.dk) }; },
  figure(parts, palette, put, light, putSpline) {
    // (several figures at once (the menu's line of characters): each painted on its own; every figure's bones start at its pelvis.
    // Painted together, the parts looked up by name were only the last figure's, and the rest lost their bodies)
    const starts = parts.flatMap((q, i) => (q.name === 'pelvis' ? [i] : []));
    if (starts.length > 1) { starts.forEach((s, k) => strokeGouacheRules.figure(parts.slice(k ? s : 0, starts[k + 1] ?? parts.length), palette, put, light, putSpline)); return; }
    // (all marks, no mask: the body claims no depth (render.ts), so each part is painted whole, far to near, its own body then
    // its lit pull then its accents, the near limbs over the far; contact shadows first, on the ground)
    const T = tints(light), ground: Mark[] = [], items: { d: number; ms: Mark[][] }[] = [];
    // (strokes across joints (Astra's studies): a sleeve shoulder to wrist and a trouser leg hip to ankle as one bent stroke each,
    // where one cloth covers both; and, an arm raised in line with the body (a dive, a reach), one sweep from the hip up the back
    // through the shoulder into the arm. The pose says where the brush lifts, not the skeleton)
    const by = new Map(parts.map((p) => [p.name, p])), chained = new Set<string>();
    // ─── the figure as painted masses, then passages (spline strokes over the body's own surface). Each garment chooses its
    // strokes as a painter would block it in: the jacket as its panels (back, sides, the two fronts), the slope of its shoulders
    // nape to shoulder point, its sleeves hung from there through the elbow to the cuff, its collar round the neck; the neck in
    // the head's shadow, under the jaw; the head as the skull's mass, the brow's turn, the cheek on the sun's side, the jaw over
    // the neck; the hair as locks round the back and sides, clear of the face. Every stroke is fixed on the body (in its bones'
    // own space, seeded by its place, a fixed count: nothing chosen by the eye or by distance), and laid all round a form: a
    // stroke on the far side of a form hides itself (`front`), so the eye decides only what shows, never where paint goes.
    // The finished figure's strokes are painted far to near by form, a garment's layer over the one beneath it (the jacket's
    // hem over the trousers, the jaw over the neck, the hair over the collar).
    // `paint=masses` (paintMode.masses): only the masses, to judge whether the figure reads without its passages.
    const hr = (k: string) => (hashKey(k) % 100000) / 100000;
    const pig = (q: (typeof parts)[number], k: string): V => { const c = (palette[q.mat] ?? palette[0]) as V, lum = c[0] * 0.3 + c[1] * 0.59 + c[2] * 0.11, lift = Math.max(0, 0.26 - lum) * (q.mat % 8 === 1 ? 0.5 : 0.85), v = 0.98 + 0.04 * hr(k + 'v'), w = (hr(k + 'w') - 0.5) * 0.02; /* (one value a form: the light makes the difference, not the stroke) */ return [(c[0] + lift) * v * (1 + w), (c[1] + lift) * v, (c[2] + lift * 1.1) * v * (1 - w)]; };
    const fielded = new Set<string>(), SP: { d: number; s: Spline }[] = [], masses = paintMode.masses;
    if (putSpline) {
      const P3 = (m: Float32Array | number[], x: number, y: number, z: number): V => [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]];
      const D3 = (m: Float32Array | number[], x: number, y: number, z: number): V => unit([m[0] * x + m[4] * y + m[8] * z, m[1] * x + m[5] * y + m[9] * z, m[2] * x + m[6] * y + m[10] * z]);
      type Bn = NonNullable<(typeof parts)[number]['bone']>;
      type V4 = [V, V, V, V]; type N4 = [number, number, number, number];
      /** put a stroke: at a form's distance, less a layer's lift (a garment over what's under it) */
      const ps = (s: Spline, d: number, layer = 0) => { SP.push({ d: d - layer * 0.02, s }); };
      /** a chain's surface: s along it (0..1 over its bones by length, past either end extrapolated), θ round it (0 its +x, π/2 its +z) */
      const surf = (bs: Bn[], s: number, th: number, puff: number) => {
        const lens = bs.map((b) => Math.abs(b.y1 - b.y0)), tot = lens.reduce((a, b) => a + b, 0) || 1; let at = s * tot, k = 0;
        while (k < bs.length - 1 && at > lens[k]) { at -= lens[k]; k++; }
        const b = bs[k], fr = at / (lens[k] || 1), f = Math.max(0, Math.min(1, fr)), fy = Math.max(-0.35, Math.min(1.35, fr)), y = b.y0 + (b.y1 - b.y0) * fy, hw = ((b.w0 + (b.w1 - b.w0) * f) / 2) * puff, hd = ((b.d0 + (b.d1 - b.d0) * f) / 2) * puff;
        const c = Math.cos(th), sn = Math.sin(th), x = (b.x ?? 0) + c * hw, z = (b.zc ?? 0) + sn * hd;
        return { p: P3(b.m, x, y, z), n: D3(b.m, c / Math.max(hw, 1e-4), 0, sn / Math.max(hd, 1e-4)), r: (hw + hd) / 2, t: Math.hypot(hw * sn, hd * c), len: tot };
      };
      type Ease = number | ((s: number) => number);
      const ez = (e: Ease, s: number) => (typeof e === 'number' ? e : e(s));
      const run = (bs: Bn[], ss: number[], th: (s: number, i: number) => number, puff: Ease) => { const q = ss.map((s, i) => surf(bs, s, th(s, i), ez(puff, s))); return { c: q.map((x) => x.p) as V4, n: q.map((x) => x.n) as V4, r: q.map((x) => x.r) as N4, t: q.map((x) => x.t) as N4, len: q[0].len }; };
      const lerp4 = (a: number, b: number): N4 => [a, a + (b - a) / 3, a + ((b - a) * 2) / 3, b];
      /** a form's panels: n broad strokes all round it, along it from s0 to s1, each as wide as its share of the girth (and a
       * little over, so they meet), each its own value of the pigment; the masses */
      const panels = (key: string, qs: (typeof parts)[number][], o: { n: number; s0: number; s1: number; puff: Ease; th0?: number; grow?: number; layer?: number }) => {
        const bs = qs.map((q) => q.bone!).filter(Boolean) as Bn[]; if (bs.length !== qs.length) return; const q0 = qs[0], d = qs.reduce((t, q) => t + q.dist, 0) / qs.length;
        for (let i = 0; i < o.n; i++) {
          const k = `${key}p${i}`, th = (o.th0 ?? 0) + (2 * Math.PI * i) / o.n + (hr(k) - 0.5) * 0.12, R = run(bs, lerp4(o.s0, o.s1), () => th, o.puff), g = o.grow ?? 1;
          const share = (2 * Math.PI) / o.n;
          ps({ ctrl: R.c, surfs: R.n, widths: R.t.map((t, j) => 2 * t * Math.sin(share / 2) * 1.32 * (1 + (g - 1) * (j / 3))) as N4, col: pig(q0, k), load: 0.65, dry: 0.12, heart: 0.35, body: 0.001, key: k, rank: 1, front: true, taper: [R.len * 0.04, R.len * 0.07] }, d, o.layer ?? 0);
        }
        for (const q of qs) fielded.add(q.name);
      };
      /** a form's passages: narrower strokes along it, a value off the masses, fixed round it (seeded), all round */
      const along = (key: string, qs: (typeof parts)[number][], o: { n: number; s0: number; s1: number; puff: Ease; w: number; layer?: number }) => {
        if (masses) return; const bs = qs.map((q) => q.bone!).filter(Boolean) as Bn[]; if (bs.length !== qs.length) return; const q0 = qs[0], d = qs.reduce((t, q) => t + q.dist, 0) / qs.length;
        for (let i = 0; i < o.n; i++) {
          const k = `${key}a${i}`, th = (2 * Math.PI * (i + hr(k + 't'))) / o.n, a = o.s0 + (o.s1 - o.s0) * hr(k + 's0') * 0.25, b = o.s1 - (o.s1 - o.s0) * hr(k + 's1') * 0.3;
          const R = run(bs, lerp4(a, b), (s) => th + (hr(k + 'b') - 0.5) * 0.3 * Math.sin(s * 3), (s: number) => ez(o.puff, s) * 1.01), lt = hr(k + 'c') > 0.5;
          ps({ ctrl: R.c, surfs: R.n, widths: R.r.map((r) => r * o.w) as N4, col: scale(pig(q0, k), lt ? 1.05 : 0.95), load: 0.75, dry: 0.4, heart: 0.3, body: 0.001, key: k, rank: 0.8, front: true }, d - 0.001, o.layer ?? 0);
        }
      };
      /** a band round a form at s (a hem, a cuff, a waistband): two half rings, each shown from its own side */
      const band = (key: string, qs: (typeof parts)[number][], s: number, puff: number, wd: number, col: V, layer: number) => {
        const bs = qs.map((q) => q.bone!).filter(Boolean) as Bn[]; if (bs.length !== qs.length) return; const d = qs.reduce((t, q) => t + q.dist, 0) / qs.length;
        for (const h of [0, 1]) { const k = `${key}b${h}`, R = run(bs, [s, s, s, s], (_, i) => h * Math.PI + (i / 3) * Math.PI * 1.08 - 0.04, puff);
          ps({ ctrl: R.c, surfs: R.n, widths: [wd * 0.85, wd, wd, wd * 0.85], col, load: 0.6, dry: 0.2, heart: 0.4, body: 0.001, key: k, rank: 0.9, front: true, taper: [wd * 0.3, wd * 0.3] }, d - 0.002, layer); }
      };
      const skinOf = (q: (typeof parts)[number]) => ({ ...q, mat: q.mat - (q.mat % 8) });
      const pe = by.get('pelvis'), to = by.get('torso'), hd = by.get('head');
      // (the legs: a trouser leg (or a bare one) hip to ankle as four panels, through the knee; passages down it)
      for (const n of ['L', 'R']) { const th = by.get('thigh' + n), sh = by.get('shin' + n); if (!th || !sh) continue;
        if (th.mat === sh.mat) { const legE: Ease = th.mat % 8 === 0 ? 1.0 : (s) => 1.25 + 0.5 * Math.max(0, s - 0.4) ** 1.2; /* (a trouser leg hangs straight from the knee: wider than the shin toward the ankle) */
          panels(`f:leg${n}`, [th, sh], { n: 4, s0: -0.1, s1: 1.02, puff: legE, th0: 0.4 }); along(`f:leg${n}`, [th, sh], { n: 4, s0: 0, s1: 1, puff: legE, w: 0.45 }); }
        else { panels(`f:thigh${n}`, [th], { n: 4, s0: -0.12, s1: 1.06, puff: 1.1, th0: 0.4 }); panels(`f:shin${n}`, [sh], { n: 4, s0: -0.04, s1: 1.02, puff: sh.mat % 8 === 0 ? 1.0 : 1.08, th0: 0.4 }); } }
      // (the trunk: the hips, and over them the top as its panels (back, two sides, two fronts meeting at the middle), the top's
      // hem over the hips; then the shoulders' slope; the sleeves hung from the shoulder points)
      if (pe && to?.bone) {
        const same = pe.mat === to.mat, tb = to.bone;
        if (!same) panels('f:hips', [pe], { n: 4, s0: -0.15, s1: 1.1, puff: 1.1, th0: Math.PI / 4 });
        const trunk = same ? [pe, to] : [to], s0 = same ? -0.05 : -0.12, layer = same ? 0 : 1;
        const topE = (s: number) => 1.2 + 0.28 * (1 - Math.max(0, Math.min(1, (s - s0 - 0.1) / (0.93 - s0 - 0.1)))) ** 0.8; /* (a top: close at the shoulder, looser down the body, fullest where it blouses over its hem) */
        // (the back, the sides, and the fronts each side of the middle: the fronts' meeting is the opening a jacket has)
        { const bs = trunk.map((q) => q.bone!) as Bn[], d = to.dist;
          const P: [string, number, number][] = [['back', -Math.PI / 2, 1.0], ['sideL', 0.05, 1.05], ['sideR', Math.PI - 0.05, 1.05], ['frontL', Math.PI / 2 - 0.42, 0.6], ['frontR', Math.PI / 2 + 0.42, 0.6]];
          for (const [nm, th, wf] of P) { const k = `f:top:${nm}`, R = run(bs, lerp4(s0, 0.93), () => th, topE);
            ps({ ctrl: R.c, surfs: R.n, widths: R.t.map((t, j) => t * 2 * wf * (1.05 - 0.08 * j / 3)) as N4, col: pig(to, k), load: 0.65, dry: 0.12, heart: 0.35, body: 0.001, key: k, rank: 1, front: true, taper: [R.len * 0.03, R.len * 0.06] }, d, layer); }
          for (const q of trunk) fielded.add(q.name);
          // (the drape: from each shoulder point, where the top hangs from, strokes fanning down across the front and the back toward
          // the other hip, sagging as cloth does; a value either side of the masses)
          if (!masses) for (const [fn, f] of [['F', Math.PI / 2], ['B', -Math.PI / 2]] as const) for (const sd of [-1, 1]) for (let i = 0; i < 3; i++) {
            const k = `f:drape${fn}${sd}${i}`, ta = f + sd * (1.2 - 0.12 * i) * (f > 0 ? 1 : -1), tb2 = f - sd * (0.15 + 0.32 * i + (hr(k) - 0.5) * 0.2) * (f > 0 ? 1 : -1);
            const sa = 0.9 - 0.05 * i, sb = s0 + 0.06 + 0.12 * i + 0.06 * hr(k + 's'), R = run(bs, [0, 1, 2, 3].map((j) => sa + (sb - sa) * (j / 3)), (_, j) => { const e = j / 3; return ta + (tb2 - ta) * (e * e * (3 - 2 * e)); }, (s: number) => topE(s) * 1.012);
            ps({ ctrl: R.c, surfs: R.n, widths: R.r.map((r, j) => r * (0.3 + 0.12 * Math.sin((j / 3) * Math.PI))) as N4, col: scale(pig(to, k), i % 2 ? 0.97 : 1.035), load: 0.75, dry: 0.4, heart: 0.3, body: 0.001, key: k, rank: 0.8, front: true }, d - 0.001, layer); }
          // (its hem: a band round the bottom, the cloth gathered there a value darker)
          band('f:tophem', trunk, s0 + 0.035, topE(s0) * 1.02, Math.abs(tb.y1 - tb.y0) * 0.08, scale(pig(to, 'f:tophem'), 0.88), layer + 0.5); }
        // (the shoulders' slope: from the collar out over the top to each shoulder point, behind and in front, a little down
        // as it goes; the line a jacket hangs from)
        for (const sd of [-1, 1]) for (const fb of [-1, 1]) {
          const k = `f:yoke${sd}${fb}`, y1 = tb.y1, yl = Math.abs(tb.y1 - tb.y0), hw = tb.w1 / 2, hdp = tb.d1 / 2, x0 = tb.x ?? 0, z0 = (tb.zc ?? 0) + fb * hdp * 0.45;
          const pts = [0.18, 0.45, 0.75, 1.02].map((f) => P3(tb.m, x0 + sd * hw * f, y1 + yl * (0.035 - 0.1 * f * f), z0)) as V4, nn = D3(tb.m, sd * 0.25, 0.75, fb * 0.65);
          ps({ ctrl: pts, surfs: [nn, nn, nn, nn], widths: [hdp * 1.0, hdp * 1.05, hdp * 1.0, hdp * 0.85], col: scale(pig(to, k), fb < 0 ? 1.04 : 1.0), load: 0.6, dry: 0.15, heart: 0.35, body: 0.001, key: k, rank: 1, front: true, taper: [hdp * 0.2, hdp * 0.3] }, to.dist - 0.003, layer + 1);
        }
      }
      // (the sleeves: from the shoulder point through the elbow to the cuff, three panels round, wider toward the cuff, as a sleeve
      // hangs; bare arms the same, in skin and close)
      for (const n of ['L', 'R']) { const ua = by.get('upperArm' + n), fa = by.get('foreArm' + n); if (!ua || !fa) continue;
        const cloth = ua.mat % 8 !== 0;
        if (ua.mat === fa.mat) { const armE: Ease = cloth ? (s) => (s > 0.93 ? 1.18 : 1.25 + 0.4 * Math.max(0, s) ** 1.2) : 1.0; /* (a sleeve: close at the shoulder, fuller to the forearm, gathered at the cuff) */
          panels(`f:arm${n}`, [ua, fa], { n: 3, s0: -0.1, s1: 0.95, puff: armE, th0: 0.3, layer: 1 }); along(`f:arm${n}`, [ua, fa], { n: 3, s0: 0, s1: 0.92, puff: armE, w: 0.4, layer: 1 });
          if (cloth) { const L = Math.abs(ua.bone!.y1 - ua.bone!.y0) + Math.abs(fa.bone!.y1 - fa.bone!.y0); band(`f:cuff${n}`, [ua, fa], 0.955, 1.22, L * 0.07, scale(pig(ua, `f:cuff${n}`), 0.9), 1.5); } }
        else { panels(`f:ua${n}`, [ua], { n: 3, s0: -0.12, s1: 1.04, puff: cloth ? 1.12 : 1.0, th0: 0.3, layer: 1 }); panels(`f:fa${n}`, [fa], { n: 3, s0: -0.05, s1: 1.02, puff: fa.mat % 8 ? 1.12 : 1.0, th0: 0.3, layer: 1 }); } }
      // (the neck: from inside the collar to under the jaw, in the head's shadow; then the collar round it (a passage), the head
      // over both)
      if (to?.bone && hd?.bone) {
        const tb = to.bone, hb = hd.bone, sk = skinOf(hd), rN = Math.min(hb.w0, hb.d0) * 0.24, a = P3(tb.m, tb.x ?? 0, tb.y1 * 0.97, (tb.zc ?? 0) - tb.d1 * 0.05), b = P3(hb.m, hb.x ?? 0, hb.y0 + Math.abs(hb.y1 - hb.y0) * 0.22, (hb.zc ?? 0) - hb.d0 * 0.1);
        const m1 = add(scale(a, 0.67), scale(b, 0.33)), m2 = add(scale(a, 0.33), scale(b, 0.67));
        ps({ ctrl: [a, m1, m2, b], widths: [rN * 2.3, rN * 2.0, rN * 2.0, rN * 2.1], col: scale(pig(sk, 'f:neck'), 0.74), load: 0.55, dry: 0.12, heart: 0.4, body: 0.001, key: 'f:neck', rank: 1 }, hd.dist + 0.02, 0);
        // (the collar: a band standing round the neck's foot, from one side of the front, round behind, to the other; under the
        // hair at the back, over the shoulder's line in front)
        if (!masses && to.mat % 8 !== 0) { const cr = rN * 1.75, ch = Math.abs(tb.y1 - tb.y0) * 0.11, x0 = tb.x ?? 0, z0 = (tb.zc ?? 0) - tb.d1 * 0.05, cc = add(pig(to, 'f:collar'), [0.035, 0.03, 0.03]);
          for (const [k, a0, a1] of [['f:collarL', Math.PI / 2 + 0.55, 1.5 * Math.PI], ['f:collarR', 1.5 * Math.PI, 2.5 * Math.PI - 0.55]] as const) {
            const as = lerp4(a0, a1), pts = as.map((t) => P3(tb.m, x0 + Math.cos(t) * cr, tb.y1 + ch * 0.35, z0 + Math.sin(t) * cr * 1.1)) as V4, ns = as.map((t) => D3(tb.m, Math.cos(t), 0.25, Math.sin(t))) as V4;
            ps({ ctrl: pts, surfs: ns, widths: [ch * 0.8, ch, ch, ch * 0.8], col: cc, load: 0.6, dry: 0.2, heart: 0.35, body: 0.001, key: k, rank: 0.9, front: true, taper: [ch * 0.4, ch * 0.5] }, to.dist - 0.01, 2); } }
      }
      // (the head: an ellipsoid round its bone (φ from its top, θ round it, π/2 its face))
      if (hd?.bone) {
        const b = hd.bone, front = Math.PI / 2, d = hd.dist;
        const hw = ((b.w0 + b.w1) / 4) * 1.04, hh = (Math.abs(b.y1 - b.y0) / 2) * 1.04, hdp = ((b.d0 + b.d1) / 4) * 1.04, yc = (b.y0 + b.y1) / 2 + Math.abs(b.y1 - b.y0) * 0.03, xc = b.x ?? 0, zc = b.zc ?? 0, r0 = (hw + hdp) / 2;
        const E = (ph: number, th: number, pf = 1) => { const sp = Math.sin(ph), cp = Math.cos(ph), c = Math.cos(th), sn = Math.sin(th);
          return { p: P3(b.m, xc + c * sp * hw * pf, yc + cp * hh * pf, zc + sn * sp * hdp * pf), n: D3(b.m, (c * sp) / hw, cp / hh, (sn * sp) / hdp) }; };
        const E4 = (f: (i: number) => [number, number, number?]) => { const q = [0, 1, 2, 3].map((i) => { const [ph, th, pf] = f(i); return E(ph, th, pf ?? 1); }); return { c: q.map((x) => x.p) as V4, n: q.map((x) => x.n) as V4 }; };
        const sk = skinOf(hd), fc = pig(sk, 'f:face'), sg = hd.sunSide > 0 ? 1 : -1, hcol = pig(hd, 'f:hair'), dk = scale(hcol, 0.75);
        // (a face is flatter at the front than the skull: its planes' normals drawn toward the face's own forward, so the light
        // splits it side to side (the cheek turning away) and not, as on an egg, across the mouth)
        const fwd = D3(b.m, 0, 0.12, 1), flat = (n: V4) => n.map((x) => unit(add(x, scale(fwd, 1.6)))) as V4;
        const face = (s: Spline, layer: number) => ps({ load: 0.55, dry: 0.08, heart: 0.45, body: 0.001, rank: 1, front: true, ...s, surfs: s.key === 'f:jaw' ? undefined : s.surfs && !s.key.startsWith('f:side') ? flat(s.surfs) : s.surfs }, d, layer);
        // (the block-in: the head's whole shape in the hair's dark, on its axis a little behind the middle, facing the eye; the
        // face laid over it, so the hair stays round it as its silhouette from any side)
        { const lo = [-0.05, -0.3, -0.55, -0.75].map((c) => P3(b.m, xc, yc + c * hh, zc - hdp * 0.2)) as V4;
          ps({ ctrl: lo, widths: [hw * 1.75, hw * 1.6, hw * 1.25, hw * 0.8], col: scale(fc, 0.8), load: 0.55, dry: 0.15, heart: 0.35, body: 0.001, key: 'f:headblockLo', rank: 1, taper: [r0 * 0.2, r0 * 0.4] }, d + 0.001, 0); /* (below the ears the head's block is the face's shade, not the hair's: no beard round the chin) */
          const pts = [1.1, 0.5, 0.0, -0.3].map((c) => P3(b.m, xc, yc + c * hh, zc - hdp * 0.35)) as V4;
          ps({ ctrl: pts, widths: [hw * 1.3, hw * 2.05, hw * 1.95, hw * 1.5], col: scale(hcol, 0.82), load: 0.55, dry: 0.15, heart: 0.35, body: 0.001, key: 'f:headblock', rank: 1, taper: [r0 * 0.4, r0 * 0.5] }, d, 0); }
        // (the face's masses: the face one plane, brow to chin, narrowing to the chin; a plane down each side of it, cheek to jaw
        // (the sun's side lighter, the other darker: the face's turn, which says where it looks); the brow's turn, a short darker
        // stroke across under it; the jaw ear to ear, over the neck)
        { const q = E4((i) => [0.95 + 0.6 * i, front]); face({ ctrl: q.c, surfs: q.n, widths: [hw * 1.45, hw * 1.4, hw * 1.15, hw * 0.65], col: fc, key: 'f:face', taper: [r0 * 0.15, r0 * 0.2] }, 1); }
        for (const s of [-1, 1]) { const lit = s === sg, q = E4((i) => [1.3 + 0.42 * i, front + s * (1.12 - 0.08 * i)]);
          face({ ctrl: q.c, surfs: q.n, widths: [r0 * 0.85, r0 * 1.05, r0 * 0.95, r0 * 0.6], col: scale(fc, lit ? 1.06 : 0.78), key: `f:side${s}`, taper: [r0 * 0.2, r0 * 0.3] }, 1); }
        // (the face's few planes, where they're seen: the sockets a band of shade under the brow, the nose's shaded side, the
        // mouth a short dark touch; no eyes: the planes say where it looks)
        if (!masses) {
          { const q = E4((i) => [1.42 + 0.05 * Math.sin((i / 3) * Math.PI), front + (i / 3 - 0.5) * 1.25, 1.01]); face({ ctrl: q.c, surfs: q.n, widths: [r0 * 0.14, r0 * 0.22, r0 * 0.22, r0 * 0.14], col: scale(fc, 0.8), alpha: 0.7, key: 'f:sockets', taper: [r0 * 0.15, r0 * 0.15] }, 2); }
          { const q = E4((i) => [1.48 + 0.15 * i, front - sg * 0.13, 1.02]); face({ ctrl: q.c, surfs: q.n, widths: [r0 * 0.06, r0 * 0.1, r0 * 0.12, r0 * 0.1], col: scale(fc, 0.82), alpha: 0.75, key: 'f:nose', taper: [r0 * 0.05, r0 * 0.05] }, 2); }
          { const q = E4((i) => [2.18, front + (i / 3 - 0.5) * 0.42, 1.01]); face({ ctrl: q.c, surfs: q.n, widths: [r0 * 0.03, r0 * 0.06, r0 * 0.06, r0 * 0.03], col: scale(fc, 0.7), alpha: 0.7, key: 'f:mouth', taper: [r0 * 0.04, r0 * 0.04] }, 2); }
        }
        { const q = E4((i) => [2.55 + 0.1 * Math.sin((i / 3) * Math.PI), front + (i / 3 - 0.5) * 2.4, 1.02]); face({ ctrl: q.c, surfs: q.n, widths: [r0 * 0.25, r0 * 0.35, r0 * 0.35, r0 * 0.25], col: scale(fc, 0.9), key: 'f:jaw', front: false, taper: [r0 * 0.2, r0 * 0.2] }, 2); }
        // (the hair's mass: the crown, from over the brow back; the skull round the back to the nape, darker, in four; down each
        // temple to the top of the ear; clear of the face)
        const hairM = (k: string, f: (i: number) => [number, number, number?], wd: N4, col: V) => { const q = E4(f); ps({ ctrl: q.c, surfs: q.n, widths: wd, col, load: 0.6, dry: 0.2, heart: 0.3, body: 0.001, key: k, rank: 1, front: true, taper: [r0 * 0.2, r0 * 0.45] }, d, 3); };
        hairM('f:crown', (j) => [-0.1 + 0.4 * j, front, 1.04], [hw * 1.8, hw * 2.0, hw * 1.9, hw * 1.6], scale(hcol, 0.92));
        for (let i = 0; i < 4; i++) { const th = front + Math.PI + (i - 1.5) * 0.85; hairM(`f:skull${i}`, (j) => [0.05 + (2.4 - 0.3 * Math.abs(i - 1.5)) * (j / 3), th + (i - 1.5) * 0.08 * j, 1.02], [hw * 0.95, hw * 1.15, hw * 1.1, hw * 0.75], i % 2 ? dk : scale(hcol, 0.85)); }
        for (const s of [-1, 1]) hairM(`f:temple${s}`, (j) => [0.2 + 0.55 * j, front + s * (1.6 - 0.1 * j), 1.04], [hw * 1.0, hw * 1.0, hw * 0.85, hw * 0.45], scale(hcol, s === sg ? 1.0 : 0.8));
        // (passages: the locks, from near the crown over the skull, ending in tapers at the nape and behind the ears (never across
        // the face: those toward it end at the temple); a fringe over the brow; flicks off the ends)
        if (!masses) {
          const nL = 12;
          for (let i = 0; i < nL; i++) {
            const k = `f:hl${i}`, th = front + Math.PI + (i / (nL - 1) - 0.5) * 2 * 2.2 + (hr(k + 't') - 0.5) * 0.2, toFace = Math.cos(th - front); if (toFace > 0.3) continue;
            const ph1 = 2.4 - Math.max(0, toFace + 0.4) * 1.1 + (hr(k + 'e') - 0.5) * 0.25, sw = (hr(k + 'w') - 0.5) * 0.35, ph0 = 0.08 + 0.12 * hr(k + 's'), w = r0 * (0.5 + 0.25 * hr(k + 'd')), lit = hr(k + 'c') > 0.65;
            const q = E4((j) => { const f = j / 3; return [ph0 + (ph1 - ph0) * f, th + sw * f * f, 1.03 + 0.04 * Math.sin(f * 3)]; });
            ps({ ctrl: q.c, surfs: q.n, widths: [w * 0.7, w, w * 0.85, w * 0.4], col: lit ? add(scale(hcol, 1.15), [0.04, 0.035, 0.03]) : pig(hd, k), load: 0.7, dry: 0.4, heart: 0.3, body: 0.001, key: k, rank: 0.9, front: true, taper: [r0 * 0.15, r0 * 0.7] }, d, 4);
          }
          for (let i = 0; i < 4; i++) { const k = `f:hf${i}`, th = front + (i / 3 - 0.5) * 1.3 + (hr(k + 't') - 0.5) * 0.15, ph1 = 0.75 + 0.2 * hr(k + 'e'), q = E4((j) => [0.1 + (ph1 - 0.1) * (j / 3), th + (i - 1.5) * 0.08 * (j / 3), 1.04]);
            ps({ ctrl: q.c, surfs: q.n, widths: [r0 * 0.36, r0 * 0.45, r0 * 0.36, r0 * 0.14], col: pig(hd, k), load: 0.65, dry: 0.4, heart: 0.3, body: 0.001, key: k, rank: 0.95, front: true, taper: [r0 * 0.1, r0 * 0.5] }, d, 4); }
          for (let i = 0; i < 6; i++) { const k = `f:ht${i}`, th = front + (i - 2.5) * 0.9 + (hr(k) - 0.5) * 0.4, ph = 0.25 + 0.5 * hr(k + 'p'), q = E4((j) => [ph + 0.12 * j, th + (hr(k + 'd') - 0.5) * 0.25 * j, 1.0 + 0.07 * j]);
            ps({ ctrl: q.c, surfs: q.n, widths: [r0 * 0.14, r0 * 0.12, r0 * 0.08, r0 * 0.03], col: i % 2 ? dk : pig(hd, k), load: 0.6, dry: 0.45, heart: 0.3, body: 0.001, key: k, rank: 0.7, front: true, taper: [0.002, r0 * 0.3] }, d, 4); }
          for (let i = 0; i < 3; i++) { const k = `f:hk${i}`, th = front + Math.PI + (i - 1) * 1.1 + (hr(k + 't') - 0.5) * 0.4, q = E4((j) => [2.1 + 0.18 * j, th + 0.15 * j * j, 1.03 + 0.1 * j]);
            ps({ ctrl: q.c, surfs: q.n, widths: [r0 * 0.18, r0 * 0.14, r0 * 0.1, r0 * 0.05], col: dk, load: 0.6, dry: 0.4, heart: 0.3, body: 0.001, key: k, rank: 0.8, front: true, taper: [0.002, r0 * 0.4] }, d, 4); }
        }
        fielded.add(hd.name);
      }
      // (what's worn over the garments (a collar's flaps, a neckerchief, socks, a hood, a cap, a bag, a ponytail): a flap (a thin
      // block) one flat stroke down it, seen from either side; anything with depth its panels round it; each over what it sits on)
      for (const q of parts) { if (q.kind !== 'worn' || q.grid || !q.bone) continue; const b = q.bone, w = (b.w0 + b.w1) / 2, dp = (b.d0 + b.d1) / 2;
        if (dp < 0.35 * w) { const k = `f:${q.name}:${Math.round(q.a[0] * 1000)}:${Math.round(q.a[2] * 1000)}`, ys = lerp4(b.y0, b.y1), nn = D3(b.m, 0, 0, 1);
          ps({ ctrl: ys.map((y, i) => P3(b.m, b.x ?? 0, y, b.zc ?? 0)) as V4, surfs: [nn, nn, nn, nn], widths: ys.map((_, i) => b.w0 + ((b.w1 - b.w0) * i) / 3) as N4, col: pig(q, k), load: 0.6, dry: 0.12, heart: 0.4, body: 0.001, key: k, rank: 1, taper: [w * 0.08, w * 0.12] }, q.dist, 3); }
        else panels(`f:${q.name}:${Math.round(q.a[0] * 1000)}`, [q], { n: 3, s0: -0.04, s1: 1.04, puff: 1.04, th0: 0.5, layer: 3 });
        fielded.add(q.name); }
      // (the shoes: along the foot, heel to toe (its block's z; its y is the shoe's height): its top, its two sides, the sole a
      // value darker, the toe rounded; and the ankle, a short stroke from inside the trouser leg down into the shoe)
      for (const n of ['L', 'R']) { const ft = by.get('foot' + n); if (!ft?.bone) continue; const b = ft.bone, x0 = b.x ?? 0, zc = b.zc ?? 0, h = Math.abs(b.y1 - b.y0), wd = (b.w0 + b.w1) / 2, dz = (Math.min(b.d0, b.d1) + Math.max(b.d0, b.d1)) / 4 * 1.04, yt = Math.max(b.y0, b.y1), yb = Math.min(b.y0, b.y1);
        const zs = lerp4(zc - dz, zc + dz), along = (k: string, x: number, y: number, nn: V, w: N4, col: V) => ps({ ctrl: zs.map((z, i) => P3(b.m, x, y + (i === 3 ? (y > yb + h * 0.5 ? -h * 0.25 : h * 0.15) : 0), z)) as V4, surfs: [nn, nn, nn, nn], widths: w, col, load: 0.65, dry: 0.12, heart: 0.4, body: 0.001, key: k, rank: 1, front: true, taper: [w[0] * 0.3, w[3] * 0.6] }, ft.dist, 1.2);
        const c = pig(ft, `f:shoe${n}`);
        along(`f:shoe${n}t`, x0, yt - h * 0.1, D3(b.m, 0, 1, 0.15), [wd * 0.95, wd * 1.05, wd * 1.05, wd * 0.8], c);
        for (const sd of [-1, 1]) along(`f:shoe${n}s${sd}`, x0 + sd * wd * 0.45, (yt + yb) / 2, D3(b.m, sd, 0.1, 0), [h * 0.95, h * 1.0, h, h * 0.8], scale(c, 0.97));
        along(`f:shoe${n}b`, x0, yb + h * 0.08, D3(b.m, 0, -0.3, 0), [wd * 0.9, wd, wd, wd * 0.7], scale(c, 0.7));
        { const tz = zc + dz * 0.95, tc = [-1, -0.35, 0.35, 1].map((t) => P3(b.m, x0 + t * wd * 0.48, (yt + yb) / 2, tz + (1 - t * t) * dz * 0.06)) as V4, tn = D3(b.m, 0, 0.3, 1);
          ps({ ctrl: tc, surfs: [tn, tn, tn, tn], widths: [h * 0.8, h * 0.9, h * 0.9, h * 0.8], col: scale(c, 1.03), load: 0.6, dry: 0.12, heart: 0.4, body: 0.001, key: `f:toe${n}`, rank: 1, front: true, taper: [h * 0.3, h * 0.3] }, ft.dist - 0.002, 1.3); }
        const sh = by.get('shin' + n); if (sh?.bone) { const sb = sh.bone, a = P3(sb.m, sb.x ?? 0, sb.y1 * 0.92, sb.zc ?? 0), bb = P3(b.m, x0, yt - h * 0.2, zc - dz * 0.35), w = (sb.w1 + sb.d1) / 2;
          ps({ ctrl: [a, add(scale(a, 0.67), scale(bb, 0.33)), add(scale(a, 0.33), scale(bb, 0.67)), bb], widths: [w, w * 0.95, w * 0.95, w * 0.9], col: pig(sh, `f:ankle${n}`), load: 0.6, dry: 0.15, heart: 0.4, body: 0.001, key: `f:ankle${n}`, rank: 1 }, sh.dist, 0.8); }
        fielded.add(ft.name); }
      // (the hands: one shape, palm through the fingers to their tips, a little fuller than the bones; the thumb its own; a hand that
      // holds or is planted a value darker and closed)
      for (const n of ['L', 'R']) { const pa = by.get('palm' + n), fi = by.get('fingers' + n), ti = by.get('tips' + n), th = by.get('thumb' + n), tt = by.get('thumbtip' + n);
        const grip = [pa, fi, ti].some((q) => q?.gripping || q?.planted), sk = (q: (typeof parts)[number]) => (grip ? { ...q, mat: q.mat } : q);
        if (pa?.bone && fi?.bone && ti?.bone) { panels(`f:hand${n}`, [sk(pa), sk(fi), sk(ti)], { n: 3, s0: -0.12, s1: 1.08, puff: 1.18, th0: 0.4, layer: 2 }); }
        if (th?.bone && tt?.bone) panels(`f:thumb${n}`, [th, tt], { n: 2, s0: -0.1, s1: 1.08, puff: 1.12, th0: 0.6, layer: 2.1 }); }
      // (anything else of the body not painted yet: panels round its own block)
      for (const q of parts) { if (fielded.has(q.name) || q.grid || !q.bone || q.kind === 'worn') continue;
        panels(`f:${q.name}`, [q], { n: 4, s0: -0.08, s1: 1.08, puff: 1.06, th0: 0.4, layer: 1 }); fielded.add(q.name); }
      for (const nme of fielded) chained.add(nme);
    }
    // (a painter's value range: dark cloth painted lighter where the light takes it, a little toward the light's colour, so a near
    // black can still be modelled; pale cloth a little cooler in its shade)
    /** an old mark as a spline: its line (a, its path, b) through four points by length; facing the eye; its width, colour, edge */
    const toSpline = (m: Mark): Spline => { const pts = [m.a, ...(m.path ?? []), m.b], sl = pts.slice(1).map((p, i) => len(sub(p, pts[i]))), tot = sl.reduce((a, b) => a + b, 0) || 1;
      const at = (f: number): V => { let dd = f * tot, i = 0; while (i < sl.length - 1 && dd > sl[i]) { dd -= sl[i]; i++; } return add(pts[i], scale(sub(pts[i + 1], pts[i]), Math.min(1, dd / (sl[i] || 1)))); };
      return { ctrl: [at(0), at(1 / 3), at(2 / 3), at(1)], widths: [m.width, m.width, m.width, m.width], col: m.col, alpha: m.alpha, dry: m.dry, heart: m.heart, taper: m.taper, rank: m.rank, key: m.key, body: 0.001, load: 0.6 }; };
    const detail = (d: number, ms: Mark[]) => { for (const m of ms) SP.push({ d: d - 0.0015, s: toSpline(m) }); };
    const tonesOf = (p: (typeof parts)[number]) => { const col = (palette[p.mat] ?? palette[0]) as V, lum = col[0] * 0.3 + col[1] * 0.59 + col[2] * 0.11, lift = Math.max(0, 0.3 - lum) * 0.75;
      const dark = mulv(col, mix([0.55, 0.57, 0.68], scale(T.deep, 0.8), T.dk)), lit0 = mulv(col, mix([1.05, 1.05, 1.05], T.sunlit, T.dk)), lit = add(lit0, scale(mix([1.0, 0.96, 0.92], T.sunlit, T.dk), lift)), front = smooth(-0.35, 0.45, p.sunFront);
      return { dark, lit, front, tone: mix(dark, lit, 0.45 + 0.35 * front) }; };
    // (a hand in contact (closed on a hold, or planted): the sleeve ends hard at the wrist, and the hand is one compact, hard
    // edged mark round what it holds, a thin dark line under it where it meets it: contact as the point of the picture)
    const contact = { L: ['palmL', 'fingersL', 'tipsL'].some((k) => by.get(k)?.gripping || by.get(k)?.planted), R: ['palmR', 'fingersR', 'tipsR'].some((k) => by.get(k)?.gripping || by.get(k)?.planted) };
    for (const n of ['L', 'R'] as const) {
      const pa = by.get('palm' + n), fi = by.get('fingers' + n), ti = by.get('tips' + n); if (!contact[n] || !pa || !fi || !ti) continue;
      chained.add(pa.name); chained.add(fi.name); chained.add(ti.name);
      const skin = (palette[pa.mat - (pa.mat % 8)] ?? palette[0]) as V, sk = scale(mulv(skin, mix([0.92, 0.9, 0.94], T.sunlit, T.dk * 0.6)), 0.86), w = pa.width * 1.25;
      const low = [pa.b, fi.b, ti.b].reduce((q, r) => (r[1] < q[1] ? r : q)), along = unit(pa.side), cl = scale(along, w * 0.75);
      if (putSpline) { detail(Math.min(pa.dist, fi.dist, ti.dist) - 0.004, [{ layer: 0, kind: K.PULL, a: sub(low, cl), b: add(low, cl), width: 0.018, col: scale(T.deep, 0.32), alpha: 0.85, dry: 0, rank: 1, key: `fig:contact${n}`, taper: [0.004, 0.004] }]); continue; }
      items.push({ d: Math.min(pa.dist, fi.dist, ti.dist) - 0.004, ms: [[
        { layer: 0, kind: K.PULL + EDGE, a: sub(low, cl), b: add(low, cl), width: 0.022, col: scale(T.deep, 0.32), alpha: 0.85, dry: 0, rank: 1, key: `fig:contact${n}` },
        { layer: 0, kind: K.PULL, a: pa.a, b: ti.b, path: [pa.b, fi.b], side: pa.side, width: w, col: sk, mix2: 0, alpha: 1, dry: 0, heart: 0.5, rank: 1, key: `fig:grip${n}`, taper: [0.006, 0.008] },
      ]] });
    }
    // ─── the form (the rig says where and how big; the brush says what shape). A body part's profile, by how far along it: its
    // width (a share of the part's width as seen) and how far its middle sits toward the part's front (+) or back (-). From how
    // bodies are built, not from the blocks: a thigh full at the hip, the quad forward, narrowing to the knee; a calf swelling
    // behind the shin below the knee, slim at the ankle; a deltoid capping the arm; a forearm full below the elbow, tapering to
    // the wrist. Loose cloth over it softens the shape toward a plain tube; skin shows it all
    type Prof = [number, number, number][];   // [t, width, toward front]
    const PROF: Record<string, Prof> = {
      thigh: [[0, 1.12, 0.02], [0.3, 1.05, 0.07], [0.7, 0.86, 0.03], [1, 0.74, 0]],
      shin: [[0, 0.8, 0], [0.25, 0.92, -0.09], [0.6, 0.72, -0.04], [1, 0.52, 0]],
      upperArm: [[0, 1.1, 0.03], [0.18, 1.06, 0.0], [0.6, 0.86, -0.03], [1, 0.8, 0]],
      foreArm: [[0, 0.86, 0], [0.22, 0.95, 0.02], [0.7, 0.72, 0], [1, 0.58, 0]],
    };
    const profAt = (pr: Prof, t: number): [number, number] => { for (let i = 1; i < pr.length; i++) if (t <= pr[i][0]) { const a = pr[i - 1], b = pr[i], k = (t - a[0]) / (b[0] - a[0] || 1), e = k * k * (3 - 2 * k); return [a[1] + (b[1] - a[1]) * e, a[2] + (b[2] - a[2]) * e]; } const l = pr[pr.length - 1]; return [l[1], l[2]]; };
    /** a chain of parts as a form: its middle line through the joints, bent by each part's profile toward front or back as seen,
     * and its width at each point; loose cloth (not skin) eases the profile toward a tube */
    const formOf = (ps: (typeof parts)[number][]) => {
      const pts: V[] = [], ws: number[] = [], SAMPLES = [0, 0.3, 0.65];
      ps.forEach((q, qi) => {
        const pr = PROF[q.kind.replace(/[LR]$/, '')], cloth = q.mat % 8 !== 0, ease = cloth ? 0.55 : 1;
        const dir = unit(sub(q.b, q.a)), sd = (() => { const s0 = sub(q.side, scale(dir, dot(q.side, dir))); return len(s0) > 1e-4 ? unit(s0) : q.side; })(), toward = dot(q.fwd, sd);
        // (a thigh starts up inside the hips, so the leg grows out of the seat rather than stopping at the joint)
        if (qi === 0 && q.kind.startsWith('thigh')) { pts.push(sub(q.a, scale(dir, q.width * 0.45))); ws.push(q.width * (cloth ? 1.2 : 1.05)); }
        for (const t of qi === ps.length - 1 ? [...SAMPLES, 1] : SAMPLES) {
          const [wf, of] = pr ? profAt(pr, t) : [1, 0], wk = 1 + (wf - 1) * ease;
          pts.push(add(add(q.a, scale(sub(q.b, q.a), t)), scale(sd, of * ease * q.width * 1.6 * toward)));
          ws.push(q.width * wk * (cloth ? 1.24 : 1.08));
        }
      });
      return { pts, ws };
    };
    /** paint a form: one mass along it, a found edge on the shadow side (a dark contour that comes and goes), a lost one on the
     * light (a lit stroke only where the form turns toward the sun) */
    const paintForm = (ps: (typeof parts)[number][], key: string): Mark[][] => { const f = formOf(ps); return paintPts(ps[0], f.pts, f.ws, key); };
    const paintPts = (p0: (typeof parts)[number], pts: V[], ws: number[], key: string, side: V = p0.side): Mark[][] => {
      const { dark, lit, front, tone } = tonesOf(p0), sg = Math.sign(p0.sunSide) || 1;
      const acrossAt = (i: number) => { const d = unit(sub(pts[Math.min(pts.length - 1, i + 1)], pts[Math.max(0, i - 1)])), s0 = sub(side, scale(d, dot(side, d))); return len(s0) > 1e-4 ? unit(s0) : side; };
      const edge = (k: number, f: number) => pts.map((q, i) => add(q, scale(acrossAt(i), k * ws[i] * f)));
      const n = pts.length, wMid = ws[Math.floor(n / 2)];
      const mass: Mark = { layer: 0, kind: K.PULL, a: pts[0], b: pts[n - 1], path: pts.slice(1, -1), widths: ws.map((w) => w * 1.12), side, width: wMid * 1.12, col: tone, col2: mix(tone, lit, 0.3), mix2: 0.3, alpha: 1, dry: 0.45, heart: 0.2, rank: 1, key, body: 0.85, taper: [ws[0] * 0.25, ws[n - 1] * 0.3] };
      const sh = edge(-sg, 0.4), cw = ws.map((w) => w * 0.17);
      const found: Mark = { layer: 0, kind: K.PULL, a: sh[0], b: sh[n - 1], path: sh.slice(1, -1), widths: cw, side, width: wMid * 0.17, col: mix(dark, tone, 0.25), mix2: 0, alpha: 0.75, dry: 0.12, heart: 0.5, rank: 1, key: `${key}/found`, taper: [wMid * 0.4, wMid * 0.6] };
      // (no contour: the silhouette is where the strokes' own broken ends stop)
      void found; const lights: Mark[] = [];
      if (front > 0.15) { const lt = edge(sg, 0.22).slice(1, -1); if (lt.length >= 2) lights.push({ layer: 0, kind: K.PULL, a: lt[0], b: lt[lt.length - 1], path: lt.slice(1, -1), side, width: wMid * 0.3, col: scale(lit, 1.05), mix2: 0, alpha: 0.75, dry: 0.5, heart: 0.4, rank: 1, key: `${key}/lit`, taper: [wMid * 0.5, wMid * 0.8] }); }
      // (pass two, the modelling: across the form at stations along it, a cool half-tone laid in from the shadow side toward the
      // middle, a warm plane laid out from the middle on the lit side, each bent a little with the form's turn; so the form reads
      // round, not a tinted tube. Smaller than the mass, withdrawn first at a distance)
      const cool = mix(mix(dark, tone, 0.35), mulv(tone, [0.78, 0.8, 1.0]), 0.35), warm = add(mix(tone, lit, 0.9), [0.05, 0.03, 0.0]);
      // (as bands along the form, following its width: cross strokes stacked into arrowheads)
      { const band = (k: number, f: number, wf: number, col: V, alpha: number, tag: string): Mark => { const q = edge(k, f); return { layer: 0, kind: K.PULL, a: q[0], b: q[n - 1], path: q.slice(1, -1), widths: ws.map((w) => w * wf), side, width: wMid * wf, col, mix2: 0, alpha, dry: 0.15, heart: 0.4, rank: 0.55, key: `${key}/${tag}`, body: 0.45, taper: [wMid * 0.2, wMid * 0.3] }; };
        lights.push(band(-sg, 0.22, 0.38, cool, 0.7, 'cool'));
        if (front > 0.05) { const top = band(sg, 0.2, 0.3, add(warm, [0.05, 0.05, 0.04]), 0.85 * Math.min(1, front * 1.5), 'warm'); top.dry = 0.45; lights.push(top); } }
      return [[mass], lights];
    };
    // (the torso as a form: hips, a waist (eased under loose cloth), the ribcage full, the shoulders, narrowing to the neck; the
    // seat a little behind and the chest a little before, as it faces. Two masses, each its own cloth's colour, lapped at the
    // waist; and the slope from the neck down into each shoulder)
    { const to = by.get('torso'), pe = by.get('pelvis');
      if (to && pe && to.endOn < 0.7 && !fielded.has('torso')) {
        const up = unit(sub(to.b, to.a)), sd = (() => { const s0 = sub(to.side, scale(up, dot(to.side, up))); return len(s0) > 1e-4 ? unit(s0) : to.side; })();
        const toward = dot(to.fwd, sd), hipW = Math.max(Math.abs(dot(sub(pe.b, pe.a), sd)) + pe.width * 0.35, to.width * 0.8), loose = to.mat % 8 !== 0 ? 0.55 : 1;
        const lv = (t: number, of: number): V => add(add(to.a, scale(sub(to.b, to.a), t)), scale(sd, of * to.width * toward));
        const hip = add(scale(add(pe.a, pe.b), 0.5), scale(up, -0.05));
        const low = [add(hip, scale(sd, -0.06 * to.width * toward)), lv(0.0, -0.02), lv(0.2, 0)], lowW = [hipW * 1.02, hipW * 0.98, to.width * (1 - 0.18 * loose)];
        const upP = [lv(0.12, 0), lv(0.6, 0.05), lv(0.88, 0.02), add(to.b, scale(up, 0.02))], upW = [to.width * (1 - 0.16 * loose), to.width * 1.04, to.width * 0.98, to.width * 0.55];
        chained.add(to.name); chained.add(pe.name);
        // (the seat: one stroke across, hip to hip, its height crotch to waist, the middle dropped a little (the seat's curve);
        // the legs' forms start up inside it)
        { const { tone, lit } = tonesOf(pe), crotch = add(scale(add(pe.a, pe.b), 0.5), scale(up, -0.07)), waist = lv(0.16, 0), mid = scale(add(crotch, waist), 0.5), h = len(sub(waist, crotch)) * 1.25, half = hipW * 0.42;
          void low; void lowW;
          items.push({ d: pe.dist + 0.001, ms: [[{ layer: 0, kind: K.PULL, a: add(mid, scale(sd, -half)), b: add(mid, scale(sd, half)), path: [add(mid, scale(up, -h * 0.08))], side: up, width: h, col: tone, col2: mix(tone, lit, 0.25), mix2: 0.25, alpha: 1, dry: 0.05, heart: 0.5, rank: 1, key: 'fig:hips', body: 0.85, taper: [h * 0.18, h * 0.18] }]] }); }
        const ms = paintPts(to, upP, upW, 'fig:chest', sd);
        // (wrapped: three broad strokes across the torso, diagonal and bending round it, each a third of its height, the ones
        // toward the light lighter and warmer; their ends ragged past its edge, as the sketch's are)
        { const { tone, lit, dark } = tonesOf(to), h = len(sub(to.b, to.a)), sg = Math.sign(to.sunSide) || 1;
          for (let k = 0; k < 3; k++) {
            const t = 0.22 + 0.27 * k, c = lv(t, 0.02), w0 = to.width * (0.62 + 0.05 * k), tilt = scale(up, h * 0.16 * (k % 2 ? -1 : 1));
            const a = add(add(c, scale(sd, -w0)), tilt), b = add(sub(c, tilt), scale(sd, w0)), mid = add(c, scale(up, h * 0.04));
            const col = k === 1 ? mix(tone, lit, 0.55) : k === 0 ? mix(tone, sg > 0 ? lit : dark, 0.3) : tone;
            ms[1].push({ layer: 0, kind: K.PULL, a: sg > 0 ? b : a, b: sg > 0 ? a : b, path: [mid], side: up, width: h * 0.36, col, col2: mix(col, lit, 0.3), mix2: 0.3, alpha: 1, dry: 0.55, heart: 0.25, rank: 0.6, key: `fig:wrap${k}`, taper: [h * 0.06, h * 0.18], body: 0.3 });
          } }
        for (const n of ['L', 'R']) { const ua = by.get('upperArm' + n); if (!ua) continue; const { tone } = tonesOf(to), neck = add(to.b, scale(up, 0.01)), mid = add(scale(add(neck, ua.a), 0.5), scale(up, 0.035));
          ms[0].push({ layer: 0, kind: K.PULL, a: neck, b: ua.a, path: [mid], side: up, width: to.width * 0.28, col: tone, mix2: 0, alpha: 1, dry: 0.1, rank: 1, key: `fig:trap${n}`, taper: [to.width * 0.08, to.width * 0.1] }); }
        items.push({ d: to.dist, ms });
      } }
    for (const n of ['L', 'R']) for (const [u, l] of [['upperArm', 'foreArm'], ['thigh', 'shin']]) {
      const pu = by.get(u + n), pl = by.get(l + n);
      if (fielded.has(u + n)) continue;
      // (one gesture only while the joint is open: folded sharply (a tuck, a crouch) the two are two masses, painted apart)
      if (!pu || !pl || pu.mat !== pl.mat || pu.endOn > 0.45 || pl.endOn > 0.45 || dot(unit(sub(pu.b, pu.a)), unit(sub(pl.b, pl.a))) < 0.15) continue;
      chained.add(pu.name); chained.add(pl.name);
      const ms = paintForm([pu, pl], `fig:${u}${n}+`);
      // (a hand in contact: the sleeve ends hard at the wrist, no dry tail)
      if (u === 'upperArm' && contact[n as 'L' | 'R']) for (const m of ms.flat()) { m.taper = [m.taper?.[0] ?? 0.02, 0.006]; m.dry = 0; }
      items.push({ d: Math.max(pu.dist, pl.dist), ms });
    }
    { const to = by.get('torso'), pe = by.get('pelvis');
      if (to && pe && !fielded.has('torso')) {
        // (the arm most in line with the body's long axis, raised along it)
        const up = unit(sub(to.b, to.a)); let best: { k: number; u: (typeof parts)[number]; f: (typeof parts)[number] } | null = null;
        for (const n of ['L', 'R']) { const u = by.get('upperArm' + n), f = by.get('foreArm' + n); if (!u || !f) continue; const k = dot(up, unit(sub(u.b, u.a))); if (k > 0.55 && (!best || k > best.k)) best = { k, u, f }; }
        if (best) { const { tone, lit } = tonesOf(to), hip = scale(add(pe.a, pe.b), 0.5), w = to.width * 0.75;
          items.push({ d: to.dist + 0.004, ms: [[{ layer: 0, kind: K.PULL, a: hip, b: best.f.b, path: [to.b, best.u.a, best.u.b], side: to.side, width: w, col: tone, col2: mix(tone, lit, 0.4), mix2: 0.45, alpha: 0.95, dry: 0.35, heart: 0.3, rank: 1, key: 'fig:sweep', taper: [w * 0.3, w * 0.9] }]] }); }
      } }
    // (seen from behind, the view the player has: the back isn't a rectangle with bars on it. One broad pull across it from the
    // shoulder on the sun's side down to the other hip, a value up from the cloth; and the hem lifted over a thigh coming up)
    { const to = by.get('torso'), pe = by.get('pelvis'), sl = by.get('upperArmL'), sr = by.get('upperArmR');
      if (to && pe && sl && sr && dot(to.fwd, to.toEye) < -0.25 && !fielded.has('torso')) {
        const { tone, lit, dark } = tonesOf(to), sunL = (sl.sunSide + sl.sunFront) >= (sr.sunSide + sr.sunFront);
        const sh = sunL ? sl.a : sr.a, hip = len(sub(pe.a, sh)) > len(sub(pe.b, sh)) ? pe.a : pe.b, w = to.width * 0.85, mid = scale(add(sh, hip), 0.5); /* (across the back: the far hip; broad, so it's the back turning, not a strap) */
        const pull: Mark = { layer: 0, kind: K.PULL, a: sh, b: hip, path: [add(mid, scale(to.side, (sunL ? -1 : 1) * to.width * 0.08))], side: to.side, width: w, col: add(mix(tone, scale(lit, 1.35), 0.55), [0.02, 0.02, 0.03]), col2: tone, mix2: 0.55, alpha: 0.7, dry: 0.65, heart: 0.2, rank: 1, key: 'fig:back', taper: [w * 0.45, w * 1.1] };
        const ms: Mark[] = [pull];
        const up = unit(sub(to.b, to.a));
        for (const n of ['L', 'R']) { const th = by.get('thigh' + n); if (!th) continue; const lift = -dot(unit(sub(th.b, th.a)), up);
          // (a thigh forward and up: the hem over it lifted, a short dark pull angled up across the bottom of the back)
          if (lift < 0.55) { const c0 = scale(add(pe.a, pe.b), 0.5), over = add(th.a, scale(sub(th.b, th.a), 0.25));
            ms.push({ layer: 0, kind: K.PULL, a: c0, b: add(over, scale(up, to.width * 0.15)), side: to.side, width: to.width * 0.16, col: scale(dark, 0.85), mix2: 0, alpha: 0.85, dry: 0.3, rank: 1, key: `fig:hem${n}`, taper: [0.02, 0.04] }); } }
        items.push({ d: to.dist - 0.003, ms: [ms] });
      } }
    // (cloth (a skirt, a coat): a column of its quads, waist to hem, one bent stroke, lit by its own face, so a fold turns light
    // to dark across the hem and the cloth is a sheet, not a pile of blocks)
    const hemOf: { col: string; q: (typeof parts)[number] }[] = [];
    const pe0 = ((q) => (q ? scale(add(q.a, q.b), 0.5) : null))(by.get('pelvis'));
    { const cols = new Map<string, (typeof parts)[number][]>();
      for (const q of parts) if (q.grid) { const k = `${q.mat}:${q.grid[0]}`; (cols.get(k) ?? cols.set(k, []).get(k)!).push(q); }
      for (const [k, qs] of cols) {
        qs.sort((x, y) => x.grid![1] - y.grid![1]); const q0 = qs[0], last = qs[qs.length - 1];
        const col = (palette[q0.mat] ?? palette[0]) as V, dark = mulv(col, mix([0.55, 0.57, 0.68], scale(T.deep, 0.8), T.dk)), lit = mulv(col, mix([1.05, 1.05, 1.05], T.sunlit, T.dk));
        const f = qs.reduce((t, q) => add(t, dot(q.fwd, q.toEye) >= 0 ? q.fwd : scale(q.fwd, -1)), [0, 0, 0] as V), face = smooth(-0.25, 0.55, dot(unit(f), T.S));
        const w = qs.reduce((t, q) => t + q.gw!, 0) / qs.length, tone = mix(dark, lit, 0.3 + 0.55 * face), down = unit(sub(last.bot!, q0.top!));
        const across = (() => { const sd = cross(down, q0.toEye); return len(sd) > 1e-4 ? unit(sd) : q0.side; })();
        for (const q of qs) chained.add(q.name + '#' + q.grid!.join(','));
        hemOf.push({ col: k, q: last });
        // (as splines: the column's line, waist to hem, through four points along it; its surface the quads' own faces, so a
        // stroke turns edge-on where the cloth folds away; and over it, on every other column, a narrower stroke a value off,
        // so a fold reads as light against dark, not as one flat sheet)
        if (putSpline) {
          const line = [...qs.map((q) => q.top!), last.bot!], nrm = qs.map((q) => (dot(q.fwd, q.toEye) >= 0 ? q.fwd : scale(q.fwd, -1)));
          const segL = line.slice(1).map((p, i) => len(sub(p, line[i]))), tot = segL.reduce((a, b) => a + b, 0) || 1;
          const at = (f: number) => { let d = f * tot, i = 0; while (i < segL.length - 1 && d > segL[i]) { d -= segL[i]; i++; } const t = Math.min(1, d / (segL[i] || 1)); return { p: add(line[i], scale(sub(line[i + 1], line[i]), t)), n: nrm[Math.min(i, nrm.length - 1)] }; };
          // (flared: the cloth pushed out from the column's top, more toward the hem, as a skirt swings and a coat streams; the
          // painter pushes the cloth further than the body)
          const fs = [0, 1 / 3, 2 / 3, 1].map(at), gi = q0.grid![0], top0 = fs[0].p;
          for (let j = 1; j < 4; j++) { const p = fs[j].p, off: V = [p[0] - top0[0], 0, p[2] - top0[2]], f = [0, 0.04, 0.1, 0.2][j], ax = pe0 ? [p[0] - pe0[0], 0, p[2] - pe0[2]] as V : off, al = Math.hypot(ax[0], ax[2]) || 1, L = len(sub(p, top0));
            fs[j] = { ...fs[j], p: add(p, scale([ax[0] / al, 0, ax[2] / al], L * f)) }; }
          SP.push({ d: qs.reduce((t, q) => t + q.dist, 0) / qs.length - 0.04, s: { ctrl: fs.map((x) => x.p) as [V, V, V, V], surfs: fs.map((x) => x.n) as [V, V, V, V], widths: [w * 1.4, w * 1.55, w * 1.65, w * 1.75], col: pig(q0, `c${k}`), load: 0.7, dry: 0.15, heart: 0.3, body: 0.001, key: `fig:cloth${k}`, rank: 1, taper: [0.004, w * 0.3]  } });
          if (gi % 2 === 0) { const ls = [0.12, 0.4, 0.68, 0.98].map(at), up = face > 0.5;
            SP.push({ d: qs.reduce((t, q) => t + q.dist, 0) / qs.length - 0.041, s: { ctrl: ls.map((x) => x.p) as [V, V, V, V], surfs: ls.map((x) => x.n) as [V, V, V, V], widths: [w * 0.3, w * 0.5, w * 0.55, w * 0.4], col: scale(pig(q0, `c${k}l`), up ? 1.12 : 0.85), load: 0.75, dry: 0.35, heart: 0.3, body: 0.001, key: `fig:fold${k}`, rank: 0.8, taper: [w * 0.2, w * 0.4]  } }); }
          continue;
        }
        items.push({ d: qs.reduce((t, q) => t + q.dist, 0) / qs.length, ms: [[{ layer: 0, kind: K.PULL, a: q0.top!, b: last.bot!, path: qs.slice(1).map((q) => q.top!), side: across, width: w * 1.15, col: tone, col2: mix(tone, lit, 0.3), mix2: 0.25, alpha: 1, dry: 0.12, heart: 0.3, rank: 1, key: `fig:cloth${k}`, body: 0.85, taper: [0.004, w * 0.25] }]] });
      } }
    // (the hem swirled: one or two strokes round the cloth's bottom row (where it's seen), lighter where it lifts)
    { const by2 = new Map<number, (typeof parts)[number][]>(); for (const h of hemOf) { const mt = h.q.mat; (by2.get(mt) ?? by2.set(mt, []).get(mt)!).push(h.q); }
      for (const [mt, qs] of by2) { const seen = qs.filter((q) => dot(q.fwd, q.toEye) > -0.35).sort((x, y) => x.grid![0] - y.grid![0]); if (seen.length < 3) continue;
        const pts = seen.map((q) => add(scale(add(q.top!, q.bot!), 0.5), scale(sub(q.bot!, q.top!), 0.25))), q0 = seen[0], { tone, lit } = tonesOf(q0), w = len(sub(q0.bot!, q0.top!)) * 0.75;
        // (as splines: the hem in runs of four quads, each run one stroke round it, overlapping the next by one)
        if (putSpline) { for (let i = 0; i + 3 < seen.length + 2; i += 3) { const ix = [0, 1, 2, 3].map((j) => Math.min(seen.length - 1, i + j)); if (ix[0] === ix[3]) break;
            const qq = ix.map((j) => seen[j]); SP.push({ d: Math.min(...seen.map((q) => q.dist)) - 0.05, s: { ctrl: ix.map((j) => pts[j]) as [V, V, V, V], surfs: qq.map((q) => (dot(q.fwd, q.toEye) >= 0 ? q.fwd : scale(q.fwd, -1))) as [V, V, V, V], widths: [w * 0.6, w, w, w * 0.6], col: scale(pig(q0, `hem${mt}${i}`), 1.1), alpha: 0.85, load: 0.6, dry: 0.45, heart: 0.35, body: 0.001, key: `fig:hem${mt}:${i}`, rank: 0.6, taper: [w * 0.3, w * 0.6]  } }); }
          continue; }
        items.push({ d: Math.min(...seen.map((q) => q.dist)) - 0.002, ms: [[{ layer: 0, kind: K.PULL, a: pts[0], b: pts[pts.length - 1], path: pts.slice(1, -1), side: unit(sub(q0.bot!, q0.top!)), width: w, col: mix(tone, lit, 0.6), col2: tone, mix2: 0.3, alpha: 0.85, dry: 0.5, heart: 0.35, rank: 0.6, key: `fig:hem${mt}`, taper: [w * 0.3, w * 0.8], body: 0.45 }]] }); } }
    for (const p of [...parts].sort((x, y) => y.dist - x.dist)) {
      if (chained.has(p.name) || (p.grid && chained.has(p.name + '#' + p.grid.join(',')))) continue;
      const body: Mark[] = [], lights: Mark[] = [], accents: Mark[] = [], under = { push: (..._m: Mark[]) => 0 };
      items.push({ d: p.dist, ms: [body, lights, accents] });
      const col = (palette[p.mat] ?? palette[0]) as V, dark = mulv(col, mix([0.55, 0.57, 0.68], scale(T.deep, 0.8), T.dk)), lit = mulv(col, mix([1.05, 1.05, 1.05], T.sunlit, T.dk));
      // (what's worn takes the light by its own face (a skirt's quads, a coat's: so a fold turns light to dark), the body's
      // parts by how their turned faces meet it)
      const face = p.kind === 'worn' ? (dot(p.fwd, p.toEye) >= 0 ? p.fwd : scale(p.fwd, -1)) : null;
      const front = face ? smooth(-0.25, 0.55, dot(face, T.S)) : smooth(-0.35, 0.45, p.sunFront), tone = mix(dark, lit, (face ? 0.3 : 0.45) + (face ? 0.55 : 0.35) * front), key = `fig:${p.name}`;
      // (a little past each end, so the marks overlap at the joints)
      const ext = scale(unit(sub(p.b, p.a)), Math.min(0.06, p.width * 0.35)), pa = sub(p.a, ext), pb = add(p.b, ext);
      const m = (o: Partial<Mark>): Mark => ({ layer: 0, kind: K.PULL, a: pa, b: pb, side: p.side, width: p.width * 1.2, col: tone, col2: mix(tone, lit, 0.35), mix2: 0.35, alpha: 1, dry: 0.2, heart: 0.25, rank: 1, key, body: 0.75, ...o });
      // (the lit pull: narrower, on the sun's side of it, where its turned face can be seen)
      // (and the turned-away side: a narrow dark pull along the edge away from the sun, which models it as the mask once did
      // all round)
      const litPull = (k: number) => {
        const sg = Math.sign(p.sunSide) || 1, rt = Math.min(p.width * 0.3, 0.05);
        if (front > 0.1) { const off = scale(p.side, sg * p.width * 0.22); lights.push(m({ a: add(pa, off), b: add(pb, off), width: p.width * (k + 0.1), col: scale(lit, 1.06), mix2: 0, alpha: 0.9, dry: 0.5, key: `${key}/lit`, taper: [rt, rt * 1.5] })); }
        const off2 = scale(p.side, -sg * p.width * 0.4); lights.push(m({ a: add(pa, off2), b: add(pb, off2), width: p.width * 0.28, col: scale(dark, 0.8), mix2: 0, alpha: 0.85, dry: 0.3, key: `${key}/turn`, taper: [rt, rt * 1.5] }));
      };
      // (seen end-on, a limb's pull shortens to nothing: its mass as a dab, so the body's depth is covered)
      if (p.endOn > 0.45 && p.kind !== 'head') { const c = scale(add(p.a, p.b), 0.5), up = scale(unit(cross(p.side, p.toEye)), p.girth * 0.5); under.push(m({ kind: K.DAB, a: sub(c, up), b: add(c, up), width: p.girth * 1.25, col: scale(dark, 0.45), key: `${key}/endU` })); body.push(m({ kind: K.PULL, a: sub(c, scale(up, 0.85)), b: add(c, scale(up, 0.85)), width: p.girth * 1.0, dry: 0.1, taper: [p.girth * 0.2, p.girth * 0.3], key: `${key}/end` })); } /* (a short stroke, not a soft dab: no blurred circles) */
      switch (p.kind) {
        case 'head': { if (fielded.has('head')) break;
          // (the head in strokes, not dabs: the face a pull down its plane (forehead to chin) with a darker plane on the shadow
          // side of cheek and jaw; the hair a broad stroke bent over the crown, a mass down the back, fringe strokes toward the
          // brow where the face is seen, a lock down each side, one lighter stroke for its sheen and one darker for its depth)
          const skin = (palette[p.mat - (p.mat % 8)] ?? col) as V, d = unit(sub(p.b, p.a)), c = scale(add(p.a, p.b), 0.5), facing = dot(p.fwd, p.toEye), L = p.length, w = p.width;
          const fw = unit(sub(p.fwd, scale(d, dot(p.fwd, d)))), bk = scale(fw, -1), sd = unit(p.side), sg = Math.sign(p.sunSide) || 1;
          const sk = mix(mulv(skin, mix([0.62, 0.6, 0.68], scale(T.deep, 0.85), T.dk)), mulv(skin, mix([1.04, 1.02, 1.0], T.sunlit, T.dk)), 0.4 + 0.45 * front);
          const at = (u: number, v: number, f: number): V => add(add(add(c, scale(d, L * u)), scale(sd, w * v)), scale(fw, w * f));
          const st = (a: V, b: V, width: number, colr: V, key2: string, o: Partial<Mark> = {}): Mark => ({ layer: 0, kind: K.PULL, a, b, side: sd, width, col: colr, mix2: 0, alpha: 1, dry: 0.15, heart: 0.4, rank: 1, key: `${key}/${key2}`, taper: [width * 0.25, width * 0.45], ...o });
          // (the face, where it's seen)
          if (facing > -0.35) {
            body.push(st(at(-0.46, 0, 0.18), at(0.3, 0, 0.18), w * 0.84, sk, 'face', { side: sd, taper: [w * 0.22, w * 0.12] }));
            // (the jaw: a short stroke across the bottom of the face, so the chin is round, not the face stroke's point)
            body.push(st(at(-0.36, -0.3, 0.16), at(-0.36, 0.3, 0.16), L * 0.2, sk, 'jaw', { side: d, taper: [w * 0.12, w * 0.12] }));
            body.push(st(at(-0.42, -sg * 0.27, 0.08), at(0.15, -sg * 0.3, 0.05), w * 0.3, mix(sk, scale(sk, 0.72), 0.7), 'cheek', { alpha: 0.85 }));
          }
          const hair = tone, hl = add(mix(tone, lit, 0.6), [0.06, 0.05, 0.05]), hd = scale(tone, 0.7);
          // (the sketch's hair: one broad stroke over the crown and down the back, curving with the skull, and one lighter across
          // its lit side; then flyaway flicks)
          body.push(st(at(0.55, 0, 0.05), at(-0.3, 0, -0.4), w * 1.05, hair, 'mass', { path: [at(0.35, 0, -0.42)], side: sd, taper: [L * 0.35, L * 0.4], dry: 0.35 }));
          lights.push(st(at(0.5, sg * 0.1, 0.0), at(0.0, sg * 0.4, -0.38), w * 0.4, hl, 'lit', { path: [at(0.35, sg * 0.3, -0.25)], alpha: 0.85, dry: 0.45 }));
          // (flyaway: thin flicks off the crown and back, curling out as the sketch's hair does)
          for (let k = 0; k < 4; k++) { const v = -0.45 + 0.3 * k, a = at(0.38, v * 0.6, -0.2), b = at(-0.05 - 0.15 * (k % 2), v * 1.5, -0.8), mid = add(scale(add(a, b), 0.5), scale(d, L * 0.18));
            lights.push(st(a, b, w * 0.045, k % 2 ? hd : hair, `flick${k}`, { path: [mid], alpha: 0.85, dry: 0.35, taper: [0.003, w * 0.25], body: 0 })); }
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
        // (what's worn: one pull a block; cloth's panels (a skirt's, a coat's) laid square-ended and wet, so they join into one
        // sheet rather than scalloping into lumps)
        case 'worn': body.push(m(p.name === 'worn:pelvis' ? { taper: [0.004, 0.004], dry: 0.04, width: p.width * 1.08, mix2: 0.15 } : { taper: [0.02, 0.04] })); break;
        case 'palm': case 'fingers': case 'tips': case 'thumb': case 'thumbtip': {
          // (the hand (rig.ts: palm, fingers in two, thumb in two): one skin pull a part, lit by its own face like cloth, a
          // little darker closed on a hold)
          const skin = (palette[p.mat - (p.mat % 8)] ?? col) as V, nf = dot(p.fwd, p.toEye) >= 0 ? p.fwd : scale(p.fwd, -1), lk = smooth(-0.3, 0.6, Math.abs(dot(nf, T.S)));
          const sk = mix(mulv(skin, mix([0.62, 0.6, 0.68], scale(T.deep, 0.85), T.dk)), mulv(skin, mix([1.04, 1.02, 1.0], T.sunlit, T.dk)), 0.35 + 0.5 * lk);
          body.push(m({ width: p.width * 1.15, col: scale(sk, p.gripping ? 0.88 : 1), mix2: 0, dry: 0.1, heart: 0.5, taper: [p.width * 0.35, p.width * 0.4], key: `${key}/hand` }));
          break;
        }
        default: {
          // (a limb: a pull from the joint, tapering toward the hand or the foot)
          under.push(m({ width: p.width * 1.45, col: scale(dark, 0.45), mix2: 0, dry: 0.15, key: `${key}/under`, taper: [0.03, 0.05] }));
          body.push(m({ width: p.width * 1.22, heart: 0.15, taper: [p.width * 0.4, p.width * 0.5] }));
          litPull(0.45);
        }
      }
    }
    // (detail the blocks can't show, from the character's own clothes and hair: brushwork, not geometry. Each painted just after
    // the part it's on)
    const det = (d: number, ms: Mark[]) => { if (!ms.length) return; if (putSpline) detail(d, ms); else items.push({ d: d - 0.0015, ms: [ms] }); };
    const skinOf = (q: (typeof parts)[number]) => q.mat % 8 === 0, WUP: V = [0, 1, 0];
    const crease = (pu: (typeof parts)[number], pl: (typeof parts)[number], key: string) => {
      const du = unit(sub(pu.b, pu.a)), dl = unit(sub(pl.b, pl.a)), bend = Math.acos(Math.max(-1, Math.min(1, dot(du, dl))));
      if (bend < 0.5 || pl.endOn > 0.6) return;
      const k = Math.min(1, (bend - 0.5) / 1.0), bis = unit(sub(dl, du)), w = Math.min(pu.width, pl.width), at = add(pu.b, scale(bis, w * 0.28)), L = 0.035 + 0.045 * k;
      const { dark } = tonesOf(pu), m = (b: V, i: number): Mark => ({ layer: 0, kind: K.PULL, a: at, b, side: pu.side, width: 0.011, col: scale(dark, 0.72), mix2: 0, alpha: 0.8, dry: 0.25, rank: 1, key: `${key}${i}`, taper: [0.004, 0.012] });
      det(Math.min(pu.dist, pl.dist), [m(sub(at, scale(du, L)), 0), m(add(at, scale(dl, L * 0.85)), 1)]);
    };
    for (const n of ['L', 'R'] as const) {
      const ua = by.get('upperArm' + n), fa = by.get('foreArm' + n), th = by.get('thigh' + n), sh = by.get('shin' + n), ft = by.get('foot' + n);
      void crease; void ua; void fa; void th; void sh;
    }
    // (a skirt's pleats: a fine line down each panel of cloth worn as bottoms; not a coat)
    for (const q of parts) if (q.grid && q.mat % 8 === 3) {
      const { dark } = tonesOf(q);
      det(q.dist, [{ layer: 0, kind: K.PULL, a: q.top!, b: q.bot!, side: q.side, width: 0.008, col: scale(dark, 0.7), mix2: 0, alpha: 0.65, dry: 0.3, rank: 1, key: `fig:pleat${Math.round(q.a[0] * 100)}${Math.round(q.a[2] * 100)}`, taper: [0.003, 0.006] }]);
    }
    // (the sketch's gestural touches: the ponytail's arc, one calligraphic flick off its tip, its lit side catching; nothing small
    // elsewhere: an oil sketch says a form in a few big strokes and leaves the rest)
    { const hairLinks = parts.filter((q) => q.kind === 'worn' && q.mat % 8 === 1 && !q.grid), hd = by.get('head');
      if (hd && hairLinks.length >= 2) {
        const tip = hairLinks.reduce((x, y) => (len(sub(y.b, hd.b)) > len(sub(x.b, hd.b)) ? y : x)), d = unit(sub(tip.b, tip.a)), s = unit(tip.side), col = tonesOf(tip).tone, L = tip.length;
        const a = sub(tip.b, scale(d, L * 0.3)), m = add(add(tip.b, scale(d, L * 0.45)), scale(s, L * 0.35)), b = add(add(tip.b, scale(d, L * 0.3)), scale(s, L * 0.75));
        det(tip.dist - 0.001, [{ layer: 0, kind: K.PULL, a, b, path: [m], side: s, width: tip.width * 0.18, col: scale(col, 0.85), mix2: 0, alpha: 0.9, dry: 0.3, heart: 0.2, rank: 0.5, key: 'fig:flick', taper: [0.004, L * 0.4] }]);
      } }
    // (the figure's strokes, far to near by form, a garment over what's under it)
    if (putSpline) for (const x of SP.sort((a, b) => b.d - a.d)) putSpline(x.s);
    // (the old stamp figure only where there are no splines; the contact shadows on the ground either way)
    for (const m of [...ground, ...(putSpline ? [] : items.sort((a, b) => b.d - a.d).flatMap((it) => it.ms.flat()))]) put(m);
  },
};

/** how much of the figure to paint: `masses` only its broad masses (main.ts, `paint=masses`) */
export const paintMode = { masses: false };

export const strokeGouache: LookDef = {
  name: 'stroke-gouache', fog: strokeGouacheRules.haze, fogNear: 0.12, sun: DAY_SUN, shadow: 'map', guides: false, strokes: strokeGouacheRules,
  glsl: `vec3 look(Surf s) { return clayOf(s); }`,
};

