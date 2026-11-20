/**
 * Stroke gouache: the city and the runner in opaque, chalky gouache, every visible mark a brush stroke (strokes.ts).
 * A wall is one to four broad pulls across it, the colour of its concrete in the light or the one cool colour of shade,
 * each pull with a dry lift at its exit where the paper shows; a lit face has shadow passages laid where the sun map
 * says it's out of the light (the buildings' shadows on each other, as paint). A roof is a few pulls along its length.
 * Each lip (an edge hold: where a palm can catch) is a loaded coping along the top of its wall, firmer than the wash of
 * its shadow under it, and a dark line just inside it on the roof, kept as long as anything is drawn. The sills a hand
 * can take are the storeys' marks: a pale ledge, its shadow beneath. The street is a few dark pulls; the sky a few
 * broad passages with the paper between them. The runner: the masses of its torso and hips, each limb a pull along it
 * with a lit pull over it on the sun's side, a dark under-stroke so it holds against the walls; the hand a dab (closed
 * and darker on a hold), the shoe a loaded mark (darker where it bears weight); its shadow laid as paint on the roof
 * under it and the wall the light carries it to.
 *
 * The deployed `gouache` is the comparison: the same light and colour grouping, but no screen-space paint over it
 * here, so what is seen is what the strokes themselves give.
 */
import type { LookDef } from '../looks';
import type { Box, City } from '../city';
import { TAG } from '../city';
import type { Mark, Part, StrokeRules, V } from '../strokes';
import { EDGE, K, LAYER, add, boxSeed, cross, dot, len, lipsOf, mix, onLine, onto, planesOf, rng, scale, shadowed, smooth, sub, unit, hashKey } from '../strokes';

const SUN: V = [-0.55, 0.6, 0.58], S = unit(SUN);
const WARM: V = [0.64, 0.62, 0.58], GREEN: V = [0.57, 0.61, 0.6], COOL: V = [0.6, 0.61, 0.63], TERRA: V = [0.67, 0.55, 0.51];
const concrete = (s: number): V => (s < 0.4 ? mix(WARM, COOL, s / 0.4) : s < 0.9 ? mix(COOL, GREEN, (s - 0.4) / 0.5) : mix(WARM, TERRA, 0.7));
const mulv = (a: V, b: V): V => [a[0] * b[0], a[1] * b[1], a[2] * b[2]];
const SUNLIT: V = [1.05, 0.99, 0.91];
/** the one cool colour of shade (a little warmth bounced up into the walls) */
const shadeTint = (n: V): V => add([0.7, 0.71, 0.79], scale([0.06, 0.04, 0], (1 - Math.abs(n[1])) * smooth(0.5, -0.5, n[1] + 0.2)));
/** in the sun or not, massed: a narrow edge between */
const massOf = (n: V) => smooth(0, 0.18, dot(n, S));
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
const litOf = (base: V, n: V): V => mulv(base, mix(shadeTint(n), SUNLIT, massOf(n)));
const shadeOf = (base: V, n: V): V => mulv(base, shadeTint(n));
/** shadow passages withdraw by 60 m: past that, the light is the planes' own (lit or turned away) */
const SHADOW_RANK = 0.4;
const lipped = new Set<number>([TAG.BUILDING, TAG.HUT, TAG.RIM, TAG.STEP, TAG.STAIR, TAG.TANK, TAG.UNIT]);

/** broad pulls across a plane: rows of them, each row's pulls running one way, a dry lift at each exit */
function pulls(put: (m: Mark) => void, key: string, o: V, t: V, up: V, n: V, w: number, h: number, col: (r: number, rows: number) => V, rows: number, clip: [V, V], rank: number, rnd: () => number, layer: number = LAYER.BROAD, kind: number = K.PULL): void {
  const rh = h / rows;
  for (let r = 0; r < rows; r++) {
    // (past the plane's ends by more than a taper: the corners are cut by the clip, not left as paper)
    const over = Math.min(0.9, rh * 0.45) + 0.25, v = (r + 0.5) * rh, fwd = rnd() < 0.5; let s = -over, i = 0;
    while (s < w + over) {
      const L = Math.min(w + 2 * over, 6 + rnd() * 6), e = Math.min(w + over, s + L), c0 = col(r, rows);
      const a = add(add(o, scale(t, s)), scale(up, v + (rnd() - 0.5) * rh * 0.12)), b = add(add(o, scale(t, e)), scale(up, v + (rnd() - 0.5) * rh * 0.12));
      put({ layer, kind, a: fwd ? a : b, b: fwd ? b : a, n, width: rh * 1.42, col: scale(c0, 0.97 + rnd() * 0.06), alpha: 1, dry: 0.12 + rnd() * 0.25, heart: 0.15, rank, key: `${key}/p${r}.${i++}`, clip, taper: [Math.min(0.9, rh * 0.45), Math.min(1.6, rh * 0.8)] });
      if (e >= w + over) break;
      s = e - Math.min(1.6, rh * 0.6);
    }
  }
}
/** shadow passages over a lit plane: on a lattice, each laid where its place is out of the sun (the city looked along
 * the light from it, once, as the chunk's marks are made) */
function passages(put: (m: Mark) => void, city: City, key: string, o: V, t: V, up: V, n: V, w: number, h: number, col: V, clip: [V, V], rnd: () => number, most = 2.2): void {
  const sp = Math.max(0.5, Math.min(most, w / 2, h / 2)), nu = Math.max(1, Math.round(w / sp)), nv = Math.max(1, Math.round(h / sp));
  for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
    const u = ((i + 0.5 + (rnd() - 0.5) * 0.4) / nu) * w, v = ((j + 0.5 + (rnd() - 0.5) * 0.4) / nv) * h, l = sp * 0.75;
    const c = add(add(o, scale(t, u)), scale(up, v));
    if (!shadowed(city, add(c, scale(n, 0.05)), SUN)) continue;
    const slant = (rnd() - 0.5) * 0.3, d = add(scale(t, l), scale(up, l * slant));
    put({ layer: LAYER.SHADOW, kind: K.PULL, a: sub(c, d), b: add(c, d), n, width: sp * 1.25, col: scale(col, 0.97 + rnd() * 0.06), alpha: 1, dry: 0.3, heart: 0.3, rank: SHADOW_RANK, key: `${key}/s${i}.${j}`, clip, taper: [0.2, 0.5] });
  }
}

export const strokeGouacheRules: StrokeRules = {
  paper: [0.93, 0.9, 0.84], grain: 1, haze: [0.77, 0.74, 0.83], hazeNear: 0.12, fadeToPaper: 0, sun: SUN,
  city(c, city, put, keeps) {
    const ox = c.cx * 64, oz = c.cz * 64, rnd = rng(hashKey(`street:${c.cx},${c.cz}`));
    // (the street: a few dark pulls, and its shadow passages)
    const sN: V = [0, 1, 0], sClip: [V, V] = [[ox - 0.01, -1, oz - 0.01], [ox + 64.01, 1, oz + 64.01]];
    pulls(put, `street:${c.cx},${c.cz}`, [ox, 0, oz], [1, 0, 0], [0, 0, 1], sN, 64, 64, () => litOf(baseOf(null), sN), 9, sClip, 0.8, rnd);
    if (keeps(SHADOW_RANK)) passages(put, city, `street:${c.cx},${c.cz}`, [ox, 0, oz], [1, 0, 0], [0, 0, 1], sN, 64, 64, shadeOf(baseOf(null), sN), sClip, rnd, 2.8);
    for (const b of [...c.boxes, ...c.props]) {
      const base = baseOf(b), big = (b.x1 - b.x0) * (b.z1 - b.z0) > 12 && b.y1 - b.y0 > 2, rank = big ? 0.85 : 0.38;
      if (!keeps(rank)) continue;
      if (b.tag === TAG.BAR) {
        const alongX = b.x1 - b.x0 >= b.z1 - b.z0, y = (b.y0 + b.y1) / 2, mx = (b.x0 + b.x1) / 2, mz = (b.z0 + b.z1) / 2;
        const a: V = alongX ? [b.x0, y, mz] : [mx, y, b.z0], e: V = alongX ? [b.x1, y, mz] : [mx, y, b.z1];
        put({ layer: LAYER.EDGE, kind: K.PULL + EDGE, a, b: e, width: Math.max(0.06, Math.min(b.y1 - b.y0, alongX ? b.z1 - b.z0 : b.x1 - b.x0)), col: base, alpha: 1, dry: 0.3, rank: 0.75, key: `bar:${a.join(',')}` });
        continue;
      }
      const near = city.boxesNear((b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2, Math.max(b.x1 - b.x0, b.z1 - b.z0) / 2 + 1);
      for (const p of planesOf(b, near)) {
        const r = rng(hashKey(p.key)), lit = massOf(p.n) > 0.5;
        // (far off, one broad pass a plane: the distance resolves into masses)
        const rows = !keeps(0.6) ? 1 : p.top ? Math.max(1, Math.min(4, Math.round(p.h / 4))) : Math.max(1, Math.min(4, Math.round(p.h / 3.5)));
        const tone = (k: number, n: number) => scale(litOf(p.top ? scale(base, 1.04) : base, p.n), p.top ? 1 : 0.94 + 0.06 * ((k + 0.5) / n));
        pulls(put, p.key, p.o, p.t, p.up, p.n, p.w, p.h, tone, rows, p.clip, rank, r);
        if (lit && big && keeps(SHADOW_RANK)) passages(put, city, p.key, p.o, p.t, p.up, p.n, p.w, p.h, shadeOf(base, p.n), p.clip, r);
      }
    }
    // (the lips: a loaded coping, its shadow under it, the dark line of the lip on the roof)
    for (const l of lipsOf(c, city)) {
      if (!l.box || !lipped.has(l.box.tag) || l.box.y1 - l.box.y0 < 0.5) continue;
      const r = rng(hashKey(l.key)), base = baseOf(l.box), heart = onLine(city, l.a, l.b) ?? 0.3 + r() * 0.4, keep = l.box.tag === TAG.UNIT || l.box.tag === TAG.TANK ? 0.38 : 1;
      if (!keeps(keep)) continue;
      const dir = unit(sub(l.b, l.a)), y = l.a[1], lo = (p: V, q: V): V => [Math.min(p[0], q[0]), Math.min(p[1], q[1]), Math.min(p[2], q[2])], hi = (p: V, q: V): V => [Math.max(p[0], q[0]), Math.max(p[1], q[1]), Math.max(p[2], q[2])];
      const wallClip = (dy0: number, dy1: number): [V, V] => { const p = add(l.a, scale(l.n, -1)), q = add(l.b, scale(l.n, 1)); const m0 = lo(p, q), m1 = hi(p, q); m0[1] = y + dy0; m1[1] = y + dy1; return [m0, m1]; };
      const cap = scale(litOf(base, l.n), massOf(l.n) > 0.5 ? 1.12 : 0.82);
      const at = (dy: number, inn = 0): [V, V] => [add(add(l.a, [0, dy, 0]), scale(l.n, -inn)), add(add(l.b, [0, dy, 0]), scale(l.n, -inn))];
      const [a0, b0] = at(-0.16), fwd = r() < 0.5;
      put({ layer: LAYER.EDGE, kind: K.PULL, a: fwd ? a0 : b0, b: fwd ? b0 : a0, n: l.n, width: 0.3, col: cap, alpha: 1, dry: 0.45, heart: fwd ? heart : 1 - heart, rank: keep, key: `${l.key}/cap`, clip: wallClip(-0.6, 0.01), taper: [0.1, 0.6] });
      const [a1, b1] = at(-0.37);
      put({ layer: LAYER.EDGE, kind: K.WASH, a: a1, b: b1, n: l.n, width: 0.14, col: scale(shadeOf(base, l.n), 0.78), alpha: 0.55, rank: Math.min(keep, 0.45), key: `${l.key}/under`, clip: wallClip(-0.6, -0.3) });
      const [a2, b2] = at(0, 0.07), m0 = lo(add(l.a, [0, -0.6, 0]), add(l.b, scale(l.n, -0.3))), m1 = hi(add(l.a, [0, 0.6, 0]), add(l.b, scale(l.n, 0.01)));
      m0[1] = y - 0.6; m1[1] = y + 0.6;
      put({ layer: LAYER.EDGE, kind: K.PULL, a: a2, b: b2, n: [0, 1, 0], width: 0.1, col: scale(shadeOf(base, [0, 1, 0]), 0.5), alpha: 0.95, dry: 0.3, heart, rank: keep, key: `${l.key}/lip`, clip: [m0, m1], taper: [0.05, 0.3] });
      void dir;
    }
    // (sills, which can be held: a pale ledge, its shadow under it; pipes, a dark line up the wall)
    for (const h of c.holds) {
      if ((h.kind !== 'sill' && h.kind !== 'pipe') || !keeps(0.4)) continue;
      const n: V = [h.nx, 0, h.nz], a: V = [h.ax, h.ay, h.az], b: V = [h.bx, h.by, h.bz], key = `${h.kind}:${a.map((v) => v.toFixed(2)).join(',')}`, r = rng(hashKey(key));
      const owner = c.boxes.find((o) => a[0] >= o.x0 - 0.02 && a[0] <= o.x1 + 0.02 && a[2] >= o.z0 - 0.02 && a[2] <= o.z1 + 0.02 && o.y1 >= a[1]) ?? null, base = baseOf(owner);
      if (h.kind === 'pipe') { put({ layer: LAYER.ACCENT, kind: K.PULL + EDGE, a: add(a, scale(n, 0.06)), b: add(b, scale(n, 0.06)), width: 0.08, col: scale(shadeOf(base, n), 0.55), alpha: 0.9, dry: 0.5, rank: 0.3, key }); continue; }
      const lo: V = [Math.min(a[0], b[0]) - (n[0] ? 1 : 0), a[1] - 0.25, Math.min(a[2], b[2]) - (n[2] ? 1 : 0)], hi: V = [Math.max(a[0], b[0]) + (n[0] ? 1 : 0), a[1] + 0.12, Math.max(a[2], b[2]) + (n[2] ? 1 : 0)];
      put({ layer: LAYER.ACCENT, kind: K.PULL, a: add(a, [0, 0.03, 0]), b: add(b, [0, 0.03, 0]), n, width: 0.12, col: scale(litOf(base, n), massOf(n) > 0.5 ? 1.13 : 0.9), alpha: 1, dry: 0.4 + r() * 0.3, heart: r(), rank: 0.4, key: `${key}/ledge`, clip: [lo, hi] });
      put({ layer: LAYER.ACCENT, kind: K.WASH, a: add(a, [0, -0.08, 0]), b: add(b, [0, -0.08, 0]), n, width: 0.08, col: scale(shadeOf(base, n), 0.7), alpha: 0.6, rank: 0.36, key: `${key}/under`, clip: [lo, hi] });
    }
  },
  sky: (() => {
    // (broad passages from the horizon up, the paper between; a few lighter cloud pulls low)
    const out: Mark[] = [], dirOf = (az: number, el: number): V => [Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)];
    const top: V = [0.58, 0.56, 0.7], hor: V = [0.89, 0.83, 0.84], rnd = rng(7);
    for (let row = 0; row < 6; row++) {
      const el = (-2 + row * 9) * (Math.PI / 180), col = mix(hor, top, Math.pow(Math.max(0, row / 5), 0.8));
      for (let k = 0; k < 9; k++) {
        const az = (k * 40 + rnd() * 12) * (Math.PI / 180), half = (30 + rnd() * 8) * (Math.PI / 180), e2 = el + (rnd() - 0.5) * 0.04;
        const a = dirOf(az - half, e2), b = dirOf(az + half, e2), n = unit(scale(add(a, b), -0.5));
        out.push({ layer: 0, kind: K.PULL, a, b, n, width: 0.19, col: scale(col, 0.98 + rnd() * 0.04), alpha: 1, dry: 0.35 + rnd() * 0.3, heart: 0.2, rank: 1, key: `sky:${row}.${k}`, sky: true, taper: [0.05, 0.25] });
      }
    }
    for (let k = 0; k < 7; k++) {
      const az = rnd() * Math.PI * 2, el = (4 + rnd() * 10) * (Math.PI / 180), half = (8 + rnd() * 10) * (Math.PI / 180);
      const a = dirOf(az - half, el), b = dirOf(az + half, el + 0.01), n = unit(scale(add(a, b), -0.5));
      out.push({ layer: 0, kind: K.PULL, a, b, n, width: 0.035, col: add(hor, [0.04, 0.05, 0.05]), alpha: 0.9, dry: 0.6, heart: 0.2, rank: 1, key: `cloud:${k}`, sky: true, taper: [0.02, 0.2] });
    }
    return out;
  })(),
  figure(parts, palette, put) {
    const under: Mark[] = [], body: Mark[] = [], light: Mark[] = [], accents: Mark[] = [];
    for (const p of parts) {
      const col = (palette[p.mat] ?? palette[0]) as V, dark = mulv(col, [0.55, 0.57, 0.68]), lit = scale(col, 1.05);
      const front = smooth(-0.35, 0.45, p.sunFront), tone = mix(dark, lit, 0.25 + 0.35 * front), key = `fig:${p.name}`;
      // (a little past each end, so the marks overlap at the joints and cover the body's depth whole)
      const ext = scale(unit(sub(p.b, p.a)), Math.min(0.06, p.width * 0.35)), pa = sub(p.a, ext), pb = add(p.b, ext);
      const m = (o: Partial<Mark>): Mark => ({ layer: 0, kind: K.PULL, a: pa, b: pb, side: p.side, width: p.width * 1.2, col: tone, alpha: 1, dry: 0.2, heart: 0.25, rank: 1, key, ...o });
      // (the lit pull: narrower, on the sun's side of it, where its turned face can be seen)
      const litPull = (k: number) => { if (front < 0.15 || Math.abs(p.sunSide) < 0.05) return; const off = scale(p.side, Math.sign(p.sunSide) * p.width * 0.25); light.push(m({ a: add(pa, off), b: add(pb, off), width: p.width * k, col: lit, alpha: 0.95, dry: 0.45, key: `${key}/lit` })); };
      // (seen end-on, a limb's pull shortens to nothing: its mass as a dab, so the body's depth is covered)
      if (p.endOn > 0.45 && p.kind !== 'head') { const c = scale(add(p.a, p.b), 0.5), up = scale(unit(cross(p.side, p.toEye)), p.girth * 0.5); under.push(m({ kind: K.DAB, a: sub(c, up), b: add(c, up), width: p.girth * 1.25, col: scale(dark, 0.45), key: `${key}/endU` })); body.push(m({ kind: K.DAB, a: sub(c, scale(up, 0.85)), b: add(c, scale(up, 0.85)), width: p.girth * 1.05, key: `${key}/end` })); }
      switch (p.kind) {
        case 'head': {
          body.push(m({ kind: K.DAB, a: sub(p.a, scale(unit(sub(p.b, p.a)), p.length * 0.2)), b: add(p.b, scale(unit(sub(p.b, p.a)), p.length * 0.2)), width: p.width * 1.45, col: mix(tone, lit, 0.2) }));
          break;
        }
        case 'pelvis': case 'torso':
          under.push(m({ width: p.width * 1.38, col: scale(dark, 0.45), dry: 0.1, key: `${key}/under` }));
          body.push(m({ heart: p.kind === 'torso' ? 0.7 : 0.4, taper: [0.06, 0.08] }));
          litPull(0.5);
          break;
        case 'foot': {
          under.push(m({ width: p.width * 1.45, col: scale(dark, 0.4), dry: 0.05, key: `${key}/under` }));
          // (the shoe that bears weight loaded and dark; the one in the air lighter, drier)
          body.push(m({ width: p.width * 1.25, col: p.planted ? scale(tone, 0.82) : mix(tone, lit, 0.4), dry: p.planted ? 0.05 : 0.45, heart: 0.5, taper: [0.03, 0.04] }));
          if (p.planted) accents.push(m({ kind: K.PULL, width: 0.035, a: add(p.a, [0, -p.width * 0.45, 0]), b: add(p.b, [0, -p.width * 0.45, 0]), col: [0.12, 0.11, 0.12], dry: 0.2, key: `${key}/sole` }));
          break;
        }
        case 'worn': body.push(m({ taper: [0.02, 0.04] })); break;
        default: {
          // (a limb: a pull from the joint, tapering toward the hand or the foot)
          under.push(m({ width: p.width * 1.45, col: scale(dark, 0.45), dry: 0.15, key: `${key}/under`, taper: [0.03, 0.05] }));
          body.push(m({ width: p.width * 1.22, heart: 0.15, taper: [0.03, 0.06] }));
          litPull(0.45);
          if (p.kind === 'foreArm') {
            // (the hand: closed and darker on a hold; open, lighter, a little larger reaching)
            const skin = (palette[p.mat - (p.mat % 8)] ?? col) as V, d = unit(sub(p.b, p.a)), s = p.gripping ? 0.085 : 0.11;
            accents.push(m({ kind: K.DAB, a: sub(p.b, scale(d, s * 0.3)), b: add(p.b, scale(d, s * 0.9)), width: s, col: p.gripping ? scale(mulv(skin, [0.75, 0.72, 0.75]), 0.85) : mix(skin, scale(skin, 1.08), front), key: `${key}/hand` }));
          }
        }
      }
    }
    for (const m of [...under, ...body, ...light, ...accents]) put(m);
  },
  shadow(parts, rs, put) {
    for (const r of rs) {
      if (r.strength <= 0.02) continue;
      const col = scale(shadeOf(baseOf(r.box), r.n), r.n[1] > 0.5 ? 1 : 0.95);
      for (const p of parts) {
        if (p.kind === 'worn') continue;
        const a = onto(p.a, r, SUN), b = onto(p.b, r, SUN);
        if (!a || !b || len(sub(b, a)) < 0.02) continue;
        put({ layer: 0, kind: K.PULL, a, b, n: r.n, side: unit(cross(r.n, unit(sub(b, a)))), width: Math.max(0.1, p.width * 1.35), col, alpha: Math.min(1, 0.4 + r.strength), dry: 0.2, heart: 0.3, rank: 1, key: `shadow:${p.name}`, clip: r.clip, taper: [0.03, 0.06] });
      }
    }
  },
};

export const strokeGouache: LookDef = {
  name: 'stroke-gouache', fog: strokeGouacheRules.haze, fogNear: 0.12, sun: SUN, shadow: 'none', guides: false, strokes: strokeGouacheRules,
  glsl: `vec3 look(Surf s) { return clayOf(s); }`,
};
